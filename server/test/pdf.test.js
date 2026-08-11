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

function anexo(nome, buffer, mimetype = 'application/pdf') {
  return { originalname: nome, mimetype, buffer };
}

const PDF_MINIMO = Buffer.from(
  '%PDF-1.7\n1 0 obj<</Type/Catalog>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF',
);

test('PDF de 0 bytes é barrado com instrução de iCloud/Drive', () => {
  const r = pdf.inspecionar(anexo('laudo.pdf', Buffer.alloc(0)));
  assert.strictEqual(r.ok, false);
  assert.match(r.motivo, /vazio/i);
  assert.match(r.comoResolver, /iCloud|Drive/i);
});

test('arquivo que não começa como PDF é barrado', () => {
  const html = Buffer.from('<html><body>404 Not Found</body></html>');
  const r = pdf.inspecionar(anexo('laudo.pdf', html));
  assert.strictEqual(r.ok, false);
  assert.match(r.motivo, /não é um PDF válido/i);
  assert.match(r.comoResolver, /foto|print/i);
});

test('PDF acima do limite é barrado antes de virar base64', () => {
  const grande = Buffer.concat([Buffer.from('%PDF-1.7\n'), Buffer.alloc(pdf.MAX_BYTES + 1)]);
  const r = pdf.inspecionar(anexo('laudo.pdf', grande));
  assert.strictEqual(r.ok, false);
  assert.match(r.motivo, /20 MB/);
});

test('PDF protegido por senha é reconhecido pelo /Encrypt no trailer', () => {
  const protegido = Buffer.concat([
    Buffer.from('%PDF-1.7\n'),
    Buffer.alloc(200),
    Buffer.from('trailer<< /Encrypt 12 0 R /Root 1 0 R >>\n%%EOF'),
  ]);
  const r = pdf.inspecionar(anexo('laudo.pdf', protegido));
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.protegido, true);
  assert.match(r.motivo, /senha|restrição/i);
});

test('PDF com lixo antes do cabeçalho ainda é aceito', () => {
  // Alguns geradores colocam bytes antes de "%PDF-". A busca é nos primeiros 1024.
  const comLixo = Buffer.concat([Buffer.from('\r\n\r\n'), PDF_MINIMO]);
  assert.strictEqual(pdf.inspecionar(anexo('laudo.pdf', comLixo)).ok, true);
});

test('PDF válido passa', () => {
  assert.strictEqual(pdf.inspecionar(anexo('laudo.pdf', PDF_MINIMO)).ok, true);
});

test('todo bloqueio traz motivo E instrução do que fazer', () => {
  const ruins = [
    Buffer.alloc(0),
    Buffer.from('não sou pdf'),
    Buffer.concat([Buffer.from('%PDF-1.7\n'), Buffer.alloc(200), Buffer.from('trailer<< /Encrypt 1 0 R >>')]),
  ];
  ruins.forEach((buf, i) => {
    const r = pdf.inspecionar(anexo('laudo.pdf', buf));
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
  // PDF montado à mão com um fluxo de texto simples, sem depender de binário externo.
  const conteudo = 'BT /F1 12 Tf 72 720 Td (carcinoma seroso de ovario estagio IIIC) Tj ET';
  const objetos = [
    '1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj',
    '2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj',
    '3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>>>endobj',
    `4 0 obj<</Length ${conteudo.length}>>stream\n${conteudo}\nendstream endobj`,
    '5 0 obj<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>endobj',
  ];
  let corpo = '%PDF-1.4\n';
  const offsets = [];
  objetos.forEach((o) => { offsets.push(corpo.length); corpo += o + '\n'; });
  const inicioXref = corpo.length;
  corpo += `xref\n0 ${objetos.length + 1}\n0000000000 65535 f \n`;
  offsets.forEach((off) => { corpo += String(off).padStart(10, '0') + ' 00000 n \n'; });
  corpo += `trailer<</Size ${objetos.length + 1}/Root 1 0 R>>\nstartxref\n${inicioXref}\n%%EOF`;

  const buffer = Buffer.from(corpo, 'latin1');
  assert.strictEqual(pdf.inspecionar(anexo('laudo.pdf', buffer)).ok, true);

  const { texto, paginas } = await pdf.extrairTexto(buffer);
  assert.strictEqual(paginas, 1);
  assert.match(texto, /carcinoma seroso/i);
  assert.match(texto, /IIIC/);
});

test('extração local não destrói o buffer original', async () => {
  const conteudo = 'BT /F1 12 Tf 72 720 Td (teste) Tj ET';
  const objetos = [
    '1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj',
    '2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj',
    '3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>>>endobj',
    `4 0 obj<</Length ${conteudo.length}>>stream\n${conteudo}\nendstream endobj`,
    '5 0 obj<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>endobj',
  ];
  let corpo = '%PDF-1.4\n';
  objetos.forEach((o) => { corpo += o + '\n'; });
  corpo += 'trailer<</Size 6/Root 1 0 R>>\n%%EOF';
  const buffer = Buffer.from(corpo, 'latin1');
  const antes = buffer.length;

  try { await pdf.extrairTexto(buffer); } catch (e) { /* o que importa é o buffer */ }

  assert.strictEqual(buffer.length, antes, 'o buffer foi consumido');
  assert.strictEqual(pdf.inspecionar(anexo('laudo.pdf', buffer)).ok, true, 'o buffer ficou inutilizável');
});
