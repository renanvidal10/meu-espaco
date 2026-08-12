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

  /* --- A FRONTEIRA DO ESTÁGIO -------------------------------------- *
   * O par somático depende de estágio III ou IV. Nenhum caso da bateria
   * usava estágio II, em nenhum tumor: o limite `<= 2` de estadioInicial
   * podia virar `< 2` sem quebrar nada, e com isso um seroso de alto grau
   * em estágio II passava a receber HRD somático — teste tumoral em doença
   * inicial, fora do critério FIGO. Estes quatro casos travam os dois lados
   * da fronteira.
   * ----------------------------------------------------------------- */
  {
    nome: 'seroso alto grau estágio II — inicial, sem somático (fronteira)',
    tumor: 'ovario',
    valores: { histologia: 'Seroso', grau: 'Alto grau', estadiamento: 'II' },
    estado: 'parcial', testes: ['germinativo-brca'],
  },
  {
    nome: 'seroso alto grau estágio IIB — ainda inicial (fronteira)',
    tumor: 'ovario',
    valores: { histologia: 'Seroso', grau: 'Alto grau', estadiamento: 'IIB' },
    estado: 'parcial', testes: ['germinativo-brca'],
  },
  {
    nome: 'seroso alto grau estágio III — primeiro avançado (fronteira)',
    tumor: 'ovario',
    valores: { histologia: 'Seroso', grau: 'Alto grau', estadiamento: 'III' },
    estado: 'completo', testes: ['hrd', 'germinativo-brca'],
  },
  {
    nome: 'seroso alto grau estágio 2 em arábico — inicial (fronteira)',
    tumor: 'ovario',
    valores: { histologia: 'Seroso', grau: 'Alto grau', estadiamento: '2' },
    estado: 'parcial', testes: ['germinativo-brca'],
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
    // §39.4: MSI/dMMR é recomendação específica de mCRPC.
    estado: 'completo', testes: ['hrr', 'msi-prostata', 'germinativo-prostata'],
    diagnosticoContem: ['Gleason 4+5=9'],
  },
  {
    nome: 'mHSPC — par completo',
    tumor: 'prostata',
    valores: { extensao_doenca: 'Metastático hormônio-sensível (mHSPC)' },
    // E NÃO MSI: a recomendação de MSI é da doença resistente à castração.
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
    // §39.2: em risco intermediário o NCCN coloca a histologia
    // intraductal/cribriforme como "considerar", não como recomendação. O app
    // entrega isso como nota. Antes indicava o teste — era mais agressivo que
    // a diretriz que ele cita.
    nome: 'intraductal em risco intermediário — consideração, não indicação',
    tumor: 'prostata',
    valores: { histologia: 'Carcinoma intraductal', extensao_doenca: 'Localizado', categoria_risco_localizado: 'Intermediário favorável' },
    estado: 'sem-indicacao', testes: [],
  },
  {
    nome: 'intraductal em risco alto — a categoria de risco indica por si',
    tumor: 'prostata',
    valores: { histologia: 'Carcinoma intraductal', extensao_doenca: 'Localizado', categoria_risco_localizado: 'Alto' },
    estado: 'parcial', testes: ['germinativo-prostata'],
  },
  {
    // §39.3: buraco encontrado — era indicação NCCN recomendada e não havia
    // onde registrar o dado.
    nome: 'historia pessoal de cancer de mama em risco baixo — germinativo indicado',
    tumor: 'prostata',
    valores: { extensao_doenca: 'Localizado', categoria_risco_localizado: 'Baixo', historia_pessoal_cancer: 'Câncer de mama em 2019' },
    estado: 'parcial', testes: ['germinativo-prostata'],
  },
  {
    nome: 'historia pessoal de melanoma em risco baixo — consideração, não indicação',
    tumor: 'prostata',
    valores: { extensao_doenca: 'Localizado', categoria_risco_localizado: 'Baixo', historia_pessoal_cancer: 'Melanoma' },
    estado: 'sem-indicacao', testes: [],
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
    // O documento assinado leva o estagio na forma canonica, nao a grafia
    // crua: "1A" entra, "estagio IA" sai impresso.
    diagnosticoContem: ['estágio IA'],
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
    // ARQUITETURA.md §30.4: MMR proficiente nao fecha a classificacao. O tumor
    // ainda pode ser POLEmut ou p53abn, grupos de prognostico oposto entre si,
    // e a tela dizia "nenhum teste" e "considere POLE e p53" ao mesmo tempo.
    nome: 'pMMR — falta POLE e p53 para fechar a classificacao molecular',
    tumor: 'endometrio',
    valores: { histologia: 'Endometrioide', estadiamento: 'IA', mmr_msi: 'pMMR / MSS' },
    estado: 'completo', testes: ['classificacao-molecular-endo'],
  },
  {
    nome: 'dMMR — Lynch, sem repetir a classificacao molecular',
    tumor: 'endometrio',
    valores: { histologia: 'Endometrioide', estadiamento: 'IA', mmr_msi: 'dMMR / MSI-alto' },
    estado: 'completo', testes: ['germinativo-lynch-endo'],
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
    // ARQUITETURA.md §30.3: a regra antiga mandava esperar a doenca progredir,
    // o que custa a janela adjuvante inteira (osimertinibe e alectinibe sao
    // categoria 1 em doenca ressecada e o beneficio nao volta depois).
    nome: 'inicial ressecável — EGFR/ALK/PD-L1 para decisao adjuvante',
    tumor: 'pulmao',
    valores: { histologia: 'Adenocarcinoma', extensao_doenca: 'Inicial (ressecável)' },
    estado: 'completo', testes: ['alvo-adjuvante-nsclc'],
  },
  {
    nome: 'inicial ressecável com painel já feito — não repete',
    tumor: 'pulmao',
    valores: { histologia: 'Adenocarcinoma', extensao_doenca: 'Inicial (ressecável)', painel_previo: 'Já realizado' },
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

  /* ================================================================== *
   * REVISAO CLINICA v1.8 — casos que a plataforma deixava passar.
   * Os quatro primeiros grupos SUPRIMIAM teste de paciente elegivel, que e
   * o erro mais caro de uma ferramenta de triagem porque e silencioso: a
   * tela diz "nenhum teste indicado" e o oncologista segue em frente.
   * Diretrizes e criterios em ARQUITETURA.md secao 30.
   * ================================================================== */

  // --- 30.1 mama masculina: nao havia nem campo para representar o caso ---
  {
    nome: 'C2 homem com cancer de mama — germinativo em qualquer idade',
    tumor: 'mama',
    valores: { sexo: 'Masculino', histologia: 'Carcinoma ductal invasivo', subtipo_molecular: 'Luminal (RH+/HER2-)', extensao_doenca: 'Inicial (operável)', idade: '67' },
    estado: 'completo', testes: ['germinativo-mama'],
  },
  {
    nome: 'C2 homem — o criterio nao depende de idade, subtipo nem extensao',
    tumor: 'mama',
    valores: { sexo: 'Masculino', histologia: 'Carcinoma ductal invasivo' },
    estado: 'completo', testes: ['germinativo-mama'],
  },
  {
    nome: 'C2 mulher 67a luminal inicial continua sem indicacao',
    tumor: 'mama',
    valores: { sexo: 'Feminino', histologia: 'Carcinoma ductal invasivo', subtipo_molecular: 'Luminal (RH+/HER2-)', extensao_doenca: 'Inicial (operável)', idade: '67' },
    estado: 'sem-indicacao', testes: [],
  },

  // --- 30.2 colorretal abaixo de 50 anos ---
  {
    nome: 'C3 colorretal 44a pMMR sem historia familiar — painel multigenico',
    tumor: 'colorretal',
    valores: { histologia: 'Adenocarcinoma', extensao_doenca: 'Localizado / ressecado', mmr_msi: 'pMMR / MSS', idade: '44' },
    estado: 'completo', testes: ['germinativo-crc-precoce'],
  },
  {
    nome: 'C3 colorretal 49a — o limite e estrito abaixo de 50',
    tumor: 'colorretal',
    valores: { histologia: 'Adenocarcinoma', extensao_doenca: 'Localizado / ressecado', mmr_msi: 'pMMR / MSS', idade: '49' },
    estado: 'completo', testes: ['germinativo-crc-precoce'],
  },
  {
    nome: 'C3 colorretal 50a pMMR — fora do criterio de idade',
    tumor: 'colorretal',
    valores: { histologia: 'Adenocarcinoma', extensao_doenca: 'Localizado / ressecado', mmr_msi: 'pMMR / MSS', idade: '50' },
    estado: 'sem-indicacao', testes: [],
  },
  // --- 38.3 colorretal acima de 50: o que o NCCN recomenda x o que considera ---
  {
    nome: 'B1 colorretal 62a pMMR COM historia familiar — painel germinativo indicado',
    tumor: 'colorretal',
    valores: { histologia: 'Adenocarcinoma', extensao_doenca: 'Localizado / ressecado', mmr_msi: 'pMMR / MSS', idade: '62', historico_familiar: 'Mãe com câncer de cólon aos 55 anos' },
    estado: 'completo', testes: ['germinativo-crc-familiar'],
  },
  {
    nome: 'B1 colorretal 62a pMMR SEM historia familiar — segue sem indicacao',
    tumor: 'colorretal',
    valores: { histologia: 'Adenocarcinoma', extensao_doenca: 'Localizado / ressecado', mmr_msi: 'pMMR / MSS', idade: '62' },
    estado: 'sem-indicacao', testes: [],
  },
  {
    nome: 'C3 colorretal 44a dMMR metastatico — os tres testes',
    tumor: 'colorretal',
    valores: { histologia: 'Adenocarcinoma', extensao_doenca: 'Metastático', mmr_msi: 'dMMR / MSI-alto', idade: '44' },
    estado: 'completo', testes: ['germinativo-crc-precoce', 'germinativo-lynch', 'somatico-crc'],
  },

  // --- 30.5 ovario borderline: o unico item que RETIRA exame ---
  {
    nome: 'A1 tumor borderline seroso — fora do espectro BRCA',
    tumor: 'ovario',
    valores: { histologia: 'Tumor borderline seroso', estadiamento: 'IA', idade: '34' },
    estado: 'sem-indicacao', testes: [],
  },
  {
    nome: 'A1 baixo potencial de malignidade — mesma saida',
    tumor: 'ovario',
    valores: { histologia: 'Tumor seroso de baixo potencial de malignidade', estadiamento: 'IA' },
    estado: 'sem-indicacao', testes: [],
  },
  {
    nome: 'A1 seroso invasivo NAO e confundido com borderline',
    tumor: 'ovario',
    valores: { histologia: 'Carcinoma seroso', grau: 'Alto grau', estadiamento: 'IIIC' },
    estado: 'completo', testes: ['hrd', 'germinativo-brca'],
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

/* ====================================================================== *
 * O TEXTO IMPRESSO NA SOLICITAÇÃO
 *
 * Não é cosmético: esta frase é o diagnóstico dentro de um documento que o
 * médico assina e entrega ao laboratório. Cada caso abaixo saiu errado em
 * produção antes desta correção.
 * ====================================================================== */
test('diagnóstico impresso sai bem formado nos sete subtipos', () => {
  const casos = [
    // O pior deles: "endometrioide" CONTÉM "endometrio", então a checagem de
    // sítio por substring concluía que o órgão já estava escrito e imprimia
    // "Carcinoma Endometrioide" — sem órgão nenhum — numa solicitação.
    ['endometrio', { histologia: 'Endometrioide', estadiamento: 'IA' },
      'Carcinoma endometrioide de endométrio, estágio IA'],
    // Prefixo genérico colado numa entidade que já é um tumor.
    ['endometrio', { histologia: 'Carcinossarcoma', estadiamento: 'IIIC' },
      'Carcinossarcoma de endométrio, estágio IIIC'],
    // Sigla de laudo brasileiro virava "Carcinoma CDI de mama".
    ['mama', { histologia: 'CDI', subtipo_molecular: 'HER2 positivo', extensao_doenca: 'Inicial (operável)' },
      'Carcinoma ductal invasivo de mama, HER2 positivo, inicial (operável)'],
    // Grau cru e prefixo de estágio duplicado: "g3, estágio Estádio IIIC (FIGO)".
    ['ovario', { histologia: 'Carcinoma seroso de alto grau', grau: 'G3', estadiamento: 'Estádio IIIC (FIGO)' },
      'Carcinoma seroso de alto grau de ovário, estágio IIIC'],
    // Maiúscula no meio da frase: "Carcinoma Seroso".
    ['ovario', { histologia: 'Seroso', grau: 'Alto grau', estadiamento: 'IIIC' },
      'Carcinoma seroso de ovário, alto grau, estágio IIIC'],
    // Descritor que é substantivo pede "de": "Carcinoma células claras".
    ['ovario', { histologia: 'Células claras', grau: 'Alto grau', estadiamento: 'IC1' },
      'Carcinoma de células claras de ovário, alto grau, estágio IC1'],
    ['pulmao', { histologia: 'CEC', extensao_doenca: 'Metastático' },
      'Carcinoma escamoso de pulmão, metastático'],
    ['pancreas', { histologia: 'Adenocarcinoma ductal', extensao_doenca: 'Metastático' },
      'Adenocarcinoma ductal de pâncreas, metastático'],
    ['colorretal', { histologia: 'Adenocarcinoma de reto', extensao_doenca: 'Metastático' },
      'Adenocarcinoma de reto, metastático'],
  ];

  for (const [id, valores, esperado] of casos) {
    const saida = TUMORS.get(id).diagnosis(valores);
    assert.strictEqual(saida, esperado, `${id}: diagnóstico impresso errado`);
  }
});

test('diagnóstico impresso nunca sai com defeito de forma', () => {
  // Varredura ampla: qualquer combinação plausível, checando só os defeitos
  // que um documento assinado não pode ter.
  const variacoes = ['', 'Seroso', 'seroso', 'Adenocarcinoma', 'CDI', 'Endometrioide',
    'Carcinoma ductal invasivo', 'Células claras', 'Carcinossarcoma', 'adeno'];
  const graus = ['', 'G3', 'grau 1', 'Alto grau', 'pouco diferenciado'];
  const estagios = ['', 'IIIC', '3c', 'Estádio IIIC (FIGO)', 'IIIA1(i)', 'IC1'];

  for (const id of TUMORS.ORDER) {
    for (const histologia of variacoes) {
      for (const grau of graus) {
        for (const estadiamento of estagios) {
          const saida = TUMORS.get(id).diagnosis({ histologia, grau, estadiamento });
          assert.ok(saida.length > 0, `${id}: diagnóstico vazio`);
          assert.ok(!/\s{2,}/.test(saida), `${id}: espaço duplo em "${saida}"`);
          assert.ok(!/,\s*,|,\s*$|^\s*,/.test(saida), `${id}: vírgula solta em "${saida}"`);
          assert.ok(!/\b(\w+)\s+\1\b/i.test(saida), `${id}: palavra repetida em "${saida}"`);
          assert.ok(!/est[áa]gio\s+est[áa]/i.test(saida), `${id}: prefixo de estágio duplicado em "${saida}"`);
          assert.ok(!/Carcinoma\s+Carcinoma|Carcinoma\s+carcinoma/i.test(saida), `${id}: prefixo duplicado em "${saida}"`);
          assert.strictEqual(saida, saida.trim(), `${id}: espaço nas pontas de "${saida}"`);
          assert.strictEqual(saida[0], saida[0].toUpperCase(), `${id}: começa em minúscula: "${saida}"`);
        }
      }
    }
  }
});

test('dMMR é reconhecido nas grafias que o médico digita à mão', () => {
  // O campo é editável. O valor de enum ("dMMR / MSI-alto") contém "dmmr", o
  // que fazia a regra passar nos testes mesmo reconhecendo só essa forma. Um
  // laudo digitado como "MSI alto" perdia a indicação de painel germinativo
  // de Lynch e caía em "sem indicação" no colorretal localizado.
  const grafias = ['dMMR / MSI-alto', 'dMMR', 'MSI alto', 'MSI-alto', 'MSI-H', 'MMR deficiente'];
  for (const grafia of grafias) {
    const crc = TUMORS.get('colorretal').classify({
      histologia: 'Adenocarcinoma', extensao_doenca: 'Localizado / ressecado',
      mmr_msi: grafia, idade: '62', historico_familiar: '', testes_previos: '',
    });
    assert.ok(
      nomesDosTestes(crc).includes('germinativo-lynch'),
      `colorretal com "${grafia}" perdeu a indicação de Lynch`,
    );

    const endo = TUMORS.get('endometrio').classify({
      histologia: 'Endometrioide', estadiamento: 'IA',
      mmr_msi: grafia, idade: '58', historico_familiar: '', testes_previos: '',
    });
    assert.ok(
      nomesDosTestes(endo).includes('germinativo-lynch-endo'),
      `endométrio com "${grafia}" perdeu a indicação de Lynch`,
    );
  }

  // E o contrário: proficiente nunca pode ser lido como deficiente.
  for (const grafia of ['pMMR / MSS', 'pMMR', 'MSS', 'MMR proficiente', 'Não realizado']) {
    assert.strictEqual(TUMORS.helpers.ehDmmr(grafia), false, `"${grafia}" nao e dMMR`);
  }
});

/* ====================================================================== *
 * O PROGRAMA TEM DE FAZER O EXAME QUE O CARD PEDE
 *
 * O card do teste mostra a amostra ("Sangue periférico") e, logo abaixo, os
 * programas de acesso. Se o programa processa só tecido tumoral e o teste é
 * germinativo, o médico encaminha o paciente para um parceiro que NÃO faz
 * aquele exame. Aconteceu no card germinativo de mama, que oferecia um
 * programa de tecido. Ver ARQUITETURA.md §35.
 * ====================================================================== */
test('nenhum programa é oferecido para um tipo de amostra que ele não processa', () => {
  const cenarios = [
    ['ovario', { histologia: 'Seroso', grau: 'Alto grau', estadiamento: 'IIIC' }],
    ['ovario', { histologia: 'Mucinoso', estadiamento: 'IA' }],
    ['mama', { histologia: 'CDI', subtipo_molecular: 'Triplo-negativo', extensao_doenca: 'Metastático', idade: '45' }],
    ['mama', { histologia: 'CDI', subtipo_molecular: 'Luminal (RH+/HER2-)', extensao_doenca: 'Metastático', idade: '68' }],
    ['mama', { histologia: 'CDI', sexo: 'Masculino', extensao_doenca: 'Inicial (operável)', idade: '61' }],
    ['prostata', { extensao_doenca: 'Metastático resistente à castração (mCRPC)' }],
    ['prostata', { extensao_doenca: 'Localizado', categoria_risco_localizado: 'Alto' }],
    ['colorretal', { histologia: 'Adenocarcinoma', extensao_doenca: 'Metastático', mmr_msi: 'dMMR / MSI-alto', idade: '68' }],
    ['colorretal', { histologia: 'Adenocarcinoma', extensao_doenca: 'Localizado / ressecado', mmr_msi: 'pMMR / MSS', idade: '44' }],
    ['pulmao', { histologia: 'Adenocarcinoma', extensao_doenca: 'Metastático' }],
    ['pulmao', { histologia: 'Adenocarcinoma', extensao_doenca: 'Inicial (ressecável)' }],
    ['pancreas', { histologia: 'Adenocarcinoma ductal', extensao_doenca: 'Metastático' }],
    ['endometrio', { histologia: 'Endometrioide', estadiamento: 'IA', mmr_msi: 'pMMR / MSS' }],
    ['endometrio', { histologia: 'Endometrioide', estadiamento: 'IIIC', mmr_msi: 'dMMR / MSI-alto' }],
  ];

  for (const [id, valores] of cenarios) {
    const { resultado } = triar(id, valores);
    for (const teste of resultado.tests || []) {
      const querSangue = /sangue/i.test(teste.sample || '');
      for (const programa of teste.programs || []) {
        assert.ok(programa.amostra, `${id}/${teste.id}: programa "${programa.name}" não declara que amostra processa`);
        if (querSangue) {
          assert.notStrictEqual(
            programa.amostra, 'tecido',
            `${id}/${teste.id}: teste em ${teste.sample} oferecendo "${programa.name}", que só processa tecido tumoral`,
          );
        } else {
          assert.notStrictEqual(
            programa.amostra, 'sangue',
            `${id}/${teste.id}: teste em ${teste.sample} oferecendo "${programa.name}", que só processa sangue`,
          );
        }
      }
    }
  }
});

test('a justificativa do documento assinado diz QUAL critério foi atendido', () => {
  // A justificativa vai impressa na solicitação, e é o que o laboratório e a
  // operadora leem para autorizar o exame. "Perfil com critério de indicação"
  // não justifica nada — o resumo na tela era específico e o documento, não.
  const cenarios = [
    ['mama', { histologia: 'CDI', sexo: 'Masculino', extensao_doenca: 'Inicial (operável)', idade: '61' }, /masculino/i],
    ['mama', { histologia: 'CDI', subtipo_molecular: 'Triplo-negativo', extensao_doenca: 'Metastático', idade: '45' }, /triplo-negativo|45 anos/i],
    ['colorretal', { histologia: 'Adenocarcinoma', extensao_doenca: 'Localizado / ressecado', mmr_msi: 'pMMR / MSS', idade: '44' }, /44 anos/],
  ];
  for (const [id, valores, esperado] of cenarios) {
    const { resultado } = triar(id, valores);
    const germinativo = (resultado.tests || []).find((t) => t.kind === 'germinativo');
    assert.ok(germinativo, `${id}: sem teste germinativo no cenário`);
    assert.match(germinativo.justify, esperado,
      `${id}: a justificativa impressa não diz qual critério foi atendido — veio "${germinativo.justify}"`);
    assert.ok(!/^Perfil com critério de indicação de teste germinativo\.?$/i.test(germinativo.justify.trim()),
      `${id}: justificativa genérica demais para um documento assinado`);
  }
});

test('teste indicado sempre oferece ao menos uma via de acesso — ou diz que não há', () => {
  // A raiz do erro do HRD de ovário: existia programa gratuito com critério
  // idêntico ao da regra, e o card não o mostrava. O médico via a indicação do
  // exame e nenhum caminho gratuito para obtê-lo. A ausência passou anos sem
  // ser notada porque nada verificava a ausência — só a presença errada.
  const cenarios = [
    ['ovario', { histologia: 'Seroso', grau: 'Alto grau', estadiamento: 'IIIC' }],
    ['ovario', { histologia: 'Endometrioide', grau: 'Alto grau', estadiamento: 'IV' }],
    ['mama', { histologia: 'CDI', subtipo_molecular: 'Triplo-negativo', extensao_doenca: 'Metastático', idade: '45' }],
    ['prostata', { extensao_doenca: 'Metastático resistente à castração (mCRPC)' }],
    ['colorretal', { histologia: 'Adenocarcinoma', extensao_doenca: 'Metastático', mmr_msi: 'dMMR / MSI-alto', idade: '68' }],
    ['pulmao', { histologia: 'Adenocarcinoma', extensao_doenca: 'Metastático' }],
    ['pancreas', { histologia: 'Adenocarcinoma ductal', extensao_doenca: 'Metastático' }],
    ['endometrio', { histologia: 'Endometrioide', estadiamento: 'IIIC', mmr_msi: 'dMMR / MSI-alto' }],
  ];
  for (const [id, valores] of cenarios) {
    const { resultado } = triar(id, valores);
    for (const teste of resultado.tests || []) {
      assert.ok((teste.programs || []).length > 0,
        `${id}/${teste.id}: teste indicado sem NENHUMA via de acesso listada`);
    }
  }
});

test('o teste HRD de ovário oferece a via gratuita, que existe e tem o mesmo critério', () => {
  // Regressão direta do erro relatado: o programa patrocinado de HRD tem
  // exatamente o critério desta regra (seroso ou endometrioide de alto grau),
  // e sumiu do card quando a associação errada com próstata foi removida.
  for (const histologia of ['Seroso', 'Endometrioide']) {
    const { resultado } = triar('ovario', { histologia, grau: 'Alto grau', estadiamento: 'IIIC' });
    const hrd = (resultado.tests || []).find((t) => t.id === 'hrd');
    assert.ok(hrd, `ovario/${histologia}: HRD não foi indicado`);
    const gratuitos = (hrd.programs || []).filter((p) => /sem custo|gratuito/i.test(p.note || ''));
    assert.ok(gratuitos.length >= 1,
      `ovario/${histologia}: HRD indicado sem nenhuma via GRATUITA, e ela existe`);
    for (const p of gratuitos) {
      assert.ok(p.url, `ovario/${histologia}: programa "${p.name}" sem link para o médico solicitar`);
      assert.ok(p.cobertura && p.cobertura.includes('ovario'),
        `ovario/${histologia}: programa "${p.name}" sem cobertura declarada para ovário`);
    }
  }
});

test('o app não é mais agressivo que a diretriz que ele cita (§38.3)', () => {
  // 50+, pMMR, sem história familiar: o NCCN coloca o painel germinativo como
  // "pode ser considerado", não como recomendação. O app tem de entregar isso
  // como NOTA — nunca como teste indicado. Se algum dia alguém transformar a
  // nota em indicação para "não perder portador", este teste quebra.
  const semHistoria = TUMORS.get('colorretal').classify({
    histologia: 'Adenocarcinoma', extensao_doenca: 'Localizado / ressecado',
    mmr_msi: 'pMMR / MSS', idade: '62', historico_familiar: '', testes_previos: '',
  });
  assert.strictEqual(semHistoria.state, 'sem-indicacao');
  assert.deepStrictEqual(nomesDosTestes(semHistoria), []);

  const nota = (semHistoria.notes || []).find((n) => /considerad/i.test(n.title || ''));
  assert.ok(nota, 'a nota de "pode ser considerado" sumiu do resultado');
  assert.match(nota.body, /15,5%/, 'a nota perdeu o dado que sustenta a consideração');
  assert.match(nota.body, /Uson/, 'a nota perdeu a fonte');

  // E a história familiar é o que vira recomendação de verdade.
  const comHistoria = TUMORS.get('colorretal').classify({
    histologia: 'Adenocarcinoma', extensao_doenca: 'Localizado / ressecado',
    mmr_msi: 'pMMR / MSS', idade: '62',
    historico_familiar: 'Mãe com câncer de cólon aos 55 anos', testes_previos: '',
  });
  assert.ok(nomesDosTestes(comHistoria).includes('germinativo-crc-familiar'));
  assert.match(
    comHistoria.tests.find((t) => t.id === 'germinativo-crc-familiar').justify,
    /hist[óo]ria familiar/i,
    'a justificativa não diz ao médico o que disparou a indicação',
  );
});

test('RET fica fora da doença ressecável enquanto o NCCN não incorporar (§38.4)', () => {
  const ressecavel = TUMORS.get('pulmao').classify({
    histologia: 'Adenocarcinoma', extensao_doenca: 'Ressecável',
    estadiamento: 'IIA', idade: '64', historico_familiar: '', testes_previos: '',
  });
  const dirigido = (ressecavel.tests || []).find((t) => t.id === 'alvo-adjuvante-nsclc');
  if (dirigido) {
    assert.ok(!/\bRET\b/.test(dirigido.name + ' ' + dirigido.description),
      'RET entrou na pesquisa dirigida da doença ressecável sem o NCCN ter incorporado');
  }
});

test('próstata: o verbo da diretriz é preservado nas duas direções (§39.2 e §39.3)', () => {
  const prostata = TUMORS.get('prostata');
  const base = { histologia: '', gleason_grade_group: '', psa: '', extensao_doenca: 'Localizado',
    categoria_risco_localizado: 'Intermediário favorável', ascendencia_ashkenazi: '',
    historia_pessoal_cancer: '', idade: '', historico_familiar: '', testes_previos: '' };

  // Intraductal em risco intermediário: nota, nunca teste.
  const intra = prostata.classify({ ...base, histologia: 'Adenocarcinoma com componente cribriforme' });
  assert.deepStrictEqual(nomesDosTestes(intra), [], 'intraductal voltou a indicar teste em risco intermediário');
  assert.ok((intra.notes || []).some((n) => /considerad/i.test(n.title)),
    'a nota de consideração da histologia intraductal sumiu');

  // Mama pessoal: indicação de verdade, com a razão na justificativa impressa.
  const mama = prostata.classify({ ...base, historia_pessoal_cancer: 'Carcinoma de mama tratado em 2019' });
  assert.ok(nomesDosTestes(mama).includes('germinativo-prostata'),
    'história pessoal de câncer de mama perdeu a indicação germinativa');
  assert.match(mama.tests[0].justify, /mama/i);

  // Outro tumor da lista: nota, não indicação.
  const outro = prostata.classify({ ...base, historia_pessoal_cancer: 'Adenocarcinoma gástrico' });
  assert.deepStrictEqual(nomesDosTestes(outro), []);
  assert.ok((outro.notes || []).some((n) => /considerad/i.test(n.title)));

  // TP53 não está na lista do NCCN e não pode aparecer no painel. §39.1
  const meta = prostata.classify({ ...base, extensao_doenca: 'Metastático resistente à castração (mCRPC)' });
  const painel = meta.tests.find((t) => t.id === 'germinativo-prostata');
  assert.ok(!/TP53/.test(painel.name), 'TP53 entrou no painel germinativo de próstata sem estar no NCCN');
  assert.ok(nomesDosTestes(meta).includes('msi-prostata'), 'MSI/dMMR saiu do mCRPC');
});

test('pâncreas: painel completo e somático na doença localmente avançada (§40)', () => {
  const pancreas = TUMORS.get('pancreas');
  const base = { histologia: 'Adenocarcinoma ductal', extensao_doenca: '', platina: '',
    idade: '', historico_familiar: '', testes_previos: '' };

  const painelDe = (ext) => {
    const r = pancreas.classify({ ...base, extensao_doenca: ext });
    return { r, germinativo: r.tests.find((t) => t.id === 'germinativo-pancreas') };
  };

  // Os quatro genes que faltavam, e o que não pode entrar.
  const { germinativo } = painelDe('Ressecável');
  for (const gene of ['CDKN2A', 'STK11', 'APC', 'RAD51C']) {
    assert.match(germinativo.name, new RegExp(gene), `${gene} saiu do painel germinativo de pâncreas`);
  }
  assert.ok(!/TP53/.test(germinativo.name), 'TP53 entrou sem estar na lista do NCCN');

  // Somático: entra na localmente avançada, não só na metastática.
  assert.deepStrictEqual(nomesDosTestes(painelDe('Ressecável').r), ['germinativo-pancreas']);
  assert.ok(nomesDosTestes(painelDe('Borderline / localmente avançado').r).includes('somatico-pancreas'),
    'doença localmente avançada perdeu o perfil somático');
  assert.ok(nomesDosTestes(painelDe('Metastático').r).includes('somatico-pancreas'));

  // A promessa de PARP não se alarga junto: POLO foi em doença metastática.
  const avancadoEmPlatina = pancreas.classify({ ...base,
    extensao_doenca: 'Borderline / localmente avançado', platina: 'Em uso / respondendo a platina' });
  assert.ok(!(avancadoEmPlatina.notes || []).some((n) => /PARP/i.test(n.body || '')),
    'a nota de manutenção com PARP escapou para a doença localmente avançada');
  const metaEmPlatina = pancreas.classify({ ...base,
    extensao_doenca: 'Metastático', platina: 'Em uso / respondendo a platina' });
  assert.ok((metaEmPlatina.notes || []).some((n) => /PARP/i.test(n.body || '')));
});

test('pulmão, colorretal e mama: os alvos aparecem pelo nome (§41)', () => {
  // Pulmão: cada marcador com sua faixa real, e "IIIB" não pode voltar.
  const pulmao = TUMORS.get('pulmao').classify({
    histologia: 'Adenocarcinoma', extensao_doenca: 'Inicial (ressecável)',
    painel_previo: 'Não realizado', idade: '61', historico_familiar: '', testes_previos: '',
  });
  const adjuvante = pulmao.tests.find((t) => t.id === 'alvo-adjuvante-nsclc');
  assert.match(adjuvante.description, /IB a IIIA/, 'a faixa de EGFR/ALK saiu do texto');
  assert.match(adjuvante.description, /II a IIIA/, 'a faixa própria de PD-L1 saiu do texto');
  assert.match(adjuvante.description, /4 cm/, 'o limite de tamanho do IB em ALK saiu do texto');
  assert.ok(!/IIIB/.test(adjuvante.description), 'a faixa imprecisa "IIIB" voltou ao texto adjuvante');

  // Colorretal metastático: KRAS G12C e NTRK nomeados; MSI não repetido.
  const crc = TUMORS.get('colorretal').classify({
    histologia: 'Adenocarcinoma', extensao_doenca: 'Metastático',
    mmr_msi: 'pMMR / MSS', idade: '61', historico_familiar: '', testes_previos: '',
  });
  const somaticoCrc = crc.tests.find((t) => t.id === 'somatico-crc');
  assert.match(somaticoCrc.name, /KRAS G12C/);
  assert.match(somaticoCrc.name, /NTRK/);

  // Mama metastática luminal: a via PI3K/AKT completa.
  const mama = TUMORS.get('mama').classify({
    sexo: 'Feminino', subtipo_molecular: 'Luminal (RH+/HER2-)', extensao_doenca: 'Metastático',
    histologia: 'Carcinoma ductal invasivo', idade: '61', historico_familiar: '', testes_previos: '',
  });
  const somaticoMama = mama.tests.find((t) => t.id === 'somatico-mama');
  assert.ok(somaticoMama, 'a mama metastática luminal perdeu o painel somático');
  for (const alvo of ['PIK3CA', 'AKT1', 'PTEN', 'ESR1']) {
    assert.match(somaticoMama.name, new RegExp(alvo), `${alvo} saiu do painel somático de mama`);
  }
  assert.ok((mama.notes || []).some((n) => /HER2-low/.test(n.body || '')),
    'a nota dos biomarcadores que passam em branco sumiu');
});
