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
    // §38.8b. A metilação de MLH1 passou a ser emitida como PEDIDO, e não só
    // como texto de nota: a nota manda fazê-la antes do germinativo, e o
    // passo um não tinha card, amostra nem linha no documento impresso.
    nome: 'dMMR localizado — metilação + Lynch, sem somático',
    tumor: 'colorretal',
    valores: { histologia: 'Adenocarcinoma', extensao_doenca: 'Localizado / ressecado', mmr_msi: 'dMMR / MSI-alto' },
    estado: 'completo', testes: ['metilacao-mlh1', 'germinativo-lynch'],
  },
  {
    // §38.8b, idem.
    nome: 'dMMR metastático — metilação + Lynch + perfil somático',
    tumor: 'colorretal',
    valores: { histologia: 'Adenocarcinoma', extensao_doenca: 'Metastático', mmr_msi: 'dMMR / MSI-alto' },
    estado: 'completo', testes: ['metilacao-mlh1', 'germinativo-lynch', 'somatico-crc'],
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
    // dMMR também precisa de POLE e p53: o algoritmo é hierárquico e POLE
    // PREVALECE sobre MMRd — um tumor dMMR que seja POLEmut é classificado
    // como POLEmut, com conduta adjuvante oposta. A §30.4 já dizia que o
    // algoritmo vale para TODO carcinoma de endométrio; era o código que
    // restringia ao pMMR, contradizendo o texto do próprio card. §47.5
    nome: 'dMMR — Lynch E a classificação molecular, que POLE pode reverter',
    tumor: 'endometrio',
    valores: { histologia: 'Endometrioide', estadiamento: 'II', mmr_msi: 'dMMR / MSI-alto' },
    estado: 'completo', testes: ['germinativo-lynch-endo', 'classificacao-molecular-endo'],
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
    nome: 'dMMR em estágio IA — o MMR não se repete, mas POLE e p53 entram',
    tumor: 'endometrio',
    valores: { histologia: 'Endometrioide', estadiamento: 'IA', mmr_msi: 'dMMR / MSI-alto' },
    estado: 'completo', testes: ['germinativo-lynch-endo', 'classificacao-molecular-endo'],
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
    /* §38.8a. Eram DOIS painéis germinativos sobrepostos neste caso — o
     * multigênico já contém os genes de Lynch. Decisão de curadoria: um só.
     * E §38.8b trouxe a metilação para a lista, como passo um da sequência. */
    nome: 'C3 colorretal 44a dMMR metastatico — um germinativo, com a metilação antes',
    tumor: 'colorretal',
    valores: { histologia: 'Adenocarcinoma', extensao_doenca: 'Metastático', mmr_msi: 'dMMR / MSI-alto', idade: '44' },
    estado: 'completo', testes: ['germinativo-crc-precoce', 'metilacao-mlh1', 'somatico-crc'],
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

/* §82. O nome deste teste era "filled() trata negativas explícitas como
 * ausência de conteúdo" — e `filled()` conhece exatamente DUAS frases. O nome
 * prometia um invariante geral que a função não entrega, e deu falsa
 * cobertura ao defeito do histórico familiar por meses: quem lesse a lista de
 * testes concluiria que negativas estavam tratadas. Teste que promete mais do
 * que verifica é pior que teste ausente, porque desencoraja quem iria olhar.
 * O nome agora diz o que a função faz; quem trata negativa de verdade é
 * `temHistoricoFamiliar()`, testada logo abaixo. */
test('filled() reconhece as duas frases canônicas da IA como vazio', () => {
  ['', ' ', '-', 'Não relatado', 'não relatado', 'Nenhum relatado']
    .forEach((v) => assert.ok(!H.filled(v), `"${v}" deveria contar como vazio`));
  ['mãe com câncer de mama', 'Seroso'].forEach((v) => assert.ok(H.filled(v), `"${v}" tem conteúdo`));
  // E o limite da função, explicitado: ela NÃO entende negação em prosa.
  assert.ok(H.filled('Nega história familiar'),
    'filled() passou a interpretar prosa — essa responsabilidade é de temHistoricoFamiliar()');
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
    // §56: o custo saiu do texto de cada programa (dizer "sem custo" em um e
    // não nos outros induz o clique). A via gratuita passou a ser reconhecida
    // pelo que ela É — tipo 'patrocinado' —, não por uma palavra na descrição.
    // Sinal estrutural não se perde numa reescrita de texto.
    const gratuitos = (hrd.programs || []).filter((p) => p.tipo === 'patrocinado');
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

test('todo teste germinativo sai com o laboratório de oncogenética ligado (§44)', () => {
  // O médico que recebe a indicação precisa saber ONDE solicitar. Um card
  // germinativo sem encaminhamento é um beco sem saída — e o esquecimento é
  // silencioso, porque o card aparece normalmente. A garantia é estrutural
  // (envelopa classify no registro), e este teste varre o cenário inteiro.
  const CENARIOS = [
    ['ovario', { histologia: 'Seroso', grau: 'Alto grau', estadiamento: 'IIIC', idade: '61' }],
    ['ovario', { histologia: 'Mucinoso', estadiamento: 'IA', idade: '44' }],
    ['mama', { sexo: 'Masculino', subtipo_molecular: 'Luminal (RH+/HER2-)', extensao_doenca: 'Inicial (operável)', idade: '60' }],
    ['mama', { sexo: 'Feminino', subtipo_molecular: 'Triplo-negativo', extensao_doenca: 'Metastático', idade: '38' }],
    ['prostata', { extensao_doenca: 'Metastático resistente à castração (mCRPC)' }],
    ['prostata', { extensao_doenca: 'Localizado', categoria_risco_localizado: 'Alto' }],
    ['prostata', { extensao_doenca: 'Localizado', categoria_risco_localizado: 'Baixo', historia_pessoal_cancer: 'Câncer de mama' }],
    ['pancreas', { histologia: 'Adenocarcinoma ductal', extensao_doenca: 'Metastático' }],
    ['colorretal', { histologia: 'Adenocarcinoma', extensao_doenca: 'Localizado / ressecado', mmr_msi: 'pMMR / MSS', idade: '44' }],
    ['colorretal', { histologia: 'Adenocarcinoma', extensao_doenca: 'Metastático', mmr_msi: 'dMMR / MSI-alto', idade: '70' }],
    ['colorretal', { histologia: 'Adenocarcinoma', extensao_doenca: 'Localizado / ressecado', mmr_msi: 'pMMR / MSS', idade: '62', historico_familiar: 'Pai com câncer de cólon' }],
    ['endometrio', { histologia: 'Endometrioide', estadiamento: 'IA', mmr_msi: 'dMMR / MSI-alto', idade: '58' }],
  ];

  let germinativosVistos = 0;
  for (const [tumorId, valores] of CENARIOS) {
    const { resultado } = triar(tumorId, valores);
    (resultado.tests || []).filter((t) => t.kind === 'germinativo').forEach((teste) => {
      germinativosVistos++;
      const programas = teste.programs || [];
      const life = programas.find((p) => p && /life genomics/i.test(p.name || ''));
      assert.ok(life, `${tumorId}/${teste.id}: teste germinativo sem encaminhamento à Life Genomics`);
      assert.match(String(life.url || ''), /^https:\/\//,
        `${tumorId}/${teste.id}: o encaminhamento germinativo não tem endereço utilizável`);
      // A amostra do encaminhamento precisa bater com a do exame: germinativo
      // é sangue, e mandar para um parceiro que só processa tecido é o mesmo
      // erro de antes, com outra roupa.
      assert.ok(['sangue', 'ambos'].includes(life.amostra),
        `${tumorId}/${teste.id}: encaminhamento germinativo para parceiro de ${life.amostra}`);
    });
  }
  assert.ok(germinativosVistos >= 12, `a varredura precisa cobrir os germinativos (viu ${germinativosVistos})`);
});

test('toda via patrocinada tem endereço, fonte e data de verificação (§44)', () => {
  // Um programa sem endereço utilizável manda o médico a lugar nenhum; um
  // programa sem fonte e sem data não tem como ser revalidado, e foi assim que
  // o consórcio de pulmão ficou quatro anos no app com uma porta morta dentro.
  const CENARIOS = [
    ['ovario', { histologia: 'Seroso', grau: 'Alto grau', estadiamento: 'IIIC', idade: '61' }],
    ['mama', { sexo: 'Feminino', subtipo_molecular: 'Luminal (RH+/HER2-)', extensao_doenca: 'Metastático', idade: '61' }],
    ['prostata', { extensao_doenca: 'Metastático resistente à castração (mCRPC)' }],
    ['pulmao', { histologia: 'Adenocarcinoma', extensao_doenca: 'Inicial (ressecável)', painel_previo: 'Não realizado', idade: '64' }],
    ['pulmao', { histologia: 'Adenocarcinoma', extensao_doenca: 'Metastático', painel_previo: 'Não realizado', idade: '64' }],
    ['pancreas', { histologia: 'Adenocarcinoma ductal', extensao_doenca: 'Metastático' }],
    ['colorretal', { histologia: 'Adenocarcinoma', extensao_doenca: 'Metastático', mmr_msi: 'pMMR / MSS', idade: '61' }],
    ['endometrio', { histologia: 'Endometrioide', estadiamento: 'IA', mmr_msi: 'pMMR / MSS', idade: '58' }],
  ];

  let patrocinadosVistos = 0;
  for (const [tumorId, valores] of CENARIOS) {
    const { resultado } = triar(tumorId, valores);
    (resultado.tests || []).forEach((teste) => {
      (teste.programs || []).forEach((p) => {
        assert.ok(p.tipo, `${tumorId}/${teste.id}: programa "${p.name}" não declara o tipo`);
        assert.ok(p.verificadoEm && /^\d{4}-\d{2}-\d{2}$/.test(p.verificadoEm),
          `${tumorId}/${teste.id}: "${p.name}" sem data de verificação`);
        if (p.tipo === 'patrocinado') {
          patrocinadosVistos++;
          assert.match(String(p.url || ''), /^https:\/\//,
            `${tumorId}/${teste.id}: via patrocinada "${p.name}" sem endereço utilizável`);
          assert.ok(String(p.fonte || '').length > 30,
            `${tumorId}/${teste.id}: "${p.name}" sem fonte que permita revalidar`);
          assert.ok((p.cobertura || []).includes(tumorId),
            `${tumorId}/${teste.id}: "${p.name}" oferecido a um tumor que ele não cobre`);
        }
      });
    });
  }
  assert.ok(patrocinadosVistos >= 5, `a varredura precisa ver as vias patrocinadas (viu ${patrocinadosVistos})`);
});

test('o consórcio de pulmão com porta morta não volta pelo card (§44.1)', () => {
  for (const ext of ['Inicial (ressecável)', 'Metastático']) {
    const { resultado } = triar('pulmao', {
      histologia: 'Adenocarcinoma', extensao_doenca: ext,
      painel_previo: 'Não realizado', idade: '64',
    });
    (resultado.tests || []).forEach((teste) => {
      (teste.programs || []).forEach((p) => {
        assert.ok(!/mapeamento pulm|onTRacK/i.test(p.name),
          `o consórcio voltou ao card sem revalidação: "${p.name}"`);
      });
    });
  }
});

/* §89. Decisão do dono: a tela não mostra critério de elegibilidade nem a
 * data de conferência (quem informa o médico é o próprio programa), e o
 * painel germinativo deixa de se chamar "laboratório parceiro". Os dados
 * continuam no registro para a auditoria interna: este teste vigia que a data
 * de conferência siga registrada e que o nome não volte a falar em parceria.
 * A ausência na TELA é vigiada pela bateria de navegador. */
test('nenhum programa se apresenta como parceiro da plataforma (§89)', () => {
  for (const tumorId of TUMORS.ORDER) {
    const tumor = TUMORS.get(tumorId);
    const v = {};
    tumor.fields.forEach((f) => { v[f.key] = ''; });
    // Um caso qualquer de cada tumor já lista os programas do registro.
    const r = tumor.classify(v);
    (r.tests || []).flatMap((t) => t.programs || []).forEach((p) => {
      assert.ok(!/parceir/i.test(p.name), `${tumorId}: "${p.name}" fala em parceria no nome`);
    });
  }
  const { resultado } = triar('ovario', { histologia: 'Seroso', grau: 'Alto grau', estadiamento: 'IIIC' });
  const programas = resultado.tests.flatMap((t) => t.programs || []);
  const life = programas.find((p) => /Life Genomics/.test(p.name));
  assert.ok(life, 'o germinativo de ovário perdeu a Life Genomics');
  assert.strictEqual(life.name, 'Life Genomics');
  // A data continua registrada para a auditoria, mesmo fora da tela.
  programas.filter((p) => p.tipo === 'patrocinado').forEach((p) => {
    assert.match(String(p.verificadoEm || ''), /^\d{4}-\d{2}-\d{2}$/, `${p.name}: sem data de verificação no registro`);
  });
});

/* §56. Nome, selo e ordem dos programas de indústria.
 *
 * O motivo é de conduta, não de estética: quando um programa escreve "sem
 * custo" no próprio nome e os outros não, ele ganha o clique por redação, não
 * por elegibilidade. Como TODOS os programas de indústria do registro são sem
 * custo, a frase não informa nada — só desequilibra. */
// Casos reais que fazem o registro devolver programa de indústria. Um teste
// que roda `triar(id, {})` não produz programa nenhum e passa por vacuidade —
// foi o que aconteceu na primeira escrita destes testes.
const CASOS_COM_PROGRAMA = [
  ['ovario', { histologia: 'Seroso', grau: 'Alto grau', estadiamento: 'IIIC' }],
  ['pulmao', { histologia: 'Adenocarcinoma', extensao_doenca: 'Metastático' }],
  ['colorretal', { histologia: 'Adenocarcinoma', extensao_doenca: 'Metastático' }],
  ['prostata', { extensao_doenca: 'Metastático resistente à castração (mCRPC)' }],
  ['mama', { subtipo_molecular: 'Triplo-negativo', extensao_doenca: 'Metastático', idade: '44' }],
];

function programasDeIndustria() {
  const vistos = new Map();
  for (const [id, valores] of CASOS_COM_PROGRAMA) {
    const { resultado } = triar(id, valores);
    (resultado.tests || []).flatMap((t) => t.programs || []).forEach((p) => {
      if (p.tipo === 'patrocinado') vistos.set(p.name, p);
    });
  }
  assert.ok(vistos.size >= 2, `só ${vistos.size} programa(s) de indústria apareceram — o teste não mediria nada`);
  return vistos;
}

test('nenhum programa anuncia custo no nome ou no selo', () => {
  const vistos = programasDeIndustria().values();
  for (const p of vistos) {
    if (p.tipo !== 'patrocinado') continue;
    assert.ok(!/sem custo|gratuit|grátis/i.test(p.name),
      `${p.name}: custo no NOME do programa induz o clique naquela plataforma`);
    assert.ok(!/sem custo|gratuit|grátis/i.test(p.note || ''),
      `${p.name}: custo na descrição do programa induz o clique naquela plataforma`);
  }
});

test('todo programa de indústria segue o padrão Nome (Indústria)', () => {
  for (const [nome, p] of programasDeIndustria()) {
    assert.match(nome, /\([^)]+\)\s*$/, `${nome}: falta a indústria entre parênteses no fim do nome`);
    assert.ok(p.industria, `${nome}: sem o campo "industria" declarado no registro`);
    assert.ok(nome.includes(`(${p.industria})`),
      `${nome}: o nome não traz "(${p.industria})" — o padrão precisa valer para todos`);
  }
});

test('em ovário, os dois programas de indústria aparecem e a ordem é a declarada', () => {
  const { resultado } = triar('ovario', { histologia: 'Seroso', grau: 'Alto grau', estadiamento: 'IIIC' });
  const comHrd = (resultado.tests || []).find((t) => (t.programs || []).some((p) => /GSK/.test(p.name)));
  assert.ok(comHrd, 'o teste de HRD perdeu o programa da GSK');

  const ordenados = TUMORS.ordenarProgramas(comHrd.programs).map((p) => p.industria || p.tipo);
  const industrias = ordenados.filter((x) => x === 'AstraZeneca' || x === 'GSK');
  assert.deepStrictEqual(industrias, ['AstraZeneca', 'GSK'],
    `ordem declarada não respeitada: ${ordenados.join(' → ')}`);
  // E o laboratório/ausência de via nunca sobe acima de um programa real.
  const faixas = TUMORS.ordenarProgramas(comHrd.programs).map((p) => p.tipo);
  const primeiroNaoPatrocinado = faixas.indexOf('laboratorio');
  const ultimoPatrocinado = faixas.lastIndexOf('patrocinado');
  if (primeiroNaoPatrocinado >= 0 && ultimoPatrocinado >= 0) {
    assert.ok(primeiroNaoPatrocinado > ultimoPatrocinado, `faixas fora de ordem: ${faixas.join(' → ')}`);
  }
});

test('indústria não declarada na ordem não some nem fura a fila', () => {
  const entrada = [
    { tipo: 'laboratorio', name: 'Lab' },
    { tipo: 'patrocinado', name: 'Z (Zeta)', industria: 'Zeta' },
    { tipo: 'sem-via', name: 'Sem via' },
    { tipo: 'patrocinado', name: 'PD-Point (MSD)', industria: 'MSD' },
    { tipo: 'patrocinado', name: 'ProgramAID (AstraZeneca)', industria: 'AstraZeneca' },
    { tipo: 'patrocinado', name: 'A (Alfa)', industria: 'Alfa' },
  ];
  const saida = TUMORS.ordenarProgramas(entrada).map((p) => p.name);
  assert.deepStrictEqual(saida, [
    'ProgramAID (AstraZeneca)', 'PD-Point (MSD)', // ordem declarada
    'A (Alfa)', 'Z (Zeta)',                       // não declaradas, alfabética
    'Lab',                                        // laboratório
    'Sem via',                                    // ausência de via, por último
  ], `ordenação inesperada: ${saida.join(' → ')}`);
  assert.strictEqual(saida.length, entrada.length, 'a ordenação perdeu um programa');
});

/* §67. O marca-texto nos critérios que EXCLUEM.
 *
 * Os trechos vêm declarados no registro (`destaques`), não deduzidos da tela.
 * A alternativa tentadora era marcar o que está em CAIXA ALTA — acertaria
 * "ALTO GRAU" e erraria "KRAS G12C", "PD-L1" e "EGFR", que são nomes de gene,
 * não critérios de elegibilidade. Destacar um gene como se fosse condição de
 * recusa é pior que não destacar nada. */
test('todo destaque declarado existe de fato no texto do programa', () => {
  const vistos = programasDeIndustria();
  let comDestaque = 0;
  for (const [nome, p] of vistos) {
    if (!p.destaques) continue;
    comDestaque++;
    assert.ok(Array.isArray(p.destaques), `${nome}: destaques precisa ser lista`);
    for (const trecho of p.destaques) {
      assert.ok(String(p.note || '').includes(trecho),
        `${nome}: destaque "${trecho}" não aparece na descrição — marcaria nada, ou o trecho errado`);
    }
  }
  assert.ok(comDestaque >= 1, 'nenhum programa declarou destaques — o teste não mediu nada');
});

test('o destaque do programa de ovário cobre os dois critérios de exclusão', () => {
  // Mesmos dois trechos que o corte de 78 caracteres escondia (§53): o grau e
  // a linha de tratamento. São eles que NEGAM o encaminhamento.
  const { resultado } = triar('ovario', { histologia: 'Seroso', grau: 'Alto grau', estadiamento: 'IIIC' });
  const gsk = resultado.tests.flatMap((t) => t.programs || []).find((p) => /GSK/.test(p.name));
  assert.ok(gsk, 'o programa da GSK sumiu do card de ovário');
  assert.ok(gsk.destaques && gsk.destaques.length >= 2, 'o programa de ovário perdeu os destaques');
  assert.match(gsk.destaques.join(' | '), /ALTO GRAU/, 'o grau deixou de ser destacado');
  assert.match(gsk.destaques.join(' | '), /PRIMEIRA LINHA/, 'a linha de tratamento deixou de ser destacada');
});

test('nenhum destaque marca nome de gene', () => {
  // Lista curta e explícita: se um destaque for só um gene, é sinal de que
  // alguém trocou "critério que exclui" por "palavra que chama atenção".
  const GENES = /^(BRCA1|BRCA2|BRCA1\/2|KRAS|NRAS|BRAF|EGFR|ALK|PD-L1|HER2|MLH1|MSH2|MSH6|PMS2|EPCAM|PALB2|ATM|RAD51C|RAD51D|BRIP1|NTRK|PIK3CA|AKT1|PTEN|ESR1|HOXB13|STK11|CDKN2A|APC|MUTYH)$/i;
  for (const [nome, p] of programasDeIndustria()) {
    for (const trecho of p.destaques || []) {
      assert.ok(!GENES.test(trecho.trim()),
        `${nome}: "${trecho}" é nome de gene, não critério de exclusão`);
    }
  }
});

/* ===================================================================
 * §70. AUDITORIA DE INVARIANTES, DENTRO DA SUÍTE
 *
 * `auditoria-clinica.js` percorre TODAS as combinações de campos de todos os
 * tumores — 67 mil — e confere afirmações que precisam valer em qualquer
 * caminho da regra. Custa 2,3 s.
 *
 * A diferença para os testes acima: eles afirmam "neste caso, este
 * resultado". A auditoria afirma "em NENHUM caso pode acontecer isto". Uma
 * regra nova entra na auditoria sem ninguém escrever um teste para ela — e é
 * aí que está o valor: o defeito que ninguém previu.
 * =================================================================== */
const { auditar } = require('./auditoria-clinica.js');

test('nenhuma combinação de campos viola um invariante clínico', () => {
  const { achados, resumo } = auditar();

  const total = resumo.reduce((n, r) => n + r.combinacoes, 0);
  assert.ok(total > 50000, `só ${total} combinações percorridas — a auditoria encolheu e deixaria de medir`);
  assert.ok(resumo.every((r) => !r.truncado), `auditoria truncada em: ${resumo.filter((r) => r.truncado).map((r) => r.tumor).join(', ')}`);

  // Agrupa por assinatura: o mesmo defeito aparece em centenas de
  // combinações, e a mensagem precisa dizer quantos defeitos DISTINTOS há.
  const distintos = new Map();
  for (const a of achados) {
    const chave = `[${a.tumor}] ${a.tipo}: ${a.detalhe}`;
    distintos.set(chave, (distintos.get(chave) || 0) + 1);
  }
  const lista = [...distintos.entries()].map(([k, n]) => `${k} (${n}x)`);
  assert.deepStrictEqual(lista, [], `violações de invariante:\n  ${lista.join('\n  ')}`);
});

/* §70.1 REGRESSÃO: dois testes prioritários no mesmo resultado.
 *
 * Achado da auditoria, em 468 combinações de colorretal. O painel germinativo
 * de início precoce usava `primary: !dmmr` — prioritário sempre que o status
 * de MMR fosse desconhecido, que é exatamente quando o teste de MMR também
 * entra, e ele já nascia prioritário.
 *
 * Na tela não é detalhe: o passo prioritário é o que recebe o nó pintado na
 * sequência (§63), e dois nós pintados dizem que há dois "primeiros". Numa
 * triagem provisória, são também duas pílulas "confirmar critério".
 *
 * A auditoria cobre isto em todos os tumores. Este teste fixa o caso exato,
 * com a leitura clínica por extenso, para quem mexer na regra de colorretal
 * ver o porquê sem precisar reconstruir o raciocínio. */
test('§70.1 colorretal precoce: o MMR lidera, e só um teste é prioritário', () => {
  const caso = { extensao_doenca: 'Localizado / ressecado', idade: '38' };
  const { resultado } = triar('colorretal', caso);

  const ids = resultado.tests.map((t) => t.id);
  assert.deepStrictEqual(ids, ['mmr', 'germinativo-crc-precoce'],
    `os testes ou a ordem mudaram: ${ids.join(', ')}`);

  const prioritarios = resultado.tests.filter((t) => t.primary).map((t) => t.id);
  assert.deepStrictEqual(prioritarios, ['mmr'],
    `prioritário tem de ser só o MMR, que é o rastreio universal que orienta o germinativo. Veio: ${prioritarios.join(', ') || 'nenhum'}`);
});

test('§70.1 com o MMR já feito, o painel germinativo passa a liderar', () => {
  // O outro lado da mesma regra: sem o MMR na lista, quem lidera é o painel.
  // Sem esta metade, "primary: false" fixo passaria no teste acima e deixaria
  // o resultado sem nenhum teste prioritário.
  const { resultado } = triar('colorretal', {
    extensao_doenca: 'Localizado / ressecado', idade: '38', mmr_msi: 'pMMR / MSS',
  });
  const ids = resultado.tests.map((t) => t.id);
  assert.ok(!ids.includes('mmr'), 'o MMR foi pedido de novo mesmo já tendo sido feito');

  const prioritarios = resultado.tests.filter((t) => t.primary).map((t) => t.id);
  assert.deepStrictEqual(prioritarios, ['germinativo-crc-precoce'],
    `sem o MMR, o painel precoce tem de liderar. Veio: ${prioritarios.join(', ') || 'nenhum'}`);
});

test('§70.1 nenhum tumor devolve mais de um teste prioritário', () => {
  // A regra em si, acima do caso que a quebrou. Casos reais, não vazios.
  const CASOS = [
    ['ovario', { histologia: 'Seroso', grau: 'Alto grau', estadiamento: 'IIIC' }],
    ['mama', { subtipo_molecular: 'Triplo-negativo', extensao_doenca: 'Metastático', idade: '44' }],
    ['prostata', { extensao_doenca: 'Metastático resistente à castração (mCRPC)' }],
    ['colorretal', { extensao_doenca: 'Metastático', idade: '38', historico_familiar: 'Sim' }],
    ['pulmao', { histologia: 'Adenocarcinoma', extensao_doenca: 'Metastático' }],
    ['pancreas', { histologia: 'Adenocarcinoma ductal' }],
    ['endometrio', { histologia: 'Endometrioide', estadiamento: 'IA', mmr_msi: 'dMMR / MSI-alto' }],
  ];
  for (const [id, valores] of CASOS) {
    const { resultado } = triar(id, valores);
    const prioritarios = (resultado.tests || []).filter((t) => t.primary).map((t) => t.id);
    assert.ok(prioritarios.length <= 1,
      `${id}: ${prioritarios.length} prioritários (${prioritarios.join(', ')}) — a sequência passa a ter dois "primeiros"`);
  }
});

/* ====================================================================
 * §82. Os quatro defeitos de LEITURA DE CAMPO apontados pela auditoria
 * externa AV-ONCOGENYX-2026-10-18 e pela verificação interna.
 *
 * Nenhum deles é questão de critério clínico — todos fazem o motor dizer
 * algo diferente do que o critério documentado diz. Dois produzem
 * afirmação falsa em documento ASSINADO; dois apagam indicação de teste.
 * ==================================================================== */

test('§82.1 negação em prosa não vira critério de histórico familiar', () => {
  const mama = TUMORS.list().find((t) => t.id === 'mama');
  const base = {
    tipo_tumor: 'Mama', subtipo_molecular: 'Luminal (RH+/HER2-)',
    idade: '55', extensao_doenca: 'Inicial (operável)',
  };
  const negativas = [
    'Nega história familiar de câncer', 'nega', 'Sem história familiar',
    'sem antecedentes familiares', 'Ausente', 'Negativo', 'Não há',
    'Desconhecido', 'Nenhuma', 'n/a', 'NA', 'ignorado', 'sem dados', 'Não',
    'nega neoplasia em familiares',
  ];
  for (const texto of negativas) {
    const r = mama.classify(TUMORS.normalizar({ ...base, historico_familiar: texto }));
    assert.strictEqual(r.state, 'sem-indicacao',
      `"${texto}" foi lido como histórico familiar relatado`);
  }
});

test('§82.1b história real que CONTÉM uma negativa continua sendo histórico', () => {
  /* A armadilha que impede isto de ser um regex de "nega": história familiar
   * verdadeira frequentemente nega outra coisa na mesma frase. Inverter este
   * caso trocaria um falso positivo por um falso NEGATIVO, que apaga
   * indicação — o erro pior dos dois. */
  const mama = TUMORS.list().find((t) => t.id === 'mama');
  const base = {
    tipo_tumor: 'Mama', subtipo_molecular: 'Luminal (RH+/HER2-)',
    idade: '55', extensao_doenca: 'Inicial (operável)',
  };
  const positivas = [
    'mãe com câncer de mama aos 58 anos',
    'mãe com câncer de mama aos 58, nega outros casos',
    'Nega história familiar. Tia com câncer de ovário aos 44',
    'irmã com CA de ovário',
    'avó materna com câncer de mama',
    'dois parentes de primeiro grau com próstata',
  ];
  for (const texto of positivas) {
    const r = mama.classify(TUMORS.normalizar({ ...base, historico_familiar: texto }));
    assert.notStrictEqual(r.state, 'sem-indicacao',
      `"${texto}" é histórico familiar e deixou de indicar o teste`);
  }
});

test('§82.1c o documento assinado não cita a negação como se fosse a história', () => {
  /* O pior caso era colorretal, que imprimia o texto do campo entre
   * parênteses: "com história familiar oncológica relatada (Nega história
   * familiar)". A mesma frase afirmava e desmentia. */
  const crc = TUMORS.list().find((t) => t.id === 'colorretal');
  const r = crc.classify(TUMORS.normalizar({
    tipo_tumor: 'Colorretal', mmr_msi: 'pMMR / MSS', idade: '65',
    extensao_doenca: 'Localizado / ressecado',
    historico_familiar: 'Nega história familiar',
  }));
  const impresso = (r.tests || []).map((t) => t.justify || '').join(' ');
  assert.ok(!/Nega história familiar/i.test(impresso),
    `a justificativa impressa cita a negação: "${impresso.slice(0, 120)}"`);
});

test('§82.2 notação M1 do laudo é doença metastática, não localizada', () => {
  const prostata = TUMORS.list().find((t) => t.id === 'prostata');
  for (const ext of ['M1', 'M1b', 'M1c', 'm1', 'Doença metastática óssea']) {
    const r = prostata.classify(TUMORS.normalizar({
      tipo_tumor: 'Próstata', extensao_doenca: ext,
      gleason_grade_group: 'Gleason 4+5=9 (Grade Group 5)', psa: '80',
    }));
    const ids = (r.tests || []).map((t) => t.id);
    assert.ok(ids.includes('germinativo-prostata'),
      `"${ext}" não indicou germinativo — testes: ${ids.join(', ') || 'nenhum'}`);
    assert.ok(!/localizada/i.test(r.summary || r.message || ''),
      `"${ext}" foi descrito como doença localizada`);
  }
});

test('§82.3 o motor não afirma categoria de risco que não foi informada', () => {
  const prostata = TUMORS.list().find((t) => t.id === 'prostata');
  const r = prostata.classify(TUMORS.normalizar({
    tipo_tumor: 'Próstata', extensao_doenca: 'Localizado',
    categoria_risco_localizado: '',
    gleason_grade_group: 'Gleason 5+4=9 (Grade Group 5)', psa: '40',
  }));
  assert.ok(!/risco baixo/i.test(r.summary || ''),
    `afirmou risco não informado: "${r.summary}"`);
  assert.ok((r.notes || []).some((n) => /risco/i.test(n.title || '')),
    'não avisou que a categoria de risco está em branco');
});

test('§82.3b o motor não inverte a categoria de risco que o médico informou', () => {
  const prostata = TUMORS.list().find((t) => t.id === 'prostata');
  const r = prostata.classify(TUMORS.normalizar({
    tipo_tumor: 'Próstata', extensao_doenca: 'Localizado',
    categoria_risco_localizado: 'Intermediário desfavorável',
    gleason_grade_group: 'Gleason 4+3=7 (Grade Group 3)', psa: '12',
  }));
  const texto = r.summary || r.message || '';
  assert.ok(!/intermediário favorável/i.test(texto),
    `imprimiu o oposto do informado: "${texto}"`);
  assert.ok(/desfavorável/i.test(texto),
    `não repetiu a categoria informada: "${texto}"`);
});

test('§82.4 histologia de ovário em inglês não vira "não epitelial"', () => {
  const ovario = TUMORS.list().find((t) => t.id === 'ovario');
  const equivalentes = [
    'High-grade serous carcinoma', 'HGSC', 'Serous carcinoma, high grade',
    'Clear cell carcinoma', 'Endometrioid carcinoma', 'Mucinous carcinoma',
  ];
  for (const h of equivalentes) {
    const r = ovario.classify(TUMORS.normalizar({
      tipo_tumor: 'Ginecológico - Ovário', histologia: h, estadiamento: 'IIIC',
    }));
    assert.notStrictEqual(r.state, 'nao-reconhecida',
      `"${h}" foi tratado como histologia não epitelial`);
    const ids = (r.tests || []).map((t) => t.id);
    assert.ok(ids.includes('germinativo-brca'),
      `"${h}" perdeu a indicação germinativa universal — testes: ${ids.join(', ') || 'nenhum'}`);
  }
});

test('§82.4b as exclusões de ovário continuam valendo em inglês', () => {
  /* Reconhecer inglês não pode abrir a porta que a revisão clínica fechou:
   * borderline segue fora da regra universal, e não epitelial segue
   * encaminhado à oncogenética em vez de calar. */
  const ovario = TUMORS.list().find((t) => t.id === 'ovario');
  const borderline = ovario.classify(TUMORS.normalizar({
    tipo_tumor: 'Ginecológico - Ovário', histologia: 'Borderline serous tumor', estadiamento: 'IIIC',
  }));
  assert.strictEqual(borderline.state, 'sem-indicacao',
    'borderline em inglês passou a receber a indicação universal');
  const granulosa = ovario.classify(TUMORS.normalizar({
    tipo_tumor: 'Ginecológico - Ovário', histologia: 'Granulosa cell tumor', estadiamento: 'IIIC',
  }));
  assert.strictEqual(granulosa.state, 'nao-reconhecida',
    'tumor de cordões sexuais deixou de ser encaminhado à oncogenética');
});

/* ====================================================================
 * §38.4 a §38.9 — as seis decisões de curadoria, decididas pelo dono em
 * 20/10/2026 e registradas em docs/ARQUITETURA.md antes de virarem código.
 * ==================================================================== */

const ov = () => TUMORS.list().find((t) => t.id === 'ovario');
const ma = () => TUMORS.list().find((t) => t.id === 'mama');
const cr = () => TUMORS.list().find((t) => t.id === 'colorretal');
const en = () => TUMORS.list().find((t) => t.id === 'endometrio');
const pu = () => TUMORS.list().find((t) => t.id === 'pulmao');
const temNota = (r, re) => (r.notes || []).some((n) => re.test(`${n.title || ''} ${n.body || ''}`));

test('§38.4 a divergência etária de mama aparece na faixa em que ela existe', () => {
  const base = {
    tipo_tumor: 'Mama', subtipo_molecular: 'Luminal (RH+/HER2-)',
    extensao_doenca: 'Inicial (operável)',
  };
  // Dentro da faixa: NCCN não indica, ASCO-SSO indicaria. A nota existe.
  for (const idade of ['51', '58', '65']) {
    const r = ma().classify(TUMORS.normalizar({ ...base, idade }));
    assert.strictEqual(r.state, 'sem-indicacao', `aos ${idade} o gatilho do NCCN mudou`);
    assert.ok(temNota(r, /ASCO-SSO/), `aos ${idade} a divergência ficou silenciosa`);
  }
  // Fora da faixa as duas diretrizes concordam, e a nota viraria ruído.
  const velho = ma().classify(TUMORS.normalizar({ ...base, idade: '70' }));
  assert.ok(!temNota(velho, /ASCO-SSO/), 'aos 70 anos a nota aparece sem haver divergência');
  // Abaixo de 50 ambas indicam, e o caso nem chega ao ramo sem indicação.
  const jovem = ma().classify(TUMORS.normalizar({ ...base, idade: '48' }));
  assert.notStrictEqual(jovem.state, 'sem-indicacao');
});

test('§38.5 ascendência Ashkenazi é critério suficiente em mama', () => {
  const r = ma().classify(TUMORS.normalizar({
    tipo_tumor: 'Mama', subtipo_molecular: 'Luminal (RH+/HER2-)',
    extensao_doenca: 'Inicial (operável)', idade: '60',
    ascendencia_ashkenazi: 'Sim',
  }));
  assert.strictEqual(r.state, 'completo', 'ascendência Ashkenazi não acionou o germinativo');
  assert.match(r.summary, /Ashkenazi/, 'o critério atendido não nomeia a ascendência');
  // E não pode disparar sozinha quando negada.
  const negado = ma().classify(TUMORS.normalizar({
    tipo_tumor: 'Mama', subtipo_molecular: 'Luminal (RH+/HER2-)',
    extensao_doenca: 'Inicial (operável)', idade: '60',
    ascendencia_ashkenazi: 'Não relatado',
  }));
  assert.strictEqual(negado.state, 'sem-indicacao');
});

test('§38.6 HER2 vira nota em endométrio avançado, e não vira teste', () => {
  const avancado = en().classify(TUMORS.normalizar({
    tipo_tumor: 'Ginecológico - Endométrio', histologia: 'Seroso',
    estadiamento: 'IVB', mmr_msi: 'pMMR / MSS', idade: '68',
  }));
  assert.ok(temNota(avancado, /HER2/), 'seroso avançado não recebeu a nota de HER2');
  assert.ok(temNota(avancado, /imuno-histoquímica/i), 'a nota não diz que é imuno-histoquímica');
  assert.ok(!(avancado.tests || []).some((t) => /HER2/.test(t.name)),
    'HER2 virou card de teste — alarga o escopo do produto para fora do teste genético');
  // Especificidade: não aparece onde a diretriz não pede.
  const inicial = en().classify(TUMORS.normalizar({
    tipo_tumor: 'Ginecológico - Endométrio', histologia: 'Seroso',
    estadiamento: 'IA', mmr_msi: 'pMMR / MSS', idade: '68',
  }));
  assert.ok(!temNota(inicial, /HER2/), 'nota de HER2 em doença inicial');
  const endometrioide = en().classify(TUMORS.normalizar({
    tipo_tumor: 'Ginecológico - Endométrio', histologia: 'Endometrioide',
    estadiamento: 'IVB', mmr_msi: 'pMMR / MSS', idade: '68',
  }));
  assert.ok(!temNota(endometrioide, /HER2/), 'nota de HER2 em histologia endometrioide');
});

test('§38.7 PD-L1 é nomeado no pulmão metastático', () => {
  const r = pu().classify(TUMORS.normalizar({
    tipo_tumor: 'Pulmão - não pequenas células', histologia: 'Adenocarcinoma',
    extensao_doenca: 'Metastático', painel_previo: 'Não realizado',
  }));
  assert.ok(temNota(r, /PD-L1/), 'o card lista nove genes e PD-L1 continua sem aparecer');
  assert.ok(temNota(r, /imuno-histoquímica|não entra no painel/i),
    'a nota não diz que PD-L1 não sai no painel de sequenciamento');
});

test('§38.8a colorretal dMMR precoce emite UM painel germinativo, não dois', () => {
  const r = cr().classify(TUMORS.normalizar({
    tipo_tumor: 'Colorretal', mmr_msi: 'dMMR / MSI-alto',
    idade: '42', extensao_doenca: 'Metastático',
  }));
  const germinativos = (r.tests || []).filter((t) => t.kind === 'germinativo');
  assert.strictEqual(germinativos.length, 1,
    `${germinativos.length} painéis germinativos sobrepostos: ${germinativos.map((t) => t.id).join(', ')}`);
  // E o painel de Lynch continua existindo onde ele é o único indicado.
  const semPrecoce = cr().classify(TUMORS.normalizar({
    tipo_tumor: 'Colorretal', mmr_msi: 'dMMR / MSI-alto',
    idade: '65', extensao_doenca: 'Localizado / ressecado',
  }));
  assert.ok((semPrecoce.tests || []).some((t) => t.id === 'germinativo-lynch'),
    'o painel de Lynch sumiu do caso em que ele é o único indicado');
});

test('§38.8b a metilação de MLH1 é emitida como pedido, não só como texto', () => {
  const r = cr().classify(TUMORS.normalizar({
    tipo_tumor: 'Colorretal', mmr_msi: 'dMMR / MSI-alto',
    idade: '42', extensao_doenca: 'Metastático',
  }));
  const metilacao = (r.tests || []).find((t) => t.id === 'metilacao-mlh1');
  assert.ok(metilacao, 'a nota manda fazer a metilação antes, e ela não é emitida como teste');
  assert.ok(metilacao.sample, 'a metilação foi emitida sem amostra');
  assert.ok(metilacao.justify, 'a metilação foi emitida sem justificativa para o documento');
});

test('§38.8c o prioritário não é o teste que a nota manda adiar', () => {
  for (const idade of ['42', '65']) {
    const r = cr().classify(TUMORS.normalizar({
      tipo_tumor: 'Colorretal', mmr_msi: 'dMMR / MSI-alto',
      idade, extensao_doenca: 'Metastático',
    }));
    const prioritarios = (r.tests || []).filter((t) => t.primary);
    assert.strictEqual(prioritarios.length, 1, `${prioritarios.length} prioritários aos ${idade}`);
    assert.strictEqual(prioritarios[0].kind, 'somatico',
      `aos ${idade} o prioritário é "${prioritarios[0].id}" — germinativo, que a nota manda adiar`);
  }
});

test('§38.9 o grau vem da histologia quando ela nomeia a entidade', () => {
  for (const h of ['Carcinoma seroso de alto grau', 'High-grade serous carcinoma', 'HGSC']) {
    const r = ov().classify(TUMORS.normalizar({
      tipo_tumor: 'Ginecológico - Ovário', histologia: h, grau: '', estadiamento: 'IIIC',
    }));
    assert.strictEqual(r.state, 'completo', `"${h}" não resolveu o grau`);
    assert.ok(temNota(r, /histologia/i), `"${h}" inferiu o grau sem marcar a origem`);
    const hrd = (r.tests || []).find((t) => t.id === 'hrd');
    assert.ok(/conforme a histologia informada/.test(hrd.justify),
      `o documento assinado não diz de onde veio o grau: "${hrd.justify.slice(0, 90)}"`);
    assert.ok(!/a confirmar/.test(hrd.justify),
      `o documento afirma e desmente na mesma frase: "${hrd.justify.slice(0, 90)}"`);
  }
});

test('§38.9 trava 1 — modalizador cancela a inferência', () => {
  for (const h of ['Carcinoma seroso, provavelmente de alto grau',
    'Carcinoma seroso, favorece alto grau',
    'Carcinoma seroso de alto grau?',
    'Carcinoma seroso, sugestivo de alto grau']) {
    const r = ov().classify(TUMORS.normalizar({
      tipo_tumor: 'Ginecológico - Ovário', histologia: h, grau: '', estadiamento: 'IIIC',
    }));
    assert.strictEqual(r.state, 'provisorio',
      `"${h}" foi lido como grau confirmado — é inferência de laudo, não leitura de entidade`);
  }
});

test('§38.9 a regra vizinha continua valendo: grau nunca vem do estágio', () => {
  const r = ov().classify(TUMORS.normalizar({
    tipo_tumor: 'Ginecológico - Ovário', histologia: 'Seroso', grau: '', estadiamento: 'IIIC',
  }));
  assert.strictEqual(r.state, 'provisorio',
    'estágio avançado passou a implicar alto grau — eixos independentes');
});

/* §91 e §92. Amostra do germinativo e laboratórios depois da Life Genomics. */
function germinativosDeTodos() {
  const casos = {
    ovario: { histologia: 'Seroso', grau: 'Alto grau', estadiamento: 'IIIC' },
    mama: { subtipo_molecular: 'Triplo-negativo', idade: '40', sexo: 'Feminino' },
    prostata: { extensao_doenca: 'Metastático' },
    pancreas: { histologia: 'Adenocarcinoma' },
    endometrio: { histologia: 'Endometrioide', estadiamento: 'IA', mmr_msi: 'dMMR / MSI-alto' },
    colorretal: { idade: '42', historico_familiar: 'pai com câncer colorretal aos 48 anos' },
  };
  const saida = [];
  for (const [id, valores] of Object.entries(casos)) {
    const { resultado } = triar(id, valores);
    (resultado.tests || []).filter((t) => t.kind === 'germinativo').forEach((t) => saida.push({ id, teste: t }));
  }
  return saida;
}

test('todo teste germinativo aceita sangue ou saliva (§91)', () => {
  const lista = germinativosDeTodos();
  assert.ok(lista.length >= 5, `só ${lista.length} teste(s) germinativo(s) nos casos, o teste não mediria nada`);
  lista.forEach(({ id, teste }) => {
    assert.strictEqual(teste.sample, 'Sangue periférico ou saliva (swab bucal)', `${id}/${teste.id}: amostra "${teste.sample}"`);
  });
});

test('Fleury e Dasa vêm depois da Life Genomics, e só onde foram verificados (§92)', () => {
  // Endométrio por declaração do dono em 20/10/2026 (§92.1), não por página.
  const COBERTURA_DASA = ['ovario', 'mama', 'colorretal', 'pancreas', 'prostata', 'endometrio'];
  const COBERTURA_FLEURY = ['ovario', 'prostata', 'mama', 'pancreas', 'colorretal', 'endometrio'];
  germinativosDeTodos().forEach(({ id, teste }) => {
    const nomes = TUMORS.ordenarProgramas(teste.programs).map((p) => p.name);
    const esperado = ['Life Genomics',
      ...(COBERTURA_FLEURY.includes(id) ? ['Fleury Genômica'] : []),
      ...(COBERTURA_DASA.includes(id) ? ['Dasa Genômica'] : [])];
    assert.deepStrictEqual(nomes.filter((n) => esperado.includes(n) || /Genômica|Genomics/.test(n)), esperado,
      `${id}/${teste.id}: ordem ${nomes.join(' > ')}`);
  });
  // A cobertura da Dasa é exatamente a registrada: nenhum tumor a mais
  // entra por analogia sem passar pelo §92.1.
  const dasa = germinativosDeTodos().flatMap(({ teste }) => teste.programs).find((p) => p.name === 'Dasa Genômica');
  assert.deepStrictEqual([...dasa.cobertura].sort(), [...COBERTURA_DASA].sort(), 'cobertura da Dasa mudou sem registro no §92.1');
  // Laboratório não aparece em teste somático.
  const { resultado: ov } = triar('ovario', { histologia: 'Seroso', grau: 'Alto grau', estadiamento: 'IIIC' });
  const hrd = ov.tests.find((t) => t.id === 'hrd');
  assert.ok(!(hrd.programs || []).some((p) => /Fleury|Dasa/.test(p.name)), 'laboratório germinativo no HRD somático');
});
