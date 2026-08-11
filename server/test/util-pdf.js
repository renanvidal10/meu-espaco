'use strict';

// Construtores de PDF para os testes, sem depender de arquivo binário no
// repositório - o laudo real que motivou o tratamento de envelope tem dado de
// paciente e não pode ser versionado.

/** PDF de uma página, válido e com texto extraível. */
function criaPdf(texto) {
  const conteudo = `BT /F1 12 Tf 72 720 Td (${String(texto).replace(/[()\\]/g, '')}) Tj ET`;
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
  // Preenche para passar do mínimo de 400 bytes que o desembrulho exige.
  if (corpo.length < 600) corpo += '\n% ' + 'x'.repeat(600 - corpo.length);
  return Buffer.from(corpo, 'latin1');
}

// Cabeçalho PKCS#7/CMS igual ao do laudo real assinado por ICP-Brasil:
// SEQUENCE, OID 1.2.840.113549.1.7.2 (signedData), version, OID data.
const ENVELOPE_ASSINATURA = Buffer.concat([
  Buffer.from('3083014be2', 'hex'),               // SEQUENCE, comprimento longo
  Buffer.from('06092a864886f70d010702', 'hex'),   // OID signedData
  Buffer.from('a0830143', 'hex'),                 // [0] EXPLICIT
  Buffer.from('30830142', 'hex'),                 // SEQUENCE
  Buffer.from('020101', 'hex'),                   // version
  Buffer.from('31000000', 'hex'),                 // digestAlgorithms
  Buffer.from('06092a864886f70d010701', 'hex'),   // OID data
  Buffer.alloc(22),                               // encapContentInfo até o payload
]);

module.exports = { criaPdf, ENVELOPE_ASSINATURA };
