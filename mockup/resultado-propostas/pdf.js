// Gera o PDF do pedido assinável exatamente como o navegador imprime, e uma
// imagem da primeira folha para mostrar ao dono.
// Uso: node mockup/resultado-propostas/pdf.js <pasta> <url> [nome-do-arquivo]
const path = require('path');
const SERVER = path.join(__dirname, '..', '..', 'server');
const { chromium } = require(path.join(SERVER, 'node_modules', 'playwright'));
const TUMORS = require(path.join(SERVER, 'public', 'tumors.js'));
const [OUT, BASE, NOME = 'pedido'] = process.argv.slice(2);
const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const CASO = { histologia: 'Carcinoma seroso', grau: 'Alto grau', estadiamento: 'IVC', idade: '61' };

(async () => {
  const b = await chromium.launch({ executablePath: CHROME });
  const ctx = await b.newContext({ viewport: { width: 1280, height: 900 } });
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
  if (await p.locator('#boas-vindas.aberto').count()) { await p.click('#bv-comecar'); await p.waitForTimeout(400); }
  await p.fill('#case-text', 'mulher 61a, seroso alto grau IVC');
  await p.click('#btn-extract');
  await p.waitForTimeout(1200);
  await p.evaluate(() => { window.runTriage(); window.goTo(3); });
  await p.fill('#patient-name', 'Maria Aparecida dos Santos Oliveira');
  await p.dispatchEvent('#patient-name', 'input');
  // Mesmo estado que o botão "Baixar PDF" monta antes de chamar print().
  await p.evaluate(() => {
    const alvo = document.querySelector('#programs-dynamic details.doc-preview-wrap');
    alvo.open = true;
    alvo.classList.add('print-target');
    document.body.classList.add('printing');
  });
  const arquivo = path.join(OUT, `${NOME}.pdf`);
  await p.pdf({ path: arquivo, format: 'A4', printBackground: true, preferCSSPageSize: true });
  await b.close();
  console.log(arquivo);
})().catch((e) => { console.error(e); process.exit(1); });
