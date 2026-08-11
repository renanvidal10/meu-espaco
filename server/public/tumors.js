/**
 * Registro de tumores do OncoGenYX — fonte única de verdade.
 *
 * Este arquivo é carregado nos dois lados:
 *   - servidor: require('./public/tumors')  -> monta o schema de extração
 *   - navegador: <script src="/tumors.js">  -> renderiza campos, regras e telas
 *
 * Manter em um único arquivo evita a divergência clássica de ter a lista de
 * campos no backend e a regra clínica no frontend saindo de sincronia.
 *
 * PROCESSO OBRIGATÓRIO: nenhuma regra entra aqui sem estar documentada em
 * docs/ARQUITETURA.md com a diretriz e o critério exato que a aciona.
 * Diretriz primeiro, código depois.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.TUMORS = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /* ------------------------------------------------------------------ *
   * Helpers de leitura de campo — o médico escreve livre, o motor
   * precisa comparar. Tudo normalizado em minúsculas, sem acento.
   * ------------------------------------------------------------------ */
  function norm(value) {
    return String(value || '')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .trim();
  }
  function has(value, ...terms) {
    const v = norm(value);
    return terms.some((t) => v.includes(norm(t)));
  }
  function filled(value) {
    const v = norm(value);
    return v !== '' && v !== '-' && v !== 'nao relatado' && v !== 'nenhum relatado';
  }
  // Minúsculas preservando acento: norm() serve para COMPARAR, e por tirar
  // acento não pode ser usada em texto que vai impresso ("metastatico").
  function lower(value) {
    return String(value || '').toLowerCase();
  }
  /* ------------------------------------------------------------------ *
   * Normalizadores clínicos.
   *
   * O campo da revisão é editável: o médico corrige à mão e escreve do jeito
   * dele. "4", "IV", "Estágio IV", "EC 4" são o mesmo estádio; "G3", "grau 3"
   * e "pouco diferenciado" são o mesmo grau. A regra tem que entender todos -
   * senão o motor devolve "sem indicação" para um caso que tem indicação, que
   * é o pior erro possível aqui.
   * ------------------------------------------------------------------ */
  const ROMANOS = { i: 1, ii: 2, iii: 3, iv: 4 };

  // Estádio em token: romano ou arábico, com subletra, com sub-subdivisão
  // numérica (IIIA1, IIIC2, IC3) e com o sufixo molecular do FIGO 2023 de
  // endométrio (IAmPOLEmut, IICmp53abn).
  const TOKEN_ROMANO = /^(iv|iii|ii|i)([abc]\d?)?(m[a-z0-9]*)?$/;
  const TOKEN_ARABICO = /^([1-4])([abc]\d?)?(m[a-z0-9]*)?$/;

  /**
   * Número do estádio (1 a 4), ou null.
   *
   * Lê TOKEN A TOKEN, e devolve o primeiro que tem forma de estádio. Ler token
   * a token é o que evita o erro que existiu aqui: uma busca por \bi\b em
   * "IIIA1(i)" encontrava o "i" entre parênteses e devolvia estádio 1 para uma
   * doença estádio III — falso negativo em cima do critério do teste tumoral.
   */
  function estadioNumero(value) {
    const limpo = norm(value)
      .replace(/\b(estadio|estadiamento|estagio|figo|ec|stage|clinico|patologico|p|c)\b/g, ' ')
      .trim();
    if (!limpo) return null;

    const tokens = limpo.split(/[^a-z0-9]+/).filter(Boolean);
    for (const token of tokens) {
      const romano = token.match(TOKEN_ROMANO);
      if (romano) return ROMANOS[romano[1]];
      const arabico = token.match(TOKEN_ARABICO);
      if (arabico) return parseInt(arabico[1], 10);
    }
    return null;
  }

  // Estádio preenchido mas em notação que não sabemos ler. Diferente de vazio:
  // aqui existe informação, só não conseguimos interpretá-la — e o texto do
  // resultado não pode dizer "não informado".
  function estadioIlegivel(value) {
    return filled(value) && estadioNumero(value) === null;
  }

  function estadioAvancado(value) {
    const n = estadioNumero(value);
    return n !== null && n >= 3;
  }
  function estadioInicial(value) {
    const n = estadioNumero(value);
    return n !== null && n <= 2;
  }

  // Grau alto/baixo tolerando escala numérica, ISUP e descrição verbal.
  function grauAlto(value) {
    if (!filled(value)) return false;
    if (has(value, 'alto', 'high grade')) return true;
    if (has(value, 'pouco diferenciado', 'indiferenciado')) return true;
    return /\b(g\s*[23]|grau\s*[23])\b/.test(norm(value));
  }
  function grauBaixo(value) {
    if (!filled(value)) return false;
    if (has(value, 'baixo', 'low grade')) return true;
    if (has(value, 'bem diferenciado')) return true;
    return /\b(g\s*1|grau\s*1)\b/.test(norm(value));
  }

  // Número tolerante a vírgula decimal e a unidade colada ("18,4 ng/mL").
  function num(value) {
    const match = String(value || '').replace(',', '.').match(/-?\d+(\.\d+)?/);
    return match ? parseFloat(match[0]) : null;
  }

  /* ------------------------------------------------------------------ *
   * Texto do diagnóstico impresso.
   *
   * Vai dentro de um documento que o médico assina, então não pode sair com
   * espaço duplo, prefixo duplicado ("Carcinoma Carcinoma seroso"), sítio
   * duplicado ("de tuba uterina de ovário"), órgão ausente, nem travessão
   * solto quando a histologia está vazia.
   * ------------------------------------------------------------------ */
  const SITIOS = [
    'ovario', 'tuba uterina', 'tubaria', 'peritonio', 'peritoneal',
    'prostata', 'mama', 'mamario', 'pancreas', 'pancreatico',
    'colon', 'colorretal', 'reto', 'retal', 'sigmoide', 'ceco',
    'endometrio', 'uterino', 'utero', 'pulmao', 'pulmonar', 'bronquio',
  ];
  const PREFIXOS_GENERICOS = /^(adenocarcinoma|carcinoma|tumor|neoplasia|sarcoma)\b\s*/i;

  function limpar(texto) {
    return String(texto == null ? '' : texto).replace(/\s+/g, ' ').trim();
  }

  /**
   * @param histologia  o que o médico escreveu (pode vir com prefixo e sítio)
   * @param orgao       o órgão deste tumor, para completar quando faltar
   * @param padrao      texto usado quando a histologia está vazia
   */
  function montaDx(histologia, orgao, padrao) {
    const bruto = limpar(histologia);
    if (!filled(bruto)) return padrao;

    const casa = bruto.match(PREFIXOS_GENERICOS);
    const prefixo = casa ? limpar(casa[1]) : 'Carcinoma';
    const resto = casa ? limpar(bruto.slice(casa[0].length)) : bruto;
    const cabeca = resto ? `${prefixo} ${resto}` : prefixo;

    // Se a histologia já nomeia um sítio, acrescentar o órgão duplicaria.
    const jaTemSitio = SITIOS.some((sitio) => has(bruto, sitio));
    return jaTemSitio ? cabeca : `${cabeca} de ${orgao}`;
  }

  // Junta as partes do diagnóstico descartando vazio e normalizando espaço.
  function juntarDx(partes) {
    return partes.map(limpar).filter(Boolean).join(', ');
  }

  /* ------------------------------------------------------------------ *
   * Programas de acesso — curadoria manual, nunca gerada por IA.
   * Reaproveitados entre tumores quando o parceiro de fato cobre aquele
   * tumor; nunca por analogia (foi assim que a GSK entrou por engano no
   * card de próstata na v0.6).
   * ------------------------------------------------------------------ */
  /* ------------------------------------------------------------------ *
   * Programas de acesso — curadoria manual, com cobertura declarada.
   *
   * `cobertura` lista os IDs de tumor para os quais o programa foi
   * VERIFICADO. O teste "todo programa exibido cobre aquele tumor" quebra a
   * suíte se um programa aparecer fora da sua cobertura, o que torna
   * impossível repetir por analogia os dois incidentes que já aconteceram:
   *   - GSK entrou no card de próstata (o programa é de ovário);
   *   - "Cuidar Mais - PAF" da Pfizer entrou em próstata e pulmão — PAF é
   *     Polineuropatia Amiloidótica Familiar, amiloidose hereditária, não
   *     oncologia. O link levava o urologista a uma página de neurologia.
   *
   * Sem verificação documentada, o teste usa A_MAPEAR. Card honesto vale
   * mais que card errado.
   * ------------------------------------------------------------------ */
  const PROGRAMA_ID = {
    name: 'ProgramAID (AstraZeneca)',
    note: 'Teste gratuito em tecido tumoral. Se o resultado vier inconclusivo, permite reteste por biópsia líquida sem custo.',
    url: 'https://programaid.com.br/',
    cobertura: ['ovario', 'prostata', 'mama', 'pulmao'],
    verificadoEm: '2026-08-11',
    fonte: 'programaid.com.br/exames — mama, pulmão, ovário, próstata e LLC',
  };
  const PROGRAMA_PFIZER = {
    name: 'Programa de apoio diagnóstico (Pfizer)',
    note: 'Existe apoio diagnóstico ligado à terapia com inibidor de PARP em próstata. Portal oficial a confirmar — consulte o representante antes de encaminhar.',
    url: null,
    cobertura: ['prostata'],
    verificadoEm: '2026-08-11',
    fonte: 'Programa vinculado a talazoparibe + enzalutamida (HRR). URL anterior (/paf-1) removida: era do programa de Polineuropatia Amiloidótica Familiar.',
  };
  const LIFE_GENOMICS = {
    name: 'Life Genomics',
    note: 'Laboratório de oncogenética, não é programa gratuito. Confirmar cobertura e valores.',
    url: 'https://lifegenomics.com.br/',
    cobertura: ['ovario', 'prostata', 'mama', 'pancreas', 'colorretal', 'endometrio', 'pulmao'],
    verificadoEm: '2026-08-11',
    fonte: 'Laboratório comercial brasileiro de oncogenética, cobertura ampla.',
  };
  const A_MAPEAR = {
    name: 'Programa a mapear',
    note: 'Nenhum parceiro verificado ainda para este teste neste tumor.',
    url: null,
    cobertura: null, // null = vale para qualquer tumor
    verificadoEm: null,
  };

  /* ------------------------------------------------------------------ *
   * Campos comuns a todos os tumores.
   * ------------------------------------------------------------------ */
  // Idade em anos, não faixa. A faixa quinquenal existia por pseudonimização,
  // mas idade isolada não identifica ninguém e é critério clínico direto em
  // vários sítios (mama <=50). Pedir faixa obrigava o motor a adivinhar o
  // limite quando a idade estava escrita com todas as letras no material.
  const CAMPO_IDADE = {
    key: 'idade',
    label: 'Idade (anos)',
    placeholder: 'Ex.: 62',
    ai: 'Idade do paciente em anos, apenas o número. Extraia de qualquer forma que apareça ("86 anos", "paciente de 86a", "oitenta e seis anos" -> "86"). Vazio se não informado.',
  };
  const CAMPO_HISTORICO = {
    key: 'historico_familiar',
    label: 'Histórico familiar relatado',
    full: true,
    placeholder: 'Ex.: mãe com câncer de mama aos 58 anos',
    ai: 'Resumo do histórico familiar oncológico relatado. "Não relatado" se explicitamente negado, vazio se não mencionado.',
  };
  const CAMPO_TESTES = {
    key: 'testes_previos',
    label: 'Testes genéticos prévios',
    full: true,
    placeholder: 'Ex.: nenhum teste realizado',
    ai: 'Testes genéticos já realizados e seus resultados, se houver. "Nenhum relatado" se explicitamente negado, vazio se não mencionado.',
  };
  const COMUNS = [CAMPO_IDADE, CAMPO_HISTORICO, CAMPO_TESTES];

  // Reconhece histórico familiar de fato relatado (e não "não relatado").
  function temHistoricoFamiliar(v) {
    return filled(v.historico_familiar);
  }

  /* ================================================================== *
   * OVÁRIO
   * ================================================================== */
  const HISTOLOGIAS_EPITELIAIS = ['seroso', 'endometrioide', 'celulas claras', 'mucinoso', 'carcinossarcoma', 'indiferenciado'];
  const HISTOLOGIAS_HRD = ['seroso', 'endometrioide'];

  const ovario = {
    id: 'ovario',
    label: 'Ginecológico - Ovário',
    short: 'Ovário',
    detect: 'carcinoma de ovário, tuba uterina ou peritônio; menção a estadiamento FIGO, CA-125, histologia serosa/endometrioide/células claras/mucinosa de ovário',
    fields: [
      { key: 'histologia', label: 'Histologia', placeholder: 'Ex.: Seroso', decisivo: true,
        ai: 'Histologia do tumor de ovário (ex.: "Seroso", "Endometrioide", "Células claras", "Mucinoso", "Carcinossarcoma").' },
      { key: 'grau', label: 'Grau (laudo patológico)', placeholder: 'Ex.: Alto grau',
        ai: 'Grau histopatológico: "Alto grau" ou "Baixo grau". "G3"/"grau 3" é alto grau; "G1"/"grau 1" é baixo grau. Nunca deduza a partir do estágio - grau e estágio são eixos independentes.' },
      { key: 'estadiamento', label: 'Estadiamento (FIGO)', placeholder: 'Ex.: IIIC',
        justify: 'estadiamento_justificativa',
        ai: 'Estágio FIGO no formato canônico romano (I-IV + subletra A/B/C). Normalize "3C" para "IIIC". Se não estiver escrito, infira dos achados cirúrgicos/patológicos (lateralidade, integridade da cápsula, linfonodos por sítio, achados peritoneais/omentais) e explique em estadiamento_justificativa.' },
      ...COMUNS,
    ],
    hint: 'Grau e estadiamento são eixos independentes: estágio (FIGO I-IV) mede a extensão da doença; grau é a leitura patológica do tecido. Só a histologia é obrigatória para rodar a triagem.',
    // Só sinaliza grau/estágio como pendentes quando eles realmente mudam o
    // resultado - ou seja, quando a histologia é elegível ao par somático.
    relevance(v) {
      // Sem histologia ainda não se sabe se grau e estágio importam. Dizer
      // "não influencia" nesse momento é informação errada: influencia sim,
      // assim que a histologia for preenchida.
      if (!filled(v.histologia)) return null;
      const elegivel = HISTOLOGIAS_HRD.some((h) => has(v.histologia, h));
      return { grau: elegivel, estadiamento: elegivel };
    },
    classify(v) {
      if (!filled(v.histologia)) {
        return { state: 'insuficiente', message: 'Histologia não identificada. Volte à revisão do caso e complete o campo.' };
      }
      const epitelial = HISTOLOGIAS_EPITELIAIS.find((h) => has(v.histologia, h));
      if (!epitelial) {
        return { state: 'nao-reconhecida', message: `"${v.histologia}" não corresponde a nenhuma histologia epitelial de ovário mapeada nesta versão.` };
      }

      const germinativo = {
        id: 'germinativo-brca', kind: 'germinativo', name: 'Painel germinativo BRCA1/2',
        sample: 'Sangue periférico', order: 'Sangue · germinativo',
        description: 'Investiga mutação hereditária, independente do resultado tumoral. Toda histologia epitelial não-borderline tem indicação ao diagnóstico.',
        justify: 'Todo carcinoma epitelial de ovário tem indicação de teste germinativo BRCA1/2 ao diagnóstico, independente de histórico familiar.',
        programs: [LIFE_GENOMICS],
      };

      const somatico = {
        id: 'hrd', kind: 'somatico', name: 'HRD Somático', primary: true,
        sample: 'Tecido tumoral', order: 'Tumoral · somático · prioridade',
        stat: '~50% dos carcinomas de alto grau são HRD positivo',
        description: 'Avalia deficiência de recombinação homóloga no tecido tumoral (já inclui a análise de BRCA1/2 tumoral no mesmo teste). Define elegibilidade a terapia de manutenção com inibidor de PARP.',
        justify: 'Elegível para avaliação de status HRD tumoral para definição de elegibilidade a terapia de manutenção com inibidor de PARP.',
        programs: [PROGRAMA_ID],
      };

      if (!HISTOLOGIAS_HRD.some((h) => has(v.histologia, h))) {
        return {
          state: 'parcial', tests: [germinativo],
          title: 'Este caso tem indicação para teste germinativo',
          summary: `Carcinoma ${epitelial} de ovário. O critério para o teste somático (HRD) não foi atendido.`,
          notes: [{ tag: 'Somático - critério não atendido', title: 'HRD Somático não indicado por esta regra',
            body: 'O teste somático de HRD é específico para histologia serosa ou endometrioide de alto grau em estágio III/IV. Reavalie se histologia, grau ou estágio forem atualizados.' }],
        };
      }

      const altoGrau = grauAlto(v.grau);
      const baixoGrau = grauBaixo(v.grau);
      const avancado = estadioAvancado(v.estadiamento);
      const inicial = estadioInicial(v.estadiamento);

      if (baixoGrau || inicial) {
        return {
          state: 'parcial', tests: [germinativo],
          title: 'Este caso tem indicação para teste germinativo',
          summary: `Carcinoma ${epitelial} de ovário${filled(v.estadiamento) ? ', estágio ' + v.estadiamento : ''}. O critério para o teste somático (HRD) não foi atendido.`,
          notes: [{ tag: 'Somático - critério não atendido', title: 'HRD Somático não indicado por esta regra',
            body: 'O teste somático de HRD é específico para alto grau em estágio III/IV.' }],
        };
      }

      const confirmado = altoGrau && avancado;
      // Um campo preenchido em notação que não sabemos ler conta como
      // pendente. Sem isso o texto saía com a lacuna vazia — "Confirme  no
      // laudo" — num documento que o médico assina.
      const grauPendente = !altoGrau && !baixoGrau;
      const estagioPendente = !avancado && !inicial;
      const faltando = [grauPendente ? 'grau' : null, estagioPendente ? 'estágio' : null].filter(Boolean).join(' e ');

      return {
        state: confirmado ? 'completo' : 'provisorio',
        tests: [somatico, germinativo],
        title: confirmado ? 'Este caso tem indicação para 2 testes' : 'Este caso tem indicação provável para 2 testes',
        summary: confirmado
          ? `Carcinoma ${epitelial} de alto grau de ovário, estágio ${v.estadiamento}. Solicite os 2 testes abaixo.`
          : `Carcinoma ${epitelial} de ovário. Histologia compatível com o par somático + germinativo.${faltando ? ` Confirme ${faltando} no laudo antes de solicitar o teste somático.` : ''}`,
        notes: confirmado || !faltando ? [] : [{ warn: true, tag: 'A confirmar no laudo',
          title: `${faltando.charAt(0).toUpperCase()}${faltando.slice(1)} a confirmar`,
          body: `A indicação do teste somático assume que ${faltando} está dentro do critério (alto grau, estágio III/IV), o mais comum para esta histologia. O germinativo é indicado de qualquer forma.` }],
      };
    },
    diagnosis(v) {
      return juntarDx([
        montaDx(v.histologia, 'ovário', 'Carcinoma epitelial de ovário'),
        filled(v.grau) ? lower(v.grau) : '',
        filled(v.estadiamento) ? 'estágio ' + limpar(v.estadiamento) : '',
      ]);
    },
  };

  /* ================================================================== *
   * PRÓSTATA
   * ================================================================== */
  const prostata = {
    id: 'prostata',
    label: 'Próstata',
    short: 'Próstata',
    detect: 'adenocarcinoma de próstata; menção a PSA, Gleason, Grade Group ISUP, bloqueio hormonal/ADT, mHSPC, mCRPC',
    fields: [
      { key: 'histologia', label: 'Histologia', placeholder: 'Ex.: Adenocarcinoma acinar',
        ai: 'Histologia (ex.: "Adenocarcinoma acinar", "Intraductal/cribriforme", "Neuroendócrino/pequenas células", "Ductal").' },
      { key: 'gleason_grade_group', label: 'Gleason / Grade Group', placeholder: 'Ex.: Gleason 4+3=7, Grade Group 3',
        ai: 'Escore de Gleason e/ou Grade Group (ISUP), como relatado.' },
      { key: 'psa', label: 'PSA (ng/mL)', placeholder: 'Ex.: 18,4',
        ai: 'PSA em ng/mL, como relatado.' },
      { key: 'extensao_doenca', label: 'Extensão da doença', placeholder: 'Ex.: Metastático resistente à castração (mCRPC)', decisivo: true,
        justify: 'extensao_justificativa',
        options: ['Localizado', 'Linfonodo positivo (N1)', 'Metastático hormônio-sensível (mHSPC)', 'Metastático resistente à castração (mCRPC)'],
        ai: 'Extensão da doença. Infira do TNM e do contexto: M1 = metastático; início de bloqueio hormonal/ADT pela primeira vez = mHSPC; progressão em enzalutamida/abiraterona = mCRPC; linfonodo regional positivo sem metástase à distância = "Linfonodo positivo (N1)". Explique em extensao_justificativa quando inferir.' },
      { key: 'categoria_risco_localizado', label: 'Categoria de risco (se localizado)', placeholder: 'Ex.: Alto',
        justify: 'categoria_risco_justificativa',
        options: ['Baixo', 'Intermediário favorável', 'Intermediário desfavorável', 'Alto', 'Muito alto'],
        ai: 'Categoria de risco NCCN - só preencher quando a doença for localizada ou N1. Infira de PSA + Gleason/Grade Group + estágio clínico T, e só quando tiver os três com confiança. Baixo: cT1-cT2a, GG1, PSA<10. Intermediário favorável: GG2 predominância padrão 3, <50% fragmentos, no máximo 1 fator. Intermediário desfavorável: GG2-3 com >=50% fragmentos ou 2-3 fatores. Alto: cT3a ou GG4-5 ou PSA>20. Muito alto: cT3b-T4 ou padrão primário 5 ou >4 fragmentos GG4-5.' },
      { key: 'ascendencia_ashkenazi', label: 'Ascendência Ashkenazi', placeholder: 'Ex.: Não relatado',
        options: ['Sim', 'Não relatado'],
        ai: '"Sim" se ascendência judaica Ashkenazi for mencionada, "Não relatado" se negada, vazio se não mencionada.' },
      ...COMUNS,
    ],
    hint: 'Extensão da doença e categoria de risco são os eixos que definem indicação. PSA e Gleason ajudam a inferir a categoria quando ela não vem pronta no laudo. Só a extensão é necessária para rodar a triagem.',
    classify(v) {
      const ext = v.extensao_doenca;
      const risco = norm(v.categoria_risco_localizado);
      if (!filled(ext) && !filled(risco)) {
        return { state: 'insuficiente', message: 'Extensão da doença (ou categoria de risco) não identificada. Volte à revisão e complete o campo.' };
      }

      const metastatico = has(ext, 'metastatico');
      const mCRPC = has(ext, 'resistente a castracao', 'mcrpc');
      const n1 = has(ext, 'n1', 'linfonodo positivo');
      const altoRisco = risco === 'alto' || risco === 'muito alto';
      const intraductal = has(v.histologia, 'intraductal', 'cribriforme');
      const ashkenazi = has(v.ascendencia_ashkenazi, 'sim');
      const familiar = temHistoricoFamiliar(v);

      const germinativo = {
        id: 'germinativo-prostata', kind: 'germinativo',
        name: 'Painel germinativo (BRCA1/2, ATM, CHEK2, PALB2, HOXB13, MMR)',
        sample: 'Sangue periférico', order: 'Sangue · germinativo',
        description: 'Investiga mutação hereditária, independente do resultado tumoral.',
        justify: 'Perfil com indicação de teste germinativo ao diagnóstico, independente de histórico familiar.',
        programs: [LIFE_GENOMICS],
      };

      const somatico = {
        id: 'hrr', kind: 'somatico', name: 'Painel somático HRR', primary: true,
        sample: 'Tecido tumoral (ou biópsia líquida)', order: 'Tumoral · somático · prioridade',
        stat: '~20-25% dos casos metastáticos têm alteração em gene HRR',
        description: 'Painel de 15 genes de reparo por recombinação homóloga (BRCA1/2, ATM, BARD1, BRIP1, CDK12, CHEK1/2, FANCL, PALB2, PPP2R2A, RAD51B/C/D, RAD54L). Define elegibilidade a inibidor de PARP.',
        justify: 'Elegível para avaliação de painel somático HRR para definição de elegibilidade a terapia com inibidor de PARP.',
        programs: [PROGRAMA_ID, PROGRAMA_PFIZER],
      };

      if (metastatico) {
        return {
          state: 'completo', tests: [somatico, germinativo],
          title: 'Este caso tem indicação para 2 testes',
          summary: `Doença metastática${mCRPC ? ' resistente à castração' : ' hormônio-sensível'}. Solicite os 2 testes abaixo.`,
          notes: [],
        };
      }

      const motivos = [
        n1 ? 'linfonodo positivo (N1)' : null,
        altoRisco ? `risco ${risco}` : null,
        intraductal ? 'histologia intraductal/cribriforme' : null,
        ashkenazi ? 'ascendência Ashkenazi' : null,
        familiar ? 'histórico familiar relatado' : null,
      ].filter(Boolean);

      if (motivos.length) {
        return {
          state: 'parcial', tests: [germinativo],
          title: 'Este caso tem indicação para teste germinativo',
          summary: `Doença localizada com critério de indicação germinativa (${motivos.join(', ')}).`,
          notes: [{ tag: 'Somático - critério não atendido', title: 'Painel somático HRR não indicado por esta regra',
            body: 'O painel HRR é biomarcador de doença metastática. Reavalie se a doença progredir.' }],
        };
      }

      return {
        state: 'sem-indicacao',
        title: 'Sem indicação de teste genético por esta regra',
        summary: 'Doença localizada de risco baixo ou intermediário favorável, sem outros critérios identificados.',
        notes: [{ tag: 'Sem indicação', title: 'Nenhum teste genético indicado no momento',
          body: 'Reavalie se a categoria de risco, a histologia ou o histórico familiar forem atualizados.' }],
      };
    },
    diagnosis(v) {
      return juntarDx([
        montaDx(v.histologia, 'próstata', 'Adenocarcinoma de próstata'),
        v.gleason_grade_group,
        v.extensao_doenca,
        filled(v.categoria_risco_localizado) ? 'risco ' + lower(v.categoria_risco_localizado) : '',
      ]);
    },
  };

  /* ================================================================== *
   * MAMA
   * ================================================================== */
  const mama = {
    id: 'mama',
    label: 'Mama',
    short: 'Mama',
    detect: 'carcinoma de mama; menção a receptor hormonal (RE/RP), HER2, Ki-67, carcinoma ductal/lobular invasivo, triplo-negativo',
    fields: [
      { key: 'histologia', label: 'Histologia', placeholder: 'Ex.: Carcinoma ductal invasivo',
        ai: 'Histologia (ex.: "Carcinoma ductal invasivo", "Carcinoma lobular invasivo").' },
      { key: 'subtipo_molecular', label: 'Subtipo (RE/RP/HER2)', placeholder: 'Ex.: Triplo-negativo', decisivo: true,
        options: ['Luminal (RH+/HER2-)', 'HER2 positivo', 'Triplo-negativo'],
        ai: 'Subtipo por imuno-histoquímica. RE e/ou RP positivos com HER2 negativo = "Luminal (RH+/HER2-)". HER2 positivo (IHQ 3+ ou FISH amplificado) = "HER2 positivo". RE, RP e HER2 todos negativos = "Triplo-negativo".' },
      { key: 'extensao_doenca', label: 'Extensão da doença', placeholder: 'Ex.: Inicial (operável)', decisivo: true,
        options: ['Inicial (operável)', 'Localmente avançado', 'Metastático'],
        justify: 'extensao_justificativa',
        ai: 'Extensão: "Inicial (operável)", "Localmente avançado" ou "Metastático". Infira do TNM e do contexto clínico e explique em extensao_justificativa quando inferir.' },
      ...COMUNS,
    ],
    hint: 'Subtipo (RE/RP/HER2) e idade ao diagnóstico são os eixos que mais mudam a indicação germinativa. Extensão da doença define o teste somático.',
    classify(v) {
      const subtipo = v.subtipo_molecular;
      const idade = num(v.idade);
      const metastatico = has(v.extensao_doenca, 'metastatico');
      const triploNeg = has(subtipo, 'triplo');
      const luminal = has(subtipo, 'luminal', 'rh+');
      const familiar = temHistoricoFamiliar(v);

      if (!filled(subtipo) && idade === null && !filled(v.extensao_doenca)) {
        return { state: 'insuficiente', message: 'Informe ao menos o subtipo (RE/RP/HER2), a idade ao diagnóstico ou a extensão da doença.' };
      }

      // Critério germinativo NCCN: idade <=50, triplo-negativo em qualquer
      // idade, doença metastática, ou histórico familiar relevante.
      const motivos = [
        idade !== null && idade <= 50 ? `diagnóstico aos ${idade} anos` : null,
        triploNeg ? 'subtipo triplo-negativo' : null,
        metastatico ? 'doença metastática' : null,
        familiar ? 'histórico familiar relatado' : null,
      ].filter(Boolean);

      const germinativo = {
        id: 'germinativo-mama', kind: 'germinativo',
        name: 'Painel germinativo (BRCA1/2, PALB2 e genes de alto risco)',
        sample: 'Sangue periférico', order: 'Sangue · germinativo', primary: true,
        stat: 'BRCA1/2 germinativo define elegibilidade a inibidor de PARP',
        description: 'Investiga mutação hereditária. Além de orientar rastreio familiar em cascata, define elegibilidade a inibidor de PARP em cenário adjuvante (alto risco, HER2-negativo) e metastático.',
        justify: 'Perfil com critério de indicação de teste germinativo, com impacto em elegibilidade terapêutica e em rastreio familiar.',
        programs: [PROGRAMA_ID, LIFE_GENOMICS],
      };

      const somatico = {
        id: 'somatico-mama', kind: 'somatico', name: 'Painel somático (PIK3CA, ESR1 e alvos acionáveis)',
        sample: 'Tecido tumoral (ou biópsia líquida)', order: 'Tumoral · somático',
        description: 'Em doença metastática luminal, identifica alterações acionáveis que definem linhas de terapia-alvo. ESR1 deve ser reavaliado à progressão sob terapia endócrina.',
        justify: 'Doença metastática com indicação de perfil somático para identificação de alvos acionáveis.',
        programs: [PROGRAMA_ID],
      };

      const tests = [];
      if (motivos.length) tests.push(germinativo);
      if (metastatico && luminal) tests.push(somatico);

      if (!tests.length) {
        return {
          state: 'sem-indicacao',
          title: 'Sem indicação de teste genético por esta regra',
          summary: 'Perfil sem critério germinativo identificado (idade acima de 50, subtipo não triplo-negativo, doença não metastática e sem histórico familiar relatado).',
          notes: [{ tag: 'Sem indicação', title: 'Nenhum teste genético indicado no momento',
            body: 'Reavalie se surgir histórico familiar, se a doença progredir ou se o subtipo for atualizado.' }],
        };
      }

      return {
        state: 'completo', tests,
        title: tests.length > 1 ? 'Este caso tem indicação para 2 testes' : 'Este caso tem indicação para teste germinativo',
        summary: `Critério atendido: ${motivos.join(', ')}.`,
        notes: [],
      };
    },
    diagnosis(v) {
      return juntarDx([
        montaDx(v.histologia, 'mama', 'Carcinoma de mama'),
        v.subtipo_molecular,
        filled(v.extensao_doenca) ? lower(v.extensao_doenca) : '',
      ]);
    },
  };

  /* ================================================================== *
   * PÂNCREAS
   * ================================================================== */
  const pancreas = {
    id: 'pancreas',
    label: 'Pâncreas',
    short: 'Pâncreas',
    detect: 'adenocarcinoma ductal de pâncreas; menção a CA 19-9, cabeça/corpo/cauda do pâncreas, FOLFIRINOX, gencitabina',
    fields: [
      { key: 'histologia', label: 'Histologia', placeholder: 'Ex.: Adenocarcinoma ductal', decisivo: true,
        ai: 'Histologia (ex.: "Adenocarcinoma ductal", "Neuroendócrino"). O critério de teste universal vale para adenocarcinoma ductal (PDAC).' },
      { key: 'extensao_doenca', label: 'Extensão da doença', placeholder: 'Ex.: Metastático', decisivo: true,
        options: ['Ressecável', 'Borderline / localmente avançado', 'Metastático'],
        justify: 'extensao_justificativa',
        ai: 'Extensão: "Ressecável", "Borderline / localmente avançado" ou "Metastático". Explique em extensao_justificativa quando inferir.' },
      { key: 'platina', label: 'Uso de quimioterapia com platina', placeholder: 'Ex.: Em uso de FOLFIRINOX',
        options: ['Em uso / respondendo a platina', 'Não recebeu platina', 'Não informado'],
        ai: 'Se o paciente está em quimioterapia baseada em platina (FOLFIRINOX, gencitabina-cisplatina) e respondendo. Relevante para elegibilidade a manutenção com inibidor de PARP.' },
      ...COMUNS,
    ],
    hint: 'A indicação germinativa em pâncreas é universal: todo adenocarcinoma ductal tem indicação de teste ao diagnóstico, independente de idade, estágio ou histórico familiar.',
    classify(v) {
      if (!filled(v.histologia) && !filled(v.extensao_doenca)) {
        return { state: 'insuficiente', message: 'Informe ao menos a histologia ou a extensão da doença.' };
      }
      const neuroendocrino = has(v.histologia, 'neuroendocrin');
      if (neuroendocrino) {
        return {
          state: 'sem-indicacao',
          title: 'Fora do critério desta regra',
          summary: 'A regra de teste universal cobre adenocarcinoma ductal de pâncreas (PDAC). Tumor neuroendócrino de pâncreas segue outra diretriz, ainda não mapeada nesta versão.',
          notes: [{ tag: 'Fora de escopo', title: 'Histologia não coberta por esta regra',
            body: 'Consulte a diretriz específica de tumores neuroendócrinos pancreáticos.' }],
        };
      }

      const metastatico = has(v.extensao_doenca, 'metastatico');
      const platina = has(v.platina, 'em uso', 'respondendo');

      const germinativo = {
        id: 'germinativo-pancreas', kind: 'germinativo',
        name: 'Painel germinativo (BRCA1/2, PALB2, ATM, MMR)',
        sample: 'Sangue periférico', order: 'Sangue · germinativo', primary: true,
        stat: 'Indicação universal: todo adenocarcinoma ductal, em qualquer estágio',
        description: 'Indicado para todo paciente com adenocarcinoma ductal de pâncreas, independente de idade, estágio ou histórico familiar. Histórico familiar isolado não identifica a maioria dos portadores.',
        justify: 'Adenocarcinoma ductal de pâncreas tem indicação de teste germinativo ao diagnóstico, independente de estágio ou histórico familiar.',
        programs: [LIFE_GENOMICS],
      };

      const somatico = {
        id: 'somatico-pancreas', kind: 'somatico', name: 'Perfil somático tumoral',
        sample: 'Tecido tumoral', order: 'Tumoral · somático',
        description: 'Em doença metastática, identifica alvos acionáveis e confirma alterações em genes de reparo quando o germinativo é negativo.',
        justify: 'Doença metastática com indicação de perfil somático tumoral.',
        programs: [A_MAPEAR],
      };

      const tests = metastatico ? [germinativo, somatico] : [germinativo];
      return {
        state: 'completo', tests,
        title: tests.length > 1 ? 'Este caso tem indicação para 2 testes' : 'Este caso tem indicação para teste germinativo',
        summary: 'Adenocarcinoma ductal de pâncreas: indicação de teste germinativo ao diagnóstico, independente de estágio.',
        notes: platina && metastatico ? [{ tag: 'Impacto terapêutico', title: 'Paciente em platina',
          body: 'Em doença metastática com mutação germinativa BRCA1/2 e resposta mantida à platina, existe indicação de terapia de manutenção com inibidor de PARP. O resultado do teste muda a conduta nesta janela.' }] : [],
      };
    },
    diagnosis(v) {
      return juntarDx([
        montaDx(v.histologia, 'pâncreas', 'Adenocarcinoma ductal de pâncreas'),
        filled(v.extensao_doenca) ? lower(v.extensao_doenca) : '',
      ]);
    },
  };

  /* ================================================================== *
   * COLORRETAL
   * ================================================================== */
  const colorretal = {
    id: 'colorretal',
    label: 'Colorretal',
    short: 'Colorretal',
    detect: 'adenocarcinoma de cólon ou reto; menção a CEA, MSI, MMR, KRAS/NRAS/BRAF, cólon direito/esquerdo, sigmoide',
    fields: [
      { key: 'histologia', label: 'Histologia', placeholder: 'Ex.: Adenocarcinoma',
        ai: 'Histologia (ex.: "Adenocarcinoma", "Adenocarcinoma mucinoso").' },
      { key: 'extensao_doenca', label: 'Extensão da doença', placeholder: 'Ex.: Metastático', decisivo: true,
        options: ['Localizado / ressecado', 'Metastático'],
        justify: 'extensao_justificativa',
        ai: 'Extensão: "Localizado / ressecado" ou "Metastático". Explique em extensao_justificativa quando inferir.' },
      { key: 'mmr_msi', label: 'Status MMR / MSI (se já feito)', placeholder: 'Ex.: dMMR / MSI-alto', decisivo: true,
        options: ['dMMR / MSI-alto', 'pMMR / MSS', 'Não realizado'],
        ai: 'Status de reparo de erro de pareamento: "dMMR / MSI-alto", "pMMR / MSS" ou "Não realizado" se ainda não foi testado.' },
      ...COMUNS,
    ],
    hint: 'A pesquisa de MMR/MSI é universal em colorretal: todo tumor tem indicação, independente de idade ou histórico familiar. Em doença metastática soma-se o perfil somático para terapia-alvo.',
    classify(v) {
      if (!filled(v.histologia) && !filled(v.extensao_doenca)) {
        return { state: 'insuficiente', message: 'Informe ao menos a histologia ou a extensão da doença.' };
      }
      const metastatico = has(v.extensao_doenca, 'metastatico');
      const dmmr = has(v.mmr_msi, 'dmmr', 'msi-alto', 'msi alto');
      const mmrFeito = filled(v.mmr_msi) && !has(v.mmr_msi, 'nao realizado');

      const tests = [];

      if (!mmrFeito) {
        tests.push({
          id: 'mmr', kind: 'somatico', name: 'Pesquisa de MMR / MSI (rastreio de Lynch)', primary: true,
          sample: 'Tecido tumoral', order: 'Tumoral · universal · prioridade',
          stat: 'Indicação universal: todo tumor colorretal, em qualquer idade',
          description: 'Imuno-histoquímica das proteínas de reparo ou análise de instabilidade de microssatélites. Um único teste informa prognóstico, elegibilidade a imunoterapia e risco familiar (síndrome de Lynch).',
          justify: 'Todo carcinoma colorretal tem indicação de pesquisa de MMR/MSI ao diagnóstico, independente de idade ou histórico familiar.',
          programs: [A_MAPEAR],
        });
      }

      if (dmmr) {
        tests.push({
          id: 'germinativo-lynch', kind: 'germinativo', name: 'Painel germinativo de Lynch (MLH1, MSH2, MSH6, PMS2, EPCAM)',
          sample: 'Sangue periférico', order: 'Sangue · germinativo',
          description: 'Confirmação germinativa após tumor com deficiência de reparo. Perda isolada de MLH1 exige antes afastar causa esporádica (metilação do promotor ou BRAF V600E).',
          justify: 'Tumor com deficiência de reparo (dMMR/MSI-alto): indicação de confirmação germinativa para síndrome de Lynch.',
          programs: [LIFE_GENOMICS],
        });
      }

      if (metastatico) {
        tests.push({
          id: 'somatico-crc', kind: 'somatico', name: 'Perfil somático (RAS, BRAF V600E, HER2)',
          sample: 'Tecido tumoral (ou biópsia líquida)', order: 'Tumoral · somático',
          description: 'Obrigatório antes de terapia anti-EGFR. RAS mutado contraindica anti-EGFR; BRAF V600E define esquema específico; HER2 amplificado abre linha dirigida.',
          justify: 'Doença metastática com indicação de perfil somático antes da definição de terapia sistêmica dirigida.',
          programs: [A_MAPEAR],
        });
      }

      if (!tests.length) {
        return {
          state: 'sem-indicacao',
          title: 'Nenhum teste adicional indicado por esta regra',
          summary: 'MMR/MSI já realizado com resultado proficiente (pMMR/MSS) e doença não metastática.',
          notes: [{ tag: 'Já realizado', title: 'Rastreio universal já cumprido',
            body: 'Reavalie se a doença progredir para metastática, quando passa a haver indicação de perfil somático para terapia-alvo.' }],
        };
      }

      return {
        state: 'completo', tests,
        title: tests.length > 1 ? `Este caso tem indicação para ${tests.length} testes` : 'Este caso tem indicação para 1 teste',
        summary: dmmr
          ? 'Tumor com deficiência de reparo: exige confirmação germinativa para síndrome de Lynch.'
          : 'Carcinoma colorretal: pesquisa de MMR/MSI indicada em qualquer idade ou estágio.',
        notes: [],
      };
    },
    diagnosis(v) {
      return juntarDx([
        montaDx(v.histologia, 'cólon ou reto', 'Carcinoma colorretal'),
        filled(v.extensao_doenca) ? lower(v.extensao_doenca) : '',
        filled(v.mmr_msi) && !has(v.mmr_msi, 'nao realizado') ? v.mmr_msi : '',
      ]);
    },
  };

  /* ================================================================== *
   * ENDOMÉTRIO
   * ================================================================== */
  const endometrio = {
    id: 'endometrio',
    label: 'Ginecológico - Endométrio',
    short: 'Endométrio',
    detect: 'carcinoma de endométrio ou uterino; menção a endometrioide de útero, seroso uterino, histerectomia, POLE, classificação molecular de endométrio',
    fields: [
      { key: 'histologia', label: 'Histologia', placeholder: 'Ex.: Endometrioide', decisivo: true,
        ai: 'Histologia do carcinoma de endométrio (ex.: "Endometrioide", "Seroso", "Células claras", "Carcinossarcoma").' },
      { key: 'estadiamento', label: 'Estadiamento (FIGO)', placeholder: 'Ex.: IA',
        justify: 'estadiamento_justificativa',
        ai: 'Estágio FIGO no formato canônico romano. Normalize "1A" para "IA". Explique em estadiamento_justificativa quando inferir.' },
      { key: 'mmr_msi', label: 'Status MMR / MSI (se já feito)', placeholder: 'Ex.: dMMR', decisivo: true,
        options: ['dMMR / MSI-alto', 'pMMR / MSS', 'Não realizado'],
        ai: 'Status de reparo: "dMMR / MSI-alto", "pMMR / MSS" ou "Não realizado".' },
      ...COMUNS,
    ],
    hint: 'A pesquisa de MMR/MSI é universal em endométrio, independente de idade ou histórico familiar. A classificação molecular completa acrescenta POLE e p53, com impacto prognóstico.',
    classify(v) {
      if (!filled(v.histologia) && !filled(v.estadiamento)) {
        return { state: 'insuficiente', message: 'Informe ao menos a histologia ou o estadiamento.' };
      }
      const dmmr = has(v.mmr_msi, 'dmmr', 'msi-alto', 'msi alto');
      const mmrFeito = filled(v.mmr_msi) && !has(v.mmr_msi, 'nao realizado');
      const tests = [];

      if (!mmrFeito) {
        tests.push({
          id: 'mmr-endo', kind: 'somatico', name: 'Classificação molecular (MMR/MSI, POLE, p53)', primary: true,
          sample: 'Tecido tumoral', order: 'Tumoral · universal · prioridade',
          stat: 'Indicação universal: todo carcinoma de endométrio',
          description: 'Pesquisa de MMR/MSI indicada para todo carcinoma de endométrio, independente de idade ou histórico familiar. A classificação molecular completa acrescenta POLE (que prevalece sobre os demais marcadores) e p53, com impacto prognóstico e de conduta adjuvante.',
          justify: 'Todo carcinoma de endométrio tem indicação de pesquisa de MMR/MSI ao diagnóstico, independente de idade ou histórico familiar.',
          programs: [A_MAPEAR],
        });
      }

      if (dmmr) {
        tests.push({
          id: 'germinativo-lynch-endo', kind: 'germinativo', name: 'Painel germinativo de Lynch (MLH1, MSH2, MSH6, PMS2, EPCAM)',
          sample: 'Sangue periférico', order: 'Sangue · germinativo',
          description: 'Confirmação germinativa após tumor com deficiência de reparo. Perda isolada de MLH1 exige antes afastar causa esporádica por metilação do promotor.',
          justify: 'Tumor com deficiência de reparo (dMMR): indicação de confirmação germinativa para síndrome de Lynch.',
          programs: [LIFE_GENOMICS],
        });
      }

      if (!tests.length) {
        return {
          state: 'sem-indicacao',
          title: 'Nenhum teste adicional indicado por esta regra',
          summary: 'MMR/MSI já realizado com resultado proficiente (pMMR/MSS).',
          notes: [{ tag: 'Já realizado', title: 'Rastreio universal já cumprido',
            body: 'Considere completar a classificação molecular (POLE e p53) se ainda não feita, pelo impacto prognóstico.' }],
        };
      }

      return {
        state: 'completo', tests,
        title: tests.length > 1 ? 'Este caso tem indicação para 2 testes' : 'Este caso tem indicação para 1 teste',
        summary: dmmr
          ? 'Tumor com deficiência de reparo: exige confirmação germinativa para síndrome de Lynch.'
          : 'Carcinoma de endométrio: classificação molecular indicada em qualquer idade ou estágio.',
        notes: [],
      };
    },
    diagnosis(v) {
      return juntarDx([
        montaDx(v.histologia, 'endométrio', 'Carcinoma de endométrio'),
        filled(v.estadiamento) ? 'estágio ' + limpar(v.estadiamento) : '',
        filled(v.mmr_msi) && !has(v.mmr_msi, 'nao realizado') ? v.mmr_msi : '',
      ]);
    },
  };

  /* ================================================================== *
   * PULMÃO (NSCLC)
   * ================================================================== */
  const pulmao = {
    id: 'pulmao',
    label: 'Pulmão - não pequenas células',
    short: 'Pulmão',
    detect: 'câncer de pulmão; menção a adenocarcinoma pulmonar, carcinoma escamoso de pulmão, NSCLC, EGFR, ALK, ROS1, PD-L1, nódulo pulmonar',
    fields: [
      { key: 'histologia', label: 'Histologia', placeholder: 'Ex.: Adenocarcinoma', decisivo: true,
        options: ['Adenocarcinoma', 'Carcinoma escamoso', 'Não pequenas células sem outra especificação', 'Pequenas células'],
        ai: 'Histologia pulmonar. "Pequenas células" é uma via clínica distinta e deve ser marcada como tal quando for o caso.' },
      { key: 'extensao_doenca', label: 'Extensão da doença', placeholder: 'Ex.: Metastático', decisivo: true,
        options: ['Inicial (ressecável)', 'Localmente avançado', 'Metastático'],
        justify: 'extensao_justificativa',
        ai: 'Extensão: "Inicial (ressecável)", "Localmente avançado" ou "Metastático". Explique em extensao_justificativa quando inferir.' },
      { key: 'painel_previo', label: 'Perfil molecular já realizado', placeholder: 'Ex.: Não realizado',
        options: ['Já realizado', 'Não realizado'],
        ai: 'Se um painel molecular amplo já foi realizado neste paciente.' },
      ...COMUNS,
    ],
    hint: 'Em pulmão a indicação é predominantemente somática: doença avançada ou metastática exige painel molecular amplo antes de definir a primeira linha de tratamento.',
    classify(v) {
      if (!filled(v.histologia) && !filled(v.extensao_doenca)) {
        return { state: 'insuficiente', message: 'Informe ao menos a histologia ou a extensão da doença.' };
      }
      if (has(v.histologia, 'pequenas celulas') && !has(v.histologia, 'nao pequenas')) {
        return {
          state: 'sem-indicacao',
          title: 'Fora do critério desta regra',
          summary: 'Carcinoma de pequenas células segue via clínica distinta, com indicação de perfil molecular diferente da do NSCLC. Ainda não mapeado nesta versão.',
          notes: [{ tag: 'Fora de escopo', title: 'Histologia não coberta por esta regra',
            body: 'Consulte a diretriz específica de carcinoma de pequenas células de pulmão.' }],
        };
      }

      const avancado = has(v.extensao_doenca, 'metastatico', 'localmente avancado');
      const jaFeito = has(v.painel_previo, 'ja realizado');

      if (!avancado) {
        return {
          state: 'sem-indicacao',
          title: 'Sem indicação de painel amplo por esta regra',
          summary: 'Doença inicial ressecável. O painel molecular amplo é indicado em doença avançada ou metastática.',
          notes: [{ tag: 'Reavaliar', title: 'Painel indicado se a doença avançar',
            body: 'Alguns cenários iniciais têm indicação de pesquisa dirigida (ex.: EGFR para terapia adjuvante). Reavalie conforme a conduta definida.' }],
        };
      }

      if (jaFeito) {
        return {
          state: 'sem-indicacao',
          title: 'Perfil molecular já realizado',
          summary: 'O painel amplo já foi feito neste paciente.',
          notes: [{ tag: 'Já realizado', title: 'Reavaliação à progressão',
            body: 'À progressão sob terapia-alvo, um novo perfil (incluindo biópsia líquida) pode identificar mecanismo de resistência acionável.' }],
        };
      }

      return {
        state: 'completo',
        tests: [{
          id: 'painel-nsclc', kind: 'somatico', name: 'Painel molecular amplo', primary: true,
          sample: 'Tecido tumoral (ou biópsia líquida)', order: 'Tumoral · somático · prioridade',
          stat: 'Cobre EGFR, ALK, ROS1, BRAF, KRAS G12C, MET, RET, NTRK e HER2',
          description: 'Painel amplo indicado antes de definir a primeira linha em doença avançada. Testar gene a gene consome tecido e atrasa a decisão terapêutica. Quando o tecido é insuficiente, a biópsia líquida é alternativa aceita.',
          justify: 'Doença avançada com indicação de painel molecular amplo antes da definição de terapia sistêmica de primeira linha.',
          programs: [PROGRAMA_ID],
        }],
        title: 'Este caso tem indicação para 1 teste',
        summary: 'Doença avançada: painel molecular amplo indicado antes da primeira linha de tratamento.',
        notes: [],
      };
    },
    diagnosis(v) {
      return juntarDx([
        montaDx(v.histologia, 'pulmão', 'Carcinoma de pulmão'),
        filled(v.extensao_doenca) ? lower(v.extensao_doenca) : '',
      ]);
    },
  };

  /* ------------------------------------------------------------------ */
  const REGISTRY = { ovario, prostata, mama, pancreas, colorretal, endometrio, pulmao };
  const ORDER = ['ovario', 'mama', 'prostata', 'colorretal', 'pulmao', 'pancreas', 'endometrio'];

  function get(id) { return REGISTRY[id] || null; }
  function list() { return ORDER.map((id) => REGISTRY[id]); }
  function labels() { return list().map((t) => t.label); }

  /* ------------------------------------------------------------------ *
   * Schema de extração: chaves SIMPLES, valores em união.
   *
   * Histórico das duas tentativas, porque a segunda falhou em produção:
   *
   * v1.2 — uma chave por campo, compartilhada entre tumores. Quebrou porque
   *   "extensao_doenca" tem listas de valores diferentes em cinco tumores, e
   *   o schema levava a lista de um só. mCRPC era impossível de extrair.
   *
   * v1.3 — chave com prefixo por tumor ("ovario__histologia"). Corrigiu a
   *   colisão e criou outra falha, pior: 39 propriedades das quais 35 têm de
   *   vir vazias, com nomes que não existem em vocabulário clínico nenhum.
   *   Em uso real o modelo preenchia os campos de chave simples (idade,
   *   histórico familiar) e deixava vazios TODOS os de chave prefixada.
   *
   * v1.6 — chave simples de novo (19 campos, nomes naturais), mas o `enum`
   *   de um campo compartilhado é a UNIÃO dos valores de todos os tumores
   *   que o usam, e a descrição diz quais valores pertencem a qual subtipo.
   *   Depois da resposta, `normalizar()` valida o valor contra a lista do
   *   tumor identificado. Assim o modelo escreve num schema natural e a
   *   correção acontece do lado do código, que é onde ela é barata.
   * ------------------------------------------------------------------ */
  const CHAVES_COMUNS = COMUNS.map((f) => f.key);

  function isComum(key) { return CHAVES_COMUNS.includes(key); }

  // Campos de um tumor, incluindo as justificativas derivadas.
  function fieldsOf(tumor) {
    const out = [];
    tumor.fields.forEach((field) => {
      out.push(field);
      if (field.justify) {
        out.push({
          key: field.justify,
          label: `Justificativa de ${field.label}`,
          ai: `Se "${field.label}" não estava escrito literalmente e você inferiu a partir de outros achados, explique em 1-2 frases o que levou à conclusão. Vazio se o dado estava escrito.`,
          internal: true,
          origem: field.key,
        });
      }
    });
    return out;
  }

  // Um campo por chave distinta, com a união dos valores e a descrição
  // combinada de todos os tumores que o usam.
  function schemaFields() {
    const porChave = new Map();

    list().forEach((tumor) => {
      fieldsOf(tumor).forEach((field) => {
        if (!porChave.has(field.key)) {
          porChave.set(field.key, {
            key: field.key,
            label: field.label,
            internal: Boolean(field.internal),
            comum: isComum(field.key),
            porTumor: [],
            options: [],
          });
        }
        const acumulado = porChave.get(field.key);
        acumulado.porTumor.push({ tumor, ai: field.ai, options: field.options || null });
        (field.options || []).forEach((o) => {
          if (!acumulado.options.includes(o)) acumulado.options.push(o);
        });
      });
    });

    return Array.from(porChave.values()).map((campo) => {
      const usadoPorTodos = campo.comum || campo.porTumor.length === list().length;

      // Só colapsa numa descrição quando ela é IDÊNTICA em todos os tumores.
      // "histologia" existe nos sete com orientações diferentes: usar a do
      // ovário para todos é a mesma falha da v1.2, só que na descrição em vez
      // do enum — o modelo receberia "ex.: Seroso, Endometrioide" para um
      // caso de pulmão.
      const descricoesIguais = campo.porTumor.every((p) => p.ai === campo.porTumor[0].ai);

      let ai;
      if (usadoPorTodos && descricoesIguais) {
        ai = campo.porTumor[0].ai;
      } else if (usadoPorTodos) {
        ai = `Vale para todos os subtipos, com orientação própria em cada um. Use a do subtipo que você identificou. ${campo.porTumor
          .map((p) => `${p.tumor.label}: ${p.ai}`)
          .join(' ')}`;
      } else if (campo.porTumor.length === 1) {
        ai = `Só para ${campo.porTumor[0].tumor.label}; vazio nos demais subtipos. ${campo.porTumor[0].ai}`;
      } else {
        // Campo compartilhado por alguns tumores, com orientação (e às vezes
        // lista de valores) diferente em cada um. A descrição diz qual vale
        // para qual, e o enum é a união.
        const alvos = campo.porTumor.map((p) => p.tumor.label).join(', ');
        const detalhe = campo.porTumor
          .map((p) => `${p.tumor.label}: ${p.ai}${p.options ? ` Valores possíveis aqui: ${p.options.map((o) => `"${o}"`).join(', ')}.` : ''}`)
          .join(' ');
        ai = `Só para ${alvos}; vazio nos demais subtipos. Use a orientação do subtipo que você identificou. ${detalhe}`;
      }

      // Lista fechada só quando TODOS os tumores que usam o campo definem
      // valores. "histologia" tem lista fechada no pulmão e é texto livre nos
      // outros seis: impor o enum do pulmão travaria ovário e mama num
      // vocabulário que não é o deles.
      const todosTemLista = campo.porTumor.every((p) => p.options && p.options.length);

      return {
        key: campo.key,
        schemaKey: campo.key,
        label: campo.label,
        internal: campo.internal,
        ai,
        options: todosTemLista && campo.options.length ? campo.options : null,
        tumores: campo.porTumor.map((p) => p.tumor.label),
        escopo: usadoPorTodos ? null : campo.porTumor.map((p) => p.tumor.label).join(', '),
      };
    });
  }

  // Comparação tolerante de rótulo de tumor: o modelo pode devolver com
  // espaço extra, caixa diferente ou hífen de outro tipo.
  function acharTumorPorLabel(label) {
    const alvo = norm(label).replace(/[^a-z0-9]+/g, ' ').trim();
    if (!alvo) return null;
    return list().find((t) => norm(t.label).replace(/[^a-z0-9]+/g, ' ').trim() === alvo) || null;
  }

  // Encaixa o valor devolvido na lista de valores daquele tumor. Se não bater
  // exatamente, tenta por aproximação — melhor um valor próximo, que a regra
  // entende, do que campo vazio, que apaga a indicação.
  function encaixarValor(valor, opcoes) {
    const bruto = String(valor || '').trim();
    if (!bruto || !opcoes || !opcoes.length) return bruto;
    const exato = opcoes.find((o) => o === bruto);
    if (exato) return exato;
    const porNorma = opcoes.find((o) => norm(o) === norm(bruto));
    if (porNorma) return porNorma;
    const porInclusao = opcoes.find((o) => norm(o).includes(norm(bruto)) || norm(bruto).includes(norm(o)));
    if (porInclusao) return porInclusao;
    // Valor de outro subtipo ou grafia inesperada: preserva o texto. As regras
    // usam has(), que é tolerante, e o médico vê e corrige na revisão.
    return bruto;
  }

  /**
   * Converte a resposta do modelo no objeto que o navegador consome.
   *
   * Aceita a chave simples ("histologia") e também a antiga com prefixo
   * ("ovario__histologia"), para que uma resposta em qualquer um dos dois
   * formatos continue funcionando.
   */
  function normalizar(raw) {
    const bruto = raw || {};
    const tumor = acharTumorPorLabel(bruto.tipo_tumor);

    const out = {
      tipo_tumor: tumor ? tumor.label : String(bruto.tipo_tumor || ''),
      tipo_tumor_justificativa: String(bruto.tipo_tumor_justificativa || ''),
      fontes_usadas: Array.isArray(bruto.fontes_usadas) ? bruto.fontes_usadas : [],
      nome_paciente: String(bruto.nome_paciente || ''),
    };

    function ler(tumorId, key) {
      const simples = bruto[key];
      if (simples !== undefined && simples !== null && String(simples).trim() !== '') return String(simples).trim();
      const prefixada = bruto[`${tumorId}__${key}`];
      if (prefixada !== undefined && prefixada !== null) return String(prefixada).trim();
      return '';
    }

    CHAVES_COMUNS.forEach((k) => {
      const v = bruto[k];
      out[k] = v === undefined || v === null ? '' : String(v).trim();
    });

    if (!tumor) return out;

    fieldsOf(tumor).forEach((field) => {
      if (isComum(field.key)) return;
      out[field.key] = encaixarValor(ler(tumor.id, field.key), field.options);
    });
    return out;
  }

  return {
    REGISTRY, ORDER, get, list, labels,
    fieldsOf, schemaFields, normalizar, acharTumorPorLabel, encaixarValor, isComum, CHAVES_COMUNS,
    helpers: { norm, lower, has, filled, num, estadioNumero, estadioAvancado, estadioInicial, estadioIlegivel, grauAlto, grauBaixo },
  };
});
