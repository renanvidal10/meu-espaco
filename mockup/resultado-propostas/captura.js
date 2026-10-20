// Fotografa a tela "Resultado da triagem" do app real com cada proposta
// injetada no lugar do bloco atual (veredito + "O que solicitar").
//
// Uso: node mockup/resultado-propostas/captura.js <pasta-de-saida> <url-do-app>
// O app precisa estar rodando localmente (npm start em server/).
const path = require('path');
const SERVER = path.join(__dirname, '..', '..', 'server');
const { chromium, devices } = require(path.join(SERVER, 'node_modules', 'playwright'));
const TUMORS = require(path.join(SERVER, 'public', 'tumors.js'));
const PROPOSTAS = require('./propostas.js');
const [OUT, BASE] = process.argv.slice(2);
const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

const CASO = { histologia: 'Carcinoma seroso', grau: 'Alto grau', estadiamento: 'IVC', idade: '61' };

function resultadoDoMotor() {
  const t = TUMORS.get('ovario');
  const v = {};
  t.fields.forEach((f) => { v[f.key] = ''; });
  return t.classify(Object.assign(v, CASO));
}

// Entra uma vez só e reaproveita a sessão: o servidor limita tentativas de
// acesso, e entrar a cada foto esbarra nesse limite.
let sessao;
async function abrirResultado(b, ctxOpts, tema) {
  const ctx = await b.newContext({ ...ctxOpts, reducedMotion: 'reduce', colorScheme: tema, storageState: sessao });
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
  await p.fill('#case-text', 'mulher 61a, seroso alto grau IVC');
  await p.click('#btn-extract');
  await p.waitForTimeout(1200);
  await p.evaluate(() => window.runTriage());
  await p.waitForTimeout(800);
  // O botão flutuante da Gena fica fora da foto: ele é fixo e cobre texto
  // em qualquer proposta, o que atrapalharia a comparação.
  await p.addStyleTag({ content: '.gena-fab, #gena-fab, .gena-launcher { display: none !important; }' });
  return { p, ctx };
}

async function injetar(p, proposta, opcoes) {
  const html = proposta.html(resultadoDoMotor(), opcoes);
  await p.addStyleTag({ content: proposta.css });
  await p.evaluate((html) => {
    const s = document.getElementById('screen-2');
    ['verdict-box', 'secao-solicitar', 'test-steps'].forEach((id) => { const e = document.getElementById(id); if (e) e.style.display = 'none'; });
    const novo = document.createElement('div');
    novo.id = 'proposta';
    novo.innerHTML = html;
    s.querySelector('h1').after(novo);
  }, html);
}

async function fotografar(p, arquivo) {
  // O cursor que clicou em "Estruturar caso" fica parado sobre a tela e
  // acende o realce de passar o mouse; tira ele do caminho.
  await p.mouse.move(0, 0);
  // Do topo da página até o fim do bloco de testes: o resto da tela não muda.
  const fim = await p.evaluate(() => {
    const alvo = document.getElementById('proposta') || document.getElementById('test-steps');
    return Math.ceil(alvo.getBoundingClientRect().bottom + window.scrollY + 28);
  });
  const largura = p.viewportSize().width;
  await p.screenshot({ path: path.join(OUT, arquivo), fullPage: true, clip: { x: 0, y: 0, width: largura, height: fim } });
}

(async () => {
  const b = await chromium.launch({ executablePath: CHROME });
  const aparelhos = { celular: devices['iPhone 13'], computador: { viewport: { width: 1280, height: 900 }, deviceScaleFactor: 2 } };
  for (const [nomeAp, opts] of Object.entries(aparelhos)) {
    for (const tema of ['light', 'dark']) {
      const sufixo = `${nomeAp}${tema === 'dark' ? '-escuro' : ''}`;
      if (tema === 'light') {
        const { p, ctx } = await abrirResultado(b, opts, tema);
        await fotografar(p, `0-atual-${sufixo}.png`);
        await ctx.close();
      }
      for (const prop of Object.values(PROPOSTAS)) {
        if (tema === 'dark' && nomeAp === 'computador') continue;
        const { p, ctx } = await abrirResultado(b, opts, tema);
        await injetar(p, prop);
        await fotografar(p, `${prop.nome}-${sufixo}.png`);
        if (prop.nome === 'B' && tema === 'light') {
          await ctx.close();
          const again = await abrirResultado(b, opts, tema);
          await injetar(again.p, prop, { abrir: 0 });
          await fotografar(again.p, `B-${sufixo}-aberto.png`);
          await again.ctx.close();
          continue;
        }
        await ctx.close();
      }
    }
  }
  await b.close();
})().catch((e) => { console.error(e); process.exit(1); });
