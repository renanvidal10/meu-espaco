// Medição de contraste WCAG contra o produto rodando, nos dois temas.
//
// Existe porque a auditoria de acessibilidade encontrou 56 combinações
// reprovadas e o card do veredito clínico — a resposta central do produto —
// media 1,88:1 no tema escuro. Um número desses não pode voltar sem ninguém
// perceber, então a verificação vira parte da bateria em vez de ficar num
// relatório.
//
// As cores vêm de getComputedStyle, com composição das camadas semitransparentes
// até achar o fundo efetivo. Nada aqui é estimado.

const path = require('path');
const { arquivoDeDadosTemporario } = require('./temporario.js');
const fs = require('fs');
const { execFileSync } = require('child_process');

function carregarPlaywright() {
  try {
    return require('playwright');
  } catch (err) {
    if (err.code !== 'MODULE_NOT_FOUND') throw err;
  }
  const raizGlobal = execFileSync('npm', ['root', '-g'], { encoding: 'utf8' }).trim();
  return require(path.join(raizGlobal, 'playwright'));
}

const { chromium } = carregarPlaywright();

// AA: 4,5:1 para texto normal, 3:1 para texto grande (>=18,66px, ou >=14px em
// negrito) e para o limite visual de componentes de UI.
const ALVOS = [
  { seletor: '#verdict-title', minimo: 3, nota: 'titulo do veredito clinico' },
  { seletor: '#verdict-text', minimo: 4.5, nota: 'texto do veredito clinico' },
  { seletor: '#verdict-glyph', minimo: 3, nota: 'glifo do veredito' },
  { seletor: '.gate-aside h2', minimo: 3, nota: 'titulo do painel de acesso' },
  { seletor: '.gate-aside > p', minimo: 4.5, nota: 'texto do painel de acesso' },
  { seletor: '.gate-points li', minimo: 4.5, nota: 'lista do painel de acesso' },
  { seletor: '.gate-aside-foot', minimo: 4.5, nota: 'rodape do painel de acesso' },
  { seletor: '.field label', minimo: 4.5, nota: 'rotulo de campo (--ink-faint)' },
  { seletor: '.eyebrow', minimo: 4.5, nota: 'sobretitulo (--ink-faint)' },
  { seletor: '.doc-preview .doc-row .k', minimo: 4.5, nota: 'rotulo do documento' },
];

function paraRgb(css) {
  const m = String(css).match(/rgba?\(([^)]+)\)/);
  if (!m) return null;
  const p = m[1].split(',').map((v) => parseFloat(v.trim()));
  return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 };
}

function sobrepor(frente, fundo) {
  const a = frente.a;
  return {
    r: a * frente.r + (1 - a) * fundo.r,
    g: a * frente.g + (1 - a) * fundo.g,
    b: a * frente.b + (1 - a) * fundo.b,
    a: 1,
  };
}

function luminancia(c) {
  const f = (v) => {
    const x = v / 255;
    return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b);
}

function contraste(a, b) {
  const l1 = luminancia(a);
  const l2 = luminancia(b);
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
}

// Sobe a árvore acumulando as camadas de fundo até achar uma opaca, para que
// o fundo efetivo de um texto sobre superfície semitransparente seja o real.
function coletar(sel) {
  const el = document.querySelector(sel);
  if (!el) return null;
  const cs = getComputedStyle(el);
  const camadas = [];
  let no = el;
  while (no) {
    const bg = getComputedStyle(no).backgroundColor;
    const m = String(bg).match(/rgba?\(([^)]+)\)/);
    if (m) {
      const p = m[1].split(',').map((v) => parseFloat(v.trim()));
      const a = p.length > 3 ? p[3] : 1;
      if (a > 0) camadas.push(bg);
      if (a === 1) break;
    }
    no = no.parentElement;
  }
  return { cor: cs.color, tamanho: cs.fontSize, peso: cs.fontWeight, camadas };
}

async function medirTema(pagina, tema, entrar) {
  await pagina.emulateMedia({ colorScheme: tema === 'dark' ? 'dark' : 'light' });
  await pagina.evaluate((t) => document.documentElement.setAttribute('data-theme', t), tema);
  await pagina.waitForTimeout(120);

  const resultados = [];
  for (const alvo of ALVOS) {
    const dados = await pagina.evaluate(coletar, alvo.seletor);
    if (!dados) continue;

    let fundo = { r: 255, g: 255, b: 255, a: 1 };
    for (let i = dados.camadas.length - 1; i >= 0; i--) {
      const c = paraRgb(dados.camadas[i]);
      if (c) fundo = c.a === 1 ? c : sobrepor(c, fundo);
    }
    const cor = paraRgb(dados.cor);
    if (!cor) continue;
    const frente = cor.a === 1 ? cor : sobrepor(cor, fundo);

    const razao = contraste(frente, fundo);
    resultados.push({
      seletor: alvo.seletor,
      nota: alvo.nota,
      tema,
      razao,
      minimo: alvo.minimo,
      passou: razao >= alvo.minimo,
    });
  }
  return resultados;
}

module.exports = { medirTema, contraste, paraRgb, sobrepor, ALVOS };

// Execução direta: sobe o servidor, percorre até a tela de resultado e mede.
if (require.main === module) {
  (async () => {
    const { criarStub } = require('./stub-anthropic.js');
    const os = require('os');
    const stub = criarStub();
    const portaStub = await stub.ouvir(0);
    const porta = 6100 + Math.floor(Math.random() * 200);
    const base = `http://127.0.0.1:${porta}`;

    const servidor = require('child_process').spawn(
      process.execPath,
      [path.join(__dirname, '..', 'index.js')],
      {
        env: {
          ...process.env,
          PORT: String(porta),
          NODE_ENV: 'test',
          DATA_FILE: arquivoDeDadosTemporario('cor'),
          ANTHROPIC_API_KEY: 'chave-de-teste',
          ANTHROPIC_BASE_URL: `http://127.0.0.1:${portaStub}`,
          DATABASE_URL: '', RESEND_API_KEY: '', APP_ORIGIN: '',
        },
        stdio: ['ignore', 'ignore', 'pipe'],
      },
    );

    for (let i = 0; i < 100; i++) {
      try { if ((await fetch(base + '/api/health')).ok) break; } catch { /* subindo */ }
      await new Promise((r) => setTimeout(r, 200));
    }

    const navegador = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
    const contexto = await navegador.newContext({ viewport: { width: 1280, height: 900 } });
    const pagina = await contexto.newPage();

    const todos = [];
    // Tela de acesso primeiro: os alvos do painel lateral só existem aqui.
    await pagina.goto(base);
    await pagina.waitForTimeout(500);
    for (const tema of ['light', 'dark']) todos.push(...await medirTema(pagina, tema));

    // Depois entra e roda a triagem, para alcançar o card do veredito.
    stub.responderCom({
      tipo: 'ok',
      extracao: {
        tipo_tumor: 'Ginecológico - Ovário',
        histologia: 'Seroso', grau: 'Alto grau', estadiamento: 'IIIC', idade: '61',
      },
    }, 1);
    if (await pagina.locator('#acesso-name').isVisible()) {
      await pagina.fill('#acesso-name', 'Renan Vidal');
      await pagina.fill('#acesso-crm', '339324');
      await pagina.click('#acesso-submit');
    }
    await pagina.waitForSelector('body:not(.gate-active)');
    if (await pagina.locator('#boas-vindas.aberto').count()) await pagina.click('#bv-comecar');
    await pagina.fill('#case-text', 'Mulher 61 anos, carcinoma seroso de alto grau de ovario, FIGO IIIC.');
    await pagina.click('#btn-extract');
    await pagina.waitForTimeout(1500);
    const seguir = pagina.locator('#btn-to-result');
    if (await seguir.count()) { await seguir.click(); await pagina.waitForTimeout(600); }

    for (const tema of ['light', 'dark']) todos.push(...await medirTema(pagina, tema));

    await navegador.close();
    servidor.kill('SIGTERM');
    if (stub.fechar) await stub.fechar();

    const reprovados = todos.filter((r) => !r.passou);
    const vistos = new Set();
    for (const r of todos) {
      const chave = r.tema + r.seletor;
      if (vistos.has(chave)) continue;
      vistos.add(chave);
      console.log(
        `${r.passou ? '  ✓ ' : '  ✗ '}[${r.tema.padEnd(5)}] ${r.seletor.padEnd(26)} ${r.razao.toFixed(2)}:1 (mín ${r.minimo}) — ${r.nota}`,
      );
    }
    console.log('');
    if (reprovados.length) {
      console.log(`REPROVARAM: ${reprovados.length}`);
      process.exit(1);
    }
    console.log(`Contraste WCAG AA: ${vistos.size} medições, todas aprovadas, nos dois temas.`);
    process.exit(0);
  })();
}
