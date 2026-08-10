'use strict';

// Autenticação do OncoGenYX.
//
// Decisões relevantes, dado que a plataforma trafega dado de saúde:
//   - Senha via scrypt (KDF do próprio Node, sem dependência nativa a compilar),
//     salt aleatório por usuário, comparação em tempo constante.
//   - Token de sessão gerado com CSPRNG e guardado só como hash SHA-256: um
//     vazamento do banco não entrega sessões ativas.
//   - Token de redefinição de uso único, 60 min, invalidado ao gerar um novo.
//   - As respostas de "esqueci a senha" e de primeiro acesso são idênticas
//     independentemente do email existir — não confirmam cadastro a terceiros.
//   - Rate limiting por IP+email nas rotas de login e de envio de link.

const crypto = require('crypto');
const store = require('./store');

const SESSION_TTL_MS = 1000 * 60 * 60 * 12;   // 12 horas
const RESET_TTL_MS = 1000 * 60 * 60;          // 60 minutos
const SCRYPT_KEYLEN = 64;

/* ---------- senha ---------- */

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = crypto.scryptSync(password, salt, SCRYPT_KEYLEN).toString('hex');
  return `scrypt$${salt}$${derived}`;
}

function verifyPassword(password, stored) {
  if (!stored) return false;
  const [scheme, salt, expected] = String(stored).split('$');
  if (scheme !== 'scrypt' || !salt || !expected) return false;
  const derived = crypto.scryptSync(password, salt, SCRYPT_KEYLEN).toString('hex');
  const a = Buffer.from(derived, 'hex');
  const b = Buffer.from(expected, 'hex');
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

// Regra de senha: comprimento é o que mais importa (NIST SP 800-63B); exigir
// símbolo/maiúscula empurra o usuário para padrões previsíveis e para o post-it.
function validatePassword(password) {
  if (typeof password !== 'string' || password.length < 10) {
    return 'A senha precisa ter no mínimo 10 caracteres.';
  }
  if (password.length > 200) return 'Senha longa demais.';
  const trivial = ['senha', 'password', '1234567890', 'oncogenyx'];
  if (trivial.some((t) => password.toLowerCase().includes(t))) {
    return 'Escolha uma senha que não contenha palavras óbvias como "senha" ou o nome da plataforma.';
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

async function issueSession(userId) {
  const token = newToken();
  await store.createSession(hashToken(token), userId, new Date(Date.now() + SESSION_TTL_MS));
  return token;
}

async function resolveSession(token) {
  if (!token) return null;
  const session = await store.findSession(hashToken(token));
  if (!session) return null;
  return store.findUserById(session.user_id);
}

async function revokeSession(token) {
  if (token) await store.deleteSession(hashToken(token));
}

async function issueResetToken(userId) {
  const token = newToken();
  await store.createReset(hashToken(token), userId, new Date(Date.now() + RESET_TTL_MS));
  return token;
}

async function consumeResetToken(token) {
  if (!token) return null;
  return store.consumeReset(hashToken(token));
}

/* ---------- rate limiting ---------- */

// Contador em memória: reinicia junto com o processo, o que é aceitável para
// travar ataque de força bruta oportunista. Defesa contra atacante distribuído
// e persistente é responsabilidade da borda (Cloudflare/WAF), não daqui.
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

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email);
}

/* ---------- middleware ---------- */

function bearerToken(req) {
  const header = req.get('authorization') || '';
  if (header.startsWith('Bearer ')) return header.slice(7).trim();
  return null;
}

function requireAuth() {
  return async (req, res, next) => {
    try {
      const user = await resolveSession(bearerToken(req));
      if (!user) return res.status(401).json({ error: 'Sessão expirada. Entre novamente.' });
      req.user = user;
      next();
    } catch (err) {
      next(err);
    }
  };
}

function publicUser(user) {
  return { id: user.id, email: user.email, name: user.name, crm: user.crm };
}

module.exports = {
  hashPassword,
  verifyPassword,
  validatePassword,
  issueSession,
  resolveSession,
  revokeSession,
  issueResetToken,
  consumeResetToken,
  rateLimit,
  normalizeEmail,
  isValidEmail,
  bearerToken,
  requireAuth,
  publicUser,
  newToken,
};
