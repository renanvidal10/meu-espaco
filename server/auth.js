'use strict';

// Autenticação do OncoGenYX (ARQUITETURA.md §11, §17 e §85).
//
// Decisões relevantes, dado que a plataforma trafega dado de saúde:
//   - Senha via scrypt ASSÍNCRONO, com parâmetros acima do mínimo OWASP e
//     formato versionado: o hash antigo é refeito no primeiro login bem
//     sucedido. A versão síncrona travava o servidor inteiro a cada login.
//   - Token de sessão gerado com CSPRNG, entregue só em cookie HttpOnly e
//     guardado no banco só como hash SHA-256: um script injetado na página não
//     lê a sessão, e um vazamento do banco não entrega sessões ativas.
//   - Sessão cai com 1 h sem uso e, de qualquer jeito, em 12 h (§85.1, dec. 4).
//   - Links por e-mail de uso único, invalidados ao gerar um novo.
//   - Tentativas contadas no banco, por conta e por IP (§85.2).

const crypto = require('crypto');
const { promisify } = require('util');
const store = require('./store');

const scrypt = promisify(crypto.scrypt);

const SESSION_TTL_MS = 1000 * 60 * 60 * 12;        // teto: 12 horas
const SESSION_IDLE_MS = 1000 * 60 * 60;            // inatividade: 1 hora
const SESSION_TOUCH_MS = 1000 * 60;                // grava o último uso no máximo 1x/min
const RESET_TTL_MS = 1000 * 60 * 30;               // redefinir senha: 30 minutos
const CONFIRMACAO_TTL_MS = 1000 * 60 * 60 * 24;    // confirmar e-mail: 24 horas

/* ---------- senha ---------- */

// v2: N=2^15, r=8, p=3 (cerca de 32 MiB por cálculo, cabe com folga nos
// 512 MB do Render). v1 era o padrão do Node, N=2^14, r=8, p=1.
const SCRYPT_V2 = { N: 2 ** 15, r: 8, p: 3 };
const SCRYPT_V1 = { N: 2 ** 14, r: 8, p: 1 };
const SCRYPT_KEYLEN = 64;
const MAXMEM = 96 * 1024 * 1024;

async function derivar(password, salt, { N, r, p }) {
  return scrypt(String(password).normalize('NFKC'), salt, SCRYPT_KEYLEN, { N, r, p, maxmem: MAXMEM });
}

async function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const { N, r, p } = SCRYPT_V2;
  const derived = (await derivar(password, salt, SCRYPT_V2)).toString('hex');
  return `scrypt2$${N}$${r}$${p}$${salt}$${derived}`;
}

async function verifyPassword(password, stored) {
  if (!stored || typeof password !== 'string') return false;
  const partes = String(stored).split('$');
  let params; let salt; let expected;
  if (partes[0] === 'scrypt2' && partes.length === 6) {
    params = { N: Number(partes[1]), r: Number(partes[2]), p: Number(partes[3]) };
    [, , , , salt, expected] = partes;
  } else if (partes[0] === 'scrypt' && partes.length === 3) {
    // Hash da v1.0, que não normalizava Unicode: compara do jeito que foi feito.
    params = SCRYPT_V1;
    [, salt, expected] = partes;
    const a = await scrypt(password, salt, SCRYPT_KEYLEN, { ...params, maxmem: MAXMEM });
    const b = Buffer.from(expected, 'hex');
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  } else {
    return false;
  }
  if (!salt || !expected || !params.N || !params.r || !params.p) return false;
  const a = await derivar(password, salt, params);
  const b = Buffer.from(expected, 'hex');
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

function precisaRefazerHash(stored) {
  const { N, r, p } = SCRYPT_V2;
  return !String(stored || '').startsWith(`scrypt2$${N}$${r}$${p}$`);
}

// Senhas que a regra de composição deixa passar e que todo mundo usa. A
// comparação é feita só nas letras, em minúsculas e sem acento: "Senha@123",
// "S3nh@2024!" e "Brasil#1" caem todas.
const PALAVRAS_PROIBIDAS = [
  'senha', 'password', 'passw', 'mudar', 'trocar', 'admin', 'qwerty', 'asdf', 'abc',
  'teste', 'test', 'brasil', 'medico', 'medica', 'doutor', 'doutora', 'oncogenyx',
  'onco', 'genyx', 'iloveyou', 'welcome', 'bemvindo', 'acesso', 'login', 'usuario',
  'master', 'segredo', 'deus', 'jesus', 'amor', 'flamengo', 'corinthians', 'palmeiras',
];

function soLetras(s) {
  return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/[^a-z]/g, '');
}

// Troca comum de letra por símbolo: @ por a, 3 por e, 0 por o, 1 por i, $ por s.
function semLeet(s) {
  return String(s || '').toLowerCase()
    .replace(/@/g, 'a').replace(/3/g, 'e').replace(/0/g, 'o').replace(/1/g, 'i').replace(/\$/g, 's');
}

/**
 * Regra decidida pelo dono (§85.1, decisão 3): no mínimo 8 caracteres, com
 * pelo menos uma letra maiúscula e um caractere especial. Senhas comuns e
 * senhas feitas do próprio nome, e-mail ou CRM continuam recusadas.
 * Devolve a mensagem de erro, ou null quando a senha serve.
 */
function validatePassword(password, contexto = {}) {
  if (typeof password !== 'string' || password.length < 8) {
    return 'A senha precisa ter no mínimo 8 caracteres.';
  }
  if (password.length > 128) return 'Senha longa demais (máximo de 128 caracteres).';
  if (!/\p{Lu}/u.test(password)) return 'A senha precisa ter pelo menos uma letra maiúscula.';
  if (!/[^\p{L}\p{N}]/u.test(password)) {
    return 'A senha precisa ter pelo menos um caractere especial, como ! @ # $ % ou um espaço.';
  }

  const letras = soLetras(semLeet(password));
  const digitos = password.replace(/\D/g, '');
  const sequencia = digitos.length >= 4 && ('01234567890123456789'.includes(digitos)
    || '98765432109876543210'.includes(digitos) || /^(\d)\1+$/.test(digitos));
  const ehComum = PALAVRAS_PROIBIDAS.some((p) => letras === p || (p.length >= 5 && letras.includes(p)))
    || (sequencia && soLetras(password).length <= 2);
  if (ehComum) {
    return 'Essa senha é comum demais e costuma ser a primeira testada por quem tenta invadir. Escolha outra.';
  }

  const nomes = String(contexto.nome || '').normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().split(/[^a-z]+/).filter((n) => n.length >= 4 && !['dra', 'dr'].includes(n));
  const localEmail = soLetras(String(contexto.email || '').split('@')[0]);
  const usaNome = nomes.some((n) => letras.includes(n)) || (localEmail.length >= 4 && letras.includes(localEmail));
  const usaCrm = contexto.crm && String(contexto.crm).length >= 4 && password.includes(String(contexto.crm));
  if (usaNome || usaCrm) {
    return 'A senha não pode conter seu nome, seu e-mail ou seu CRM.';
  }
  return null;
}

/* ---------- tokens ---------- */

function newToken() {
  return crypto.randomBytes(32).toString('base64url');
}

function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

async function issueSession(userId, contexto = {}) {
  const token = newToken();
  await store.createSession(hashToken(token), userId, new Date(Date.now() + SESSION_TTL_MS), contexto);
  return token;
}

/**
 * Sessão válida devolve o usuário. Vencida por inatividade é apagada na hora,
 * para não ressuscitar se o relógio do servidor for ajustado.
 */
async function resolveSession(token) {
  if (!token) return null;
  const hash = hashToken(token);
  const session = await store.findSession(hash);
  if (!session) return null;
  const ultimoUso = new Date(session.ultimo_uso_em || session.created_at || 0).getTime();
  const parado = Date.now() - ultimoUso;
  if (parado > SESSION_IDLE_MS) {
    await store.deleteSession(hash);
    return null;
  }
  if (parado > SESSION_TOUCH_MS) await store.tocarSessao(hash);
  const user = await store.findUserById(session.user_id);
  if (user) user._sessao = hash;
  return user;
}

async function revokeSession(token) {
  if (token) await store.deleteSession(hashToken(token));
}

async function issueResetToken(userId, finalidade = 'redefinir_senha') {
  const token = newToken();
  const ttl = finalidade === 'confirmar_email' ? CONFIRMACAO_TTL_MS : RESET_TTL_MS;
  await store.createReset(hashToken(token), userId, new Date(Date.now() + ttl), finalidade);
  return token;
}

async function findResetToken(token, finalidade = 'redefinir_senha') {
  if (!token) return null;
  return store.findReset(hashToken(String(token)), finalidade);
}

async function consumeResetToken(token, finalidade = 'redefinir_senha') {
  if (!token) return null;
  return store.consumeReset(hashToken(String(token)), finalidade);
}

/* ---------- limite de tentativas no banco (§85.2) ---------- */

const MIN = 60 * 1000;
const FALHAS_SEM_ESPERA = 4;
const FALHAS_PARA_DESATIVAR = 50;
const JANELA_CONTA_MS = 30 * 24 * 60 * MIN;   // falhas seguidas: só zeram com acerto ou redefinição

/** Espera exigida depois de N falhas seguidas numa conta: 30 s, 1, 2, 4, 8, 15 min. */
function esperaDepoisDe(falhas) {
  if (falhas <= FALHAS_SEM_ESPERA) return 0;
  return Math.min(15 * MIN, 30 * 1000 * 2 ** (falhas - FALHAS_SEM_ESPERA - 1));
}

/** Quanto falta (em ms) para a conta aceitar nova tentativa. 0 = pode tentar. */
async function esperaDaConta(chave) {
  const t = await store.lerTentativa(chave, JANELA_CONTA_MS);
  if (!t.contagem) return 0;
  const libera = t.atualizadoEm.getTime() + esperaDepoisDe(t.contagem);
  return Math.max(0, libera - Date.now());
}

async function falhaNaConta(chave) {
  const t = await store.registrarTentativa(chave, JANELA_CONTA_MS);
  return { falhas: t.contagem, desativar: t.contagem >= FALHAS_PARA_DESATIVAR };
}

async function acertoNaConta(chave) {
  await store.zerarTentativa(chave);
}

/** Teto por janela (IP, e-mail): devolve se ainda cabe e quanto esperar. */
async function dentroDoLimite(chave, { max, janelaMs }) {
  const t = await store.registrarTentativa(chave, janelaMs);
  return { permitido: t.contagem <= max, contagem: t.contagem };
}

/* ---------- limite em memória (custo de API por conta, modo simples) ---------- */

// Contador em memória: reinicia junto com o processo, o que é aceitável para
// limitar gasto de API por hora. O que protege SENHA fica no banco (acima).
const attempts = new Map();

function rateLimit(key, { max, windowMs }) {
  const now = Date.now();
  const entry = attempts.get(key);
  if (!entry || now > entry.resetAt) {
    attempts.set(key, { count: 1, resetAt: now + windowMs });
    return { allowed: true, retryAfterSec: 0 };
  }
  entry.count += 1;
  if (entry.count > max) {
    return { allowed: false, retryAfterSec: Math.ceil((entry.resetAt - now) / 1000) };
  }
  return { allowed: true, retryAfterSec: 0 };
}

// Evita crescimento ilimitado do Map em processos de vida longa.
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of attempts) if (now > entry.resetAt) attempts.delete(key);
}, 1000 * 60 * 10).unref();

/* ---------- validação de entrada ---------- */

function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

// O domínio sintético do modo simples (crm-123456-sp@acesso.oncogenyx) não
// pode ser aceito como email de cadastro: alguém se registraria com ele no
// modo completo e assumiria a conta daquele CRM.
const DOMINIO_INTERNO = '@acesso.oncogenyx';

function isValidEmail(email) {
  if (String(email).toLowerCase().endsWith(DOMINIO_INTERNO)) return false;
  if (String(email).length > 254) return false;
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email);
}

const UFS = ['AC', 'AL', 'AP', 'AM', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MT', 'MS', 'MG', 'PA',
  'PB', 'PR', 'PE', 'PI', 'RJ', 'RN', 'RS', 'RO', 'RR', 'SC', 'SP', 'SE', 'TO'];

/** CRM do modo completo: só dígitos, sem zeros à esquerda, até 7 dígitos. */
function normalizarCrm(valor) {
  const digitos = String(valor || '').replace(/\D/g, '').replace(/^0+/, '');
  if (!digitos || digitos.length > 7) return null;
  return digitos;
}

function normalizarUf(valor) {
  const uf = String(valor || '').trim().toUpperCase();
  return UFS.includes(uf) ? uf : null;
}

/* ---------- cookie de sessão ---------- */

// Em HTTPS o cookie leva o prefixo __Host-: o navegador só aceita se vier com
// Secure, Path=/ e sem Domain, o que impede um subdomínio de sobrescrevê-lo.
// Em http://localhost (desenvolvimento) o prefixo não vale, e o nome é outro.
const COOKIE_SEGURO = '__Host-sessao';
const COOKIE_LOCAL = 'sessao';

function cookieSeguro(req) {
  return req.secure || process.env.NODE_ENV === 'production';
}

function lerCookies(req) {
  const out = {};
  for (const parte of String(req.get('cookie') || '').split(';')) {
    const i = parte.indexOf('=');
    if (i < 0) continue;
    const k = parte.slice(0, i).trim();
    if (k) out[k] = decodeURIComponent(parte.slice(i + 1).trim());
  }
  return out;
}

function definirCookieDeSessao(req, res, token) {
  const seguro = cookieSeguro(req);
  const nome = seguro ? COOKIE_SEGURO : COOKIE_LOCAL;
  const atributos = ['Path=/', 'HttpOnly', 'SameSite=Strict', `Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}`];
  if (seguro) atributos.push('Secure');
  res.append('Set-Cookie', `${nome}=${token}; ${atributos.join('; ')}`);
}

function limparCookieDeSessao(req, res) {
  const seguro = cookieSeguro(req);
  const nome = seguro ? COOKIE_SEGURO : COOKIE_LOCAL;
  res.append('Set-Cookie', `${nome}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${seguro ? '; Secure' : ''}`);
}

/**
 * Token da requisição. O navegador manda o cookie; scripts de teste e de
 * operação podem mandar `Authorization: Bearer`. A página nunca vê o token,
 * então aceitar o cabeçalho não reabre o roubo de sessão por script injetado.
 */
function bearerToken(req) {
  const cookies = lerCookies(req);
  if (cookies[COOKIE_SEGURO]) return cookies[COOKIE_SEGURO];
  if (cookies[COOKIE_LOCAL]) return cookies[COOKIE_LOCAL];
  const header = req.get('authorization') || '';
  if (header.startsWith('Bearer ')) return header.slice(7).trim();
  return null;
}

/* ---------- middleware ---------- */

function requireAuth() {
  return async (req, res, next) => {
    try {
      const user = await resolveSession(bearerToken(req));
      if (!user) return res.status(401).json({ error: 'Sua sessão expirou. Entre novamente.' });
      req.user = user;
      next();
    } catch (err) {
      next(err);
    }
  };
}

/**
 * CRM liberado para usar a leitura de laudo e a Gena (§85.1, decisão 2):
 * conferido, ou dentro das 48 h de liberação provisória. Conta do modo
 * simples (sem UF separada) não passa por conferência.
 */
function situacaoDoCrm(user) {
  if (!user || !user.crm_uf) return { liberado: true, status: null };
  if (user.crm_status === 'ativo') return { liberado: true, status: 'ativo' };
  if (user.crm_status === 'recusado') return { liberado: false, status: 'recusado' };
  const ate = user.liberado_ate ? new Date(user.liberado_ate) : null;
  const provisorio = Boolean(ate && ate.getTime() > Date.now());
  return { liberado: provisorio, status: 'pendente', liberadoAte: ate ? ate.toISOString() : null };
}

function requireCrmLiberado() {
  return (req, res, next) => {
    const s = situacaoDoCrm(req.user);
    if (s.liberado) return next();
    const error = s.status === 'recusado'
      ? 'Não conseguimos confirmar o seu CRM no Conselho Federal de Medicina, então a leitura de laudos está bloqueada nesta conta. Abra "Minha conta" para ver como resolver.'
      : 'O seu CRM ainda está em conferência e a liberação provisória de 48 horas terminou. Assim que a conferência for concluída, você recebe um e-mail e o acesso volta.';
    return res.status(403).json({ error, crm: s.status });
  };
}

function ehAdmin(user) {
  if (!user || !user.email_verificado_em) return false;
  const lista = String(process.env.ADMIN_EMAILS || '').split(',').map((e) => e.trim().toLowerCase()).filter(Boolean);
  return lista.includes(String(user.email).toLowerCase());
}

function requireAdmin() {
  return (req, res, next) => {
    if (!ehAdmin(req.user)) return res.status(404).json({ error: 'Não encontrado.' });
    next();
  };
}

function exibirCrm(user) {
  return user.crm_uf ? `${user.crm}/${user.crm_uf}` : user.crm;
}

function publicUser(user) {
  const s = situacaoDoCrm(user);
  const out = { id: user.id, email: user.email, name: user.name, crm: exibirCrm(user) };
  if (user.crm_uf) {
    out.crmNumero = user.crm;
    out.crmUf = user.crm_uf;
    out.crmStatus = s.status;
    out.crmLiberado = s.liberado;
    if (s.liberadoAte) out.liberadoAte = s.liberadoAte;
    out.admin = ehAdmin(user);
  }
  return out;
}

/** Resumo legível do navegador, para "Minha conta" e o registro de acesso. */
function resumirAgente(ua) {
  const s = String(ua || '');
  if (!s) return null;
  const nav = /Edg\//.test(s) ? 'Edge' : /OPR\//.test(s) ? 'Opera' : /Firefox\//.test(s) ? 'Firefox'
    : /Chrome\//.test(s) ? 'Chrome' : /Safari\//.test(s) ? 'Safari' : 'Navegador';
  const so = /iPhone|iPad/.test(s) ? 'iPhone ou iPad' : /Android/.test(s) ? 'Android'
    : /Mac OS X/.test(s) ? 'Mac' : /Windows/.test(s) ? 'Windows' : /Linux/.test(s) ? 'Linux' : '';
  return so ? `${nav} no ${so}` : nav;
}

module.exports = {
  SESSION_TTL_MS,
  SESSION_IDLE_MS,
  UFS,
  hashPassword,
  verifyPassword,
  precisaRefazerHash,
  validatePassword,
  issueSession,
  resolveSession,
  revokeSession,
  issueResetToken,
  findResetToken,
  consumeResetToken,
  hashToken,
  esperaDepoisDe,
  esperaDaConta,
  falhaNaConta,
  acertoNaConta,
  dentroDoLimite,
  rateLimit,
  normalizeEmail,
  isValidEmail,
  normalizarCrm,
  normalizarUf,
  definirCookieDeSessao,
  limparCookieDeSessao,
  bearerToken,
  requireAuth,
  requireCrmLiberado,
  requireAdmin,
  situacaoDoCrm,
  ehAdmin,
  publicUser,
  resumirAgente,
  newToken,
};
