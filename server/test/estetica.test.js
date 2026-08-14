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
  // Descrição do teste e resumo do veredito são o que o médico lê para decidir
  // qual exame pedir. Estavam em 12px. Se alguém os reduzir de novo, isto quebra.
  for (const seletor of ['.test-step p', '.verdict p']) {
    const regra = new RegExp(`\\${seletor}\\s*\\{[^}]*\\}`);
    const achado = HTML.match(regra);
    assert.ok(achado, `regra de ${seletor} sumiu`);
    assert.match(achado[0], /font-size:\s*var\(--fs-sm\)/,
      `${seletor} precisa ficar no corpo (--fs-sm), veio: ${achado[0]}`);
  }
});

test('o alvo mínimo de toque está declarado em 44px', () => {
  assert.match(HTML, /--toque:\s*44px/, 'o piso de 44px do alvo de toque sumiu');
});
