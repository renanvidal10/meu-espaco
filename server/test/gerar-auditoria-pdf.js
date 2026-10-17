'use strict';

/* Gera o PDF de auditoria dos programas de indústria.
 *
 *   node test/gerar-auditoria-pdf.js [caminho-de-saida.pdf]
 *
 * O conteúdo vem de auditoria-programas.js, que EXECUTA as regras. Nada aqui
 * é digitado à mão: se o registro mudar, o PDF muda junto. Um documento de
 * validação escrito à mão diverge do motor na primeira alteração, e aí o
 * médico valida um papel e o app faz outra coisa.
 *
 * A estética segue os tokens da plataforma (app.css): mesmo azul-petróleo,
 * mesma escala de tipos, mesmos raios. O documento é material de apresentação
 * tanto quanto de conferência.
 */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { auditar } = require('./auditoria-programas.js');

function carregarPlaywright() {
  try { return require('playwright'); } catch (err) {
    if (err.code !== 'MODULE_NOT_FOUND') throw err;
  }
  const raizGlobal = execFileSync('npm', ['root', '-g'], { encoding: 'utf8' }).trim();
  return require(path.join(raizGlobal, 'playwright'));
}

const esc = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const dataBr = (iso) => (iso && /^\d{4}-\d{2}-\d{2}$/.test(iso) ? iso.split('-').reverse().join('/') : '—');

function estado(teste) {
  const patrocinados = teste.programas.filter((p) => p.tipo === 'patrocinado');
  if (patrocinados.length) return { cls: 'tem', rotulo: 'Com programa', patrocinados };
  if (teste.programas.some((p) => p.tipo === 'sem-via')) {
    return { cls: 'buscado', rotulo: 'Busca sem resultado', patrocinados: [] };
  }
  return { cls: 'aberto', rotulo: 'A verificar', patrocinados: [] };
}

function montarHtml(d) {
  const totalTestes = d.porTumor.reduce((n, t) => n + t.testes.length, 0);
  const comPrograma = d.porTumor.reduce(
    (n, t) => n + t.testes.filter((x) => estado(x).patrocinados.length).length, 0);
  const combinacoes = d.porTumor.reduce((n, t) => n + t.casosExaminados, 0);

  const secoes = d.porTumor.map((t) => `
    <section class="tumor">
      <h2>${esc(t.nome)}</h2>
      <p class="meta">${t.testes.length} teste(s) · ${t.casosExaminados.toLocaleString('pt-BR')} combinações de campos examinadas</p>
      ${t.testes.map((teste) => {
        const e = estado(teste);
        return `
        <article class="teste ${e.cls}">
          <div class="teste-topo">
            <span class="chip ${e.cls}">${esc(e.rotulo)}</span>
            <h3>${esc(teste.nome)}</h3>
          </div>
          <dl class="ficha">
            <div><dt>Amostra</dt><dd>${esc(teste.amostra)}</dd></div>
            <div><dt>Natureza</dt><dd>${esc(teste.tipo)}</dd></div>
          </dl>
          ${e.patrocinados.length ? `
          <table class="progs">
            <thead><tr><th>Indústria</th><th>Programa</th><th>Conferido</th></tr></thead>
            <tbody>
              ${e.patrocinados.map((p) => `
                <tr>
                  <td class="ind">${esc(p.industria || '—')}</td>
                  <td>${esc(p.name)}${p.url ? `<span class="url">${esc(p.url)}</span>` : ''}</td>
                  <td class="quando">${esc(dataBr(p.verificadoEm))}</td>
                </tr>`).join('')}
            </tbody>
          </table>` : `
          <p class="vazio">${e.cls === 'buscado'
            ? 'Busca por programa da indústria registrada, sem parceiro confirmado. Não é afirmação de que não exista.'
            : 'Nenhum programa de indústria declarado no registro para este teste.'}</p>`}
          ${/* Um teste sem programa de indústria pode ainda assim ter via: o
                laboratório parceiro. Omitir isso faria o documento parecer
                dizer "não há caminho nenhum", que é falso. */''}
          ${teste.programas.filter((p) => p.tipo === 'laboratorio').map((p) => `
            <p class="outra-via"><strong>Via não patrocinada:</strong> ${esc(p.name)}${p.verificadoEm ? ` · conferida em ${esc(dataBr(p.verificadoEm))}` : ''}</p>`).join('')}
          <div class="validar">
            <span class="quadro"></span><span>Confere</span>
            <span class="quadro"></span><span>Falta programa</span>
            <span class="linha-obs">Observação: </span>
          </div>
        </article>`;
      }).join('')}
    </section>`).join('');

  const industrias = d.industrias.map((i) => `
    <tr>
      <td class="ind">${esc(i.industria)}</td>
      <td>${esc(i.programa)}</td>
      <td>${esc(i.tumores.join(', '))}</td>
      <td class="quando">${esc(dataBr(i.verificadoEm))}</td>
    </tr>`).join('');

  return `<!doctype html>
<html lang="pt-BR"><head><meta charset="utf-8">
<style>
  :root {
    --tinta: #10202e; --tinta-media: #4c6276; --tinta-fraca: #637a8e;
    --azul: #0e6180; --azul-claro: #dceef5; --azul-borda: #b2d6e5;
    --borda: #e0e8f0; --fundo: #f2f6fa;
    --verde: #0f6b5c; --verde-claro: #dcebe6;
    --ambar: #7d5509; --ambar-claro: #f3e9d3;
  }
  * { box-sizing: border-box; }
  body {
    margin: 0; color: var(--tinta); background: #fff;
    font-family: -apple-system, BlinkMacSystemFont, "SF Pro Text", "Helvetica Neue", Helvetica, Arial, sans-serif;
    font-size: 10.5pt; line-height: 1.5;
    -webkit-print-color-adjust: exact; print-color-adjust: exact;
  }

  /* --- capa ------------------------------------------------------------ */
  .capa {
    background-color: var(--azul);
    background-image: linear-gradient(165deg, #11768f 0%, #0e6180 58%, #0b5570 100%);
    color: #fff; padding: 46px 44px 40px; position: relative; overflow: hidden;
    page-break-after: always;
    height: 297mm;
    display: flex; flex-direction: column;
  }
  .capa::before {
    content: ''; position: absolute; top: -30%; left: -10%;
    width: 460px; height: 460px;
    background: radial-gradient(circle, rgba(255,255,255,.14) 0%, rgba(255,255,255,0) 68%);
  }
  .capa > * { position: relative; }
  .marca { display: flex; align-items: center; gap: 11px; font-size: 15pt; font-weight: 700; letter-spacing: -.02em; }
  .marca .sinal {
    width: 32px; height: 32px; border-radius: 9px;
    background: rgba(255,255,255,.18); border: 1px solid rgba(255,255,255,.3);
    display: flex; align-items: center; justify-content: center; font-size: 13pt;
  }
  .capa h1 { font-size: 27pt; line-height: 1.15; letter-spacing: -.03em; margin: 54px 0 14px; max-width: 15ch; font-weight: 650; }
  .capa .sub { font-size: 11.5pt; color: #cfe6ef; max-width: 52ch; margin: 0; line-height: 1.6; }
  .numeros { display: flex; gap: 34px; margin-top: auto; padding-top: 30px; border-top: 1px solid rgba(255,255,255,.22); }
  .numeros div { flex: 1; }
  .numeros .n { font-size: 25pt; font-weight: 700; letter-spacing: -.03em; display: block; }
  .numeros .r { font-size: 8.5pt; color: #cfe6ef; text-transform: uppercase; letter-spacing: .07em; }
  .capa .rodape { margin-top: 26px; font-size: 8.5pt; color: #cfe6ef; }

  /* --- miolo ----------------------------------------------------------- */
  .miolo { padding: 30px 44px 44px; }
  .como-ler {
    background: var(--fundo); border: 1px solid var(--borda); border-radius: 12px;
    padding: 18px 20px; margin-bottom: 30px;
  }
  .como-ler h4 { margin: 0 0 9px; font-size: 8.5pt; text-transform: uppercase; letter-spacing: .08em; color: var(--tinta-fraca); }
  .como-ler ul { margin: 0; padding-left: 17px; font-size: 9.5pt; color: var(--tinta-media); }
  .como-ler li { margin-bottom: 5px; }
  .como-ler li:last-child { margin-bottom: 0; }

  h2 {
    font-size: 15pt; letter-spacing: -.02em; margin: 0 0 3px;
    padding-bottom: 9px; border-bottom: 2px solid var(--azul);
  }
  .tumor { margin-bottom: 30px; page-break-inside: avoid; }
  .tumor .meta { margin: 7px 0 15px; font-size: 8.5pt; color: var(--tinta-fraca); }

  .teste {
    border: 1px solid var(--borda); border-left: 3px solid var(--borda);
    border-radius: 11px; padding: 15px 17px; margin-bottom: 11px;
    page-break-inside: avoid;
  }
  .teste.tem { border-left-color: var(--verde); }
  .teste.buscado { border-left-color: var(--ambar); }
  .teste.aberto { border-left-color: var(--azul); }
  .teste-topo { margin-bottom: 11px; }
  .teste h3 { font-size: 11.5pt; margin: 7px 0 0; letter-spacing: -.012em; line-height: 1.3; font-weight: 600; }
  .chip {
    display: inline-block; font-size: 7.5pt; font-weight: 700;
    text-transform: uppercase; letter-spacing: .06em;
    padding: 3px 9px; border-radius: 999px;
  }
  .chip.tem { background: var(--verde-claro); color: var(--verde); }
  .chip.buscado { background: var(--ambar-claro); color: var(--ambar); }
  .chip.aberto { background: var(--azul-claro); color: var(--azul); }

  .ficha { display: flex; gap: 26px; margin: 0 0 11px; }
  .ficha dt { font-size: 7.5pt; text-transform: uppercase; letter-spacing: .07em; color: var(--tinta-fraca); margin-bottom: 1px; }
  .ficha dd { margin: 0; font-size: 9.5pt; color: var(--tinta-media); }

  table { width: 100%; border-collapse: collapse; font-size: 9.5pt; }
  th {
    text-align: left; font-size: 7.5pt; text-transform: uppercase; letter-spacing: .07em;
    color: var(--tinta-fraca); font-weight: 600; padding: 0 9px 6px 0;
    border-bottom: 1px solid var(--borda);
  }
  td { padding: 8px 9px 8px 0; border-bottom: 1px solid var(--borda); vertical-align: top; }
  tr:last-child td { border-bottom: none; }
  td.ind { font-weight: 650; color: var(--azul); white-space: nowrap; }
  td.quando { color: var(--tinta-fraca); white-space: nowrap; font-variant-numeric: tabular-nums; }
  .url { display: block; font-size: 8pt; color: var(--tinta-fraca); word-break: break-all; margin-top: 2px; }
  .vazio { margin: 0; font-size: 9.5pt; color: var(--tinta-media); font-style: italic; }
  .outra-via { margin: 8px 0 0; font-size: 9pt; color: var(--tinta-media); }
  .outra-via strong { color: var(--tinta); }

  /* Campo de conferência: o documento existe para ser validado NO PAPEL. */
  .validar {
    display: flex; align-items: center; gap: 7px; flex-wrap: wrap;
    margin-top: 13px; padding-top: 11px; border-top: 1px dashed var(--borda);
    font-size: 8.5pt; color: var(--tinta-fraca);
  }
  .validar .quadro {
    width: 11px; height: 11px; border: 1.3px solid var(--tinta-fraca); border-radius: 3px;
    display: inline-block;
  }
  .validar .quadro + span { margin-right: 15px; }
  .linha-obs { flex: 1; min-width: 150px; border-bottom: 1px solid var(--borda); padding-bottom: 1px; }

  .resumo-industrias { page-break-inside: avoid; margin-top: 8px; }
  .assinatura {
    margin-top: 34px; padding-top: 15px; border-top: 1px solid var(--borda);
    display: flex; gap: 40px; font-size: 8.5pt; color: var(--tinta-fraca);
  }
  .assinatura div { flex: 1; }
  .assinatura .campo { border-bottom: 1px solid var(--tinta-fraca); height: 30px; margin-bottom: 5px; }
</style></head>
<body>
  <div class="capa">
    <div class="marca"><span class="sinal">◈</span> OncoGenYX</div>
    <h1>Auditoria dos programas de indústria</h1>
    <p class="sub">Todos os testes que a plataforma pode indicar, com o programa de acesso associado a cada um — ou a declaração explícita de que não há. Documento para conferência pessoal.</p>
    <div class="numeros">
      <div><span class="n">${totalTestes}</span><span class="r">testes indicáveis</span></div>
      <div><span class="n">${comPrograma}</span><span class="r">com programa</span></div>
      <div><span class="n">${totalTestes - comPrograma}</span><span class="r">sem programa</span></div>
      <div><span class="n">${d.industrias.length}</span><span class="r">indústrias</span></div>
    </div>
    <p class="rodape">Gerado em ${esc(dataBr(d.geradoEm))} a partir da execução das regras — ${combinacoes.toLocaleString('pt-BR')} combinações de campos percorridas. Não é material promocional.</p>
  </div>

  <div class="miolo">
    <div class="como-ler">
      <h4>Como ler este documento</h4>
      <ul>
        <li><strong>Com programa</strong> — existe programa de indústria verificado, com data da última conferência da via de acesso.</li>
        <li><strong>Busca sem resultado</strong> — a busca foi feita e registrada, e não encontrou parceiro confirmado. <em>Não</em> é afirmação de que o programa não exista: é o registro honesto de uma busca.</li>
        <li><strong>A verificar</strong> — nenhum programa de indústria declarado para este teste no registro.</li>
        <li>Nenhum programa entra na plataforma por analogia. Associação a um tumor exige verificação documentada da cobertura.</li>
      </ul>
    </div>
    ${secoes}

    <section class="tumor resumo-industrias">
      <h2>Indústrias e cobertura</h2>
      <p class="meta">Cada programa e os tumores em que ele está declarado.</p>
      <table>
        <thead><tr><th>Indústria</th><th>Programa</th><th>Tumores</th><th>Conferido</th></tr></thead>
        <tbody>${industrias}</tbody>
      </table>
      <div class="assinatura">
        <div><div class="campo"></div>Validado por</div>
        <div><div class="campo"></div>Data</div>
      </div>
    </section>
  </div>
</body></html>`;
}

async function gerar(saida) {
  const { chromium } = carregarPlaywright();
  const dados = auditar();
  const html = montarHtml(dados);

  const navegador = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const pagina = await navegador.newPage();
  await pagina.setContent(html, { waitUntil: 'load' });
  await pagina.pdf({
    path: saida,
    format: 'A4',
    printBackground: true,
    margin: { top: '0', right: '0', bottom: '0', left: '0' },
  });
  await navegador.close();
  return { saida, dados };
}

if (require.main === module) {
  const saida = process.argv[2] || path.join(__dirname, '..', '..', 'auditoria-programas.pdf');
  gerar(saida).then(({ dados }) => {
    const n = dados.porTumor.reduce((a, t) => a + t.testes.length, 0);
    console.log(`PDF gerado: ${saida}`);
    console.log(`${n} testes em ${dados.porTumor.length} tumores, ${dados.industrias.length} indústrias.`);
  }).catch((e) => { console.error(e); process.exit(1); });
}

module.exports = { gerar, montarHtml };
