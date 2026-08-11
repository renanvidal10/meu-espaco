'use strict';

// Bateria clínica do motor de triagem.
//
// Cada caso descreve o que o médico teria à mão e o que a regra deve concluir.
// A grafia varia de propósito - romano e arábico, abreviação, jargão de
// prontuário, caixa alta e baixa - porque o campo da revisão é editável e o
// médico corrige à mão do jeito dele.
//
// Um caso que deveria indicar teste e não indica é o erro mais grave que esta
// plataforma pode cometer. É o que estes testes vigiam.

const test = require('node:test');
const assert = require('node:assert');
const TUMORS = require('../public/tumors.js');

function triar(tumorId, valores) {
  const tumor = TUMORS.get(tumorId);
  assert.ok(tumor, `tumor desconhecido: ${tumorId}`);
  const v = {};
  tumor.fields.forEach((f) => { v[f.key] = ''; });
  Object.assign(v, valores);
  return { tumor, resultado: tumor.classify(v), valores: v };
}

function nomesDosTestes(r) {
  return (r.tests || []).map((t) => t.id).sort();
}

function rodar(titulo, casos) {
  casos.forEach((caso) => {
    test(`${titulo} — ${caso.nome}`, () => {
      const { resultado, tumor, valores } = triar(caso.tumor, caso.valores);
      assert.strictEqual(
        resultado.state, caso.estado,
        `estado esperado "${caso.estado}", veio "${resultado.state}"`,
      );
      if (caso.testes !== undefined) {
        assert.deepStrictEqual(
          nomesDosTestes(resultado), [...caso.testes].sort(),
          `testes indicados divergem`,
        );
      }
      // Todo resultado precisa dizer alguma coisa ao médico.
      const texto = resultado.summary || resultado.message;
      assert.ok(texto && texto.length > 15, 'resultado sem texto explicativo');
      // O diagnóstico vai impresso na solicitação: nunca pode sair vazio,
      // com "undefined" ou com acento comido pela normalização.
      const dx = tumor.diagnosis(valores);
      assert.ok(dx && dx.length > 5, 'diagnóstico vazio');
      assert.ok(!/undefined|null|NaN/.test(dx), `diagnóstico com lixo: "${dx}"`);
      if (caso.diagnosticoContem) {
        caso.diagnosticoContem.forEach((trecho) => {
          assert.ok(
            dx.toLowerCase().includes(trecho.toLowerCase()),
            `diagnóstico "${dx}" não contém "${trecho}"`,
          );
        });
      }
    });
  });
}

/* ====================================================================== *
 * OVÁRIO
 * ====================================================================== */
rodar('Ovário', [
  {
    nome: 'seroso alto grau IIIC — par completo',
    tumor: 'ovario',
    valores: { histologia: 'Seroso', grau: 'Alto grau', estadiamento: 'IIIC' },
    estado: 'completo', testes: ['hrd', 'germinativo-brca'],
    diagnosticoContem: ['seroso', 'estágio IIIC'],
  },
  {
    // O caso relatado em uso real: estágio em arábico, grau ausente, idade solta.
    nome: 'endometrioide "estágio 4" sem grau — provisório, não pode virar "sem indicação"',
    tumor: 'ovario',
    valores: { histologia: 'Endometrioide', estadiamento: 'estágio 4', idade: '86' },
    estado: 'provisorio', testes: ['hrd', 'germinativo-brca'],
  },
  {
    nome: 'estágio escrito em arábico com subletra ("3C")',
    tumor: 'ovario',
    valores: { histologia: 'Seroso', grau: 'G3', estadiamento: '3C' },
    estado: 'completo', testes: ['hrd', 'germinativo-brca'],
  },
  {
    nome: 'grau escrito como "pouco diferenciado"',
    tumor: 'ovario',
    valores: { histologia: 'seroso', grau: 'pouco diferenciado', estadiamento: 'IV' },
    estado: 'completo', testes: ['hrd', 'germinativo-brca'],
  },
  {
    nome: 'histologia com prefixo do laudo ("Carcinoma seroso de alto grau")',
    tumor: 'ovario',
    valores: { histologia: 'Carcinoma seroso de alto grau', grau: 'Alto grau', estadiamento: 'IIIB' },
    estado: 'completo',
    diagnosticoContem: ['Carcinoma seroso'],
  },
  {
    nome: 'mucinoso — epitelial, mas fora do critério somático',
    tumor: 'ovario',
    valores: { histologia: 'Mucinoso', estadiamento: 'IA' },
    estado: 'parcial', testes: ['germinativo-brca'],
  },
  {
    nome: 'células claras — germinativo sim, somático não',
    tumor: 'ovario',
    valores: { histologia: 'Células claras', grau: 'Alto grau', estadiamento: 'IIIC' },
    estado: 'parcial', testes: ['germinativo-brca'],
  },
  {
    nome: 'seroso de baixo grau — critério somático não atendido',
    tumor: 'ovario',
    valores: { histologia: 'Seroso', grau: 'Baixo grau', estadiamento: 'IIIC' },
    estado: 'parcial', testes: ['germinativo-brca'],
  },
  {
    nome: 'seroso alto grau estágio I — inicial, sem somático',
    tumor: 'ovario',
    valores: { histologia: 'Seroso', grau: 'Alto grau', estadiamento: 'IA' },
    estado: 'parcial', testes: ['germinativo-brca'],
  },
  {
    nome: 'histologia não epitelial — recusa explícita',
    tumor: 'ovario',
    valores: { histologia: 'Tumor de células da granulosa' },
    estado: 'nao-reconhecida',
  },
  {
    nome: 'sem histologia — dados insuficientes',
    tumor: 'ovario',
    valores: { estadiamento: 'IIIC', grau: 'Alto grau' },
    estado: 'insuficiente',
  },
]);

/* ====================================================================== *
 * PRÓSTATA
 * ====================================================================== */
rodar('Próstata', [
  {
    nome: 'mCRPC — par completo',
    tumor: 'prostata',
    valores: { histologia: 'Adenocarcinoma acinar', extensao_doenca: 'Metastático resistente à castração (mCRPC)', psa: '225', gleason_grade_group: 'Gleason 4+5=9' },
    estado: 'completo', testes: ['hrr', 'germinativo-prostata'],
    diagnosticoContem: ['Gleason 4+5=9'],
  },
  {
    nome: 'mHSPC — par completo',
    tumor: 'prostata',
    valores: { extensao_doenca: 'Metastático hormônio-sensível (mHSPC)' },
    estado: 'completo', testes: ['hrr', 'germinativo-prostata'],
  },
  {
    nome: 'N1 localizado — só germinativo',
    tumor: 'prostata',
    valores: { extensao_doenca: 'Linfonodo positivo (N1)' },
    estado: 'parcial', testes: ['germinativo-prostata'],
  },
  {
    nome: 'localizado alto risco — só germinativo',
    tumor: 'prostata',
    valores: { extensao_doenca: 'Localizado', categoria_risco_localizado: 'Alto' },
    estado: 'parcial', testes: ['germinativo-prostata'],
  },
  {
    nome: 'localizado muito alto risco — só germinativo',
    tumor: 'prostata',
    valores: { extensao_doenca: 'Localizado', categoria_risco_localizado: 'Muito alto' },
    estado: 'parcial', testes: ['germinativo-prostata'],
  },
  {
    nome: 'intraductal em risco intermediário — germinativo pela histologia',
    tumor: 'prostata',
    valores: { histologia: 'Carcinoma intraductal', extensao_doenca: 'Localizado', categoria_risco_localizado: 'Intermediário favorável' },
    estado: 'parcial', testes: ['germinativo-prostata'],
  },
  {
    nome: 'ascendência Ashkenazi em risco baixo — germinativo',
    tumor: 'prostata',
    valores: { extensao_doenca: 'Localizado', categoria_risco_localizado: 'Baixo', ascendencia_ashkenazi: 'Sim' },
    estado: 'parcial', testes: ['germinativo-prostata'],
  },
  {
    nome: 'histórico familiar em risco baixo — germinativo',
    tumor: 'prostata',
    valores: { extensao_doenca: 'Localizado', categoria_risco_localizado: 'Baixo', historico_familiar: 'pai com câncer de próstata aos 60' },
    estado: 'parcial', testes: ['germinativo-prostata'],
  },
  {
    nome: '"Não relatado" em histórico não conta como histórico',
    tumor: 'prostata',
    valores: { extensao_doenca: 'Localizado', categoria_risco_localizado: 'Baixo', historico_familiar: 'Não relatado' },
    estado: 'sem-indicacao', testes: [],
  },
  {
    nome: 'localizado risco baixo, nada mais — sem indicação',
    tumor: 'prostata',
    valores: { extensao_doenca: 'Localizado', categoria_risco_localizado: 'Baixo' },
    estado: 'sem-indicacao', testes: [],
  },
  {
    nome: 'sem extensão nem risco — dados insuficientes',
    tumor: 'prostata',
    valores: { psa: '8,4' },
    estado: 'insuficiente',
  },
]);

/* ====================================================================== *
 * MAMA
 * ====================================================================== */
rodar('Mama', [
  {
    nome: 'triplo-negativo aos 44 — germinativo',
    tumor: 'mama',
    valores: { histologia: 'Carcinoma ductal invasivo', subtipo_molecular: 'Triplo-negativo', extensao_doenca: 'Inicial (operável)', idade: '44' },
    estado: 'completo', testes: ['germinativo-mama'],
  },
  {
    nome: 'triplo-negativo aos 72 — germinativo mesmo assim (critério é universal em TNBC)',
    tumor: 'mama',
    valores: { subtipo_molecular: 'Triplo-negativo', extensao_doenca: 'Inicial (operável)', idade: '72' },
    estado: 'completo', testes: ['germinativo-mama'],
  },
  {
    nome: 'luminal aos 48 — germinativo pela idade',
    tumor: 'mama',
    valores: { subtipo_molecular: 'Luminal (RH+/HER2-)', extensao_doenca: 'Inicial (operável)', idade: '48' },
    estado: 'completo', testes: ['germinativo-mama'],
  },
  {
    nome: 'exatamente 50 anos — dentro do critério',
    tumor: 'mama',
    valores: { subtipo_molecular: 'Luminal (RH+/HER2-)', extensao_doenca: 'Inicial (operável)', idade: '50' },
    estado: 'completo', testes: ['germinativo-mama'],
  },
  {
    nome: '51 anos, luminal, inicial, sem histórico — sem indicação',
    tumor: 'mama',
    valores: { subtipo_molecular: 'Luminal (RH+/HER2-)', extensao_doenca: 'Inicial (operável)', idade: '51' },
    estado: 'sem-indicacao', testes: [],
  },
  {
    nome: 'luminal metastático — germinativo + somático',
    tumor: 'mama',
    valores: { subtipo_molecular: 'Luminal (RH+/HER2-)', extensao_doenca: 'Metastático', idade: '62' },
    estado: 'completo', testes: ['germinativo-mama', 'somatico-mama'],
  },
  {
    nome: 'HER2 positivo metastático — germinativo, sem somático luminal',
    tumor: 'mama',
    valores: { subtipo_molecular: 'HER2 positivo', extensao_doenca: 'Metastático', idade: '58' },
    estado: 'completo', testes: ['germinativo-mama'],
  },
  {
    nome: 'idade com unidade colada ("44 anos")',
    tumor: 'mama',
    valores: { subtipo_molecular: 'Luminal (RH+/HER2-)', extensao_doenca: 'Inicial (operável)', idade: '44 anos' },
    estado: 'completo', testes: ['germinativo-mama'],
  },
  {
    nome: 'histórico familiar sozinho já indica',
    tumor: 'mama',
    valores: { subtipo_molecular: 'Luminal (RH+/HER2-)', extensao_doenca: 'Inicial (operável)', idade: '66', historico_familiar: 'irmã com câncer de ovário aos 52' },
    estado: 'completo', testes: ['germinativo-mama'],
  },
  {
    nome: 'nada informado — dados insuficientes',
    tumor: 'mama',
    valores: {},
    estado: 'insuficiente',
  },
]);

/* ====================================================================== *
 * PÂNCREAS
 * ====================================================================== */
rodar('Pâncreas', [
  {
    nome: 'PDAC ressecável — germinativo universal, sem somático',
    tumor: 'pancreas',
    valores: { histologia: 'Adenocarcinoma ductal', extensao_doenca: 'Ressecável' },
    estado: 'completo', testes: ['germinativo-pancreas'],
  },
  {
    nome: 'PDAC metastático — germinativo + somático',
    tumor: 'pancreas',
    valores: { histologia: 'Adenocarcinoma ductal', extensao_doenca: 'Metastático' },
    estado: 'completo', testes: ['germinativo-pancreas', 'somatico-pancreas'],
  },
  {
    nome: 'PDAC sem histórico familiar — indicação vale igual (é o ponto da regra)',
    tumor: 'pancreas',
    valores: { histologia: 'Adenocarcinoma ductal', extensao_doenca: 'Ressecável', historico_familiar: 'Não relatado' },
    estado: 'completo', testes: ['germinativo-pancreas'],
  },
  {
    nome: 'neuroendócrino — fora de escopo, recusa explícita',
    tumor: 'pancreas',
    valores: { histologia: 'Tumor neuroendócrino bem diferenciado', extensao_doenca: 'Metastático' },
    estado: 'sem-indicacao', testes: [],
  },
  {
    nome: 'nada informado — dados insuficientes',
    tumor: 'pancreas',
    valores: {},
    estado: 'insuficiente',
  },
]);

/* ====================================================================== *
 * COLORRETAL
 * ====================================================================== */
rodar('Colorretal', [
  {
    nome: 'localizado sem MMR feito — rastreio universal',
    tumor: 'colorretal',
    valores: { histologia: 'Adenocarcinoma', extensao_doenca: 'Localizado / ressecado', mmr_msi: 'Não realizado' },
    estado: 'completo', testes: ['mmr'],
  },
  {
    nome: 'dMMR localizado — Lynch, sem somático',
    tumor: 'colorretal',
    valores: { histologia: 'Adenocarcinoma', extensao_doenca: 'Localizado / ressecado', mmr_msi: 'dMMR / MSI-alto' },
    estado: 'completo', testes: ['germinativo-lynch'],
  },
  {
    nome: 'dMMR metastático — Lynch + perfil somático',
    tumor: 'colorretal',
    valores: { histologia: 'Adenocarcinoma', extensao_doenca: 'Metastático', mmr_msi: 'dMMR / MSI-alto' },
    estado: 'completo', testes: ['germinativo-lynch', 'somatico-crc'],
  },
  {
    nome: 'metastático sem MMR feito — MMR + perfil somático',
    tumor: 'colorretal',
    valores: { histologia: 'Adenocarcinoma', extensao_doenca: 'Metastático', mmr_msi: 'Não realizado' },
    estado: 'completo', testes: ['mmr', 'somatico-crc'],
  },
  {
    nome: 'pMMR localizado — rastreio já cumprido, nada a fazer',
    tumor: 'colorretal',
    valores: { histologia: 'Adenocarcinoma', extensao_doenca: 'Localizado / ressecado', mmr_msi: 'pMMR / MSS' },
    estado: 'sem-indicacao', testes: [],
  },
  {
    nome: 'pMMR metastático — só perfil somático',
    tumor: 'colorretal',
    valores: { histologia: 'Adenocarcinoma', extensao_doenca: 'Metastático', mmr_msi: 'pMMR / MSS' },
    estado: 'completo', testes: ['somatico-crc'],
  },
  {
    nome: 'nada informado — dados insuficientes',
    tumor: 'colorretal',
    valores: {},
    estado: 'insuficiente',
  },
]);

/* ====================================================================== *
 * ENDOMÉTRIO
 * ====================================================================== */
rodar('Endométrio', [
  {
    nome: 'endometrioide IA sem MMR — classificação molecular universal',
    tumor: 'endometrio',
    valores: { histologia: 'Endometrioide', estadiamento: 'IA', mmr_msi: 'Não realizado' },
    estado: 'completo', testes: ['mmr-endo'],
  },
  {
    nome: 'estágio em arábico ("1A") é aceito',
    tumor: 'endometrio',
    valores: { histologia: 'Endometrioide', estadiamento: '1A', mmr_msi: 'Não realizado' },
    estado: 'completo', testes: ['mmr-endo'],
    diagnosticoContem: ['estágio 1A'],
  },
  {
    nome: 'dMMR — confirmação germinativa de Lynch',
    tumor: 'endometrio',
    valores: { histologia: 'Endometrioide', estadiamento: 'II', mmr_msi: 'dMMR / MSI-alto' },
    estado: 'completo', testes: ['germinativo-lynch-endo'],
  },
  {
    nome: 'seroso uterino sem MMR — classificação molecular',
    tumor: 'endometrio',
    valores: { histologia: 'Seroso', estadiamento: 'IIIC', mmr_msi: 'Não realizado' },
    estado: 'completo', testes: ['mmr-endo'],
  },
  {
    nome: 'pMMR — rastreio cumprido',
    tumor: 'endometrio',
    valores: { histologia: 'Endometrioide', estadiamento: 'IA', mmr_msi: 'pMMR / MSS' },
    estado: 'sem-indicacao', testes: [],
  },
  {
    nome: 'nada informado — dados insuficientes',
    tumor: 'endometrio',
    valores: {},
    estado: 'insuficiente',
  },
]);

/* ====================================================================== *
 * PULMÃO (NSCLC)
 * ====================================================================== */
rodar('Pulmão', [
  {
    nome: 'adenocarcinoma metastático — painel amplo',
    tumor: 'pulmao',
    valores: { histologia: 'Adenocarcinoma', extensao_doenca: 'Metastático', painel_previo: 'Não realizado' },
    estado: 'completo', testes: ['painel-nsclc'],
  },
  {
    nome: 'escamoso localmente avançado — painel amplo',
    tumor: 'pulmao',
    valores: { histologia: 'Carcinoma escamoso', extensao_doenca: 'Localmente avançado', painel_previo: 'Não realizado' },
    estado: 'completo', testes: ['painel-nsclc'],
  },
  {
    nome: 'inicial ressecável — sem painel por esta regra',
    tumor: 'pulmao',
    valores: { histologia: 'Adenocarcinoma', extensao_doenca: 'Inicial (ressecável)' },
    estado: 'sem-indicacao', testes: [],
  },
  {
    nome: 'painel já realizado — não repete',
    tumor: 'pulmao',
    valores: { histologia: 'Adenocarcinoma', extensao_doenca: 'Metastático', painel_previo: 'Já realizado' },
    estado: 'sem-indicacao', testes: [],
  },
  {
    nome: 'pequenas células — fora de escopo, recusa explícita',
    tumor: 'pulmao',
    valores: { histologia: 'Pequenas células', extensao_doenca: 'Metastático' },
    estado: 'sem-indicacao', testes: [],
  },
  {
    nome: '"Não pequenas células sem outra especificação" NÃO é recusado',
    tumor: 'pulmao',
    valores: { histologia: 'Não pequenas células sem outra especificação', extensao_doenca: 'Metastático', painel_previo: 'Não realizado' },
    estado: 'completo', testes: ['painel-nsclc'],
  },
  {
    nome: 'nada informado — dados insuficientes',
    tumor: 'pulmao',
    valores: {},
    estado: 'insuficiente',
  },
]);

/* ====================================================================== *
 * NORMALIZADORES
 * ====================================================================== */
const H = TUMORS.helpers;

test('estadioNumero entende romano, arábico, subletra e prefixo', () => {
  const esperado = {
    'IV': 4, '4': 4, 'estágio 4': 4, 'Estágio IV': 4, 'FIGO IV': 4,
    'IIIC': 3, '3C': 3, '3c': 3, 'Estadiamento 3C': 3, 'EC IIIB': 3, 'IIIA': 3,
    'II': 2, '2': 2, 'IIB': 2,
    'IA': 1, '1A': 1, 'I': 1,
  };
  Object.entries(esperado).forEach(([entrada, n]) => {
    assert.strictEqual(H.estadioNumero(entrada), n, `"${entrada}" deveria ser estádio ${n}`);
  });
  ['', '-', 'não informado', 'x'].forEach((entrada) => {
    assert.strictEqual(H.estadioNumero(entrada), null, `"${entrada}" não é estádio`);
  });
});

test('grau tolera escala numérica, ISUP e descrição verbal', () => {
  ['Alto grau', 'alto', 'ALTO GRAU', 'G3', 'grau 3', 'G2', 'pouco diferenciado', 'indiferenciado']
    .forEach((v) => assert.ok(H.grauAlto(v), `"${v}" deveria ser alto grau`));
  ['Baixo grau', 'baixo', 'G1', 'grau 1', 'bem diferenciado']
    .forEach((v) => assert.ok(H.grauBaixo(v), `"${v}" deveria ser baixo grau`));
  ['', '-', 'não informado'].forEach((v) => {
    assert.ok(!H.grauAlto(v) && !H.grauBaixo(v), `"${v}" não define grau`);
  });
});

test('num() aceita vírgula decimal e unidade colada', () => {
  assert.strictEqual(H.num('18,4'), 18.4);
  assert.strictEqual(H.num('18.4 ng/mL'), 18.4);
  assert.strictEqual(H.num('86 anos'), 86);
  assert.strictEqual(H.num('PSA 225'), 225);
  assert.strictEqual(H.num(''), null);
  assert.strictEqual(H.num('não informado'), null);
});

test('filled() trata negativas explícitas como ausência de conteúdo', () => {
  ['', ' ', '-', 'Não relatado', 'não relatado', 'Nenhum relatado']
    .forEach((v) => assert.ok(!H.filled(v), `"${v}" deveria contar como vazio`));
  ['mãe com câncer de mama', 'Seroso'].forEach((v) => assert.ok(H.filled(v), `"${v}" tem conteúdo`));
});

test('lower() preserva acento (o diagnóstico vai impresso)', () => {
  assert.strictEqual(H.lower('Metastático'), 'metastático');
  assert.strictEqual(H.norm('Metastático'), 'metastatico'); // norm é só para comparar
});
