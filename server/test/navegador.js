// Bateria de navegador: todas as formas de entrada, no aparelho e no desktop.
const fs = require('fs');
const path = require('path');
const { arquivoDeDadosTemporario } = require('./temporario.js');
// PDF gerado na hora: o caminho absoluto que estava aqui apontava para um
// diretorio de rascunho de uma sessao, e a bateria so rodava naquela maquina.
const { criaPdf } = require('./util-pdf.js');
const { execFileSync } = require('child_process');

// O playwright pode estar instalado no projeto (devDependency) ou só
// globalmente, que é como vários ambientes de CI e contêiner o entregam. A
// auditoria pegou esta bateria INTEIRA sem rodar por causa disso: o
// `require('playwright')` estourava MODULE_NOT_FOUND, o script saía com
// código 1, e ninguém percebeu que a camada de interface estava sem
// verificação nenhuma. Um teste que não roda é pior que teste ausente, porque
// aparece na lista como se existisse.
function carregarPlaywright() {
  try {
    return require('playwright');
  } catch (err) {
    if (err.code !== 'MODULE_NOT_FOUND') throw err;
  }
  try {
    const raizGlobal = execFileSync('npm', ['root', '-g'], { encoding: 'utf8' }).trim();
    return require(path.join(raizGlobal, 'playwright'));
  } catch {
    console.error([
      'playwright não encontrado — a bateria de navegador NÃO rodou.',
      '',
      'Instale com:  npm install --save-dev playwright',
      'Ou, se já houver instalação global, garanta que ela esteja no caminho:',
      '  NODE_PATH=$(npm root -g) npm run test:navegador',
      '',
      'O Chromium já vem pronto neste ambiente (PLAYWRIGHT_BROWSERS_PATH).',
      'Não rode "playwright install".',
    ].join('\n'));
    process.exit(1);
  }
}

const { chromium, devices } = carregarPlaywright();
const TUMORS = require(path.join(__dirname, '..', 'public', 'tumors.js'));

// A bateria sobe o próprio servidor, com a API simulada por trás. Antes ela
// dependia de alguém ter deixado um servidor de pé na 3311: quem rodasse o
// comando sozinho recebia ERR_CONNECTION_REFUSED, e a suíte de interface na
// prática não existia.
let BASE = '';
let servidor = null;
let stub = null;

async function subirServidor() {
  const { criarStub } = require('./stub-anthropic.js');
  const os = require('os');
  stub = criarStub();
  const portaStub = await stub.ouvir(0);
  const porta = 5700 + Math.floor(Math.random() * 300);
  BASE = `http://127.0.0.1:${porta}`;

  servidor = require('child_process').spawn(
    process.execPath,
    [path.join(__dirname, '..', 'index.js')],
    {
      env: {
        ...process.env,
        PORT: String(porta),
        NODE_ENV: 'test',
        DATA_FILE: arquivoDeDadosTemporario('nav'),
        ANTHROPIC_API_KEY: 'chave-de-teste',
        ANTHROPIC_BASE_URL: `http://127.0.0.1:${portaStub}`,
        DATABASE_URL: '',
        RESEND_API_KEY: '',
        APP_ORIGIN: '',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  servidor.stderr.on('data', (d) => {
    const t = String(d);
    if (!/DeprecationWarning|punycode/.test(t)) process.stderr.write('[app] ' + t);
  });

  for (let i = 0; i < 100; i++) {
    try { if ((await fetch(BASE + '/api/health')).ok) return; } catch { /* ainda subindo */ }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error('o servidor não subiu a tempo para a bateria de navegador');
}

function derrubarServidor() {
  if (servidor) servidor.kill('SIGTERM');
  if (stub && stub.fechar) stub.fechar();
}
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

const falhas = [];
function ok(cond, msg) { if (!cond) falhas.push(msg); return cond; }
function linha(passou, texto) { console.log((passou ? '  ✓ ' : '  ✗ ') + texto); }

async function entrar(p) {
  await p.goto(BASE);
  // As abas compartilham o localStorage do contexto: da segunda em diante a
  // sessão já existe e a tela de acesso nem aparece.
  await p.waitForTimeout(400);
  if (await p.locator('#acesso-name').isVisible()) {
    await p.fill('#acesso-name', 'Renan Vidal');
    await p.fill('#acesso-crm', '339324');
    await p.click('#acesso-submit');
  }
  await p.waitForSelector('body:not(.gate-active)');
  if (await p.locator('#boas-vindas.aberto').count()) {
    await p.click('#bv-comecar');
    await p.waitForSelector('#boas-vindas', { state: 'hidden' });
  }
}

// Simula a resposta do modelo com as MESMAS chaves simples do schema real e
// aplica a MESMA normalização do servidor - senão o teste valida um caminho
// que não existe em produção.
function mockExtracao(p, dados, avisos = []) {
  return p.route('**/api/extract', (r) => {
    const bruto = { tipo_tumor_justificativa: dados.justificativa || '', fontes_usadas: ['teste'], ...dados };
    delete bruto.justificativa;
    r.fulfill({ status: 200, contentType: 'application/json',
      body: JSON.stringify({ extracted: TUMORS.normalizar(bruto), avisos }) });
  });
}

async function rodar(nome, dispositivo) {
  console.log('\n=== ' + nome + ' ===');
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const ctx = await browser.newContext(dispositivo);
  const erros = [];
  ctx.on('weberror', (e) => erros.push(String(e.error())));

  /* ---------- 1. texto digitado ---------- */
  {
    const p = await ctx.newPage();
    p.on('pageerror', (e) => erros.push('texto: ' + e.message));
    await mockExtracao(p, { tipo_tumor: 'Ginecológico - Ovário', histologia: 'Seroso', grau: 'Alto grau', estadiamento: 'IIIC', idade: '61' });
    await entrar(p);
    await p.fill('#case-text', 'mulher 61a, seroso alto grau IIIC');
    await p.click('#btn-extract');
    await p.waitForSelector('#screen-1.active');
    const h = await p.inputValue('#f-histologia');
    linha(ok(h === 'Seroso', 'texto digitado não preencheu histologia'), 'texto digitado → revisão preenchida');
    await p.close();
  }

  /* ---------- 2. anexo de PDF ---------- */
  {
    const p = await ctx.newPage();
    p.on('pageerror', (e) => erros.push('pdf: ' + e.message));
    await mockExtracao(p, { tipo_tumor: 'Próstata', extensao_doenca: 'Metastático resistente à castração (mCRPC)', gleason_grade_group: 'Gleason 4+5=9' });
    await entrar(p);
    await p.setInputFiles('#input-pdf', { name: 'laudo.pdf', mimeType: 'application/pdf', buffer: criaPdf('Laudo anatomopatologico de teste.') });
    const chip = await p.locator('#attached-files-list .file-chip').count();
    linha(ok(chip === 1, 'o PDF anexado não virou chip removível'), 'PDF anexado → chip visível');
    await p.click('#btn-extract');
    await p.waitForSelector('#screen-1.active');
    const e = await p.inputValue('#f-extensao_doenca');
    linha(ok(/mCRPC/.test(e), 'PDF não preencheu extensão: ' + e), 'PDF → extensão da doença preenchida');
    await p.close();
  }

  /* ---------- 3. anexo de imagem ---------- */
  {
    const p = await ctx.newPage();
    p.on('pageerror', (e) => erros.push('imagem: ' + e.message));
    await mockExtracao(p, { tipo_tumor: 'Mama', subtipo_molecular: 'Triplo-negativo', extensao_doenca: 'Inicial (operável)', idade: '44' });
    await entrar(p);
    await p.setInputFiles('#input-photo', { name: 'foto.png', mimeType: 'image/png', buffer: PNG });
    const miniatura = await p.locator('#thumb-row img').count();
    linha(ok(miniatura === 1, 'a foto não gerou miniatura'), 'imagem anexada → miniatura');
    await p.click('#btn-extract');
    await p.waitForSelector('#screen-1.active');
    const s = await p.inputValue('#f-subtipo_molecular');
    linha(ok(s === 'Triplo-negativo', 'imagem não preencheu subtipo'), 'imagem → subtipo preenchido');
    await p.close();
  }

  /* ---------- 4. remoção de arquivo e limpar tudo ---------- */
  {
    const p = await ctx.newPage();
    p.on('pageerror', (e) => erros.push('remocao: ' + e.message));
    await entrar(p);
    await p.setInputFiles('#input-pdf', [
      { name: 'a.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4 a') },
      { name: 'b.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4 b') },
    ]);
    linha(ok(await p.locator('.file-chip').count() === 2, 'dois PDFs não apareceram'), 'dois anexos listados');
    await p.locator('.file-chip button').first().click();
    linha(ok(await p.locator('.file-chip').count() === 1, 'remover não funcionou'), 'remover um anexo');
    await p.fill('#case-text', 'texto qualquer');
    await p.click('button:has-text("Limpar tudo")');
    const limpo = (await p.locator('.file-chip').count()) === 0 && (await p.inputValue('#case-text')) === '';
    linha(ok(limpo, 'limpar tudo não zerou'), 'limpar tudo zera arquivos e texto');
    await p.close();
  }

  /* ---------- 5. arquivo inválido: bloqueio no navegador ---------- */
  {
    const p = await ctx.newPage();
    p.on('pageerror', (e) => erros.push('invalido: ' + e.message));
    await entrar(p);
    await p.setInputFiles('#input-pdf', { name: 'vazio.pdf', mimeType: 'application/pdf', buffer: Buffer.alloc(0) });
    await p.waitForTimeout(200);
    const avisos = await p.locator('.aviso-arquivo').count();
    const chips = await p.locator('.file-chip').count();
    linha(ok(avisos > 0 && chips === 0, `avisos=${avisos} chips=${chips}`), 'PDF de 0 byte barrado antes do upload');
    const texto = await p.locator('.aviso-arquivo').first().innerText();
    linha(ok(/iCloud|Drive/i.test(texto), 'aviso sem instrução'), 'aviso diz o que fazer');
    await p.close();
  }

  /* ---------- 6b. o aviso da leitura CHEGA AOS OLHOS na tela de revisão ---------- */
  {
    // Medido antes da correção: 1 aviso no DOM, 0 visíveis. Quando a extração
    // dá certo o app avança para a revisão, e o aviso ficava renderizado na
    // tela anterior. Valia para o aviso de leitura incompleta E para o de PDF
    // com assinatura digital, que existia desde a v1.5 e ninguém nunca viu.
    const p = await ctx.newPage();
    p.on('pageerror', (e) => erros.push('aviso-visivel: ' + e.message));
    await mockExtracao(
      p,
      { tipo_tumor: 'Ginecológico - Endométrio', histologia: 'Endometrioide', estadiamento: 'IA', mmr_msi: 'pMMR / MSS' },
      [{
        arquivo: 'Leitura automática',
        motivo: 'A primeira leitura do material voltou incompleta.',
        comoResolver: 'Uma segunda leitura recuperou os dados — confira os campos.',
        recuperado: true,
      }],
    );
    await entrar(p);
    await p.fill('#case-text', 'caso de endométrio');
    await p.click('#btn-extract');
    await p.waitForSelector('#screen-1.active');
    const visiveis = await p.locator('.aviso-arquivo:visible').count();
    const texto = await p.locator('.aviso-arquivo:visible').first().innerText().catch(() => '');
    linha(
      ok(visiveis > 0 && /leitura/i.test(texto), `visíveis=${visiveis} texto="${texto.slice(0, 50)}"`),
      'aviso da leitura é VISÍVEL na tela de revisão',
    );
    await p.close();
  }

  /* ---------- 6. ditado por voz ---------- */
  {
    const p = await ctx.newPage();
    p.on('pageerror', (e) => erros.push('voz: ' + e.message));
    // Web Speech API não existe no Chromium headless: injeta uma implementação
    // que dispara os mesmos eventos, para exercitar o caminho real do app.
    await p.addInitScript(() => {
      class FalsoReconhecimento {
        constructor() { this.lang = ''; this.continuous = false; this.interimResults = false; }
        start() {
          setTimeout(() => {
            const r = [{ 0: { transcript: 'paciente de 61 anos com carcinoma seroso de ovário' }, isFinal: true, length: 1 }];
            r.length = 1;
            this.onresult({ resultIndex: 0, results: r });
          }, 60);
        }
        stop() { if (this.onend) this.onend(); }
      }
      window.SpeechRecognition = FalsoReconhecimento;
      window.webkitSpeechRecognition = FalsoReconhecimento;
    });
    await entrar(p);
    await p.click('#tile-voice');
    await p.click('#rec-btn');
    await p.waitForTimeout(400);
    const dito = await p.inputValue('#case-text');
    linha(ok(/carcinoma seroso/i.test(dito), 'o ditado não chegou ao campo: "' + dito + '"'), 'ditado por voz → texto no campo');
    await p.click('#rec-btn');
    await p.close();
  }

  /* ---------- 7. navegador sem suporte a voz ---------- */
  {
    const p = await ctx.newPage();
    p.on('pageerror', (e) => erros.push('voz-sem-suporte: ' + e.message));
    await p.addInitScript(() => {
      delete window.SpeechRecognition; delete window.webkitSpeechRecognition;
    });
    await entrar(p);
    await p.click('#tile-voice');
    await p.click('#rec-btn');
    await p.waitForTimeout(200);
    const visivel = await p.locator('#voice-unsupported').isVisible();
    linha(ok(visivel, 'não avisou que o navegador não suporta ditado'), 'sem suporte a voz → aviso honesto');
    await p.close();
  }

  /* ---------- 8. Gena: conversa e entrega para a triagem ---------- */
  {
    const p = await ctx.newPage();
    p.on('pageerror', (e) => erros.push('gena: ' + e.message));
    let turno = 0;
    await p.route('**/api/chat', (r) => {
      turno++;
      const respostas = [
        { reply: 'Certo. Qual a histologia no anatomopatológico?', caseReady: null },
        { reply: 'Seroso de alto grau em IIIC. Já dá para rodar.', caseReady: 'mulher de 61 anos, carcinoma seroso de alto grau de ovário, estágio IIIC' },
      ];
      r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(respostas[Math.min(turno - 1, 1)]) });
    });
    await mockExtracao(p, { tipo_tumor: 'Ginecológico - Ovário', histologia: 'Seroso', grau: 'Alto grau', estadiamento: 'IIIC', idade: '61' });
    await entrar(p);

    await p.click('#gena-fab');
    await p.waitForSelector('#gena-panel', { state: 'visible' });
    const saudacao = await p.locator('.gena-msg.from-gena').count();
    linha(ok(saudacao >= 1, 'a Gena não cumprimentou ao abrir'), 'Gena abre já se apresentando');

    await p.fill('#gena-input', 'paciente de 61 anos com CA de ovário');
    await p.press('#gena-input', 'Enter');
    await p.waitForSelector('.gena-msg.from-gena >> nth=1');
    linha(ok((await p.locator('#gena-cta').isVisible()) === false, 'ofereceu triagem cedo demais'), 'não oferece triagem sem dado suficiente');

    await p.fill('#gena-input', 'seroso de alto grau, estágio IIIC');
    await p.press('#gena-input', 'Enter');
    await p.waitForSelector('#gena-cta', { state: 'visible' });
    linha(ok(true, ''), 'com caso pronto → oferece levar para a triagem');

    const textoConversa = await p.locator('#gena-log').innerText();
    linha(ok(!/CASO_PRONTO/.test(textoConversa), 'o marcador interno apareceu na conversa'), 'marcador interno não vaza na conversa');

    await p.click('#gena-cta button');
    await p.waitForSelector('#screen-1.active');
    const h = await p.inputValue('#f-histologia');
    linha(ok(h === 'Seroso', 'a Gena não levou o caso para a triagem'), 'Gena → triagem com os campos preenchidos');
    await p.close();
  }

  /* ---------- 9. subtipo não identificado ---------- */
  {
    const p = await ctx.newPage();
    p.on('pageerror', (e) => erros.push('nao-identificado: ' + e.message));
    await p.route('**/api/extract', (r) => r.fulfill({ status: 200, contentType: 'application/json',
      body: JSON.stringify({ extracted: TUMORS.normalizar({ tipo_tumor: 'Não identificado' }), avisos: [] }) }));
    await entrar(p);
    await p.fill('#case-text', 'consulta de rotina');
    await p.click('#btn-extract');
    await p.waitForTimeout(400);
    const naTela1 = await p.locator('#screen-0.active').count();
    const erro = await p.locator('#extract-error').isVisible();
    linha(ok(naTela1 === 1 && erro, 'avançou com subtipo desconhecido'), 'subtipo não identificado → fica na tela 1 com aviso');
    await p.close();
  }

  /* ---------- 10. erro do servidor vira mensagem legível ---------- */
  {
    const p = await ctx.newPage();
    p.on('pageerror', (e) => erros.push('erro-servidor: ' + e.message));
    await p.route('**/api/extract', (r) => r.fulfill({ status: 422, contentType: 'application/json',
      body: JSON.stringify({ error: 'Não consegui abrir o PDF anexado. Tire uma foto ou print do laudo e anexe como imagem.' }) }));
    await entrar(p);
    await p.fill('#case-text', 'caso');
    await p.click('#btn-extract');
    await p.waitForTimeout(400);
    const msg = await p.locator('#extract-error').innerText();
    linha(ok(/foto/i.test(msg) && !/\{|base64/.test(msg), 'mensagem técnica ou ausente: ' + msg), 'erro do servidor → frase acionável');
    const larg = await p.evaluate(() => ({ v: innerWidth, d: document.documentElement.scrollWidth }));
    linha(ok(larg.d <= larg.v, `rolagem horizontal: doc=${larg.d} viewport=${larg.v}`), 'erro não quebra o layout');
    await p.close();
  }

  /* ---------- 11. fluxo completo até o documento ---------- */
  {
    const p = await ctx.newPage();
    p.on('pageerror', (e) => erros.push('fluxo: ' + e.message));
    await mockExtracao(p, { tipo_tumor: 'Colorretal', histologia: 'Adenocarcinoma', extensao_doenca: 'Metastático', mmr_msi: 'dMMR / MSI-alto', idade: '55', nome_paciente: 'Maria S. Oliveira' });
    await entrar(p);
    await p.fill('#case-text', 'caso');
    await p.click('#btn-extract');
    await p.waitForSelector('#screen-1.active');
    await p.click('button:has-text("Rodar triagem")');
    await p.waitForSelector('#screen-2.active');
    const nTestes = await p.locator('#test-steps .test-step').count();
    linha(ok(nTestes === 2, `esperado 2 testes, veio ${nTestes}`), 'triagem indica os testes corretos');
    await p.click('#verdict-next-btn');
    await p.waitForSelector('#screen-3.active');
    const docs = await p.locator('#programs-dynamic .doc-preview').count();
    const nome = await p.locator('#programs-dynamic .doc-name').first().innerText();
    linha(ok(docs === 2 && /Maria/.test(nome), `docs=${docs} nome=${nome}`), 'documentos gerados com o nome do paciente');
    // Edição inline do documento
    await p.locator('#programs-dynamic .doc-actions button.ghost').first().click();
    const editavel = await p.locator('#programs-dynamic .doc-preview.editing').count();
    linha(ok(editavel === 1, 'editar campos não ativou'), 'editar campos do documento');
    await p.close();
  }

  /* ---------- 12. sessão expirada ---------- */
  {
    const p = await ctx.newPage();
    p.on('pageerror', (e) => erros.push('sessao: ' + e.message));
    await entrar(p);
    await p.route('**/api/extract', (r) => r.fulfill({ status: 401, contentType: 'application/json',
      body: JSON.stringify({ error: 'Sessão expirada. Entre novamente.' }) }));
    await p.fill('#case-text', 'caso');
    await p.click('#btn-extract');
    await p.waitForTimeout(500);
    const voltouAoLogin = await p.evaluate(() => document.body.classList.contains('gate-active'));
    const semToken = await p.evaluate(() => !localStorage.getItem('oncogenyx.session'));
    linha(ok(voltouAoLogin && semToken, `gate=${voltouAoLogin} token limpo=${semToken}`), 'sessão expirada → volta ao acesso');
    await p.close();
  }

  if (erros.length) falhas.push(nome + ' — erros de página: ' + erros.join(' | '));
  console.log('  erros de console/página: ' + (erros.length ? erros.join(' | ') : 'nenhum'));
  await browser.close();
}

(async () => {
  try {
    await subirServidor();
    await rodar('CELULAR (iPhone 14 Pro)', devices['iPhone 14 Pro']);
    await rodar('DESKTOP (1280x900)', { viewport: { width: 1280, height: 900 } });
  } finally {
    derrubarServidor();
  }

  console.log('\n' + '='.repeat(60));
  if (falhas.length) {
    console.log('FALHAS (' + falhas.length + '):');
    falhas.forEach((f) => console.log('  - ' + f));
    process.exit(1);
  }
  console.log('Todas as entradas passaram, no celular e no desktop.');
  process.exit(0);
})();
