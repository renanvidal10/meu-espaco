'use strict';

// Camada de persistência do OncoGenYX.
//
// Dois back-ends, mesma interface:
//   - Postgres, quando DATABASE_URL está definida (produção; sobrevive a deploys)
//   - Arquivo JSON local, caso contrário (desenvolvimento na máquina do dev)
//
// O disco do Render free tier é efêmero: ele é zerado a cada deploy e a cada
// restart do serviço. Um arquivo JSON ali daria a falsa impressão de funcionar
// e apagaria as contas dos médicos sem aviso. Por isso o servidor recusa subir
// em produção sem DATABASE_URL (ver index.js) em vez de degradar silenciosamente.

const fs = require('fs');
const path = require('path');

const DATA_FILE = process.env.DATA_FILE || path.join(__dirname, '.data', 'oncogenyx.json');

let pool = null;
const usingPostgres = Boolean(process.env.DATABASE_URL);

if (usingPostgres) {
  const { Pool } = require('pg');
  pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    // Provedores gerenciados (Neon, Supabase, Render) exigem TLS mas usam
    // cadeias que o Node não conhece por padrão.
    ssl: process.env.DATABASE_SSL === 'off' ? false : { rejectUnauthorized: false },
    max: 5,
  });
}

async function init() {
  if (!usingPostgres) {
    fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
    if (!fs.existsSync(DATA_FILE)) writeFile({ users: [], sessions: [], resets: [], plaud: [] });
    return;
  }

  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id            TEXT PRIMARY KEY,
      email         TEXT UNIQUE NOT NULL,
      name          TEXT NOT NULL,
      crm           TEXT NOT NULL,
      password_hash TEXT,
      created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      last_login_at TIMESTAMPTZ
    );
    CREATE TABLE IF NOT EXISTS sessions (
      token_hash TEXT PRIMARY KEY,
      user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      expires_at TIMESTAMPTZ NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS resets (
      token_hash TEXT PRIMARY KEY,
      user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      expires_at TIMESTAMPTZ NOT NULL,
      used_at    TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS plaud_tokens (
      user_id       TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      access_token  TEXT NOT NULL,
      refresh_token TEXT,
      expires_at    TIMESTAMPTZ,
      updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS sessions_user_idx ON sessions(user_id);
    CREATE INDEX IF NOT EXISTS resets_user_idx   ON resets(user_id);
  `);
}

/* ---------- back-end de arquivo ---------- */

function readFile() {
  try {
    return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  } catch {
    return { users: [], sessions: [], resets: [], plaud: [] };
  }
}

function writeFile(db) {
  fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
  fs.writeFileSync(DATA_FILE, JSON.stringify(db, null, 2));
}

/* ---------- usuários ---------- */

async function findUserByEmail(email) {
  const key = String(email || '').trim().toLowerCase();
  if (!key) return null;
  if (usingPostgres) {
    const { rows } = await pool.query('SELECT * FROM users WHERE email = $1', [key]);
    return rows[0] || null;
  }
  return readFile().users.find((u) => u.email === key) || null;
}

async function findUserById(id) {
  if (!id) return null;
  if (usingPostgres) {
    const { rows } = await pool.query('SELECT * FROM users WHERE id = $1', [id]);
    return rows[0] || null;
  }
  return readFile().users.find((u) => u.id === id) || null;
}

async function createUser({ id, email, name, crm }) {
  const user = {
    id,
    email: String(email).trim().toLowerCase(),
    name: String(name).trim(),
    crm: String(crm).trim(),
    password_hash: null,
    created_at: new Date().toISOString(),
    last_login_at: null,
  };
  if (usingPostgres) {
    const { rows } = await pool.query(
      'INSERT INTO users (id, email, name, crm) VALUES ($1, $2, $3, $4) RETURNING *',
      [user.id, user.email, user.name, user.crm]
    );
    return rows[0];
  }
  const db = readFile();
  db.users.push(user);
  writeFile(db);
  return user;
}

async function setUserPassword(userId, passwordHash) {
  if (usingPostgres) {
    await pool.query('UPDATE users SET password_hash = $1 WHERE id = $2', [passwordHash, userId]);
    return;
  }
  const db = readFile();
  const user = db.users.find((u) => u.id === userId);
  if (user) user.password_hash = passwordHash;
  writeFile(db);
}

async function updateUserProfile(userId, { name, crm }) {
  if (usingPostgres) {
    await pool.query('UPDATE users SET name = $1, crm = $2 WHERE id = $3', [name, crm, userId]);
    return;
  }
  const db = readFile();
  const user = db.users.find((u) => u.id === userId);
  if (user) { user.name = name; user.crm = crm; }
  writeFile(db);
}

async function touchLogin(userId) {
  if (usingPostgres) {
    await pool.query('UPDATE users SET last_login_at = NOW() WHERE id = $1', [userId]);
    return;
  }
  const db = readFile();
  const user = db.users.find((u) => u.id === userId);
  if (user) user.last_login_at = new Date().toISOString();
  writeFile(db);
}

/* ---------- sessões ---------- */

async function createSession(tokenHash, userId, expiresAt) {
  if (usingPostgres) {
    await pool.query(
      'INSERT INTO sessions (token_hash, user_id, expires_at) VALUES ($1, $2, $3)',
      [tokenHash, userId, expiresAt]
    );
    return;
  }
  const db = readFile();
  db.sessions.push({ token_hash: tokenHash, user_id: userId, expires_at: expiresAt.toISOString() });
  writeFile(db);
}

async function findSession(tokenHash) {
  if (usingPostgres) {
    const { rows } = await pool.query(
      'SELECT * FROM sessions WHERE token_hash = $1 AND expires_at > NOW()',
      [tokenHash]
    );
    return rows[0] || null;
  }
  const found = readFile().sessions.find((s) => s.token_hash === tokenHash);
  if (!found || new Date(found.expires_at) <= new Date()) return null;
  return found;
}

async function deleteSession(tokenHash) {
  if (usingPostgres) {
    await pool.query('DELETE FROM sessions WHERE token_hash = $1', [tokenHash]);
    return;
  }
  const db = readFile();
  db.sessions = db.sessions.filter((s) => s.token_hash !== tokenHash);
  writeFile(db);
}

/* ---------- tokens de redefinição de senha ---------- */

async function createReset(tokenHash, userId, expiresAt) {
  if (usingPostgres) {
    // Um pedido novo invalida os anteriores: só o link mais recente vale.
    await pool.query('DELETE FROM resets WHERE user_id = $1 AND used_at IS NULL', [userId]);
    await pool.query(
      'INSERT INTO resets (token_hash, user_id, expires_at) VALUES ($1, $2, $3)',
      [tokenHash, userId, expiresAt]
    );
    return;
  }
  const db = readFile();
  db.resets = db.resets.filter((r) => !(r.user_id === userId && !r.used_at));
  db.resets.push({ token_hash: tokenHash, user_id: userId, expires_at: expiresAt.toISOString(), used_at: null });
  writeFile(db);
}

async function consumeReset(tokenHash) {
  if (usingPostgres) {
    // Marca como usado e devolve na mesma query - um token nunca serve duas vezes,
    // nem sob duas requisições simultâneas.
    const { rows } = await pool.query(
      `UPDATE resets SET used_at = NOW()
       WHERE token_hash = $1 AND used_at IS NULL AND expires_at > NOW()
       RETURNING *`,
      [tokenHash]
    );
    return rows[0] || null;
  }
  const db = readFile();
  const reset = db.resets.find((r) => r.token_hash === tokenHash);
  if (!reset || reset.used_at || new Date(reset.expires_at) <= new Date()) return null;
  reset.used_at = new Date().toISOString();
  writeFile(db);
  return reset;
}

/* ---------- credenciais do Plaud (por médico) ---------- */

async function savePlaudTokens(userId, { accessToken, refreshToken, expiresAt }) {
  if (usingPostgres) {
    await pool.query(
      `INSERT INTO plaud_tokens (user_id, access_token, refresh_token, expires_at, updated_at)
       VALUES ($1, $2, $3, $4, NOW())
       ON CONFLICT (user_id) DO UPDATE
         SET access_token = $2, refresh_token = $3, expires_at = $4, updated_at = NOW()`,
      [userId, accessToken, refreshToken || null, expiresAt || null]
    );
    return;
  }
  const db = readFile();
  db.plaud = (db.plaud || []).filter((p) => p.user_id !== userId);
  db.plaud.push({
    user_id: userId,
    access_token: accessToken,
    refresh_token: refreshToken || null,
    expires_at: expiresAt ? expiresAt.toISOString() : null,
  });
  writeFile(db);
}

async function getPlaudTokens(userId) {
  if (usingPostgres) {
    const { rows } = await pool.query('SELECT * FROM plaud_tokens WHERE user_id = $1', [userId]);
    return rows[0] || null;
  }
  return (readFile().plaud || []).find((p) => p.user_id === userId) || null;
}

async function deletePlaudTokens(userId) {
  if (usingPostgres) {
    await pool.query('DELETE FROM plaud_tokens WHERE user_id = $1', [userId]);
    return;
  }
  const db = readFile();
  db.plaud = (db.plaud || []).filter((p) => p.user_id !== userId);
  writeFile(db);
}

module.exports = {
  init,
  usingPostgres,
  findUserByEmail,
  findUserById,
  createUser,
  setUserPassword,
  updateUserProfile,
  touchLogin,
  createSession,
  findSession,
  deleteSession,
  createReset,
  consumeReset,
  savePlaudTokens,
  getPlaudTokens,
  deletePlaudTokens,
};
