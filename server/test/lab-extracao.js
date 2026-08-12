'use strict';

// Laboratório de diagnóstico da extração — chama a API DIRETO, sem servidor,
// para isolar uma variável por vez. Não faz parte de npm test. Custa dinheiro.
//
//   node test/lab-extracao.js <condicao> [repeticoes]
//
// Existe por causa do achado da §32: Ginecológico - Endométrio e Ovário
// falham em silêncio (todos os campos vazios, status 200, sem aviso), enquanto
// os outros cinco subtipos dão 100%. Documentar não resolve: em fase beta com
// médico real do outro lado, uma extração que falha sem avisar é pior que uma
// que erra alto.

require('dotenv').config();
const Anthropic = require('@anthropic-ai/sdk');
const TUMORS = require('../public/tumors.js');

const client = new Anthropic({ timeout: 90_000, maxRetries: 1 });

/* ---------------------------------------------------------------- *
 * Schema e prompt vêm do MESMO módulo que a produção usa.
 *
 * A versão anterior deste arquivo trazia uma cópia colada do prompt, e ela já
 * tinha divergido: media uma instrução que index.js não usava mais. Um
 * laboratório que mede outra coisa que não a produção não erra o número — erra
 * a conclusão, e em silêncio.
 * ---------------------------------------------------------------- */
const {
  UNIFIED_SCHEMA,
  UNIFIED_SYSTEM_PROMPT,
  schemaDoSubtipo,
  promptDoSubtipo,
  extracaoAbandonada: abandonadaEmProducao,
} = require('../extracao.js');

const schemaCompleto = () => UNIFIED_SCHEMA;
const schemaDoTumor = schemaDoSubtipo;
const SISTEMA_ATUAL = UNIFIED_SYSTEM_PROMPT;

/* ---------------------------------------------------------------- *
 * Casos
 * ---------------------------------------------------------------- */
const CASO_ENDOMETRIO = 'Paciente de 60 anos submetida a histerectomia total com salpingo-ooforectomia bilateral por adenocarcinoma de endométrio. Anatomopatológico: carcinoma endometrioide, grau 1, estádio FIGO IA. Painel MMR por imuno-histoquímica: MLH1, MSH2, MSH6 e PMS2 preservados (pMMR).';
const CASO_OVARIO = 'Pct Maria, 58a, submetida a SOB + HT por CA de ovário. AP: carcinoma seroso de alto grau, invasão capsular presente, estadiamento cirúrgico FIGO IIIC (implantes peritoneais >2cm). Sem história familiar relatada.';

function montaMensagem(texto) {
  return `Descrição em texto fornecida pelo médico:\n\n<material_do_paciente>\n${texto}\n</material_do_paciente>\n\nExtraia o caso clínico estruturado conforme o schema.`;
}

/* ---------------------------------------------------------------- *
 * Condições experimentais — uma variável por vez.
 * ---------------------------------------------------------------- */
const CONDICOES = {
  // A: exatamente o que roda em produção hoje.
  'A-baseline-endometrio': async () => chamar(SISTEMA_ATUAL, schemaCompleto(), montaMensagem(CASO_ENDOMETRIO)),
  'A-baseline-ovario': async () => chamar(SISTEMA_ATUAL, schemaCompleto(), montaMensagem(CASO_OVARIO)),

  // B: a recuperação EXATAMENTE como a produção a faz — prompt dirigido ao
  // subtipo já identificado + schema reduzido. É a condição que decide se a
  // segunda chamada da §33.2 resolve de verdade.
  'B-recuperacao-endometrio': async () => chamar(
    promptDoSubtipo(TUMORS.get('endometrio')), schemaDoTumor('endometrio'), montaMensagem(CASO_ENDOMETRIO)),
  'B-recuperacao-ovario': async () => chamar(
    promptDoSubtipo(TUMORS.get('ovario')), schemaDoTumor('ovario'), montaMensagem(CASO_OVARIO)),

  // C: schema completo + strict. Testa se a validação estrita muda o comportamento.
  'C-strict-endometrio': async () => chamar(SISTEMA_ATUAL, schemaCompleto(), montaMensagem(CASO_ENDOMETRIO), { strict: true }),

  // D: sem output_config, pedindo JSON pelo prompt. Testa se a saída estruturada é a causa.
  'D-sem-output-config-endometrio': async () => chamarSemSchema(SISTEMA_ATUAL, schemaCompleto(), montaMensagem(CASO_ENDOMETRIO)),

  // E: prompt reforçado contra abandono. Testa se instrução explícita resolve.
  'E-prompt-reforcado-endometrio': async () => chamar(
    SISTEMA_ATUAL + `\n\n=== PROIBIÇÃO ABSOLUTA ===\nNUNCA devolva o objeto com todos os campos vazios. Se você identificou um tipo_tumor, então o material tem conteúdo clínico, e tipo_tumor_justificativa, fontes_usadas e os campos do subtipo identificado TÊM de ser preenchidos com o que está escrito. Um objeto com tipo_tumor preenchido e todo o resto vazio é uma resposta INVÁLIDA.`,
    schemaCompleto(), montaMensagem(CASO_ENDOMETRIO),
  ),
  // E-ovario: a justificativa vazia PREDIZ a falha (10/10 na condição A). Se
  // exigir a justificativa força o modelo a raciocinar sobre o sítio antes de
  // decidir, a identificação deve melhorar. Se não melhorar, o sinal é só
  // sintoma, não alavanca.
  'E-exige-justificativa-ovario': async () => chamar(
    SISTEMA_ATUAL + `

=== OBRIGATÓRIO ANTES DE DECIDIR ===
tipo_tumor_justificativa NUNCA pode ficar vazia quando você identificou um subtipo. Escreva nela, ANTES de preencher os demais campos, qual TRECHO LITERAL do material nomeia o sítio de origem do tumor. Se você não consegue citar um trecho que nomeie o sítio, então você não tem base para escolher entre subtipos vizinhos — releia o material procurando o órgão de origem.

Um objeto com tipo_tumor preenchido e tipo_tumor_justificativa vazia é uma resposta INVÁLIDA.`,
    schemaCompleto(), montaMensagem(CASO_OVARIO)),

  // G: desempate BINÁRIO entre os dois ginecológicos. A extração dirigida
  // provou-se 100% confiável (condição B); a pergunta aqui é se uma pergunta
  // FECHADA, com dois valores só e instrução de citar o trecho, herda essa
  // confiabilidade. Se herdar, vira o desempate para os casos ginecológicos.
  'G-desempate-ovario': async () => chamar(PROMPT_DESEMPATE, SCHEMA_DESEMPATE, montaMensagem(CASO_OVARIO)),
  'G-desempate-endometrio': async () => chamar(PROMPT_DESEMPATE, SCHEMA_DESEMPATE, montaMensagem(CASO_ENDOMETRIO)),

  // F: identificação ISOLADA, com schema mínimo. Se a identificação sozinha
  // for confiável e a extração dirigida já é 100%, a arquitetura de duas
  // etapas passa a ser melhor E mais barata que a chamada unificada.
  'F-identificacao-ovario': async () => chamar(SISTEMA_ATUAL, SCHEMA_ID, montaMensagem(CASO_OVARIO)),
  'F-identificacao-endometrio': async () => chamar(SISTEMA_ATUAL, SCHEMA_ID, montaMensagem(CASO_ENDOMETRIO)),
};

const PROMPT_DESEMPATE = `Você lê material clínico oncológico e responde UMA pergunta: o tumor descrito tem origem no OVÁRIO (incluindo tuba uterina e peritônio) ou no ENDOMÉTRIO (corpo uterino)?

Estas três pistas NÃO respondem, porque valem para os dois:
- histerectomia total com salpingo-ooforectomia bilateral (HT + SOB, "SOB+HT") é a cirurgia padrão dos DOIS;
- a histologia "endometrioide" existe nos DOIS (carcinoma endometrioide DE OVÁRIO e DE ENDOMÉTRIO);
- o estadiamento FIGO é usado nos DOIS.

O que responde é o SÍTIO nomeado no material: "CA de ovário", "carcinoma de ovário", "massa anexial", "tuba uterina", "implantes peritoneais", CA-125 -> ovário. "carcinoma de endométrio", "endometrial", "corpo uterino", "biópsia/curetagem de endométrio", "histeroscopia", "sangramento pós-menopausa" -> endométrio.

Em trecho_que_decide, copie LITERALMENTE o trecho do material que nomeia o sítio. Se não houver trecho que nomeie o sítio, responda "Indeterminado".`;

const SCHEMA_DESEMPATE = {
  type: 'object',
  properties: {
    trecho_que_decide: {
      type: 'string',
      description: 'O trecho LITERAL do material que nomeia o sítio de origem. Vazio se não houver.',
    },
    sitio: {
      type: 'string',
      enum: ['Ginecológico - Ovário', 'Ginecológico - Endométrio', 'Indeterminado'],
      description: 'O sítio de origem, decidido pelo trecho citado acima.',
    },
  },
  required: ['trecho_que_decide', 'sitio'],
  additionalProperties: false,
};

const SCHEMA_ID = {
  type: 'object',
  properties: {
    tipo_tumor: {
      type: 'string',
      enum: [...TUMORS.labels(), 'Não identificado'],
      description: 'Subtipo oncológico identificado a partir do conteúdo do material. "Não identificado" apenas se não for possível determinar com segurança.',
    },
    tipo_tumor_justificativa: {
      type: 'string',
      description: 'Em 1 frase curta, o que no material levou a identificar esse subtipo. Vazio se "Não identificado".',
    },
  },
  required: ['tipo_tumor', 'tipo_tumor_justificativa'],
  additionalProperties: false,
};

// Subtipo correto de cada condição, para separar os DOIS modos de falha:
// abandono (tudo vazio) e troca de subtipo (campos certos, tumor errado).
const ESPERADO = {
  'A-baseline-endometrio': 'Ginecológico - Endométrio',
  'A-baseline-ovario': 'Ginecológico - Ovário',
  'C-strict-endometrio': 'Ginecológico - Endométrio',
  'D-sem-output-config-endometrio': 'Ginecológico - Endométrio',
  'E-prompt-reforcado-endometrio': 'Ginecológico - Endométrio',
  'E-exige-justificativa-ovario': 'Ginecológico - Ovário',
  'G-desempate-ovario': 'Ginecológico - Ovário',
  'G-desempate-endometrio': 'Ginecológico - Endométrio',
  'F-identificacao-ovario': 'Ginecológico - Ovário',
  'F-identificacao-endometrio': 'Ginecológico - Endométrio',
};

async function chamar(sistema, schema, texto, extra = {}) {
  const r = await client.messages.create({
    model: 'claude-opus-5',
    max_tokens: 2048,
    system: sistema,
    output_config: { format: { type: 'json_schema', schema, ...extra } },
    messages: [{ role: 'user', content: [{ type: 'text', text: texto }] }],
  });
  const bloco = r.content.find((b) => b.type === 'text');
  return { json: bloco ? JSON.parse(bloco.text) : null, usage: r.usage, stop: r.stop_reason };
}

async function chamarSemSchema(sistema, schema, texto) {
  const r = await client.messages.create({
    model: 'claude-opus-5',
    max_tokens: 2048,
    system: `${sistema}\n\nResponda APENAS com um objeto JSON válido seguindo este schema:\n${JSON.stringify(schema)}`,
    messages: [{ role: 'user', content: [{ type: 'text', text: texto }] }],
  });
  const bloco = r.content.find((b) => b.type === 'text');
  let json = null;
  try {
    json = JSON.parse(bloco.text.replace(/^```json\s*|\s*```$/g, ''));
  } catch { /* deixa null: conta como falha */ }
  return { json, usage: r.usage, stop: r.stop_reason };
}

/**
 * A assinatura da falha: tipo_tumor veio, mas o resto está todo vazio.
 * É exatamente isso que hoje chega à tela sem nenhum aviso.
 */
function extracaoAbandonada(json) {
  if (!json) return true;
  const chaves = Object.keys(json).filter((k) => k !== 'tipo_tumor');
  return chaves.every((k) => {
    const v = json[k];
    if (Array.isArray(v)) return v.length === 0;
    return String(v == null ? '' : v).trim() === '';
  });
}

let custo = 0;
function contabiliza(usage) {
  if (!usage) return;
  custo += ((usage.input_tokens || 0) + (usage.cache_creation_input_tokens || 0)) / 1e6 * 5
    + (usage.output_tokens || 0) / 1e6 * 25;
}

async function main() {
  const alvo = process.argv[2];
  const n = parseInt(process.argv[3] || '10', 10);
  const nomes = alvo && alvo !== 'todas' ? [alvo] : Object.keys(CONDICOES);

  for (const nome of nomes) {
    const fn = CONDICOES[nome];
    if (!fn) { console.error(`condição desconhecida: ${nome}`); process.exit(1); }

    let abandonos = 0;
    let trocas = 0;
    let semJustificativa = 0;
    const detalhes = [];
    const esperado = ESPERADO[nome];

    for (let i = 0; i < n; i++) {
      let r;
      try {
        r = await fn();
      } catch (e) {
        detalhes.push(`ERRO ${e.status || ''} ${String(e.message).slice(0, 90)}`);
        abandonos++;
        continue;
      }
      contabiliza(r.usage);
      const j = r.json || {};
      const ehDesempate = Boolean(j.sitio);
      const abandonou = ehDesempate ? false : extracaoAbandonada(r.json);
      const trocou = ehDesempate
        ? (Boolean(esperado) && j.sitio !== esperado)
        : (Boolean(esperado) && !abandonou && j.tipo_tumor !== esperado);
      if (abandonou) abandonos++;
      if (trocou) trocas++;

      // O indicador de confiança da §33.5, medido junto: a justificativa vazia
      // deve coincidir com abandono ou troca. Se coincidir, o sinal se sustenta.
      const semJust = !String(j.tipo_tumor_justificativa || '').trim();
      if (semJust) semJustificativa++;

      // A condição G responde em `sitio`, não em `tipo_tumor`.
      const tipoRespondido = j.tipo_tumor || j.sitio || '-';
      const acertouG = !esperado || tipoRespondido === esperado;
      const rotulo = j.sitio
        ? (acertouG ? 'ok       ' : 'ERROU    ')
        : (abandonou ? 'ABANDONOU' : (trocou ? 'TROCOU   ' : 'ok       '));
      const extra = j.sitio
        ? `trecho=${JSON.stringify(String(j.trecho_que_decide || '').slice(0, 30))}`
        : `hist=${JSON.stringify((j.histologia || '').slice(0, 16)).padEnd(18)} just=${semJust ? 'VAZIA' : 'ok   '}`;
      detalhes.push(`${rotulo} tipo=${String(tipoRespondido).slice(0, 26).padEnd(26)} ${extra}`);
    }

    const bons = n - abandonos - trocas;
    console.log(`\n### ${nome}`);
    detalhes.forEach((d) => console.log('   ' + d));
    console.log(`   >>> corretas ${bons}/${n} (${(bons / n * 100).toFixed(0)}%)  | abandonos ${abandonos} | trocas de subtipo ${trocas} | justificativa vazia ${semJustificativa}`);
  }
  console.log(`\ncusto acumulado: US$ ${custo.toFixed(3)}`);
}

main().catch((e) => { console.error('FATAL', e); process.exit(1); });
