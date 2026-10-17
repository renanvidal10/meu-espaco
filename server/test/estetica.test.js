'use strict';

// A escala visual só se mantém se for verificada. Antes desta trava havia 20
// tamanhos de fonte e 13 raios de arredondamento diferentes no arquivo — não
// por decisão, mas por acúmulo: cada tela nova trazia o seu valor. Este teste
// falha no primeiro valor solto que voltar. Ver ARQUITETURA.md §43.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

// O estilo saiu do index.html para app.css (§52). A trava acompanha o arquivo,
// e continua lendo o HTML para o caso de alguém reintroduzir estilo inline.
const CSS = fs.readFileSync(path.join(__dirname, '..', 'public', 'app.css'), 'utf8');
const MARCACAO = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
const HTML = CSS + '\n' + MARCACAO;

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

// §54. O index.html era um arquivo único; ao separá-lo, app.js passou a ser
// carregado SÓ pelo navegador — e nenhum teste de unidade o lê como código,
// apenas como texto. Uma chave órfã deixada numa reescrita derrubou o app
// inteiro na primeira linha, e a bateria de unidade seguiu verde: 248 testes
// passando sobre um aplicativo que não abria. A bateria de navegador pegou,
// mas ela é lenta e nem sempre roda. Esta trava custa milissegundos.
test('o JavaScript do navegador compila', () => {
  const { execFileSync } = require('child_process');
  const alvos = ['app.js', 'tumors.js', 'sw.js'];
  for (const nome of alvos) {
    const caminho = path.join(__dirname, '..', 'public', nome);
    if (!fs.existsSync(caminho)) continue;
    try {
      execFileSync(process.execPath, ['--check', caminho], { stdio: 'pipe' });
    } catch (e) {
      assert.fail(`${nome} não compila:\n${String(e.stderr || e.message)}`);
    }
  }
});

// A marcação e a lógica combinam por nome de id. Se um lado renomeia e o outro
// não, o conteúdo simplesmente não aparece — sem erro, sem aviso. Os ids abaixo
// são os que carregam decisão clínica.
test('os contêineres que a lógica procura existem na marcação', () => {
  for (const id of ['verdict-notes-acao', 'verdict-notes', 'test-steps', 'programs-dynamic']) {
    assert.ok(MARCACAO.includes(`id="${id}"`), `index.html não tem id="${id}"`);
  }
});

/* §60. A lista fixa acima não bastou. Ao remover o ladrilho "Texto" da tela de
 * entrada, duas chamadas a getElementById('tile-text') ficaram órfãs em
 * app.js. A primeira estava DENTRO de clearIntake(), antes da linha que apaga
 * o nome do paciente: a função morria no meio e o nome sobrevivia ao "Iniciar
 * novo caso" — exatamente o vazamento do §46.1, de volta por outro caminho.
 *
 * Só a bateria de navegador pegou, e por sorte: existia um teste específico
 * para aquele vazamento. Um elemento menos sortudo teria passado.
 *
 * Esta trava é geral: TODO getElementById('x') literal em app.js precisa de um
 * id="x" em algum lugar — na marcação ou nos modelos que o próprio app.js
 * gera. Custa milissegundos e cobre a classe inteira do problema. */
const LOGICA = fs.readFileSync(path.join(__dirname, '..', 'public', 'app.js'), 'utf8');

test('nenhum getElementById aponta para id que não existe', () => {
  const procurados = new Set();
  for (const m of LOGICA.matchAll(/getElementById\(\s*'([^']+)'\s*\)/g)) procurados.add(m[1]);
  assert.ok(procurados.size > 20, `só ${procurados.size} ids encontrados — a varredura não está lendo o arquivo`);

  // Ids podem nascer na marcação OU nos modelos que app.js monta.
  const declarados = new Set();
  for (const fonte of [MARCACAO, LOGICA]) {
    for (const m of fonte.matchAll(/id="([^"]+)"/g)) declarados.add(m[1]);
    // Modelo com interpolação: id="doc-${...}" vira prefixo.
    for (const m of fonte.matchAll(/id="([^"$]*)\$\{/g)) declarados.add(m[1] + '*');
    // Elemento criado em JS recebe o id por atribuição, não por atributo:
    // `wrap.id = 'gena-typing'`. Sem esta linha a varredura acusa como órfão
    // um id que existe — e um falso positivo treina quem lê a ignorar.
    for (const m of fonte.matchAll(/\.id\s*=\s*'([^']+)'/g)) declarados.add(m[1]);
  }
  const prefixos = [...declarados].filter((d) => d.endsWith('*')).map((d) => d.slice(0, -1));

  const orfaos = [...procurados].filter((id) =>
    !declarados.has(id) && !prefixos.some((pre) => pre && id.startsWith(pre)));

  assert.deepStrictEqual(orfaos, [],
    `app.js procura id(s) que não existem: ${orfaos.join(', ')}`);
});
