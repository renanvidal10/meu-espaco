// Fotografa a tela de resultado JÁ implementada (proposta B), sem injeção:
// celular e computador, claro e escuro, fechada e com o primeiro teste aberto,
// mais um caso de endométrio dMMR (nota de ação dentro do painel) e um caso
// com dados insuficientes.
// Uso: node mockup/resultado-propostas/final.js <pasta> <url>
const path = require('path');
const SERVER = path.join(__dirname, '..', '..', 'server');
const { chromium, devices } = require(path.join(SERVER, 'node_modules', 'playwright'));
const TUMORS = require(path.join(SERVER, 'public', 'tumors.js'));
const [OUT, BASE] = process.argv.slice(2);
const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

const CASOS = {
  ovario: { tipo_tumor: 'Ginecológico - Ovário', histologia: 'Carcinoma seroso', grau: 'Alto grau', estadiamento: 'IVC', idade: '61' },
  endometrio: { tipo_tumor: 'Ginecológico - Endométrio', histologia: 'Endometrioide', estadiamento: 'IA', mmr_msi: 'dMMR / MSI-alto', idade: '58' },
  insuficiente: { tipo_tumor: 'Ginecológico - Ovário', idade: '61' },
};

let sessao;
async function abrir(b, opts, tema, caso) {
  const ctx = await b.newContext({ ...opts, reducedMotion: 'reduce', colorScheme: tema, storageState: sessao });
  const p = await ctx.newPage();
  await p.route('**/api/extract', (r) => r.fulfill({ status: 200, contentType: 'application/json',
    body: JSON.stringify({ extracted: TUMORS.normalizar({ tipo_tumor_justificativa: 'x', fontes_usadas: ['t'], ...CASOS[caso] }), avisos: [] }) }));
  await p.goto(BASE);
  await p.waitForTimeout(500);
  if (await p.locator('#acesso-name').isVisible()) {
    await p.fill('#acesso-name', 'Renan Vidal');
    await p.fill('#acesso-crm', '339324');
    await p.click('#acesso-submit');
  }
  await p.waitForSelector('body:not(.gate-active)');
  if (!sessao) sessao = await ctx.storageState();
  if (await p.locator('#boas-vindas.aberto').count()) { await p.click('#bv-comecar'); await p.waitForTimeout(400); }
  await p.fill('#case-text', 'caso');
  await p.click('#btn-extract');
  await p.waitForTimeout(1200);
  await p.evaluate(() => window.runTriage());
  await p.waitForTimeout(600);
  await p.addStyleTag({ content: '.gena { display: none !important; }' });
  return { p, ctx };
}

async function foto(p, arquivo) {
  await p.mouse.move(0, 0);
  const fim = await p.evaluate(() => Math.ceil(document.getElementById('resultado-painel').getBoundingClientRect().bottom + window.scrollY + 28));
  await p.screenshot({ path: path.join(OUT, arquivo), fullPage: true, clip: { x: 0, y: 0, width: p.viewportSize().width, height: fim } });
}

(async () => {
  const b = await chromium.launch({ executablePath: CHROME });
  const ap = { celular: devices['iPhone 13'], computador: { viewport: { width: 1280, height: 900 }, deviceScaleFactor: 2 } };
  const lista = [
    ['celular', 'light', 'ovario', false], ['celular', 'light', 'ovario', true], ['celular', 'dark', 'ovario', false],
    ['computador', 'light', 'ovario', false], ['computador', 'light', 'ovario', true],
    ['celular', 'light', 'endometrio', false], ['celular', 'light', 'insuficiente', false],
  ];
  for (const [aparelho, tema, caso, aberto] of lista) {
    const { p, ctx } = await abrir(b, ap[aparelho], tema, caso);
    if (aberto) await p.locator('#test-steps .test-step > summary').first().click();
    await foto(p, `B-final-${caso}-${aparelho}${tema === 'dark' ? '-escuro' : ''}${aberto ? '-aberto' : ''}.png`);
    await ctx.close();
  }
  await b.close();
})().catch((e) => { console.error(e); process.exit(1); });
