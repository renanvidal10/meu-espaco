// Bateria de acessibilidade, medida no navegador real.
//
// Cobre o que a auditoria mediu como quebrado e o que foi corrigido depois:
// armadilha de foco nos modais, anúncio de troca de tela, nomes acessíveis,
// e a trava que impedia a tela de resultado de aparecer sem triagem rodada.
//
// Essa última não é acessibilidade: é segurança clínica. Um card verde com
// glifo ✓ e zero testes listados é lido por um oncologista como "nenhum teste
// indicado", que é um veredito — e antes bastava clicar no passo 3 para
// produzi-lo do nada.

const path = require('path');
const fs = require('fs');
const os = require('os');
const { execFileSync, spawn } = require('child_process');

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

const falhas = [];
function ok(cond, msg) {
  if (!cond) falhas.push(msg);
  console.log((cond ? '  ✓ ' : '  ✗ ') + msg);
  return cond;
}

async function subir() {
  const { criarStub } = require('./stub-anthropic.js');
  const stub = criarStub();
  const portaStub = await stub.ouvir(0);
  const porta = 6400 + Math.floor(Math.random() * 200);
  const base = `http://127.0.0.1:${porta}`;

  const servidor = spawn(process.execPath, [path.join(__dirname, '..', 'index.js')], {
    env: {
      ...process.env,
      PORT: String(porta),
      NODE_ENV: 'test',
      DATA_FILE: path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'oncogenyx-a11y-')), 'dados.json'),
      ANTHROPIC_API_KEY: 'chave-de-teste',
      ANTHROPIC_BASE_URL: `http://127.0.0.1:${portaStub}`,
      DATABASE_URL: '', RESEND_API_KEY: '', APP_ORIGIN: '',
    },
    stdio: ['ignore', 'ignore', 'pipe'],
  });

  for (let i = 0; i < 100; i++) {
    try { if ((await fetch(base + '/api/health')).ok) break; } catch { /* subindo */ }
    await new Promise((r) => setTimeout(r, 200));
  }
  return { base, servidor, stub };
}

async function entrar(p, base) {
  await p.goto(base);
  await p.waitForTimeout(400);
  if (await p.locator('#acesso-name').isVisible()) {
    await p.fill('#acesso-name', 'Renan Vidal');
    await p.fill('#acesso-crm', '339324');
    await p.click('#acesso-submit');
  }
  await p.waitForSelector('body:not(.gate-active)');
  if (await p.locator('#boas-vindas.aberto').count()) {
    await p.click('#bv-comecar');
    await p.waitForTimeout(200);
  }
}

const idDoFoco = () => document.activeElement
  ? (document.activeElement.id || document.activeElement.className || document.activeElement.tagName)
  : 'nenhum';

async function testarModal(p, abrir, idDoModal, nome) {
  await p.evaluate(abrir);
  await p.waitForTimeout(250);

  // Tab dá muitas voltas: se o foco escapar uma única vez, escapa aqui.
  let escapou = false;
  for (let i = 0; i < 14; i++) {
    await p.keyboard.press('Tab');
    const dentro = await p.evaluate(
      (id) => document.getElementById(id).contains(document.activeElement),
      idDoModal,
    );
    if (!dentro) { escapou = true; break; }
  }
  ok(!escapou, `${nome}: Tab não escapa do diálogo (14 tabulações)`);

  let escapouAtras = false;
  for (let i = 0; i < 14; i++) {
    await p.keyboard.press('Shift+Tab');
    const dentro = await p.evaluate(
      (id) => document.getElementById(id).contains(document.activeElement),
      idDoModal,
    );
    if (!dentro) { escapouAtras = true; break; }
  }
  ok(!escapouAtras, `${nome}: Shift+Tab não escapa do diálogo (14 tabulações)`);

  await p.keyboard.press('Escape');
  await p.waitForTimeout(250);
  const fechou = await p.evaluate(
    (id) => !document.getElementById(id).classList.contains('aberto'),
    idDoModal,
  );
  ok(fechou, `${nome}: Esc fecha`);
}

async function rodar() {
  const { base, servidor, stub } = await subir();
  const navegador = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const contexto = await navegador.newContext({ viewport: { width: 1280, height: 900 } });
  const p = await contexto.newPage();

  console.log('\n=== ARMADILHA DE FOCO NOS MODAIS ===');
  await entrar(p, base);
  await testarModal(p, () => window.abrirBoasVindas(), 'boas-vindas', 'Boas-vindas');
  await testarModal(p, () => window.abrirPrivacidade(), 'privacidade', 'Privacidade');

  console.log('\n=== FOCO VOLTA AO ACIONADOR ===');
  await p.evaluate(() => document.querySelector('.como-funciona').focus());
  const antes = await p.evaluate(idDoFoco);
  await p.keyboard.press('Enter');
  await p.waitForTimeout(250);
  await p.keyboard.press('Escape');
  await p.waitForTimeout(300);
  const depois = await p.evaluate(idDoFoco);
  ok(antes === depois, `foco volta a quem abriu o modal (antes=${antes} depois=${depois})`);

  console.log('\n=== GENA ===');
  await p.click('#gena-fab');
  await p.waitForTimeout(400);
  await p.keyboard.press('Escape');
  await p.waitForTimeout(400);
  const genaFechou = await p.evaluate(() => !document.getElementById('gena').classList.contains('open'));
  ok(genaFechou, 'Esc fecha o painel da Gena');
  const focoDepoisDaGena = await p.evaluate(idDoFoco);
  ok(focoDepoisDaGena === 'gena-fab', `foco volta ao botão da Gena (foi para ${focoDepoisDaGena})`);

  console.log('\n=== TRAVA DO PASSO DE RESULTADO (risco clínico) ===');
  const travados = await p.evaluate(() => Array.from(document.querySelectorAll('.step-btn'))
    .map((b) => b.disabled));
  ok(
    travados[0] === false && travados[1] && travados[2] && travados[3],
    `sem caso estruturado só o passo 1 está liberado (estado: ${JSON.stringify(travados)})`,
  );

  await p.evaluate(() => window.goTo(2));
  await p.waitForTimeout(300);
  const telaAtiva = await p.evaluate(() => Array.from(document.querySelectorAll('.screen'))
    .findIndex((el) => el.classList.contains('active')));
  ok(telaAtiva === 0, `goTo(2) sem triagem não sai da tela 1 (ficou na ${telaAtiva})`);

  console.log('\n=== ANÚNCIO DE TROCA DE TELA ===');
  stub.responderCom({
    tipo: 'ok',
    extracao: {
      tipo_tumor: 'Ginecológico - Ovário',
      histologia: 'Seroso', grau: 'Alto grau', estadiamento: 'IIIC', idade: '61',
    },
  }, 1);
  await p.fill('#case-text', 'Mulher de 61 anos, carcinoma seroso de alto grau de ovário, FIGO IIIC.');
  await p.click('#btn-extract');
  await p.waitForTimeout(2000);

  const anuncio = await p.evaluate(() => document.getElementById('anuncio-tela').textContent);
  ok(/passo 2 de 4/i.test(anuncio), `a troca de tela é anunciada ("${anuncio}")`);

  const focoNoTitulo = await p.evaluate(
    () => document.activeElement && document.activeElement.tagName === 'H1',
  );
  ok(focoNoTitulo, 'o foco vai para o título da tela nova');

  const liberados = await p.evaluate(() => Array.from(document.querySelectorAll('.step-btn'))
    .map((b) => b.disabled));
  ok(liberados[1] === false, 'extrair o caso libera o passo 2');
  ok(liberados[2] === true, 'o passo 3 continua travado até a triagem rodar');

  console.log('\n=== NOMES ACESSÍVEIS E REGIÕES ===');
  const semNome = await p.evaluate(() => {
    const alvos = document.querySelectorAll('#screen-0 textarea, #screen-1 input, #screen-1 select');
    return Array.from(alvos).filter((el) => {
      if (el.getAttribute('aria-label') || el.getAttribute('aria-labelledby')) return false;
      if (el.id && document.querySelector(`label[for="${el.id}"]`)) return false;
      return !el.closest('label');
    }).map((el) => el.id || el.tagName);
  });
  ok(semNome.length === 0, `todo campo tem nome acessível (sem nome: ${JSON.stringify(semNome)})`);

  const regioes = await p.evaluate(() => ({
    erro: document.getElementById('extract-error').getAttribute('role'),
    veredito: document.getElementById('verdict-box').getAttribute('aria-live'),
    voz: document.getElementById('voice-unsupported').getAttribute('role'),
    salto: !!document.querySelector('.pular-para-conteudo'),
    nav: !!document.querySelector('nav#steps[aria-label]'),
  }));
  ok(regioes.erro === 'alert', 'o erro de extração é anunciado');
  ok(regioes.veredito === 'polite', 'o veredito é anunciado');
  ok(regioes.voz === 'status', 'o aviso de voz é anunciado');
  ok(regioes.salto, 'existe link "pular para o conteúdo"');
  ok(regioes.nav, 'a barra de passos é uma landmark de navegação rotulada');

  const idsRepetidos = await p.evaluate(() => {
    const contagem = {};
    document.querySelectorAll('[id]').forEach((el) => {
      contagem[el.id] = (contagem[el.id] || 0) + 1;
    });
    return Object.entries(contagem).filter(([, n]) => n > 1).map(([id]) => id);
  });
  ok(idsRepetidos.length === 0, `nenhum id duplicado (repetidos: ${JSON.stringify(idsRepetidos)})`);

  await navegador.close();
  servidor.kill('SIGTERM');
  if (stub.fechar) await stub.fechar();

  console.log('\n' + '='.repeat(60));
  if (falhas.length) {
    console.log(`FALHAS (${falhas.length}):`);
    falhas.forEach((f) => console.log('  - ' + f));
    process.exit(1);
  }
  console.log('Acessibilidade: todas as verificações passaram.');
  process.exit(0);
}

rodar();
