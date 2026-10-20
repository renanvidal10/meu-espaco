'use strict';

// Peças do login definitivo (§85) testadas de perto: senha, cifra, e-mail, e
// a camada de banco rodando contra um Postgres DE VERDADE em memória (PGlite).
// Sem isso o caminho de produção (Postgres) nunca seria exercitado pela
// suíte, que por regra não fala com banco real (store.js, EM_TESTE).

const test = require('node:test');
const assert = require('node:assert');
const crypto = require('node:crypto');
const { PGlite } = require('@electric-sql/pglite');

process.env.CHAVE_CIFRA = 'chave-de-teste-da-cifra-com-texto-longo';

const store = require('../store.js');
const auth = require('../auth.js');
const cifra = require('../cifra.js');

const db = new PGlite();
const pool = {
  async query(sql, params) {
    if (!params) {
      await db.exec(sql);
      return { rows: [], rowCount: 0 };
    }
    const r = await db.query(sql, params);
    return { rows: r.rows, rowCount: r.affectedRows ?? r.rows.length };
  },
};

test.before(async () => {
  // Esquema ANTIGO primeiro (o que existe hoje em produção, v1.0): o init
  // novo precisa migrar por cima dele sem perder nada.
  await pool.query(`
    CREATE TABLE users (id TEXT PRIMARY KEY, email TEXT UNIQUE NOT NULL, name TEXT NOT NULL,
      crm TEXT NOT NULL, password_hash TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      last_login_at TIMESTAMPTZ);
    CREATE TABLE sessions (token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      expires_at TIMESTAMPTZ NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
    CREATE TABLE resets (token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      expires_at TIMESTAMPTZ NOT NULL, used_at TIMESTAMPTZ, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
    INSERT INTO users (id, email, name, crm) VALUES ('antigo', 'crm-1-sp@acesso.oncogenyx', 'Conta Antiga', '1 SP');
    INSERT INTO resets (token_hash, user_id, expires_at) VALUES ('r-antigo', 'antigo', NOW() + INTERVAL '1 hour');
  `);
  store.usarBancoDeTeste(pool);
  await store.init();
  await store.init(); // duas vezes: a migração precisa ser idempotente
});

/* ---------- senha ---------- */

test('regressão D1: o hash da senha não trava o servidor enquanto calcula', async () => {
  let voltas = 0;
  const relogio = setInterval(() => { voltas += 1; }, 1);
  const hash = await auth.hashPassword('Gaveta azul!');
  clearInterval(relogio);
  assert.ok(voltas > 3, `o laço de eventos ficou parado durante o hash (${voltas} voltas)`);
  assert.ok(await auth.verifyPassword('Gaveta azul!', hash));
  assert.strictEqual(await auth.verifyPassword('Gaveta azul?', hash), false);
});

test('regressão D2: parâmetros do scrypt acima do mínimo OWASP, em formato versionado', async () => {
  const hash = await auth.hashPassword('Gaveta azul!');
  const [versao, N, r, p] = hash.split('$');
  assert.strictEqual(versao, 'scrypt2');
  assert.ok(Number(N) >= 2 ** 15 && Number(r) >= 8 && Number(p) >= 3, hash.slice(0, 30));
  assert.strictEqual(auth.precisaRefazerHash(hash), false);
});

test('hash da v1.0 continua valendo e é marcado para refazer', async () => {
  const salt = crypto.randomBytes(16).toString('hex');
  const derivado = crypto.scryptSync('Gaveta azul!', salt, 64).toString('hex');
  const antigo = `scrypt$${salt}$${derivado}`;
  assert.ok(await auth.verifyPassword('Gaveta azul!', antigo));
  assert.strictEqual(auth.precisaRefazerHash(antigo), true);
  assert.strictEqual(await auth.verifyPassword('x', 'lixo$sem$formato'), false);
  assert.strictEqual(await auth.verifyPassword('x', null), false);
});

test('a mesma senha digitada com acento composto ou decomposto confere', async () => {
  const hash = await auth.hashPassword('Coração azul!');
  assert.ok(await auth.verifyPassword('Coração azul!', hash));
});

test('regra da senha: aceita o que o dono decidiu e recusa o óbvio', () => {
  const aceitas = ['Gaveta azul!', 'X9#k2$7!Qp', 'Caneta-Verde', 'Ônibus 42 lotado', 'Mar de Ipanema.'];
  for (const s of aceitas) assert.strictEqual(auth.validatePassword(s), null, s);
  const recusadas = ['Abc!12', 'semmaiuscula!', 'SemEspecial1', 'Senha@2026', 'P@ssw0rd!', 'Qwerty#12',
    'Mudar@123', 'A@12345678', 'Brasil#2026', 'x'.repeat(129) + 'A!'];
  for (const s of recusadas) assert.ok(auth.validatePassword(s), s);
  assert.ok(auth.validatePassword('Moraes#2026', { nome: 'Dra. Beatriz Moraes' }));
  assert.ok(auth.validatePassword('Qualquer#204512', { crm: '204512' }));
  assert.ok(auth.validatePassword('Bia.moraes!', { email: 'bia.moraes@clinica.com.br' }));
});

test('espera depois de falhas seguidas cresce e para em 15 minutos', () => {
  assert.strictEqual(auth.esperaDepoisDe(4), 0);
  assert.strictEqual(auth.esperaDepoisDe(5), 30 * 1000);
  assert.strictEqual(auth.esperaDepoisDe(6), 60 * 1000);
  assert.strictEqual(auth.esperaDepoisDe(40), 15 * 60 * 1000);
});

test('CRM e UF normalizados; o que não é CRM é recusado', () => {
  assert.strictEqual(auth.normalizarCrm(' 0123.456 '), '123456');
  assert.strictEqual(auth.normalizarCrm('12345678'), null);
  assert.strictEqual(auth.normalizarCrm('abc'), null);
  assert.strictEqual(auth.normalizarUf('rj'), 'RJ');
  assert.strictEqual(auth.normalizarUf('XX'), null);
});

/* ---------- cifra dos tokens do Plaud ---------- */

test('cifra: ida e volta, valor legado em texto puro e adulteração detectada', () => {
  const c = cifra.cifrar('token-do-plaud');
  assert.ok(cifra.estaCifrado(c));
  assert.ok(!c.includes('token-do-plaud'));
  assert.strictEqual(cifra.decifrar(c), 'token-do-plaud');
  assert.strictEqual(cifra.decifrar('legado-em-texto-puro'), 'legado-em-texto-puro');
  const partes = c.split(':');
  partes[3] = Buffer.from('outra coisa').toString('base64url');
  assert.throws(() => cifra.decifrar(partes.join(':')));
});

/* ---------- e-mail ---------- */

test('regressão D8: nome do médico entra escapado no HTML do e-mail', async () => {
  const mailer = require('../email.js');
  const anterior = { chave: process.env.RESEND_API_KEY, fetch: global.fetch };
  let corpo = null;
  process.env.RESEND_API_KEY = 're_teste';
  global.fetch = async (_url, opcoes) => { corpo = JSON.parse(opcoes.body); return { ok: true }; };
  try {
    await mailer.sendConfirmacao({
      to: 'a@b.com.br', name: '<a href="https://golpe.example">Clique</a>', url: 'https://x.test/?c=1', origem: 'https://x.test',
    });
  } finally {
    process.env.RESEND_API_KEY = anterior.chave;
    global.fetch = anterior.fetch;
  }
  assert.ok(corpo, 'nada foi enviado');
  assert.ok(!corpo.html.includes('<a href="https://golpe.example">'), 'HTML do nome entrou cru no e-mail');
  assert.match(corpo.html, /&lt;a href=/);
  assert.doesNotMatch(corpo.html + corpo.text, / [—–] /, 'travessão no texto do e-mail (§84)');
});

/* ---------- banco (Postgres em memória) ---------- */

test('migração preserva a conta e o link antigos e acrescenta as colunas novas', async () => {
  const antigo = await store.findUserById('antigo');
  assert.strictEqual(antigo.name, 'Conta Antiga');
  assert.ok('crm_status' in antigo && 'email_verificado_em' in antigo);
  assert.ok(await store.findReset('r-antigo', 'redefinir_senha'), 'link antigo perdeu a finalidade padrão');
});

async function contaNova(extra = {}) {
  return store.createAccount({
    id: crypto.randomUUID(),
    email: `${crypto.randomUUID()}@clinica.com.br`,
    name: 'Dra. Teste',
    crm: String(100000 + Math.floor(Math.random() * 800000)),
    crm_uf: 'MG',
    password_hash: 'scrypt2$x',
    liberado_ate: new Date(Date.now() + 48 * 3600 * 1000),
    termos_versao: 'v-teste',
    ...extra,
  });
}

test('createAccount: e-mail ou CRM+UF repetido devolve null, sem lançar', async () => {
  const a = await contaNova();
  assert.strictEqual(a.crm_status, 'pendente');
  assert.strictEqual(await contaNova({ email: a.email }), null);
  assert.strictEqual(await contaNova({ crm: a.crm, crm_uf: 'MG' }), null);
  assert.ok(await contaNova({ crm: a.crm, crm_uf: 'RJ' }), 'mesmo número em outro estado é outro médico');
  assert.strictEqual((await store.findUserByCrm(a.crm, 'MG')).id, a.id);
});

test('updateUser só aceita colunas da lista fechada', async () => {
  const a = await contaNova();
  await assert.rejects(store.updateUser(a.id, { 'id = id; DROP TABLE users; --': 1 }), /não editável/);
  await store.updateUser(a.id, { name: 'Novo Nome', email_verificado_em: new Date() });
  const lido = await store.findUserById(a.id);
  assert.strictEqual(lido.name, 'Novo Nome');
  assert.ok(lido.email_verificado_em);
});

test('links por e-mail: uso único, finalidade separada, só o mais novo vale', async () => {
  const a = await contaNova();
  const venc = new Date(Date.now() + 60_000);
  await store.createReset('h1', a.id, venc, 'confirmar_email');
  await store.createReset('h2', a.id, venc, 'redefinir_senha');
  assert.strictEqual(await store.consumeReset('h1', 'redefinir_senha'), null, 'finalidade trocada passou');
  assert.ok(await store.consumeReset('h1', 'confirmar_email'));
  assert.strictEqual(await store.consumeReset('h1', 'confirmar_email'), null, 'link usado duas vezes');
  await store.createReset('h3', a.id, venc, 'redefinir_senha');
  assert.strictEqual(await store.findReset('h2', 'redefinir_senha'), null, 'link antigo continuou valendo');
  assert.ok(await store.findReset('h3', 'redefinir_senha'));
});

test('tentativas: soma na janela e recomeça quando ela vence', async () => {
  const chave = `teste:${crypto.randomUUID()}`;
  assert.strictEqual((await store.registrarTentativa(chave, 60_000)).contagem, 1);
  assert.strictEqual((await store.registrarTentativa(chave, 60_000)).contagem, 2);
  assert.strictEqual((await store.lerTentativa(chave, 60_000)).contagem, 2);
  await pool.query("UPDATE tentativas SET janela_inicio = NOW() - INTERVAL '2 minutes' WHERE chave = $1", [chave]);
  assert.strictEqual((await store.lerTentativa(chave, 60_000)).contagem, 0);
  assert.strictEqual((await store.registrarTentativa(chave, 60_000)).contagem, 1);
  await store.zerarTentativa(chave);
  assert.strictEqual((await store.lerTentativa(chave, 60_000)).contagem, 0);
});

test('sessão: vale, cai por inatividade de 1 hora e o último uso é atualizado', async () => {
  const a = await contaNova();
  const token = await auth.issueSession(a.id, { ip: '1.2.3.4', agente: 'Chrome no Mac' });
  const user = await auth.resolveSession(token);
  assert.strictEqual(user.id, a.id);
  const [s] = await store.listarSessoes(a.id);
  assert.strictEqual(s.agente, 'Chrome no Mac');

  await pool.query("UPDATE sessions SET ultimo_uso_em = NOW() - INTERVAL '30 minutes' WHERE user_id = $1", [a.id]);
  assert.ok(await auth.resolveSession(token), 'caiu antes de 1 hora');
  const [tocada] = await store.listarSessoes(a.id);
  assert.ok(Date.now() - new Date(tocada.ultimo_uso_em).getTime() < 5000, 'último uso não foi atualizado');

  await pool.query("UPDATE sessions SET ultimo_uso_em = NOW() - INTERVAL '61 minutes' WHERE user_id = $1", [a.id]);
  assert.strictEqual(await auth.resolveSession(token), null, 'sessão parada continuou valendo');
  assert.strictEqual((await store.listarSessoes(a.id)).length, 0, 'sessão vencida não foi apagada');
});

test('sessão com mais de 12 horas não vale, mesmo em uso', async () => {
  const a = await contaNova();
  const token = await auth.issueSession(a.id);
  await pool.query("UPDATE sessions SET expires_at = NOW() - INTERVAL '1 second' WHERE user_id = $1", [a.id]);
  assert.strictEqual(await auth.resolveSession(token), null);
});

test('tokens do Plaud ficam cifrados no banco e voltam legíveis', async () => {
  const a = await contaNova();
  await store.savePlaudTokens(a.id, { accessToken: 'acesso-secreto', refreshToken: 'renova-secreto', expiresAt: new Date() });
  const { rows } = await pool.query('SELECT access_token, refresh_token FROM plaud_tokens WHERE user_id = $1', [a.id]);
  assert.ok(cifra.estaCifrado(rows[0].access_token) && cifra.estaCifrado(rows[0].refresh_token));
  assert.ok(!JSON.stringify(rows).includes('secreto'));
  const lido = await store.getPlaudTokens(a.id);
  assert.strictEqual(lido.access_token, 'acesso-secreto');
  assert.strictEqual(lido.refresh_token, 'renova-secreto');
});

test('excluir conta leva sessões, links e Plaud; o evento fica', async () => {
  const a = await contaNova();
  await auth.issueSession(a.id);
  await store.createReset('h-excluir', a.id, new Date(Date.now() + 60_000), 'redefinir_senha');
  await store.savePlaudTokens(a.id, { accessToken: 'x' });
  await store.registrarEvento({ userId: a.id, tipo: 'conta_excluida', ip: '1.2.3.4' });
  await store.deleteUser(a.id);
  for (const tabela of ['users', 'sessions', 'resets', 'plaud_tokens']) {
    const coluna = tabela === 'users' ? 'id' : 'user_id';
    const { rows } = await pool.query(`SELECT 1 FROM ${tabela} WHERE ${coluna} = $1`, [a.id]);
    assert.strictEqual(rows.length, 0, `${tabela} ficou com dado da conta excluída`);
  }
  assert.strictEqual((await store.listarEventos(a.id)).length, 1, 'o registro de acesso sumiu junto');
});

test('limpeza apaga evento com mais de 6 meses e mantém o recente', async () => {
  const a = await contaNova();
  await store.registrarEvento({ userId: a.id, tipo: 'login_ok' });
  await store.registrarEvento({ userId: a.id, tipo: 'logout' });
  await pool.query(
    "UPDATE eventos SET criado_em = NOW() - INTERVAL '184 days' WHERE user_id = $1 AND tipo = 'logout'", [a.id]);
  await store.limparExpirados();
  const restantes = (await store.listarEventos(a.id)).map((e) => e.tipo);
  assert.deepStrictEqual(restantes, ['login_ok']);
});

test('fila do administrador: só pendentes com e-mail confirmado', async () => {
  const sem = await contaNova();
  const com = await contaNova();
  await store.updateUser(com.id, { email_verificado_em: new Date() });
  const { pendentes } = await store.listarContasParaConferencia();
  const ids = pendentes.map((p) => p.id);
  assert.ok(ids.includes(com.id));
  assert.ok(!ids.includes(sem.id), 'conta sem e-mail confirmado apareceu para conferir');
  await store.updateUser(com.id, { crm_status: 'ativo', crm_conferido_em: new Date() });
  const depois = await store.listarContasParaConferencia();
  assert.ok(depois.decididas.some((d) => d.id === com.id));
});

test('situação do CRM: conferido libera, recusado barra, pendente vale 48 h', () => {
  const futuro = new Date(Date.now() + 3600_000).toISOString();
  const passado = new Date(Date.now() - 1000).toISOString();
  assert.strictEqual(auth.situacaoDoCrm({ crm_uf: 'SP', crm_status: 'ativo' }).liberado, true);
  assert.strictEqual(auth.situacaoDoCrm({ crm_uf: 'SP', crm_status: 'recusado' }).liberado, false);
  assert.strictEqual(auth.situacaoDoCrm({ crm_uf: 'SP', crm_status: 'pendente', liberado_ate: futuro }).liberado, true);
  assert.strictEqual(auth.situacaoDoCrm({ crm_uf: 'SP', crm_status: 'pendente', liberado_ate: passado }).liberado, false);
  assert.strictEqual(auth.situacaoDoCrm({ crm: '123 SP' }).liberado, true, 'conta do modo simples não passa por conferência');
});
