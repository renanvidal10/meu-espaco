'use strict';

// Bateria contra a API real da Anthropic — NÃO faz parte de `npm test`.
//
// Roda manualmente: node test/bateria-real.js
// Exige ANTHROPIC_API_KEY real em server/.env (fora do Git). Custa dinheiro:
// cada chamada é cobrada de verdade. O relatório final soma o custo medido.
//
// Diferença para os outros testes: o stub-anthropic.js valida que o SERVIDOR
// reage certo a QUALQUER resposta que eu mandar ele devolver. Isto aqui
// valida a única pergunta que o stub não pode responder — se o MODELO de
// verdade consegue produzir aquela resposta a partir de um caso clínico
// escrito como um médico escreve. Os dois bugs de produção desta rodada
// (chaves com prefixo ignoradas, layout quebrado) passaram por uma suíte
// 100% verde justamente por essa lacuna.

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn } = require('child_process');
const { arquivoDeDadosTemporario } = require('./temporario.js');
const { criaPdfMultilinha } = require('./util-pdf.js');
const TUMORS = require('../public/tumors.js');

if (!process.env.ANTHROPIC_API_KEY || !process.env.ANTHROPIC_API_KEY.startsWith('sk-ant-')) {
  console.error('ANTHROPIC_API_KEY ausente ou não parece uma chave real. Abortando antes de gastar nada.');
  process.exit(1);
}

// Preço por 1M tokens (tabela vigente, Opus 5).
const PRECO_ENTRADA = 5.00;
const PRECO_SAIDA = 25.00;
let custoTotalUSD = 0;
let chamadasContadas = 0;

function somaCusto(usage, origem) {
  if (!usage) { console.log(`  (sem dado de uso para "${origem}" — custo não contabilizado)`); return; }
  const entrada = (usage.input_tokens || 0) + (usage.cache_creation_input_tokens || 0);
  const saida = usage.output_tokens || 0;
  const usd = (entrada / 1e6) * PRECO_ENTRADA + (saida / 1e6) * PRECO_SAIDA;
  custoTotalUSD += usd;
  chamadasContadas++;
  console.log(`  custo: ${entrada} tok entrada + ${saida} tok saída ≈ US$ ${usd.toFixed(4)}  [${origem}]`);
}

const falhas = [];
function ok(cond, msg) {
  console.log((cond ? '  ✓ ' : '  ✗ ') + msg);
  if (!cond) falhas.push(msg);
  return cond;
}

async function subirServidor() {
  const porta = 6800 + Math.floor(Math.random() * 200);
  const base = `http://127.0.0.1:${porta}`;
  const servidor = spawn(process.execPath, [path.join(__dirname, '..', 'index.js')], {
    env: {
      ...process.env,
      PORT: String(porta),
      NODE_ENV: 'production', // sem os atalhos de teste — é o caminho real
      DATA_FILE: arquivoDeDadosTemporario('real'),
      DATABASE_URL: '',
      RESEND_API_KEY: '',
      APP_ORIGIN: '',
      AUTH_MODE: 'simples',
      // ANTHROPIC_BASE_URL propositalmente NÃO é sobrescrita: vai para a API real.
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  servidor.stderr.on('data', (d) => {
    const t = String(d);
    if (!/DeprecationWarning|punycode/.test(t)) process.stderr.write('[servidor] ' + t);
  });
  for (let i = 0; i < 100; i++) {
    try { if ((await fetch(base + '/api/health')).ok) return { base, servidor }; } catch { /* subindo */ }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error('servidor não subiu a tempo');
}

async function autenticar(base) {
  const r = await fetch(base + '/api/auth/acesso', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: 'Renan Vidal', crm: '339324' }),
  });
  const j = await r.json();
  if (!j.token) throw new Error('autenticação falhou: ' + JSON.stringify(j));
  return j.token;
}

/* ====================================================================== *
 * CASOS CLÍNICOS — um por subtipo, escritos como um médico escreveria de
 * verdade (abreviação, jargão de laudo, sem formatação), cobrindo também as
 * cinco regras clínicas aprovadas nesta rodada (C2, C3, C4, C5) para
 * confirmar que o MODELO extrai os campos novos, não só o motor de regras.
 * ====================================================================== */
const CASOS = [
  {
    id: 'ovario', modo: 'texto',
    texto: 'Pct Maria, 58a, submetida a SOB + HT por CA de ovário. AP: carcinoma seroso de alto grau, invasão capsular presente, estadiamento cirúrgico FIGO IIIC (implantes peritoneais >2cm). Sem história familiar relatada.',
    esperado: { tipo_tumor: 'Ginecológico - Ovário' },
    checarClassify: (r) => r.state === 'completo' && (r.tests || []).some((t) => t.id === 'hrd') && (r.tests || []).some((t) => t.id === 'germinativo-brca'),
  },
  {
    id: 'mama', modo: 'texto',
    texto: 'Paciente do sexo masculino, 61a, bx de nódulo mamário D: carcinoma ductal invasivo, RE 90% positivo, RP 60% positivo, HER2 negativo (IHQ 1+). Doença localizada, sem linfonodo palpável, aguardando cirurgia.',
    esperado: { tipo_tumor: 'Mama', sexo: 'Masculino' },
    checarClassify: (r) => r.state === 'completo' && (r.tests || []).some((t) => t.id === 'germinativo-mama'),
  },
  {
    id: 'prostata', modo: 'texto',
    texto: 'Pct masculino, 70a, PSA 45. Bx de próstata: adenocarcinoma acinar, Gleason 4+5=9 (GG5). Cintilografia óssea com múltiplas lesões metastáticas. Iniciando bloqueio hormonal pela 1a vez.',
    esperado: { tipo_tumor: 'Próstata' },
    checarClassify: (r) => r.state === 'completo' && (r.tests || []).some((t) => t.id === 'hrr') && (r.tests || []).some((t) => t.id === 'germinativo-prostata'),
  },
  {
    id: 'colorretal', modo: 'texto',
    texto: 'Pct 42a, colonoscopia com lesão em cólon ascendente. AP: adenocarcinoma moderadamente diferenciado. Colectomia D realizada, doença localizada, linfonodos negativos. MMR ainda não avaliado.',
    esperado: { tipo_tumor: 'Colorretal' },
    checarClassify: (r) => r.state === 'completo' && (r.tests || []).some((t) => t.id === 'germinativo-crc-precoce'),
  },
  {
    id: 'pulmao', modo: 'pdf',
    texto: 'Pct 65a, tabagista, nódulo em LSD, lobectomia realizada. AP: adenocarcinoma pulmonar, estágio patológico IIA (pT2aN0), margens livres. Perfil molecular ainda não realizado.',
    esperado: { tipo_tumor: 'Pulmão - não pequenas células' },
    checarClassify: (r) => r.state === 'completo' && (r.tests || []).some((t) => t.id === 'alvo-adjuvante-nsclc'),
  },
  {
    id: 'pancreas', modo: 'pdf',
    texto: 'Pct 55a, icterícia obstrutiva, TC com massa em cabeça de pâncreas 3,5cm com invasão do eixo mesentérico-portal >180 graus, sem metástase a distância. Bx: adenocarcinoma ductal pancreático. Junta multi: doença borderline ressecável, iniciando FOLFIRINOX neoadjuvante.',
    esperado: { tipo_tumor: 'Pâncreas' },
    checarClassify: (r) => r.state === 'completo' && (r.tests || []).some((t) => t.id === 'germinativo-pancreas') && !(r.tests || []).some((t) => t.id === 'somatico-pancreas'),
  },
  {
    id: 'endometrio', modo: 'imagem',
    texto: 'Paciente de 60 anos submetida a histerectomia total com salpingo-ooforectomia bilateral por adenocarcinoma de endométrio. Anatomopatológico: carcinoma endometrioide, grau 1, estádio FIGO IA. Painel MMR por imuno-histoquímica: MLH1, MSH2, MSH6 e PMS2 preservados (pMMR).',
    esperado: { tipo_tumor: 'Ginecológico - Endométrio' },
    checarClassify: (r) => r.state === 'completo' && (r.tests || []).some((t) => t.id === 'classificacao-molecular-endo'),
  },
];

async function gerarImagemDoLaudo(navegador, texto) {
  const pagina = await navegador.newPage({ viewport: { width: 700, height: 500 } });
  await pagina.setContent(`
    <html><body style="font-family: Georgia, serif; padding: 40px; font-size: 15px; line-height: 1.6; background: white;">
      <h2 style="border-bottom: 2px solid #333; padding-bottom: 8px;">LAUDO ANATOMOPATOLÓGICO</h2>
      <p>${texto}</p>
    </body></html>
  `);
  const buffer = await pagina.screenshot({ type: 'png' });
  await pagina.close();
  return buffer;
}

async function extrairCaso(base, token, caso, navegador) {
  const form = new FormData();
  if (caso.modo === 'texto') {
    form.append('text', caso.texto);
  } else if (caso.modo === 'pdf') {
    const pdf = criaPdfMultilinha(caso.texto);
    form.append('files', new Blob([pdf], { type: 'application/pdf' }), 'laudo.pdf');
  } else if (caso.modo === 'imagem') {
    const png = await gerarImagemDoLaudo(navegador, caso.texto);
    form.append('files', new Blob([png], { type: 'image/png' }), 'laudo.png');
  }
  const r = await fetch(base + '/api/extract', {
    method: 'POST', headers: { Authorization: 'Bearer ' + token }, body: form,
  });
  const j = await r.json();
  return { status: r.status, json: j };
}

/* ====================================================================== *
 * GENA — conversas reais, verificando naturalidade e ausência de vazamento
 * de marcador interno / dump de JSON.
 * ====================================================================== */
const CONVERSAS_GENA = [
  {
    nome: 'descrição gradual de um caso até ficar pronto',
    turnos: [
      'Oi, posso te contar um caso?',
      'Mulher de 45 anos com câncer de mama',
      'Triplo-negativo, doença metastática, sem histórico familiar conhecido',
    ],
  },
  {
    nome: 'pergunta fora do escopo clínico',
    turnos: ['Você pode me indicar um restaurante bom aqui perto?'],
  },
];

async function rodarChat(base, token, mensagens) {
  const r = await fetch(base + '/api/chat', {
    method: 'POST', headers: { Authorization: 'Bearer ' + token, 'content-type': 'application/json' },
    body: JSON.stringify({ messages: mensagens }),
  });
  return { status: r.status, json: await r.json() };
}

/* ====================================================================== */

async function main() {
  console.log('Subindo servidor apontado para a API REAL da Anthropic...\n');
  const { base, servidor } = await subirServidor();
  const token = await autenticar(base);

  const filtro = process.argv.slice(2);
  const casos = filtro.length ? CASOS.filter((c) => filtro.includes(c.id)) : CASOS;

  let navegador = null;
  if (casos.some((c) => c.modo === 'imagem')) {
    let pw;
    try {
      pw = require('playwright');
    } catch (err) {
      if (err.code !== 'MODULE_NOT_FOUND') throw err;
      const { execFileSync } = require('child_process');
      const raizGlobal = execFileSync('npm', ['root', '-g'], { encoding: 'utf8' }).trim();
      pw = require(path.join(raizGlobal, 'playwright'));
    }
    navegador = await pw.chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  }

  console.log('=== EXTRAÇÃO — cada um por um canal de entrada diferente ===\n');
  for (const caso of casos) {
    console.log(`--- ${caso.id} (via ${caso.modo}) ---`);
    const { status, json } = await extrairCaso(base, token, caso, navegador);
    somaCusto(json.usage, `extração ${caso.id}`);

    if (!ok(status === 200, `${caso.id}: status 200 (veio ${status}: ${JSON.stringify(json).slice(0, 200)})`)) continue;

    if (process.env.DEBUG_FULL) {
      console.log('  [DEBUG] extracted:', JSON.stringify(json.extracted, null, 2));
      console.log('  [DEBUG] avisos:', JSON.stringify(json.avisos, null, 2));
    }

    const ext = json.extracted || {};
    ok(ext.tipo_tumor === caso.esperado.tipo_tumor, `${caso.id}: tipo_tumor = "${caso.esperado.tipo_tumor}" (veio "${ext.tipo_tumor}")`);

    if (caso.esperado.sexo) {
      ok(ext.sexo === caso.esperado.sexo, `${caso.id}: campo NOVO "sexo" extraído corretamente (veio "${ext.sexo}")`);
    }

    const tumor = TUMORS.get(caso.id);
    if (tumor) {
      const decisivos = TUMORS.fieldsOf(tumor).filter((f) => f.decisivo);
      for (const campo of decisivos) {
        ok(String(ext[campo.key] || '').trim() !== '', `${caso.id}: campo decisivo "${campo.key}" preenchido (veio "${ext[campo.key]}")`);
      }
      if (true) {
        const resultado = tumor.classify(ext);
        ok(caso.checarClassify(resultado), `${caso.id}: classify() produz o resultado clínico esperado (veio estado="${resultado.state}", testes=${JSON.stringify((resultado.tests || []).map((t) => t.id))})`);
        const dx = tumor.diagnosis(ext);
        ok(dx && dx.length > 5 && !/undefined|null|NaN/.test(dx), `${caso.id}: diagnóstico impresso bem formado ("${dx}")`);
      }
    }
    console.log('');
  }

  if (navegador) await navegador.close();

  const conversas = filtro.length ? [] : CONVERSAS_GENA;
  console.log('=== GENA — conversas reais ===\n');
  for (const conversa of conversas) {
    console.log(`--- ${conversa.nome} ---`);
    const historico = [];
    for (const turno of conversa.turnos) {
      historico.push({ role: 'user', content: turno });
      const { status, json } = await rodarChat(base, token, historico);
      // /api/chat não devolve usage (ver index.js) — custo aproximado pelo
      // tamanho da conversa, marcado como estimativa no relatório final.
      const aproxEntrada = historico.reduce((s, m) => s + m.content.length, 0) / 3.5;
      const aproxSaida = (json.reply || '').length / 3.5;
      somaCusto({ input_tokens: aproxEntrada, output_tokens: aproxSaida }, `chat (aprox.) — "${turno.slice(0, 30)}..."`);

      if (!ok(status === 200, `status 200 (veio ${status})`)) break;
      console.log(`    médico: ${turno}`);
      console.log(`    gena:   ${(json.reply || '').slice(0, 200)}`);
      ok(!/CASO_PRONTO/.test(json.reply || ''), 'marcador interno CASO_PRONTO não vaza no texto visível');
      ok(!/^\s*[{[]/.test((json.reply || '').trim()), 'resposta não é um dump de JSON cru');
      ok((json.reply || '').trim().length > 0, 'resposta não veio vazia');
      historico.push({ role: 'assistant', content: json.reply || '' });
    }
    console.log('');
  }

  servidor.kill('SIGTERM');

  console.log('='.repeat(60));
  console.log(`Chamadas pagas: ${chamadasContadas}`);
  console.log(`Custo medido (extração exata + chat aproximado): US$ ${custoTotalUSD.toFixed(4)}`);
  console.log('');
  if (falhas.length) {
    console.log(`FALHAS (${falhas.length}):`);
    falhas.forEach((f) => console.log('  - ' + f));
    process.exit(1);
  }
  console.log('Bateria real: tudo passou.');
}

main().catch((err) => {
  console.error('ERRO FATAL:', err);
  process.exit(1);
});
