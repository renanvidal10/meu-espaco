'use strict';

// Tratamento de PDF anexado.
//
// Existe porque um laudo real foi recusado pela API com
// "The PDF specified was not valid" — mensagem que não diz ao médico o que
// fazer e que, exibida crua, ainda quebrava o layout da página.
//
// A regra que estes testes fixam: todo PDF que não vai dar certo é barrado
// ANTES da chamada paga, com um motivo em português e uma instrução do que
// fazer a respeito.

const test = require('node:test');
const assert = require('node:assert');
const pdf = require('../pdf.js');
const { criaPdf, ENVELOPE_ASSINATURA } = require('./util-pdf.js');

function anexo(nome, buffer, mimetype = 'application/pdf') {
  return { originalname: nome, mimetype, buffer };
}

const PDF_MINIMO = Buffer.from(
  '%PDF-1.7\n1 0 obj<</Type/Catalog>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF',
);

test('PDF de 0 bytes é barrado com instrução de iCloud/Drive', () => {
  const r = pdf.preparar(anexo('laudo.pdf', Buffer.alloc(0)));
  assert.strictEqual(r.ok, false);
  assert.match(r.motivo, /vazio/i);
  assert.match(r.comoResolver, /iCloud|Drive/i);
});

test('arquivo que não começa como PDF é barrado', () => {
  const html = Buffer.from('<html><body>404 Not Found</body></html>');
  const r = pdf.preparar(anexo('laudo.pdf', html));
  assert.strictEqual(r.ok, false);
  assert.match(r.motivo, /não é um PDF válido/i);
  assert.match(r.comoResolver, /foto|print/i);
});

test('PDF acima do limite é barrado antes de virar base64', () => {
  const grande = Buffer.concat([Buffer.from('%PDF-1.7\n'), Buffer.alloc(pdf.MAX_BYTES + 1)]);
  const r = pdf.preparar(anexo('laudo.pdf', grande));
  assert.strictEqual(r.ok, false);
  // Sem número fixo: o limite acompanha o do multer e já mudou uma vez.
  assert.match(r.motivo, new RegExp(`${pdf.MAX_BYTES / 1024 / 1024} MB`));
  assert.match(r.motivo, /acima do limite/i);
});

test('PDF protegido por senha é reconhecido pelo /Encrypt no trailer', () => {
  const protegido = Buffer.concat([
    Buffer.from('%PDF-1.7\n'),
    Buffer.alloc(200),
    Buffer.from('trailer<< /Encrypt 12 0 R /Root 1 0 R >>\n%%EOF'),
  ]);
  const r = pdf.preparar(anexo('laudo.pdf', protegido));
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.protegido, true);
  assert.match(r.motivo, /senha|restrição/i);
});

test('PDF com lixo antes do cabeçalho é recortado e aceito', () => {
  const comLixo = Buffer.concat([Buffer.from('\r\n\r\n'), criaPdf('laudo de teste')]);
  const r = pdf.preparar(anexo('laudo.pdf', comLixo));
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.buffer.subarray(0, 5).toString('latin1'), '%PDF-');
  assert.ok(r.aviso, 'deveria avisar que houve recorte');
});

// ===================================================================
// O caso real que motivou tudo isto: laudo emitido por sistema
// hospitalar brasileiro, assinado digitalmente (ICP-Brasil). O arquivo
// tem extensão .pdf mas, nos bytes, é um envelope PKCS#7 com o PDF
// dentro, começando no offset 72. A API recusa - corretamente, porque
// não é um PDF - e o médico via "The PDF specified was not valid".
// ===================================================================
test('PDF dentro de envelope de assinatura digital é desembrulhado', () => {
  const dentro = criaPdf('RELATORIO ONCOLOGICO adenocarcinoma de prostata');
  const arquivo = Buffer.concat([ENVELOPE_ASSINATURA, dentro, Buffer.from('\x00\x01certificado-e-assinatura')]);

  // Confere que a fixture reproduz mesmo a estrutura do arquivo real.
  assert.notStrictEqual(arquivo.subarray(0, 5).toString('latin1'), '%PDF-', 'fixture não reproduz o envelope');

  const r = pdf.preparar(anexo('SOLICITACAO123.pdf', arquivo));
  assert.strictEqual(r.ok, true, 'o laudo assinado foi barrado');
  assert.strictEqual(r.buffer.subarray(0, 5).toString('latin1'), '%PDF-');
  assert.ok(r.buffer.length < arquivo.length, 'o envelope não foi removido');
  assert.strictEqual(r.buffer.subarray(-5).toString('latin1'), '%%EOF', 'sobrou assinatura no fim');
  assert.ok(r.aviso && r.aviso.recuperado, 'a recuperação deveria ser comunicada');
  assert.match(r.aviso.motivo, /assinatura digital/i);
});

test('o PDF desembrulhado continua legível', async () => {
  const dentro = criaPdf('carcinoma seroso de ovario estagio IIIC');
  const arquivo = Buffer.concat([ENVELOPE_ASSINATURA, dentro, Buffer.from('assinatura')]);
  const r = pdf.preparar(anexo('laudo.pdf', arquivo));
  const { texto } = await pdf.extrairTexto(r.buffer);
  assert.match(texto, /carcinoma seroso/i);
  assert.match(texto, /IIIC/);
});

test('desembrulhar não mexe em PDF que já começa correto', () => {
  const normal = criaPdf('laudo normal');
  const r = pdf.desembrulhar(normal);
  assert.strictEqual(r.envelope, null);
  assert.strictEqual(r.buffer.length, normal.length);
});

test('não recorta quando o suposto PDF interno é pequeno demais para ser real', () => {
  // "%PDF-" solto no meio de um arquivo qualquer não é um PDF embutido.
  const falso = Buffer.concat([Buffer.from('lixo qualquer '), Buffer.from('%PDF-1.4 fim')]);
  const r = pdf.preparar(anexo('x.pdf', falso));
  assert.strictEqual(r.ok, false, 'recortou um PDF que não existe');
});

test('PDF válido passa', () => {
  assert.strictEqual(pdf.preparar(anexo('laudo.pdf', PDF_MINIMO)).ok, true);
});

test('todo bloqueio traz motivo E instrução do que fazer', () => {
  const ruins = [
    Buffer.alloc(0),
    Buffer.from('não sou pdf'),
    Buffer.concat([Buffer.from('%PDF-1.7\n'), Buffer.alloc(200), Buffer.from('trailer<< /Encrypt 1 0 R >>')]),
  ];
  ruins.forEach((buf, i) => {
    const r = pdf.preparar(anexo('laudo.pdf', buf));
    assert.strictEqual(r.ok, false, `caso ${i} deveria ser barrado`);
    assert.ok(r.motivo && r.motivo.length > 15, `caso ${i}: motivo ausente`);
    assert.ok(r.comoResolver && r.comoResolver.length > 25, `caso ${i}: sem instrução do que fazer`);
    // Nada de jargão técnico da API na frente do médico.
    assert.doesNotMatch(r.motivo + r.comoResolver, /base64|invalid_request|request_id|messages\.0/i);
  });
});

test('reconhece a recusa de PDF da API, e só ela', () => {
  assert.ok(pdf.ehRecusaDePdf(new Error(
    'messages.0.content.0.pdf.source.base64.data: The PDF specified was not valid.')));
  assert.ok(!pdf.ehRecusaDePdf(new Error('rate_limit_error: too many requests')));
  assert.ok(!pdf.ehRecusaDePdf(new Error('overloaded')));
  assert.ok(!pdf.ehRecusaDePdf(undefined));
});

test('extração local devolve o texto do PDF (plano B da recusa da API)', async () => {
  const buffer = criaPdf('carcinoma seroso de ovario estagio IIIC');
  assert.strictEqual(pdf.preparar(anexo('laudo.pdf', buffer)).ok, true);
  const { texto, paginas } = await pdf.extrairTexto(buffer);
  assert.strictEqual(paginas, 1);
  assert.match(texto, /carcinoma seroso/i);
  assert.match(texto, /IIIC/);
});

test('extração local não destrói o buffer original', async () => {
  const buffer = criaPdf('teste');
  const antes = buffer.length;
  try { await pdf.extrairTexto(buffer); } catch (e) { /* o que importa é o buffer */ }
  assert.strictEqual(buffer.length, antes, 'o buffer foi consumido');
  assert.strictEqual(pdf.preparar(anexo('laudo.pdf', buffer)).ok, true, 'o buffer ficou inutilizável');
});

test('ehRecusaDePdf exige as DUAS condicoes, nao uma delas', () => {
  // A conjuncao aqui custa dinheiro. Trocar && por || fazia "invalid
  // x-api-key" — erro 401, sem PDF nenhum envolvido — ser lido como recusa de
  // documento, disparando extracao local e uma SEGUNDA chamada paga a cada
  // erro de autenticacao. Os casos negativos que existiam nao casavam nem um
  // lado nem o outro, entao a mutacao passava incolume.
  const recusaDeVerdade = [
    'The PDF specified was not valid',
    'Could not process pdf document',
    'pdf is corrupt',
  ];
  for (const msg of recusaDeVerdade) {
    assert.strictEqual(pdf.ehRecusaDePdf(new Error(msg)), true, `deveria ser recusa: ${msg}`);
  }

  // Casa "invalid" mas nao fala de PDF:
  const soFalhaSemPdf = [
    'invalid x-api-key',
    'invalid_request_error: bad field',
    'could not process request',
    'image is corrupt',
    'Your credit balance is too low',
  ];
  for (const msg of soFalhaSemPdf) {
    assert.strictEqual(pdf.ehRecusaDePdf(new Error(msg)), false, `nao e recusa de PDF: ${msg}`);
  }

  // Fala de PDF mas nao e falha:
  const soPdfSemFalha = [
    'pdf recebido com sucesso',
    'pdf processed in 3 pages',
  ];
  for (const msg of soPdfSemFalha) {
    assert.strictEqual(pdf.ehRecusaDePdf(new Error(msg)), false, `nao e recusa de PDF: ${msg}`);
  }

  assert.strictEqual(pdf.ehRecusaDePdf(undefined), false);
  assert.strictEqual(pdf.ehRecusaDePdf(new Error('')), false);
});
