'use strict';

// Integridade do registro de tumores e do schema de extração.
//
// Estes testes existem por causa de um bug real: "extensao_doenca" era uma
// chave única compartilhada por cinco tumores, então o schema levava a lista
// de valores de UM deles e aplicava a todos. Na prática, "mCRPC" e
// "Linfonodo positivo (N1)" eram impossíveis de extrair — o modelo só podia
// devolver os valores da mama. A suíte de ponta a ponta não pegou porque
// simulava a extração e injetava os valores certos à mão.
//
// Regra que fica: nada aqui testa o modelo. Tudo testa o CONTRATO entre o
// registro clínico, o schema enviado ao modelo e o que o navegador consome.

const test = require('node:test');
const assert = require('node:assert');
const TUMORS = require('../public/tumors.js');

test('todo tumor declara os campos obrigatórios do contrato', () => {
  TUMORS.list().forEach((t) => {
    assert.ok(t.id, 'tumor sem id');
    assert.ok(t.label, `${t.id}: sem label`);
    assert.ok(t.short, `${t.id}: sem short`);
    assert.ok(t.detect, `${t.id}: sem pistas de identificação`);
    assert.ok(Array.isArray(t.fields) && t.fields.length, `${t.id}: sem campos`);
    assert.strictEqual(typeof t.classify, 'function', `${t.id}: sem classify`);
    assert.strictEqual(typeof t.diagnosis, 'function', `${t.id}: sem diagnosis`);
    assert.ok(t.hint, `${t.id}: sem texto de orientação`);
  });
});

test('ORDER cobre exatamente o REGISTRY, sem sobra nem falta', () => {
  assert.deepStrictEqual(
    [...TUMORS.ORDER].sort(),
    Object.keys(TUMORS.REGISTRY).sort(),
  );
});

test('rótulos de tumor são únicos (o desprefixo casa por label)', () => {
  const labels = TUMORS.labels();
  assert.strictEqual(new Set(labels).size, labels.length, 'há rótulo repetido');
});

test('nenhum campo com lista de valores compartilha chave de schema com outro', () => {
  const porChave = new Map();
  TUMORS.schemaFields().forEach((f) => {
    if (porChave.has(f.schemaKey)) {
      porChave.get(f.schemaKey).push(f);
    } else {
      porChave.set(f.schemaKey, [f]);
    }
  });

  for (const [chave, campos] of porChave) {
    assert.strictEqual(
      campos.length, 1,
      `chave "${chave}" aparece ${campos.length} vezes no schema - valores de um tumor vazariam para outro`,
    );
  }
});

// Trava da PRIMEIRA falha vivida (v1.2): o schema levava a lista de valores de
// um tumor e aplicava a todos, então mCRPC era impossível de extrair.
test('todo valor de todo tumor é alcançável no schema', () => {
  const schema = new Map(TUMORS.schemaFields().map((f) => [f.key, f]));

  TUMORS.list().forEach((tumor) => {
    tumor.fields.forEach((field) => {
      if (!field.options) return;
      const noSchema = schema.get(field.key);
      assert.ok(noSchema, `${tumor.id}.${field.key}: ausente do schema`);
      field.options.forEach((valor) => {
        assert.ok(
          !noSchema.options || noSchema.options.includes(valor),
          `${tumor.id}.${field.key}: o valor "${valor}" não é alcançável no schema`,
        );
      });
    });
  });
});

test('campo com lista fechada em uns tumores e livre em outros fica livre', () => {
  // "histologia" tem lista fechada no pulmão e é texto livre nos outros seis.
  // Impor o enum do pulmão travaria ovário e mama num vocabulário alheio.
  TUMORS.schemaFields().forEach((campo) => {
    if (!campo.options) return;
    const usam = TUMORS.list().filter((t) => TUMORS.fieldsOf(t).some((f) => f.key === campo.key));
    usam.forEach((t) => {
      const doTumor = TUMORS.fieldsOf(t).find((f) => f.key === campo.key);
      assert.ok(
        doTumor.options && doTumor.options.length,
        `${campo.key} tem enum no schema mas é texto livre em ${t.id} — o enum travaria esse tumor`,
      );
    });
  });
});

// Trava da SEGUNDA falha vivida (v1.3): chaves sintéticas com prefixo por
// tumor ("ovario__histologia"). O schema ficava correto no papel e o modelo
// deixava TODOS esses campos vazios em uso real, porque o nome não existe em
// vocabulário clínico nenhum.
test('as chaves do schema são nomes de campo reais, sem prefixo sintético', () => {
  const declarados = new Set();
  TUMORS.list().forEach((t) => TUMORS.fieldsOf(t).forEach((f) => declarados.add(f.key)));

  TUMORS.schemaFields().forEach((campo) => {
    assert.ok(
      declarados.has(campo.key),
      `"${campo.key}" não é um campo declarado por nenhum tumor — parece chave sintética`,
    );
    assert.doesNotMatch(
      campo.key, /__|\$|::/,
      `"${campo.key}" usa separador sintético; o modelo ignora chaves assim`,
    );
  });
});

// Terceira variante da mesma falha: o campo é compartilhado, a descrição de UM
// tumor é usada para todos, e o modelo recebe "ex.: Seroso, Endometrioide"
// para um caso de pulmão.
test('campo compartilhado leva a orientação de cada tumor, não a de um só', () => {
  TUMORS.schemaFields().forEach((campo) => {
    const usam = TUMORS.list().filter((t) => TUMORS.fieldsOf(t).some((f) => f.key === campo.key));
    if (usam.length < 2) return;

    const descricoes = usam.map((t) => TUMORS.fieldsOf(t).find((f) => f.key === campo.key).ai);
    const todasIguais = descricoes.every((d) => d === descricoes[0]);
    if (todasIguais) return; // uma descrição só já serve

    usam.forEach((t) => {
      assert.ok(
        campo.ai.includes(t.label),
        `"${campo.key}": a descrição enviada ao modelo não cobre ${t.label} — ele receberia a orientação de outro tumor`,
      );
    });
  });
});

test('o schema é enxuto o bastante para o modelo preencher', () => {
  // 39 propriedades, das quais 35 tinham de vir vazias, foi o que quebrou em
  // produção. O teto é folgado, mas impede a volta silenciosa daquele desenho.
  const n = TUMORS.schemaFields().length;
  assert.ok(n <= 25, `o schema tem ${n} campos; acima de 25 o preenchimento degrada`);
});

test('encaixarValor() aproxima grafia divergente em vez de descartar', () => {
  const opcoes = ['Metastático resistente à castração (mCRPC)', 'Localizado'];
  assert.strictEqual(TUMORS.encaixarValor('Metastático resistente à castração (mCRPC)', opcoes), opcoes[0]);
  assert.strictEqual(TUMORS.encaixarValor('metastatico resistente a castracao (mcrpc)', opcoes), opcoes[0]);
  assert.strictEqual(TUMORS.encaixarValor('mCRPC', opcoes), opcoes[0]);
  // Valor de outro subtipo: preserva o texto em vez de apagar o dado.
  assert.strictEqual(TUMORS.encaixarValor('Ressecável', opcoes), 'Ressecável');
  assert.strictEqual(TUMORS.encaixarValor('', opcoes), '');
});

test('acharTumorPorLabel() tolera espaço, caixa e acento', () => {
  ['Próstata', 'próstata', '  PRÓSTATA  ', 'Prostata'].forEach((entrada) => {
    const t = TUMORS.acharTumorPorLabel(entrada);
    assert.ok(t && t.id === 'prostata', `não reconheceu "${entrada}"`);
  });
  assert.strictEqual(TUMORS.acharTumorPorLabel('Melanoma'), null);
  assert.strictEqual(TUMORS.acharTumorPorLabel(''), null);
});

// A resposta que o modelo devolveu em produção quando o schema usava prefixo:
// campos comuns preenchidos, campos do tumor vazios. A normalização precisa
// aceitar tanto a chave simples quanto a antiga com prefixo.
test('normalizar() aceita chave simples E chave antiga com prefixo', () => {
  const simples = TUMORS.normalizar({
    tipo_tumor: 'Ginecológico - Ovário',
    histologia: 'Seroso', grau: 'Alto grau', estadiamento: 'IIIC', idade: '61',
  });
  assert.strictEqual(simples.histologia, 'Seroso');
  assert.strictEqual(simples.estadiamento, 'IIIC');

  const comPrefixo = TUMORS.normalizar({
    tipo_tumor: 'Ginecológico - Ovário',
    ovario__histologia: 'Seroso', ovario__grau: 'Alto grau', idade: '61',
  });
  assert.strictEqual(comPrefixo.histologia, 'Seroso');
  assert.strictEqual(comPrefixo.grau, 'Alto grau');
});

test('campos comuns aparecem uma única vez', () => {
  const chaves = TUMORS.schemaFields().map((f) => f.schemaKey);
  TUMORS.CHAVES_COMUNS.forEach((k) => {
    const n = chaves.filter((c) => c === k).length;
    assert.strictEqual(n, 1, `campo comum "${k}" aparece ${n} vezes`);
  });
});

test('todo campo do schema tem descrição para o modelo', () => {
  TUMORS.schemaFields().forEach((f) => {
    assert.ok(f.ai && f.ai.length > 20, `${f.schemaKey}: descrição ausente ou curta demais`);
  });
});

test('todo campo visível tem rótulo e, se for texto livre, exemplo', () => {
  TUMORS.list().forEach((tumor) => {
    tumor.fields.forEach((field) => {
      assert.ok(field.label, `${tumor.id}.${field.key}: sem rótulo`);
      if (!field.options) {
        assert.ok(field.placeholder, `${tumor.id}.${field.key}: campo livre sem exemplo`);
      }
    });
  });
});

// Este é o teste que pega renomeação de campo esquecida: intercepta a leitura
// do objeto de valores e cobra que toda chave lida exista de fato no tumor.
test('classify() e diagnosis() só leem campos que o tumor declara', () => {
  TUMORS.list().forEach((tumor) => {
    const declarados = new Set();
    TUMORS.fieldsOf(tumor).forEach((f) => declarados.add(f.key));

    const lidos = new Set();
    const espiao = new Proxy({}, {
      get(_alvo, chave) {
        if (typeof chave === 'string') lidos.add(chave);
        return '';
      },
      has() { return true; },
    });

    try { tumor.classify(espiao); } catch (e) { /* valores vazios podem cair em ramo curto */ }
    try { tumor.diagnosis(espiao); } catch (e) { /* idem */ }

    lidos.forEach((chave) => {
      if (chave.startsWith('Symbol(') || chave === 'then') return;
      assert.ok(
        declarados.has(chave),
        `${tumor.id}: lê "${chave}", que não está declarado nos campos do tumor`,
      );
    });
  });
});

test('normalizar() traz só os campos do tumor identificado', () => {
  const bruto = {
    tipo_tumor: 'Próstata',
    prostata__extensao_doenca: 'Metastático resistente à castração (mCRPC)',
    prostata__histologia: 'Adenocarcinoma acinar',
    mama__extensao_doenca: 'Metastático',
    ovario__histologia: 'Seroso',
    idade: '68',
  };
  const v = TUMORS.normalizar(bruto);

  assert.strictEqual(v.extensao_doenca, 'Metastático resistente à castração (mCRPC)');
  assert.strictEqual(v.histologia, 'Adenocarcinoma acinar');
  assert.strictEqual(v.idade, '68');
  assert.ok(!('mama__extensao_doenca' in v), 'vazou campo de outro tumor');
  assert.ok(!('prostata__histologia' in v), 'chave namespaced vazou para o navegador');
});

test('normalizar() sobrevive a subtipo não identificado', () => {
  const v = TUMORS.normalizar({ tipo_tumor: 'Não identificado', idade: '70' });
  assert.strictEqual(v.tipo_tumor, 'Não identificado');
  assert.strictEqual(v.idade, '70');
});

test('normalizar() sobrevive a resposta vazia ou malformada', () => {
  [null, undefined, {}, { tipo_tumor: null }].forEach((entrada) => {
    const v = TUMORS.normalizar(entrada);
    assert.strictEqual(typeof v, 'object');
    TUMORS.CHAVES_COMUNS.forEach((k) => assert.strictEqual(v[k], ''));
  });
});

// Todo valor declarado precisa ser aceito pela regra sem quebrar. Roda o
// produto cartesiano dos valores fechados de cada tumor.
test('toda combinação de valores fechados roda sem exceção', () => {
  TUMORS.list().forEach((tumor) => {
    const comLista = tumor.fields.filter((f) => f.options);
    const combinacoes = comLista.reduce(
      (acc, campo) => acc.flatMap((base) => [...campo.options, ''].map((v) => ({ ...base, [campo.key]: v }))),
      [{}],
    );

    combinacoes.forEach((valores) => {
      // preenche os campos livres com algo plausível para não cair sempre em "insuficiente"
      const completo = { ...valores };
      tumor.fields.forEach((f) => { if (!(f.key in completo)) completo[f.key] = f.options ? '' : 'x'; });

      let r;
      assert.doesNotThrow(() => { r = tumor.classify(completo); },
        `${tumor.id}: classify quebrou com ${JSON.stringify(valores)}`);
      assert.ok(r && r.state, `${tumor.id}: classify sem state em ${JSON.stringify(valores)}`);
      if (r.tests) {
        r.tests.forEach((t) => {
          assert.ok(t.id && t.name && t.kind, `${tumor.id}: teste incompleto em ${JSON.stringify(valores)}`);
          assert.ok(t.sample, `${tumor.id}/${t.id}: sem tipo de amostra (vai impresso na solicitação)`);
          assert.ok(t.justify, `${tumor.id}/${t.id}: sem justificativa clínica`);
          assert.ok(Array.isArray(t.programs) && t.programs.length, `${tumor.id}/${t.id}: sem programa de acesso`);
        });
      }
      assert.doesNotThrow(() => tumor.diagnosis(completo), `${tumor.id}: diagnosis quebrou`);
    });
  });
});

test('nenhum teste indicado repete id dentro do mesmo resultado', () => {
  // ids repetidos colidiriam no DOM (doc-<id>) e o botão de baixar PDF
  // pegaria o documento errado.
  TUMORS.list().forEach((tumor) => {
    tumor.fields.forEach((campo) => {
      (campo.options || ['']).forEach((valor) => {
        const v = {};
        tumor.fields.forEach((f) => { v[f.key] = f.options ? (f.options[f.options.length - 1] || '') : 'x'; });
        v[campo.key] = valor;
        const r = tumor.classify(v);
        const ids = (r.tests || []).map((t) => t.id);
        assert.strictEqual(new Set(ids).size, ids.length, `${tumor.id}: ids de teste repetidos (${ids})`);
      });
    });
  });
});

test('estados possíveis são só os que a tela sabe desenhar', () => {
  const conhecidos = new Set(['completo', 'provisorio', 'parcial', 'sem-indicacao', 'insuficiente', 'nao-reconhecida']);
  TUMORS.list().forEach((tumor) => {
    const v = {};
    tumor.fields.forEach((f) => { v[f.key] = ''; });
    const vazio = tumor.classify(v);
    assert.ok(conhecidos.has(vazio.state), `${tumor.id}: estado desconhecido "${vazio.state}"`);
    // caso vazio precisa explicar o que falta, senão a tela mostra "-"
    if (vazio.state === 'insuficiente') {
      assert.ok(vazio.message && vazio.message.length > 20, `${tumor.id}: estado insuficiente sem explicação`);
    }
  });
});

test('todo programa de acesso tem nome e observação; url quando existe é http(s)', () => {
  TUMORS.list().forEach((tumor) => {
    const v = {};
    tumor.fields.forEach((f) => { v[f.key] = f.options ? f.options[f.options.length - 1] : 'Adenocarcinoma'; });
    const r = tumor.classify(v);
    (r.tests || []).forEach((t) => {
      t.programs.forEach((p) => {
        assert.ok(p.name, `${tumor.id}/${t.id}: programa sem nome`);
        assert.ok(p.note, `${tumor.id}/${t.id}: programa sem observação`);
        if (p.url) assert.match(p.url, /^https?:\/\//, `${tumor.id}/${t.id}: url inválida (${p.url})`);
      });
    });
  });
});
