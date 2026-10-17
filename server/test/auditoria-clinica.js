'use strict';

/* AUDITORIA CLÍNICA DO MOTOR DE REGRAS
 *
 *   node test/auditoria-clinica.js            → relatório
 *   node test/auditoria-clinica.js --json     → achados crus
 *
 * Percorre TODAS as combinações de campos de cada tumor, executa `classify` e
 * confere invariantes — afirmações que precisam valer em qualquer caminho da
 * regra, não só nos que alguém lembrou de testar.
 *
 * A diferença para a suíte de testes: a suíte afirma "neste caso, este
 * resultado". A auditoria afirma "em NENHUM caso pode acontecer isto". Uma
 * regra nova entra na auditoria sem ninguém escrever nada.
 *
 * Cada achado confirmado vira um teste de regressão em regras.test.js.
 */

const TUMORS = require('../public/tumors.js');

const TETO = 200000;

/* Vocabulário dos campos de texto livre. Mesmo princípio do
 * auditoria-programas.js: campo sem `options` não se enumera sozinho, e sem
 * vocabulário a auditoria varre o nada e declara tudo certo. */
const VOCABULARIO = {
  histologia: ['', 'Seroso', 'Endometrioide', 'Células claras', 'Mucinoso', 'Carcinossarcoma', 'Adenocarcinoma', 'Adenocarcinoma ductal', 'Escamoso'],
  grau: ['', 'Alto grau', 'Baixo grau'],
  estadiamento: ['', 'IA', 'II', 'IIIC', 'IV'],
  idade: ['', '38', '55', '70'],
  historico_familiar: ['', 'Sim', 'Não relatado'],
  testes_previos: ['', 'Nenhum', 'Painel germinativo já realizado'],
};

function combinacoes(campos) {
  let casos = [{}];
  for (const campo of campos) {
    const lista = campo.options
      ? ['', ...campo.options]
      : (VOCABULARIO[campo.key] || ['']);
    const proximo = [];
    for (const base of casos) {
      for (const v of lista) {
        proximo.push({ ...base, [campo.key]: v });
        if (proximo.length > TETO) return { casos: proximo, estourou: true };
      }
    }
    casos = proximo;
  }
  return { casos, estourou: false };
}

function rodar(tumor, valores) {
  const v = {};
  (tumor.fields || []).forEach((f) => { v[f.key] = ''; });
  Object.assign(v, valores);
  return { entrada: v, saida: tumor.classify(v) };
}

/* 'provisorio' veio de `state: confirmado ? 'completo' : 'provisorio'` e não
 * aparece num grep por `state: '...'`. A primeira versão desta lista foi feita
 * por grep e acusou 288 falsos positivos — lista de estados montada por busca
 * de texto erra exatamente nos estados calculados, que são os interessantes. */
const ESTADOS = ['completo', 'provisorio', 'parcial', 'sem-indicacao', 'insuficiente', 'nao-reconhecida'];

/* ------------------------------------------------------------------ *
 * INVARIANTES
 *
 * Cada um recebe (tumor, entrada, resultado) e devolve uma lista de
 * violações. O texto da violação é a frase que iria para o teste de
 * regressão — escrito para quem lê daqui a um ano, não para o console.
 * ------------------------------------------------------------------ */
const INVARIANTES = [

  function estadoConhecido(_t, _e, r) {
    if (!ESTADOS.includes(r.state)) return [`estado desconhecido: "${r.state}"`];
    return [];
  },

  /* O card diz "nenhum teste indicado" e lista testes, ou o contrário. Foi
   * assim que a tela de endométrio se contradizia na v1.x. */
  function estadoBateComOsTestes(_t, _e, r) {
    const n = (r.tests || []).length;
    const fora = [];
    if (r.state === 'completo' && n === 0) fora.push('estado "completo" sem nenhum teste');
    if (r.state === 'provisorio' && n === 0) fora.push('estado "provisorio" sem nenhum teste');
    if (r.state === 'parcial' && n === 0) fora.push('estado "parcial" sem nenhum teste');
    if (r.state === 'sem-indicacao' && n > 0) fora.push(`estado "sem-indicacao" com ${n} teste(s)`);
    if (r.state === 'insuficiente' && n > 0) fora.push(`estado "insuficiente" com ${n} teste(s)`);
    if (r.state === 'nao-reconhecida' && n > 0) fora.push(`estado "nao-reconhecida" com ${n} teste(s)`);
    return fora;
  },

  /* Todo estado precisa de texto para o médico. Estado sem título é card em
   * branco na tela do resultado. */
  function sempreTemTexto(_t, _e, r) {
    const fora = [];
    const temTitulo = !!String(r.title || '').trim();
    const temResumo = !!String(r.summary || r.message || '').trim();
    if ((r.state === 'completo' || r.state === 'parcial' || r.state === 'sem-indicacao') && !temTitulo) {
      fora.push(`estado "${r.state}" sem título`);
    }
    if (!temResumo) fora.push(`estado "${r.state}" sem resumo nem mensagem`);
    return fora;
  },

  /* Teste sem justificativa vai IMPRESSO no pedido com o campo vazio, acima
   * da assinatura do médico (§63.2). Sem amostra, o laboratório não sabe o
   * que coletar. */
  function testeCompleto(_t, _e, r) {
    const fora = [];
    for (const t of r.tests || []) {
      if (!String(t.id || '').trim()) fora.push(`teste sem id: "${t.name}"`);
      if (!String(t.name || '').trim()) fora.push(`teste sem nome (id ${t.id})`);
      if (!String(t.sample || '').trim()) fora.push(`${t.id}: sem amostra`);
      if (!String(t.justify || '').trim()) fora.push(`${t.id}: sem justificativa clínica (vai vazia no pedido assinado)`);
      if (!String(t.description || '').trim()) fora.push(`${t.id}: sem descrição`);
      if (!['germinativo', 'somatico'].includes(t.kind)) fora.push(`${t.id}: natureza inválida "${t.kind}"`);
    }
    return fora;
  },

  /* Dois cards iguais na tela, e dois pedidos iguais para assinar. */
  function semTesteRepetido(_t, _e, r) {
    const vistos = new Set();
    const fora = [];
    for (const t of r.tests || []) {
      if (vistos.has(t.id)) fora.push(`teste repetido: ${t.id}`);
      vistos.add(t.id);
    }
    return fora;
  },

  /* §35: germinativo é SANGUE. Oferecer um parceiro que só processa tecido
   * manda o médico a um laboratório que não faz o exame pedido. */
  function amostraCoerenteComNatureza(_t, _e, r) {
    const fora = [];
    for (const t of r.tests || []) {
      const amostra = String(t.sample || '').toLowerCase();
      if (t.kind === 'germinativo' && !/sangue|saliva/.test(amostra)) {
        fora.push(`${t.id}: germinativo com amostra "${t.sample}"`);
      }
      if (t.kind === 'somatico' && /sangue periférico/.test(amostra) && !/biópsia líquida/.test(amostra)) {
        fora.push(`${t.id}: somático pedindo sangue sem dizer biópsia líquida ("${t.sample}")`);
      }
      for (const p of t.programs || []) {
        if (!p.amostra) continue;
        if (t.kind === 'germinativo' && p.amostra === 'tecido') {
          fora.push(`${t.id}: germinativo (sangue) oferecendo "${p.name}", que processa tecido`);
        }
      }
    }
    return fora;
  },

  /* A garantia estrutural do registro: todo germinativo carrega o laboratório
   * parceiro. Foi perdida uma vez e levou meses para reaparecer. */
  function germinativoTemEncaminhamento(_t, _e, r) {
    const fora = [];
    for (const t of r.tests || []) {
      if (t.kind !== 'germinativo') continue;
      if (!(t.programs || []).length) fora.push(`${t.id}: germinativo sem nenhum encaminhamento`);
    }
    return fora;
  },

  /* Programa associado a tumor fora da cobertura verificada — os dois
   * incidentes que a `cobertura` existe para impedir. */
  function programaDentroDaCobertura(tumor, _e, r) {
    const fora = [];
    for (const t of r.tests || []) {
      for (const p of t.programs || []) {
        if (!p.cobertura) continue;
        if (!p.cobertura.includes(tumor.id)) {
          fora.push(`${t.id}: "${p.name}" aparece em ${tumor.id}, fora da cobertura ${JSON.stringify(p.cobertura)}`);
        }
      }
    }
    return fora;
  },

  /* O número no título tem de ser o número de cards abaixo dele. */
  function contagemNoTextoBate(_t, _e, r) {
    const n = (r.tests || []).length;
    const texto = `${r.title || ''} ${r.summary || ''}`;
    const fora = [];
    const m = texto.match(/indicação para (\d+) testes?/i);
    if (m && Number(m[1]) !== n) fora.push(`o texto diz ${m[1]} teste(s) e a lista tem ${n}`);
    const s = texto.match(/[Ss]olicite os (\d+) testes/);
    if (s && Number(s[1]) !== n) fora.push(`o resumo manda solicitar ${s[1]} e a lista tem ${n}`);
    return fora;
  },

  /* Nota é texto que o médico lê na tela: sem título ou sem corpo, aparece
   * como cartão vazio. */
  function notaCompleta(_t, _e, r) {
    const fora = [];
    for (const n of r.notes || []) {
      if (!String(n.title || '').trim()) fora.push('nota sem título');
      if (!String(n.body || '').trim()) fora.push(`nota "${n.title}" sem corpo`);
      if (!String(n.tag || '').trim()) fora.push(`nota "${n.title}" sem rótulo`);
    }
    return fora;
  },

  /* Texto clínico montado com valor ausente. O `justify` de colorretal é um
   * template com a idade dentro; se a idade não chegar, o pedido ASSINADO
   * sai dizendo "diagnosticado aos null anos". Vale para todo texto que o
   * médico lê ou assina. */
  function semBuracoNoTexto(_t, _e, r) {
    const SUJEIRA = /\bundefined\b|\bnull\b|\bNaN\b|\[object Object\]|\$\{/;
    const fora = [];
    const olhar = (texto, onde) => {
      if (texto && SUJEIRA.test(String(texto))) {
        fora.push(`${onde}: "${String(texto).slice(0, 80)}"`);
      }
    };
    olhar(r.title, 'título');
    olhar(r.summary, 'resumo');
    olhar(r.message, 'mensagem');
    for (const t of r.tests || []) {
      olhar(t.name, `${t.id}.nome`);
      olhar(t.description, `${t.id}.descrição`);
      olhar(t.justify, `${t.id}.justificativa (vai no pedido assinado)`);
      olhar(t.stat, `${t.id}.selo`);
      olhar(t.sample, `${t.id}.amostra`);
      olhar(t.order, `${t.id}.rótulo do pedido`);
    }
    for (const n of r.notes || []) {
      olhar(n.title, 'nota.título');
      olhar(n.body, 'nota.corpo');
    }
    return fora;
  },

  /* Um teste declara que não há via verificada E traz um parceiro real no
   * mesmo card: o médico lê "sem via patrocinada" ao lado de um botão que
   * abre um portal. Uma das duas afirmações está errada. */
  function semViaNaoConviveComVia(_t, _e, r) {
    const fora = [];
    for (const t of r.tests || []) {
      const lista = t.programs || [];
      const temSemVia = lista.some((p) => p.tipo === 'sem-via');
      const temReal = lista.some((p) => p.tipo === 'patrocinado' || p.tipo === 'laboratorio');
      if (temSemVia && temReal) {
        fora.push(`${t.id}: diz "sem via verificada" e oferece ${lista.filter((p) => p.tipo !== 'sem-via').map((p) => p.name).join(', ')}`);
      }
    }
    return fora;
  },

  /* O rótulo da linha de pedido ("Sangue · germinativo") é o que o médico lê
   * para saber o que coletar. Se contradiz a natureza do teste, o pedido sai
   * com a coleta errada. */
  function rotuloDoPedidoBateComANatureza(_t, _e, r) {
    const fora = [];
    for (const t of r.tests || []) {
      const ordem = String(t.order || '').toLowerCase();
      if (!ordem) continue;
      if (t.kind === 'germinativo' && /som[áa]tico|tumoral/.test(ordem)) {
        fora.push(`${t.id}: germinativo com rótulo de pedido "${t.order}"`);
      }
      if (t.kind === 'somatico' && /germinativo/.test(ordem)) {
        fora.push(`${t.id}: somático com rótulo de pedido "${t.order}"`);
      }
    }
    return fora;
  },

  /* Selo estatístico vazio vira pílula em branco na tela. */
  function seloNaoFicaVazio(_t, _e, r) {
    const fora = [];
    for (const t of r.tests || []) {
      if ('stat' in t && t.stat !== undefined && t.stat !== null && !String(t.stat).trim()) {
        fora.push(`${t.id}: selo estatístico presente e vazio`);
      }
    }
    return fora;
  },

  /* Mais de um teste marcado como prioritário: a sequência numerada da tela
   * passa a ter dois "primeiros". */
  function noMaximoUmPrioritario(_t, _e, r) {
    const n = (r.tests || []).filter((t) => t.primary).length;
    return n > 1 ? [`${n} testes marcados como prioritários`] : [];
  },

  /* Mesma entrada, mesma saída. Regra que depende de data, de ordem de chave
   * ou de estado compartilhado produz resultado diferente na segunda chamada
   * — e o médico vê uma coisa, o documento sai com outra. */
  function determinismo(tumor, entrada, r) {
    const outra = tumor.classify({ ...entrada });
    const a = (r.tests || []).map((t) => t.id).join(',');
    const b = (outra.tests || []).map((t) => t.id).join(',');
    if (a !== b || r.state !== outra.state) {
      return [`mesma entrada deu resultados diferentes: [${a}|${r.state}] vs [${b}|${outra.state}]`];
    }
    return [];
  },
];

/* ------------------------------------------------------------------ *
 * MONOTONIA
 *
 * Preencher um campo que estava vazio não pode REMOVER um teste já
 * indicado. O caso clínico não ficou menos grave porque o médico digitou
 * mais um dado — e se ficou, é a regra que precisa dizer isso com uma nota,
 * não sumir com o card em silêncio.
 *
 * Exceção declarada: `testes_previos`. Dizer que o germinativo já foi feito
 * DEVE remover o germinativo — é a única retirada legítima.
 * ------------------------------------------------------------------ */
/* Campos que DECLARAM um exame já feito, ou um resultado já conhecido.
 * Preenchê-los retira o teste legitimamente: pedir de novo o que já foi
 * feito é que seria o defeito. */
const CAMPOS_QUE_PODEM_REMOVER = new Set([
  'testes_previos',   // "painel germinativo já realizado"
  'mmr_msi',          // o resultado de MMR/MSI já está na mão
  'painel_previo',    // painel molecular de pulmão já realizado
]);

function auditarMonotonia(tumor, casos) {
  const achados = [];
  const campos = (tumor.fields || []).map((f) => f.key);

  for (const base of casos) {
    const { saida: antes } = rodar(tumor, base);
    if (!antes.tests || !antes.tests.length) continue;

    for (const campo of campos) {
      if (base[campo]) continue;                 // só preenchimentos novos
      if (CAMPOS_QUE_PODEM_REMOVER.has(campo)) continue;
      const valores = VOCABULARIO[campo]
        || ((tumor.fields.find((f) => f.key === campo) || {}).options || []);
      for (const valor of valores) {
        if (!valor) continue;
        const { saida: depois } = rodar(tumor, { ...base, [campo]: valor });
        /* Comparar por ID confunde REFINAMENTO com PERDA. Em colorretal,
         * informar idade 38 troca o painel familiar pelo de início precoce,
         * e informar dMMR troca o painel amplo pelo de Lynch — os dois são
         * mais dirigidos, não menos. Comparar por NATUREZA pega o que
         * importa: o médico ficou sem investigação germinativa? sem
         * investigação somática? */
        const natureza = (res) => new Set((res.tests || []).map((t) => t.kind));
        const antesKinds = natureza(antes);
        const depoisKinds = natureza(depois);
        const perdidas = [...antesKinds].filter((k) => !depoisKinds.has(k));

        /* Ausência DECLARADA não é perda silenciosa. Em ovário, informar
         * baixo grau ou estágio inicial retira o HRD — e o app diz por quê,
         * no resumo e numa nota ("O critério para o teste somático não foi
         * atendido"). É o comportamento certo: a regra explica em vez de
         * sumir com o card. O que esta auditoria procura é a retirada MUDA. */
        const explicou = depois.state === 'parcial'
          || /não foi atendido|não indicad/i.test(`${depois.summary || ''} ${(depois.notes || []).map((n) => `${n.title} ${n.body}`).join(' ')}`);

        if (perdidas.length && !explicou) {
          achados.push({
            tumor: tumor.id,
            tipo: 'monotonia',
            detalhe: `preencher ${campo}="${valor}" deixou o caso sem investigação ${perdidas.join(' e ')}`,
            base: JSON.stringify(base),
          });
        }
      }
    }
  }
  return achados;
}

/* ------------------------------------------------------------------ *
 * NORMALIZAÇÃO
 *
 * O laudo chega escrito de todo jeito. Se "seroso", "Seroso" e " Seroso "
 * derem resultados diferentes, o médico recebe triagens diferentes para o
 * mesmo caso, dependendo de como o extrator escreveu.
 * ------------------------------------------------------------------ */
function auditarNormalizacao(tumor) {
  const achados = [];
  const variantes = (v) => [v, v.toLowerCase(), v.toUpperCase(), ` ${v} `];

  const basesPorTumor = {
    ovario: { histologia: 'Seroso', grau: 'Alto grau', estadiamento: 'IIIC' },
    mama: { subtipo_molecular: 'Triplo-negativo', extensao_doenca: 'Metastático', idade: '44' },
    prostata: { extensao_doenca: 'Metastático resistente à castração (mCRPC)' },
    colorretal: { histologia: 'Adenocarcinoma', extensao_doenca: 'Metastático' },
    pulmao: { histologia: 'Adenocarcinoma', extensao_doenca: 'Metastático' },
    pancreas: { histologia: 'Adenocarcinoma ductal' },
    endometrio: { histologia: 'Endometrioide', estadiamento: 'IA', mmr_msi: 'dMMR / MSI-alto' },
  };
  const base = basesPorTumor[tumor.id];
  if (!base) return achados;

  const { saida: referencia } = rodar(tumor, base);
  const refIds = (referencia.tests || []).map((t) => t.id).sort().join(',');

  for (const [campo, valor] of Object.entries(base)) {
    for (const variante of variantes(valor)) {
      if (variante === valor) continue;
      const { saida } = rodar(tumor, { ...base, [campo]: variante });
      const ids = (saida.tests || []).map((t) => t.id).sort().join(',');
      if (ids !== refIds) {
        achados.push({
          tumor: tumor.id,
          tipo: 'normalizacao',
          detalhe: `${campo}: "${valor}" dá [${refIds}] e "${variante}" dá [${ids}]`,
        });
      }
    }
  }
  return achados;
}

/* ------------------------------------------------------------------ */

function auditar() {
  const achados = [];
  const resumo = [];

  for (const id of TUMORS.ORDER) {
    const tumor = TUMORS.get(id);
    const { casos, estourou } = combinacoes(tumor.fields || []);
    let comTeste = 0;

    for (const valores of casos) {
      let r;
      let entrada;
      try {
        const saida = rodar(tumor, valores);
        r = saida.saida;
        entrada = saida.entrada;
      } catch (e) {
        achados.push({ tumor: id, tipo: 'excecao', detalhe: e.message, base: JSON.stringify(valores) });
        continue;
      }
      if ((r.tests || []).length) comTeste++;

      for (const inv of INVARIANTES) {
        for (const violacao of inv(tumor, entrada, r)) {
          achados.push({ tumor: id, tipo: inv.name, detalhe: violacao, base: JSON.stringify(valores) });
        }
      }
    }

    // Tumor que nunca indica teste é vocabulário incompleto, não regra calma.
    if (comTeste === 0) {
      throw new Error(`Auditoria incompleta: "${tumor.short || id}" não indicou teste em nenhuma das ${casos.length} combinações. Falta vocabulário em VOCABULARIO.`);
    }

    achados.push(...auditarMonotonia(tumor, casos));
    achados.push(...auditarNormalizacao(tumor));

    resumo.push({ tumor: tumor.short || id, combinacoes: casos.length, comTeste, truncado: estourou });
  }

  return { achados, resumo };
}

function relatorio({ achados, resumo }) {
  const linhas = [];
  linhas.push('COMBINAÇÕES EXAMINADAS');
  for (const r of resumo) {
    linhas.push(`  ${r.tumor.padEnd(14)} ${String(r.combinacoes).padStart(7)} combinações · ${r.comTeste} com teste${r.truncado ? ' · TRUNCADO' : ''}`);
  }
  const total = resumo.reduce((n, r) => n + r.combinacoes, 0);
  linhas.push(`  ${'TOTAL'.padEnd(14)} ${String(total).padStart(7)}`);

  // Agrupa por tipo+detalhe: o mesmo defeito aparece em centenas de
  // combinações, e listar cada uma esconde quantos defeitos DISTINTOS há.
  const porAssinatura = new Map();
  for (const a of achados) {
    const chave = `${a.tumor} | ${a.tipo} | ${a.detalhe}`;
    if (!porAssinatura.has(chave)) porAssinatura.set(chave, { ...a, vezes: 0 });
    porAssinatura.get(chave).vezes++;
  }

  linhas.push('');
  if (!porAssinatura.size) {
    linhas.push('Nenhuma violação de invariante.');
  } else {
    linhas.push(`${porAssinatura.size} ACHADO(S) DISTINTO(S):`);
    const ordenados = [...porAssinatura.values()].sort((a, b) => b.vezes - a.vezes);
    for (const a of ordenados) {
      linhas.push('');
      linhas.push(`  [${a.tumor}] ${a.tipo} — ${a.vezes} combinação(ões)`);
      linhas.push(`    ${a.detalhe}`);
      if (a.base) linhas.push(`    exemplo: ${a.base}`);
    }
  }
  return linhas.join('\n');
}

if (require.main === module) {
  const dados = auditar();
  if (process.argv.includes('--json')) console.log(JSON.stringify(dados, null, 2));
  else console.log(relatorio(dados));
  process.exitCode = dados.achados.length ? 1 : 0;
}

module.exports = { auditar, INVARIANTES };
