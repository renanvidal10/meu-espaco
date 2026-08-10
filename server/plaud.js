'use strict';

// Integração com o Plaud Developer Platform (dev.plaud.ai).
//
// Estado real: a API OAuth do Plaud está em beta privado. Este módulo implementa
// o fluxo completo (authorize -> callback -> troca de código por token -> refresh
// -> listagem e importação de transcrições) e o ativa sozinho assim que
// PLAUD_CLIENT_ID e PLAUD_CLIENT_SECRET existirem no ambiente.
//
// Enquanto as credenciais não chegam, isConfigured() é false e a UI mostra o
// estado honesto de "aguardando aprovação" — em nenhum momento há transcrição
// simulada se passando por real.
//
// Os endpoints abaixo seguem a convenção OAuth 2.0 documentada pelo Plaud e são
// sobrescrevíveis por variável de ambiente, para o caso de o beta publicar
// caminhos diferentes do previsto sem exigir mudança de código.

const store = require('./store');

const AUTH_URL = process.env.PLAUD_AUTH_URL || 'https://api.plaud.ai/oauth/authorize';
const TOKEN_URL = process.env.PLAUD_TOKEN_URL || 'https://api.plaud.ai/oauth/token';
const API_BASE = process.env.PLAUD_API_BASE || 'https://api.plaud.ai/v1';
const SCOPE = process.env.PLAUD_SCOPE || 'recordings.read transcripts.read';

function isConfigured() {
  return Boolean(process.env.PLAUD_CLIENT_ID && process.env.PLAUD_CLIENT_SECRET);
}

function redirectUri(req) {
  if (process.env.PLAUD_REDIRECT_URI) return process.env.PLAUD_REDIRECT_URI;
  // Render termina o TLS no proxy; sem confiar no x-forwarded-proto o callback
  // seria montado como http:// e o provedor rejeitaria por incompatibilidade.
  const proto = req.get('x-forwarded-proto') || req.protocol;
  return `${proto}://${req.get('host')}/api/plaud/callback`;
}

function authorizeUrl({ req, state }) {
  const params = new URLSearchParams({
    client_id: process.env.PLAUD_CLIENT_ID,
    redirect_uri: redirectUri(req),
    response_type: 'code',
    scope: SCOPE,
    state,
  });
  return `${AUTH_URL}?${params.toString()}`;
}

async function postToken(body) {
  const response = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: process.env.PLAUD_CLIENT_ID,
      client_secret: process.env.PLAUD_CLIENT_SECRET,
      ...body,
    }).toString(),
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const detail = payload.error_description || payload.error || `HTTP ${response.status}`;
    throw new Error(`Plaud recusou a troca de token: ${detail}`);
  }
  return payload;
}

async function exchangeCode({ req, code }) {
  const payload = await postToken({
    grant_type: 'authorization_code',
    code,
    redirect_uri: redirectUri(req),
  });
  return {
    accessToken: payload.access_token,
    refreshToken: payload.refresh_token || null,
    expiresAt: payload.expires_in ? new Date(Date.now() + payload.expires_in * 1000) : null,
  };
}

async function refresh(refreshToken) {
  const payload = await postToken({ grant_type: 'refresh_token', refresh_token: refreshToken });
  return {
    accessToken: payload.access_token,
    refreshToken: payload.refresh_token || refreshToken,
    expiresAt: payload.expires_in ? new Date(Date.now() + payload.expires_in * 1000) : null,
  };
}

// Devolve um access token válido, renovando por refresh quando faltar menos de
// um minuto para expirar. Sem refresh token utilizável, sinaliza reconexão.
async function validAccessToken(userId) {
  const stored = await store.getPlaudTokens(userId);
  if (!stored) return null;

  const expiresAt = stored.expires_at ? new Date(stored.expires_at) : null;
  const stillValid = !expiresAt || expiresAt.getTime() - Date.now() > 60_000;
  if (stillValid) return stored.access_token;

  if (!stored.refresh_token) return null;
  const renewed = await refresh(stored.refresh_token);
  await store.savePlaudTokens(userId, renewed);
  return renewed.accessToken;
}

async function apiGet(userId, path) {
  const token = await validAccessToken(userId);
  if (!token) {
    const err = new Error('Conexão com o Plaud expirou. Conecte novamente.');
    err.code = 'PLAUD_REAUTH';
    throw err;
  }

  const response = await fetch(`${API_BASE}${path}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
  });

  if (response.status === 401) {
    const err = new Error('Conexão com o Plaud expirou. Conecte novamente.');
    err.code = 'PLAUD_REAUTH';
    throw err;
  }
  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new Error(`Plaud respondeu ${response.status}: ${detail.slice(0, 200)}`);
  }
  return response.json();
}

// O beta ainda pode mudar o formato de resposta; normalizamos para um shape
// estável para a UI não quebrar a cada ajuste do provedor.
function normalizeRecording(raw) {
  return {
    id: raw.id || raw.recording_id || raw.uuid,
    title: raw.title || raw.name || 'Gravação sem título',
    createdAt: raw.created_at || raw.createdAt || raw.start_time || null,
    durationSec: raw.duration || raw.duration_sec || null,
    hasTranscript: Boolean(raw.transcript || raw.has_transcript || raw.transcription),
  };
}

function extractTranscriptText(raw) {
  if (!raw) return '';
  if (typeof raw === 'string') return raw;
  if (typeof raw.text === 'string') return raw.text;
  if (typeof raw.transcript === 'string') return raw.transcript;
  if (Array.isArray(raw.segments)) {
    return raw.segments.map((s) => s.text || s.content || '').filter(Boolean).join(' ');
  }
  if (Array.isArray(raw.paragraphs)) {
    return raw.paragraphs.map((p) => p.text || '').filter(Boolean).join('\n');
  }
  return '';
}

async function listRecordings(userId, { limit = 20 } = {}) {
  const data = await apiGet(userId, `/recordings?limit=${encodeURIComponent(limit)}`);
  const items = Array.isArray(data) ? data : data.items || data.data || data.recordings || [];
  return items.map(normalizeRecording).filter((r) => r.id);
}

async function fetchTranscript(userId, recordingId) {
  const data = await apiGet(userId, `/recordings/${encodeURIComponent(recordingId)}/transcript`);
  const text = extractTranscriptText(data).trim();
  if (!text) throw new Error('Esta gravação ainda não tem transcrição disponível no Plaud.');
  return text;
}

module.exports = {
  isConfigured,
  authorizeUrl,
  exchangeCode,
  listRecordings,
  fetchTranscript,
  redirectUri,
};
