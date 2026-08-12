'use strict';

// Gera o documento de critérios clínicos A PARTIR DO CÓDIGO QUE RODA.
//
//   node test/gerar-criterios.js > /tmp/criterios.json
//
// Existe porque um documento clínico escrito à mão diverge do motor na
// primeira mudança, e ninguém percebe — o oncologista valida um texto, o
// paciente recebe outro comportamento. Aqui cada linha do documento é o
// resultado de EXECUTAR a regra: o que o advisor lê é, por construção,
// exatamente o que o app faz.

const TUMORS = require('../public/tumors.js');

function rodar(tumorId, valores) {
  const tumor = TUMORS.get(tumorId);
  const v = {};
  tumor.fields.forEach((f) => { v[f.key] = ''; });
  Object.assign(v, valores);
  const r = tumor.classify(v);
  return {
    entrada: valores,
    estado: r.state,
    titulo: r.title || null,
    resumo: r.summary || r.message || null,
    testes: (r.tests || []).map((t) => ({
      nome: t.name,
      amostra: t.sample,
      justificativa: t.justify,
      descricao: t.description,
      numero: t.stat || null,
      programas: (t.programs || []).map((p) => ({
        nome: p.name, nota: p.note, url: p.url, verificadoEm: p.verificadoEm || null,
      })),
    })),
    notas: (r.notes || []).map((n) => ({ tag: n.tag, titulo: n.title, corpo: n.body })),
    diagnostico: tumor.diagnosis(v),
  };
}

/* Cada cenário é um ramo da regra. A descrição é o que o advisor lê; o
 * resultado é o que o motor produz. Se os dois discordarem, o defeito está
 * visível no próprio documento. */
const MAPA = [
  {
    id: 'ovario',
    fontes: 'NCCN Ovarian Cancer e Genetic/Familial High-Risk Assessment (v2.2026); SGO; ESMO-ESGO.',
    eixo: 'Histologia define se há teste somático. Grau e estadiamento (FIGO) definem se ele se aplica agora. O teste germinativo é universal no carcinoma epitelial.',
    cenarios: [
      { rotulo: 'Seroso de alto grau, FIGO IIIC', valores: { histologia: 'Seroso', grau: 'Alto grau', estadiamento: 'IIIC', idade: '58' } },
      { rotulo: 'Endometrioide de alto grau, FIGO IV', valores: { histologia: 'Endometrioide', grau: 'Alto grau', estadiamento: 'IV' } },
      { rotulo: 'Seroso de alto grau, FIGO IA (doença inicial)', valores: { histologia: 'Seroso', grau: 'Alto grau', estadiamento: 'IA' } },
      { rotulo: 'Seroso de BAIXO grau, FIGO IIIC', valores: { histologia: 'Seroso', grau: 'Baixo grau', estadiamento: 'IIIC' } },
      { rotulo: 'Mucinoso, FIGO IA', valores: { histologia: 'Mucinoso', estadiamento: 'IA' } },
      { rotulo: 'Células claras, FIGO IIIC', valores: { histologia: 'Células claras', grau: 'Alto grau', estadiamento: 'IIIC' } },
      { rotulo: 'Tumor borderline (baixo potencial de malignidade)', valores: { histologia: 'Tumor borderline seroso', estadiamento: 'IA' } },
      { rotulo: 'Histologia não epitelial (células da granulosa)', valores: { histologia: 'Tumor de células da granulosa' } },
      { rotulo: 'Seroso, grau e estágio NÃO informados', valores: { histologia: 'Seroso' } },
      { rotulo: 'Sem histologia', valores: { estadiamento: 'IIIC', grau: 'Alto grau' } },
    ],
  },
  {
    id: 'mama',
    fontes: 'NCCN Genetic/Familial High-Risk Assessment (v2.2026); ASCO-SSO Germline Testing in Patients With Breast Cancer (JCO 2024).',
    eixo: 'Sexo, idade ao diagnóstico, subtipo por imuno-histoquímica e extensão da doença. Qualquer um dos critérios basta para o germinativo.',
    cenarios: [
      { rotulo: 'Homem, qualquer idade e subtipo', valores: { histologia: 'CDI', sexo: 'Masculino', subtipo_molecular: 'Luminal (RH+/HER2-)', extensao_doenca: 'Inicial (operável)', idade: '61' } },
      { rotulo: 'Mulher, 45 anos (≤50)', valores: { histologia: 'CDI', sexo: 'Feminino', subtipo_molecular: 'Luminal (RH+/HER2-)', extensao_doenca: 'Inicial (operável)', idade: '45' } },
      { rotulo: 'Triplo-negativo, 68 anos', valores: { histologia: 'CDI', sexo: 'Feminino', subtipo_molecular: 'Triplo-negativo', extensao_doenca: 'Inicial (operável)', idade: '68' } },
      { rotulo: 'Luminal metastático, 68 anos', valores: { histologia: 'CDI', sexo: 'Feminino', subtipo_molecular: 'Luminal (RH+/HER2-)', extensao_doenca: 'Metastático', idade: '68' } },
      { rotulo: 'Luminal inicial, 68 anos, com histórico familiar', valores: { histologia: 'CDI', sexo: 'Feminino', subtipo_molecular: 'Luminal (RH+/HER2-)', extensao_doenca: 'Inicial (operável)', idade: '68', historico_familiar: 'Mãe com câncer de mama aos 48' } },
      { rotulo: 'Luminal inicial, 68 anos, SEM nenhum critério', valores: { histologia: 'CDI', sexo: 'Feminino', subtipo_molecular: 'Luminal (RH+/HER2-)', extensao_doenca: 'Inicial (operável)', idade: '68' } },
    ],
  },
  {
    id: 'prostata',
    fontes: 'NCCN Prostate Cancer e Genetic/Familial High-Risk Assessment (v2.2026); AUA/SUO; EAU.',
    eixo: 'Extensão da doença define o teste somático (HRR). Categoria de risco, histologia, ascendência e histórico familiar definem o germinativo em doença localizada.',
    cenarios: [
      { rotulo: 'Metastático resistente à castração (mCRPC)', valores: { histologia: 'Adenocarcinoma acinar', extensao_doenca: 'Metastático resistente à castração (mCRPC)', psa: '225', gleason_grade_group: 'Gleason 4+5=9' } },
      { rotulo: 'Metastático hormônio-sensível (mHSPC)', valores: { extensao_doenca: 'Metastático hormônio-sensível (mHSPC)' } },
      { rotulo: 'Linfonodo positivo (N1)', valores: { extensao_doenca: 'Linfonodo positivo (N1)' } },
      { rotulo: 'Localizado, risco alto', valores: { extensao_doenca: 'Localizado', categoria_risco_localizado: 'Alto' } },
      { rotulo: 'Localizado, risco muito alto', valores: { extensao_doenca: 'Localizado', categoria_risco_localizado: 'Muito alto' } },
      { rotulo: 'Localizado, risco intermediário favorável, histologia intraductal', valores: { histologia: 'Carcinoma intraductal', extensao_doenca: 'Localizado', categoria_risco_localizado: 'Intermediário favorável' } },
      { rotulo: 'Localizado, risco baixo, ascendência Ashkenazi', valores: { extensao_doenca: 'Localizado', categoria_risco_localizado: 'Baixo', ascendencia_ashkenazi: 'Sim' } },
      { rotulo: 'Localizado, risco baixo, com histórico familiar', valores: { extensao_doenca: 'Localizado', categoria_risco_localizado: 'Baixo', historico_familiar: 'Pai com câncer de próstata aos 60' } },
      { rotulo: 'Localizado, risco intermediário favorável, SEM nenhum critério', valores: { extensao_doenca: 'Localizado', categoria_risco_localizado: 'Intermediário favorável' } },
    ],
  },
  {
    id: 'colorretal',
    fontes: 'NCCN Colon/Rectal Cancer e Genetic/Familial High-Risk Assessment: Colorectal (v2.2026).',
    eixo: 'MMR/MSI é universal ao diagnóstico. Idade abaixo de 50 indica painel multigênico por si. dMMR exige confirmação germinativa. Doença metastática acrescenta perfil somático.',
    cenarios: [
      { rotulo: 'Qualquer colorretal, MMR ainda não avaliado', valores: { histologia: 'Adenocarcinoma', extensao_doenca: 'Localizado / ressecado', mmr_msi: 'Não realizado', idade: '62' } },
      { rotulo: 'Diagnóstico aos 44 anos (abaixo de 50), pMMR', valores: { histologia: 'Adenocarcinoma', extensao_doenca: 'Localizado / ressecado', mmr_msi: 'pMMR / MSS', idade: '44' } },
      { rotulo: 'Diagnóstico aos 49 anos (limite)', valores: { histologia: 'Adenocarcinoma', extensao_doenca: 'Localizado / ressecado', mmr_msi: 'pMMR / MSS', idade: '49' } },
      { rotulo: 'Diagnóstico aos 50 anos (fora do limite), pMMR', valores: { histologia: 'Adenocarcinoma', extensao_doenca: 'Localizado / ressecado', mmr_msi: 'pMMR / MSS', idade: '50' } },
      { rotulo: 'dMMR / MSI-alto, doença localizada', valores: { histologia: 'Adenocarcinoma', extensao_doenca: 'Localizado / ressecado', mmr_msi: 'dMMR / MSI-alto', idade: '62' } },
      { rotulo: 'Metastático, dMMR, 44 anos', valores: { histologia: 'Adenocarcinoma', extensao_doenca: 'Metastático', mmr_msi: 'dMMR / MSI-alto', idade: '44' } },
    ],
  },
  {
    id: 'pulmao',
    fontes: 'NCCN Non-Small Cell Lung Cancer (v2.2026). Terapia adjuvante dirigida: ADAURA (osimertinibe) e ALINA (alectinibe).',
    eixo: 'Extensão da doença. Doença ressecável exige EGFR/ALK/PD-L1 pela janela adjuvante; doença avançada exige painel molecular amplo antes da primeira linha.',
    cenarios: [
      { rotulo: 'Adenocarcinoma ressecável, perfil não realizado', valores: { histologia: 'Adenocarcinoma', extensao_doenca: 'Inicial (ressecável)', painel_previo: 'Não realizado' } },
      { rotulo: 'Adenocarcinoma ressecável, perfil JÁ realizado', valores: { histologia: 'Adenocarcinoma', extensao_doenca: 'Inicial (ressecável)', painel_previo: 'Já realizado' } },
      { rotulo: 'Adenocarcinoma metastático, perfil não realizado', valores: { histologia: 'Adenocarcinoma', extensao_doenca: 'Metastático', painel_previo: 'Não realizado' } },
      { rotulo: 'Escamoso localmente avançado', valores: { histologia: 'Carcinoma escamoso', extensao_doenca: 'Localmente avançado', painel_previo: 'Não realizado' } },
      { rotulo: 'Metastático, painel JÁ realizado', valores: { histologia: 'Adenocarcinoma', extensao_doenca: 'Metastático', painel_previo: 'Já realizado' } },
      { rotulo: 'Carcinoma de PEQUENAS células', valores: { histologia: 'Pequenas células', extensao_doenca: 'Metastático' } },
    ],
  },
  {
    id: 'pancreas',
    fontes: 'NCCN Pancreatic Adenocarcinoma e Genetic/Familial High-Risk Assessment (v2.2026).',
    eixo: 'Indicação germinativa universal em adenocarcinoma ductal, independente de idade, estágio ou histórico familiar. Doença metastática acrescenta perfil somático.',
    cenarios: [
      { rotulo: 'Adenocarcinoma ductal ressecável', valores: { histologia: 'Adenocarcinoma ductal', extensao_doenca: 'Ressecável', idade: '55' } },
      { rotulo: 'Adenocarcinoma ductal borderline / localmente avançado', valores: { histologia: 'Adenocarcinoma ductal', extensao_doenca: 'Borderline / localmente avançado' } },
      { rotulo: 'Adenocarcinoma ductal metastático', valores: { histologia: 'Adenocarcinoma ductal', extensao_doenca: 'Metastático' } },
      { rotulo: 'Metastático, em uso de platina com resposta', valores: { histologia: 'Adenocarcinoma ductal', extensao_doenca: 'Metastático', platina: 'Em uso / respondendo a platina' } },
      { rotulo: 'Tumor NEUROENDÓCRINO de pâncreas', valores: { histologia: 'Tumor neuroendócrino', extensao_doenca: 'Metastático' } },
    ],
  },
  {
    id: 'endometrio',
    fontes: 'NCCN Uterine Neoplasms (v2.2026); ESGO/ESTRO/ESP Guidelines for Endometrial Carcinoma (2025).',
    eixo: 'Classificação molecular em quatro grupos (POLEmut, MMRd, p53abn, NSMP) para todo carcinoma de endométrio. MMR sozinho não fecha a classificação.',
    cenarios: [
      { rotulo: 'Endometrioide IA, MMR não avaliado', valores: { histologia: 'Endometrioide', estadiamento: 'IA', mmr_msi: 'Não realizado', idade: '60' } },
      { rotulo: 'Endometrioide IA, pMMR / MSS', valores: { histologia: 'Endometrioide', estadiamento: 'IA', mmr_msi: 'pMMR / MSS', idade: '60' } },
      { rotulo: 'Endometrioide IIIC, dMMR / MSI-alto', valores: { histologia: 'Endometrioide', estadiamento: 'IIIC', mmr_msi: 'dMMR / MSI-alto', idade: '60' } },
      { rotulo: 'Seroso uterino IIIC, MMR não avaliado', valores: { histologia: 'Seroso', estadiamento: 'IIIC', mmr_msi: 'Não realizado' } },
      { rotulo: 'MMR em branco (dado ausente)', valores: { histologia: 'Endometrioide', estadiamento: 'IA', idade: '60' } },
    ],
  },
];

const DIVERGENCIAS = [
  {
    tumor: 'Mama',
    questao: 'Corte de idade para o teste germinativo: 50 anos (NCCN) ou 65 anos (ASCO-SSO)?',
    hoje: 'O motor usa 50 anos.',
    contexto: 'A ASCO-SSO (JCO 2024) recomenda oferecer teste germinativo a todo paciente com câncer de mama diagnosticado aos 65 anos ou menos — critério mais largo que o do NCCN. O motor segue o NCCN por ser o mais usado na prática brasileira. Trocar é mudar um número; a decisão é clínica.',
  },
  {
    tumor: 'Ovário',
    questao: 'Teste somático (HRD) restrito a seroso e endometrioide de alto grau?',
    hoje: 'Sim — outras histologias epiteliais recebem apenas o germinativo.',
    contexto: 'É o critério que define elegibilidade a manutenção com inibidor de PARP e coincide com o do programa de teste patrocinado. Confirmar se deve ser ampliado.',
  },
  {
    tumor: 'Ovário',
    questao: 'Tumor borderline fica fora da triagem?',
    hoje: 'Sim — devolve "fora do critério" com orientação de reavaliar se houver componente invasivo ou história familiar própria.',
    contexto: 'Tumor de baixo potencial de malignidade não é carcinoma invasivo e não faz parte do espectro BRCA-associado que sustenta a indicação universal.',
  },
  {
    tumor: 'Endométrio',
    questao: 'A versão do estadiamento FIGO é a de 2023 (com sufixo molecular) ou a de 2014?',
    hoje: 'O motor aceita as duas grafias, mas não usa o sufixo molecular na decisão.',
    contexto: 'A FIGO 2023 incorporou o grupo molecular ao próprio estádio (ex.: IAmPOLEmut). Confirmar se a triagem deve considerar isso.',
  },
  {
    tumor: 'Colorretal',
    questao: 'Painel multigênico abaixo de 50 anos: o limite é estrito (<50) ou inclui os 50?',
    hoje: 'Estrito: 49 anos indica, 50 anos não.',
    contexto: 'NCCN indica painel multigênico para diagnóstico abaixo dos 50 anos, independentemente de MMR e história familiar.',
  },
  {
    tumor: 'Próstata',
    questao: 'Categoria de risco que dispara o germinativo em doença localizada.',
    hoje: 'Risco alto e muito alto. Intermediário desfavorável NÃO dispara.',
    contexto: 'Confirmar se o intermediário desfavorável deve entrar.',
  },
];

const documento = {
  geradoEm: new Date().toISOString().slice(0, 10),
  tumores: MAPA.map((t) => {
    const tumor = TUMORS.get(t.id);
    return {
      id: t.id,
      label: tumor.label,
      fontes: t.fontes,
      eixo: t.eixo,
      campos: TUMORS.fieldsOf(tumor).filter((f) => !f.internal).map((f) => ({
        rotulo: f.label,
        decisivo: Boolean(f.decisivo),
        opcoes: f.options || null,
      })),
      cenarios: t.cenarios.map((c) => ({ rotulo: c.rotulo, ...rodar(t.id, c.valores) })),
    };
  }),
  divergencias: DIVERGENCIAS,
};

process.stdout.write(JSON.stringify(documento, null, 2));
