// Fotografa a tela de programas (caso de ovário) como está e com as decisões
// do dono aplicadas, em duas variantes para o critério de elegibilidade:
//   P1: critério continua à vista (só nos programas que o registro marca com
//       `destaques`, isto é, com critério que recusa o paciente);
//   P2: critério recolhido num toque ("Ver critério de elegibilidade").
// Nos dois: sai o texto descritivo de cada programa, sai "Via conferida em",
// sai "Laboratório parceiro" (selo e trecho do nome).
// Uso: node mockup/resultado-propostas/programas.js <pasta> <url>
const path = require('path');
const SERVER = path.join(__dirname, '..', '..', 'server');
const { chromium, devices } = require(path.join(SERVER, 'node_modules', 'playwright'));
const TUMORS = require(path.join(SERVER, 'public', 'tumors.js'));
const [OUT, BASE] = process.argv.slice(2);
const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const CASO = { histologia: 'Carcinoma seroso', grau: 'Alto grau', estadiamento: 'IVC', idade: '61' };

let sessao;
async function abrir(b, opts) {
  const ctx = await b.newContext({ ...opts, reducedMotion: 'reduce', storageState: sessao });
  const p = await ctx.newPage();
  await p.route('**/api/extract', (r) => r.fulfill({ status: 200, contentType: 'application/json',
    body: JSON.stringify({ extracted: TUMORS.normalizar({ tipo_tumor: 'Ginecológico - Ovário', tipo_tumor_justificativa: 'x', fontes_usadas: ['t'], ...CASO }), avisos: [] }) }));
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
  await p.evaluate(() => { window.runTriage(); window.goTo(3); });
  await p.waitForTimeout(600);
  await p.addStyleTag({ content: '.gena { display: none !important; }' });
  return { p, ctx };
}

async function aplicar(p, variante) {
  await p.addStyleTag({ content: `
    .prog-criterio > summary { list-style: none; cursor: pointer; display: inline-flex; align-items: center; gap: 4px;
      min-height: var(--toque); font-size: var(--fs-xs); font-weight: 600; color: var(--accent); }
    .prog-criterio > summary::-webkit-details-marker { display: none; }
    .prog-criterio > summary svg { width: 14px; height: 14px; }
    .prog-criterio .test { margin-top: 0; }` });
  await p.evaluate((variante) => {
    const CHEV = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>';
    document.querySelectorAll('.program-row').forEach((row) => {
      row.querySelectorAll('.prog-verif').forEach((e) => e.remove());
      const nome = row.querySelector('.name');
      nome.querySelectorAll('.selo.neutro').forEach((e) => e.remove());
      nome.firstChild.textContent = nome.firstChild.textContent.replace(/\s*\(laboratório parceiro de oncogenética\)/, '');
      const temCriterio = !!row.querySelector('mark.marca-criterio');
      const blocos = row.querySelectorAll('.who > div > .test, .who > div > .prog-nota');
      if (!temCriterio) { blocos.forEach((e) => e.remove()); return; }
      if (variante === 'P2') {
        const texto = Array.from(blocos).map((e) => e.innerHTML
          .replace(/<summary>|<\/summary>/g, '').replace(/<div class="test">|<\/div>/g, ' ')).join(' ');
        blocos.forEach((e) => e.remove());
        const d = document.createElement('details');
        d.className = 'prog-criterio';
        d.innerHTML = `<summary>Ver critério de elegibilidade ${CHEV}</summary><div class="test">${texto}</div>`;
        nome.parentElement.appendChild(d);
      }
    });
  }, variante);
}

async function foto(p, arquivo) {
  await p.mouse.move(0, 0);
  const fim = await p.evaluate(() => {
    const c = document.querySelectorAll('#programs-dynamic .program-card');
    return Math.ceil(c[c.length - 1].getBoundingClientRect().bottom + window.scrollY + 24);
  });
  await p.screenshot({ path: path.join(OUT, arquivo), fullPage: true, clip: { x: 0, y: 0, width: p.viewportSize().width, height: fim } });
}

(async () => {
  const b = await chromium.launch({ executablePath: CHROME });
  const aparelhos = { celular: devices['iPhone 13'], computador: { viewport: { width: 1280, height: 900 }, deviceScaleFactor: 2 } };
  for (const [nome, opts] of Object.entries(aparelhos)) {
    // §89: P1 e P2 ficaram só como registro da proposta; o dono decidiu
    // tirar todo critério da tela, então só a tela real é fotografada.
    for (const v of (process.env.VARIANTES || 'hoje').split(',')) {
      const { p, ctx } = await abrir(b, opts);
      if (v !== 'hoje') await aplicar(p, v);
      await foto(p, `programas-${v}-${nome}.png`);
      if (v === 'P2' && nome === 'celular') {
        await p.locator('.prog-criterio > summary').first().click();
        await foto(p, `programas-P2-${nome}-aberto.png`);
      }
      await ctx.close();
    }
  }
  await b.close();
})().catch((e) => { console.error(e); process.exit(1); });
