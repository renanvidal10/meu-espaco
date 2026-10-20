'use strict';

// Escolha do provedor de IA (ARQUITETURA.md §86). Cada caso roda num processo
// próprio, porque ia.js lê o ambiente uma vez, ao carregar.

const test = require('node:test');
const assert = require('node:assert');
const { execFileSync } = require('node:child_process');
const path = require('node:path');

const IA = path.join(__dirname, '..', 'ia.js');

function avaliar(env, codigo) {
  const limpo = { ...process.env };
  for (const k of ['IA_PROVEDOR', 'IA_MODELO', 'VERTEX_REGIAO', 'VERTEX_PROJETO', 'PERMITIR_REGIAO_GLOBAL', 'NODE_ENV']) delete limpo[k];
  const saida = execFileSync(process.execPath, ['-e', `const ia = require(${JSON.stringify(IA)}); console.log(JSON.stringify(${codigo}));`], {
    env: { ...limpo, ...env },
    encoding: 'utf8',
  });
  return JSON.parse(saida);
}

test('sem IA_PROVEDOR: API direta em desenvolvimento, Vertex em produção', () => {
  assert.strictEqual(avaliar({}, 'ia.PROVEDOR'), 'anthropic');
  assert.strictEqual(avaliar({ NODE_ENV: 'production' }, 'ia.PROVEDOR'), 'vertex');
});

test('Vertex padrão: multirregião dos EUA e o mesmo modelo de antes', () => {
  const r = avaliar({ IA_PROVEDOR: 'vertex', VERTEX_PROJETO: 'p' }, '{ regiao: ia.REGIAO, modelo: ia.MODELO, problemas: ia.problemasDeConfiguracao() }');
  assert.strictEqual(r.regiao, 'us');
  assert.strictEqual(r.modelo, 'claude-opus-5');
  assert.deepStrictEqual(r.problemas, []);
});

test('Vertex sem projeto, provedor inválido e região global em produção derrubam o boot', () => {
  assert.match(avaliar({ IA_PROVEDOR: 'vertex' }, 'ia.problemasDeConfiguracao()').join(' '), /VERTEX_PROJETO/);
  assert.match(avaliar({ IA_PROVEDOR: 'openai' }, 'ia.problemasDeConfiguracao()').join(' '), /não é válido/);
  const global = { NODE_ENV: 'production', IA_PROVEDOR: 'vertex', VERTEX_PROJETO: 'p', VERTEX_REGIAO: 'global' };
  assert.match(avaliar(global, 'ia.problemasDeConfiguracao()').join(' '), /global/);
  assert.deepStrictEqual(avaliar({ ...global, PERMITIR_REGIAO_GLOBAL: 'sim' }, 'ia.problemasDeConfiguracao()'), []);
});

test('API direta em produção avisa que o laudo vai aos EUA', () => {
  const a = avaliar({ NODE_ENV: 'production', IA_PROVEDOR: 'anthropic', ANTHROPIC_API_KEY: 'x' }, 'ia.avisos()');
  assert.match(a.join(' '), /EUA/);
});

test('carregar ia.js com Vertex não procura credencial do Google antes da primeira chamada', () => {
  // A biblioteca do Vertex busca credencial ao nascer; sem credencial, isso
  // virava exceção solta no boot da máquina do dev.
  const r = avaliar({ IA_PROVEDOR: 'vertex', VERTEX_PROJETO: 'p' }, 'ia.descricao()');
  assert.match(r, /Vertex AI \(us\)/);
});

test('o cliente do Vertex aponta para a multirregião dos EUA, com o modelo na URL', async () => {
  // Monta o pedido sem enviar: a biblioteca troca o fetch por este espião.
  const saida = execFileSync(process.execPath, ['-e', `
    const { AnthropicVertex } = require('@anthropic-ai/vertex-sdk');
    let url = null, corpo = null, cab = null;
    const c = new AnthropicVertex({
      projectId: 'meu-projeto', region: 'us',
      authClient: { getRequestHeaders: async () => new Headers({ authorization: 'Bearer token-falso' }) },
      fetch: async (u, init) => { url = String(u); corpo = JSON.parse(init.body); cab = new Headers(init.headers).get('authorization'); return new Response(JSON.stringify({ id: 'x', type: 'message', role: 'assistant', content: [{ type: 'text', text: 'ok' }], model: 'claude-opus-5', stop_reason: 'end_turn', usage: { input_tokens: 1, output_tokens: 1 } }), { status: 200, headers: { 'content-type': 'application/json' } }); },
    });
    c.messages.create({ model: 'claude-opus-5', max_tokens: 5, messages: [{ role: 'user', content: 'oi' }] })
      .then(() => console.log(JSON.stringify({ url, corpo, cab })));
  `], { cwd: path.join(__dirname, '..'), encoding: 'utf8' });
  const { url, corpo, cab } = JSON.parse(saida.trim().split('\n').pop());
  assert.strictEqual(url, 'https://aiplatform.us.rep.googleapis.com/v1/projects/meu-projeto/locations/us/publishers/anthropic/models/claude-opus-5:rawPredict');
  assert.strictEqual(corpo.anthropic_version, 'vertex-2023-10-16');
  assert.strictEqual(corpo.model, undefined, 'no Vertex o modelo vai na URL, não no corpo');
  assert.strictEqual(cab, 'Bearer token-falso', 'a credencial do Google não foi aplicada');
});

test('região fora de us, eu e global gera aviso (o Opus 5 não existe em São Paulo)', () => {
  const a = avaliar({ IA_PROVEDOR: 'vertex', VERTEX_PROJETO: 'p', VERTEX_REGIAO: 'southamerica-east1' }, 'ia.avisos()');
  assert.match(a.join(' '), /só é oferecido em us, eu e global/);
});
