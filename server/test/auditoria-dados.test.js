'use strict';

// Os oito achados graves da auditoria de dados da véspera da apresentação.
// Cada um deles passou despercebido pelas quatro baterias existentes porque
// vivia num caminho que nenhuma delas percorria: campo decisivo em branco,
// grafia livre num campo editável, ou divergência entre o que a TELA diz e o
// que o DOCUMENTO ASSINADO afirma. Ver ARQUITETURA.md §47.

const test = require('node:test');
const assert = require('node:assert');
const TUMORS = require('../public/tumors.js');

function triar(tumorId, valores) {
  const tumor = TUMORS.get(tumorId);
  assert.ok(tumor, `tumor desconhecido: ${tumorId}`);
  const v = {};
  tumor.fields.forEach((f) => { v[f.key] = ''; });
  Object.assign(v, valores);
  return tumor.classify(v);
}

const ids = (r) => (r.tests || []).map((t) => t.id).sort();

test('G1 — história familiar vale com ou sem a idade extraída do laudo', () => {
  // A trava `idade !== null` matava o ramo familiar inteiro: sem idade no
  // material, um irmão com câncer de cólon aos 55 caía em "nenhum teste".
  const r = triar('colorretal', {
    histologia: 'Adenocarcinoma', extensao_doenca: 'Localizado / ressecado',
    mmr_msi: 'pMMR / MSS', historico_familiar: 'irmão com câncer de cólon aos 55',
  });
  assert.ok(ids(r).includes('germinativo-crc-familiar'),
    'sem idade, a história familiar deixou de indicar o painel germinativo');
});

test('G2 — o campo de risco é editável e precisa aceitar a grafia do médico', () => {
  for (const escrita of ['Alto', 'Risco alto', 'alto risco', 'Muito alto', 'risco muito alto']) {
    const r = triar('prostata', { extensao_doenca: 'Localizado', categoria_risco_localizado: escrita });
    assert.ok(ids(r).includes('germinativo-prostata'), `"${escrita}" perdeu a indicação germinativa`);
    assert.ok(!/risco\s+risco/i.test(r.tests[0].justify),
      `rótulo duplicado no documento com "${escrita}": ${r.tests[0].justify}`);
  }
  // E o contrário continua valendo: risco baixo não indica.
  const baixo = triar('prostata', { extensao_doenca: 'Localizado', categoria_risco_localizado: 'Baixo' });
  assert.deepStrictEqual(ids(baixo), [], 'risco baixo passou a indicar teste');
});

test('G3 — o documento não afirma o que a tela ainda pede para confirmar', () => {
  const r = triar('ovario', { histologia: 'Seroso' });
  assert.strictEqual(r.state, 'provisorio');
  const hrd = r.tests.find((t) => t.id === 'hrd');
  assert.match(hrd.justify, /a confirmar/i,
    'a justificativa impressa afirma grau e estágio que a tela diz estarem por confirmar');
  // Já com os dois confirmados, a justificativa volta a ser afirmativa.
  const completo = triar('ovario', { histologia: 'Seroso', grau: 'Alto grau', estadiamento: 'IIIC' });
  assert.strictEqual(completo.state, 'completo');
  assert.ok(!/a confirmar/i.test(completo.tests.find((t) => t.id === 'hrd').justify));
});

test('G4 — sem extensão, pulmão não declara doença ressecável', () => {
  const r = triar('pulmao', { histologia: 'Carcinoma escamoso' });
  assert.strictEqual(r.state, 'insuficiente', 'pulmão assumiu uma extensão que não foi informada');
  assert.match(r.message, /extens[ãa]o/i);
});

test('G5 — POLE prevalece sobre MMRd, então dMMR também precisa de POLE e p53', () => {
  const r = triar('endometrio', {
    histologia: 'Endometrioide', estadiamento: 'IA', mmr_msi: 'dMMR / MSI-alto', idade: '58',
  });
  assert.ok(ids(r).includes('classificacao-molecular-endo'),
    'dMMR ficou sem POLE e p53, contradizendo o texto do próprio card e o documento de validação');
});

test('G7 — todo número afirmado na tela nomeia o que mede e traz a fonte', () => {
  const CENARIOS = [
    ['ovario', { histologia: 'Seroso', grau: 'Alto grau', estadiamento: 'IIIC' }],
    ['prostata', { extensao_doenca: 'Metastático resistente à castração (mCRPC)' }],
    ['colorretal', { histologia: 'Adenocarcinoma', extensao_doenca: 'Metastático', mmr_msi: 'pMMR / MSS', idade: '44' }],
    ['pancreas', { histologia: 'Adenocarcinoma ductal', extensao_doenca: 'Metastático' }],
    ['pulmao', { histologia: 'Adenocarcinoma', extensao_doenca: 'Metastático', painel_previo: 'Não realizado' }],
  ];
  for (const [tumorId, valores] of CENARIOS) {
    (triar(tumorId, valores).tests || []).forEach((t) => {
      if (!t.stat) return;
      // Um número solto na tela do médico precisa dizer de que população fala.
      assert.ok(t.stat.length > 25, `${tumorId}/${t.id}: estatística curta demais para ser interpretável: "${t.stat}"`);
    });
  }
  const hrd = triar('ovario', { histologia: 'Seroso', grau: 'Alto grau', estadiamento: 'IIIC' })
    .tests.find((t) => t.id === 'hrd');
  assert.match(hrd.stat, /ov[áa]rio/i, 'a estatística do HRD não diz de que tumor fala');
  assert.match(hrd.stat, /PAOLA/i, 'a estatística do HRD perdeu a fonte');
});
