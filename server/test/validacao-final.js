'use strict';

// Validação final da extração contra a API real, com TETO DE GASTO.
//
//   node test/validacao-final.js [teto-em-USD]
//
// Roda o fluxo completo pelo servidor — inclusive a segunda leitura com
// schema dirigido — e para assim que o custo acumulado atinge o teto, mesmo
// no meio da amostra. O número reportado é o cru: se der ruim, sai ruim.

require('dotenv').config();
const path = require('path');
const { spawn } = require('child_process');
const { arquivoDeDadosTemporario } = require('./temporario.js');
const TUMORS = require('../public/tumors.js');

const TETO_USD = parseFloat(process.argv[2] || '2.50');
const REPETICOES = parseInt(process.argv[3] || '10', 10);

const PRECO_ENTRADA = 5.00;
const PRECO_SAIDA = 25.00;
let custo = 0;
let chamadas = 0;

function somar(uso) {
  if (!uso) return;
  chamadas++;
  custo += ((uso.input_tokens || 0) + (uso.cache_creation_input_tokens || 0)) / 1e6 * PRECO_ENTRADA
    + (uso.output_tokens || 0) / 1e6 * PRECO_SAIDA;
}

const CASOS = [
  {
    id: 'ovario',
    esperado: 'Ginecológico - Ovário',
    texto: 'Pct Maria, 58a, submetida a SOB + HT por CA de ovário. AP: carcinoma seroso de alto grau, invasão capsular presente, estadiamento cirúrgico FIGO IIIC (implantes peritoneais >2cm). Sem história familiar relatada.',
  },
  {
    id: 'endometrio',
    esperado: 'Ginecológico - Endométrio',
    texto: 'Paciente de 60 anos submetida a histerectomia total com salpingo-ooforectomia bilateral por adenocarcinoma de endométrio. Anatomopatológico: carcinoma endometrioide, grau 1, estádio FIGO IA. Painel MMR por imuno-histoquímica: MLH1, MSH2, MSH6 e PMS2 preservados (pMMR).',
  },
];

async function subir() {
  const porta = 7400 + Math.floor(Math.random() * 200);
  const base = `http://127.0.0.1:${porta}`;
  const servidor = spawn(process.execPath, [path.join(__dirname, '..', 'index.js')], {
    env: {
      ...process.env,
      PORT: String(porta), NODE_ENV: 'production',
      DATA_FILE: arquivoDeDadosTemporario('val'),
      DATABASE_URL: '', RESEND_API_KEY: '', APP_ORIGIN: '', AUTH_MODE: 'simples',
    },
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  servidor.stderr.on('data', (d) => {
    const t = String(d);
    if (/Extração abandonada|Conflito de sítio|Segunda tentativa/.test(t)) process.stderr.write('    [servidor] ' + t.trim() + '\n');
  });
  for (let i = 0; i < 100; i++) {
    try { if ((await fetch(base + '/api/health')).ok) return { base, servidor }; } catch { /* subindo */ }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error('servidor não subiu');
}

(async () => {
  const { base, servidor } = await subir();
  const r = await fetch(base + '/api/auth/acesso', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: 'Renan Vidal', crm: '339324' }),
  });
  const token = (await r.json()).token;

  const placar = {};
  let interrompido = false;

  for (const caso of CASOS) {
    placar[caso.id] = { certos: 0, subtipoErrado: 0, camposFaltando: 0, rodadas: 0, avisados: 0 };
    console.log(`\n=== ${caso.esperado} ===`);

    for (let i = 0; i < REPETICOES; i++) {
      if (custo >= TETO_USD) { interrompido = true; break; }

      const form = new FormData();
      form.append('text', caso.texto);
      const resp = await fetch(base + '/api/extract', {
        method: 'POST', headers: { Authorization: 'Bearer ' + token }, body: form,
      });
      const corpo = await resp.json();
      somar(corpo.usage);
      somar(corpo.usageSegunda);

      const ext = corpo.extracted || {};
      const tumor = TUMORS.get(caso.id);
      const decisivos = TUMORS.fieldsOf(tumor).filter((f) => f.decisivo);
      const faltando = decisivos.filter((f) => String(ext[f.key] || '').trim() === '').map((f) => f.key);
      const subtipoOk = ext.tipo_tumor === caso.esperado;
      // O médico foi avisado? Conflito de sítio, aviso de leitura, ou o campo
      // de confiança marcado. Um erro AVISADO não é o mesmo que erro silencioso.
      const avisado = Boolean(ext.subtipo_em_conflito)
        || (corpo.avisos || []).length > 0
        || !String(ext.tipo_tumor_justificativa || '').trim();

      placar[caso.id].rodadas++;
      if (subtipoOk && !faltando.length) placar[caso.id].certos++;
      if (!subtipoOk) { placar[caso.id].subtipoErrado++; if (avisado) placar[caso.id].avisados++; }
      else if (faltando.length) { placar[caso.id].camposFaltando++; if (avisado) placar[caso.id].avisados++; }

      const marca = subtipoOk && !faltando.length ? 'ok      ' : (!subtipoOk ? 'SUBTIPO ' : 'CAMPOS  ');
      const doisPassos = corpo.usageSegunda ? '2 leituras' : '1 leitura ';
      console.log(`  ${marca} ${doisPassos} tipo=${String(ext.tipo_tumor).slice(0, 26).padEnd(26)} faltando=[${faltando.join(',')}]${avisado ? ' (AVISADO)' : ''}`);
    }
    if (interrompido) break;
  }

  servidor.kill('SIGTERM');

  console.log('\n' + '='.repeat(66));
  let totalRodadas = 0; let totalCertos = 0; let totalErros = 0; let totalAvisados = 0;
  for (const [id, p] of Object.entries(placar)) {
    totalRodadas += p.rodadas; totalCertos += p.certos;
    totalErros += p.subtipoErrado + p.camposFaltando; totalAvisados += p.avisados;
    const pct = p.rodadas ? (p.certos / p.rodadas * 100).toFixed(0) : '-';
    console.log(`${id.padEnd(12)} ${p.certos}/${p.rodadas} certos (${pct}%) | subtipo errado ${p.subtipoErrado} | campos faltando ${p.camposFaltando} | erros avisados ${p.avisados}`);
  }
  console.log('-'.repeat(66));
  console.log(`TOTAL: ${totalCertos}/${totalRodadas} certos (${totalRodadas ? (totalCertos / totalRodadas * 100).toFixed(0) : '-'}%)`);
  console.log(`ERROS SILENCIOSOS: ${totalErros - totalAvisados} de ${totalErros} erros  <-- o número que importa`);
  console.log(`custo: US$ ${custo.toFixed(3)} em ${chamadas} chamadas (teto US$ ${TETO_USD.toFixed(2)})${interrompido ? ' — INTERROMPIDO NO TETO' : ''}`);
  process.exit(0);
})();
