require('dotenv').config();

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const express = require('express');
const cors = require('cors');
const multer = require('multer');

const store = require('./store');
const ia = require('./ia');
const auth = require('./auth');
const mailer = require('./email');
const plaud = require('./plaud');
const helmet = require('helmet');

// Formatos de imagem que a leitura automática abre. Qualquer outro é barrado
// antes de gastar chamada, com instrução própria.
const IMAGENS_SUPORTADAS = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
const pdf = require('./pdf');

const app = express();
const IS_PRODUCTION = process.env.NODE_ENV === 'production';

// Modo de acesso.
//   'simples'  -> o médico entra só com nome e CRM. Não depende de domínio
//                 próprio, de provedor de email nem de banco persistente, e é
//                 o modo adequado para a fase de validação clínica.
//   'completo' -> cadastro por email com senha e link de definição (o fluxo
//                 já implementado abaixo), a ser ligado quando houver domínio.
// A sessão é emitida do mesmo jeito nos dois modos, então /api/extract e
// /api/chat continuam protegidos - o modo simples reduz o atrito de entrada,
// não remove a autenticação.
const AUTH_MODE_BRUTO = (process.env.AUTH_MODE || 'simples').trim().toLowerCase();
if (!['simples', 'completo'].includes(AUTH_MODE_BRUTO)) {
  // Cair em silêncio para 'simples' é a falha de configuração mais cara
  // possível: o operador acredita ter ligado email e senha e qualquer pessoa
  // entra com um nome e um CRM qualquer.
  console.error(`ERRO: AUTH_MODE="${process.env.AUTH_MODE}" não é válido. Use "simples" ou "completo".`);
  process.exit(1);
}
const AUTH_MODE = AUTH_MODE_BRUTO;
// Limites de upload calibrados pela RAM real do container (512 MB no plano
// atual). Antes: 10 arquivos x 20 MB = 190 MB por requisição, mantidos em
// memória e depois convertidos para base64 (+33%) — uma única requisição
// derrubava o processo, três garantiam OOM. `fieldSize` fecha a outra porta:
// o padrão do multer é 1 MB de texto, que sozinho custa ~US$ 1,30 por chamada.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 12 * 1024 * 1024,
    files: 3,
    fields: 5,
    fieldSize: 64 * 1024,
  },
});

// Medido num cgroup de 512 MB idêntico ao Render: a amplificação real é de ~8x
// os bytes enviados (buffer + base64 + serialização do SDK). O teto seguro é
// ~57 MB somando TODOS os uploads em voo. Sem contador global, duas
// requisições simultâneas de 57 MB levavam o processo a SIGKILL — e com disco
// efêmero isso desloga todos os médicos.
const TETO_BYTES_EM_VOO = 45 * 1024 * 1024;
const TETO_BYTES_POR_REQUISICAO = 25 * 1024 * 1024;
let bytesEmVoo = 0;

function reservaDeMemoria(req, res, next) {
  const tamanho = Number(req.get('content-length') || 0);

  if (tamanho > TETO_BYTES_POR_REQUISICAO) {
    return res.status(413).json({
      error: 'O material anexado é grande demais. Anexe menos páginas, ou só a parte do laudo que interessa.',
    });
  }
  if (bytesEmVoo + tamanho > TETO_BYTES_EM_VOO) {
    res.set('Retry-After', '20');
    return res.status(503).json({
      error: 'O serviço está lendo outros laudos neste momento. Tente de novo em alguns segundos.',
    });
  }

  bytesEmVoo += tamanho;
  let devolvido = false;
  const devolver = () => {
    if (devolvido) return;
    devolvido = true;
    bytesEmVoo -= tamanho;
  };
  res.on('close', devolver);
  res.on('finish', devolver);
  next();
}

// §86. Quem lê o laudo: Vertex AI em São Paulo (produção) ou API direta
// (desenvolvimento e testes). Configuração errada derruba o boot.
{
  const problemas = ia.problemasDeConfiguracao();
  if (problemas.length) {
    for (const p of problemas) console.error('ERRO: ' + p);
    process.exit(1);
  }
  for (const a of ia.avisos()) console.warn('AVISO: ' + a);
}

// Sem DATABASE_URL o armazenamento é o disco local, que no Render é efêmero:
// some a cada deploy e a cada hibernação por inatividade. Decisão consciente
// para a fase beta — o app precisa rodar sem depender de provisionar banco.
// A UI avisa o médico de que a conta é temporária (ver /api/health -> ephemeral).
if (IS_PRODUCTION && !store.usingPostgres) {
  console.warn('AVISO: rodando sem DATABASE_URL. As contas são temporárias e');
  console.warn('serão perdidas no próximo deploy ou hibernação do serviço.');
}

// O modo completo depende de email para o primeiro acesso e a redefinição de
// senha. Sem provedor, o servidor devolvia o link de redefinição no corpo da
// resposta HTTP — takeover de qualquer conta em três requisições.
if (IS_PRODUCTION && AUTH_MODE === 'completo' && !mailer.isConfigured()) {
  console.error('ERRO: AUTH_MODE=completo exige RESEND_API_KEY em produção.');
  console.error('Sem provedor de email o link de redefinição vazaria na resposta HTTP.');
  process.exit(1);
}

// §85. O login com senha em produção depende de quatro coisas, e faltar
// qualquer uma delas é falha que aparece semanas depois e em silêncio:
//   DATABASE_URL  sem banco, as contas com senha somem a cada publicação;
//   APP_ORIGIN    os links dos e-mails seriam montados a partir de cabeçalho
//                 do cliente (§80);
//   CHAVE_CIFRA   os tokens do Plaud ficariam em texto puro no banco;
//   ADMIN_EMAILS  ninguém conseguiria conferir CRM (só avisa: o site funciona).
if (IS_PRODUCTION && AUTH_MODE === 'completo') {
  const faltando = ['DATABASE_URL', 'APP_ORIGIN', 'CHAVE_CIFRA'].filter((v) => !process.env[v]);
  if (faltando.length) {
    console.error(`ERRO: AUTH_MODE=completo em produção exige ${faltando.join(', ')}.`);
    process.exit(1);
  }
  if (!process.env.ADMIN_EMAILS) {
    console.warn('AVISO: ADMIN_EMAILS vazio. Nenhum CRM novo poderá ser conferido.');
  }
}

// §85. O modo simples deixa entrar qualquer nome com qualquer CRM. Em
// produção ele só sobe se alguém pedir com todas as letras: esquecer a
// variável AUTH_MODE não pode deixar a porta aberta.
if (IS_PRODUCTION && AUTH_MODE === 'simples' && process.env.PERMITIR_MODO_SIMPLES !== 'sim') {
  console.error('ERRO: AUTH_MODE=simples não é permitido em produção.');
  console.error('Use AUTH_MODE=completo, ou defina PERMITIR_MODO_SIMPLES=sim para uma demonstração consciente.');
  process.exit(1);
}


// Render coloca 1 proxy na frente. Se entrar CDN (Cloudflare) vira 2, e o
// req.ip do rate limit passa a ler o valor errado. §86: no Cloud Run o número
// de saltos é conferido depois da publicação (o IP em "Minha conta" tem de ser
// o do médico) e ajustado por TRUST_PROXY, sem mexer no código.
const SALTOS_DE_PROXY = Number.parseInt(process.env.TRUST_PROXY || '1', 10);
app.set('trust proxy', Number.isFinite(SALTOS_DE_PROXY) && SALTOS_DE_PROXY >= 0 ? SALTOS_DE_PROXY : 1);

// O app não carrega NENHUM recurso externo, então CSP estrita não quebra nada.
// Sem ela, um XSS exfiltra para qualquer domínio sem obstáculo.
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      /* §80. `'unsafe-inline'` saiu daqui. Ela existia por SETE LINHAS de
       * registro do service worker que moravam num <script> inline no
       * index.html — e não pelos handlers onclick, que são governados por
       * `scriptSrcAttr`, logo abaixo. A distinção não é acadêmica: enquanto
       * esta diretriz esteve ligada, qualquer HTML que entrasse na página
       * virava script EXECUTÁVEL. Foi o que transformou a injeção pelo
       * cabeçalho Host em execução de código no domínio do médico. As sete
       * linhas foram para /registra-sw.js e a diretriz fechou. */
      scriptSrc: ["'self'"],
      // O helmet põe script-src-attr 'none' por padrão, que bloqueia todo
      // handler inline. A interface tem 44 (onclick, onsubmit, onchange,
      // oninput) e pararia inteira. Concessão consciente e única: o resto da
      // política continua estrita — sem script externo, sem exfiltração
      // (connect-src 'self'), sem enquadramento, sem sequestro de base ou de
      // formulário. Passo seguinte de endurecimento: migrar os 44 para
      // addEventListener e voltar esta diretriz para 'none'.
      scriptSrcAttr: ["'unsafe-inline'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", 'data:', 'blob:'],
      connectSrc: ["'self'"],
      frameAncestors: ["'none'"],
      objectSrc: ["'none'"],
      baseUri: ["'self'"],
      formAction: ["'self'"],
    },
  },
  hsts: { maxAge: 31536000, includeSubDomains: true },
  crossOriginEmbedderPolicy: false,
}));

// O frontend é servido pela mesma origem: CORS aberto não serve a nada e
// permitia mintar sessão a partir de qualquer página.
app.use(cors({ origin: process.env.APP_ORIGIN || false }));
app.use(express.json({ limit: '1mb' }));

// Schema e prompt de extração são GERADOS a partir do registro de tumores
// (public/tumors.js). Adicionar um tumor lá passa a valer aqui automaticamente,
// sem editar o schema à mão — que era a fonte de divergência antiga entre a
// lista de campos do backend e as regras clínicas do frontend.
const TUMORS = require('./public/tumors.js');

const {
  UNIFIED_SCHEMA,
  UNIFIED_SYSTEM_PROMPT,
  schemaDoSubtipo,
  promptDoSubtipo,
  extracaoAbandonada,
  valeSegundaLeitura,
  conflitoDeSitioGinecologico,
} = require('./extracao.js');

/* ============================ AUTENTICAÇÃO ============================ */

// Versão dos Termos de Uso e do Aviso de Privacidade aceitos no cadastro
// (requisito 8 da equipe LGPD). Mudou o texto, muda a versão.
const TERMOS_VERSAO = process.env.TERMOS_VERSAO || '2026-10-20';
const LIBERACAO_PROVISORIA_MS = 48 * 60 * 60 * 1000;   // §85.1, decisão 2

// No modo simples as rotas de email/senha ficam desligadas: deixá-las de pé
// prometeria ao médico um email de recuperação que ninguém enviaria.
function requireFullAuthMode(req, res, next) {
  if (AUTH_MODE !== 'completo') {
    return res.status(404).json({ error: 'Este acesso não está habilitado nesta instalação.' });
  }
  next();
}

// Um aviso com `recuperado: true` diz que deu certo por outro caminho. Usá-lo
// como texto do erro produzia telas de falha escritas "lido normalmente,
// nenhuma ação necessária", com a instrução útil escondida no segundo aviso.
function mensagemDeFalha(avisos) {
  const falhas = (avisos || []).filter((a) => !a.recuperado);
  const principal = falhas[0];
  if (principal) return `${principal.motivo} ${principal.comoResolver}`;
  return 'Não consegui ler o material anexado. Tire uma foto ou print da página do laudo e anexe como imagem.';
}

// Remove caracteres de controle e normaliza espaço. O nome vai impresso no
// documento assinado e para o log do servidor.
function limparNome(valor) {
  return String(valor == null ? '' : valor)
    .replace(/[\p{Cc}\p{Cf}]/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// Formato livre no modo simples porque o CRM brasileiro varia por conselho
// regional (número, UF, com ou sem separador): validar demais barraria médico
// real. O modo completo pede número e UF em campos separados (§85).
function crmValido(crm) {
  return /^[A-Za-z0-9][A-Za-z0-9 .\/-]{2,29}$/.test(crm);
}

// Identidade estável a partir do CRM: o mesmo CRM sempre cai na mesma conta,
// então voltar em outro dia recupera o histórico (quando há banco) em vez de
// criar uma conta nova a cada login.
function crmIdentity(crm) {
  const slug = crm.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  return `crm-${slug}@acesso.oncogenyx`;
}

/* §80. O endereço do próprio serviço, montado a partir do pedido quando não
 * há APP_ORIGIN configurado.
 *
 * `host` e `x-forwarded-proto` são CABEÇALHOS DO CLIENTE. Quem fala com o
 * processo escolhe o valor deles. Este valor é interpolado dentro de
 * atributos HTML da página entregue (canonical, og:url, og:image) e dentro do
 * link de redefinição de senha, ou seja, dois lugares onde um valor
 * escolhido por terceiro é desastre:
 *
 *   Host: x"><script>...</script><b a="   -> script executado no domínio do médico
 *   X-Forwarded-Proto: javascript        -> href javascript:
 *   Host: servidor-do-atacante           -> token de senha entregue ao atacante
 *
 * Então: formato validado, e o que não casar é descartado em vez de
 * remendado. Host inválido cai para caminho relativo (string vazia), que
 * produz href="/", correto e inofensivo. Protocolo inválido vira https.
 *
 * Isto não substitui definir APP_ORIGIN em produção, que continua sendo o
 * certo (e é exigido no boot do modo completo); é a rede para quando ela não
 * estiver lá. */
const HOST_VALIDO = /^[A-Za-z0-9](?:[A-Za-z0-9.-]{0,252}[A-Za-z0-9])?(?::\d{1,5})?$/;

function appOrigin(req) {
  if (process.env.APP_ORIGIN) return process.env.APP_ORIGIN.replace(/\/$/, '');
  const protoBruto = String(req.get('x-forwarded-proto') || req.protocol || '')
    .split(',')[0].trim().toLowerCase();
  const proto = (protoBruto === 'http' || protoBruto === 'https') ? protoBruto : 'https';
  const host = String(req.get('host') || '').trim();
  if (!HOST_VALIDO.test(host)) return '';
  return `${proto}://${host}`;
}

/* §85. Pedido que altera estado vindo de outra origem é recusado.
 *
 * O cookie de sessão é SameSite=Strict, que já não acompanha pedido nascido
 * em outro site. Esta conferência é a segunda tranca: navegador moderno manda
 * `Origin` em todo POST, e se ele não for o do próprio OncoGenYX o pedido não
 * passa. Sem `Origin` (scripts de operação, testes) segue, porque nesse caso
 * não há navegador de vítima carregando cookie. */
function origemConfere(req, res, next) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  const origem = req.get('origin');
  if (!origem) return next();
  if (process.env.APP_ORIGIN && origem === appOrigin(req)) return next();
  try {
    if (!process.env.APP_ORIGIN && new URL(origem).host === req.get('host')) return next();
  } catch { /* Origin malformado cai na recusa abaixo */ }
  return res.status(403).json({ error: 'Pedido recusado: ele não partiu da página do OncoGenYX.' });
}
app.use('/api', origemConfere);

// "::ffff:" é o prefixo que o Node põe em IPv4 recebido por socket IPv6. No
// registro de acesso e em "Minha conta" fica só o endereço que o médico
// reconhece.
const ipDe = (req) => (req.ip ? String(req.ip).replace(/^::ffff:/, '') : null);
const contexto = (req) => ({ ip: ipDe(req), agente: auth.resumirAgente(req.get('user-agent')) });

async function evento(req, tipo, userId, detalhe) {
  const { ip, agente } = contexto(req);
  await store.registrarEvento({ userId: userId || null, tipo, ip, agente, detalhe: detalhe || null });
}

async function entrar(req, res, user, via) {
  await store.touchLogin(user.id);
  const token = await auth.issueSession(user.id, contexto(req));
  auth.definirCookieDeSessao(req, res, token);
  await evento(req, 'login_ok', user.id, via ? { via } : null);
  // O token vai SÓ no cookie HttpOnly. Antes ele vinha também no corpo e a
  // página o guardava em localStorage, ao alcance de qualquer script injetado
  // (§85, defeito D5).
  res.json({ ok: true, user: auth.publicUser(user) });
}

// E-mail que não segura a resposta: o tempo de resposta não pode denunciar se
// a conta existe, e uma falha do provedor fica no log em vez de virar erro
// para quem só pediu um link.
function enviarDepois(promessa, oQue) {
  Promise.resolve(promessa).catch((e) => console.error(`Falha ao enviar e-mail (${oQue}):`, e.message));
}

function emailsDosAdmins() {
  return String(process.env.ADMIN_EMAILS || '').split(',').map((e) => e.trim().toLowerCase()).filter(Boolean);
}

function avisarAdmins(req, medico) {
  const lista = emailsDosAdmins();
  if (!lista.length) return;
  enviarDepois(mailer.sendNovoCadastroAdmin({ to: lista, medico, origem: appOrigin(req) }), 'aviso ao administrador');
}

// Link de desenvolvimento: sem provedor de e-mail, devolve o link na resposta
// para o fluxo não travar na máquina do dev. Em produção não sai nunca: além
// de entregar o token a quem pedir, só aparece quando a conta existe, virando
// oráculo de enumeração de cadastro (e o boot já exige RESEND_API_KEY).
function linkDeDev(url) {
  return (!mailer.isConfigured() && !IS_PRODUCTION) ? url : undefined;
}

function mascararEmail(email) {
  const [local, dominio] = String(email).split('@');
  if (!dominio) return '';
  return `${local.slice(0, 2)}${'•'.repeat(Math.max(1, Math.min(6, local.length - 2)))}@${dominio}`;
}

/* ---------- modo simples (§17): nome + CRM ---------- */

app.post('/api/auth/acesso', async (req, res, next) => {
  try {
    if (AUTH_MODE !== 'simples') {
      return res.status(404).json({ error: 'Este acesso não está habilitado nesta instalação.' });
    }

    const name = limparNome(req.body.name);
    const crm = String(req.body.crm || '').trim().replace(/\s+/g, ' ');

    if (name.length < 3) return res.status(400).json({ error: 'Informe seu nome completo.' });
    if (name.length > 120) return res.status(400).json({ error: 'Nome longo demais.' });
    if (!crmValido(crm)) {
      return res.status(400).json({ error: 'Informe um CRM válido (números e, se quiser, a UF).' });
    }

    // Limitar por IP bloqueia um hospital inteiro atrás de NAT: a partir do 21º
    // médico em 15 min, os seguintes veem "muitas tentativas" no primeiro
    // acesso. O limite útil aqui é por CRM (identificação, não senha); o IP
    // fica com um teto folgado, só contra automação.
    const porCrm = auth.rateLimit(`acesso-crm:${crm.toLowerCase()}`, { max: 10, windowMs: 15 * 60 * 1000 });
    const porIp = auth.rateLimit(`acesso-ip:${req.ip}`, { max: 200, windowMs: 15 * 60 * 1000 });
    if (!porCrm.allowed || !porIp.allowed) {
      return res.status(429).json({ error: 'Muitas tentativas de acesso. Aguarde alguns minutos.' });
    }

    const email = crmIdentity(crm);
    let user = await store.findUserByEmail(email);
    if (!user) {
      user = await store.createUser({ id: crypto.randomUUID(), email, name, crm });
    } else if (user.name !== name) {
      // O nome vai impresso na solicitação assinada: vale sempre o que o
      // médico acabou de digitar, não o que ficou salvo de uma sessão antiga.
      await store.updateUserProfile(user.id, { name, crm });
      user = { ...user, name, crm };
    }

    await entrar(req, res, user, 'simples');
  } catch (err) {
    next(err);
  }
});

/* ---------- modo completo (§85): cadastro, confirmação, entrada ---------- */

const MSG_FALHA_LOGIN = 'CRM, estado ou senha incorretos.';

// Comparação de senha com custo constante: quando o CRM não tem conta, roda
// um scrypt de mentira para a resposta demorar o mesmo que uma senha errada.
let hashDeMentira = null;
async function custoConstante(password) {
  if (!hashDeMentira) hashDeMentira = await auth.hashPassword(crypto.randomBytes(12).toString('hex') + 'A!');
  await auth.verifyPassword(password, hashDeMentira);
}

function minutos(ms) {
  const m = Math.ceil(ms / 60000);
  return m <= 1 ? '1 minuto' : `${m} minutos`;
}

function lerCadastro(body) {
  return {
    name: limparNome(body.name),
    crm: auth.normalizarCrm(body.crm),
    uf: auth.normalizarUf(body.uf),
    email: auth.normalizeEmail(body.email),
    password: typeof body.password === 'string' ? body.password : '',
  };
}

app.post('/api/auth/cadastro', requireFullAuthMode, async (req, res, next) => {
  try {
    const d = lerCadastro(req.body || {});
    if (d.name.length < 3) return res.status(400).json({ error: 'Informe seu nome completo.' });
    if (d.name.length > 120) return res.status(400).json({ error: 'Nome longo demais.' });
    if (!d.crm) return res.status(400).json({ error: 'Informe o número do CRM (só os números).' });
    if (!d.uf) return res.status(400).json({ error: 'Escolha o estado do seu CRM.' });
    if (!auth.isValidEmail(d.email)) return res.status(400).json({ error: 'Informe um e-mail válido.' });
    if (req.body.aceite !== true) {
      return res.status(400).json({ error: 'Para criar a conta, é preciso aceitar os Termos de Uso e o Aviso de Privacidade.' });
    }
    // §86. O serviço de e-mail (Resend) guarda nome e e-mail nos EUA. Sem
    // cláusula da ANPD com ele, a base para essa transferência é o
    // consentimento específico e em destaque do médico (LGPD art. 33, VIII),
    // numa caixa separada do aceite dos termos.
    if (req.body.consentimentoEmail !== true) {
      return res.status(400).json({ error: 'Para criar a conta, é preciso autorizar o envio do seu nome e e-mail ao serviço que manda os e-mails da conta.' });
    }
    const invalida = auth.validatePassword(d.password, { nome: d.name, email: d.email, crm: d.crm });
    if (invalida) return res.status(400).json({ error: invalida });

    const limite = await auth.dentroDoLimite(`cadastro-ip:${req.ip}`, { max: 10, janelaMs: 60 * 60 * 1000 });
    if (!limite.permitido) {
      return res.status(429).json({ error: 'Muitos cadastros feitos a partir desta rede. Tente de novo em uma hora.' });
    }

    // Resposta idêntica exista ou não a conta: a tela de cadastro não pode
    // virar um jeito de descobrir quem usa a plataforma. Quem já tem conta
    // recebe um e-mail avisando da tentativa.
    const neutra = {
      ok: true,
      email: d.email,
      message: `Enviamos um link de confirmação para ${d.email}. Abra o e-mail e toque em "Confirmar meu e-mail" para entrar.`,
    };
    const origem = appOrigin(req);

    const porEmail = await store.findUserByEmail(d.email);
    if (porEmail) {
      enviarDepois(mailer.sendCadastroRepetido({ to: porEmail.email, name: porEmail.name, origem, motivo: 'email' }), 'cadastro repetido');
      await evento(req, 'cadastro_repetido', porEmail.id, { motivo: 'email' });
      return res.json(neutra);
    }
    const porCrm = await store.findUserByCrm(d.crm, d.uf);
    if (porCrm) {
      enviarDepois(mailer.sendCadastroRepetido({ to: porCrm.email, name: porCrm.name, origem, motivo: 'crm' }), 'cadastro repetido');
      await evento(req, 'cadastro_repetido', porCrm.id, { motivo: 'crm' });
      return res.json(neutra);
    }

    const user = await store.createAccount({
      id: crypto.randomUUID(),
      email: d.email,
      name: d.name,
      crm: d.crm,
      crm_uf: d.uf,
      password_hash: await auth.hashPassword(d.password),
      liberado_ate: new Date(Date.now() + LIBERACAO_PROVISORIA_MS),
      termos_versao: TERMOS_VERSAO,
    });
    // null = outra requisição criou a mesma conta entre a busca e a inserção.
    if (!user) return res.json(neutra);

    await evento(req, 'cadastro', user.id, { termos: TERMOS_VERSAO });
    const token = await auth.issueResetToken(user.id, 'confirmar_email');
    const url = `${origem}/?confirmar-email=${token}`;
    enviarDepois(mailer.sendConfirmacao({ to: user.email, name: user.name, url, origem }), 'confirmação');
    res.json({ ...neutra, devUrl: linkDeDev(url) });
  } catch (err) {
    next(err);
  }
});

app.post('/api/auth/reenviar-confirmacao', requireFullAuthMode, async (req, res, next) => {
  try {
    const email = auth.normalizeEmail(req.body.email);
    if (!auth.isValidEmail(email)) return res.status(400).json({ error: 'Informe um e-mail válido.' });
    const neutra = { ok: true, message: `Se houver uma conta aguardando confirmação em ${email}, um link novo chega em instantes.` };

    const porEmail = await auth.dentroDoLimite(`reenvio:${email}`, { max: 5, janelaMs: 60 * 60 * 1000 });
    const porIp = await auth.dentroDoLimite(`reenvio-ip:${req.ip}`, { max: 30, janelaMs: 60 * 60 * 1000 });
    if (!porEmail.permitido || !porIp.permitido) {
      return res.status(429).json({ error: 'Muitos pedidos de reenvio. Aguarde alguns minutos e confira também a caixa de spam.' });
    }

    const user = await store.findUserByEmail(email);
    if (!user || !user.crm_uf || user.email_verificado_em) return res.json(neutra);
    const token = await auth.issueResetToken(user.id, 'confirmar_email');
    const origem = appOrigin(req);
    const url = `${origem}/?confirmar-email=${token}`;
    enviarDepois(mailer.sendConfirmacao({ to: user.email, name: user.name, url, origem }), 'confirmação');
    res.json({ ...neutra, devUrl: linkDeDev(url) });
  } catch (err) {
    next(err);
  }
});

app.post('/api/auth/confirmar-email', requireFullAuthMode, async (req, res, next) => {
  try {
    const reset = await auth.consumeResetToken(req.body.token, 'confirmar_email');
    if (!reset) {
      return res.status(400).json({
        error: 'Este link de confirmação expirou ou já foi usado. Entre com CRM e senha: se o e-mail ainda não estiver confirmado, mostramos como pedir um link novo.',
      });
    }
    let user = await store.findUserById(reset.user_id);
    if (!user) return res.status(400).json({ error: 'Conta não encontrada.' });
    if (!user.email_verificado_em) {
      const agora = new Date();
      await store.updateUser(user.id, { email_verificado_em: agora });
      user = { ...user, email_verificado_em: agora.toISOString() };
      await evento(req, 'email_confirmado', user.id);
      if (user.crm_status === 'pendente') avisarAdmins(req, user);
    }
    await entrar(req, res, user, 'confirmacao');
  } catch (err) {
    next(err);
  }
});

app.post('/api/auth/login', requireFullAuthMode, async (req, res, next) => {
  try {
    const crm = auth.normalizarCrm(req.body.crm);
    const uf = auth.normalizarUf(req.body.uf);
    const password = typeof req.body.password === 'string' ? req.body.password : '';
    if (!crm || !uf || !password) return res.status(400).json({ error: 'Informe o CRM, o estado e a senha.' });

    // Teto folgado por IP, só contra automação: um hospital inteiro sai pelo
    // mesmo endereço e não pode ser barrado por um colega distraído.
    const porIp = await auth.dentroDoLimite(`login-ip:${req.ip}`, { max: 100, janelaMs: 15 * 60 * 1000 });
    if (!porIp.permitido) {
      return res.status(429).json({ error: 'Muitas tentativas de entrada a partir desta rede. Aguarde 15 minutos.' });
    }

    // Contador por CONTA (CRM+UF), não por IP+e-mail: antes, quem trocava de
    // IP tentava senhas sem limite contra o mesmo médico (§85, defeito D3).
    // A chave existe para CRM sem conta também, então a espera não denuncia
    // quem tem cadastro.
    const chave = `login:${crm}/${uf}`;
    const espera = await auth.esperaDaConta(chave);
    if (espera > 0) {
      return res.status(429).json({ error: `Muitas tentativas com senha errada. Aguarde ${minutos(espera)} e tente de novo, ou use "Esqueci minha senha".` });
    }

    const user = await store.findUserByCrm(crm, uf);
    let certa = false;
    if (user && user.password_hash) certa = await auth.verifyPassword(password, user.password_hash);
    else await custoConstante(password);

    if (!certa) {
      const f = await auth.falhaNaConta(chave);
      await evento(req, 'login_falha', user ? user.id : null, user ? null : { conta: 'inexistente' });
      if (f.desativar && user && user.password_hash) {
        // Na 50ª falha seguida a senha é desativada e só volta por "esqueci a
        // senha". Nunca uma trava definitiva da conta: senão qualquer um
        // tranca um médico de propósito digitando senha errada.
        await store.setUserPassword(user.id, null);
        await store.deleteSessionsByUser(user.id);
        await evento(req, 'senha_desativada', user.id);
        enviarDepois(mailer.sendSenhaDesativada({ to: user.email, name: user.name, origem: appOrigin(req) }), 'senha desativada');
      }
      const proxima = auth.esperaDepoisDe(f.falhas);
      const aviso = proxima > 0 ? ` Por segurança, aguarde ${minutos(proxima)} antes de tentar de novo.` : '';
      return res.status(401).json({ error: MSG_FALHA_LOGIN + aviso });
    }

    if (!user.email_verificado_em) {
      // Só chega aqui quem acertou a senha: dizer que falta confirmar o
      // e-mail não revela nada a terceiros.
      return res.status(403).json({
        error: 'Falta confirmar o seu e-mail. Abra a mensagem que enviamos no cadastro e toque em "Confirmar meu e-mail".',
        codigo: 'email_nao_confirmado',
        email: user.email,
        emailMascarado: mascararEmail(user.email),
      });
    }

    await auth.acertoNaConta(chave);
    if (auth.precisaRefazerHash(user.password_hash)) {
      await store.setUserPassword(user.id, await auth.hashPassword(password));
    }
    await entrar(req, res, user, 'senha');
  } catch (err) {
    next(err);
  }
});

// Resposta deliberadamente idêntica exista ou não a conta: a tela não pode
// virar um oráculo que confirma "este médico usa a plataforma".
const NEUTRAL_RESET_RESPONSE = {
  ok: true,
  message: 'Se este e-mail estiver cadastrado, você receberá em instantes um link para criar uma nova senha. Ele vale por 30 minutos.',
};

app.post('/api/auth/esqueci', requireFullAuthMode, async (req, res, next) => {
  try {
    const email = auth.normalizeEmail(req.body.email);
    if (!auth.isValidEmail(email)) return res.status(400).json({ error: 'Informe um e-mail válido.' });

    const porEmail = await auth.dentroDoLimite(`esqueci:${email}`, { max: 5, janelaMs: 60 * 60 * 1000 });
    const porIp = await auth.dentroDoLimite(`esqueci-ip:${req.ip}`, { max: 30, janelaMs: 60 * 60 * 1000 });
    if (!porEmail.permitido || !porIp.permitido) {
      return res.status(429).json({ error: 'Muitos pedidos para este e-mail. Aguarde alguns minutos e confira também a caixa de spam.' });
    }

    const user = await store.findUserByEmail(email);
    if (!user || !user.crm_uf) return res.json(NEUTRAL_RESET_RESPONSE);

    const token = await auth.issueResetToken(user.id, 'redefinir_senha');
    const origem = appOrigin(req);
    const url = `${origem}/?nova-senha=${token}`;
    enviarDepois(mailer.sendRedefinicao({ to: user.email, name: user.name, url, origem }), 'redefinição');
    res.json({ ...NEUTRAL_RESET_RESPONSE, devUrl: linkDeDev(url) });
  } catch (err) {
    next(err);
  }
});

async function trocarSenha(req, user, novaSenha, tipoEvento) {
  await store.setUserPassword(user.id, await auth.hashPassword(novaSenha));
  // Quem troca a senha em geral o faz porque perdeu o acesso ou suspeita de
  // invasão. Sem revogar as sessões antigas, o invasor continua logado
  // depois da troca: a tela diz que a conta foi protegida e ela não foi.
  await store.deleteSessionsByUser(user.id);
  await auth.acertoNaConta(`login:${user.crm}/${user.crm_uf}`);
  await evento(req, tipoEvento, user.id);
  enviarDepois(mailer.sendSenhaAlterada({ to: user.email, name: user.name, origem: appOrigin(req) }), 'senha alterada');
}

app.post('/api/auth/nova-senha', requireFullAuthMode, async (req, res, next) => {
  try {
    const token = String(req.body.token || '');
    const password = typeof req.body.password === 'string' ? req.body.password : '';
    const expirado = { error: 'Este link expirou ou já foi usado. Peça um novo em "Esqueci minha senha".' };

    // Lê o link SEM gastar, valida a senha com o nome e o CRM do dono da
    // conta, e só então gasta: digitar uma senha fraca não queima o link.
    const pendente = await auth.findResetToken(token, 'redefinir_senha');
    if (!pendente) return res.status(400).json(expirado);
    let user = await store.findUserById(pendente.user_id);
    if (!user) return res.status(400).json(expirado);

    const invalida = auth.validatePassword(password, { nome: user.name, email: user.email, crm: user.crm });
    if (invalida) return res.status(400).json({ error: invalida });

    const reset = await auth.consumeResetToken(token, 'redefinir_senha');
    if (!reset) return res.status(400).json(expirado);

    await trocarSenha(req, user, password, 'senha_redefinida');
    // Abrir o link do e-mail prova que o e-mail é dele.
    if (!user.email_verificado_em) {
      const agora = new Date();
      await store.updateUser(user.id, { email_verificado_em: agora });
      user = { ...user, email_verificado_em: agora.toISOString() };
    }
    await entrar(req, res, user, 'nova_senha');
  } catch (err) {
    next(err);
  }
});

app.post('/api/auth/trocar-senha', requireFullAuthMode, auth.requireAuth(), async (req, res, next) => {
  try {
    const atual = typeof req.body.atual === 'string' ? req.body.atual : '';
    const nova = typeof req.body.nova === 'string' ? req.body.nova : '';
    const user = req.user;

    const chave = `login:${user.crm}/${user.crm_uf}`;
    const espera = await auth.esperaDaConta(chave);
    if (espera > 0) return res.status(429).json({ error: `Muitas tentativas com senha errada. Aguarde ${minutos(espera)}.` });
    if (!user.password_hash || !(await auth.verifyPassword(atual, user.password_hash))) {
      await auth.falhaNaConta(chave);
      return res.status(400).json({ error: 'A senha atual não confere.' });
    }
    const invalida = auth.validatePassword(nova, { nome: user.name, email: user.email, crm: user.crm });
    if (invalida) return res.status(400).json({ error: invalida });

    await trocarSenha(req, user, nova, 'senha_trocada');
    await entrar(req, res, user, 'troca_de_senha');
  } catch (err) {
    next(err);
  }
});

app.post('/api/auth/logout', async (req, res, next) => {
  try {
    const token = auth.bearerToken(req);
    const user = token ? await auth.resolveSession(token) : null;
    await auth.revokeSession(token);
    auth.limparCookieDeSessao(req, res);
    if (user) await evento(req, 'logout', user.id);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

app.post('/api/auth/sair-de-todos', auth.requireAuth(), async (req, res, next) => {
  try {
    await store.deleteSessionsByUser(req.user.id);
    auth.limparCookieDeSessao(req, res);
    await evento(req, 'sessoes_encerradas', req.user.id);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

app.get('/api/auth/me', auth.requireAuth(), (req, res) => {
  res.json({ user: auth.publicUser(req.user) });
});

/* ---------- Minha conta (direitos do titular, LGPD art. 18) ---------- */

app.get('/api/auth/conta', auth.requireAuth(), async (req, res, next) => {
  try {
    const sessoes = await store.listarSessoes(req.user.id);
    const acessos = await store.listarEventos(req.user.id, 15);
    res.json({
      user: auth.publicUser(req.user),
      criadaEm: req.user.created_at,
      sessoes: sessoes.map((s) => ({
        atual: s.token_hash === req.user._sessao,
        criadaEm: s.created_at,
        ultimoUso: s.ultimo_uso_em,
        agente: s.agente,
      })),
      acessos: acessos.map((e) => ({ tipo: e.tipo, em: e.criado_em, ip: e.ip, agente: e.agente })),
    });
  } catch (err) {
    next(err);
  }
});

app.get('/api/auth/meus-dados', auth.requireAuth(), async (req, res, next) => {
  try {
    const u = req.user;
    const sessoes = await store.listarSessoes(u.id);
    const eventos = await store.listarEventos(u.id, 1000);
    const plaudConectado = Boolean(await store.getPlaudTokens(u.id).catch(() => null));
    const dados = {
      geradoEm: new Date().toISOString(),
      aviso: 'Dados da sua conta no OncoGenYX. Nenhum caso de paciente é guardado pela plataforma, por isso nenhum aparece aqui.',
      conta: {
        nome: u.name,
        email: u.email,
        crm: u.crm,
        uf: u.crm_uf || null,
        situacaoDoCrm: u.crm_status || null,
        crmConferidoEm: u.crm_conferido_em || null,
        emailConfirmadoEm: u.email_verificado_em || null,
        termosAceitos: u.termos_versao ? { versao: u.termos_versao, em: u.termos_aceitos_em } : null,
        consentimentoEnvioDeEmailEm: u.consentimento_email_em || null,
        criadaEm: u.created_at,
        ultimaEntrada: u.last_login_at,
      },
      plaudConectado,
      sessoesAbertas: sessoes.map((s) => ({ criadaEm: s.created_at, ultimoUso: s.ultimo_uso_em, ip: s.ip, aparelho: s.agente })),
      registroDeAcessos: eventos.map((e) => ({ tipo: e.tipo, em: e.criado_em, ip: e.ip, aparelho: e.agente })),
    };
    res.set('Content-Disposition', 'attachment; filename="meus-dados-oncogenyx.json"');
    res.set('Cache-Control', 'no-store');
    res.type('application/json').send(JSON.stringify(dados, null, 2));
  } catch (err) {
    next(err);
  }
});

app.patch('/api/auth/me', auth.requireAuth(), async (req, res, next) => {
  try {
    // Mesma validação do acesso: este nome vai impresso na solicitação de exame
    // que o médico assina. Sem teto, 5000 caracteres quebram o layout do
    // documento; sem limpeza, sequências de controle sujam o log do servidor.
    const name = limparNome(req.body.name);
    if (name.length < 3) return res.status(400).json({ error: 'Informe seu nome completo.' });
    if (name.length > 120) return res.status(400).json({ error: 'Nome longo demais.' });

    if (!req.user.crm_uf) {
      const crm = String(req.body.crm || '').trim().replace(/\s+/g, ' ');
      if (!crmValido(crm)) return res.status(400).json({ error: 'Informe um CRM válido (números e, se quiser, a UF).' });
      await store.updateUserProfile(req.user.id, { name, crm });
      return res.json({ ok: true, user: { ...auth.publicUser(req.user), name, crm } });
    }

    // Conta conferida que muda nome ou CRM volta para a conferência: foi o
    // par nome+CRM que o administrador conferiu no CFM, e é ele que sai
    // impresso no documento. A liberação provisória recomeça só para quem já
    // tinha sido conferido; conta pendente ou recusada não ganha prazo novo
    // trocando o nome.
    const crm = req.body.crm === undefined ? req.user.crm : auth.normalizarCrm(req.body.crm);
    const uf = req.body.uf === undefined ? req.user.crm_uf : auth.normalizarUf(req.body.uf);
    if (!crm) return res.status(400).json({ error: 'Informe o número do CRM (só os números).' });
    if (!uf) return res.status(400).json({ error: 'Escolha o estado do seu CRM.' });

    const mudouCrm = crm !== req.user.crm || uf !== req.user.crm_uf;
    const mudouNome = name !== req.user.name;
    if (!mudouCrm && !mudouNome) return res.json({ ok: true, user: auth.publicUser(req.user) });

    if (mudouCrm) {
      const outro = await store.findUserByCrm(crm, uf);
      if (outro && outro.id !== req.user.id) {
        return res.status(409).json({ error: 'Este CRM já está ligado a outra conta. Se ele é seu, fale com o suporte do OncoGenYX.' });
      }
    }

    const campos = { name, crm, crm_uf: uf };
    if (req.user.crm_status !== 'pendente') {
      campos.crm_status = 'pendente';
      campos.crm_conferido_em = null;
      campos.crm_conferido_por = null;
      if (req.user.crm_status === 'ativo') campos.liberado_ate = new Date(Date.now() + LIBERACAO_PROVISORIA_MS);
    }
    await store.updateUser(req.user.id, campos);
    await evento(req, 'perfil_alterado', req.user.id, { campos: [mudouNome && 'nome', mudouCrm && 'crm'].filter(Boolean) });
    const atualizado = await store.findUserById(req.user.id);
    if (atualizado.email_verificado_em) avisarAdmins(req, atualizado);
    res.json({ ok: true, user: auth.publicUser(atualizado) });
  } catch (err) {
    next(err);
  }
});

app.delete('/api/auth/conta', auth.requireAuth(), async (req, res, next) => {
  try {
    const u = req.user;
    if (u.crm_uf) {
      const senha = typeof req.body.password === 'string' ? req.body.password : '';
      if (!u.password_hash || !(await auth.verifyPassword(senha, u.password_hash))) {
        return res.status(400).json({ error: 'A senha não confere. Para excluir a conta, digite a sua senha atual.' });
      }
    }
    // O registro de acesso fica pelos 6 meses que o Marco Civil exige, com o
    // CRM anotado: é o único jeito de ele continuar servindo para o fim legal
    // depois que a conta deixa de existir (LGPD art. 16, I).
    await evento(req, 'conta_excluida', u.id, { crm: u.crm, uf: u.crm_uf || null });
    await store.deleteUser(u.id);
    if (u.crm_uf) await auth.acertoNaConta(`login:${u.crm}/${u.crm_uf}`);
    auth.limparCookieDeSessao(req, res);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

/* ---------- conferência de CRM pelo administrador (§85.1, decisão 1) ---------- */

function contaParaAdmin(u) {
  return {
    id: u.id,
    name: u.name,
    crm: u.crm,
    uf: u.crm_uf,
    email: u.email,
    status: u.crm_status,
    criadaEm: u.created_at,
    liberadoAte: u.liberado_ate,
    conferidoEm: u.crm_conferido_em,
  };
}

app.get('/api/admin/conferencias', auth.requireAuth(), auth.requireAdmin(), async (req, res, next) => {
  try {
    const { pendentes, decididas } = await store.listarContasParaConferencia();
    res.set('Cache-Control', 'no-store');
    res.json({ pendentes: pendentes.map(contaParaAdmin), decididas: decididas.map(contaParaAdmin) });
  } catch (err) {
    next(err);
  }
});

app.post('/api/admin/conferencias/:id', auth.requireAuth(), auth.requireAdmin(), async (req, res, next) => {
  try {
    const decisao = req.body.decisao;
    if (!['ativo', 'recusado'].includes(decisao)) return res.status(400).json({ error: 'Decisão inválida.' });
    const alvo = await store.findUserById(String(req.params.id));
    if (!alvo || !alvo.crm_uf) return res.status(404).json({ error: 'Conta não encontrada.' });

    await store.updateUser(alvo.id, { crm_status: decisao, crm_conferido_em: new Date(), crm_conferido_por: req.user.id });
    await evento(req, decisao === 'ativo' ? 'crm_conferido' : 'crm_recusado', alvo.id, { por: req.user.id });
    await evento(req, 'admin_acao', req.user.id, { alvo: alvo.id, decisao });
    const origem = appOrigin(req);
    const envio = decisao === 'ativo'
      ? mailer.sendCrmLiberado({ to: alvo.email, name: alvo.name, origem })
      : mailer.sendCrmRecusado({ to: alvo.email, name: alvo.name, origem });
    enviarDepois(envio, 'resultado da conferência');
    res.json({ ok: true, conta: contaParaAdmin(await store.findUserById(alvo.id)) });
  } catch (err) {
    next(err);
  }
});

/* =============================== PLAUD =============================== */

// state assinado: amarra o callback ao médico que iniciou a conexão, sem
// precisar de sessão em cookie no retorno do provedor.
const PLAUD_STATE_SECRET = process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex');

function signState(userId) {
  const payload = `${userId}.${Date.now()}`;
  const sig = crypto.createHmac('sha256', PLAUD_STATE_SECRET).update(payload).digest('base64url');
  return `${Buffer.from(payload).toString('base64url')}.${sig}`;
}

function verifyState(state) {
  const [encoded, sig] = String(state || '').split('.');
  if (!encoded || !sig) return null;
  const payload = Buffer.from(encoded, 'base64url').toString('utf8');
  const expected = crypto.createHmac('sha256', PLAUD_STATE_SECRET).update(payload).digest('base64url');
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  const [userId, issuedAt] = payload.split('.');
  if (Date.now() - Number(issuedAt) > 10 * 60 * 1000) return null;
  return userId;
}

app.get('/api/plaud/status', auth.requireAuth(), async (req, res, next) => {
  try {
    const configured = plaud.isConfigured();
    const tokens = configured ? await store.getPlaudTokens(req.user.id) : null;
    res.json({ configured, connected: Boolean(tokens) });
  } catch (err) {
    next(err);
  }
});

app.get('/api/plaud/connect', auth.requireAuth(), (req, res) => {
  if (!plaud.isConfigured()) {
    return res.status(503).json({
      error: 'A integração com o Plaud ainda não foi liberada para esta instalação.',
    });
  }
  res.json({ url: plaud.authorizeUrl({ req, state: signState(req.user.id) }) });
});

// Callback do OAuth: o provedor redireciona o navegador para cá, então a
// resposta é um redirect para a home com o resultado na query string.
app.get('/api/plaud/callback', async (req, res) => {
  const back = (status) => res.redirect(`/?plaud=${status}`);
  try {
    if (req.query.error) return back('negado');
    const userId = verifyState(req.query.state);
    if (!userId) return back('estado-invalido');
    if (!req.query.code) return back('sem-codigo');

    const tokens = await plaud.exchangeCode({ req, code: String(req.query.code) });
    await store.savePlaudTokens(userId, tokens);
    await evento(req, 'plaud_conectado', userId);
    back('conectado');
  } catch (err) {
    console.error('Erro no callback do Plaud:', err);
    back('falha');
  }
});

app.post('/api/plaud/disconnect', auth.requireAuth(), async (req, res, next) => {
  try {
    await store.deletePlaudTokens(req.user.id);
    await evento(req, 'plaud_desconectado', req.user.id);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

app.get('/api/plaud/recordings', auth.requireAuth(), async (req, res, next) => {
  try {
    res.json({ recordings: await plaud.listRecordings(req.user.id) });
  } catch (err) {
    if (err.code === 'PLAUD_REAUTH') return res.status(409).json({ error: err.message, reauth: true });
    next(err);
  }
});

app.get('/api/plaud/transcript/:id', auth.requireAuth(), async (req, res, next) => {
  try {
    res.json({ text: await plaud.fetchTranscript(req.user.id, req.params.id) });
  } catch (err) {
    if (err.code === 'PLAUD_REAUTH') return res.status(409).json({ error: err.message, reauth: true });
    next(err);
  }
});

/* =============================== GENA =============================== */

const GENA_SYSTEM_PROMPT = `Você é a Gena. Trabalha no OncoGenYX ajudando oncologistas, urologistas e cirurgiões brasileiros a reunir um caso para triagem de teste genético.

=== QUEM VOCÊ É ===

Você conversa como uma colega experiente, não como um formulário. Isso significa:

- Fala como gente fala: frases naturais, contrações, português do dia a dia de consultório. Nada de "Por gentileza, informe o estadiamento FIGO".
- Demonstra que ENTENDEU o caso, não só que registrou o dado. Se o médico diz "PSA 225 com metástase óssea difusa", você reconhece o quadro ("Pesado esse."), não devolve "PSA registrado".
- Raciocina em voz alta quando ajuda: "Se ele já vem progredindo em enzalutamida, isso já é resistente à castração — vou considerar assim."
- Tem opinião sobre o que importa e o que não importa. Se um dado não muda o resultado, você diz que não precisa em vez de pedir.
- É breve porque respeita o tempo de quem está entre consultas, não porque é limitada. Uma a três frases. Uma pergunta por vez, e só a pergunta que de fato muda a resposta.
- Nunca usa lista com marcadores, nunca numera perguntas, nunca usa emoji.

=== COMO VOCÊ CONDUZ ===

Primeiro descubra de que tumor se trata, pelo que a pessoa descrever. Se não der para saber ainda, pergunte — de forma direta, sem rodeio.

O que de fato decide cada caso:
${TUMORS.list().map((t) => `- ${t.label}: o que decide é ${t.fields.filter((f) => f.decisivo).map((f) => f.label).join(' e ') || 'o quadro clínico'}. ${t.hint}`).join('\n')}

Regras de condução:

- INFIRA em vez de perguntar. "Metástase hepática" já responde a extensão da doença. "RE e RP negativos, HER2 negativo" já é triplo-negativo. "Progressão em abiraterona" já é resistente à castração. Perguntar o que a pessoa acabou de dizer com outras palavras é o erro que mais faz uma conversa parecer robô.
- Se vierem vários dados de uma vez, reconheça o conjunto numa frase e pergunte só o que falta.
- Aceite qualquer grafia e normalize por dentro: "3C" é IIIC, "estágio 4" é IV, "G3" é alto grau, "CA de ovário" é carcinoma de ovário, "86a" é 86 anos.
- Quando faltar um dado que muda o resultado, explique em poucas palavras POR QUE ele importa. "O grau muda a indicação do teste tumoral — tem no anatomopatológico?"
- Se a pessoa não souber ou não tiver o dado à mão, siga sem ele e diga o que isso implica. Nunca insista duas vezes na mesma pergunta.
- Se pedirem para rodar logo, rode com o que tem, dizendo o que ficou em aberto.

=== SITUAÇÕES QUE VÃO APARECER ===

- Cumprimento ou conversa solta: responda curto e humano, e traga de volta ao caso sem cerimônia.
- Perguntam como a ferramenta funciona, de onde vêm os critérios, se é confiável: explique em uma ou duas frases. Os critérios são de diretrizes nacionais e internacionais vigentes; a decisão é sempre do médico.
- Perguntam qual teste pedir, ou pedem conduta terapêutica: você não decide isso. Diga que reúne o caso e a triagem responde, com o porquê. Não é fuga — é onde a responsabilidade fica.
- Descrevem um tumor fora dos subtipos cobertos: diga com todas as letras que esse sítio ainda não está mapeado nesta versão, em vez de tentar encaixar no mais parecido.
- Corrigem um dado ("na verdade é IV, não III"): aceite a correção sem repetir tudo, e siga.
- Mandam um caso inteiro de uma vez, completo: não invente pergunta. Confirme o que entendeu e vá para a triagem.
- Contam algo do contexto (paciente idosa, família preocupada, dificuldade de acesso ao exame): reconheça brevemente, com humanidade, e siga. Você não é fria.
- Mudam de caso no meio: acompanhe, sem se prender ao anterior.

=== LIMITES QUE VOCÊ NÃO ULTRAPASSA ===

- Você NÃO decide qual teste pedir e NÃO dá conduta terapêutica. Quem faz a triagem é o motor de regras da plataforma.
- Você NUNCA pede nome, CPF, data de nascimento, prontuário ou qualquer dado que identifique o paciente. Se a pessoa mencionar espontaneamente, siga sem repetir o dado.
- Você não inventa dado clínico que não foi dito. Na dúvida, pergunta ou deixa em aberto.

=== ENTREGANDO O CASO ===

Quando tiver o suficiente para a triagem rodar — o que decide aquele tumor, não todos os campos possíveis — responda normalmente e termine a mensagem com uma linha isolada, exatamente neste formato:

CASO_PRONTO: <o caso em uma frase corrida, com tudo que foi reunido>

Essa linha é lida pela plataforma e não aparece para o médico. Só a inclua quando realmente der para rodar. Se depois disso vier dado novo, mande a linha de novo, atualizada.`;

/* O estado da tela vira um bloco curto no fim do system prompt.
 *
 * Três cuidados, porque isto vem do cliente:
 *  - só aceita string, e corta em 200 caracteres por campo;
 *  - o tumor precisa existir no registro, senão é descartado;
 *  - qualquer campo cujo rótulo cheire a identificação de paciente é
 *    recusado, mesmo que o cliente mande. O nome do paciente não sobe para o
 *    modelo de conversa, e essa garantia mora aqui no servidor, não na
 *    confiança de que o cliente se comportou. Ver §51.
 */
const ROTULO_PROIBIDO = /nome|paciente|cpf|prontu[áa]rio|nascimento|rg\b|telefone|email/i;

function montarContextoDaTela(contexto) {
  if (!contexto || typeof contexto !== 'object') return '';
  const tumor = TUMORS.acharTumorPorLabel(String(contexto.tumor || ''));
  if (!tumor) return '';

  const campos = contexto.campos && typeof contexto.campos === 'object' ? contexto.campos : {};
  const linhas = Object.entries(campos)
    .filter(([rotulo, valor]) => typeof rotulo === 'string' && typeof valor === 'string'
      && rotulo.length < 80 && valor.trim() && !ROTULO_PROIBIDO.test(rotulo))
    .slice(0, 20)
    .map(([rotulo, valor]) => `- ${rotulo}: ${valor.trim().slice(0, 200)}`);

  if (!linhas.length) return '';

  return `\n\n=== O QUE JÁ ESTÁ PREENCHIDO NA TELA ===\n\n`
    + `O médico já estruturou este caso como ${tumor.label}, com estes campos:\n`
    + `${linhas.join('\n')}\n\n`
    + `NÃO pergunte nada que já esteja nesta lista — ele acabou de preencher e vai ver você perguntando de novo. `
    + `Trate como dado confirmado e fale a partir dele. Se ele corrigir algo aqui, a correção dele vale.`;
}

app.post('/api/chat', auth.requireAuth(), auth.requireCrmLiberado(), tetoDeGasto('chat', 120), async (req, res, next) => {
  try {
    const history = Array.isArray(req.body.messages) ? req.body.messages : [];
    if (!history.length) return res.status(400).json({ error: 'Conversa vazia.' });

    // Trava de custo e de contexto: uma conversa de triagem não passa disso,
    // e sem limite um cliente malicioso poderia inflar a fatura da API.
    const messages = history
      .slice(-24)
      .filter((m) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
      .map((m) => ({ role: m.role, content: m.content.slice(0, 4000) }));

    if (!messages.length || messages[messages.length - 1].role !== 'user') {
      return res.status(400).json({ error: 'A última mensagem precisa ser do médico.' });
    }

    // O que já está preenchido na tela entra como contexto, para a Gena não
    // repetir pergunta que o formulário já respondeu. Validado campo a campo:
    // só string, tamanho limitado, e o nome do paciente nunca é aceito aqui.
    const system = GENA_SYSTEM_PROMPT + montarContextoDaTela(req.body.contexto);

    const response = await ia.criarMensagem({
      max_tokens: 600,
      system,
      messages,
    });

    const raw = response.content.filter((b) => b.type === 'text').map((b) => b.text).join('').trim();

    // Separa o marcador de caso pronto do texto que o médico vê.
    const match = raw.match(/^CASO_PRONTO:\s*(.+)$/m);
    const reply = raw.replace(/^CASO_PRONTO:.*$/m, '').trim();

    res.json({ reply, caseReady: match ? match[1].trim() : null });
  } catch (err) {
    next(err);
  }
});

/* ============================== EXTRAÇÃO ============================== */

// Autenticação não é autorização de gasto. Sem teto, uma sessão obtida com
// nome e CRM quaisquer fazia 240 chamadas pagas em 0,8 s. Estes limites são
// folgados para uso clínico real (um médico não estrutura 40 casos por hora) e
// fecham o laço automatizado.
function tetoDeGasto(nome, max) {
  return (req, res, next) => {
    const limite = auth.rateLimit(`${nome}:${req.user.id}`, { max, windowMs: 60 * 60 * 1000 });
    if (!limite.allowed) {
      return res.status(429).json({
        error: `Limite de ${max} operações por hora atingido nesta conta. Tente novamente em ${Math.ceil(limite.retryAfterSec / 60)} minutos.`,
      });
    }
    next();
  };
}

app.post('/api/extract', auth.requireAuth(), auth.requireCrmLiberado(), tetoDeGasto('extract', 40), reservaDeMemoria, upload.array('files', 3), async (req, res) => {
  // Fora do try: sem isso, os avisos por arquivo (qual anexo foi descartado e
  // por quê) desapareciam quando a chamada falhava, e o médico reenviava os
  // mesmos arquivos ruins sem nunca saber quais eram o problema.
  const avisos = [];
  try {
    // Campo duplicado no multipart chega como array e quebrava o .trim().
    const bruto = req.body.text;
    const text = String(Array.isArray(bruto) ? bruto.join('\n\n') : (bruto || '')).trim();
    const files = req.files || [];

    if (!files.length && !text) {
      return res.status(400).json({ error: 'Nenhum texto ou arquivo foi enviado.' });
    }

    const content = [];
    // Guardados para o plano B: se a API recusar o documento, o texto destes
    // PDFs é extraído aqui e a chamada é refeita.
    const pdfsEnviados = [];
    // Texto do material que o SERVIDOR consegue ler por conta própria: o que o
    // médico digitou, mais o texto de PDF quando a extração local chegou a
    // rodar. É a base da conferência determinística de sítio lá embaixo — para
    // imagem e para PDF lido direto pela API não há texto aqui, e a conferência
    // simplesmente não se aplica (nunca chuta).
    let textoDosPdfs = '';

    for (const file of files) {
      const ehPdf = file.mimetype === 'application/pdf' || /\.pdf$/i.test(file.originalname || '');
      const ehImagem = (file.mimetype || '').startsWith('image/');

      if (ehPdf) {
        // Prepara antes de gastar chamada: desembrulha PDF dentro de envelope
        // de assinatura digital (ICP-Brasil) e barra o que não tem conserto.
        const check = pdf.preparar(file);
        if (!check.ok) {
          avisos.push({ arquivo: file.originalname, motivo: check.motivo, comoResolver: check.comoResolver });
          continue;
        }
        if (check.aviso) avisos.push(check.aviso);
        // O buffer que segue é o preparado, não o original.
        pdfsEnviados.push({ originalname: file.originalname, buffer: check.buffer });
        content.push({
          type: 'document',
          source: { type: 'base64', media_type: 'application/pdf', data: check.buffer.toString('base64') },
        });
        // O buffer original já virou base64 (e, se houve desembrulho, já foi
        // copiado). Manter os dois em memória dobra o pico sem serventia.
        if (file.buffer !== check.buffer) file.buffer = null;
      } else if (ehImagem) {
        if (!file.buffer || !file.buffer.length) {
          avisos.push({
            arquivo: file.originalname,
            motivo: `"${file.originalname}" chegou vazio (0 bytes).`,
            comoResolver: 'Abra a imagem uma vez no aparelho para forçar o download e anexe de novo.',
          });
          continue;
        }
        // A leitura automática só abre jpeg, png, gif e webp. HEIC é o formato
        // PADRÃO de foto do iPhone: sem esta checagem, uma foto anexada pelo
        // app Arquivos era enviada e voltava com erro técnico sem explicação.
        if (!IMAGENS_SUPORTADAS.includes(file.mimetype)) {
          const heic = /heic|heif/i.test(file.mimetype) || /\.(heic|heif)$/i.test(file.originalname || '');
          avisos.push({
            arquivo: file.originalname,
            motivo: heic
              ? `"${file.originalname}" está em HEIC, o formato padrão de foto do iPhone, que a leitura automática não abre.`
              : `"${file.originalname}" está num formato de imagem que a leitura automática não abre (${file.mimetype}).`,
            comoResolver: heic
              ? 'No iPhone: abra a foto, toque em Compartilhar, escolha "Copiar foto" e cole aqui — a cópia sai em JPEG. Ou tire um print da tela e anexe o print.'
              : 'Converta para JPEG ou PNG, ou tire um print da tela e anexe o print.',
          });
          continue;
        }
        content.push({
          type: 'image',
          source: { type: 'base64', media_type: file.mimetype, data: file.buffer.toString('base64') },
        });
        file.buffer = null;
      } else {
        avisos.push({
          arquivo: file.originalname,
          motivo: `"${file.originalname}" não é PDF nem imagem.`,
          comoResolver: 'Anexe o laudo em PDF, ou tire uma foto/print e anexe como imagem.',
        });
      }
    }

    // Nenhuma fonte utilizável sobrou: responde o porquê, sem gastar chamada.
    const temAnexoUtil = content.length > 0;
    if (!temAnexoUtil && !text) {
      return res.status(400).json({ error: mensagemDeFalha(avisos), avisos });
    }

    function montaMensagem(blocos, textoExtra) {
      // Delimitado: o conteúdo vem de laudo de terceiro e pode conter texto que
      // pareça instrução. As marcas dizem ao modelo que ali é dado a extrair.
      const corpo = [text, textoExtra].filter(Boolean).join('\n\n');
      const instrucao = corpo
        ? `Descrição em texto fornecida pelo médico:\n\n<material_do_paciente>\n${corpo}\n</material_do_paciente>`
        : 'Nenhum texto foi digitado — extraia só a partir dos arquivos anexados.';
      return [...blocos, { type: 'text', text: `${instrucao}\n\nExtraia o caso clínico estruturado conforme o schema.` }];
    }

    async function chamar(blocos, textoExtra) {
      return ia.criarMensagem({
        max_tokens: 2048,
        system: UNIFIED_SYSTEM_PROMPT,
        output_config: { format: { type: 'json_schema', schema: UNIFIED_SCHEMA } },
        messages: [{ role: 'user', content: montaMensagem(blocos, textoExtra) }],
      });
    }

    let response;
    try {
      response = await chamar(content);
    } catch (err) {
      // Plano B: a API recusou o documento. Em vez de devolver o erro cru ao
      // médico, o texto do PDF é extraído aqui e a chamada é refeita sem o
      // documento. Perde o layout, mas um laudo lido vale mais que um erro.
      if (!pdf.ehRecusaDePdf(err) || !pdfsEnviados.length) throw err;

      console.warn('API recusou o PDF; tentando extração local de texto.', err.message);
      const trechos = [];
      for (const file of pdfsEnviados) {
        try {
          const { texto, paginas } = await pdf.extrairTexto(file.buffer);
          // Limiar baixo de propósito: serve só para separar "PDF com texto"
          // de "PDF que é imagem digitalizada" (esse extrai quase nada). Um
          // laudo curto e legítimo não pode cair fora.
          if (texto.length >= 15) {
            trechos.push(`--- Conteúdo extraído de "${file.originalname}" (${paginas} página(s)) ---\n${texto}`);
          } else {
            avisos.push({
              arquivo: file.originalname,
              motivo: `"${file.originalname}" não tem texto selecionável.`,
              comoResolver: 'O PDF parece ser uma imagem digitalizada que a leitura automática não conseguiu abrir. Tire uma foto ou print da página do laudo e anexe como imagem.',
            });
          }
        } catch (e) {
          avisos.push({
            arquivo: file.originalname,
            motivo: e.code === 'PDF_PAGINAS_DEMAIS'
              ? `"${file.originalname}" tem ${e.paginas} páginas, acima do limite de leitura.`
              : `Não consegui abrir "${file.originalname}".`,
            comoResolver: e.code === 'PDF_PAGINAS_DEMAIS'
              ? 'Anexe apenas as páginas do laudo que interessam, ou uma foto da página do resultado.'
              : 'Tire uma foto ou print do laudo e anexe como imagem, ou reimprima o PDF a partir do sistema de origem.',
          });
        }
      }

      const semPdf = content.filter((b) => b.type !== 'document');
      if (!trechos.length && !semPdf.length && !text) {
        return res.status(422).json({ error: mensagemDeFalha(avisos), avisos });
      }
      if (trechos.length) {
        avisos.push({
          arquivo: pdfsEnviados.map((f) => f.originalname).join(', '),
          motivo: 'O PDF não pôde ser lido no formato original.',
          comoResolver: 'O texto foi extraído e usado assim mesmo — confira os campos com atenção extra, porque tabelas e imagens do laudo podem ter se perdido.',
          recuperado: true,
        });
      }
      textoDosPdfs = trechos.join('\n\n');
      response = await chamar(semPdf, textoDosPdfs);
    }

    const textBlock = response.content.find((b) => b.type === 'text');
    if (!textBlock) {
      return res.status(502).json({ error: 'A leitura não retornou um caso estruturado. Tente novamente.' });
    }

    // Normaliza a resposta: encontra o tumor pelo rótulo (tolerante a espaço e
    // caixa), traz só os campos daquele subtipo e encaixa cada valor na lista
    // que aquele tumor aceita.
    let cru;
    try {
      cru = JSON.parse(textBlock.text);
    } catch (e) {
      // Forma, nunca conteúdo: a saída crua é o caso clínico estruturado, com
      // nome do paciente. Log de produção vai para agregador retido.
      // Forma, nunca conteúdo. A versão anterior registrava os 40 primeiros
      // caracteres — e o objeto pode começar por nome_paciente.
      console.error('Resposta do modelo não é JSON válido. Tamanho:', textBlock.text.length,
        '| primeiro caractere:', JSON.stringify(textBlock.text.slice(0, 1)),
        '| parece JSON:', /^[[{"]/.test(textBlock.text.trim()));
      return res.status(502).json({ error: 'A leitura devolveu um resultado incompleto. Tente novamente.' });
    }
    // JSON.parse aceita null, array e string. Todos viravam "leitura
    // bem-sucedida" com o caso vazio, e o médico não distinguia "o laudo não
    // tinha esses dados" de "a leitura falhou" — diferença que muda a conduta.
    if (!cru || typeof cru !== 'object' || Array.isArray(cru)) {
      console.error('Resposta do modelo não é objeto. Tipo:', Array.isArray(cru) ? 'array' : typeof cru);
      return res.status(502).json({ error: 'A leitura devolveu um resultado incompleto. Tente novamente.', avisos });
    }

    const extracted = TUMORS.normalizar(cru);

    // Rótulo de tumor fora do registro: a tela não sabe desenhar um subtipo que
    // não existe, então vira "Não identificado" com explicação.
    if (extracted.tipo_tumor && !TUMORS.labels().includes(extracted.tipo_tumor)) {
      extracted.tipo_tumor = 'Não identificado';
      extracted.tipo_tumor_justificativa = 'O material sugere um sítio oncológico que ainda não está mapeado nesta versão.';
    }

    // ===== CONFERÊNCIA DETERMINÍSTICA DO SÍTIO GINECOLÓGICO =====
    // Vem ANTES da segunda leitura de propósito: se o subtipo estiver errado,
    // reler os campos do subtipo errado só produz um caso errado mais completo.
    //
    // Medido, N=20 pelo fluxo real: 6 trocas de subtipo, e em TODAS as 6 o
    // material nomeava o sítio certo, literalmente. Quando o laudo diz o órgão
    // e a leitura diz outro, quem tem razão é o laudo — não é palpite contra
    // palpite, é texto contra inferência. Por isso aqui corrige, e não apenas
    // avisa. A trava contra excesso está na própria conferência: ela só se
    // pronuncia quando o material nomeia UM sítio; citando os dois
    // ("metástase ovariana de primário endometrial"), ela se cala.
    const materialEmTexto = [text, textoDosPdfs].filter(Boolean).join('\n\n');
    const conflito = conflitoDeSitioGinecologico(extracted.tipo_tumor, materialEmTexto);
    if (conflito.conflita) {
      const lidoAntes = extracted.tipo_tumor;
      console.warn(`Conflito de sítio: leitura disse "${lidoAntes}", material nomeia "${conflito.esperado}". Corrigindo.`);
      extracted.tipo_tumor = conflito.esperado;
      extracted.subtipo_corrigido_de = lidoAntes;
      // Os campos vieram do schema do subtipo errado: o que não pertence ao
      // subtipo certo é descartado, e a segunda leitura abaixo repõe o resto.
      const certo = TUMORS.acharTumorPorLabel(conflito.esperado);
      const permitidos = new Set(TUMORS.fieldsOf(certo).map((f) => f.key));
      for (const chave of Object.keys(extracted)) {
        if (TUMORS.isComum(chave) || permitidos.has(chave)) continue;
        if (['tipo_tumor', 'tipo_tumor_justificativa', 'fontes_usadas', 'nome_paciente',
          'subtipo_corrigido_de', 'subtipo_em_conflito'].includes(chave)) continue;
        delete extracted[chave];
      }
      avisos.push({
        arquivo: 'Subtipo corrigido',
        motivo: `A leitura classificou como "${lidoAntes}", mas o material nomeia ${conflito.esperado.replace('Ginecológico - ', '').toLowerCase()}: "${conflito.trecho}"`,
        comoResolver: `O subtipo foi corrigido para "${conflito.esperado}" com base no que está escrito no material. Confirme no campo abaixo — a triagem inteira depende dele.`,
        recuperado: true,
      });
    }

    // ===== SEGUNDA LEITURA COM SCHEMA DIRIGIDO =====
    // Medido contra a API real, mesmo texto, N=10 por condição:
    //   schema unificado (21 propriedades) — ovário 7/10, endométrio 1/10
    //   schema dirigido  (4 a 11 campos)   — ovário 10/10, endométrio 10/10
    // e a chamada dirigida custa 1/5 da unificada. A segunda leitura é mais
    // barata E mais certeira que a primeira, então ela não é mais um socorro
    // de exceção: roda sempre que sobrou campo decisivo vazio. Quando não
    // sobrou, não há o que ganhar e nada é gasto.
    const abandonou = extracaoAbandonada(extracted);
    // Uso das DUAS chamadas somado: sem isto o custo real da segunda leitura
    // fica invisível, e uma decisão de arquitetura tomada sobre custo precisa
    // do custo inteiro na mesa.
    let usoSegunda = null;
    if (valeSegundaLeitura(extracted)) {
      const tumor = TUMORS.acharTumorPorLabel(extracted.tipo_tumor);
      const schemaFoco = tumor && schemaDoSubtipo(tumor.id);
      let recuperou = false;

      if (schemaFoco) {
        try {
          console.warn(`Extração abandonada em "${extracted.tipo_tumor}"; segunda tentativa com schema dirigido.`);
          const segunda = await ia.criarMensagem({
            max_tokens: 2048,
            system: promptDoSubtipo(tumor),
            output_config: { format: { type: 'json_schema', schema: schemaFoco } },
            messages: [{ role: 'user', content: montaMensagem(content) }],
          });
          usoSegunda = segunda.usage;
          const blocoSegunda = segunda.content.find((b) => b.type === 'text');
          const cruSegunda = blocoSegunda ? JSON.parse(blocoSegunda.text) : null;
          if (cruSegunda && typeof cruSegunda === 'object' && !Array.isArray(cruSegunda)) {
            const normalizada = TUMORS.normalizar({ ...cruSegunda, tipo_tumor: extracted.tipo_tumor });
            // Só preenche o que está vazio: a primeira resposta continua sendo
            // a fonte do que ela conseguiu ler.
            for (const [chave, valor] of Object.entries(normalizada)) {
              const vazio = Array.isArray(extracted[chave])
                ? extracted[chave].length === 0
                : String(extracted[chave] || '').trim() === '';
              const temValor = Array.isArray(valor) ? valor.length > 0 : String(valor || '').trim() !== '';
              if (vazio && temValor) extracted[chave] = valor;
            }
            recuperou = !extracaoAbandonada(extracted);
          }
        } catch (e) {
          console.error('Segunda tentativa de extração falhou:', e.message);
        }
      }

      // O aviso é para o ABANDONO — o caso em que a primeira leitura desistiu
      // por inteiro e a tela ficaria em branco sem explicação. A segunda
      // leitura de rotina (faltava um campo, foi buscar) não merece aviso: um
      // alerta que aparece toda hora deixa de ser lido, e aí o que importa
      // passa despercebido junto.
      if (!abandonou) {
        // nada a comunicar: a releitura é parte normal do fluxo
      } else avisos.push(recuperou
        ? {
          arquivo: 'Leitura automática',
          motivo: 'A primeira leitura do material voltou incompleta.',
          comoResolver: 'Uma segunda leitura recuperou os dados e eles já estão preenchidos abaixo — confira os campos antes de seguir.',
          recuperado: true,
        }
        : {
          arquivo: 'Leitura automática',
          motivo: 'Não consegui extrair os campos principais deste material.',
          comoResolver: 'Confira e preencha os campos à mão nesta tela. Se o laudo tiver os dados, descrever o caso em texto costuma funcionar melhor que anexar a imagem.',
        });
    }

    res.json({ extracted, avisos, usage: response.usage, usageSegunda: usoSegunda });
  } catch (err) {
    // O detalhe técnico fica no servidor. O médico recebe uma frase que diz o
    // que houve e o que fazer - nunca o JSON cru da API, que além de não
    // ajudar ainda quebrava o layout por ser uma linha sem espaços.
    console.error('Erro na extração:', err);
    const status = err && err.status;
    const mensagem =
      status === 429 ? 'A leitura está com muitas solicitações no momento. Tente de novo em alguns segundos.'
      : status === 401 || status === 403 ? 'A chave de acesso à leitura automática está inválida ou sem crédito. Verifique a configuração do serviço.'
      : status === 413 ? 'O material anexado é grande demais. Anexe menos páginas ou apenas a parte relevante do laudo.'
      : pdf.ehRecusaDePdf(err) ? 'Não consegui abrir o PDF anexado. Tire uma foto ou print do laudo e anexe como imagem.'
      : 'Não consegui ler o caso agora. Tente novamente em instantes — se persistir, anexe o laudo como foto.';
    res.status(status && status < 500 ? 422 : 500).json({ error: mensagem, avisos });
  }
});

app.get('/api/health', async (req, res) => {
  // `ok: true` literal fazia o Render manter saudável uma instância cujo banco
  // tinha caído, roteando médicos para 500 em toda rota autenticada.
  let armazenamentoOk = true;
  try { await store.ping(); } catch (e) { armazenamentoOk = false; }

  res.status(armazenamentoOk ? 200 : 503).json({
    ok: armazenamentoOk,
    hasApiKey: ia.configurado(),
    ia: ia.PROVEDOR === 'vertex' ? `vertex ${ia.REGIAO}` : 'anthropic',
    storage: store.usingPostgres ? (armazenamentoOk ? 'postgres' : 'postgres INDISPONÍVEL') : 'arquivo (efêmero)',
    email: mailer.isConfigured() ? 'configurado' : 'não configurado',
    plaud: plaud.isConfigured() ? 'configurado' : 'aguardando credenciais',
  });
});

// Configuração pública consumida pela tela de login para avisar, com todas as
// letras, quando as contas são temporárias — em vez de deixar o médico
// descobrir sozinho que a conta sumiu.
app.get('/api/config', (req, res) => {
  res.json({
    authMode: AUTH_MODE,
    ufs: auth.UFS,
    termosVersao: TERMOS_VERSAO,
    ephemeralAccounts: !store.usingPostgres,
    emailEnabled: mailer.isConfigured(),
    plaudEnabled: plaud.isConfigured(),
  });
});

/* §78. A página entregue com o endereço real escrito dentro.
 *
 * As marcações de pré-visualização (og:url, og:image, canonical) exigem URL
 * ABSOLUTA — o WhatsApp e o LinkedIn não resolvem caminho relativo. Escrever
 * o domínio à mão no HTML quebraria no dia em que ele mudar, e é justamente
 * o que vai acontecer quando o domínio próprio entrar no ar.
 *
 * Então o HTML guarda um marcador e o servidor troca pelo endereço de quem
 * pediu: APP_ORIGIN quando existe, senão o host do próprio pedido. Vale em
 * produção, no Render e na máquina de quem desenvolve, sem configurar nada.
 *
 * O arquivo é lido uma vez, no boot: trocar duas palavras numa string já
 * carregada é barato; ler disco a cada pedido não é. */
const PAGINA = fs.readFileSync(path.join(__dirname, 'public', 'index.html'), 'utf8');

/* §80. Segunda camada, deliberadamente redundante com a validação de
 * `appOrigin`. O marcador cai DENTRO de atributos de aspas duplas, então o
 * que fecha o atributo e abre uma tag é `"` e `<`. Confiar só na validação
 * faria desta linha a única coisa entre um cabeçalho de cliente e o HTML
 * entregue ao médico — e foi exatamente assim que o defeito nasceu. */
function escaparAtributo(valor) {
  return String(valor)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function entregarPagina(req, res) {
  res.type('html').send(PAGINA.replaceAll('__ORIGEM__', escaparAtributo(appOrigin(req))));
}
app.get('/', entregarPagina);
app.get('/index.html', entregarPagina);

app.use(express.static(path.join(__dirname, 'public')));

// Handler de erro final: registra o detalhe no servidor mas nunca devolve stack
// trace nem mensagem interna para o cliente em produção.
app.use((err, req, res, _next) => {
  // Limite de upload estourado é erro do pedido, não do servidor: o médico
  // precisa saber o que reduzir.
  if (err instanceof multer.MulterError) {
    const mensagens = {
      LIMIT_FILE_SIZE: 'Arquivo acima de 20 MB. Anexe apenas as páginas relevantes ou uma foto da página.',
      LIMIT_FILE_COUNT: 'Máximo de 3 arquivos por caso. Remova algum anexo e tente de novo.',
      LIMIT_UNEXPECTED_FILE: 'Máximo de 3 arquivos por caso. Remova algum anexo e tente de novo.',
      LIMIT_FIELD_VALUE: 'O texto digitado é longo demais. Resuma o caso ou anexe o laudo.',
    };
    return res.status(400).json({ error: mensagens[err.code] || 'Não foi possível receber os arquivos enviados.' });
  }
  // Envio interrompido antes de terminar: é o cenário mais comum de todos —
  // médico anexando laudo pelo celular, no corredor, com sinal ruim. "Erro
  // interno" o faz reenviar o mesmo arquivo pela mesma conexão ruim.
  if (/Unexpected end of form|Malformed part header|Unexpected end of multipart/i.test(err.message || '')) {
    return res.status(400).json({
      error: 'O envio do arquivo foi interrompido antes de terminar. Verifique a conexão e anexe de novo.',
    });
  }

  // Pedido malformado é erro do cliente. Devolver 500 suja a métrica de erro
  // do serviço e manda o operador caçar bug que não existe — e esconde os 500
  // de verdade no meio do ruído.
  const statusCliente = err.status || err.statusCode;
  if (statusCliente >= 400 && statusCliente < 500) {
    console.warn('Pedido malformado:', err.type || err.code || err.message);
    if (res.headersSent) return _next(err);
    return res.status(statusCliente).json({
      error: statusCliente === 413
        ? 'O conteúdo enviado é grande demais.'
        : 'Não consegui entender o pedido enviado. Recarregue a página e tente de novo.',
    });
  }

  console.error('Erro não tratado:', err);
  // Headers já enviados: passar adiante encerra a resposta. Um `return` seco
  // deixava o socket pendurado até o timeout do cliente.
  if (res.headersSent) return _next(err);
  res.status(500).json({ error: 'Erro interno. Tente novamente em instantes.' });
});

const PORT = Number(process.env.PORT) || 3000;

// Sem estes handlers, qualquer promise rejeitada fora de try/catch mata o
// processo. Com disco efêmero, cada morte apaga as sessões de TODOS os
// médicos logados — uma falha de I/O isolada desloga o consultório inteiro.
process.on('unhandledRejection', (motivo) => {
  console.error('Promise rejeitada sem tratamento:', motivo && motivo.message ? motivo.message : motivo);
});

let servidor = null;

process.on('uncaughtException', (err) => {
  console.error('Exceção não capturada — encerrando com ordem:', err);
  if (servidor) servidor.close(() => process.exit(1));
  setTimeout(() => process.exit(1), 5000).unref();
});

// O deploy do Render manda SIGTERM: fecha aceitando o que já está em voo, em
// vez de cortar a extração de um laudo no meio.
function encerrar(sinal) {
  console.log(`Recebido ${sinal}, encerrando…`);
  if (!servidor) process.exit(0);
  servidor.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 10000).unref();
}
process.on('SIGTERM', () => encerrar('SIGTERM'));
process.on('SIGINT', () => encerrar('SIGINT'));

store.init()
  .then(() => {
    servidor = app.listen(PORT, () => {
      console.log(`OncoGenYX rodando em http://localhost:${PORT}`);
      // Sessão e reset expirados nunca eram apagados: no Postgres as tabelas
      // cresciam sem teto, e no arquivo cada requisição autenticada relia o
      // banco inteiro (26x mais lento com 20 mil sessões).
      store.limparExpirados().catch((e) => console.error('Limpeza inicial:', e.message));
      setInterval(
        () => store.limparExpirados().catch((e) => console.error('Limpeza periódica:', e.message)),
        60 * 60 * 1000,
      ).unref();
      console.log(`  IA:            ${ia.descricao()}`);
      console.log(`  Armazenamento: ${store.usingPostgres ? 'Postgres' : 'arquivo local (efêmero)'}`);
      console.log(`  Email:         ${mailer.isConfigured() ? 'Resend configurado' : 'NÃO configurado (links vão para o console)'}`);
      console.log(`  Plaud:         ${plaud.isConfigured() ? 'credenciais presentes' : 'aguardando credenciais'}`);
    });
    // Porta ocupada não pode virar stack crua no log do Render. Este listener
    // vivia num bloco no fim do arquivo protegido por um teste de nulidade e
    // agendado com process.nextTick, que NUNCA rodava: o nextTick dispara
    // antes do `.then()` de store.init(), então o servidor ainda não existia e
    // o bloco interno pulava fora. Provado com repro isolado na auditoria.
    servidor.on('error', (e) => {
      console.error('Não consegui escutar na porta', PORT, '-', e.code);
      process.exit(1);
    });
  })
  .catch((err) => {
    console.error('Falha ao inicializar o armazenamento:', err);
    process.exit(1);
  });
