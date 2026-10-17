'use strict';

/* Auditoria dos programas de indústria — EXTRAÍDA DO CÓDIGO QUE RODA.
 *
 *   node test/auditoria-programas.js            → imprime o resumo
 *   node test/auditoria-programas.js --json     → dados crus
 *
 * Existe para que a validação humana seja feita contra o que o app faz, não
 * contra o que alguém lembra que ele fazia. A lista é construída EXECUTANDO
 * cada regra sobre todas as combinações dos campos de cada tumor: um teste só
 * entra aqui se existe um caso real que o produz.
 *
 * O que a auditoria responde, por teste:
 *   - existe programa de indústria associado?
 *   - qual indústria, com que data de verificação?
 *   - se não existe, está declarado como busca-sem-resultado (A_MAPEAR)?
 *
 * A terceira pergunta é a que importa para a curadoria: "sem programa" pode
 * significar "não existe" ou "ninguém procurou". O registro distingue as
 * duas, e a auditoria carrega a distinção para quem vai validar.
 */

const TUMORS = require('../public/tumors.js');

// Teto de combinações por tumor. A multiplicação cresce rápido (5 campos com
// 4 opções = 1024 casos); o teto evita que a auditoria vire um laço infinito
// sem avisar, e o relatório diz quando ele foi atingido.
const TETO = 120000;

/* Vocabulário dos campos de TEXTO LIVRE.
 *
 * Campo com `options` se enumera sozinho. Campo livre (histologia, grau,
 * estadiamento) não — e sem vocabulário a auditoria roda, não produz nenhum
 * teste para ovário e endométrio, e imprime "0 testes" como se fosse a
 * verdade. Era exatamente isso que acontecia na primeira versão deste
 * arquivo. O vocabulário fica declarado aqui, e a função `auditar` RECUSA
 * fechar um tumor que não produziu nenhum teste.
 *
 * Os termos vêm do campo `ai` de cada campo no registro — a mesma lista que
 * o extrator usa para normalizar o laudo. */
const VOCABULARIO = {
  histologia: ['', 'Seroso', 'Endometrioide', 'Células claras', 'Mucinoso', 'Carcinossarcoma', 'Adenocarcinoma', 'Adenocarcinoma ductal', 'Escamoso'],
  grau: ['', 'Alto grau', 'Baixo grau'],
  estadiamento: ['', 'IA', 'II', 'IIIC', 'IV'],
  idade: ['', '38', '55', '70'],
  historico_familiar: ['', 'Sim', 'Não relatado'],
};

function combinacoes(campos) {
  // Cada campo contribui com suas opções MAIS o vazio (o médico pode não ter
  // o dado). O vazio é o que revela teste indicado "independente de".
  let casos = [{}];
  for (const campo of campos) {
    const valores = ['', ...(campo.options || [])];
    // Campo livre (sem options) entra só como vazio e como um valor plausível
    // de idade, que é o único campo numérico que muda regra.
    const lista = campo.options ? valores : (VOCABULARIO[campo.key] || ['']);
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

function auditar() {
  const porTumor = [];
  const industrias = new Map();

  for (const id of TUMORS.ORDER) {
    const tumor = TUMORS.get(id);
    const campos = tumor.fields || [];
    const { casos, estourou } = combinacoes(campos);

    const testes = new Map();
    for (const valores of casos) {
      const v = {};
      campos.forEach((f) => { v[f.key] = ''; });
      Object.assign(v, valores);
      let r;
      try { r = tumor.classify(v); } catch (e) { continue; }
      for (const t of r.tests || []) {
        if (!testes.has(t.name)) {
          testes.set(t.name, {
            nome: t.name,
            tipo: t.kind || '-',
            amostra: t.sample || '-',
            programas: [],
          });
        }
        const alvo = testes.get(t.name);
        for (const p of TUMORS.ordenarProgramas(t.programs || [])) {
          if (alvo.programas.some((x) => x.name === p.name)) continue;
          alvo.programas.push(p);
          if (p.tipo === 'patrocinado') {
            const chave = p.industria || p.name;
            if (!industrias.has(chave)) industrias.set(chave, { industria: chave, programa: p.name, url: p.url, verificadoEm: p.verificadoEm, tumores: new Set() });
            industrias.get(chave).tumores.add(tumor.short || tumor.label || id);
          }
        }
      }
    }

    // Tumor sem nenhum teste significa vocabulário incompleto, não ausência
    // de indicação: toda regra do registro indica ao menos um teste em algum
    // cenário. Falhar alto é o único jeito de a auditoria não mentir por
    // omissão — ver §54.4, mesma lição da bateria de contraste.
    if (testes.size === 0) {
      throw new Error(
        `Auditoria incompleta: "${tumor.short || id}" não produziu nenhum teste em ${casos.length} combinações. ` +
        'O vocabulário de algum campo de texto livre está faltando em VOCABULARIO.',
      );
    }

    porTumor.push({
      id,
      nome: tumor.short || tumor.label || id,
      casosExaminados: casos.length,
      estourou,
      testes: [...testes.values()].sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR')),
    });
  }

  return {
    geradoEm: new Date().toISOString().slice(0, 10),
    porTumor,
    industrias: [...industrias.values()].map((i) => ({ ...i, tumores: [...i.tumores].sort() })),
  };
}

function resumo(dados) {
  const linhas = [];
  let comPrograma = 0;
  let semPrograma = 0;
  for (const t of dados.porTumor) {
    linhas.push(`\n${t.nome.toUpperCase()}  (${t.testes.length} testes, ${t.casosExaminados} combinações${t.estourou ? ' — TRUNCADO' : ''})`);
    for (const teste of t.testes) {
      const patrocinados = teste.programas.filter((p) => p.tipo === 'patrocinado');
      const semVia = teste.programas.some((p) => p.tipo === 'sem-via');
      if (patrocinados.length) comPrograma++; else semPrograma++;
      const marca = patrocinados.length ? '[IND]' : (semVia ? '[   ]' : '[ ? ]');
      linhas.push(`  ${marca} ${teste.nome}`);
      linhas.push(`        amostra: ${teste.amostra}`);
      for (const p of teste.programas) {
        linhas.push(`        · ${p.tipo === 'patrocinado' ? p.industria : p.tipo} — ${p.name}`);
      }
    }
  }
  linhas.push(`\n${comPrograma} teste(s) com programa de indústria · ${semPrograma} sem.`);
  linhas.push('[IND] tem programa  ·  [   ] busca feita, nada encontrado  ·  [ ? ] nenhum programa declarado');
  return linhas.join('\n');
}

if (require.main === module) {
  const dados = auditar();
  if (process.argv.includes('--json')) console.log(JSON.stringify(dados, null, 2));
  else console.log(resumo(dados));
}

module.exports = { auditar };
