'use strict';

// Teste de integração da rota /api/extract: HTTP real contra o servidor real,
// com a API da Anthropic substituída por um stub que registra o que recebeu.
//
// Cobre as entradas que um médico usa de verdade — texto, PDF, PDF assinado,
// imagem, ditado (que vira texto), combinações — e as saídas de erro.

const test = require('node:test');
const assert = require('node:assert');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { arquivoDeDadosTemporario } = require('./temporario.js');

const { criarStub } = require('./stub-anthropic.js');
const { criaPdf, ENVELOPE_ASSINATURA } = require('./util-pdf.js');
const TUMORS = require('../public/tumors.js');

let stub;
let app;
let base;
let token;

// PNG 1x1 válido, para o caminho de imagem.
const PNG_MINIMO = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

async function esperarSaude(url, tentativas = 60) {
  for (let i = 0; i < tentativas; i++) {
    try {
      const r = await fetch(url + '/api/health');
      if (r.ok) return;
    } catch (e) { /* ainda subindo */ }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error('o servidor não subiu a tempo');
}

test.before(async () => {
  stub = criarStub();
  const portaStub = await stub.ouvir(0);

  const dataFile = arquivoDeDadosTemporario('int');
  const porta = 4300 + Math.floor(Math.random() * 500);
  base = `http://127.0.0.1:${porta}`;

  app = spawn(process.execPath, [path.join(__dirname, '..', 'index.js')], {
    env: {
      ...process.env,
      PORT: String(porta),
      NODE_ENV: 'test',
      DATA_FILE: dataFile,
      ANTHROPIC_API_KEY: 'chave-de-teste',
      ANTHROPIC_BASE_URL: `http://127.0.0.1:${portaStub}`,
      DATABASE_URL: '',
      RESEND_API_KEY: '',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  app.stderr.on('data', (d) => {
    const t = String(d);
    if (!/DeprecationWarning|punycode/.test(t)) process.stderr.write('[app] ' + t);
  });

  await esperarSaude(base);

  const r = await fetch(base + '/api/auth/acesso', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: 'Renan Vidal', crm: '339324' }),
  });
  token = (await r.json()).token;
  assert.ok(token, 'não obteve sessão');
});

test.after(async () => {
  if (app) app.kill();
  if (stub) await stub.fechar();
});

function form(partes) {
  const fd = new FormData();
  if (partes.texto !== undefined) fd.append('text', partes.texto);
  (partes.arquivos || []).forEach(({ nome, buffer, tipo }) => {
    fd.append('files', new Blob([buffer], { type: tipo }), nome);
  });
  return fd;
}

async function extrair(partes, { autenticado = true } = {}) {
  const r = await fetch(base + '/api/extract', {
    method: 'POST',
    headers: autenticado ? { Authorization: 'Bearer ' + token } : {},
    body: form(partes),
  });
  return { status: r.status, corpo: await r.json() };
}

/* ==================== ENTRADAS QUE FUNCIONAM ==================== */

test('texto puro chega ao modelo e volta estruturado', async () => {
  stub.limpar();
  stub.responderCom({
    tipo: 'ok',
    extracao: {
      tipo_tumor: 'Ginecológico - Ovário',
      ovario__histologia: 'Seroso',
      ovario__grau: 'Alto grau',
      ovario__estadiamento: 'IIIC',
      idade: '61',
    },
  });

  const { status, corpo } = await extrair({ texto: 'Mulher de 61 anos, carcinoma seroso de alto grau de ovário, estágio IIIC.' });

  assert.strictEqual(status, 200);
  assert.strictEqual(corpo.extracted.tipo_tumor, 'Ginecológico - Ovário');
  assert.strictEqual(corpo.extracted.histologia, 'Seroso');
  assert.strictEqual(corpo.extracted.estadiamento, 'IIIC');
  assert.strictEqual(corpo.extracted.idade, '61');
  // A chave namespaced nunca pode vazar para o navegador.
  assert.ok(!('ovario__histologia' in corpo.extracted));

  const blocos = stub.blocos();
  assert.strictEqual(blocos.length, 1);
  assert.strictEqual(blocos[0].type, 'text');
  assert.match(blocos[0].text, /61 anos/);
});

test('PDF comum é enviado como documento', async () => {
  stub.limpar();
  stub.responderCom({ tipo: 'ok', extracao: { tipo_tumor: 'Próstata', prostata__extensao_doenca: 'Metastático resistente à castração (mCRPC)' } });

  const { status, corpo } = await extrair({
    arquivos: [{ nome: 'laudo.pdf', buffer: criaPdf('adenocarcinoma de prostata'), tipo: 'application/pdf' }],
  });

  assert.strictEqual(status, 200);
  assert.strictEqual(corpo.extracted.extensao_doenca, 'Metastático resistente à castração (mCRPC)');

  const blocos = stub.blocos();
  const doc = blocos.find((b) => b.type === 'document');
  assert.ok(doc, 'o PDF não foi enviado como documento');
  assert.strictEqual(doc.source.media_type, 'application/pdf');
  const enviado = Buffer.from(doc.source.data, 'base64');
  assert.strictEqual(enviado.subarray(0, 5).toString('latin1'), '%PDF-');
});

test('PDF dentro de envelope de assinatura digital chega desembrulhado à API', async () => {
  stub.limpar();
  stub.responderCom({ tipo: 'ok', extracao: { tipo_tumor: 'Próstata', prostata__extensao_doenca: 'Metastático hormônio-sensível (mHSPC)' } });

  const dentro = criaPdf('RELATORIO ONCOLOGICO adenocarcinoma de prostata');
  const assinado = Buffer.concat([ENVELOPE_ASSINATURA, dentro, Buffer.from('certificado-icp-brasil')]);
  assert.notStrictEqual(assinado.subarray(0, 5).toString('latin1'), '%PDF-');

  const { status, corpo } = await extrair({
    arquivos: [{ nome: 'SOLICITACAO123.pdf', buffer: assinado, tipo: 'application/pdf' }],
  });

  assert.strictEqual(status, 200);
  const doc = stub.blocos().find((b) => b.type === 'document');
  const enviado = Buffer.from(doc.source.data, 'base64');
  assert.strictEqual(enviado.subarray(0, 5).toString('latin1'), '%PDF-',
    'o envelope de assinatura foi enviado cru para a API');
  assert.ok(enviado.length < assinado.length);

  const aviso = (corpo.avisos || []).find((a) => a.recuperado);
  assert.ok(aviso, 'o médico não foi avisado do desembrulho');
  assert.match(aviso.motivo, /assinatura digital/i);
});

test('imagem é enviada como bloco de imagem', async () => {
  stub.limpar();
  stub.responderCom({ tipo: 'ok', extracao: { tipo_tumor: 'Mama', mama__subtipo_molecular: 'Triplo-negativo' } });

  const { status, corpo } = await extrair({
    arquivos: [{ nome: 'foto.png', buffer: PNG_MINIMO, tipo: 'image/png' }],
  });

  assert.strictEqual(status, 200);
  assert.strictEqual(corpo.extracted.subtipo_molecular, 'Triplo-negativo');
  const img = stub.blocos().find((b) => b.type === 'image');
  assert.ok(img, 'a imagem não foi enviada');
  assert.strictEqual(img.source.media_type, 'image/png');
});

test('texto + PDF + imagem juntos viram uma só chamada com três blocos', async () => {
  stub.limpar();
  stub.responderCom({ tipo: 'ok', extracao: { tipo_tumor: 'Colorretal', colorretal__mmr_msi: 'dMMR / MSI-alto' } });

  const { status } = await extrair({
    texto: 'Complemento: tio materno com câncer de cólon aos 47.',
    arquivos: [
      { nome: 'laudo.pdf', buffer: criaPdf('adenocarcinoma de sigmoide'), tipo: 'application/pdf' },
      { nome: 'foto.png', buffer: PNG_MINIMO, tipo: 'image/png' },
    ],
  });

  assert.strictEqual(status, 200);
  const blocos = stub.blocos();
  assert.strictEqual(blocos.filter((b) => b.type === 'document').length, 1);
  assert.strictEqual(blocos.filter((b) => b.type === 'image').length, 1);
  assert.strictEqual(blocos.filter((b) => b.type === 'text').length, 1);
  assert.match(blocos.find((b) => b.type === 'text').text, /tio materno/);
});

test('vários PDFs no mesmo caso', async () => {
  stub.limpar();
  stub.responderCom({ tipo: 'ok', extracao: { tipo_tumor: 'Pâncreas', pancreas__histologia: 'Adenocarcinoma ductal' } });
  const { status } = await extrair({
    arquivos: [
      { nome: 'a.pdf', buffer: criaPdf('anatomopatologico'), tipo: 'application/pdf' },
      { nome: 'b.pdf', buffer: criaPdf('evolucao clinica'), tipo: 'application/pdf' },
    ],
  });
  assert.strictEqual(status, 200);
  assert.strictEqual(stub.blocos().filter((b) => b.type === 'document').length, 2);
});

test('PDF sem mimetype (comum no iOS) é reconhecido pela extensão', async () => {
  stub.limpar();
  stub.responderCom({ tipo: 'ok', extracao: { tipo_tumor: 'Ginecológico - Ovário', ovario__histologia: 'Seroso' } });
  const { status } = await extrair({
    arquivos: [{ nome: 'laudo.pdf', buffer: criaPdf('carcinoma seroso'), tipo: 'application/octet-stream' }],
  });
  assert.strictEqual(status, 200);
  assert.ok(stub.blocos().some((b) => b.type === 'document'), 'PDF sem mimetype foi descartado');
});

/* ==================== ENTRADAS QUE FALHAM BEM ==================== */

test('sem texto e sem arquivo: recusa antes de chamar o modelo', async () => {
  stub.limpar();
  const { status, corpo } = await extrair({ texto: '' });
  assert.strictEqual(status, 400);
  assert.match(corpo.error, /texto ou arquivo/i);
  assert.strictEqual(stub.estado.requisicoes.length, 0, 'gastou chamada à toa');
});

test('sem sessão: 401 e nenhuma chamada gasta', async () => {
  stub.limpar();
  const { status } = await extrair({ texto: 'qualquer coisa' }, { autenticado: false });
  assert.strictEqual(status, 401);
  assert.strictEqual(stub.estado.requisicoes.length, 0);
});

test('PDF de 0 byte: barrado com instrução, sem gastar chamada', async () => {
  stub.limpar();
  const { status, corpo } = await extrair({
    arquivos: [{ nome: 'vazio.pdf', buffer: Buffer.alloc(0), tipo: 'application/pdf' }],
  });
  assert.strictEqual(status, 400);
  assert.match(corpo.error, /vazio/i);
  assert.match(corpo.error, /iCloud|Drive/i);
  assert.strictEqual(stub.estado.requisicoes.length, 0);
});

test('HTML com extensão .pdf: barrado com instrução', async () => {
  stub.limpar();
  const { status, corpo } = await extrair({
    arquivos: [{ nome: 'laudo.pdf', buffer: Buffer.from('<html>404</html>'), tipo: 'application/pdf' }],
  });
  assert.strictEqual(status, 400);
  assert.match(corpo.error, /não é um PDF válido/i);
  assert.strictEqual(stub.estado.requisicoes.length, 0);
});

test('PDF protegido por senha: barrado com o caminho da solução', async () => {
  stub.limpar();
  const protegido = Buffer.concat([criaPdf('laudo'), Buffer.from('\ntrailer<< /Encrypt 9 0 R >>\n%%EOF')]);
  const { status, corpo } = await extrair({
    arquivos: [{ nome: 'laudo.pdf', buffer: protegido, tipo: 'application/pdf' }],
  });
  assert.strictEqual(status, 400);
  assert.match(corpo.error, /senha|restrição/i);
  assert.match(corpo.error, /imprima|foto/i);
});

test('arquivo que não é PDF nem imagem: barrado nomeando o arquivo', async () => {
  stub.limpar();
  const { status, corpo } = await extrair({
    arquivos: [{ nome: 'planilha.xlsx', buffer: Buffer.from('PK\x03\x04qualquer'), tipo: 'application/vnd.ms-excel' }],
  });
  assert.strictEqual(status, 400);
  assert.match(corpo.error, /planilha\.xlsx/);
  assert.match(corpo.error, /PDF nem imagem/i);
});

test('arquivo ruim junto com texto bom: segue com o texto e avisa do arquivo', async () => {
  stub.limpar();
  stub.responderCom({ tipo: 'ok', extracao: { tipo_tumor: 'Ginecológico - Ovário', ovario__histologia: 'Seroso' } });
  const { status, corpo } = await extrair({
    texto: 'Carcinoma seroso de ovário, alto grau, estágio IIIC.',
    arquivos: [{ nome: 'vazio.pdf', buffer: Buffer.alloc(0), tipo: 'application/pdf' }],
  });
  assert.strictEqual(status, 200, 'um anexo ruim não pode derrubar um caso que tem texto');
  assert.strictEqual(corpo.extracted.histologia, 'Seroso');
  assert.ok((corpo.avisos || []).some((a) => /vazio/i.test(a.motivo)), 'não avisou do anexo descartado');
});

/* ==================== RECUPERAÇÃO E ERROS DA API ==================== */

test('API recusa o PDF: o texto é extraído localmente e a chamada é refeita', async () => {
  stub.limpar();
  stub.responderCom({ tipo: 'erro', status: 400, mensagem: 'messages.0.content.0.pdf.source.base64.data: The PDF specified was not valid.' });
  stub.responderCom({ tipo: 'ok', extracao: { tipo_tumor: 'Ginecológico - Ovário', ovario__histologia: 'Seroso', ovario__estadiamento: 'IIIC' } });

  const { status, corpo } = await extrair({
    arquivos: [{ nome: 'laudo.pdf', buffer: criaPdf('carcinoma seroso de ovario estagio IIIC'), tipo: 'application/pdf' }],
  });

  assert.strictEqual(status, 200, 'a recuperação não aconteceu');
  assert.strictEqual(corpo.extracted.histologia, 'Seroso');
  assert.strictEqual(stub.estado.requisicoes.length, 2, 'deveria ter tentado duas vezes');

  // A segunda chamada não pode levar documento, e tem de levar o texto extraído.
  const segunda = stub.estado.requisicoes[1].corpo.messages[0].content;
  assert.ok(!segunda.some((b) => b.type === 'document'), 'reenviou o PDF que já foi recusado');
  assert.match(segunda.find((b) => b.type === 'text').text, /carcinoma seroso/i);

  const aviso = (corpo.avisos || []).find((a) => a.recuperado);
  assert.ok(aviso, 'não avisou que o conteúdo foi recuperado por outro caminho');
});

test('erro 429 vira mensagem de espera, não jargão', async () => {
  stub.limpar();
  // 4 vezes: o SDK reenvia sozinho em 429, então uma só não chega ao handler.
  stub.responderCom({ tipo: 'erro', status: 429, mensagem: 'rate_limit_error' }, 4);
  const { corpo } = await extrair({ texto: 'caso qualquer' });
  assert.match(corpo.error, /solicitações|instantes|segundos/i);
  assert.doesNotMatch(corpo.error, /rate_limit|429|request_id/i);
});

test('erro 401 aponta para a configuração, sem expor detalhe', async () => {
  stub.limpar();
  stub.responderCom({ tipo: 'erro', status: 401, mensagem: 'invalid x-api-key' });
  const { corpo } = await extrair({ texto: 'caso qualquer' });
  assert.match(corpo.error, /chave|crédito|configuração/i);
  assert.doesNotMatch(corpo.error, /x-api-key/i);
});

test('nenhuma mensagem de erro vaza jargão técnico da API', async () => {
  const cenarios = [
    { status: 400, mensagem: 'messages.0.content.0.pdf.source.base64.data: The PDF specified was not valid.' },
    { status: 429, mensagem: 'rate_limit_error: too many requests' },
    { status: 401, mensagem: 'invalid x-api-key' },
    { status: 413, mensagem: 'request too large' },
    { status: 500, mensagem: 'internal server error' },
    { status: 529, mensagem: 'overloaded_error' },
  ];
  for (const c of cenarios) {
    stub.limpar();
    stub.responderCom({ tipo: 'erro', ...c }, 4);
    const { corpo } = await extrair({ texto: 'caso qualquer' });
    assert.ok(corpo.error, `status ${c.status}: sem mensagem`);
    assert.doesNotMatch(
      corpo.error,
      /base64|invalid_request|request_id|messages\.0|x-api-key|rate_limit_error|overloaded_error|\{|\}/,
      `status ${c.status} vazou jargão: ${corpo.error}`,
    );
    // Uma linha comprida sem espaço quebra o layout; nunca deve existir.
    const maiorPalavra = Math.max(...corpo.error.split(/\s+/).map((p) => p.length));
    assert.ok(maiorPalavra < 40, `status ${c.status}: palavra de ${maiorPalavra} caracteres quebra o layout`);
  }
});

test('subtipo não identificado volta sem inventar campo', async () => {
  stub.limpar();
  stub.responderCom({ tipo: 'ok', extracao: { tipo_tumor: 'Não identificado' } });
  const { status, corpo } = await extrair({ texto: 'Consulta de rotina, exames normais.' });
  assert.strictEqual(status, 200);
  assert.strictEqual(corpo.extracted.tipo_tumor, 'Não identificado');
  TUMORS.CHAVES_COMUNS.forEach((k) => assert.strictEqual(corpo.extracted[k], ''));
});

/* ==================== O QUE O SERVIDOR ENVIA ==================== */

test('o schema enviado usa chaves simples e cobre os valores de todos os tumores', async () => {
  stub.limpar();
  stub.responderCom({ tipo: 'ok', extracao: { tipo_tumor: 'Próstata' } });
  await extrair({ texto: 'caso' });

  // primeira(), nao ultima(): a resposta acima so tem tipo_tumor, que e a
  // assinatura de extracao abandonada, entao o servidor dispara uma segunda
  // chamada com o schema reduzido ao subtipo. E a PRIMEIRA que carrega o
  // schema unificado que este teste verifica.
  const schema = stub.primeira().corpo.output_config.format.schema;
  const chaves = Object.keys(schema.properties);

  // Nenhuma chave sintética: foi o desenho que o modelo ignorou em produção.
  chaves.forEach((k) => assert.doesNotMatch(k, /__/, `chave sintética no schema: ${k}`));

  // extensao_doenca existe UMA vez, com a união dos valores dos cinco tumores.
  assert.strictEqual(chaves.filter((k) => k === 'extensao_doenca').length, 1);
  const ext = schema.properties.extensao_doenca;
  ['Metastático resistente à castração (mCRPC)', 'Linfonodo positivo (N1)', 'Ressecável',
   'Localizado / ressecado', 'Inicial (ressecável)', 'Inicial (operável)'].forEach((v) => {
    assert.ok(ext.enum.includes(v), `o valor "${v}" não chegou ao modelo`);
  });
  assert.ok(ext.enum.includes(''), 'falta a string vazia para "não se aplica"');
  // A descrição precisa dizer quais valores pertencem a qual subtipo.
  assert.match(ext.description, /Próstata/);
  assert.match(ext.description, /mCRPC/);

  // histologia é texto livre: tem lista fechada só no pulmão.
  assert.ok(!schema.properties.histologia.enum, 'histologia com enum travaria os outros seis tumores');

  TUMORS.CHAVES_COMUNS.forEach((k) => {
    assert.ok(chaves.includes(k), `campo comum ${k} ausente`);
    assert.strictEqual(chaves.filter((c) => c === k).length, 1);
  });

  assert.strictEqual(schema.additionalProperties, false);
  assert.deepStrictEqual([...schema.required].sort(), [...chaves].sort());
  assert.ok(chaves.length <= 25, `${chaves.length} propriedades; acima de 25 o preenchimento degrada`);
});

// O caso exato que falhou em produção: descrição em texto livre de ovário.
test('caso de ovário em texto livre volta com histologia, grau e estágio', async () => {
  stub.limpar();
  stub.responderCom({
    tipo: 'ok',
    extracao: {
      tipo_tumor: 'Ginecológico - Ovário',
      histologia: 'Seroso', grau: 'Alto grau', estadiamento: 'IIIC',
      idade: '61', historico_familiar: 'Irmã com câncer de mama aos 45 anos',
    },
  });
  const { corpo } = await extrair({
    texto: 'Mulher 61 anos com câncer epitelial de ovario seroso de alto grau 3c, e com irmã com câncer de mama aos 45 anos',
  });
  assert.strictEqual(corpo.extracted.histologia, 'Seroso');
  assert.strictEqual(corpo.extracted.grau, 'Alto grau');
  assert.strictEqual(corpo.extracted.estadiamento, 'IIIC');
  assert.strictEqual(corpo.extracted.idade, '61');
  assert.match(corpo.extracted.historico_familiar, /Irmã/);
});

test('o prompt lista os sete subtipos e exige normalização de escrita', async () => {
  stub.limpar();
  stub.responderCom({ tipo: 'ok', extracao: { tipo_tumor: 'Mama' } });
  await extrair({ texto: 'caso' });

  // primeira(), pelo mesmo motivo do teste do schema: a resposta so com
  // tipo_tumor dispara a segunda chamada, cujo prompt e o do subtipo unico.
  const prompt = stub.primeira().corpo.system;
  TUMORS.labels().forEach((label) => {
    assert.ok(prompt.includes(label), `o prompt não menciona "${label}"`);
  });
  assert.match(prompt, /estágio 4.*IV/s, 'o prompt não exige normalizar estágio arábico');
  assert.match(prompt, /endomete/i, 'o prompt não trata erro de digitação');
  assert.match(prompt, /86/, 'o prompt não exemplifica extração de idade');
});

/* ====================================================================== *
 * EXTRAÇÃO ABANDONADA — a falha silenciosa medida contra a API real
 *
 * Ovário e endométrio às vezes voltam da API com tipo_tumor preenchido e TODO
 * o resto vazio: status 200, avisos vazios, nenhum erro. O médico via a tela
 * de revisão em branco e não tinha como distinguir "o laudo não tinha esses
 * dados" de "a leitura desistiu". Os cinco subtipos não ginecológicos deram
 * 100% na mesma medição. Ver ARQUITETURA.md §32.
 * ====================================================================== */

test('extração abandonada dispara segunda chamada com schema do subtipo', async () => {
  stub.limpar();
  // 1a chamada: a assinatura do abandono — só o tipo, nada mais.
  stub.responderCom({ tipo: 'ok', extracao: { tipo_tumor: 'Ginecológico - Endométrio' } }, 1);
  // 2a chamada: o schema dirigido recupera o caso.
  stub.responderCom({
    tipo: 'ok',
    extracao: { histologia: 'Endometrioide', estadiamento: 'IA', mmr_msi: 'pMMR / MSS', idade: '60' },
  }, 1);

  const { status, corpo } = await extrair({ texto: 'Pct 60a, carcinoma endometrioide grau 1, FIGO IA, pMMR.' });
  assert.strictEqual(status, 200);
  assert.strictEqual(stub.quantasChamadas(), 2, 'a segunda tentativa não aconteceu');

  // A segunda chamada leva SÓ os campos do endométrio, não os 21 do unificado.
  const segunda = stub.ultima().corpo;
  const chaves = Object.keys(segunda.output_config.format.schema.properties);
  assert.ok(chaves.includes('mmr_msi'), 'o schema dirigido perdeu um campo do próprio subtipo');
  assert.ok(!chaves.includes('gleason_grade_group'), 'o schema dirigido levou campo de outro subtipo');
  assert.ok(!chaves.includes('tipo_tumor'), 'a segunda chamada não deve redecidir o subtipo');
  assert.match(segunda.system, /Ginecológico - Endométrio/, 'o prompt dirigido não fixa o subtipo');

  // O caso chega recuperado à tela.
  assert.strictEqual(corpo.extracted.histologia, 'Endometrioide');
  assert.strictEqual(corpo.extracted.mmr_msi, 'pMMR / MSS');
  assert.strictEqual(corpo.extracted.estadiamento, 'IA');
});

test('recuperação bem-sucedida avisa o médico em vez de fingir que sempre funcionou', async () => {
  stub.limpar();
  stub.responderCom({ tipo: 'ok', extracao: { tipo_tumor: 'Ginecológico - Ovário' } }, 1);
  stub.responderCom({ tipo: 'ok', extracao: { histologia: 'Seroso', grau: 'Alto grau', estadiamento: 'IIIC' } }, 1);

  const { corpo } = await extrair({ texto: 'caso de ovário' });
  const aviso = (corpo.avisos || []).find((a) => /leitura/i.test(a.arquivo || ''));
  assert.ok(aviso, 'a recuperação passou silenciosa');
  assert.strictEqual(aviso.recuperado, true, 'aviso de recuperação não marcado como recuperado');
  assert.match(aviso.comoResolver, /confira/i, 'o aviso não pede conferência dos campos');
});

test('quando a recuperação também falha, o médico é avisado — nunca fica em silêncio', async () => {
  stub.limpar();
  // As duas chamadas voltam abandonadas.
  stub.responderCom({ tipo: 'ok', extracao: { tipo_tumor: 'Ginecológico - Endométrio' } }, 2);

  const { status, corpo } = await extrair({ texto: 'material que a leitura não consegue interpretar' });
  assert.strictEqual(status, 200, 'a falha de leitura não é erro de servidor');
  assert.strictEqual(stub.quantasChamadas(), 2);

  const aviso = (corpo.avisos || []).find((a) => /leitura/i.test(a.arquivo || ''));
  assert.ok(aviso, 'FALHA SILENCIOSA: a leitura falhou e o médico não foi avisado');
  assert.ok(!aviso.recuperado, 'aviso de falha não pode se marcar como recuperado');
  assert.match(aviso.motivo, /não consegui extrair/i);
  assert.match(aviso.comoResolver, /à mão|texto/i, 'o aviso não diz o que o médico deve fazer');
});

test('extração normal NÃO dispara segunda chamada nem inventa aviso', async () => {
  stub.limpar();
  stub.responderCom({
    tipo: 'ok',
    extracao: {
      tipo_tumor: 'Ginecológico - Endométrio',
      tipo_tumor_justificativa: 'Laudo de histerectomia com carcinoma endometrioide.',
      histologia: 'Endometrioide', estadiamento: 'IA', mmr_msi: 'pMMR / MSS', idade: '60',
    },
  }, 1);

  const { corpo } = await extrair({ texto: 'caso completo' });
  assert.strictEqual(stub.quantasChamadas(), 1, 'gastou chamada paga sem necessidade');
  const aviso = (corpo.avisos || []).find((a) => /leitura/i.test(a.arquivo || ''));
  assert.ok(!aviso, 'inventou aviso de falha numa extração que funcionou');
});

test('laudo legitimamente esparso não é confundido com abandono', async () => {
  stub.limpar();
  // Campos decisivos vazios, MAS o modelo provou que leu: justificativa,
  // fontes e idade vieram. Isso é "o laudo não tinha", não "desisti".
  stub.responderCom({
    tipo: 'ok',
    extracao: {
      tipo_tumor: 'Ginecológico - Endométrio',
      tipo_tumor_justificativa: 'Encaminhamento menciona câncer de endométrio sem laudo anexo.',
      idade: '62',
      fontes_usadas: ['texto digitado pelo médico'],
    },
  }, 1);

  const { corpo } = await extrair({ texto: 'paciente 62a encaminhada por CA de endométrio, aguardando laudo' });
  assert.strictEqual(stub.quantasChamadas(), 1, 'gastou chamada paga num laudo esparso legítimo');
  assert.strictEqual(corpo.extracted.idade, '62');
});
