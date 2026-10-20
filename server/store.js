'use strict';

// Camada de persistência do OncoGenYX.
//
// Dois back-ends, mesma interface:
//   - Postgres, quando DATABASE_URL está definida (produção; sobrevive a deploys)
//   - Arquivo JSON local, caso contrário (desenvolvimento na máquina do dev)
//
// O disco do Render free tier é efêmero: é zerado a cada deploy e a cada
// restart. O back-end de arquivo serve para desenvolvimento e para a fase de
// validação; em produção o servidor AVISA no boot quando sobe sem
// DATABASE_URL (index.js) e /api/config expõe `ephemeralAccounts`, que a tela
// de acesso mostra ao médico. No modo completo (§85) o boot em produção exige
// o banco: conta com senha que some em silêncio é pior que site fora do ar.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const cifra = require('./cifra');

// A suíte roda DELETE. `robustez.test.js` carrega este módulo NO PRÓPRIO
// processo do teste e chama limparExpirados(), que é
// `DELETE FROM sessions/resets WHERE expires_at < now()`. Os testes que sobem
// o servidor em subprocesso já limpam DATABASE_URL no env do filho, mas o que
// carrega em processo não tem como. Resultado medido: numa máquina com
// DATABASE_URL apontando para o banco de produção, `npm test` apaga sessões de
// médicos reais, todos deslogados sem explicação.
//
// Por isso a decisão é aqui, no módulo, e não no script de teste: quem esquecer
// de exportar a variável certa não consegue causar o estrago. Em contexto de
// teste este módulo NUNCA fala com Postgres e NUNCA escreve no arquivo de
// dados real, mesmo que o ambiente mande. (A suíte do Postgres usa um banco em
// memória, injetado por `usarBancoDeTeste`, nunca uma DATABASE_URL.)
const EM_TESTE = process.env.NODE_TEST_CONTEXT !== undefined || process.env.NODE_ENV === 'test';

const DATA_FILE = process.env.DATA_FILE
  || (EM_TESTE
    ? path.join(require('os').tmpdir(), `oncogenyx-teste-${process.pid}.json`)
    : path.join(__dirname, '.data', 'oncogenyx.json'));

// O arquivo de teste é descartável e some junto com o processo. Sem isto, cada
// `npm test` deixava lixo em /tmp para sempre.
if (EM_TESTE && !process.env.DATA_FILE) {
  process.on('exit', () => {
    try { fs.rmSync(DATA_FILE, { force: true }); } catch { /* nada a fazer no exit */ }
  });
}

// Prazos de guarda (§85.2).
const EVENTOS_GUARDA_MS = 1000 * 60 * 60 * 24 * 183;   // Marco Civil, art. 15: 6 meses
const TENTATIVAS_GUARDA_MS = 1000 * 60 * 60 * 24 * 30;

let pool = null;
let usingPostgres = Boolean(process.env.DATABASE_URL) && !EM_TESTE;

if (usingPostgres) {
  const { Pool } = require('pg');
  pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    // Provedores gerenciados (Neon, Supabase, Render) exigem TLS mas usam
    // cadeias que o Node não conhece por padrão.
    ssl: process.env.DATABASE_SSL === 'off' ? false : { rejectUnauthorized: false },
    max: 5,
    idleTimeoutMillis: 10_000,
    connectionTimeoutMillis: 10_000,
  });

  // Sem este listener o processo MORRE quando cai uma conexão ociosa: o pg
  // emite 'error' no pool, e um EventEmitter sem listener de 'error' lança.
  // Neon e Supabase free derrubam conexão ociosa de forma agressiva e o Render
  // hiberna a cada 15 min: é o caminho normal, não a exceção.
  pool.on('error', (err) => {
    console.error('Erro em cliente ocioso do Postgres (a conexão será descartada):', err.message);
  });
}

/**
 * Só para a suíte: troca o back-end por um banco Postgres em memória (PGlite)
 * com a mesma interface de `pool.query`. É o que permite testar as consultas
 * SQL de verdade sem nenhum banco real por perto.
 */
function usarBancoDeTeste(poolFalso) {
  if (!EM_TESTE) throw new Error('usarBancoDeTeste só pode ser chamado na suíte de testes.');
  pool = poolFalso;
  usingPostgres = true;
}

const q = (sql, params) => pool.query(sql, params);

async function init() {
  if (!usingPostgres) {
    fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
    if (!fs.existsSync(DATA_FILE)) writeFile(vazio());
    return;
  }

  await q(`
    CREATE TABLE IF NOT EXISTS users (
      id            TEXT PRIMARY KEY,
      email         TEXT UNIQUE NOT NULL,
      name          TEXT NOT NULL,
      crm           TEXT NOT NULL,
      password_hash TEXT,
      created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      last_login_at TIMESTAMPTZ
    );
    ALTER TABLE users ADD COLUMN IF NOT EXISTS crm_uf              TEXT;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS crm_status          TEXT;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS crm_conferido_em    TIMESTAMPTZ;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS crm_conferido_por   TEXT;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS liberado_ate        TIMESTAMPTZ;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verificado_em TIMESTAMPTZ;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS termos_versao       TEXT;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS termos_aceitos_em   TIMESTAMPTZ;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS consentimento_email_em TIMESTAMPTZ;
    CREATE UNIQUE INDEX IF NOT EXISTS users_crm_uf_idx ON users(crm, crm_uf) WHERE crm_uf IS NOT NULL;

    CREATE TABLE IF NOT EXISTS sessions (
      token_hash TEXT PRIMARY KEY,
      user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      expires_at TIMESTAMPTZ NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    ALTER TABLE sessions ADD COLUMN IF NOT EXISTS ultimo_uso_em TIMESTAMPTZ;
    ALTER TABLE sessions ADD COLUMN IF NOT EXISTS ip            TEXT;
    ALTER TABLE sessions ADD COLUMN IF NOT EXISTS agente        TEXT;

    CREATE TABLE IF NOT EXISTS resets (
      token_hash TEXT PRIMARY KEY,
      user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      expires_at TIMESTAMPTZ NOT NULL,
      used_at    TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    ALTER TABLE resets ADD COLUMN IF NOT EXISTS finalidade TEXT NOT NULL DEFAULT 'redefinir_senha';

    CREATE TABLE IF NOT EXISTS plaud_tokens (
      user_id       TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      access_token  TEXT NOT NULL,
      refresh_token TEXT,
      expires_at    TIMESTAMPTZ,
      updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS tentativas (
      chave         TEXT PRIMARY KEY,
      contagem      INTEGER NOT NULL,
      janela_inicio TIMESTAMPTZ NOT NULL,
      atualizado_em TIMESTAMPTZ NOT NULL
    );

    CREATE TABLE IF NOT EXISTS eventos (
      id        TEXT PRIMARY KEY,
      user_id   TEXT,
      tipo      TEXT NOT NULL,
      ip        TEXT,
      agente    TEXT,
      detalhe   TEXT,
      criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS sessions_user_idx ON sessions(user_id);
    CREATE INDEX IF NOT EXISTS resets_user_idx   ON resets(user_id);
    CREATE INDEX IF NOT EXISTS eventos_user_idx  ON eventos(user_id, criado_em);
    CREATE INDEX IF NOT EXISTS eventos_data_idx  ON eventos(criado_em);
  `);
}

/* ---------- back-end de arquivo ---------- */

function vazio() {
  return { users: [], sessions: [], resets: [], plaud: [], tentativas: [], eventos: [] };
}

function readFile() {
  try {
    return { ...vazio(), ...JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')) };
  } catch {
    return vazio();
  }
}

function writeFile(db) {
  fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
  fs.writeFileSync(DATA_FILE, JSON.stringify(db, null, 2));
}

const agoraIso = () => new Date().toISOString();
const iso = (d) => (d instanceof Date ? d.toISOString() : d);

/* ---------- usuários ---------- */

// Colunas que `updateUser` aceita. Lista fechada: o nome da coluna entra no
// SQL, então nada vindo de fora pode escolher qual é.
const CAMPOS_EDITAVEIS = [
  'name', 'crm', 'crm_uf', 'email', 'password_hash', 'last_login_at',
  'crm_status', 'crm_conferido_em', 'crm_conferido_por', 'liberado_ate',
  'email_verificado_em', 'termos_versao', 'termos_aceitos_em', 'consentimento_email_em',
];

async function findUserByEmail(email) {
  const key = String(email || '').trim().toLowerCase();
  if (!key) return null;
  if (usingPostgres) {
    const { rows } = await q('SELECT * FROM users WHERE email = $1', [key]);
    return rows[0] || null;
  }
  return readFile().users.find((u) => u.email === key) || null;
}

async function findUserById(id) {
  if (!id) return null;
  if (usingPostgres) {
    const { rows } = await q('SELECT * FROM users WHERE id = $1', [id]);
    return rows[0] || null;
  }
  return readFile().users.find((u) => u.id === id) || null;
}

async function findUserByCrm(numero, uf) {
  if (!numero || !uf) return null;
  if (usingPostgres) {
    const { rows } = await q('SELECT * FROM users WHERE crm = $1 AND crm_uf = $2', [numero, uf]);
    return rows[0] || null;
  }
  return readFile().users.find((u) => u.crm === numero && u.crm_uf === uf) || null;
}

/** Conta do modo simples: o mesmo CRM sempre cai na mesma conta (§17). */
async function createUser({ id, email, name, crm }) {
  const user = {
    id,
    email: String(email).trim().toLowerCase(),
    name: String(name).trim(),
    crm: String(crm).trim(),
    password_hash: null,
    created_at: agoraIso(),
    last_login_at: null,
  };
  if (usingPostgres) {
    // ON CONFLICT em vez de depender do "procura, não achou, insere": entre a
    // busca e a inserção existe um await, e duas requisições do mesmo médico
    // (duplo toque, duas abas) interleavam de verdade no Postgres. Sem isto a
    // segunda batia na constraint UNIQUE e virava 500 "Erro interno".
    const { rows } = await q(
      `INSERT INTO users (id, email, name, crm) VALUES ($1, $2, $3, $4)
       ON CONFLICT (email) DO UPDATE SET name = EXCLUDED.name, crm = EXCLUDED.crm
       RETURNING *`,
      [user.id, user.email, user.name, user.crm]
    );
    return rows[0];
  }
  const db = readFile();
  db.users.push(user);
  writeFile(db);
  return user;
}

/**
 * Conta do modo completo (§85). Devolve null, sem lançar, quando o e-mail ou
 * o par CRM+UF já tem dono: quem chama decide a resposta neutra.
 */
async function createAccount(dados) {
  const user = {
    id: dados.id,
    email: String(dados.email).trim().toLowerCase(),
    name: String(dados.name).trim(),
    crm: dados.crm,
    crm_uf: dados.crm_uf,
    password_hash: dados.password_hash,
    crm_status: 'pendente',
    crm_conferido_em: null,
    crm_conferido_por: null,
    liberado_ate: iso(dados.liberado_ate),
    email_verificado_em: null,
    termos_versao: dados.termos_versao,
    termos_aceitos_em: agoraIso(),
    consentimento_email_em: agoraIso(),
    created_at: agoraIso(),
    last_login_at: null,
  };
  if (usingPostgres) {
    const { rows } = await q(
      `INSERT INTO users (id, email, name, crm, crm_uf, password_hash, crm_status,
                          liberado_ate, termos_versao, termos_aceitos_em, consentimento_email_em)
       VALUES ($1, $2, $3, $4, $5, $6, 'pendente', $7, $8, NOW(), NOW())
       ON CONFLICT DO NOTHING
       RETURNING *`,
      [user.id, user.email, user.name, user.crm, user.crm_uf, user.password_hash,
        user.liberado_ate, user.termos_versao]
    );
    return rows[0] || null;
  }
  const db = readFile();
  const conflito = db.users.some((u) => u.email === user.email
    || (u.crm_uf && u.crm === user.crm && u.crm_uf === user.crm_uf));
  if (conflito) return null;
  db.users.push(user);
  writeFile(db);
  return user;
}

async function updateUser(userId, campos) {
  const chaves = Object.keys(campos);
  for (const k of chaves) {
    if (!CAMPOS_EDITAVEIS.includes(k)) throw new Error(`Campo não editável: ${k}`);
  }
  if (!chaves.length) return;
  if (usingPostgres) {
    const sets = chaves.map((k, i) => `${k} = $${i + 2}`).join(', ');
    await q(`UPDATE users SET ${sets} WHERE id = $1`, [userId, ...chaves.map((k) => iso(campos[k]))]);
    return;
  }
  const db = readFile();
  const user = db.users.find((u) => u.id === userId);
  if (user) for (const k of chaves) user[k] = iso(campos[k]);
  writeFile(db);
}

async function setUserPassword(userId, passwordHash) {
  return updateUser(userId, { password_hash: passwordHash });
}

async function updateUserProfile(userId, { name, crm }) {
  return updateUser(userId, { name, crm });
}

async function touchLogin(userId) {
  return updateUser(userId, { last_login_at: new Date() });
}

/**
 * Exclusão de conta a pedido do médico (LGPD art. 18, VI). Leva junto
 * sessões, links e tokens do Plaud. Os eventos ficam (ver `registrarEvento`).
 */
async function deleteUser(userId) {
  if (usingPostgres) {
    await q('DELETE FROM users WHERE id = $1', [userId]);
    await q('DELETE FROM tentativas WHERE chave LIKE $1', [`%:${userId}`]);
    return;
  }
  const db = readFile();
  db.users = db.users.filter((u) => u.id !== userId);
  db.sessions = db.sessions.filter((s) => s.user_id !== userId);
  db.resets = db.resets.filter((r) => r.user_id !== userId);
  db.plaud = db.plaud.filter((p) => p.user_id !== userId);
  db.tentativas = db.tentativas.filter((t) => !t.chave.endsWith(`:${userId}`));
  writeFile(db);
}

/**
 * Fila do administrador (§85): contas com e-mail confirmado aguardando
 * conferência do CRM, e as decididas mais recentes para conferir o que já foi
 * feito.
 */
async function listarContasParaConferencia() {
  if (usingPostgres) {
    const pend = await q(
      `SELECT * FROM users WHERE crm_uf IS NOT NULL AND crm_status = 'pendente'
         AND email_verificado_em IS NOT NULL ORDER BY created_at ASC`, []);
    const dec = await q(
      `SELECT * FROM users WHERE crm_uf IS NOT NULL AND crm_status IN ('ativo', 'recusado')
       ORDER BY crm_conferido_em DESC NULLS LAST LIMIT 20`, []);
    return { pendentes: pend.rows, decididas: dec.rows };
  }
  const users = readFile().users.filter((u) => u.crm_uf);
  const pendentes = users
    .filter((u) => u.crm_status === 'pendente' && u.email_verificado_em)
    .sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)));
  const decididas = users
    .filter((u) => u.crm_status === 'ativo' || u.crm_status === 'recusado')
    .sort((a, b) => String(b.crm_conferido_em || '').localeCompare(String(a.crm_conferido_em || '')))
    .slice(0, 20);
  return { pendentes, decididas };
}

/* ---------- sessões ---------- */

async function createSession(tokenHash, userId, expiresAt, { ip = null, agente = null } = {}) {
  if (usingPostgres) {
    await q(
      `INSERT INTO sessions (token_hash, user_id, expires_at, ultimo_uso_em, ip, agente)
       VALUES ($1, $2, $3, NOW(), $4, $5)`,
      [tokenHash, userId, expiresAt, ip, agente]
    );
    return;
  }
  const db = readFile();
  db.sessions.push({
    token_hash: tokenHash, user_id: userId, expires_at: expiresAt.toISOString(),
    created_at: agoraIso(), ultimo_uso_em: agoraIso(), ip, agente,
  });
  writeFile(db);
}

async function findSession(tokenHash) {
  if (usingPostgres) {
    const { rows } = await q(
      'SELECT * FROM sessions WHERE token_hash = $1 AND expires_at > NOW()',
      [tokenHash]
    );
    return rows[0] || null;
  }
  const found = readFile().sessions.find((s) => s.token_hash === tokenHash);
  if (!found || new Date(found.expires_at) <= new Date()) return null;
  return found;
}

async function tocarSessao(tokenHash) {
  if (usingPostgres) {
    await q('UPDATE sessions SET ultimo_uso_em = NOW() WHERE token_hash = $1', [tokenHash]);
    return;
  }
  const db = readFile();
  const s = db.sessions.find((x) => x.token_hash === tokenHash);
  if (s) s.ultimo_uso_em = agoraIso();
  writeFile(db);
}

async function deleteSession(tokenHash) {
  if (usingPostgres) {
    await q('DELETE FROM sessions WHERE token_hash = $1', [tokenHash]);
    return;
  }
  const db = readFile();
  db.sessions = db.sessions.filter((s) => s.token_hash !== tokenHash);
  writeFile(db);
}

/** Encerra todas as sessões de um médico ("sair de todos os dispositivos"). */
async function deleteSessionsByUser(userId) {
  if (usingPostgres) {
    await q('DELETE FROM sessions WHERE user_id = $1', [userId]);
    return;
  }
  const db = readFile();
  db.sessions = db.sessions.filter((x) => x.user_id !== userId);
  writeFile(db);
}

async function listarSessoes(userId) {
  if (usingPostgres) {
    const { rows } = await q(
      `SELECT token_hash, created_at, ultimo_uso_em, expires_at, ip, agente FROM sessions
       WHERE user_id = $1 AND expires_at > NOW() ORDER BY ultimo_uso_em DESC NULLS LAST`,
      [userId]
    );
    return rows;
  }
  const agora = Date.now();
  return readFile().sessions
    .filter((s) => s.user_id === userId && new Date(s.expires_at).getTime() > agora)
    .sort((a, b) => String(b.ultimo_uso_em || '').localeCompare(String(a.ultimo_uso_em || '')));
}

/* ---------- links por e-mail (redefinir senha, confirmar e-mail) ---------- */

async function createReset(tokenHash, userId, expiresAt, finalidade = 'redefinir_senha') {
  if (usingPostgres) {
    // Um pedido novo invalida os anteriores da mesma finalidade: só o link
    // mais recente vale.
    await q('DELETE FROM resets WHERE user_id = $1 AND used_at IS NULL AND finalidade = $2', [userId, finalidade]);
    await q(
      'INSERT INTO resets (token_hash, user_id, expires_at, finalidade) VALUES ($1, $2, $3, $4)',
      [tokenHash, userId, expiresAt, finalidade]
    );
    return;
  }
  const db = readFile();
  db.resets = db.resets.filter((r) => !(r.user_id === userId && !r.used_at
    && (r.finalidade || 'redefinir_senha') === finalidade));
  db.resets.push({
    token_hash: tokenHash, user_id: userId, expires_at: expiresAt.toISOString(), used_at: null, finalidade,
  });
  writeFile(db);
}

function resetValido(r, finalidade) {
  return r && !r.used_at && new Date(r.expires_at) > new Date()
    && (r.finalidade || 'redefinir_senha') === finalidade;
}

/** Lê sem gastar: permite validar a senha nova antes de queimar o link. */
async function findReset(tokenHash, finalidade = 'redefinir_senha') {
  if (usingPostgres) {
    const { rows } = await q(
      `SELECT * FROM resets WHERE token_hash = $1 AND used_at IS NULL
         AND expires_at > NOW() AND finalidade = $2`,
      [tokenHash, finalidade]
    );
    return rows[0] || null;
  }
  const r = readFile().resets.find((x) => x.token_hash === tokenHash);
  return resetValido(r, finalidade) ? r : null;
}

async function consumeReset(tokenHash, finalidade = 'redefinir_senha') {
  if (usingPostgres) {
    // Marca como usado e devolve na mesma query: um token nunca serve duas
    // vezes, nem sob duas requisições simultâneas.
    const { rows } = await q(
      `UPDATE resets SET used_at = NOW()
       WHERE token_hash = $1 AND used_at IS NULL AND expires_at > NOW() AND finalidade = $2
       RETURNING *`,
      [tokenHash, finalidade]
    );
    return rows[0] || null;
  }
  const db = readFile();
  const reset = db.resets.find((r) => r.token_hash === tokenHash);
  if (!resetValido(reset, finalidade)) return null;
  reset.used_at = agoraIso();
  writeFile(db);
  return reset;
}

/* ---------- tentativas (limite de login, cadastro e envio de e-mail) ---------- */

// Gravado no banco, e não na memória do processo: o Render hiberna a cada
// 15 min sem uso e reinicia a cada publicação, e um contador em memória zerava
// junto (§85, defeito D4).

/**
 * Soma uma tentativa na chave. Se a janela anterior já venceu, recomeça do 1.
 * Devolve a contagem depois da soma e o momento desta tentativa.
 */
async function registrarTentativa(chave, janelaMs) {
  const agora = new Date();
  const inicioMinimo = new Date(agora.getTime() - janelaMs);
  if (usingPostgres) {
    const { rows } = await q(
      `INSERT INTO tentativas (chave, contagem, janela_inicio, atualizado_em)
       VALUES ($1, 1, $2, $2)
       ON CONFLICT (chave) DO UPDATE SET
         contagem = CASE WHEN tentativas.janela_inicio < $3 THEN 1 ELSE tentativas.contagem + 1 END,
         janela_inicio = CASE WHEN tentativas.janela_inicio < $3 THEN $2 ELSE tentativas.janela_inicio END,
         atualizado_em = $2
       RETURNING contagem, atualizado_em`,
      [chave, agora, inicioMinimo]
    );
    return { contagem: rows[0].contagem, atualizadoEm: new Date(rows[0].atualizado_em) };
  }
  const db = readFile();
  let t = db.tentativas.find((x) => x.chave === chave);
  if (!t || new Date(t.janela_inicio) < inicioMinimo) {
    db.tentativas = db.tentativas.filter((x) => x.chave !== chave);
    t = { chave, contagem: 0, janela_inicio: agora.toISOString() };
    db.tentativas.push(t);
  }
  t.contagem += 1;
  t.atualizado_em = agora.toISOString();
  writeFile(db);
  return { contagem: t.contagem, atualizadoEm: agora };
}

async function lerTentativa(chave, janelaMs) {
  const inicioMinimo = Date.now() - janelaMs;
  let t;
  if (usingPostgres) {
    const { rows } = await q('SELECT * FROM tentativas WHERE chave = $1', [chave]);
    t = rows[0];
  } else {
    t = readFile().tentativas.find((x) => x.chave === chave);
  }
  if (!t || new Date(t.janela_inicio).getTime() < inicioMinimo) return { contagem: 0, atualizadoEm: null };
  return { contagem: Number(t.contagem), atualizadoEm: new Date(t.atualizado_em) };
}

async function zerarTentativa(chave) {
  if (usingPostgres) {
    await q('DELETE FROM tentativas WHERE chave = $1', [chave]);
    return;
  }
  const db = readFile();
  db.tentativas = db.tentativas.filter((x) => x.chave !== chave);
  writeFile(db);
}

/* ---------- eventos de acesso (Marco Civil art. 15 e trilha de auditoria) ---------- */

// Guardados 6 meses e então apagados por `limparExpirados`. Não têm chave
// estrangeira de propósito: a exclusão da conta não pode apagar o registro de
// acesso que a lei manda manter (LGPD art. 16, I). Nunca recebem senha, token
// nem dado de paciente: quem chama passa só o que está descrito em §85.2.
async function registrarEvento({ userId = null, tipo, ip = null, agente = null, detalhe = null }) {
  const ev = {
    id: crypto.randomUUID(),
    user_id: userId,
    tipo,
    ip,
    agente,
    detalhe: detalhe ? JSON.stringify(detalhe) : null,
    criado_em: agoraIso(),
  };
  if (usingPostgres) {
    await q(
      'INSERT INTO eventos (id, user_id, tipo, ip, agente, detalhe) VALUES ($1, $2, $3, $4, $5, $6)',
      [ev.id, ev.user_id, ev.tipo, ev.ip, ev.agente, ev.detalhe]
    );
    return;
  }
  const db = readFile();
  db.eventos.push(ev);
  writeFile(db);
}

async function listarEventos(userId, limite = 20) {
  if (usingPostgres) {
    const { rows } = await q(
      'SELECT tipo, ip, agente, criado_em FROM eventos WHERE user_id = $1 ORDER BY criado_em DESC LIMIT $2',
      [userId, limite]
    );
    return rows;
  }
  return readFile().eventos
    .filter((e) => e.user_id === userId)
    .sort((a, b) => String(b.criado_em).localeCompare(String(a.criado_em)))
    .slice(0, limite)
    .map(({ tipo, ip, agente, criado_em }) => ({ tipo, ip, agente, criado_em }));
}

/* ---------- credenciais do Plaud (por médico), cifradas em repouso ---------- */

async function savePlaudTokens(userId, { accessToken, refreshToken, expiresAt }) {
  const acesso = cifra.cifrar(accessToken);
  const renovacao = refreshToken ? cifra.cifrar(refreshToken) : null;
  if (usingPostgres) {
    await q(
      `INSERT INTO plaud_tokens (user_id, access_token, refresh_token, expires_at, updated_at)
       VALUES ($1, $2, $3, $4, NOW())
       ON CONFLICT (user_id) DO UPDATE
         SET access_token = $2, refresh_token = $3, expires_at = $4, updated_at = NOW()`,
      [userId, acesso, renovacao, expiresAt || null]
    );
    return;
  }
  const db = readFile();
  db.plaud = (db.plaud || []).filter((p) => p.user_id !== userId);
  db.plaud.push({
    user_id: userId,
    access_token: acesso,
    refresh_token: renovacao,
    expires_at: expiresAt ? expiresAt.toISOString() : null,
  });
  writeFile(db);
}

async function getPlaudTokens(userId) {
  let row;
  if (usingPostgres) {
    const { rows } = await q('SELECT * FROM plaud_tokens WHERE user_id = $1', [userId]);
    row = rows[0];
  } else {
    row = (readFile().plaud || []).find((p) => p.user_id === userId);
  }
  if (!row) return null;
  return { ...row, access_token: cifra.decifrar(row.access_token), refresh_token: cifra.decifrar(row.refresh_token) };
}

async function deletePlaudTokens(userId) {
  if (usingPostgres) {
    await q('DELETE FROM plaud_tokens WHERE user_id = $1', [userId]);
    return;
  }
  const db = readFile();
  db.plaud = (db.plaud || []).filter((p) => p.user_id !== userId);
  writeFile(db);
}

/**
 * Apaga sessão, link, tentativa e evento vencidos. Sem isto as tabelas crescem
 * sem teto no Postgres, e no back-end de arquivo cada requisição autenticada
 * relê e reescreve o arquivo inteiro: medido, 26x mais lento com 20 mil sessões.
 */
async function limparExpirados() {
  const limiteEventos = new Date(Date.now() - EVENTOS_GUARDA_MS);
  const limiteTentativas = new Date(Date.now() - TENTATIVAS_GUARDA_MS);
  if (usingPostgres) {
    const s = await q('DELETE FROM sessions WHERE expires_at < NOW()', []);
    const r = await q('DELETE FROM resets WHERE expires_at < NOW() OR used_at IS NOT NULL', []);
    const e = await q('DELETE FROM eventos WHERE criado_em < $1', [limiteEventos]);
    const t = await q('DELETE FROM tentativas WHERE atualizado_em < $1', [limiteTentativas]);
    return { sessoes: s.rowCount, resets: r.rowCount, eventos: e.rowCount, tentativas: t.rowCount };
  }
  const db = readFile();
  const agora = Date.now();
  const antes = db.sessions.length + db.resets.length + db.eventos.length + db.tentativas.length;
  db.sessions = db.sessions.filter((x) => new Date(x.expires_at).getTime() > agora);
  db.resets = db.resets.filter((x) => !x.used_at && new Date(x.expires_at).getTime() > agora);
  db.eventos = db.eventos.filter((x) => new Date(x.criado_em) >= limiteEventos);
  db.tentativas = db.tentativas.filter((x) => new Date(x.atualizado_em) >= limiteTentativas);
  writeFile(db);
  return { removidos: antes - (db.sessions.length + db.resets.length + db.eventos.length + db.tentativas.length) };
}

/** Verifica se o armazenamento responde: usado pelo healthcheck. */
async function ping() {
  if (usingPostgres) await q('SELECT 1', []);
  return true;
}

module.exports = {
  limparExpirados,
  deleteSessionsByUser,
  ping,
  init,
  get usingPostgres() { return usingPostgres; },
  // Acessores para a suíte conseguir provar, e não presumir, que está isolada
  // do banco e do arquivo de dados reais. Ler as constantes direto de fora não
  // dá: o módulo é carregado uma única vez por processo.
  usandoPostgres: () => usingPostgres,
  arquivoDeDados: () => DATA_FILE,
  usarBancoDeTeste,
  EVENTOS_GUARDA_MS,
  findUserByEmail,
  findUserById,
  findUserByCrm,
  createUser,
  createAccount,
  updateUser,
  setUserPassword,
  updateUserProfile,
  touchLogin,
  deleteUser,
  listarContasParaConferencia,
  createSession,
  findSession,
  tocarSessao,
  deleteSession,
  listarSessoes,
  createReset,
  findReset,
  consumeReset,
  registrarTentativa,
  lerTentativa,
  zerarTentativa,
  registrarEvento,
  listarEventos,
  savePlaudTokens,
  getPlaudTokens,
  deletePlaudTokens,
};
