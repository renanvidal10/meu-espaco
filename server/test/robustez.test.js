'use strict';

// Travas de robustez. Cada teste corresponde a um achado medido em auditoria,
// com o cenário real que o produziu — a descrição diz qual.

const test = require('node:test');
const assert = require('node:assert');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { criarStub } = require('./stub-anthropic.js');
const store = require('../store.js');
const pdf = require('../pdf.js');

let stub;
let app;
let base;
let token;

async function esperarSaude(url, tentativas = 60) {
  for (let i = 0; i < tentativas; i++) {
    try { if ((await fetch(url + '/api/health')).ok) return; } catch (e) { /* subindo */ }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error('o servidor não subiu a tempo');
}

function subir(env = {}) {
  const dataFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'oncogenyx-rob-')), 'dados.json');
  const porta = 5600 + Math.floor(Math.random() * 300);
  const proc = spawn(process.execPath, [path.join(__dirname, '..', 'index.js')], {
    env: {
      ...process.env,
      PORT: String(porta), NODE_ENV: 'test', DATA_FILE: dataFile,
      ANTHROPIC_API_KEY: 'chave-de-teste', DATABASE_URL: '', RESEND_API_KEY: '',
      ...env,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  return { proc, base: `http://127.0.0.1:${porta}` };
}

const fonte = (arquivo) => fs.readFileSync(path.join(__dirname, '..', arquivo), 'utf8');

test.before(async () => {
  stub = criarStub();
  const portaStub = await stub.ouvir(0);
  const s = subir({ ANTHROPIC_BASE_URL: `http://127.0.0.1:${portaStub}` });
  app = s.proc;
  base = s.base;
  app.stderr.on('data', (d) => {
    const t = String(d);
    if (!/DeprecationWarning|punycode/.test(t)) process.stderr.write('[app] ' + t);
  });
  await esperarSaude(base);
  const r = await fetch(base + '/api/auth/acesso', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: 'Renan Vidal', crm: '339324' }),
  });
  token = (await r.json()).token;
});

test.after(async () => {
  if (app) app.kill();
  if (stub) await stub.fechar();
});

/* ===== o processo não pode morrer por erro isolado ===== */

test('handlers de processo instalados: um erro assíncrono não desliga todos os médicos', () => {
  // Sem estes, uma promise rejeitada mata o processo — e com disco efêmero
  // isso apaga as sessões de todo mundo que estava logado.
  const codigo = fonte('index.js');
  assert.match(codigo, /process\.on\('unhandledRejection'/, 'sem tratador de promise rejeitada');
  assert.match(codigo, /process\.on\('uncaughtException'/, 'sem tratador de exceção');
  assert.match(codigo, /process\.on\('SIGTERM'/, 'sem encerramento ordenado no deploy');
});

test('pool do Postgres declara listener de erro', () => {
  // O pg emite 'error' no pool quando cai uma conexão ociosa. Sem listener,
  // o EventEmitter LANÇA e o processo morre. Neon e Supabase derrubam ociosas.
  const codigo = fonte('store.js');
  assert.match(codigo, /pool\.on\('error'/, 'pool sem listener de error mata o processo');
  assert.match(codigo, /connectionTimeoutMillis/, 'sem timeout de conexão');
});

test('cliente da API tem timeout e teto de retentativas', () => {
  // Padrão do SDK: 600 s por tentativa, 3 tentativas = até 30 min pendurado,
  // com os buffers do upload presos em memória o tempo todo.
  const codigo = fonte('index.js');
  assert.match(codigo, /timeout:\s*90_?000/, 'chamada à API sem timeout');
  assert.match(codigo, /maxRetries:\s*1/, 'retentativas do SDK multiplicam o custo');
});

test('existe teto global de bytes em voo', () => {
  // Medido em cgroup de 512 MB: duas requisições simultâneas de 57 MB levavam
  // o processo a SIGKILL, e com disco efêmero isso desloga todos os médicos.
  const codigo = fonte('index.js');
  assert.match(codigo, /TETO_BYTES_EM_VOO/, 'sem teto global de memória em voo');
  assert.match(codigo, /reservaDeMemoria/, 'o teto não está aplicado na rota');
});

/* ===== memória ===== */

test('requisição acima do teto por requisição é recusada, e o servidor sobrevive', async () => {
  const corpo = new FormData();
  const grande = Buffer.alloc(26 * 1024 * 1024, 0x41);
  corpo.append('files', new Blob([grande], { type: 'application/pdf' }), 'enorme.pdf');
  const r = await fetch(base + '/api/extract', {
    method: 'POST', headers: { Authorization: 'Bearer ' + token }, body: corpo,
  });
  assert.ok(r.status === 413 || r.status === 400, `esperado 413 ou 400, veio ${r.status}`);

  const saude = await fetch(base + '/api/health');
  assert.strictEqual(saude.status, 200, 'o processo morreu ao rejeitar o upload');
});

/* ===== PDF não pode congelar o event loop ===== */

test('PDF acima do limite de páginas é recusado, não processado', async () => {
  // Medido: um PDF de 2,4 MB com 8000 páginas congelava o event loop por
  // 14,5 s — nenhuma rota respondia, nem o healthcheck.
  const paginas = pdf.MAX_PAGINAS + 50;
  const objetos = ['1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj'];
  const kids = [];
  for (let i = 0; i < paginas; i++) {
    const id = 3 + i;
    kids.push(`${id} 0 R`);
    objetos.push(`${id} 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]>>endobj`);
  }
  objetos.splice(1, 0, `2 0 obj<</Type/Pages/Kids[${kids.join(' ')}]/Count ${paginas}>>endobj`);
  const corpo = '%PDF-1.4\n' + objetos.join('\n') + `\ntrailer<</Size ${paginas + 3}/Root 1 0 R>>\n%%EOF`;

  await assert.rejects(
    () => pdf.extrairTexto(Buffer.from(corpo, 'latin1')),
    (err) => err.code === 'PDF_PAGINAS_DEMAIS',
    'PDF com muitas páginas deveria ser recusado antes de ser lido',
  );
});

/* ===== erro de cliente não pode virar 500 ===== */

test('JSON malformado devolve 4xx, não 500', async () => {
  const r = await fetch(base + '/api/chat', {
    method: 'POST',
    headers: { 'content-type': 'application/json', Authorization: 'Bearer ' + token },
    body: '{"messages": [',
  });
  assert.ok(r.status >= 400 && r.status < 500, `veio ${r.status}: erro do cliente virou erro do servidor`);
  const j = await r.json();
  assert.doesNotMatch(j.error, /Erro interno/);
});

test('envio de arquivo interrompido explica o que houve', async () => {
  // O cenário mais comum de todos: celular no corredor, com sinal ruim.
  const r = await fetch(base + '/api/extract', {
    method: 'POST',
    headers: {
      Authorization: 'Bearer ' + token,
      'content-type': 'multipart/form-data; boundary=----xyz',
    },
    body: '------xyz\r\nContent-Disposition: form-data; name="files"; filename="a.pdf"\r\n\r\n%PDF-1.4 tru',
  });
  assert.ok(r.status >= 400 && r.status < 500, `veio ${r.status}`);
  const j = await r.json();
  assert.match(j.error, /interrompido|conexão|entender/i);
  assert.doesNotMatch(j.error, /Erro interno/);
});

/* ===== resposta estranha do modelo ===== */

for (const [nome, resposta] of [['null', 'null'], ['array', '[1,2,3]'], ['string', '"texto"']]) {
  test(`resposta do modelo do tipo ${nome} não vira "leitura bem-sucedida"`, async () => {
    stub.limpar();
    stub.responderCom({ tipo: 'texto-cru', texto: resposta });
    const corpo = new FormData();
    corpo.append('text', 'caso qualquer');
    const r = await fetch(base + '/api/extract', {
      method: 'POST', headers: { Authorization: 'Bearer ' + token }, body: corpo,
    });
    assert.strictEqual(r.status, 502, `${nome} passou como sucesso, com o caso vazio`);
  });
}

test('rótulo de tumor fora do registro vira "Não identificado"', async () => {
  stub.limpar();
  stub.responderCom({ tipo: 'ok', extracao: { tipo_tumor: 'Rim', histologia: 'Células claras' } });
  const corpo = new FormData();
  corpo.append('text', 'tumor renal');
  const r = await fetch(base + '/api/extract', {
    method: 'POST', headers: { Authorization: 'Bearer ' + token }, body: corpo,
  });
  const j = await r.json();
  assert.strictEqual(j.extracted.tipo_tumor, 'Não identificado',
    'empurrou para a tela um subtipo que ela não sabe desenhar');
  assert.match(j.extracted.tipo_tumor_justificativa, /não está mapeado/i);
});

/* ===== avisos ===== */

test('aviso de recuperação nunca é usado como texto de erro', () => {
  // Um aviso com recuperado:true diz "deu certo". Usá-lo como erro produzia
  // tela de falha escrita "lido normalmente — nenhuma ação necessária", com a
  // instrução útil escondida no segundo aviso.
  const codigo = fonte('index.js');
  assert.match(codigo, /function mensagemDeFalha/, 'sem seleção de aviso de falha');
  assert.match(codigo, /!a\.recuperado/, 'não filtra avisos de recuperação');
});

test('avisos por arquivo sobrevivem ao caminho de erro', async () => {
  stub.limpar();
  stub.responderCom({ tipo: 'erro', status: 500, mensagem: 'boom' }, 4);
  const corpo = new FormData();
  corpo.append('text', 'caso');
  corpo.append('files', new Blob([Buffer.alloc(0)], { type: 'application/pdf' }), 'vazio.pdf');
  const r = await fetch(base + '/api/extract', {
    method: 'POST', headers: { Authorization: 'Bearer ' + token }, body: corpo,
  });
  const j = await r.json();
  assert.ok(Array.isArray(j.avisos), 'os avisos por arquivo desapareceram no erro');
  assert.ok(j.avisos.some((a) => /vazio/i.test(a.motivo)),
    'o médico não soube qual anexo foi descartado');
});

/* ===== armazenamento ===== */

test('limpeza de sessões e resets expirados existe e roda', async () => {
  // Sem isto as tabelas crescem sem teto no Postgres, e no arquivo cada
  // requisição autenticada relê o banco inteiro (26x mais lento com 20 mil).
  const r = await store.limparExpirados();
  assert.ok(r && typeof r === 'object', 'limparExpirados não devolveu resultado');
  assert.strictEqual(typeof store.deleteSessionsByUser, 'function', 'sem "sair de todos os dispositivos"');
  assert.strictEqual(typeof store.ping, 'function', 'sem verificação de saúde do armazenamento');
});

test('healthcheck verifica o armazenamento em vez de dizer ok fixo', () => {
  const codigo = fonte('index.js');
  assert.match(codigo, /await store\.ping\(\)/, 'health não verifica o armazenamento');
  assert.match(codigo, /armazenamentoOk \? 200 : 503/, 'health não devolve 503 quando o banco cai');
});

test('criação de usuário é idempotente no Postgres', () => {
  // "procura, não achou, insere" atravessa um await: duas requisições do mesmo
  // médico (duplo toque, duas abas) interleavam e a segunda batia na
  // constraint UNIQUE, virando 500 "Erro interno".
  const codigo = fonte('store.js');
  assert.match(codigo, /ON CONFLICT \(email\) DO UPDATE/, 'createUser não é idempotente');
});

/* ===== configuração ===== */

test('AUTH_MODE inválido derruba o boot em vez de cair no modo aberto', async () => {
  const s = subir({ AUTH_MODE: 'Completo-com-typo' });
  const saida = await new Promise((resolve) => {
    let texto = '';
    s.proc.stderr.on('data', (d) => { texto += d; });
    s.proc.on('exit', (codigo) => resolve({ codigo, texto }));
    setTimeout(() => { s.proc.kill(); resolve({ codigo: null, texto }); }, 8000);
  });
  assert.strictEqual(saida.codigo, 1,
    'subiu com AUTH_MODE inválido — cai no modo sem senha, em silêncio');
  assert.match(saida.texto, /AUTH_MODE/);
});

test('campo de texto duplicado no multipart não derruba a rota', async () => {
  stub.limpar();
  stub.responderCom({ tipo: 'ok', extracao: { tipo_tumor: 'Não identificado' } });
  const corpo = new FormData();
  corpo.append('text', 'primeira parte');
  corpo.append('text', 'segunda parte');
  const r = await fetch(base + '/api/extract', {
    method: 'POST', headers: { Authorization: 'Bearer ' + token }, body: corpo,
  });
  assert.ok(r.status < 500, `veio ${r.status}`);
});

test('nome longo ou com caractere de controle é recusado no perfil', async () => {
  // O nome vai impresso na solicitação de exame que o médico assina.
  const longo = await fetch(base + '/api/auth/me', {
    method: 'PATCH',
    headers: { 'content-type': 'application/json', Authorization: 'Bearer ' + token },
    body: JSON.stringify({ name: 'A'.repeat(5000), crm: '339324' }),
  });
  assert.strictEqual(longo.status, 400, 'nome de 5000 caracteres quebra o documento assinado');

  const comControle = 'Dr ' + String.fromCharCode(7) + String.fromCharCode(27) + '[31mX';
  const controle = await fetch(base + '/api/auth/me', {
    method: 'PATCH',
    headers: { 'content-type': 'application/json', Authorization: 'Bearer ' + token },
    body: JSON.stringify({ name: comControle, crm: '339324' }),
  });
  // A asserção estava correta no conteúdo mas nunca era avaliada: rodava só
  // dentro de `if (status === 200)`, e o status nunca é 200. Um teste que não
  // executa nenhuma asserção passa igual, e foi por baixo dele que um achado da
  // auditoria anterior escapou. Agora o próprio status é verificado, e o
  // conteúdo continua verificado quando a rota aceita. Os bytes de controle da
  // classe também estavam crus no arquivo, o que fazia git e grep tratarem esta
  // suíte como binária.
  assert.ok(controle.status === 200 || controle.status === 400,
    'resposta inesperada para nome com caractere de controle');
  if (controle.status === 200) {
    const j = await controle.json();
    assert.ok(!/[\x00-\x1F\x7F]/.test(j.user.name), 'caractere de controle gravado no nome');
  }
});

test('a suite nunca fala com o Postgres nem escreve no arquivo de dados real', () => {
  // Este teste chama limparExpirados(), que e DELETE. Numa maquina com
  // DATABASE_URL apontando para producao, rodar `npm test` apagaria as sessoes
  // de medicos reais. A decisao de recusar Postgres mora em store.js, e nao no
  // script de teste, para que esquecer de exportar a variavel certa nao cause
  // estrago.
  const codigo = fonte('store.js');
  assert.match(codigo, /NODE_TEST_CONTEXT/, 'store.js nao detecta contexto de teste');
  assert.match(codigo, /Boolean\(process\.env\.DATABASE_URL\) && !EM_TESTE/,
    'store.js ainda abriria pool de Postgres durante o teste');
  assert.strictEqual(store.usandoPostgres(), false, 'a suite esta conectada a um Postgres');
  const sep = require('path').sep;
  assert.ok(!store.arquivoDeDados().includes(sep + '.data' + sep),
    'a suite esta escrevendo no arquivo de dados real');
});
