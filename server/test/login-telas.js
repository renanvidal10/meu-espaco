// As telas do login definitivo (§85) no navegador real, em AUTH_MODE=completo.
//
// Percorre o caminho do médico (criar acesso, confirmar e-mail, entrar,
// Minha conta) e o do administrador (conferir CRM), no celular e no
// computador, conferindo o que a suíte HTTP não enxerga: rótulos acessíveis,
// a lista de exigências da senha reagindo à digitação, foco preso nos
// modais, rolagem lateral no celular e a faixa de conferência do CRM.
//
// Com FOTOS=<pasta>, salva uma imagem de cada tela para revisão de design.
//
//   CHROMIUM_PATH=... node test/login-telas.js
//   FOTOS=/tmp/telas CHROMIUM_PATH=... node test/login-telas.js

const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const { arquivoDeDadosTemporario } = require('./temporario.js');
const { chromium, devices } = require('playwright');

const FOTOS = process.env.FOTOS || '';
const ADMIN = 'renan@exemplo.com.br';
const SENHA = 'Gaveta azul!';

const falhas = [];
function ok(cond, msg) {
  if (!cond) falhas.push(msg);
  console.log((cond ? '  ✓ ' : '  ✗ ') + msg);
  return cond;
}

let saidaDoServidor = '';
async function subir() {
  const porta = 6800 + Math.floor(Math.random() * 300);
  const base = `http://127.0.0.1:${porta}`;
  const servidor = spawn(process.execPath, [path.join(__dirname, '..', 'index.js')], {
    env: {
      ...process.env,
      PORT: String(porta),
      NODE_ENV: 'test',
      AUTH_MODE: 'completo',
      ADMIN_EMAILS: ADMIN,
      DATA_FILE: arquivoDeDadosTemporario('telas'),
      ANTHROPIC_API_KEY: 'chave-de-teste',
      DATABASE_URL: '', RESEND_API_KEY: '', APP_ORIGIN: '',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  servidor.stdout.on('data', (d) => { saidaDoServidor += d; });
  servidor.stderr.on('data', (d) => { saidaDoServidor += d; });
  for (let i = 0; i < 100; i++) {
    try { if ((await fetch(base + '/api/health')).ok) break; } catch { /* subindo */ }
    await new Promise((r) => setTimeout(r, 150));
  }
  return { servidor, base };
}

// O servidor sem provedor de e-mail escreve o conteúdo no console: é de lá
// que sai o link, como sairia da caixa de entrada.
function ultimoLink(tipo) {
  const achados = saidaDoServidor.match(new RegExp(`https?://[^\\s]*\\?${tipo}=[A-Za-z0-9_-]+`, 'g')) || [];
  return achados[achados.length - 1];
}

async function foto(p, nome) {
  if (!FOTOS) return;
  fs.mkdirSync(FOTOS, { recursive: true });
  await p.waitForTimeout(250);
  await p.screenshot({ path: path.join(FOTOS, nome + '.png'), fullPage: false });
}

async function semRolagemLateral(p, onde) {
  const sobra = await p.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  ok(sobra <= 1, `${onde}: sem rolagem lateral (sobra ${sobra}px)`);
}

async function rotulosAcessiveis(p, seletor, onde) {
  const semNome = await p.evaluate((sel) => Array.from(document.querySelectorAll(sel))
    .filter((el) => el.offsetParent !== null)
    .filter((el) => {
      const rotulo = el.closest('label') || (el.id && document.querySelector(`label[for="${el.id}"]`));
      return !(rotulo && rotulo.textContent.trim()) && !el.getAttribute('aria-label');
    })
    .map((el) => el.id || el.outerHTML.slice(0, 60)), seletor);
  ok(semNome.length === 0, `${onde}: todo campo tem rótulo (${semNome.join(', ') || 'ok'})`);
}

let numero = 310000;

async function rodar(nome, dispositivo, base, sufixo) {
  console.log(`\n=== ${nome} ===`);
  const navegador = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium' });
  const ctx = await navegador.newContext({ ...dispositivo, locale: 'pt-BR' });
  const p = await ctx.newPage();
  const erros = [];
  p.on('pageerror', (e) => erros.push(e.message));

  numero += 1;
  const crm = String(numero);

  // 1. Entrada
  await p.goto(base);
  await p.waitForSelector('#view-login.active');
  ok(await p.locator('#login-uf option').count() === 28, 'lista de estados com as 27 UFs');
  // §86.9: o Aviso de Privacidade diz por qual caminho o laudo vai (aqui, a
  // API direta, que é o padrão fora de produção).
  ok(/direto à Anthropic/.test(await p.locator('#pv-ia-caminho').textContent()), 'Aviso de Privacidade diz que o laudo vai direto à Anthropic');
  await rotulosAcessiveis(p, '#view-login input, #view-login select', 'entrada');
  await semRolagemLateral(p, 'entrada');
  await foto(p, `1-entrada-${sufixo}`);

  // 2. Criar acesso, com a lista de exigências da senha reagindo
  await p.click('text=Criar acesso');
  await p.waitForSelector('#view-register.active');
  // A tela põe o cursor no primeiro campo 40 ms depois de aparecer. Digitar
  // antes disso manda o texto para o campo errado (corrida do teste, não do
  // médico, que nunca digita tão rápido).
  await p.waitForFunction(() => document.activeElement && document.activeElement.id === 'reg-name');
  await p.fill('#reg-name', 'Dra. Ana Ribeiro');
  await p.fill('#reg-crm', crm);
  await p.selectOption('#reg-uf', 'SP');
  await p.fill('#reg-email', `ana${crm}@exemplo.com.br`);
  await p.fill('#reg-password', 'gaveta');
  const cumpridasAntes = await p.locator('#reg-regras li.ok').count();
  await foto(p, `2-cadastro-digitando-${sufixo}`);
  await p.fill('#reg-password', SENHA);
  const cumpridasDepois = await p.locator('#reg-regras li.ok').count();
  ok(cumpridasAntes === 0 && cumpridasDepois === 3, `exigências da senha marcam ao digitar (${cumpridasAntes} → ${cumpridasDepois})`);
  await rotulosAcessiveis(p, '#view-register input, #view-register select', 'cadastro');

  // Sem o aceite, não vai.
  await p.click('#reg-submit');
  ok(/Termos de Uso/.test(await p.locator('#gate-alert').textContent()), 'sem aceite: pede o aceite');
  await p.check('#reg-aceite');
  await p.click('#reg-submit');
  ok(/autorização do envio/.test(await p.locator('#gate-alert').textContent()), 'sem o consentimento do e-mail: pede o consentimento');
  await p.check('#reg-consentimento');
  await semRolagemLateral(p, 'cadastro');
  await foto(p, `3-cadastro-pronto-${sufixo}`);
  await p.click('#reg-submit');
  await p.waitForSelector('#view-enviado.active');
  ok(/Confira seu e-mail/.test(await p.locator('#view-enviado h1').textContent()), 'depois do cadastro: "Confira seu e-mail"');
  await foto(p, `4-confira-email-${sufixo}`);

  // 3. Tentar entrar antes de confirmar cai na mesma tela, com o motivo
  await p.click('text=Voltar para a entrada');
  await p.waitForFunction(() => document.activeElement && document.activeElement.id === 'login-crm');
  await p.fill('#login-crm', crm);
  await p.selectOption('#login-uf', 'SP');
  await p.fill('#login-password', SENHA);
  await p.click('#login-submit');
  await p.waitForSelector('#view-enviado.active');
  ok(/Falta confirmar/.test(await p.locator('#enviado-texto').textContent()), 'entrar sem confirmar: explica que falta confirmar');

  // 4. Senha errada
  await p.click('text=Voltar para a entrada');
  ok(await p.inputValue('#login-crm') === crm, 'CRM lembrado no aparelho para a próxima entrada');
  await p.fill('#login-password', 'Errada!!');
  await p.click('#login-submit');
  await p.waitForSelector('#gate-alert.error');
  ok(/CRM, estado ou senha incorretos/.test(await p.locator('#gate-alert').textContent()), 'senha errada: mensagem neutra');
  await foto(p, `5-senha-errada-${sufixo}`);

  // 5. Link do e-mail confirma e já entra
  await p.goto(ultimoLink('confirmar-email'));
  await p.waitForSelector('body:not(.gate-active)');
  ok(new URL(p.url()).search === '', 'o link some da barra de endereço');
  if (await p.locator('#boas-vindas.aberto').count()) await p.click('#bv-comecar');
  ok(await p.locator('#aviso-crm').isVisible(), 'faixa de conferência do CRM aparece');
  ok(/em conferência.*liberado até/.test(await p.locator('#aviso-crm').textContent()), 'faixa explica a liberação provisória');
  const cookies = await ctx.cookies();
  ok(cookies.some((c) => /sessao/.test(c.name) && c.httpOnly && c.sameSite === 'Strict'), 'sessão em cookie HttpOnly e SameSite=Strict');
  ok(await p.evaluate(() => Object.keys(localStorage).every((k) => !/session|sessao|token/i.test(k))), 'nada de sessão em localStorage');
  await semRolagemLateral(p, 'app com faixa do CRM');
  await foto(p, `6-app-faixa-crm-${sufixo}`);

  // 6. Minha conta
  await p.click('.chip-conta');
  await p.waitForSelector('#conta.aberto');
  await p.waitForFunction(() => document.getElementById('ct-nome').textContent !== '-');
  ok((await p.locator('#ct-situacao').textContent()) === 'Em conferência', 'Minha conta: situação do CRM');
  ok(await p.locator('#ct-acessos li').count() >= 2, 'Minha conta: últimos acessos listados');
  await semRolagemLateral(p, 'Minha conta');
  await foto(p, `7-minha-conta-${sufixo}`);
  // Foco preso no modal: Tab a partir do último elemento volta ao primeiro.
  await p.locator('#conta .modal-x').focus();
  await p.keyboard.press('Shift+Tab');
  const dentro = await p.evaluate(() => document.getElementById('conta').contains(document.activeElement));
  ok(dentro, 'Minha conta: o foco não escapa do modal');
  await p.click('#ct-senha summary');
  await p.fill('#ct-senha-atual', SENHA);
  await p.fill('#ct-senha-nova', 'Nova gaveta!');
  await rotulosAcessiveis(p, '#conta input, #conta select', 'Minha conta');
  await foto(p, `8-trocar-senha-${sufixo}`);
  await p.click('#ct-senha-salvar');
  await p.waitForSelector('#ct-alerta.success');
  ok(/Senha trocada/.test(await p.locator('#ct-alerta').textContent()), 'trocar a senha: confirma e avisa');
  await p.keyboard.press('Escape');
  await p.waitForSelector('#conta', { state: 'hidden' });

  // 7. Sair e entrar com a senha nova
  await p.click('.chip-signout');
  await p.waitForSelector('#view-login.active');
  await p.fill('#login-password', 'Nova gaveta!');
  await p.click('#login-submit');
  await p.waitForSelector('body:not(.gate-active)');
  ok(true, 'entra com a senha nova');

  // 8. Administrador confere o CRM
  if (sufixo === 'computador') {
    const adm = await navegador.newContext({ ...dispositivo, locale: 'pt-BR' });
    const pa = await adm.newPage();
    pa.on('pageerror', (e) => erros.push('admin: ' + e.message));
    await pa.goto(base);
    await pa.click('text=Criar acesso');
    await pa.waitForFunction(() => document.activeElement && document.activeElement.id === 'reg-name');
    await pa.fill('#reg-name', 'Renan Vidal');
    await pa.fill('#reg-crm', '999001');
    await pa.selectOption('#reg-uf', 'RJ');
    await pa.fill('#reg-email', ADMIN);
    await pa.fill('#reg-password', 'Flores no jardim#');
    await pa.check('#reg-aceite');
    await pa.check('#reg-consentimento');
    await pa.click('#reg-submit');
    await pa.waitForSelector('#view-enviado.active');
    await pa.goto(ultimoLink('confirmar-email'));
    await pa.waitForSelector('body:not(.gate-active)');
    if (await pa.locator('#boas-vindas.aberto').count()) await pa.click('#bv-comecar');
    await pa.click('.chip-conta');
    await pa.waitForSelector('#ct-admin:not([hidden])');
    ok(true, 'administrador vê a área de conferência em Minha conta');
    await pa.click('#ct-admin button');
    await pa.waitForSelector('#conferencia.aberto');
    await pa.waitForSelector('.conferencia-item');
    ok(await pa.locator('.conferencia-item').count() >= 1, 'fila de conferência lista o médico pendente');
    await semRolagemLateral(pa, 'conferência');
    await foto(pa, `9-conferencia-${sufixo}`);
    await pa.locator(`.conferencia-item:has-text("${crm}") button:has-text("Conferido")`).click();
    await pa.waitForSelector('#cf-alerta.success');
    await foto(pa, `10-conferencia-feita-${sufixo}`);
    await adm.close();

    // O médico vê a faixa sumir ao recarregar.
    await p.reload();
    await p.waitForSelector('body:not(.gate-active)');
    ok(await p.locator('#aviso-crm').isHidden(), 'CRM conferido: a faixa some');
  }

  // 9. Esqueci a senha
  await p.click('.chip-signout');
  await p.waitForSelector('#view-login.active');
  await p.click('text=Esqueci minha senha');
  await p.waitForFunction(() => document.activeElement && document.activeElement.id === 'forgot-email');
  await p.fill('#forgot-email', `ana${crm}@exemplo.com.br`);
  await p.click('#forgot-submit');
  await p.waitForSelector('#gate-alert.success');
  await p.goto(ultimoLink('nova-senha'));
  await p.waitForSelector('#view-set.active');
  await p.fill('#set-password', 'Terceira gaveta!');
  await foto(p, `11-nova-senha-${sufixo}`);
  await p.click('#set-submit');
  await p.waitForSelector('body:not(.gate-active)');
  ok(true, 'esqueci a senha: link do e-mail cria a senha nova e entra');

  ok(erros.length === 0, `nenhum erro de JavaScript (${erros.join(' | ') || 'ok'})`);
  await navegador.close();
}

(async () => {
  const { servidor, base } = await subir();
  try {
    await rodar('CELULAR (iPhone 14)', devices['iPhone 14'], base, 'celular');
    await rodar('COMPUTADOR', { viewport: { width: 1280, height: 860 } }, base, 'computador');
  } finally {
    servidor.kill();
  }
  console.log(`\n${falhas.length ? falhas.length + ' FALHA(S)' : 'Tudo certo.'}`);
  process.exit(falhas.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
