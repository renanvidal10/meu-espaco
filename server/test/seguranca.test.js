'use strict';

// Travas de segurança. Cada teste aqui corresponde a um achado provado em
// auditoria — a descrição diz qual, para que ninguém remova por engano.

const { tokenDaResposta } = require('./sessao.js');
const { portaLivre } = require('./porta.js');
const test = require('node:test');
const assert = require('node:assert');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { arquivoDeDadosTemporario } = require('./temporario.js');

const { criarStub } = require('./stub-anthropic.js');
const { criaPdf } = require('./util-pdf.js');

let stub, app, base, token;

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

async function esperarSaude(url, tentativas = 60) {
  for (let i = 0; i < tentativas; i++) {
    try { if ((await fetch(url + '/api/health')).ok) return; } catch (e) { /* subindo */ }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error('o servidor não subiu a tempo');
}

test.before(async () => {
  stub = criarStub();
  const portaStub = await stub.ouvir(0);
  const dataFile = arquivoDeDadosTemporario('seg');
  const porta = portaLivre();
  base = `http://127.0.0.1:${porta}`;

  app = spawn(process.execPath, [path.join(__dirname, '..', 'index.js')], {
    env: {
      ...process.env,
      PORT: String(porta), NODE_ENV: 'test', DATA_FILE: dataFile,
      ANTHROPIC_API_KEY: 'chave-de-teste',
      ANTHROPIC_BASE_URL: `http://127.0.0.1:${portaStub}`,
      DATABASE_URL: '', RESEND_API_KEY: '', APP_ORIGIN: '',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  app.stderr.on('data', (d) => {
    const t = String(d);
    if (!/DeprecationWarning|punycode/.test(t)) process.stderr.write('[app] ' + t);
  });
  await esperarSaude(base);

  const r = await fetch(base + '/api/auth/acesso', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: 'Renan Vidal', crm: '339324' }),
  });
  token = tokenDaResposta(r);
});

test.after(async () => {
  if (app) app.kill();
  if (stub) await stub.fechar();
});

function form(partes) {
  const fd = new FormData();
  if (partes.texto !== undefined) fd.append('text', partes.texto);
  (partes.arquivos || []).forEach(({ nome, buffer, tipo }) => {
    fd.append('files', new Blob([buffer], { type: tipo }), nome);
  });
  return fd;
}

const extrair = async (partes) => {
  const r = await fetch(base + '/api/extract', {
    method: 'POST', headers: { Authorization: 'Bearer ' + token }, body: form(partes),
  });
  return { status: r.status, corpo: await r.json() };
};

/* ============ teto de gasto: 240 chamadas pagas em 0,8 s ============ */

test('rota de extração tem teto por hora e devolve 429 depois dele', async () => {
  const r = await fetch(base + '/api/auth/acesso', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: 'Dra. Teto', crm: '900001 SP' }),
  });
  const tk = tokenDaResposta(r);

  let ultimo = 200, chamadas = 0;
  for (let i = 0; i < 60 && ultimo !== 429; i++) {
    stub.responderCom({ tipo: 'ok', extracao: { tipo_tumor: 'Não identificado' } });
    const resp = await fetch(base + '/api/extract', {
      method: 'POST', headers: { Authorization: 'Bearer ' + tk }, body: form({ texto: 'caso' }),
    });
    ultimo = resp.status;
    chamadas++;
  }
  assert.strictEqual(ultimo, 429, `sem teto: ${chamadas} chamadas pagas sem bloqueio`);
  assert.ok(chamadas <= 50, `teto alto demais: ${chamadas} chamadas`);
  const corpo = await (await fetch(base + '/api/extract', {
    method: 'POST', headers: { Authorization: 'Bearer ' + tk }, body: form({ texto: 'x' }),
  })).json();
  assert.match(corpo.error, /limite/i);
});

test('rota de conversa também tem teto', async () => {
  const r = await fetch(base + '/api/auth/acesso', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: 'Dr. Teto Chat', crm: '900002 SP' }),
  });
  const tk = tokenDaResposta(r);
  let ultimo = 200, n = 0;
  for (let i = 0; i < 140 && ultimo !== 429; i++) {
    stub.responderCom({ tipo: 'ok', extracao: {} });
    const resp = await fetch(base + '/api/chat', {
      method: 'POST',
      headers: { 'content-type': 'application/json', Authorization: 'Bearer ' + tk },
      body: JSON.stringify({ messages: [{ role: 'user', content: 'oi' }] }),
    });
    ultimo = resp.status; n++;
  }
  assert.strictEqual(ultimo, 429, `sem teto na conversa: ${n} chamadas`);
});

/* ============ tamanho de entrada: 1 MB de texto = ~US$ 1,33 ============ */

test('texto gigante é barrado antes de virar chamada paga', async () => {
  stub.limpar();
  const { status, corpo } = await extrair({ texto: 'x'.repeat(1024 * 1024) });
  assert.strictEqual(status, 400, 'aceitou 1 MB de texto');
  assert.match(corpo.error, /longo demais|resuma/i);
  assert.strictEqual(stub.estado.requisicoes.length, 0, 'gastou chamada com texto gigante');
});

test('mais de 3 arquivos é recusado com mensagem, não com 500', async () => {
  stub.limpar();
  const arquivos = [1, 2, 3, 4].map((i) => ({
    nome: `a${i}.pdf`, buffer: criaPdf('laudo ' + i), tipo: 'application/pdf',
  }));
  const { status, corpo } = await extrair({ arquivos });
  assert.strictEqual(status, 400);
  assert.match(corpo.error, /3 arquivos/);
  assert.strictEqual(stub.estado.requisicoes.length, 0);
});

/* ============ formatos de imagem ============ */

test('HEIC (padrão do iPhone) é barrado com o caminho da solução', async () => {
  stub.limpar();
  const { status, corpo } = await extrair({
    arquivos: [{ nome: 'IMG_4821.HEIC', buffer: PNG, tipo: 'image/heic' }],
  });
  assert.strictEqual(status, 400);
  assert.match(corpo.error, /HEIC/i);
  assert.match(corpo.error, /Compartilhar|print/i);
  assert.strictEqual(stub.estado.requisicoes.length, 0, 'gastou chamada com formato não suportado');
});

test('formatos suportados continuam passando', async () => {
  for (const tipo of ['image/jpeg', 'image/png', 'image/gif', 'image/webp']) {
    stub.limpar();
    stub.responderCom({ tipo: 'ok', extracao: { tipo_tumor: 'Mama' } });
    const { status } = await extrair({ arquivos: [{ nome: 'foto', buffer: PNG, tipo }] });
    assert.strictEqual(status, 200, `${tipo} foi barrado indevidamente`);
  }
});

/* ============ headers e CORS ============ */

test('headers de segurança presentes na página', async () => {
  const r = await fetch(base + '/');
  const csp = r.headers.get('content-security-policy');
  assert.ok(csp, 'sem Content-Security-Policy');
  assert.match(csp, /connect-src 'self'/, 'CSP permite exfiltração para qualquer domínio');
  assert.match(csp, /frame-ancestors 'none'/, 'app pode ser enquadrado em iframe');
  assert.ok(r.headers.get('x-content-type-options'), 'sem X-Content-Type-Options');
  assert.ok(!r.headers.get('x-powered-by'), 'expõe X-Powered-By');
});

test('CORS não é mais aberto a qualquer origem', async () => {
  const r = await fetch(base + '/api/health', { headers: { Origin: 'https://exfil.example' } });
  assert.notStrictEqual(r.headers.get('access-control-allow-origin'), '*');
});

/* ============ §80. o cabeçalho Host não entra na página ============
 *
 * A pré-visualização do link exige URL absoluta, então o servidor passou a
 * escrever o endereço do pedido dentro de atributos HTML (canonical, og:url,
 * og:image). `host` e `x-forwarded-proto` são escolhidos por quem fala com o
 * processo — e um Host como `x"><script>…</script><b a="` fechava o atributo
 * e injetava script EXECUTÁVEL, porque a CSP da época trazia
 * `script-src 'unsafe-inline'`.
 *
 * Defeito introduzido por nós, no commit da pré-visualização, e invisível
 * para as 262 verificações da suíte: a bateria do aplicativo testava que o
 * marcador havia sido substituído e que og:url era absoluto — só no caminho
 * benigno, nunca com um Host hostil. Teste que só exercita a entrada bem
 * comportada não é teste de segurança.
 *
 * Usa socket cru porque `fetch` recusa montar um Host com esses caracteres —
 * e foi exatamente essa recusa que deixou o furo passar despercebido. */
const net = require('node:net');

function pedidoCru(porta, host, extras = '') {
  return new Promise((resolve, reject) => {
    const s = net.connect(porta, '127.0.0.1', () => {
      s.write(`GET / HTTP/1.1\r\nHost: ${host}\r\n${extras}Connection: close\r\n\r\n`);
    });
    let corpo = '';
    s.on('data', (d) => { corpo += d; });
    s.on('end', () => resolve(corpo));
    s.on('error', reject);
  });
}

test('Host hostil não injeta HTML na página entregue', async () => {
  const porta = Number(new URL(base).port);
  const resposta = await pedidoCru(porta, 'x"><script>alert(document.domain)</script><b a="');
  assert.ok(!/<script>alert\(document\.domain\)<\/script>/.test(resposta),
    'o cabeçalho Host virou script executável dentro da página');
  assert.ok(!/href="http:\/\/x"/.test(resposta), 'o atributo foi fechado pelo valor injetado');
  assert.ok(/<link rel="canonical"/.test(resposta), 'a página deixou de ser entregue');
});

test('protocolo forjado não vira esquema javascript:', async () => {
  const porta = Number(new URL(base).port);
  const resposta = await pedidoCru(porta, '127.0.0.1', 'X-Forwarded-Proto: javascript\r\n');
  assert.ok(!/javascript:/i.test(resposta), 'x-forwarded-proto entrou cru na página');
});

test('Host legítimo continua produzindo endereço absoluto', async () => {
  const porta = Number(new URL(base).port);
  const resposta = await pedidoCru(porta, `127.0.0.1:${porta}`);
  const m = /<meta property="og:url" content="([^"]*)"/.exec(resposta);
  assert.ok(m, 'og:url sumiu da página');
  assert.match(m[1], new RegExp(`^https?://127\\.0\\.0\\.1:${porta}/$`),
    `og:url saiu como "${m && m[1]}" — a correção não pode quebrar a pré-visualização`);
});

test('a CSP não permite mais script inline', async () => {
  const r = await fetch(base + '/');
  const csp = r.headers.get('content-security-policy') || '';
  const scriptSrc = /(?:^|;)\s*script-src ([^;]*)/.exec(csp);
  assert.ok(scriptSrc, 'sem diretriz script-src');
  assert.ok(!/'unsafe-inline'/.test(scriptSrc[1]),
    `script-src ainda traz unsafe-inline (${scriptSrc[1]}) — é ela que torna injeção de HTML executável`);
});

/* ============ validação de CRM ============ */

test('CRM inválido é recusado no acesso E na edição de perfil', async () => {
  const ruim = await fetch(base + '/api/auth/acesso', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: 'Dr. Teste', crm: 'ab' }),
  });
  assert.strictEqual(ruim.status, 400);

  const patch = await fetch(base + '/api/auth/me', {
    method: 'PATCH',
    headers: { 'content-type': 'application/json', Authorization: 'Bearer ' + token },
    body: JSON.stringify({ name: 'Dr. Teste', crm: '<script>alert(1)</script>' }),
  });
  assert.strictEqual(patch.status, 400, 'PATCH aceitou CRM inválido — vai impresso no documento assinado');
});

/* ============ o log não pode conter dado clínico ============ */

test('resposta não-JSON do modelo não despeja o caso no log', async () => {
  stub.limpar();
  const logs = [];
  const captura = (d) => logs.push(String(d));
  app.stderr.on('data', captura);

  stub.responderCom({ tipo: 'ok', extracao: {} });
  // Força saída inválida: o stub devolve texto puro em vez de JSON.
  stub.estado.fila.length = 0;
  stub.responderCom({ tipo: 'texto-cru', extracao: {} });
  await extrair({ texto: 'caso' });
  await new Promise((r) => setTimeout(r, 300));
  app.stderr.off('data', captura);

  const tudo = logs.join('');
  assert.ok(!/nome_paciente/.test(tudo), 'o log contém o campo de nome do paciente');
});

/* ============ modo desligado ============ */

test('rotas de email/senha continuam 404 no modo simples', async () => {
  for (const rota of ['cadastro', 'login', 'esqueci', 'nova-senha', 'confirmar-email', 'reenviar-confirmacao', 'trocar-senha']) {
    const r = await fetch(`${base}/api/auth/${rota}`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}',
    });
    assert.strictEqual(r.status, 404, `/api/auth/${rota} está exposta no modo simples`);
  }
});

test('redefinir a senha revoga as sessoes antigas', () => {
  // Quem redefine a senha em geral o faz porque perdeu o acesso ou suspeita de
  // invasao. Sem revogar, o invasor continua logado depois da troca, e a tela
  // diz que a conta foi protegida quando nao foi. A funcao existia em store.js
  // e nao era chamada de lugar nenhum — codigo morto que parecia protecao.
  // Desde §85 a troca mora em trocarSenha(), chamada pela rota de nova senha
  // (link do e-mail) e pela de trocar a senha logado.
  const codigo = fs.readFileSync(path.join(__dirname, '..', 'index.js'), 'utf8');
  const ini = codigo.indexOf('async function trocarSenha(');
  assert.ok(ini > 0, 'trocarSenha() sumiu');
  const corpo = codigo.slice(ini, codigo.indexOf('\n}\n', ini));
  for (const rota of ["app.post('/api/auth/nova-senha'", "app.post('/api/auth/trocar-senha'"]) {
    const trecho = codigo.slice(codigo.indexOf(rota), codigo.indexOf('\n});\n', codigo.indexOf(rota)));
    assert.match(trecho, /trocarSenha\(/, `${rota} não passa por trocarSenha()`);
  }
  assert.match(corpo, /deleteSessionsByUser/, 'redefinicao de senha nao revoga sessoes antigas');
  assert.ok(
    corpo.indexOf('setUserPassword') < corpo.indexOf('deleteSessionsByUser'),
    'a revogacao precisa vir depois da troca de senha',
  );
});

test('o listener de erro de porta e anexado ao servidor que existe', () => {
  // Vivia num bloco `if (servidor === null) { process.nextTick(...) }` no fim
  // do arquivo, que nunca rodava: o nextTick dispara antes do .then() de
  // store.init(), entao `servidor` ainda era null e o if interno pulava fora.
  // Porta ocupada saia como stack crua no log.
  const codigo = fs.readFileSync(path.join(__dirname, '..', 'index.js'), 'utf8');
  // Sem os comentarios: a propria explicacao do defeito cita o codigo antigo.
  const semComentarios = codigo.split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
  assert.ok(!/if \(servidor === null\)/.test(semComentarios), 'o bloco morto do listener de porta voltou');
  assert.match(codigo, /servidor\.on\('error'/, 'sem listener de erro de porta');
  assert.ok(
    codigo.indexOf("servidor = app.listen") < codigo.indexOf("servidor.on('error'"),
    'o listener precisa ser anexado depois de o servidor existir',
  );
});
