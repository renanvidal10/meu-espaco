'use strict';

// Regra de escrita do dono (ARQUITETURA.md §84): nenhum travessão ou hífen como
// pontuação em texto do produto. Este teste falha no primeiro "—", "–" ou " - "
// que voltar nos três arquivos que montam o que o médico lê.
//
// O que NÃO é pontuação e continua valendo: hífen dentro de palavra
// (imuno-histoquímica), siglas (PD-L1), intervalos numéricos e subtração no
// código (a - b). Por isso o " - " só é procurado dentro de comentários,
// strings e HTML, nunca no código solto, e só entre letras.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const PUBLIC = path.join(__dirname, '..', 'public');
// §85: os textos do login (e-mails, mensagens de senha e de sessão) também
// chegam ao médico, e os módulos novos nasceram limpos.
const ARQUIVOS = ['tumors.js', 'app.js', 'index.html',
  '../email.js', '../auth.js', '../cifra.js', '../store.js', '../ia.js'];

// Identificadores de tipo de tumor: são chaves de dados trocadas com o servidor,
// com a IA e com os testes, não texto de leitura. Renomear exige migração à
// parte, então ficam fora da regra, e só estes.
const IDENTIFICADORES = [
  'Ginecológico - Ovário',
  'Ginecológico - Endométrio',
  'Pulmão - não pequenas células',
];

const ENTRE_LETRAS = /[A-Za-zÀ-ÿ"')\]] - [A-Za-zÀ-ÿ"'(\[]/g;

// Devolve os trechos de um arquivo JS que são texto: comentários, strings e a
// parte fixa de templates (o que fica dentro de ${ } é código e é ignorado).
function trechosDeTexto(src) {
  const out = [];
  const n = src.length;
  const pilha = [];
  let modo = 'code';
  let chaves = 0;
  let i = 0;
  let ini = 0;
  while (i < n) {
    const c = src[i];
    const d = src[i + 1];
    if (modo === 'code') {
      if (c === '/' && d === '/') {
        const f = src.indexOf('\n', i);
        const e = f < 0 ? n : f;
        out.push(src.slice(i, e));
        i = e;
        continue;
      }
      if (c === '/' && d === '*') {
        const e = src.indexOf('*/', i + 2) + 2;
        out.push(src.slice(i, e));
        i = e;
        continue;
      }
      if (c === "'" || c === '"') {
        const q = c;
        const a = i + 1;
        i++;
        while (i < n && src[i] !== q) {
          if (src[i] === '\\') i++;
          i++;
        }
        out.push(src.slice(a, i));
        i++;
        continue;
      }
      if (c === '`') {
        modo = 'tpl';
        ini = i + 1;
        i++;
        continue;
      }
      if (c === '/') {
        let j = i - 1;
        while (j >= 0 && /\s/.test(src[j])) j--;
        if (j < 0 || /[(,=:\[!&|?{};]/.test(src[j]) || /return$/.test(src.slice(Math.max(0, j - 5), j + 1))) {
          i++;
          let classe = false;
          while (i < n && (src[i] !== '/' || classe)) {
            if (src[i] === '\\') i++;
            else if (src[i] === '[') classe = true;
            else if (src[i] === ']') classe = false;
            i++;
          }
          i++;
          continue;
        }
      }
      if (c === '{') chaves++;
      if (c === '}') {
        if (pilha.length && chaves === pilha[pilha.length - 1]) {
          pilha.pop();
          chaves--;
          modo = 'tpl';
          ini = i + 1;
          i++;
          continue;
        }
        chaves--;
      }
      i++;
      continue;
    }
    // dentro de template
    if (c === '\\') { i += 2; continue; }
    if (c === '`') {
      out.push(src.slice(ini, i));
      modo = 'code';
      i++;
      continue;
    }
    if (c === '$' && d === '{') {
      out.push(src.slice(ini, i));
      chaves++;
      pilha.push(chaves);
      modo = 'code';
      i += 2;
      continue;
    }
    i++;
  }
  return out;
}

function textoDe(arquivo) {
  const src = fs.readFileSync(path.join(PUBLIC, arquivo), 'utf8');
  return arquivo.endsWith('.js') ? trechosDeTexto(src).join('\n') : src;
}

function semIdentificadores(texto) {
  return IDENTIFICADORES.reduce((t, id) => t.split(id).join(''), texto);
}

for (const arquivo of ARQUIVOS) {
  test(`${arquivo}: nenhum travessão (— ou –)`, () => {
    const src = fs.readFileSync(path.join(PUBLIC, arquivo), 'utf8');
    const linhas = src.split('\n')
      .map((l, i) => [i + 1, l])
      .filter(([, l]) => /[–—]/.test(l))
      .map(([n, l]) => `linha ${n}: ${l.trim().slice(0, 90)}`);
    assert.deepStrictEqual(linhas, [],
      'ARQUITETURA.md §84: reescreva com dois-pontos, vírgula, ponto ou parênteses');
  });

  test(`${arquivo}: nenhum " - " usado como pontuação em texto`, () => {
    const texto = semIdentificadores(textoDe(arquivo));
    const achados = texto.split('\n')
      .filter((l) => { ENTRE_LETRAS.lastIndex = 0; return ENTRE_LETRAS.test(l); })
      .map((l) => l.trim().slice(0, 90));
    assert.deepStrictEqual(achados, [],
      'ARQUITETURA.md §84: " - " como pontuação é proibido; hífen de palavra (imuno-histoquímica) continua valendo');
  });
}

test('o detector enxerga as violações (o teste não é cego)', () => {
  const amostra = "const a = 'um texto — com travessão'; // e - outro\nconst b = x - y;";
  const trechos = trechosDeTexto(amostra).join('\n');
  ENTRE_LETRAS.lastIndex = 0;
  assert.ok(/—/.test(trechos), 'deveria achar o travessão na string');
  ENTRE_LETRAS.lastIndex = 0;
  assert.ok(ENTRE_LETRAS.test(trechos), 'deveria achar o " - " no comentário');
  assert.ok(!/x - y/.test(trechos), 'subtração no código não deve ser lida como texto');
});
