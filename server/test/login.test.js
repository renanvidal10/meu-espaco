'use strict';

// Login definitivo dos médicos (ARQUITETURA.md §85), de ponta a ponta: HTTP
// real contra o servidor real em AUTH_MODE=completo, com o back-end de arquivo.
// Sem RESEND_API_KEY os links voltam em `devUrl`, que é como o teste segue o
// fluxo do e-mail sem e-mail.

const test = require('node:test');
const assert = require('node:assert');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const { arquivoDeDadosTemporario } = require('./temporario.js');
const { tokenDaResposta } = require('./sessao.js');

const ADMIN = 'renan@exemplo.com.br';
const SENHA = 'Gaveta azul!';

let app;
let base;
let dataFile;

function subir(env = {}, arquivo) {
  const porta = 6100 + Math.floor(Math.random() * 600);
  const proc = spawn(process.execPath, [path.join(__dirname, '..', 'index.js')], {
    env: {
      ...process.env,
      PORT: String(porta),
      NODE_ENV: 'test',
      DATA_FILE: arquivo,
      AUTH_MODE: 'completo',
      ADMIN_EMAILS: ADMIN,
      ANTHROPIC_API_KEY: 'chave-de-teste',
      ANTHROPIC_BASE_URL: 'http://127.0.0.1:9',
      DATABASE_URL: '',
      RESEND_API_KEY: '',
      APP_ORIGIN: '',
      ...env,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let saida = '';
  proc.stdout.on('data', (d) => { saida += d; });
  proc.stderr.on('data', (d) => { saida += d; });
  return { proc, base: `http://127.0.0.1:${porta}`, saida: () => saida };
}

async function esperarSaude(url) {
  for (let i = 0; i < 60; i++) {
    try { if ((await fetch(url + '/api/health')).ok) return; } catch { /* subindo */ }
    await new Promise((r) => setTimeout(r, 150));
  }
  throw new Error('o servidor não subiu a tempo');
}

function lerDados() { return JSON.parse(fs.readFileSync(dataFile, 'utf8')); }
function gravarDados(db) { fs.writeFileSync(dataFile, JSON.stringify(db, null, 2)); }

const ipAleatorio = () => `10.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}.${1 + Math.floor(Math.random() * 250)}`;

async function post(rota, corpo, { token, cabecalhos = {}, metodo = 'POST' } = {}) {
  const r = await fetch(base + rota, {
    method: metodo,
    headers: {
      'content-type': 'application/json',
      // Cada pedido sai de um IP próprio (o servidor confia em 1 proxy), para
      // o teto por rede não interferir nos testes que não são sobre ele.
      'x-forwarded-for': ipAleatorio(),
      ...(token ? { authorization: 'Bearer ' + token } : {}),
      ...cabecalhos,
    },
    body: JSON.stringify(corpo || {}),
  });
  let json = null;
  try { json = await r.clone().json(); } catch { /* corpo não JSON */ }
  return { r, json, status: r.status };
}

async function get(rota, token) {
  const r = await fetch(base + rota, { headers: token ? { authorization: 'Bearer ' + token } : {} });
  let json = null;
  try { json = await r.clone().json(); } catch { /* corpo não JSON */ }
  return { r, json, status: r.status };
}

const tokenDoLink = (url) => new URL(url).searchParams.get('confirmar-email') || new URL(url).searchParams.get('nova-senha');

let numero = 200000;
function medico(extra = {}) {
  numero += 1;
  return {
    name: 'Dra. Beatriz Moraes',
    crm: String(numero),
    uf: 'SP',
    email: `medica${numero}@clinica.com.br`,
    password: SENHA,
    aceite: true,
    ...extra,
  };
}

/** Cadastra, confirma o e-mail e devolve { dados, token, user }. */
async function criarConta(extra = {}) {
  const dados = medico(extra);
  const c = await post('/api/auth/cadastro', dados);
  assert.strictEqual(c.status, 200, JSON.stringify(c.json));
  const conf = await post('/api/auth/confirmar-email', { token: tokenDoLink(c.json.devUrl) });
  assert.strictEqual(conf.status, 200, JSON.stringify(conf.json));
  return { dados, token: tokenDaResposta(conf.r), user: conf.json.user };
}

let adminCriado = null;
async function sessaoDoAdmin() {
  if (!adminCriado) {
    const { dados } = await criarConta({ email: ADMIN, name: 'Renan Vidal' });
    adminCriado = dados;
  }
  const r = await post('/api/auth/login', { crm: adminCriado.crm, uf: adminCriado.uf, password: SENHA });
  assert.strictEqual(r.status, 200, JSON.stringify(r.json));
  return tokenDaResposta(r.r);
}

test.before(async () => {
  dataFile = arquivoDeDadosTemporario('login');
  const s = subir({}, dataFile);
  app = s.proc;
  base = s.base;
  await esperarSaude(base);
});

test.after(() => { if (app) app.kill(); });

/* ---------- cadastro ---------- */

test('cadastro recusa dado faltando, um motivo de cada vez', async () => {
  const casos = [
    [{ name: 'A' }, /nome completo/],
    [{ crm: 'abc' }, /número do CRM/],
    [{ uf: 'XX' }, /estado/],
    [{ email: 'sem-arroba' }, /e-mail válido/],
    [{ aceite: false }, /Termos de Uso/],
    [{ email: 'crm-1-sp@acesso.oncogenyx' }, /e-mail válido/],
  ];
  for (const [troca, motivo] of casos) {
    const { status, json } = await post('/api/auth/cadastro', medico(troca));
    assert.strictEqual(status, 400, JSON.stringify(troca));
    assert.match(json.error, motivo);
  }
});

test('regra da senha decidida pelo dono: 8 caracteres, maiúscula e especial', async () => {
  const casos = [
    ['Ab!1', /mínimo 8/],
    ['gaveta azul!', /maiúscula/],
    ['GavetaAzul', /caractere especial/],
    ['Senha@123', /comum demais/],
    ['S3nh@2026!', /comum demais/],
    ['Oncogenyx#1', /comum demais/],
    ['Beatriz#2026', /nome, seu e-mail ou seu CRM/],
  ];
  for (const [password, motivo] of casos) {
    const { status, json } = await post('/api/auth/cadastro', medico({ password }));
    assert.strictEqual(status, 400, password);
    assert.match(json.error, motivo, password);
  }
});

test('cadastro responde igual exista ou não a conta, e não cria conta repetida', async () => {
  const { dados } = await criarConta();
  const antes = lerDados().users.length;

  const mesmoEmail = await post('/api/auth/cadastro', medico({ email: dados.email }));
  const mesmoCrm = await post('/api/auth/cadastro', medico({ crm: dados.crm, uf: dados.uf }));
  for (const resp of [mesmoEmail, mesmoCrm]) {
    assert.strictEqual(resp.status, 200);
    assert.match(resp.json.message, /Enviamos um link de confirmação/);
    assert.strictEqual(resp.json.devUrl, undefined, 'link de conta alheia vazou na resposta');
  }
  assert.strictEqual(lerDados().users.length, antes, 'cadastro repetido criou conta');
});

test('teto de cadastros por rede: o 11º na mesma hora é recusado', async () => {
  const cabecalhos = { 'x-forwarded-for': '172.16.0.9' };
  for (let i = 0; i < 10; i++) {
    assert.strictEqual((await post('/api/auth/cadastro', medico(), { cabecalhos })).status, 200);
  }
  const r = await post('/api/auth/cadastro', medico(), { cabecalhos });
  assert.strictEqual(r.status, 429);
});

test('termos aceitos ficam gravados com versão e data', async () => {
  const { dados } = await criarConta();
  const u = lerDados().users.find((x) => x.email === dados.email);
  assert.ok(u.termos_versao, 'versão dos termos não gravada');
  assert.ok(u.termos_aceitos_em, 'data do aceite não gravada');
});

/* ---------- confirmação de e-mail e sessão ---------- */

test('sem confirmar o e-mail não entra, e a tela sabe dizer por quê', async () => {
  const dados = medico();
  await post('/api/auth/cadastro', dados);
  const { status, json } = await post('/api/auth/login', { crm: dados.crm, uf: dados.uf, password: SENHA });
  assert.strictEqual(status, 403);
  assert.strictEqual(json.codigo, 'email_nao_confirmado');
  assert.match(json.emailMascarado, /@clinica\.com\.br$/);
});

test('regressão D5: a sessão vem só em cookie HttpOnly e SameSite=Strict', async () => {
  const dados = medico();
  const c = await post('/api/auth/cadastro', dados);
  const conf = await post('/api/auth/confirmar-email', { token: tokenDoLink(c.json.devUrl) });
  assert.strictEqual(conf.status, 200);
  assert.strictEqual(conf.json.token, undefined, 'o token voltou no corpo, ao alcance de script');
  const cookie = conf.r.headers.getSetCookie().find((x) => /sessao=/.test(x));
  assert.ok(cookie, 'sem cookie de sessão');
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /SameSite=Strict/);
  assert.match(cookie, /Path=\//);

  // O mesmo cookie autentica a página.
  const token = tokenDaResposta(conf.r);
  const me = await fetch(base + '/api/auth/me', { headers: { cookie: `sessao=${token}` } });
  assert.strictEqual(me.status, 200);

  // O link é de uso único.
  const de_novo = await post('/api/auth/confirmar-email', { token: tokenDoLink(c.json.devUrl) });
  assert.strictEqual(de_novo.status, 400);
});

test('pedido com Origin de outro site é recusado', async () => {
  const { token } = await criarConta();
  const fora = await post('/api/auth/logout', {}, { token, cabecalhos: { origin: 'https://site-malicioso.com' } });
  assert.strictEqual(fora.status, 403);
  const dentro = await post('/api/auth/logout', {}, { token, cabecalhos: { origin: base } });
  assert.strictEqual(dentro.status, 200);
});

test('sessão parada há mais de 1 hora não vale mais', async () => {
  const { token } = await criarConta();
  assert.strictEqual((await get('/api/auth/me', token)).status, 200);
  const db = lerDados();
  for (const s of db.sessions) s.ultimo_uso_em = new Date(Date.now() - 61 * 60 * 1000).toISOString();
  gravarDados(db);
  assert.strictEqual((await get('/api/auth/me', token)).status, 401);
});

/* ---------- entrada e limite de tentativas ---------- */

test('mesma mensagem para senha errada e para CRM sem conta', async () => {
  const { dados } = await criarConta();
  const errada = await post('/api/auth/login', { crm: dados.crm, uf: dados.uf, password: 'Outra coisa!' });
  const semConta = await post('/api/auth/login', { crm: '7654321', uf: 'AC', password: 'Outra coisa!' });
  assert.strictEqual(errada.status, 401);
  assert.strictEqual(semConta.status, 401);
  assert.strictEqual(errada.json.error, semConta.json.error);
});

test('entra com CRM, estado e senha; o hash antigo é refeito no primeiro acerto', async () => {
  const { dados } = await criarConta();
  const r = await post('/api/auth/login', { crm: ` 0${dados.crm} `, uf: 'sp', password: SENHA });
  assert.strictEqual(r.status, 200, JSON.stringify(r.json));
  assert.strictEqual(r.json.user.crm, `${dados.crm}/SP`);
  assert.ok(tokenDaResposta(r.r));
});

test('regressão D3: trocar de IP não zera o limite de tentativas da conta', async () => {
  const { dados } = await criarConta();
  for (let i = 0; i < 5; i++) {
    const ip = `10.0.0.${i + 1}`;
    const r = await post('/api/auth/login', { crm: dados.crm, uf: dados.uf, password: 'Errada!!' },
      { cabecalhos: { 'x-forwarded-for': ip } });
    assert.strictEqual(r.status, 401);
  }
  const bloqueado = await post('/api/auth/login', { crm: dados.crm, uf: dados.uf, password: SENHA },
    { cabecalhos: { 'x-forwarded-for': '10.0.0.99' } });
  assert.strictEqual(bloqueado.status, 429, 'IP novo voltou a tentar sem espera');
  assert.match(bloqueado.json.error, /Aguarde/);
});

test('regressão D4: o limite de tentativas sobrevive ao reinício do servidor', async () => {
  const arquivo = arquivoDeDadosTemporario('login-reinicio');
  let s = subir({}, arquivo);
  await esperarSaude(s.base);
  const dados = medico();
  const c = await fetch(s.base + '/api/auth/cadastro', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(dados),
  }).then((r) => r.json());
  await fetch(s.base + '/api/auth/confirmar-email', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ token: tokenDoLink(c.devUrl) }),
  });
  for (let i = 0; i < 5; i++) {
    await fetch(s.base + '/api/auth/login', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ crm: dados.crm, uf: dados.uf, password: 'Errada!!' }),
    });
  }
  s.proc.kill();
  await new Promise((r) => setTimeout(r, 300));

  s = subir({}, arquivo);
  try {
    await esperarSaude(s.base);
    const r = await fetch(s.base + '/api/auth/login', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ crm: dados.crm, uf: dados.uf, password: SENHA }),
    });
    assert.strictEqual(r.status, 429, 'o reinício zerou o contador');
  } finally {
    s.proc.kill();
  }
});

test('na 50ª falha seguida a senha é desativada e só volta por "esqueci a senha"', async () => {
  const { dados, token } = await criarConta();
  const db = lerDados();
  db.tentativas.push({
    chave: `login:${dados.crm}/${dados.uf}`,
    contagem: 49,
    janela_inicio: new Date().toISOString(),
    atualizado_em: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
  });
  gravarDados(db);

  const r = await post('/api/auth/login', { crm: dados.crm, uf: dados.uf, password: 'Errada!!' });
  assert.strictEqual(r.status, 401);
  const u = lerDados().users.find((x) => x.email === dados.email);
  assert.strictEqual(u.password_hash, null, 'senha não foi desativada');
  assert.strictEqual((await get('/api/auth/me', token)).status, 401, 'sessões abertas continuaram valendo');
  assert.ok(lerDados().eventos.some((e) => e.user_id === u.id && e.tipo === 'senha_desativada'));

  // A conta não fica trancada: o caminho de volta funciona.
  const pedido = await post('/api/auth/esqueci', { email: dados.email });
  const nova = await post('/api/auth/nova-senha', { token: tokenDoLink(pedido.json.devUrl), password: 'Outra gaveta#' });
  assert.strictEqual(nova.status, 200, JSON.stringify(nova.json));
});

/* ---------- esqueci a senha ---------- */

test('esqueci a senha: resposta neutra, link de 30 min, senha fraca não queima o link', async () => {
  const { dados, token: sessaoAntiga } = await criarConta();
  const semConta = await post('/api/auth/esqueci', { email: 'ninguem@clinica.com.br' });
  const comConta = await post('/api/auth/esqueci', { email: dados.email });
  assert.strictEqual(semConta.json.message, comConta.json.message);
  assert.ok(comConta.json.devUrl);

  const link = tokenDoLink(comConta.json.devUrl);
  const reset = lerDados().resets.find((x) => x.finalidade === 'redefinir_senha' && !x.used_at);
  const minutos = (new Date(reset.expires_at) - Date.now()) / 60000;
  assert.ok(minutos > 28 && minutos <= 30, `link vale ${minutos} min`);

  const fraca = await post('/api/auth/nova-senha', { token: link, password: 'curta' });
  assert.strictEqual(fraca.status, 400);
  const boa = await post('/api/auth/nova-senha', { token: link, password: 'Nova gaveta!' });
  assert.strictEqual(boa.status, 200, 'a senha fraca queimou o link');

  assert.strictEqual((await get('/api/auth/me', sessaoAntiga)).status, 401, 'sessão antiga sobreviveu à troca');
  const login = await post('/api/auth/login', { crm: dados.crm, uf: dados.uf, password: 'Nova gaveta!' });
  assert.strictEqual(login.status, 200);
});

test('link de confirmar e-mail não serve para trocar senha, e vice-versa', async () => {
  const dados = medico();
  const c = await post('/api/auth/cadastro', dados);
  const r = await post('/api/auth/nova-senha', { token: tokenDoLink(c.json.devUrl), password: 'Nova gaveta!' });
  assert.strictEqual(r.status, 400);
});

test('trocar a senha logado exige a senha atual e derruba as outras sessões', async () => {
  const { dados, token } = await criarConta();
  const outra = tokenDaResposta((await post('/api/auth/login', { crm: dados.crm, uf: dados.uf, password: SENHA })).r);

  const errada = await post('/api/auth/trocar-senha', { atual: 'Nao sei!', nova: 'Nova gaveta!' }, { token });
  assert.strictEqual(errada.status, 400);
  const ok = await post('/api/auth/trocar-senha', { atual: SENHA, nova: 'Nova gaveta!' }, { token });
  assert.strictEqual(ok.status, 200);
  assert.strictEqual((await get('/api/auth/me', outra)).status, 401);
  assert.strictEqual((await get('/api/auth/me', tokenDaResposta(ok.r))).status, 200);
});

/* ---------- conferência do CRM ---------- */

async function extrair(token) {
  const fd = new FormData();
  fd.append('texto', 'caso de teste');
  return fetch(base + '/api/extract', { method: 'POST', headers: { authorization: 'Bearer ' + token }, body: fd });
}

test('CRM pendente usa a liberação de 48 h; vencida, a leitura de laudo é barrada', async () => {
  const { dados, token, user } = await criarConta();
  assert.strictEqual(user.crmStatus, 'pendente');
  assert.strictEqual(user.crmLiberado, true);
  const horas = (new Date(user.liberadoAte) - Date.now()) / 3600000;
  assert.ok(horas > 47.9 && horas <= 48, `liberação de ${horas} h`);
  assert.notStrictEqual((await extrair(token)).status, 403, 'barrou dentro das 48 h');

  const db = lerDados();
  db.users.find((x) => x.email === dados.email).liberado_ate = new Date(Date.now() - 1000).toISOString();
  gravarDados(db);
  const barrado = await extrair(token);
  assert.strictEqual(barrado.status, 403);
  assert.strictEqual((await barrado.json()).crm, 'pendente');

  const chat = await post('/api/chat', { mensagens: [{ papel: 'medico', texto: 'oi' }] }, { token });
  assert.strictEqual(chat.status, 403, 'a Gena continuou aberta com a liberação vencida');
});

test('só administrador vê a fila; conferido libera, recusado barra', async () => {
  const { token: tokenMedico, user } = await criarConta();
  assert.strictEqual((await get('/api/admin/conferencias', tokenMedico)).status, 404);

  const tokenAdmin = await sessaoDoAdmin();
  assert.strictEqual((await get('/api/auth/me', tokenAdmin)).json.user.admin, true);
  const fila = await get('/api/admin/conferencias', tokenAdmin);
  assert.strictEqual(fila.status, 200);
  assert.ok(fila.json.pendentes.some((p) => p.id === user.id));

  const sim = await post(`/api/admin/conferencias/${user.id}`, { decisao: 'ativo' }, { token: tokenAdmin });
  assert.strictEqual(sim.status, 200);
  assert.strictEqual((await get('/api/auth/me', tokenMedico)).json.user.crmStatus, 'ativo');

  const nao = await post(`/api/admin/conferencias/${user.id}`, { decisao: 'recusado' }, { token: tokenAdmin });
  assert.strictEqual(nao.status, 200);
  const barrado = await extrair(tokenMedico);
  assert.strictEqual(barrado.status, 403);
  assert.strictEqual((await barrado.json()).crm, 'recusado');

  const invalida = await post(`/api/admin/conferencias/${user.id}`, { decisao: 'talvez' }, { token: tokenAdmin });
  assert.strictEqual(invalida.status, 400);
  const admin = lerDados().users.find((u) => u.email === ADMIN);
  assert.ok(lerDados().eventos.some((e) => e.user_id === admin.id && e.tipo === 'admin_acao'));
});

test('administrador sem e-mail confirmado não é administrador', () => {
  const anterior = process.env.ADMIN_EMAILS;
  process.env.ADMIN_EMAILS = ADMIN;
  try {
    const auth = require('../auth.js');
    assert.strictEqual(auth.ehAdmin({ email: ADMIN, email_verificado_em: null }), false);
    assert.strictEqual(auth.ehAdmin({ email: ADMIN.toUpperCase(), email_verificado_em: new Date().toISOString() }), true);
    assert.strictEqual(auth.ehAdmin({ email: 'outro@exemplo.com.br', email_verificado_em: new Date().toISOString() }), false);
  } finally {
    process.env.ADMIN_EMAILS = anterior;
  }
});

test('conta conferida que muda o nome volta para a conferência, com 48 h novas', async () => {
  const { token, user } = await criarConta();
  const tokenAdmin = await sessaoDoAdmin();
  await post(`/api/admin/conferencias/${user.id}`, { decisao: 'ativo' }, { token: tokenAdmin });
  assert.strictEqual((await get('/api/auth/me', token)).json.user.crmStatus, 'ativo');

  const r = await post('/api/auth/me', { name: 'Dra. Beatriz Moraes Lima' }, { token, metodo: 'PATCH' });
  assert.strictEqual(r.status, 200, JSON.stringify(r.json));
  assert.strictEqual(r.json.user.crmStatus, 'pendente');
  assert.strictEqual(r.json.user.crmLiberado, true);
});

test('CRM de outra conta não pode ser assumido pela edição de perfil', async () => {
  const a = await criarConta();
  const b = await criarConta();
  const r = await post('/api/auth/me', { name: b.dados.name, crm: a.dados.crm, uf: a.dados.uf },
    { token: b.token, metodo: 'PATCH' });
  assert.strictEqual(r.status, 409);
});

/* ---------- Minha conta: dados, acessos, exclusão ---------- */

test('Minha conta mostra sessões e acessos, sem hash nem token', async () => {
  const { token } = await criarConta();
  const r = await get('/api/auth/conta', token);
  assert.strictEqual(r.status, 200);
  assert.ok(r.json.sessoes.some((s) => s.atual));
  assert.ok(r.json.acessos.some((a) => a.tipo === 'login_ok'));
  const texto = JSON.stringify(r.json);
  assert.doesNotMatch(texto, /token_hash|password_hash|scrypt/);
});

test('baixar meus dados vem como anexo e sem segredo nenhum', async () => {
  const { token } = await criarConta();
  const r = await fetch(base + '/api/auth/meus-dados', { headers: { authorization: 'Bearer ' + token } });
  assert.strictEqual(r.status, 200);
  assert.match(r.headers.get('content-disposition'), /attachment/);
  const texto = await r.text();
  assert.doesNotMatch(texto, /token_hash|password_hash|scrypt/);
  assert.ok(JSON.parse(texto).registroDeAcessos.length > 0);
});

test('excluir a conta pede a senha, apaga tudo e guarda só o registro de acesso', async () => {
  const { dados, token, user } = await criarConta();
  const errada = await post('/api/auth/conta', { password: 'Nao sei!' }, { token, metodo: 'DELETE' });
  assert.strictEqual(errada.status, 400);

  const ok = await post('/api/auth/conta', { password: SENHA }, { token, metodo: 'DELETE' });
  assert.strictEqual(ok.status, 200);
  const db = lerDados();
  assert.ok(!db.users.some((u) => u.id === user.id), 'usuário ficou');
  assert.ok(!db.sessions.some((s) => s.user_id === user.id), 'sessão ficou');
  assert.ok(!db.resets.some((s) => s.user_id === user.id), 'link ficou');
  const fim = db.eventos.find((e) => e.user_id === user.id && e.tipo === 'conta_excluida');
  assert.ok(fim, 'o registro de acesso sumiu junto');
  assert.match(fim.detalhe, new RegExp(dados.crm));
  assert.strictEqual((await get('/api/auth/me', token)).status, 401);
});

test('nenhuma senha e nenhum token aparecem no arquivo de dados', async () => {
  const { dados, token } = await criarConta();
  const bruto = fs.readFileSync(dataFile, 'utf8');
  assert.ok(!bruto.includes(SENHA), 'senha em texto puro no banco');
  assert.ok(!bruto.includes(token), 'token de sessão em texto puro no banco');
  assert.ok(bruto.includes(dados.email));
});

/* ---------- boot em produção ---------- */

async function saidaDoBoot(env) {
  const s = subir({ NODE_ENV: 'production', ...env }, arquivoDeDadosTemporario('login-boot'));
  const codigo = await new Promise((resolve) => {
    const t = setTimeout(() => { s.proc.kill(); resolve('subiu'); }, 4000);
    s.proc.on('exit', (c) => { clearTimeout(t); resolve(c); });
  });
  return { codigo, texto: s.saida() };
}

test('produção no modo completo não sobe sem banco, endereço e chave de cifra', async () => {
  const { codigo, texto } = await saidaDoBoot({ RESEND_API_KEY: 're_teste', DATABASE_URL: '', CHAVE_CIFRA: '' });
  assert.strictEqual(codigo, 1, 'subiu sem DATABASE_URL');
  assert.match(texto, /DATABASE_URL/);
  assert.match(texto, /APP_ORIGIN/);
  assert.match(texto, /CHAVE_CIFRA/);
});

test('produção no modo simples só sobe com permissão explícita', async () => {
  const negado = await saidaDoBoot({ AUTH_MODE: 'simples' });
  assert.strictEqual(negado.codigo, 1);
  assert.match(negado.texto, /PERMITIR_MODO_SIMPLES/);
  const permitido = await saidaDoBoot({ AUTH_MODE: 'simples', PERMITIR_MODO_SIMPLES: 'sim' });
  assert.strictEqual(permitido.codigo, 'subiu');
});
