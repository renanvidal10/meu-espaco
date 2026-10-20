'use strict';

// Cifra em repouso para segredos de terceiros guardados no banco (hoje, os
// tokens do Plaud). ARQUITETURA.md §85.2.
//
// AES-256-GCM com chave derivada de CHAVE_CIFRA. A derivação por SHA-256
// deixa o dono colar qualquer texto longo e aleatório como chave, sem precisar
// acertar um formato. Sem CHAVE_CIFRA (desenvolvimento) o valor é guardado
// como veio; em produção o boot exige a chave no modo completo (index.js).
//
// Formato: "c1:<iv>:<tag>:<conteudo>", tudo em base64url. Valor sem o prefixo
// é tratado como legado em texto puro e devolvido como está; na próxima
// gravação ele já sai cifrado.

const crypto = require('crypto');

const PREFIXO = 'c1:';

function chave() {
  const bruta = process.env.CHAVE_CIFRA;
  if (!bruta) return null;
  return crypto.createHash('sha256').update(String(bruta)).digest();
}

function cifrar(texto) {
  if (texto == null) return texto;
  const k = chave();
  if (!k) return texto;
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', k, iv);
  const conteudo = Buffer.concat([c.update(String(texto), 'utf8'), c.final()]);
  const tag = c.getAuthTag();
  return PREFIXO + [iv, tag, conteudo].map((b) => b.toString('base64url')).join(':');
}

function decifrar(valor) {
  if (valor == null) return valor;
  const s = String(valor);
  if (!s.startsWith(PREFIXO)) return s;
  const k = chave();
  if (!k) throw new Error('Há segredo cifrado no banco, mas CHAVE_CIFRA não está definida.');
  const [iv, tag, conteudo] = s.slice(PREFIXO.length).split(':').map((p) => Buffer.from(p, 'base64url'));
  const d = crypto.createDecipheriv('aes-256-gcm', k, iv);
  d.setAuthTag(tag);
  return Buffer.concat([d.update(conteudo), d.final()]).toString('utf8');
}

function estaCifrado(valor) {
  return typeof valor === 'string' && valor.startsWith(PREFIXO);
}

module.exports = { cifrar, decifrar, estaCifrado, configurada: () => Boolean(process.env.CHAVE_CIFRA) };
