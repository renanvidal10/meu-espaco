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
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium' });
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

  /* ---------- 6c. sinal de confiança: justificativa vazia pede confirmação ---------- */
  {
    // Medido contra a API real: em TODA extração correta o modelo explicou por
    // que escolheu o subtipo; em TODA falha (abandono ou troca de ovário por
    // endométrio) a justificativa veio vazia. O sinal cobre os dois modos de
    // falha sem custar chamada extra — mas só serve se a tela o mostrar.
    const p = await ctx.newPage();
    p.on('pageerror', (e) => erros.push('confianca: ' + e.message));
    await mockExtracao(p, {
      tipo_tumor: 'Ginecológico - Endométrio',
      justificativa: '',
      histologia: 'Endometrioide', estadiamento: 'IA', mmr_msi: 'pMMR / MSS',
    });
    await entrar(p);
    await p.fill('#case-text', 'caso sem justificativa da leitura');
    await p.click('#btn-extract');
    await p.waitForSelector('#screen-1.active');
    const marcado = await p.locator('#field-subtipo.confirmar').count();
    const pedido = await p.locator('#tipo-tumor-justificativa').innerText();
    linha(
      ok(marcado === 1 && /confirme o subtipo/i.test(pedido), `marcado=${marcado} texto="${pedido.slice(0, 40)}"`),
      'sem justificativa → tela pede confirmação do subtipo',
    );
    await p.close();
  }

  /* ---------- 6d. com justificativa, a tela NÃO alarma à toa ---------- */
  {
    const p = await ctx.newPage();
    p.on('pageerror', (e) => erros.push('confianca-ok: ' + e.message));
    await mockExtracao(p, {
      tipo_tumor: 'Ginecológico - Ovário',
      justificativa: 'Material descreve carcinoma seroso de alto grau de ovário com estadiamento FIGO.',
      histologia: 'Seroso', grau: 'Alto grau', estadiamento: 'IIIC',
    });
    await entrar(p);
    await p.fill('#case-text', 'caso com justificativa');
    await p.click('#btn-extract');
    await p.waitForSelector('#screen-1.active');
    const marcado = await p.locator('#field-subtipo.confirmar').count();
    const texto = await p.locator('#tipo-tumor-justificativa').innerText();
    linha(
      ok(marcado === 0 && /identificado automaticamente/i.test(texto), `marcado=${marcado} texto="${texto.slice(0, 40)}"`),
      'com justificativa → nenhum alarme falso',
    );
    await p.close();
  }

  /* ---------- 6e. a regra de SEQUÊNCIA aparece aberta e antes do pedido ---------- */
  {
    // §54. A nota "perda de MLH1/PMS2 pede metilação antes do germinativo" é a
    // regra de ordem mais perigosa do app: seguir a ordem errada manda ao
    // germinativo uma paciente cuja perda é esporádica. Ela ficava recolhida
    // atrás de um clique, ABAIXO do card de testes que ela governa, enquanto o
    // texto jurídico ficava todo aberto. O teste vigia as duas coisas que
    // importam: que ela nasce aberta, e que vem ANTES do card que ela corrige.
    const p = await ctx.newPage();
    p.on('pageerror', (e) => erros.push('ordem-nota: ' + e.message));
    await mockExtracao(p, { tipo_tumor: 'Ginecológico - Endométrio', histologia: 'Endometrioide', estadiamento: 'IA', mmr_msi: 'dMMR / MSI-alto', idade: '58' });
    await entrar(p);
    await p.fill('#case-text', 'endométrio dMMR');
    await p.click('#btn-extract');
    await p.waitForSelector('#screen-1.active');
    await p.click('button:has-text("Rodar triagem")');
    await p.waitForSelector('#screen-2.active');

    const nota = p.locator('#verdict-notes-acao .note-card').filter({ hasText: 'metilação' }).first();
    const existe = await nota.count();
    const aberta = existe ? await nota.evaluate((el) => el.open) : false;
    // innerText de <details> aberto já traz o corpo: o médico lê sem clicar.
    const corpo = existe ? await nota.innerText() : '';
    linha(
      ok(existe === 1 && aberta && /antes de encaminhar/i.test(corpo), `existe=${existe} aberta=${aberta} corpo="${corpo.slice(0, 60)}"`),
      'regra de sequência nasce ABERTA e legível sem clique',
    );

    // Ordem no documento: a nota de ação tem que vir antes do card de testes.
    const antes = await p.evaluate(() => {
      const n = document.querySelector('#verdict-notes-acao .note-card');
      const t = document.getElementById('test-steps');
      if (!n || !t) return false;
      return n.compareDocumentPosition(t) & Node.DOCUMENT_POSITION_FOLLOWING ? true : false;
    });
    linha(ok(antes, 'a regra de ordem ficou depois do card de testes'), 'regra de sequência vem ANTES do pedido');

    // E o texto jurídico, que não muda conduta, continua recolhido.
    const juridicoAberto = await p.locator('#verdict-notes .note-card[open]').count();
    linha(ok(juridicoAberto === 0, `${juridicoAberto} nota(s) de contexto nasceram abertas`), 'nota de contexto segue recolhida');
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
    // O indicador de "digitando" também é um .gena-msg.from-gena: sem o :not,
    // a espera terminava na bolha de digitação, antes da resposta, e a
    // mensagem seguinte batia na Gena ainda ocupada (corrida que apareceu
    // em §85, quando a ordem de carga da página mudou).
    await p.waitForSelector('.gena-msg.from-gena:not(#gena-typing) >> nth=1');
    await p.waitForSelector('#gena-typing', { state: 'detached' });
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

  /* ---------- 8b. Gena: falha de rede tem caminho de volta ---------- */
  {
    /* §69. O médico está em corredor de hospital, com sinal oscilando. Antes
     * disto, uma falha renderizava "Tive um problema" e acabava ali: a
     * mensagem dele já estava no histórico, sem resposta e sem botão. Para
     * tentar de novo teria que digitar tudo outra vez — é onde a conversa
     * morre. O teste derruba a primeira chamada e exige que a segunda,
     * disparada pelo botão, reenvie A MESMA mensagem. */
    const p = await ctx.newPage();
    p.on('pageerror', (e) => erros.push('gena-falha: ' + e.message));
    let tentativas = 0;
    let ultimoCorpo = null;
    await p.route('**/api/chat', (r) => {
      tentativas++;
      try { ultimoCorpo = JSON.parse(r.request().postData() || '{}'); } catch (e) { ultimoCorpo = null; }
      if (tentativas === 1) return r.fulfill({ status: 503, contentType: 'application/json', body: '{"error":"Serviço indisponível."}' });
      return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ reply: 'Voltei. Me conta a histologia.', caseReady: null }) });
    });
    await entrar(p);
    await p.click('#gena-fab');
    await p.waitForSelector('#gena-panel', { state: 'visible' });

    await p.fill('#gena-input', 'paciente com CA de ovário');
    await p.press('#gena-input', 'Enter');
    await p.waitForSelector('#gena-erro', { timeout: 5000 });
    const temBotao = await p.locator('#gena-erro .gena-retentar').count();
    linha(ok(temBotao === 1, 'a falha não ofereceu reenvio'), 'falha da Gena → oferece tentar de novo');

    /* §69.2. O balão de falha tem de PARECER falha. A regra que o pinta
     * perdia por especificidade para `.gena-msg.from-gena .gena-bubble`, e
     * ele saía idêntico a uma bolha comum — sem nenhuma cor de alerta. A
     * bateria de contraste não pegou: ela media a bolha comum e aprovava o
     * número dela. Comparar com a bolha vizinha é o que denuncia. */
    const cores = await p.evaluate(() => {
      const falha = document.querySelector('.gena-bubble.gena-falha');
      const comum = document.querySelector('.gena-msg.from-gena .gena-bubble:not(.gena-falha)');
      const ler = (el) => (el ? getComputedStyle(el) : null);
      const a = ler(falha);
      const b = ler(comum);
      return a && b ? { falhaFundo: a.backgroundColor, comumFundo: b.backgroundColor, falhaCor: a.color, comumCor: b.color } : null;
    });
    linha(
      ok(!!cores && cores.falhaFundo !== cores.comumFundo && cores.falhaCor !== cores.comumCor,
        `falha=${cores && cores.falhaFundo}/${cores && cores.falhaCor} comum=${cores && cores.comumFundo}/${cores && cores.comumCor}`),
      'o balão de falha não se parece com uma bolha comum',
    );

    await p.click('#gena-erro .gena-retentar');
    await p.waitForTimeout(500);
    const sumiu = await p.locator('#gena-erro').count();
    const respondeu = await p.locator('#gena-log').innerText();
    const ultimaDoMedico = ultimoCorpo && ultimoCorpo.messages
      ? ultimoCorpo.messages[ultimoCorpo.messages.length - 1]
      : null;
    linha(
      ok(tentativas === 2 && sumiu === 0 && /Voltei/.test(respondeu), `tentativas=${tentativas} erroNaTela=${sumiu}`),
      'tentar de novo refaz a chamada e limpa o erro',
    );
    linha(
      ok(!!ultimaDoMedico && ultimaDoMedico.role === 'user' && /CA de ovário/.test(ultimaDoMedico.content),
        `última mensagem reenviada: ${JSON.stringify(ultimaDoMedico)}`),
      'o reenvio manda a MESMA mensagem, sem redigitar',
    );

    // E a mensagem do médico não pode ter sido duplicada no histórico.
    const quantasDoMedico = (ultimoCorpo.messages || []).filter((m) => m.role === 'user').length;
    linha(ok(quantasDoMedico === 1, `${quantasDoMedico} mensagens do médico no histórico`),
      'o reenvio não duplica a mensagem');
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
    /* §38.8b. Eram 2 testes neste caso (dMMR metastático, 55 anos) e passaram
     * a ser 3: a metilação do promotor de MLH1 virou PEDIDO, e não só texto
     * de nota. A nota sempre mandou fazê-la antes do germinativo, e o passo
     * um da sequência não tinha card, amostra nem linha no documento — o
     * médico lia "faça antes" e não tinha o que assinar. */
    const nTestes = await p.locator('#test-steps .test-step').count();
    linha(ok(nTestes === 3, `esperado 3 testes, veio ${nTestes}`), 'triagem indica os testes corretos');
    await p.click('#verdict-next-btn');
    await p.waitForSelector('#screen-3.active');
    const docs = await p.locator('#programs-dynamic .doc-preview').count();
    // O documento agora nasce recolhido: innerText de elemento oculto volta
    // vazio. O caminho do médico é abrir e conferir antes de assinar, então o
    // teste faz o mesmo — e assim também vigia que o painel ABRE.
    await p.locator('#programs-dynamic details.doc-preview-wrap').first().click();
    const nome = await p.locator('#programs-dynamic .doc-name').first().innerText();
    linha(ok(docs === 3 && /Maria/.test(nome), `docs=${docs} nome=${nome}`), 'documentos gerados com o nome do paciente');

    // E o PDF não pode sair em branco por causa do painel recolhido: a função
    // de baixar precisa abrir o documento antes de mandar imprimir.
    const fechado = await p.locator('#programs-dynamic details.doc-preview-wrap').nth(1);
    const abertoAntes = await fechado.evaluate((el) => el.open);
    await p.evaluate(() => {
      window.print = () => {};
      const alvo = document.querySelectorAll('#programs-dynamic details.doc-preview-wrap')[1];
      downloadDoc(alvo.id);
    });
    const abertoDepois = await fechado.evaluate((el) => el.open);
    linha(ok(!abertoAntes && abertoDepois, `antes=${abertoAntes} depois=${abertoDepois}`),
      'baixar PDF abre o documento recolhido antes de imprimir');
    /* §64.2. O teste chamava downloadDoc() por avaliação — nunca CLICAVA no
     * botão. Um onclick quebrado, um botão coberto por outro elemento ou
     * desabilitado por engano passariam inteiros. O médico clica. */
    const clicou = await p.evaluate(() => { window.__imprimiu = 0; window.print = () => { window.__imprimiu++; }; });
    void clicou;
    await p.locator('#programs-dynamic .doc-actions .primary').first().click();
    await p.waitForTimeout(200);
    const imprimiuPeloBotao = await p.evaluate(() => window.__imprimiu);
    linha(ok(imprimiuPeloBotao === 1, `window.print chamado ${imprimiuPeloBotao}x ao clicar no botão`),
      'clicar em Baixar PDF realmente imprime');

    /* No iPhone com o app instalado na tela de início não existe impressão:
     * window.print() não abre nada e não lança erro. O app precisa escolher o
     * outro caminho ANTES de chamar, porque depois não dá para saber que
     * falhou. Aqui o modo aplicativo é simulado e o teste exige que o
     * documento seja ABERTO, não impresso. */
    const semImpressao = await p.evaluate(() => {
      window.__imprimiu = 0;
      window.__abriu = null;
      window.open = (u) => { window.__abriu = String(u); return { focus() {} }; };
      Object.defineProperty(window.navigator, 'standalone', { value: true, configurable: true });
      const d = document.querySelector('#programs-dynamic details.doc-preview-wrap');
      downloadDoc(d.id);
      return { imprimiu: window.__imprimiu, abriu: window.__abriu };
    });
    linha(
      ok(semImpressao.imprimiu === 0 && /^blob:/.test(semImpressao.abriu || ''),
        `imprimiu=${semImpressao.imprimiu} abriu=${semImpressao.abriu}`),
      'em modo aplicativo, abre o documento em vez de imprimir no vazio',
    );

    // Edição inline do documento
    // §66.2: "Editar campos" mora dentro do documento agora.
    await p.locator('#programs-dynamic .doc-ferramentas button.ghost').first().click();
    const editavel = await p.locator('#programs-dynamic .doc-preview.editing').count();
    linha(ok(editavel === 1, 'editar campos não ativou'), 'editar campos do documento');

    /* §55. Sem nome, o documento sai com "(preencha o nome do paciente)" no
     * campo do paciente — e era possível baixar e assinar isso. O teste apaga
     * o nome e exige que o download esteja barrado nas duas camadas: o botão
     * e a função. */
    await p.fill('#patient-name', '');
    await p.dispatchEvent('#patient-name', 'input');
    await p.waitForTimeout(100);
    const travado = await p.locator('#programs-dynamic .doc-actions .primary:disabled').count();
    const totalBotoes = await p.locator('#programs-dynamic .doc-actions .primary').count();
    const avisoVisivel = await p.locator('#patient-name-aviso:visible').count();
    linha(
      ok(travado === totalBotoes && totalBotoes > 0 && avisoVisivel === 1, `travados=${travado}/${totalBotoes} aviso=${avisoVisivel}`),
      'sem nome do paciente → download barrado e motivo na tela',
    );
    const imprimiu = await p.evaluate(() => {
      let chamou = false;
      window.print = () => { chamou = true; };
      const alvo = document.querySelector('#programs-dynamic details.doc-preview-wrap');
      downloadDoc(alvo.id);
      return chamou;
    });
    linha(ok(imprimiu === false, 'downloadDoc imprimiu documento sem paciente'), 'downloadDoc se recusa a imprimir sem nome');

    // E voltar a preencher libera outra vez: a trava não pode virar beco.
    await p.fill('#patient-name', 'Ana P. Lima');
    await p.dispatchEvent('#patient-name', 'input');
    await p.waitForTimeout(100);
    const liberados = await p.locator('#programs-dynamic .doc-actions .primary:disabled').count();
    const avisoSumiu = await p.locator('#patient-name-aviso:visible').count();
    linha(ok(liberados === 0 && avisoSumiu === 0, `travados=${liberados} aviso=${avisoSumiu}`), 'preencher o nome libera o download');
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
    // §85: a sessão mora em cookie HttpOnly, invisível à página. O que se
    // confere é que nada de sessão ficou em localStorage e que a tela explica
    // por que voltou para a entrada.
    const semToken = await p.evaluate(() => !localStorage.getItem('oncogenyx.session'));
    const explicou = /sessão terminou/i.test(await p.locator('#gate-alert').textContent());
    linha(ok(voltouAoLogin && semToken && explicou, `gate=${voltouAoLogin} token limpo=${semToken} aviso=${explicou}`), 'sessão expirada → volta ao acesso');
    await p.close();
  }

  /* ---------- o nome do paciente não pode sobreviver ao caso ---------- *
   * Era a única informação identificável que o app toca, e ela atravessava o
   * "Iniciar novo caso": o documento da paciente SEGUINTE saía com o nome da
   * anterior e o diagnóstico correto dela. Ver ARQUITETURA §46.1.
   * -------------------------------------------------------------------- */
  {
    const p = await ctx.newPage();
    p.on('pageerror', (e) => erros.push('vazamento: ' + e.message));
    await mockExtracao(p, { tipo_tumor: 'Ginecológico - Ovário', histologia: 'Seroso', grau: 'Alto grau', estadiamento: 'IIIC', idade: '61' });
    await entrar(p);
    await p.fill('#case-text', 'caso');
    await p.click('#btn-extract');
    await p.waitForSelector('#screen-1.active');
    await p.click('#screen-1 button:has-text("Rodar")');
    await p.waitForSelector('#screen-2.active');
    await p.click('#verdict-next-btn');
    await p.waitForSelector('#screen-3.active');
    await p.fill('#patient-name', 'ANA PAULA MOREIRA');
    await p.click('button:has-text("Atualizar documentos")');
    await p.waitForTimeout(200);

    await p.click('button:has-text("Iniciar novo caso")');
    await p.waitForTimeout(300);
    const campoLimpo = (await p.inputValue('#patient-name')) === '';
    linha(ok(campoLimpo, 'o nome do paciente sobreviveu ao "Iniciar novo caso"'),
      'novo caso zera o nome do paciente');

    await mockExtracao(p, { tipo_tumor: 'Mama', subtipo_molecular: 'Triplo-negativo', extensao_doenca: 'Metastático', sexo: 'Feminino', idade: '44' });
    await p.fill('#case-text', 'outro caso');
    await p.click('#btn-extract');
    await p.waitForSelector('#screen-1.active');
    await p.click('#screen-1 button:has-text("Rodar")');
    await p.waitForSelector('#screen-2.active');
    await p.click('#verdict-next-btn');
    await p.waitForSelector('#screen-3.active');
    await p.locator('#programs-dynamic details.doc-preview-wrap').first().click();
    const noDocumento = await p.locator('#programs-dynamic .doc-name').first().innerText();
    linha(ok(!/ANA PAULA/i.test(noDocumento), `documento do caso seguinte trouxe: "${noDocumento}"`),
      'o nome não atravessa para o documento do caso seguinte');

    // E a tela não pode ficar presa no modo impressão: em vários navegadores o
    // afterprint não dispara, e sem topbar nem botões o app parece quebrado.
    // §55: baixar exige nome do paciente. O caso anterior foi zerado de
    // propósito logo acima, então aqui o nome é preenchido — que é o caminho
    // real de quem vai assinar o pedido.
    await p.fill('#patient-name', 'Beatriz R. Souza');
    await p.dispatchEvent('#patient-name', 'input');
    await p.evaluate(() => { window.print = () => {}; });
    await p.evaluate(() => {
      const d = document.querySelector('#programs-dynamic details.doc-preview-wrap');
      downloadDoc(d.id);
    });
    const entrou = await p.evaluate(() => document.body.classList.contains('printing'));

    /* §57.4. A entrada escalonada dos cards usa `animation: ... both`, que
     * segura o elemento em opacity:0 enquanto o atraso corre. No modo
     * impressão isso vira folha em branco. A regra de @media print zera
     * animação e opacidade de TUDO dentro da tela — este teste mede o
     * resultado, elemento por elemento, em vez de confiar na regra. */
    /* §67. Esperar as animações assentarem antes de medir opacidade. A
     * entrada escalonada dos cards passa por opacidades intermediárias, e
     * medir no meio do voo acusa 0,98 como se fosse elemento apagado — ruído
     * que ensina a ignorar o teste. Animação infinita (o esqueleto pulsando)
     * fica de fora, senão a espera nunca termina. */
    await p.evaluate(() => Promise.all(
      document.getAnimations()
        .filter((a) => {
          const d = a.effect && a.effect.getTiming ? a.effect.getTiming() : {};
          return d.iterations !== Infinity;
        })
        .map((a) => a.finished.catch(() => {})),
    ));

    const invisiveis = await p.evaluate(() => {
      const tela = document.querySelector('.screen.active');
      if (!tela) return ['sem tela ativa'];
      const fora = [];
      tela.querySelectorAll('*').forEach((el) => {
        const cs = getComputedStyle(el);
        if (cs.display === 'none' || cs.visibility === 'hidden') return;
        if (parseFloat(cs.opacity) < 0.99) fora.push((el.id || el.className || el.tagName) + ' opacity=' + cs.opacity);
      });
      return fora;
    });
    linha(ok(invisiveis.length === 0, `elementos invisíveis no papel: ${invisiveis.slice(0, 3).join(' | ')}`),
      'nada fica invisível no modo impressão (PDF em branco)');

    /* §61. O OUTRO lado do mesmo problema: o que NÃO devia ir ao papel e vai.
     *
     * A regra de impressão escondia os elementos do card listando-os um a um
     * (`.program-card > h3`, `.program-row`, ...). Quando o §57.5 moveu o
     * título para dentro de `.prog-topo`, a lista deixou de alcançá-lo: a
     * pílula "indicado neste caso", o nome do teste e a frase de custo
     * passaram a sair IMPRESSOS acima do pedido que o médico assina — e o
     * card do segundo teste saía junto, sem documento nenhum.
     *
     * Lista de exceções é frágil por construção: ela esquece o elemento que
     * ainda não existe. Este teste não verifica a lista, verifica o PAPEL —
     * qualquer texto visível fora do documento alvo reprova, seja ele qual
     * for. Tudo numa avaliação só, porque trocar a mídia para 'print'
     * dispara afterprint, que desliga o modo. */
    await p.emulateMedia({ media: 'print' });
    const intrusos = await p.evaluate(() => {
      const alvo = document.querySelector('.doc-preview-wrap');
      alvo.open = true;
      document.querySelectorAll('.doc-preview-wrap').forEach((e) => e.classList.remove('print-target'));
      alvo.classList.add('print-target');
      document.body.classList.add('printing');
      /* §87. A faixa de conferência do CRM nasceu com o login (§85) e saiu
       * impressa acima do pedido. Aqui ela fica de pé de propósito, com o
       * texto real, porque é o caso que a bateria não via: no ambiente de
       * teste a conta nunca está em conferência e a faixa nem aparecia. */
      const faixaCrm = document.getElementById('aviso-crm');
      if (faixaCrm) {
        faixaCrm.hidden = false;
        document.getElementById('aviso-crm-texto').textContent = 'Seu CRM está em conferência no CFM.';
      }
      // Só o papel conta: o que estiver dentro do alvo mas fora do documento
      // (o resumo do <details>, "Editar campos") também é interface.
      const papel = alvo.querySelector('.doc-preview');

      const fora = [];
      document.querySelectorAll('body *').forEach((el) => {
        if (papel.contains(el) || el.contains(papel)) return;
        // getComputedStyle num descendente de ancestral display:none devolve
        // o display DECLARADO, não 'none' — ler só o próprio elemento acusa
        // como impressa a tela de acesso inteira, que está oculta. O que vale
        // é se o elemento ocupa área na página.
        const caixas = el.getClientRects();
        if (!caixas.length) return;
        const r = caixas[0];
        if (r.width === 0 || r.height === 0) return;
        // Fora do papel: o link "pular para o conteúdo" vive deslocado para
        // fora da tela e nunca chega à folha.
        if (r.bottom <= 0 || r.right <= 0) return;
        const cs = getComputedStyle(el);
        if (cs.visibility === 'hidden' || parseFloat(cs.opacity) === 0) return;
        /* Só o texto que é do PRÓPRIO elemento. A versão anterior olhava só
         * folhas (elemento sem filhos) e por isso não via "Programas por
         * teste": o rótulo é um <p> com um <span> decorativo dentro, então
         * não era folha, e o texto dele passava para o papel sem ninguém
         * acusar. Ver §87. */
        const txt = Array.from(el.childNodes)
          .filter((n) => n.nodeType === 3).map((n) => n.textContent).join(' ').trim();
        if (txt) fora.push(`${el.tagName}.${el.className || '-'}: "${txt.slice(0, 40)}"`);
      });
      return fora;
    });
    await p.emulateMedia({ media: 'screen' });
    linha(
      ok(intrusos.length === 0, `texto fora do documento sai impresso: ${intrusos.slice(0, 4).join(' | ')}`),
      'só a solicitação vai para o papel',
    );
    await p.waitForTimeout(1900);
    const saiu = !(await p.evaluate(() => document.body.classList.contains('printing')));
    linha(ok(entrou && saiu, `entrou=${entrou} saiu=${saiu}`), 'a tela sai do modo impressão sem depender do afterprint');
    await p.close();
  }

  /* ---------- §87. o pedido cabe em meia folha, e nunca em duas ---------- *
   * O dono imprimiu o pedido e recebeu duas folhas, com a assinatura sozinha
   * na segunda. Este teste imprime de verdade (o PDF que o Chromium gera é o
   * mesmo caminho do "Salvar como PDF") e confere três coisas:
   *   1. caso comum: o papel ocupa no máximo meia folha A4;
   *   2. nome e justificativa longos: continua UMA folha só;
   *   3. a assinatura está na mesma folha do resto.
   * Só no desktop: page.pdf() é igual nos dois contextos e a medida é do papel,
   * não da tela.
   * -------------------------------------------------------------------- */
  if (!dispositivo.isMobile) {
    const p = await ctx.newPage();
    p.on('pageerror', (e) => erros.push('folha: ' + e.message));
    await mockExtracao(p, { tipo_tumor: 'Ginecológico - Ovário', histologia: 'Seroso', grau: 'Alto grau', estadiamento: 'IVC', idade: '61' });
    await entrar(p);
    await p.fill('#case-text', 'caso');
    await p.click('#btn-extract');
    await p.waitForSelector('#screen-1.active');
    await p.click('#screen-1 button:has-text("Rodar")');
    await p.waitForSelector('#screen-2.active');
    await p.click('#verdict-next-btn');
    await p.waitForSelector('#screen-3.active');
    await p.fill('#patient-name', 'Maria Aparecida dos Santos Oliveira');
    await p.dispatchEvent('#patient-name', 'input');

    const { getDocumentProxy } = await import('unpdf');
    async function imprimir(longo) {
      await p.evaluate((longo) => {
        const alvo = document.querySelector('#programs-dynamic details.doc-preview-wrap');
        if (longo) {
          alvo.querySelector('.doc-name').textContent =
            'Maria Aparecida Conceição dos Santos de Albuquerque Cavalcanti Oliveira';
          const j = alvo.querySelector('.doc-justif span');
          j.textContent = (j.textContent + ' ').repeat(5).trim();
        }
        alvo.open = true;
        alvo.classList.add('print-target');
        document.body.classList.add('printing');
      }, longo);
      /* §90. Simula o navegador do dono: um que IGNORA a margem pedida pela
       * página (@page) e imprime de borda a borda. Com a margem só no
       * @page, o texto encostaria no papel aqui, e o teste reprovaria. */
      await p.addStyleTag({ content: '@page { margin: 0 !important; }' });
      // Medida no papel: altura do documento com a mídia de impressão.
      await p.emulateMedia({ media: 'print' });
      const alturaMm = await p.evaluate(() => {
        const papel = document.querySelector('.print-target .doc-preview');
        return papel.getBoundingClientRect().height * 25.4 / 96;
      });
      const pdf = await p.pdf({ format: 'A4', printBackground: true, preferCSSPageSize: true });
      await p.emulateMedia({ media: 'screen' });
      const doc = await getDocumentProxy(new Uint8Array(pdf));
      const ultima = await doc.getPage(doc.numPages);
      const textoUltima = (await ultima.getTextContent()).items.map((i) => i.str).join(' ');
      return { paginas: doc.numPages, alturaMm, assinaturaNaUltima: /Assinatura e carimbo/.test(textoUltima), textoUltima,
        margens: await margensDoPdf(doc) };
    }

    /* §90. Onde o texto começa e termina na folha, lido do próprio PDF. O dono
     * recebeu o pedido com o texto encostado na borda: a margem dependia do
     * @page, que há navegador que ignora. Agora a margem mora no documento, e
     * este teste mede o resultado no papel, não a regra. */
    async function margensDoPdf(doc) {
      const pag = await doc.getPage(1);
      const vp = pag.getViewport({ scale: 1 });
      const itens = (await pag.getTextContent()).items.filter((i) => i.str.trim());
      const mm = (pt) => pt * 25.4 / 72;
      let esq = Infinity; let dir = 0; let topo = Infinity;
      for (const i of itens) {
        esq = Math.min(esq, i.transform[4]);
        dir = Math.max(dir, i.transform[4] + i.width);
        topo = Math.min(topo, vp.height - i.transform[5] - i.height);
      }
      return { esquerda: mm(esq), direita: mm(vp.width - dir), topo: mm(topo) };
    }
    const margemOk = (m) => m.esquerda >= 15 && m.direita >= 15 && m.topo >= 12;
    const margemTxt = (m) => `esquerda ${m.esquerda.toFixed(1)}mm, direita ${m.direita.toFixed(1)}mm, topo ${m.topo.toFixed(1)}mm`;

    // Meia A4 = 148,5mm. A folha não tem margem própria (§90): a altura do
    // documento, já com a margem dele, é a distância do topo da folha até o
    // fim da assinatura. "Com folga": o teste pede 140mm.
    const comum = await imprimir(false);
    linha(ok(comum.paginas === 1 && comum.alturaMm <= 140,
      `caso comum: ${comum.paginas} folha(s), papel com ${Math.round(comum.alturaMm)}mm (limite 140mm)`),
    `pedido comum cabe em meia folha (${Math.round(comum.alturaMm)}mm)`);
    linha(ok(margemOk(comum.margens), `margens do pedido impresso pelo app: ${margemTxt(comum.margens)}`),
      `impresso pelo app: nada encosta na borda (${margemTxt(comum.margens)})`);

    // O outro caminho: o arquivo avulso que o app abre (ou baixa) fora dele,
    // impresso como o médico imprimiria. É o mesmo HTML que downloadDoc monta.
    const avulso = await p.evaluate(() => documentoAutocontido(
      document.querySelector('#programs-dynamic details.doc-preview-wrap')));
    const q = await ctx.newPage();
    await q.setContent(avulso);
    await q.addStyleTag({ content: '@page { margin: 0 !important; }' });
    const pdfAvulso = await q.pdf({ format: 'A4', printBackground: true, preferCSSPageSize: true });
    await q.close();
    const docAvulso = await getDocumentProxy(new Uint8Array(pdfAvulso));
    const mAvulso = await margensDoPdf(docAvulso);
    linha(ok(docAvulso.numPages === 1 && margemOk(mAvulso),
      `arquivo avulso: ${docAvulso.numPages} folha(s), ${margemTxt(mAvulso)}`),
    `arquivo baixado: uma folha, nada encosta na borda (${margemTxt(mAvulso)})`);

    const longo = await imprimir(true);
    linha(ok(margemOk(longo.margens), `margens com texto longo: ${margemTxt(longo.margens)}`),
      'nome e justificativa longos: nada passa da área útil');
    linha(ok(longo.paginas === 1 && longo.assinaturaNaUltima,
      `nome e justificativa longos: ${longo.paginas} folha(s), assinatura na folha certa=${longo.assinaturaNaUltima}`),
    `nome e justificativa longos: uma folha, com a assinatura (${Math.round(longo.alturaMm)}mm)`);
    await p.close();
  }

  /* ---------- corrigir o subtipo não pode apagar o que é comum ---------- */
  {
    const p = await ctx.newPage();
    p.on('pageerror', (e) => erros.push('subtipo: ' + e.message));
    await mockExtracao(p, { tipo_tumor: 'Ginecológico - Ovário', histologia: 'Seroso', grau: 'Alto grau', estadiamento: 'IIIC', idade: '61' });
    await entrar(p);
    await p.fill('#case-text', 'caso');
    await p.click('#btn-extract');
    await p.waitForSelector('#screen-1.active');
    await p.fill('#f-historico_familiar', 'mãe com câncer de mama aos 58');
    await p.selectOption('#field-subtipo', 'pulmao');
    await p.waitForTimeout(250);
    const idade = await p.inputValue('#f-idade');
    const hist = await p.inputValue('#f-historico_familiar');
    linha(ok(idade === '61' && /mãe/.test(hist), `idade="${idade}" histórico="${hist}"`),
      'corrigir o subtipo preserva idade e histórico familiar');
    await p.close();
  }

  /* ---------- 13b. instalar o aplicativo ---------- */
  {
    /* §65. Três estados, três comportamentos diferentes, e errar qualquer um
     * deles entrega ao médico um botão que mente:
     *   - Android com suporte: o botão instala de verdade.
     *   - iPhone: não existe API; o botão só pode ensinar o caminho manual.
     *   - Já instalado: não há o que oferecer, o botão some. */
    const p = await ctx.newPage();
    p.on('pageerror', (e) => erros.push('instalar: ' + e.message));
    await entrar(p);

    /* 1. Sem evento do sistema, só o iPhone oferece o botão — lá o caminho é
     *    manual e sempre existe. Em qualquer outro aparelho, nada a oferecer.
     *    O teste roda nos dois contextos, então pergunta ao app qual é. */
    const noIos = await p.evaluate(() => ehIOS());
    const aparece = await p.locator('#instalar-btn').isVisible();
    linha(ok(aparece === noIos, `iOS=${noIos} botão visível=${aparece}`),
      noIos ? 'iPhone → botão aparece mesmo sem API' : 'sem suporte a instalação → botão ausente');

    // 2. Android: o evento do sistema chega e o botão aparece.
    await p.evaluate(() => {
      const e = new Event('beforeinstallprompt');
      e.prompt = () => { window.__promptChamado = (window.__promptChamado || 0) + 1; return Promise.resolve(); };
      window.dispatchEvent(e);
    });
    await p.waitForTimeout(150);
    linha(ok(await p.locator('#instalar-btn').isVisible(), 'o botão não apareceu após o evento do sistema'),
      'Android → botão de instalar aparece');

    await p.click('#instalar-btn');
    await p.waitForSelector('#instalar.aberto');
    const temBotaoReal = await p.locator('#inst-instalar:visible').count();
    linha(ok(temBotaoReal === 1, 'com suporte, falta o botão que instala de fato'),
      'Android → oferece instalar de verdade');
    await p.click('#inst-instalar');
    await p.waitForTimeout(150);
    const chamou = await p.evaluate(() => window.__promptChamado || 0);
    linha(ok(chamou === 1, `prompt do sistema chamado ${chamou}x`), 'Android → o clique chama o instalador do sistema');
    // Um segundo clique não pode reusar um evento já consumido.
    const sumiu = await p.locator('#inst-instalar:visible').count();
    linha(ok(sumiu === 0, 'o botão de instalar continuou clicável depois de usado'),
      'o instalador do sistema não é chamado duas vezes');

    // 3. O passo a passo do iPhone precisa estar completo: lá ele É o
    //    mecanismo, não documentação de apoio.
    await p.click('#aba-ios');
    await p.waitForTimeout(120);
    const textoIos = await p.locator('#passos-ios').innerText();
    const temSafari = /safari/i.test(textoIos);
    const temCompartilhar = /compartilhar/i.test(textoIos);
    const temAdicionar = /adicionar à tela de início/i.test(textoIos);
    linha(
      ok(temSafari && temCompartilhar && temAdicionar, `safari=${temSafari} compartilhar=${temCompartilhar} adicionar=${temAdicionar}`),
      'iPhone → passo a passo nomeia Safari, compartilhar e Adicionar à Tela de Início',
    );
    const androidOculto = await p.locator('#passos-android').isVisible();
    linha(ok(androidOculto === false, 'os dois passo a passo aparecem ao mesmo tempo'),
      'uma aba por vez');
    await p.click('#inst-fechar');

    // 4. Já instalado: some.
    await p.evaluate(() => {
      Object.defineProperty(window.navigator, 'standalone', { value: true, configurable: true });
      atualizarBotaoInstalar();
    });
    await p.waitForTimeout(120);
    linha(ok((await p.locator('#instalar-btn').isVisible()) === false, 'o botão continua oferecendo instalar num app já instalado'),
      'já instalado → botão some');
    await p.close();
  }

  /* ---------- 13b2. instalar: computador, já instalado e navegador embutido ---------- */
  {
    /* §77. Três buracos do fluxo de instalação, e os três só apareciam fora
     * do percurso testado:
     *
     *  a) COMPUTADOR não tinha aba nenhuma, e o título dizia "no celular".
     *     O médico que usa a plataforma no consultório é exatamente quem
     *     mais ganha com ela em janela própria.
     *  b) JÁ INSTALADO abria o passo a passo de instalação — ruído puro.
     *  c) NAVEGADOR EMBUTIDO é o modo de falhar que nunca vira reclamação:
     *     o médico recebe o link por WhatsApp ou LinkedIn, abre dentro do
     *     aplicativo de mensagem, e dali não há instalação possível. Sem
     *     aviso, ele procura um botão que não existe e conclui que a
     *     plataforma está quebrada. */
    const p = await ctx.newPage();
    p.on('pageerror', (e) => erros.push('instalar-2: ' + e.message));
    await entrar(p);
    await p.evaluate(() => { window.__abrir = () => abrirInstalar(); });

    // (a) A aba de computador existe e nomeia o caminho real.
    await p.evaluate(() => window.__abrir());
    await p.waitForTimeout(150);
    await p.click('#aba-computador');
    await p.waitForTimeout(120);
    const textoPc = await p.locator('#passos-computador').innerText();
    const temNavegador = /chrome/i.test(textoPc) && /edge/i.test(textoPc);
    const temBarra = /barra de endereço/i.test(textoPc);
    linha(ok(temNavegador && temBarra, `chrome+edge=${temNavegador} barra=${temBarra}`),
      'computador → passo a passo nomeia Chrome, Edge e a barra de endereço');
    const soUmaAberta = await p.evaluate(() => Array.from(document.querySelectorAll('#instalar .modal-passos')).filter((el) => !el.hidden).length);
    linha(ok(soUmaAberta === 1, `${soUmaAberta} passo a passo visíveis ao mesmo tempo`),
      'com três abas, continua uma por vez');
    // O título não pode mais excluir quem está no computador.
    const titulo = await p.locator('#inst-titulo').innerText();
    linha(ok(!/celular/i.test(titulo), `o título ainda diz "${titulo}"`),
      'o título do modal não exclui quem está no computador');
    await p.click('#inst-fechar');

    // (b) Já instalado: confirmação no lugar do passo a passo.
    await p.evaluate(() => {
      Object.defineProperty(window.navigator, 'standalone', { value: true, configurable: true });
      window.__abrir();
    });
    await p.waitForTimeout(150);
    const instalado = await p.evaluate(() => ({
      pronto: !document.getElementById('inst-pronto').hidden,
      abas: !document.getElementById('inst-abas').hidden,
      passos: Array.from(document.querySelectorAll('#instalar .modal-passos')).filter((el) => !el.hidden).length,
      botao: !document.getElementById('inst-instalar').hidden,
      // Os outros modais não podem ser atingidos de carona: `.modal-passos`
      // também monta a privacidade e as boas-vindas.
      forasteiros: Array.from(document.querySelectorAll('.modal-passos:not(#instalar .modal-passos)')).filter((el) => el.hidden).length,
    }));
    linha(ok(instalado.pronto && !instalado.abas && instalado.passos === 0 && !instalado.botao,
      JSON.stringify(instalado)),
      'já instalado → confirmação no lugar do passo a passo');
    linha(ok(instalado.forasteiros === 0, `${instalado.forasteiros} passo(s) de outros modais foram escondidos junto`),
      'e os passos dos outros modais ficam intactos');
    await p.click('#inst-fechar');
    await p.close();

    // (c) Navegador embutido: aviso presente, e ausente no navegador normal.
    const ua = dispositivo.userAgent || '';
    const ctxEmbutido = await browser.newContext({
      ...dispositivo,
      userAgent: ua + ' [FBAN/FBIOS;FBAV/450.0.0]',
    });
    const q = await ctxEmbutido.newPage();
    q.on('pageerror', (e) => erros.push('embutido: ' + e.message));
    await entrar(q);
    linha(ok(await q.locator('#instalar-btn').isVisible(),
      'no navegador embutido o botão some, e com ele o único lugar onde cabe explicar o bloqueio'),
      'navegador embutido → o botão continua à vista');
    await q.evaluate(() => abrirInstalar());
    await q.waitForTimeout(150);
    const aviso = await q.locator('#inst-embutido');
    linha(ok(await aviso.isVisible(), 'o aviso de navegador embutido não apareceu'),
      'navegador embutido → avisa que dali não dá para instalar');
    const textoAviso = await aviso.innerText();
    linha(ok(/navegador|safari/i.test(textoAviso) && /menu/i.test(textoAviso), textoAviso.slice(0, 80)),
      'e diz o que fazer: abrir pelo menu, no navegador');
    /* §77. O aviso tem de estar NA TELA quando o modal abre. `focus()` rola o
     * elemento focado para a vista, e "Fechar" mora no pé do modal: sem
     * cuidado, o painel abria já rolado até embaixo e a mensagem mais
     * importante da tela nascia fora dela. */
    const avisoNaTela = await q.evaluate(() => {
      const r = document.getElementById('inst-embutido').getBoundingClientRect();
      return r.top >= -1 && r.top < window.innerHeight * 0.6;
    });
    linha(ok(avisoNaTela, 'o modal abriu rolado e o aviso de bloqueio nasceu fora da tela'),
      'e o aviso aparece sem precisar rolar');
    await q.close();
    await ctxEmbutido.close();

    const r = await ctx.newPage();
    r.on('pageerror', (e) => erros.push('nao-embutido: ' + e.message));
    await entrar(r);
    await r.evaluate(() => abrirInstalar());
    await r.waitForTimeout(150);
    linha(ok((await r.locator('#inst-embutido').isVisible()) === false,
      'o aviso de navegador embutido aparece em navegador comum'),
      'navegador comum → nenhum aviso de bloqueio');
    await r.close();
  }

  /* ---------- 13c. animações não podem apagar conteúdo ---------- */
  {
    /* §67. A regra das animações do app: O ESTADO DE REPOUSO É O VISÍVEL.
     * Nenhum elemento nasce escondido esperando a animação revelá-lo. Se a
     * animação não roda — "reduzir movimento", aba em segundo plano,
     * impressão —, conteúdo clínico não pode sumir.
     *
     * O teste DESLIGA as animações e exige que tudo continue visível, em vez
     * de confiar que cada keyframe foi escrito certo. */
    const p = await ctx.newPage();
    p.on('pageerror', (e) => erros.push('animacao: ' + e.message));
    await p.emulateMedia({ reducedMotion: 'reduce' });
    await mockExtracao(p, { tipo_tumor: 'Ginecológico - Ovário', histologia: 'Seroso', grau: 'Alto grau', estadiamento: 'IIIC', idade: '61' });
    await entrar(p);
    await p.fill('#case-text', 'caso de ovário');
    await p.click('#btn-extract');
    await p.waitForSelector('#screen-1.active');
    await p.click('button:has-text("Rodar triagem")');
    await p.waitForSelector('#screen-2.active');
    await p.waitForTimeout(250);

    const apagados = await p.evaluate(() => {
      const fora = [];
      const checar = (sel, nome) => {
        document.querySelectorAll(sel).forEach((el) => {
          const r = el.getBoundingClientRect();
          const cs = getComputedStyle(el);
          if (r.width < 1 || r.height < 1) { fora.push(`${nome}: sem área`); return; }
          if (parseFloat(cs.opacity) < 0.99) fora.push(`${nome}: opacity ${cs.opacity}`);
          // scale(0) some sem mexer em opacidade — é o modo como o nó
          // numerado e o trilho desapareciam no protótipo.
          if (/matrix\(0|scale\(0/.test(cs.transform)) fora.push(`${nome}: transform ${cs.transform}`);
        });
      };
      checar('#test-steps .step-num', 'nó da sequência');
      checar('#verdict-title', 'título do veredito');
      checar('#verdict-text', 'texto do veredito');
      return fora;
    });
    linha(ok(apagados.length === 0, `invisível com movimento reduzido: ${apagados.slice(0, 3).join(' | ')}`),
      'com movimento reduzido, nada de clínico some da tela');

    // §88. O bloco da contagem também entra com movimento, e também não pode
    // sumir quando o movimento está desligado.
    const contagem = await p.evaluate(() => {
      const el = document.getElementById('verdict-glyph');
      const cs = getComputedStyle(el);
      return { opacidade: cs.opacity, transform: cs.transform, texto: el.textContent.trim() };
    });
    linha(ok(parseFloat(contagem.opacidade) > 0.99 && !/matrix\(0|scale\(0/.test(contagem.transform) && contagem.texto,
      `contagem: ${JSON.stringify(contagem)}`),
    'a contagem em destaque continua visível sem animação');
    await p.close();
  }

  /* ---------- 13c-bis. §89: a tela de programas não mostra critério ---------- */
  {
    /* Decisão do dono: nenhum critério de elegibilidade aparece, nem à vista
     * nem recolhido, porque quem informa o médico é o próprio programa. Sai
     * também a data de conferência e qualquer menção a "parceiro". O teste
     * olha a tela inteira de programas, inclusive o que estiver dentro de
     * um <details> fechado (textContent), e usa o caso de ovário, que é o
     * que trazia o critério mais longo (GSK). */
    const p = await ctx.newPage();
    p.on('pageerror', (e) => erros.push('programas: ' + e.message));
    await mockExtracao(p, { tipo_tumor: 'Ginecológico - Ovário', histologia: 'Seroso', grau: 'Alto grau', estadiamento: 'IIIC', idade: '61' });
    await entrar(p);
    await p.fill('#case-text', 'caso de ovário');
    await p.click('#btn-extract');
    await p.waitForSelector('#screen-1.active');
    await p.click('button:has-text("Rodar triagem")');
    await p.waitForSelector('#screen-2.active');
    await p.click('#verdict-next-btn');
    await p.waitForSelector('#screen-3.active');

    const tela = await p.evaluate(() => {
      const linhas = Array.from(document.querySelectorAll('#programs-dynamic .program-row'));
      return {
        quantas: linhas.length,
        texto: linhas.map((l) => l.textContent.replace(/\s+/g, ' ')).join(' | '),
        nomes: linhas.map((l) => l.querySelector('.name').firstChild.textContent.trim()),
      };
    });
    const PROIBIDOS = [/Elegível/i, /ALTO GRAU/, /PRIMEIRA LINHA/i, /Ver critério/i, /conferida em/i, /parceir/i,
      /reteste/i, /biópsia líquida/i, /não é programa patrocinado/i];
    const achados = PROIBIDOS.filter((re) => re.test(tela.texto)).map(String);
    linha(ok(tela.quantas >= 3, `só ${tela.quantas} programa(s) na tela, o teste não mediria nada`),
      'a tela de programas lista os programas do caso');
    linha(ok(achados.length === 0, `aparece na tela de programas: ${achados.join(', ')}`),
      'nenhum critério, data ou "parceiro" aparece nos programas');
    linha(ok(tela.nomes.includes('Life Genomics'), `nomes: ${tela.nomes.join(' / ')}`),
      'o germinativo aparece só como "Life Genomics"');

    /* §92. Fleury e Dasa depois da Life, nessa ordem, no germinativo. */
    const posLife = tela.nomes.indexOf('Life Genomics');
    linha(ok(posLife >= 0 && tela.nomes[posLife + 1] === 'Fleury Genômica' && tela.nomes[posLife + 2] === 'Dasa Genômica',
      `ordem: ${tela.nomes.join(' / ')}`),
    'Fleury Genômica e Dasa Genômica vêm depois da Life Genomics');

    /* §92. Ícone, nome com selo e botão centrados na mesma linha. Mede o
     * centro vertical de cada caixa; no celular o botão desce para a linha
     * de baixo, então a conta vale para ícone e nome. Inclui um nome longo
     * de propósito, para ver que a quebra não desalinha. */
    const desalinhados = await p.evaluate(() => {
      const fora = [];
      const linhasProg = Array.from(document.querySelectorAll('#programs-dynamic .program-row'));
      const longo = linhasProg[0].querySelector('.name').firstChild;
      const original = longo.textContent;
      longo.textContent = 'Programa com um nome bem comprido para obrigar a quebra de linha (Indústria)';
      linhasProg.forEach((l) => {
        const centro = (el) => { const r = el.getBoundingClientRect(); return r.top + r.height / 2; };
        const logo = l.querySelector('.logo');
        const nome = l.querySelector('.who > div');
        const acao = l.querySelector(':scope > a.link, :scope > .link-ausente');
        const nomeTxt = l.querySelector('.name').textContent.trim().slice(0, 24);
        if (Math.abs(centro(logo) - centro(nome)) > 2) fora.push(`${nomeTxt}: ícone e nome a ${Math.round(Math.abs(centro(logo) - centro(nome)))}px`);
        const naMesmaLinha = acao && Math.abs(acao.getBoundingClientRect().top - nome.getBoundingClientRect().top) < nome.getBoundingClientRect().height;
        if (acao && naMesmaLinha && Math.abs(centro(acao) - centro(nome)) > 2) fora.push(`${nomeTxt}: botão e nome a ${Math.round(Math.abs(centro(acao) - centro(nome)))}px`);
      });
      longo.textContent = original;
      return fora;
    });
    linha(ok(desalinhados.length === 0, desalinhados.slice(0, 3).join(' | ')),
      'ícone, nome e botão do programa centrados na mesma linha');
    await p.close();
  }

  /* ---------- 13d. o esqueleto da leitura sai sempre ---------- */
  {
    /* §67. O esqueleto pulsa enquanto o laudo é lido. Se ele ficar preso
     * depois de uma falha, a tela pulsa para sempre por cima de uma mensagem
     * de erro — pior que não ter indicador nenhum. */
    const p = await ctx.newPage();
    p.on('pageerror', (e) => erros.push('esqueleto: ' + e.message));
    await entrar(p);
    await p.route('**/api/extract', (r) => r.fulfill({ status: 500, contentType: 'application/json', body: '{"error":"falha simulada"}' }));
    await p.fill('#case-text', 'caso que vai falhar');
    await p.click('#btn-extract');
    await p.waitForTimeout(900);
    const preso = await p.evaluate(() => document.body.classList.contains('lendo-caso'));
    const esqueletoVisivel = await p.locator('#esqueleto-leitura:visible').count();
    linha(ok(preso === false && esqueletoVisivel === 0, `classe=${preso} visível=${esqueletoVisivel}`),
      'leitura falhou → o esqueleto sai da tela');
    await p.close();
  }

  /* ---------- 13e. o texto de exemplo cabe no campo ---------- */
  {
    /* §71. O exemplo do compositor vinha CORTADO no meio da última linha no
     * celular: o campo não tinha altura para ele. A correção foi fonte um
     * degrau menor e mais altura — mas a regra ficou ANTES da regra base no
     * arquivo, e media query não aumenta especificidade: não valeu nada.
     *
     * E quase passou, porque `scrollHeight` de uma textarea VAZIA ignora o
     * texto de exemplo — a primeira medição disse "não está cortado" sobre
     * um campo que estava. O teste põe o exemplo como valor para medir, e
     * devolve o campo ao estado anterior. */
    const p = await ctx.newPage();
    p.on('pageerror', (e) => erros.push('exemplo: ' + e.message));
    await entrar(p);
    /* §72. A primeira versão deste teste era VAZIA, pela segunda vez no mesmo
     * campo. Ela media `scrollHeight` com o `min-height` em vigor — e
     * scrollHeight nunca é menor que a altura da caixa. O número que voltava
     * era o piso da própria caixa, então "precisa <= cabe" era verdade
     * sempre, com qualquer conteúdo e qualquer altura.
     *
     * Para medir o texto é preciso TIRAR o piso: min-height e height a zero,
     * o exemplo como valor, medir, e devolver tudo. Só aí o número é do
     * texto. */
    const medida = await p.evaluate(() => {
      const t = document.getElementById('case-text');
      const exemplo = t.placeholder;
      const vAntes = t.value;
      const minAntes = t.style.minHeight;
      const hAntes = t.style.height;
      t.style.minHeight = '0px';
      t.style.height = '0px';
      t.value = exemplo;
      const precisa = t.scrollHeight;
      t.style.minHeight = minAntes;
      t.style.height = hAntes;
      t.value = vAntes;
      return { cabe: t.clientHeight, precisa, palavras: exemplo.trim().split(/\s+/).length };
    });
    linha(
      ok(medida.precisa <= medida.cabe + 2, `o exemplo precisa de ${medida.precisa}px e o campo tem ${medida.cabe}px`),
      'o texto de exemplo cabe inteiro no campo',
    );
    /* O outro lado, que é a queixa do dono: caixa grande com texto pequeno
     * dentro parece inacabada. Meia dúzia de linhas de folga é vazio, não
     * espaço para escrever — quem cola um laudo inteiro rola de qualquer
     * jeito. O teto é generoso de propósito: é defeito grosseiro que ele
     * pega, não ajuste fino. */
    const folga = medida.cabe - medida.precisa;
    linha(ok(folga <= 30, `${folga}px de vazio no campo (caixa ${medida.cabe}px, texto ${medida.precisa}px)`),
      'a caixa do compositor não sobra vazio em volta do texto');
    linha(ok(medida.palavras >= 20, `só ${medida.palavras} palavras — o exemplo encolheu e deixaria de instruir`),
      'o exemplo continua nomeando o que colar');
    await p.close();
  }

  /* ---------- 13f. o rodapé legal do acesso é um bloco, não três avisos ---------- */
  {
    /* §71. `.gate-legal` tinha `padding-top: 26px`, e são TRÊS elementos
     * empilhados: dois parágrafos e o "Sobre esta versão". 26px entre frases
     * que formam um bloco só as faz parecer avisos soltos. O afastamento é
     * do bloco; dentro dele, as linhas respiram pouco. */
    // Contexto PRÓPRIO: as abas acima compartilham o localStorage e já têm
    // sessão, então a tela de acesso não apareceria nelas.
    const ctxLimpo = await browser.newContext(dispositivo);
    const p = await ctxLimpo.newPage();
    p.on('pageerror', (e) => erros.push('rodape-legal: ' + e.message));
    await p.goto(BASE);
    await p.waitForSelector('#acesso-name', { state: 'visible' });
    await p.waitForTimeout(300);
    const vaos = await p.evaluate(() => {
      const itens = Array.from(document.querySelectorAll('.gate-legal'))
        .filter((el) => el.getClientRects().length);
      const fora = [];
      for (let i = 1; i < itens.length; i++) {
        const anterior = itens[i - 1].getBoundingClientRect();
        const atual = itens[i].getBoundingClientRect();
        /* O vão que o olho vê é da ÚLTIMA LINHA de texto de um até a
         * PRIMEIRA do seguinte. `padding-top` mora DENTRO da caixa, então
         * `top - bottom` dá zero mesmo com 26px de respiro — a primeira
         * versão deste teste media exatamente isso e teria passado com
         * qualquer espaçamento. O padding do elemento seguinte entra na
         * conta, e o de baixo do anterior também. */
        const padCima = parseFloat(getComputedStyle(itens[i]).paddingTop) || 0;
        const padBaixo = parseFloat(getComputedStyle(itens[i - 1]).paddingBottom) || 0;
        fora.push(Math.round((atual.top - anterior.bottom) + padCima + padBaixo));
      }
      return { quantos: itens.length, vaos: fora };
    });
    linha(ok(vaos.quantos >= 2, `só ${vaos.quantos} linha(s) legal(is) — o teste não mediria nada`),
      'o rodapé legal tem mais de uma linha');
    const folgado = vaos.vaos.filter((v) => v > 14);
    linha(ok(folgado.length === 0, `vãos de ${vaos.vaos.join(', ')}px entre linhas do mesmo bloco`),
      'as linhas do rodapé legal ficam juntas como um bloco');
    await p.close();
    await ctxLimpo.close();
  }

  /* ---------- 13g. uma borda de texto só, nas quatro telas ---------- */
  {
    /* §74. "Essa parte de design eu sou muito crítico, queria sempre que
     * você tivesse essa atenção para todas as áreas." — o dono, depois de
     * notar o "Como funciona" 2px fora da borda dos demais.
     *
     * Dois pixels bastam para o olho registrar desalinho sem saber por quê,
     * e atenção humana não escala para quatro telas a cada mudança. A regra
     * vira teste: no nível da página, todo elemento começa na MESMA borda de
     * texto. Conteúdo dentro de uma superfície recua — é o inset dela, e por
     * isso superfícies ficam de fora da conta. */
    const p = await ctx.newPage();
    p.on('pageerror', (e) => erros.push('alinhamento: ' + e.message));
    await mockExtracao(p, { tipo_tumor: 'Ginecológico - Ovário', histologia: 'Seroso', grau: 'Alto grau', estadiamento: 'IIIC', idade: '61', nome_paciente: 'Maria S. Oliveira' });
    await entrar(p);
    await p.fill('#case-text', 'caso de ovário');
    await p.click('#btn-extract');
    await p.waitForSelector('#screen-1.active');
    await p.click('button:has-text("Rodar triagem")');
    await p.waitForSelector('#screen-2.active');
    await p.click('#verdict-next-btn');
    await p.waitForSelector('#screen-3.active');

    const desalinhados = await p.evaluate(() => {
      const fora = [];
      document.querySelectorAll('.screen').forEach((tela, i) => {
        const era = tela.classList.contains('active');
        if (!era) tela.classList.add('active');

        const bordas = [];
        const sangrias = [];
        Array.from(tela.children).forEach((el) => {
          if (!el.getClientRects().length) return;
          const cs = getComputedStyle(el);
          const r = el.getBoundingClientRect();
          const nome = el.tagName.toLowerCase() + (el.className ? '.' + String(el.className).split(' ')[0] : '');
          // O que o olho lê como início do texto: a caixa, mais a borda
          // pintada, mais o padding. Medir só `left` dava o número certo por
          // acidente enquanto ninguém tinha padding, e erado assim que alguém
          // tivesse.
          const inicioDoTexto = r.left + (parseFloat(cs.borderLeftWidth) || 0) + (parseFloat(cs.paddingLeft) || 0);
          // Superfície (fundo pintado ou borda) tem inset próprio: o texto
          // dela recua de propósito e não entra na conta da borda da página.
          const temFundo = cs.backgroundColor !== 'rgba(0, 0, 0, 0)' && cs.backgroundColor !== 'transparent';
          const temBorda = parseFloat(cs.borderTopWidth) > 0 || parseFloat(cs.borderLeftWidth) > 0;
          if (temFundo || temBorda) { sangrias.push({ el: nome, caixa: Math.round(r.left), x: Math.round(inicioDoTexto) }); return; }
          bordas.push({ el: nome, x: Math.round(inicioDoTexto) });
        });

        if (bordas.length < 2) { if (!era) tela.classList.remove('active'); return; }
        // A borda da página é a mais frequente; o que destoa dela é o defeito.
        const contagem = new Map();
        bordas.forEach((b) => contagem.set(b.x, (contagem.get(b.x) || 0) + 1));
        const referencia = [...contagem.entries()].sort((a, b) => b[1] - a[1])[0][0];
        bordas.forEach((b) => {
          if (Math.abs(b.x - referencia) > 1) {
            fora.push(`tela ${i}: ${b.el} começa em ${b.x}px, e a borda da página é ${referencia}px`);
          }
        });
        /* §75. Uma superfície que SANGRA — que começa antes da coluna de
         * texto, encostando na borda da tela — não é um cartão: é uma faixa.
         * Cartão pode recuar o próprio conteúdo, porque a caixa dele já
         * marca onde o conteúdo começa. Faixa não tem essa caixa visível de
         * um lado nem do outro, então o único lugar onde o texto dela pode
         * nascer é a prumada da página. Era exatamente aqui que a faixa de
         * cobertura destoava: a caixa na borda certa, o texto 15px adiante,
         * e a conta antiga nem olhava porque "é superfície". */
        sangrias.forEach((s) => {
          if (s.caixa < referencia - 1 && Math.abs(s.x - referencia) > 1) {
            fora.push(`tela ${i}: a faixa ${s.el} sangra até ${s.caixa}px mas nasce o texto em ${s.x}px, fora da prumada de ${referencia}px`);
          }
        });
        if (!era) tela.classList.remove('active');
      });
      return fora;
    });

    linha(ok(desalinhados.length === 0, desalinhados.slice(0, 4).join(' | ')),
      'uma borda de texto só, nas quatro telas');
    await p.close();
  }

  /* ---------- 13h. "Como funciona" pertence à faixa que explica ---------- */
  {
    /* §75. "As duas palavras em azul que a gente colocou embaixo,
     * completamente distante da caixa." — o dono.
     *
     * O defeito não era o vão em si: era o vão de BAIXO ser maior que o de
     * CIMA. Um rótulo mais perto do que vem depois do que do que vem antes
     * muda de dono aos olhos de quem lê, e passa a parecer legenda do campo
     * de texto. A regra é de proximidade, não de pixels: o link fica mais
     * perto da faixa que explica do que do compositor. */
    const p = await ctx.newPage();
    p.on('pageerror', (e) => erros.push('proximidade: ' + e.message));
    await entrar(p);
    const v = await p.evaluate(() => {
      const r = (s) => document.querySelector(s).getBoundingClientRect();
      const faixa = r('.cobertura');
      const link = r('.cobertura-ajuda');
      const campo = r('#dropzone');
      return { acima: +(link.top - faixa.bottom).toFixed(1), abaixo: +(campo.top - link.bottom).toFixed(1) };
    });
    linha(ok(v.acima < v.abaixo, `${v.acima}px acima do link e ${v.abaixo}px abaixo — ele pertence ao campo, não à faixa`),
      'o "Como funciona" fica mais perto da faixa que explica');
    linha(ok(v.acima <= 8, `${v.acima}px entre a faixa e o link`),
      'o link encosta na faixa, sem flutuar no meio do caminho');
    await p.close();
  }

  /* ---------- 13h2. o documento assinado não corrompe nem esvazia ---------- */
  {
    /* §81. Dois defeitos no PAPEL, que é onde menos se pode errar, e os dois
     * invisíveis na tela:
     *
     * a) O nome do gene era destruído. A justificativa impressa emenda os
     *    testes prévios numa frase e rebaixava a inicial — "BRCA germinativo
     *    negativo" virava "bRCA germinativo negativo". O §47.6 já tinha
     *    corrigido o toLowerCase() GLOBAL pelo mesmo motivo; sobrou o caso
     *    mais comum, porque o texto quase sempre começa pelo gene. Some da
     *    tela, porque a tela mostra a justificativa sem esse prefixo.
     *
     * b) "Editar campos" torna editável toda célula, inclusive a
     *    justificativa clínica, e era possível apagá-la e baixar assim mesmo:
     *    papel com a marca da plataforma, justificativa em branco e a
     *    assinatura do médico embaixo. O §55 já estabeleceu a regra para o
     *    nome do paciente ("documento assinado sem paciente não é um
     *    rascunho"); faltava aplicá-la aqui. */
    const p = await ctx.newPage();
    p.on('pageerror', (e) => erros.push('documento: ' + e.message));
    await mockExtracao(p, {
      tipo_tumor: 'Mama', subtipo_molecular: 'Triplo-negativo',
      extensao_doenca: 'Inicial (operável)', idade: '44',
      testes_previos: 'BRCA germinativo negativo em 2021 (Invitae)',
      nome_paciente: 'Joana P. Lima',
    });
    await entrar(p);
    await p.fill('#case-text', 'caso de mama');
    await p.click('#btn-extract');
    await p.waitForSelector('#screen-1.active');
    await p.click('button:has-text("Rodar triagem")');
    await p.waitForSelector('#screen-2.active');
    await p.click('#verdict-next-btn');
    await p.waitForSelector('#screen-3.active');
    await p.fill('#patient-name', 'Joana P. Lima');
    await p.waitForTimeout(300);
    await p.locator('#programs-dynamic details.doc-preview-wrap').first().click();
    await p.waitForTimeout(200);

    const textoDoc = await p.locator('#programs-dynamic .doc-justif').first().innerText();
    linha(ok(/BRCA/.test(textoDoc) && !/bRCA/.test(textoDoc),
      `a justificativa impressa saiu com "${(/b?RCA\w*/i.exec(textoDoc) || ['?'])[0]}"`),
      'o nome do gene chega inteiro ao documento assinado');

    // (b) justificativa apagada à mão não pode virar PDF.
    const barrou = await p.evaluate(() => {
      let imprimiu = false;
      window.print = () => { imprimiu = true; };
      const alvo = document.querySelector('#programs-dynamic details.doc-preview-wrap');
      const campo = alvo.querySelector('.doc-justif span');
      campo.textContent = '   ';
      downloadDoc(alvo.id);
      return !imprimiu;
    });
    linha(ok(barrou, 'documento com justificativa clínica em branco foi para o papel'),
      'justificativa apagada barra o download, como já acontece com o nome');
    await p.close();
  }

  /* ---------- 13i. a revelação ao rolar nunca esconde conteúdo ---------- */
  {
    /* §76. A revelação ao rolar é a única animação do app que trabalha
     * ESCONDENDO para depois mostrar. Numa ferramenta clínica isso é a
     * manobra mais perigosa que existe — já custou um PDF em branco e um
     * critério de exclusão ilegível durante a própria animação que existia
     * para destacá-lo.
     *
     * Três travas, nos três modos de falhar:
     *  a) nada nasce escondido no HTML — o estado escondido só é posto pelo
     *     script, depois que o observador que o desfaz está de pé;
     *  b) o que o médico rolou até ver está opaco de verdade;
     *  c) com "reduzir movimento", ninguém chega a ser escondido. */
    const p = await ctx.newPage();
    p.on('pageerror', (e) => erros.push('revelacao: ' + e.message));
    await mockExtracao(p, { tipo_tumor: 'Ginecológico - Ovário', histologia: 'Seroso', grau: 'Alto grau', estadiamento: 'IIIC', idade: '61' });
    await entrar(p);

    // (a) O HTML servido não pode trazer a classe que esconde.
    const fonte = await (await fetch(BASE + '/index.html')).text();
    linha(ok(!/class="[^"]*\brevela\b/.test(fonte), 'o index.html já nasce com a classe que esconde'),
      'nada nasce escondido no HTML servido');

    await p.fill('#case-text', 'caso de ovário');
    await p.click('#btn-extract');
    await p.waitForSelector('#screen-1.active');
    await p.click('button:has-text("Rodar triagem")');
    await p.waitForSelector('#screen-2.active');
    await p.click('#verdict-next-btn');
    await p.waitForSelector('#screen-3.active');

    // (b) Rola a tela inteira e mede: nada que o médico alcança fica apagado.
    const apagados = await p.evaluate(async () => {
      const espera = (ms) => new Promise((r) => setTimeout(r, ms));
      const alvos = () => Array.from(document.querySelectorAll('.screen.active .test-step, .screen.active #programs-dynamic > .card, .screen.active .disclaimer, .screen.active .secao'))
        .filter((el) => !el.hidden && el.getBoundingClientRect().height > 0);
      const fora = [];
      const passo = Math.round(window.innerHeight * 0.8);
      for (let y = 0; y < document.body.scrollHeight; y += passo) {
        window.scrollTo({ top: y, behavior: 'instant' });
        await espera(700);
        alvos().forEach((el) => {
          const r = el.getBoundingClientRect();
          const naTela = r.bottom > 0 && r.top < window.innerHeight;
          if (!naTela) return;
          const o = parseFloat(getComputedStyle(el).opacity);
          if (o < 0.99) fora.push(`${el.className.split(' ')[0]} com opacidade ${o.toFixed(2)}`);
        });
      }
      return [...new Set(fora)];
    });
    linha(ok(apagados.length === 0, apagados.slice(0, 3).join(' | ')),
      'nada que o médico rolou até ver fica apagado');
    await p.close();

    // (c) Com "reduzir movimento", ninguém chega a ser escondido.
    const ctxCalmo = await browser.newContext({ ...dispositivo, reducedMotion: 'reduce' });
    const q = await ctxCalmo.newPage();
    q.on('pageerror', (e) => erros.push('revelacao-calma: ' + e.message));
    await mockExtracao(q, { tipo_tumor: 'Ginecológico - Ovário', histologia: 'Seroso', grau: 'Alto grau', estadiamento: 'IIIC', idade: '61' });
    await entrar(q);
    await q.fill('#case-text', 'caso de ovário');
    await q.click('#btn-extract');
    await q.waitForSelector('#screen-1.active');
    await q.click('button:has-text("Rodar triagem")');
    await q.waitForSelector('#screen-2.active');
    await q.click('#verdict-next-btn');
    await q.waitForSelector('#screen-3.active');
    const escondidos = await q.evaluate(() => document.querySelectorAll('.revela').length);
    linha(ok(escondidos === 0, `${escondidos} elemento(s) escondidos mesmo com movimento reduzido`),
      'com movimento reduzido, nada chega a ser escondido');
    await q.close();
    await ctxCalmo.close();
  }

  /* ---------- 13j. cabeçalho de seção nunca anuncia seção vazia ---------- */
  {
    /* §76. Cabeçalho sem nada embaixo é pior que nenhum cabeçalho: promete uma
     * seção que não existe, e numa tela clínica o médico fica procurando o
     * que não foi indicado. A regra é de RELAÇÃO, não de caso: o cabeçalho
     * está visível se, e somente se, a lista que ele anuncia tem conteúdo. */
    const p = await ctx.newPage();
    p.on('pageerror', (e) => erros.push('secao: ' + e.message));
    await mockExtracao(p, { tipo_tumor: 'Ginecológico - Ovário', histologia: 'Seroso', grau: 'Alto grau', estadiamento: 'IIIC', idade: '61' });
    await entrar(p);

    const conferir = () => p.evaluate(() => {
      /* §88. A tela de resultado não tem mais cabeçalho "O que solicitar": o
       * veredito virou o cabeçalho do painel. A regra continua valendo para
       * a lista de testes em si, que some quando está vazia. */
      const par = [['test-steps', 'test-steps'], ['secao-programas', 'programs-dynamic']];
      return par.map(([idSecao, idLista]) => {
        const s = document.getElementById(idSecao);
        const l = document.getElementById(idLista);
        return { secao: idSecao, visivel: !!(s && !s.hidden), temConteudo: !!(l && l.children.length > 0) };
      });
    });

    // Antes de qualquer triagem as duas listas estão vazias.
    const antes = await conferir();
    const erradosAntes = antes.filter((x) => x.visivel !== x.temConteudo);
    linha(ok(erradosAntes.length === 0, erradosAntes.map((x) => x.secao).join(', ')),
      'sem triagem, nenhum cabeçalho de seção aparece');

    await p.fill('#case-text', 'caso de ovário');
    await p.click('#btn-extract');
    await p.waitForSelector('#screen-1.active');
    await p.click('button:has-text("Rodar triagem")');
    await p.waitForSelector('#screen-2.active');
    await p.click('#verdict-next-btn');
    await p.waitForSelector('#screen-3.active');

    const depois = await conferir();
    const erradosDepois = depois.filter((x) => x.visivel !== x.temConteudo);
    linha(ok(erradosDepois.length === 0, erradosDepois.map((x) => `${x.secao}: visível=${x.visivel} conteúdo=${x.temConteudo}`).join(' | ')),
      'com triagem, cada cabeçalho acompanha a própria lista');
    linha(ok(depois.every((x) => x.visivel), 'nenhum cabeçalho apareceu mesmo com lista cheia'),
      'as duas seções aparecem quando há o que mostrar');
    await p.close();
  }

  /* ---------- §88. o painel de resultado não perde nada do registro ---------- *
   * A proposta B recolhe a descrição, a evidência e a justificativa dentro de
   * cada linha. Recolher é permitido; perder não é. Este teste compara o que
   * o motor devolveu com o que a tela tem (aberta ou fechada), campo a campo,
   * e confere que a contagem em destaque é o número de testes da lista.
   * -------------------------------------------------------------------- */
  {
    const p = await ctx.newPage();
    p.on('pageerror', (e) => erros.push('painel: ' + e.message));
    const caso = { tipo_tumor: 'Ginecológico - Ovário', histologia: 'Seroso', grau: 'Alto grau', estadiamento: 'IVC', idade: '61' };
    await mockExtracao(p, caso);
    await entrar(p);
    await p.fill('#case-text', 'caso de ovário');
    await p.click('#btn-extract');
    await p.waitForSelector('#screen-1.active');
    await p.click('button:has-text("Rodar triagem")');
    await p.waitForSelector('#screen-2.active');

    const t = TUMORS.get('ovario');
    const v = {};
    t.fields.forEach((f) => { v[f.key] = ''; });
    Object.assign(v, { histologia: 'Seroso', grau: 'Alto grau', estadiamento: 'IVC', idade: '61' });
    const esperado = t.classify(v);

    const tela = await p.evaluate(() => ({
      numero: document.querySelector('#verdict-glyph .glyph-num').textContent.trim(),
      rotulo: document.getElementById('verdict-glyph').getAttribute('aria-label'),
      linhas: Array.from(document.querySelectorAll('#test-steps .test-step')).map((d) => ({
        fechado: !d.open,
        // textContent inclui o que está recolhido: é o que existe na tela.
        texto: d.textContent.replace(/\s+/g, ' '),
        titulo: d.querySelector('h4').textContent.trim(),
      })),
    }));

    linha(ok(tela.numero === String(esperado.tests.length) && tela.linhas.length === esperado.tests.length,
      `contagem ${tela.numero}, linhas ${tela.linhas.length}, motor ${esperado.tests.length}`),
    'a contagem em destaque é o número de testes da lista');
    linha(ok(/2 testes indicados/.test(tela.rotulo || ''), `rótulo para leitor de tela: ${tela.rotulo}`),
      'a contagem tem rótulo para leitor de tela');
    linha(ok(tela.linhas.every((l) => l.fechado), 'alguma linha nasceu aberta'),
      'as linhas de teste nascem fechadas');

    const faltas = [];
    esperado.tests.forEach((teste, i) => {
      const linhaTela = tela.linhas[i];
      if (!linhaTela) { faltas.push(`${teste.id}: sem linha`); return; }
      const norm = (x) => String(x || '').replace(/\s+/g, ' ').trim();
      // O nome inteiro, mesmo dividido em título e linha de genes.
      const pedacosNome = norm(teste.name).replace(/[()]/g, ' ').split(/\s+/).filter(Boolean);
      pedacosNome.forEach((w) => { if (!linhaTela.texto.includes(w)) faltas.push(`${teste.id}: "${w}" do nome`); });
      // A descrição aparece em dois parágrafos (primeira frase e o resto),
      // com a evidência entre eles: confere cada parte.
      const d = norm(teste.description);
      const corte = d.indexOf('. ');
      const partes = corte > 0 ? [d.slice(0, corte + 1), d.slice(corte + 2)] : [d];
      partes.forEach((parte, n) => { if (parte && !linhaTela.texto.includes(parte)) faltas.push(`${teste.id}: descrição, parte ${n + 1}`); });
      for (const campo of ['stat', 'sample']) {
        if (teste[campo] && !linhaTela.texto.includes(norm(teste[campo]))) faltas.push(`${teste.id}: ${campo}`);
      }
    });
    linha(ok(faltas.length === 0, `informação do registro ausente da tela: ${faltas.join(' | ')}`),
      'nome, descrição, evidência e amostra estão todos na tela');
    /* §63.2, revisto em 20/10/2026 por decisão do dono: a justificativa do
     * pedido NÃO aparece na tela de resultado. Ela mora no pedido impresso e
     * na prévia "Ver documento" da tela de programas. */
    const repetida = esperado.tests.filter((teste, i) => teste.justify && tela.linhas[i]
      && tela.linhas[i].texto.includes(teste.justify.replace(/\s+/g, ' ').trim())).map((t) => t.id);
    const rotulo = tela.linhas.some((l) => /Vai assim no pedido/i.test(l.texto));
    linha(ok(!repetida.length && !rotulo, `justificativa na tela de resultado: ${repetida.join(', ')} rótulo=${rotulo}`),
      'a justificativa do pedido não se repete na tela de resultado');
    /* §88, 20/10/2026, pedido do dono: os botões de voltar e de seguir
     * para os programas ficam logo abaixo do resultado e ACIMA das regras de
     * leitura ("Como ler qualquer resultado") e do aviso legal. */
    const ordem = await p.evaluate(() => {
      const topo = (sel) => { const e = document.querySelector('#screen-2 ' + sel); return e ? e.getBoundingClientRect().top : null; };
      return { painel: topo('#resultado-painel'), botoes: topo('.foot-nav'), regras: topo('.regras-gerais'), aviso: topo('.disclaimer') };
    });
    linha(ok(ordem.painel < ordem.botoes && ordem.botoes < ordem.regras && ordem.regras < ordem.aviso,
      `ordem na tela: ${JSON.stringify(ordem)}`),
    'os botões vêm logo depois do resultado, acima de "Como ler"');
    linha(ok(tela.linhas[1] && tela.linhas[1].titulo === 'Painel germinativo multigênico',
      `título do painel: "${tela.linhas[1] && tela.linhas[1].titulo}"`),
    'nome longo com genes vira título curto e linha de genes');
    await p.close();
  }

  /* ---------- 13k. o toque afunda o botão e ele volta inteiro ---------- */
  {
    /* §76. O rebote é a ÚNICA curva do app que passa do ponto e volta, e vale
     * só para o gesto do dedo. Dois jeitos de isso virar defeito: o botão não
     * responder (e o médico tocar duas vezes), ou não voltar ao tamanho (e a
     * tela ficar com um botão menor para sempre). Mede-se os dois. */
    const p = await ctx.newPage();
    p.on('pageerror', (e) => erros.push('rebote: ' + e.message));
    await entrar(p);
    const escala = (sel) => p.evaluate((s) => {
      const m = new DOMMatrixReadOnly(getComputedStyle(document.querySelector(s)).transform);
      return +m.a.toFixed(3);
    }, '#btn-extract');

    const repouso = await escala();
    await p.locator('#btn-extract').hover();
    await p.mouse.down();
    await p.waitForTimeout(160);
    const pressionado = await escala();
    await p.mouse.up();
    await p.waitForTimeout(500);
    const voltou = await escala();

    linha(ok(pressionado < repouso - 0.005, `pressionado ${pressionado} contra ${repouso} em repouso — o toque não responde`),
      'o botão afunda quando o dedo encosta');
    linha(ok(Math.abs(voltou - 1) < 0.005, `o botão parou em ${voltou} em vez de 1`),
      'e volta ao tamanho inteiro quando solta');
    await p.close();
  }

  /* ---------- 14. varredura de diagramação: texto encostando em texto ---------- */
  {
    /* §64.1. Dois defeitos relatados do celular eram da mesma família:
     * "OncoGenYXFORMULÁRIO DE SOLICITAÇÃO" (duas caixas adjacentes sem
     * respiro, uma quebrando em duas linhas e encaixando na folga da outra) e
     * a pílula "Ver documento" partida em duas linhas encostando no rótulo.
     *
     * Corrigir os dois não impede o terceiro. Esta varredura percorre as
     * QUATRO telas e reprova se duas caixas de texto se sobrepuserem, ou se o
     * texto transbordar a própria caixa. Não conhece os casos de hoje — mede
     * a página. */
    const p = await ctx.newPage();
    p.on('pageerror', (e) => erros.push('diagramacao: ' + e.message));
    await mockExtracao(p, { tipo_tumor: 'Próstata', extensao_doenca: 'Metastático hormônio-sensível (mHSPC)', gleason_grade_group: 'Gleason 4+4=8', nome_paciente: 'Ramon Sergio Sampaio Vianna' });
    await entrar(p);
    await p.fill('#case-text', 'caso de próstata');
    await p.click('#btn-extract');
    await p.waitForSelector('#screen-1.active');
    await p.click('button:has-text("Rodar triagem")');
    await p.waitForSelector('#screen-2.active');
    await p.click('#verdict-next-btn');
    await p.waitForSelector('#screen-3.active');
    // Abre tudo que recolhe: defeito escondido atrás de um clique continua
    // sendo defeito, e é onde a diagramação costuma falhar.
    await p.evaluate(() => document.querySelectorAll('details').forEach((d) => { d.open = true; }));
    await p.waitForTimeout(400);

    const problemas = await p.evaluate(() => {
      const achados = [];
      const telas = Array.from(document.querySelectorAll('.screen'));

      const visivel = (el) => {
        const r = el.getBoundingClientRect();
        if (r.width < 2 || r.height < 2) return null;
        const cs = getComputedStyle(el);
        if (cs.visibility === 'hidden' || parseFloat(cs.opacity) === 0) return null;
        // Elemento tirado do fluxo pode legitimamente cobrir outro (menu,
        // painel flutuante, véu). A varredura é sobre texto EM FLUXO.
        if (cs.position === 'absolute' || cs.position === 'fixed') return null;
        return { r, cs };
      };
      const nomear = (el) => `${el.tagName.toLowerCase()}${el.className ? '.' + String(el.className).split(' ')[0] : ''}`;

      for (const tela of telas) {
        const eraAtiva = tela.classList.contains('active');
        if (!eraAtiva) tela.classList.add('active');

        const folhas = Array.from(tela.querySelectorAll('*')).filter((el) => {
          if (el.children.length) return false;
          if (!(el.textContent || '').trim()) return false;
          // Campos de formulário têm recorte próprio e placeholder; não são
          // caixas de texto em fluxo no sentido desta varredura.
          if (/^(INPUT|TEXTAREA|SELECT|SVG|PATH)$/.test(el.tagName)) return false;
          return !!visivel(el);
        });

        // 1. Texto transbordando a própria caixa.
        for (const el of folhas) {
          const cs = getComputedStyle(el);
          if (cs.overflow !== 'hidden' && cs.overflowX !== 'hidden') continue;
          if (el.scrollWidth > el.clientWidth + 1) {
            achados.push(`${tela.id}: ${nomear(el)} cortado ("${el.textContent.trim().slice(0, 30)}")`);
          }
        }

        /* 2. Caixas de texto IRMÃS encostando.
         *
         * O defeito relatado não era sobreposição: era gap ZERO. Em
         * "OncoGenYXFORMULÁRIO DE SOLICITAÇÃO" as duas caixas estão lado a
         * lado, sem um pixel entre elas, e as palavras se tocam.
         *
         * A comparação é só entre filhos do MESMO contêiner flex ou grade.
         * Em texto corrido, duas caixas vizinhas com gap zero são normais — o
         * espaço entre as palavras está dentro do nó de texto, não entre as
         * caixas. Num contêiner flex, gap zero é falta de acabamento. */
        const filhosDeFlex = new Map();
        for (const el of folhas) {
          const pai = el.parentElement;
          if (!pai) continue;
          const disp = getComputedStyle(pai).display;
          if (!/flex|grid/.test(disp)) continue;
          if (!filhosDeFlex.has(pai)) filhosDeFlex.set(pai, []);
          filhosDeFlex.get(pai).push({ el, r: el.getBoundingClientRect() });
        }

        for (const [pai, itens] of filhosDeFlex) {
          void pai;
          for (let i = 0; i < itens.length; i++) {
            for (let j = i + 1; j < itens.length; j++) {
              const a = itens[i];
              const b = itens[j];
              // Na mesma linha visual? Sem isso, itens empilhados (que têm
              // gap horizontal negativo por definição) acusariam sempre.
              const sobreposicaoVertical = Math.min(a.r.bottom, b.r.bottom) - Math.max(a.r.top, b.r.top);
              const menorAltura = Math.min(a.r.height, b.r.height);
              if (sobreposicaoVertical < menorAltura * 0.5) continue;

              const vao = a.r.left < b.r.left
                ? b.r.left - a.r.right
                : a.r.left - b.r.right;
              if (vao >= 4) continue;
              achados.push(
                `${tela.id}: ${nomear(a.el)} e ${nomear(b.el)} com ${Math.round(vao)}px entre eles ` +
                `("${a.el.textContent.trim().slice(0, 20)}" / "${b.el.textContent.trim().slice(0, 20)}")`,
              );
            }
          }
        }

        if (!eraAtiva) tela.classList.remove('active');
      }
      return achados;
    });

    linha(ok(problemas.length === 0, `${problemas.length} problema(s): ${problemas.slice(0, 4).join(' | ')}`),
      'nenhum texto encosta ou transborda, nas quatro telas');
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
