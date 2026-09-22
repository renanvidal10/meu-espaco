'use strict';

// A escala visual só se mantém se for verificada. Antes desta trava havia 20
// tamanhos de fonte e 13 raios de arredondamento diferentes no arquivo — não
// por decisão, mas por acúmulo: cada tela nova trazia o seu valor. Este teste
// falha no primeiro valor solto que voltar. Ver ARQUITETURA.md §43.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const HTML = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');

test('nenhum tamanho de fonte solto: tudo passa pela escala', () => {
  const soltos = HTML.match(/font-size:\s*[0-9.]+(px|rem|em)/g) || [];
  assert.deepStrictEqual(soltos, [],
    `use um token --fs-* em vez de valor cru: ${soltos.join(', ')}`);
});

test('nenhum raio de arredondamento solto: tudo passa pela escala', () => {
  // % continua valendo para círculo (avatar), que não é um degrau de escala.
  const soltos = HTML.match(/border-radius:\s*[0-9.]+(px|rem|em)/g) || [];
  assert.deepStrictEqual(soltos, [],
    `use um token --r-* em vez de valor cru: ${soltos.join(', ')}`);
});

test('a escala tem os degraus que a interface usa, e nada além', () => {
  const fs_ = (HTML.match(/--fs-[a-z0-9]+:/g) || []).map((t) => t.replace(':', ''));
  assert.deepStrictEqual(fs_.sort(), ['--fs-2xs', '--fs-lg', '--fs-md', '--fs-sm', '--fs-xl', '--fs-xs'],
    'a escala tipográfica mudou de degraus');
  const raios = (HTML.match(/--r-[a-z]+:/g) || []).map((t) => t.replace(':', ''));
  assert.deepStrictEqual(raios.sort(), ['--r-full', '--r-lg', '--r-md', '--r-sm', '--r-xs'],
    'a escala de arredondamento mudou de degraus');
});

test('o texto clínico não pode encolher abaixo do corpo', () => {
  // A descrição do teste é o que o médico lê para decidir qual exame pedir.
  // Estava em 12px. Se alguém a reduzir de novo, isto quebra.
  const desc = HTML.match(/\.test-step p\s*\{[^}]*\}/);
  assert.ok(desc, 'regra de .test-step p sumiu');
  assert.match(desc[0], /font-size:\s*var\(--fs-sm\)/,
    `.test-step p precisa ficar no corpo (--fs-sm), veio: ${desc[0]}`);

  // O resumo do veredito mudou de papel: deixou de ser bloco isolado de 16px e
  // passou a ser a linha de apoio de um título de 22px. Quem carrega o peso
  // agora é o título — então é ELE que esta trava vigia. O resumo não pode
  // cair abaixo de --fs-xs, e o título não pode encolher de novo para o
  // tamanho do rodapé, que era o defeito original. Ver §45.
  const resumo = HTML.match(/\.verdict p\s*\{[^}]*\}/);
  assert.ok(resumo, 'regra de .verdict p sumiu');
  assert.match(resumo[0], /font-size:\s*var\(--fs-(xs|sm|md)\)/,
    `o resumo do veredito encolheu demais: ${resumo[0]}`);

  const titulo = HTML.match(/\.verdict h2\s*\{[^}]*\}/);
  assert.ok(titulo, 'regra de .verdict h2 sumiu');
  assert.match(titulo[0], /font-size:\s*var\(--fs-(lg|xl)\)/,
    `o veredito precisa dominar a tela, veio: ${titulo[0]}`);
});

test('o alvo mínimo de toque está declarado em 44px', () => {
  assert.match(HTML, /--toque:\s*44px/, 'o piso de 44px do alvo de toque sumiu');
});
