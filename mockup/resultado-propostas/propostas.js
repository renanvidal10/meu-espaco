// Três propostas para o bloco "O que solicitar" da tela de resultado.
// Cada uma é CSS (só tokens do app.css) + uma função que monta o HTML a partir
// do resultado real do motor. O conteúdo clínico vem inteiro do registro
// (tumors.js): nada é reescrito, só reorganizado.
//
// Usado por captura.js, que injeta a proposta no app real e fotografa.

const ICONE_AMOSTRA = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14.5 2v17.5c0 1.4-1.1 2.5-2.5 2.5s-2.5-1.1-2.5-2.5V2"/><path d="M8.5 2h7"/><path d="M14.5 16h-5"/></svg>';
const ICONE_EVIDENCIA = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 3v18h18"/><path d="M7 16v-4"/><path d="M12 16V8"/><path d="M17 16v-6"/></svg>';
const CHECK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>';
const CHEVRON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>';

function esc(v) {
  return String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// Nome longo com lista de genes entre parênteses vira nome + linha de genes.
// "Painel germinativo multigênico (BRCA1/2, ...)" lia como um título de 88
// caracteres; separado, o nome é o título e os genes, o detalhe.
function partirNome(nome) {
  const m = /^(.*?)\s*\((.+)\)\s*$/.exec(nome || '');
  return m ? { titulo: m[1], genes: m[2] } : { titulo: nome, genes: '' };
}

function partirDescricao(desc) {
  const d = String(desc || '');
  const corte = d.indexOf('. ');
  return corte > 0 ? { cabeca: d.slice(0, corte + 1), cauda: d.slice(corte + 2) } : { cabeca: d, cauda: '' };
}

// O "order" do registro ("Tumoral · somático · prioridade") repete o que a
// amostra já diz (tecido tumoral, sangue). O tipo vem de test.kind e a
// prioridade de test.primary, então nada se perde.
const TIPO = { somatico: 'Somático', germinativo: 'Germinativo' };

function porQue(test, cauda) {
  return `${cauda ? `<p>${esc(cauda)}</p>` : ''}
    ${test.justify ? `<div class="justificativa-assinada">
      <span class="rotulo">Vai assim no pedido, acima da sua assinatura</span>
      <p>${esc(test.justify)}</p></div>` : ''}`;
}

/* ------------------------------------------------------------------ A */
const A = {
  nome: 'A',
  css: `
  .pa-resumo { display: flex; gap: 14px; align-items: flex-start; padding: 4px 0 2px; }
  .pa-resumo .ok { flex: none; width: 32px; height: 32px; border-radius: var(--r-full); background: var(--ok-soft); color: var(--ok); display: flex; align-items: center; justify-content: center; margin-top: 1px; }
  .pa-resumo .ok svg { width: 17px; height: 17px; }
  .pa-resumo h2 { font-size: var(--fs-lg); font-weight: 700; letter-spacing: -0.02em; line-height: 1.25; margin: 0 0 4px; color: var(--ink); text-wrap: balance; }
  .pa-resumo p { margin: 0; font-size: var(--fs-sm); color: var(--ink-muted); line-height: 1.5; }
  .pa-lista { list-style: none; margin: 22px 0 0; padding: 0; display: flex; flex-direction: column; gap: 12px; }
  .pa-card { background: var(--surface); border: 1px solid var(--border); border-radius: var(--r-md); box-shadow: var(--elev-1); overflow: hidden; }
  .pa-corpo { padding: 18px 18px 16px; display: grid; grid-template-columns: 28px minmax(0, 1fr); column-gap: 14px; }
  .pa-num { width: 28px; height: 28px; border-radius: var(--r-full); display: flex; align-items: center; justify-content: center; font-size: var(--fs-xs); font-weight: 700; background: var(--surface); border: 2px solid var(--border); color: var(--ink-muted); }
  .pa-card.primary .pa-num { background: var(--accent); border-color: var(--accent); color: var(--accent-ink); }
  .pa-card h3 { font-size: var(--fs-md); font-weight: 700; letter-spacing: -0.01em; line-height: 1.3; margin: 2px 0 0; color: var(--ink); }
  .pa-genes { font-size: var(--fs-xs); color: var(--ink-muted); margin: 3px 0 0; line-height: 1.45; }
  .pa-meta { display: flex; flex-wrap: wrap; align-items: center; gap: 6px 12px; margin: 8px 0 0; font-size: var(--fs-xs); color: var(--ink-muted); }
  .pa-meta .item { display: inline-flex; align-items: center; gap: 5px; }
  .pa-meta svg { width: 15px; height: 15px; color: var(--ink-faint); }
  .pa-prio { font-size: var(--fs-2xs); font-weight: 700; color: var(--accent); background: var(--accent-soft); padding: 2px 8px; border-radius: var(--r-full); }
  .pa-desc { font-size: var(--fs-sm); color: var(--ink); line-height: 1.5; margin: 12px 0 0; }
  .pa-evid { display: flex; gap: 8px; align-items: flex-start; margin: 10px 0 0; font-size: var(--fs-xs); color: var(--ink-muted); line-height: 1.45; }
  .pa-evid svg { flex: none; width: 15px; height: 15px; margin-top: 2px; color: var(--accent); }
  .pa-card details { border-top: 1px solid var(--border); }
  .pa-card summary { list-style: none; cursor: pointer; min-height: var(--toque); display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 0 18px 0 60px; font-size: var(--fs-xs); font-weight: 600; color: var(--accent); }
  .pa-card summary::-webkit-details-marker { display: none; }
  .pa-card summary svg { width: 16px; height: 16px; transition: transform var(--mov-rapido) var(--ease); }
  .pa-card details[open] summary svg { transform: rotate(180deg); }
  .pa-card .pa-mais { padding: 0 18px 16px 60px; }
  .pa-card .pa-mais > p { font-size: var(--fs-xs); color: var(--ink-muted); line-height: 1.5; margin: 0 0 10px; }
  @media (max-width: 560px) {
    .pa-corpo { padding: 16px 14px 14px; grid-template-columns: 26px minmax(0, 1fr); column-gap: 12px; }
    .pa-num { width: 26px; height: 26px; }
    .pa-card summary { padding: 0 14px 0 52px; }
    .pa-card .pa-mais { padding: 0 14px 14px 52px; }
  }`,
  html(r) {
    const cards = r.tests.map((t, i) => {
      const { titulo, genes } = partirNome(t.name);
      const { cabeca, cauda } = partirDescricao(t.description);
      return `<li class="pa-card${t.primary ? ' primary' : ''}">
        <div class="pa-corpo">
          <span class="pa-num" aria-hidden="true">${i + 1}</span>
          <div>
            <h3>${esc(titulo)}</h3>
            ${genes ? `<p class="pa-genes">${esc(genes)}</p>` : ''}
            <div class="pa-meta">
              ${t.primary ? '<span class="pa-prio">Prioridade</span>' : ''}
              <span class="item">${esc(TIPO[t.kind] || '')}</span>
              <span class="item">${ICONE_AMOSTRA}${esc(t.sample)}</span>
            </div>
            <p class="pa-desc">${esc(cabeca)}</p>
            ${t.stat ? `<p class="pa-evid">${ICONE_EVIDENCIA}<span>${esc(t.stat)}</span></p>` : ''}
          </div>
        </div>
        <details>
          <summary>Por que este teste ${CHEVRON}</summary>
          <div class="pa-mais">${porQue(t, cauda)}</div>
        </details>
      </li>`;
    }).join('');
    return `<div class="pa-resumo"><span class="ok">${CHECK}</span><div>
        <h2>${esc(r.title)}</h2><p>${esc(r.summary)}</p></div></div>
      <ol class="pa-lista">${cards}</ol>`;
  },
};

/* ------------------------------------------------------------------ B */
const B = {
  nome: 'B',
  css: `
  .pb-bloco { background: var(--surface); border: 1px solid var(--border); border-radius: var(--r-lg); box-shadow: var(--elev-1); overflow: hidden; }
  .pb-topo { padding: 20px 20px 18px; border-bottom: 1px solid var(--border); }
  .pb-topo .rot { display: inline-flex; align-items: center; gap: 6px; font-size: var(--fs-xs); font-weight: 600; color: var(--ok); margin-bottom: 6px; }
  .pb-topo .rot svg { width: 15px; height: 15px; }
  .pb-topo h2 { font-size: var(--fs-lg); font-weight: 700; letter-spacing: -0.02em; line-height: 1.25; margin: 0 0 4px; color: var(--ink); }
  .pb-topo p { margin: 0; font-size: var(--fs-sm); color: var(--ink-muted); line-height: 1.5; }
  .pb-item + .pb-item { border-top: 1px solid var(--border); }
  .pb-item > summary { list-style: none; cursor: pointer; display: grid; grid-template-columns: 28px minmax(0, 1fr) 20px; column-gap: 14px; align-items: start; padding: 16px 20px; }
  .pb-item > summary::-webkit-details-marker { display: none; }
  @media (hover: hover) { .pb-item > summary:hover { background: var(--surface-2); } }
  .pb-num { width: 28px; height: 28px; border-radius: var(--r-full); display: flex; align-items: center; justify-content: center; font-size: var(--fs-xs); font-weight: 700; background: var(--surface); border: 2px solid var(--border); color: var(--ink-muted); }
  .pb-item.primary .pb-num { background: var(--accent); border-color: var(--accent); color: var(--accent-ink); }
  .pb-item h3 { font-size: var(--fs-md); font-weight: 700; line-height: 1.3; margin: 2px 0 0; color: var(--ink); }
  .pb-genes { font-size: var(--fs-xs); color: var(--ink-muted); margin: 3px 0 0; line-height: 1.45; }
  .pb-meta { display: flex; flex-wrap: wrap; align-items: center; gap: 6px 12px; margin-top: 6px; font-size: var(--fs-xs); color: var(--ink-muted); }
  .pb-meta svg { width: 15px; height: 15px; color: var(--ink-faint); vertical-align: -3px; margin-right: 4px; }
  .pb-prio { font-size: var(--fs-2xs); font-weight: 700; color: var(--accent); background: var(--accent-soft); padding: 2px 8px; border-radius: var(--r-full); }
  .pb-chev { color: var(--ink-faint); margin-top: 5px; }
  .pb-chev svg { width: 18px; height: 18px; transition: transform var(--mov-rapido) var(--ease); }
  .pb-item[open] .pb-chev svg { transform: rotate(180deg); }
  .pb-corpo { padding: 0 20px 18px 62px; }
  .pb-corpo > p { font-size: var(--fs-sm); color: var(--ink); line-height: 1.5; margin: 0 0 10px; }
  .pb-corpo > p.cauda { font-size: var(--fs-xs); color: var(--ink-muted); }
  .pb-corpo > .pb-evid { display: flex; gap: 8px; font-size: var(--fs-xs); color: var(--ink-muted); line-height: 1.45; margin: 0 0 10px; }
  .pb-evid svg { flex: none; width: 15px; height: 15px; margin-top: 2px; color: var(--accent); }
  @media (max-width: 560px) {
    .pb-topo { padding: 18px 16px 16px; }
    .pb-item > summary { padding: 14px 16px; column-gap: 12px; grid-template-columns: 26px minmax(0, 1fr) 18px; }
    .pb-num { width: 26px; height: 26px; }
    .pb-corpo { padding: 0 16px 16px 54px; }
  }`,
  html(r, { abrir = -1 } = {}) {
    const itens = r.tests.map((t, i) => {
      const { titulo, genes } = partirNome(t.name);
      const { cabeca, cauda } = partirDescricao(t.description);
      return `<details class="pb-item${t.primary ? ' primary' : ''}"${i === abrir ? ' open' : ''}>
        <summary>
          <span class="pb-num" aria-hidden="true">${i + 1}</span>
          <span>
            <h3>${esc(titulo)}</h3>
            ${genes ? `<span class="pb-genes" style="display:block">${esc(genes)}</span>` : ''}
            <span class="pb-meta">
              ${t.primary ? '<span class="pb-prio">Prioridade</span>' : ''}
              <span>${esc(TIPO[t.kind] || '')}</span>
              <span>${ICONE_AMOSTRA}${esc(t.sample)}</span>
            </span>
          </span>
          <span class="pb-chev">${CHEVRON}</span>
        </summary>
        <div class="pb-corpo">
          <p>${esc(cabeca)}</p>
          ${t.stat ? `<p class="pb-evid">${ICONE_EVIDENCIA}<span>${esc(t.stat)}</span></p>` : ''}
          ${cauda ? `<p class="cauda">${esc(cauda)}</p>` : ''}
          ${t.justify ? `<div class="justificativa-assinada"><span class="rotulo">Vai assim no pedido, acima da sua assinatura</span><p>${esc(t.justify)}</p></div>` : ''}
        </div>
      </details>`;
    }).join('');
    return `<div class="pb-bloco">
      <div class="pb-topo"><span class="rot">${CHECK}Triagem concluída</span>
        <h2>${esc(r.title)}</h2><p>${esc(r.summary)}</p></div>
      ${itens}
    </div>`;
  },
};

/* ------------------------------------------------------------------ C */
const C = {
  nome: 'C',
  css: `
  .pc-resumo { border-left: 3px solid var(--accent); padding: 2px 0 2px 16px; }
  .pc-resumo h2 { font-size: var(--fs-lg); font-weight: 700; letter-spacing: -0.02em; line-height: 1.25; margin: 0 0 4px; color: var(--ink); }
  .pc-resumo p { margin: 0; font-size: var(--fs-sm); color: var(--ink-muted); line-height: 1.5; }
  .pc-trilho { margin-top: 28px; }
  .pc-passo { display: grid; grid-template-columns: 28px minmax(0, 1fr); column-gap: 16px; padding-bottom: 28px; position: relative; }
  .pc-passo:last-child { padding-bottom: 0; }
  .pc-passo:not(:last-child)::before { content: ''; position: absolute; left: 13px; top: 32px; bottom: 4px; width: 2px; background: var(--border); }
  .pc-num { width: 28px; height: 28px; border-radius: var(--r-full); display: flex; align-items: center; justify-content: center; font-size: var(--fs-xs); font-weight: 700; background: var(--surface); border: 2px solid var(--border); color: var(--ink-muted); }
  .pc-passo.primary .pc-num { background: var(--accent); border-color: var(--accent); color: var(--accent-ink); }
  .pc-passo h3 { font-size: var(--fs-md); font-weight: 700; line-height: 1.3; margin: 2px 0 0; color: var(--ink); }
  .pc-genes { font-size: var(--fs-xs); color: var(--ink-muted); margin: 3px 0 0; }
  .pc-meta { font-size: var(--fs-xs); color: var(--ink-muted); margin: 6px 0 0; }
  .pc-meta b { color: var(--accent); font-weight: 700; }
  .pc-desc { font-size: var(--fs-sm); color: var(--ink); line-height: 1.5; margin: 10px 0 0; }
  .pc-evid { font-size: var(--fs-xs); color: var(--ink-muted); line-height: 1.45; margin: 8px 0 0; }
  .pc-passo details summary { list-style: none; cursor: pointer; display: inline-flex; align-items: center; gap: 4px; min-height: var(--toque); font-size: var(--fs-xs); font-weight: 600; color: var(--accent); }
  .pc-passo details summary::-webkit-details-marker { display: none; }
  .pc-passo details summary svg { width: 15px; height: 15px; }
  .pc-passo details > p { font-size: var(--fs-xs); color: var(--ink-muted); line-height: 1.5; margin: 0 0 10px; }`,
  html(r) {
    const passos = r.tests.map((t, i) => {
      const { titulo, genes } = partirNome(t.name);
      const { cabeca, cauda } = partirDescricao(t.description);
      const meta = [t.primary ? '<b>Prioridade</b>' : '', esc(TIPO[t.kind] || ''), 'Amostra: ' + esc(t.sample)].filter(Boolean).join(' · ');
      return `<div class="pc-passo${t.primary ? ' primary' : ''}">
        <span class="pc-num" aria-hidden="true">${i + 1}</span>
        <div>
          <h3>${esc(titulo)}</h3>
          ${genes ? `<p class="pc-genes">${esc(genes)}</p>` : ''}
          <p class="pc-meta">${meta}</p>
          <p class="pc-desc">${esc(cabeca)}</p>
          ${t.stat ? `<p class="pc-evid">${esc(t.stat)}</p>` : ''}
          <details><summary>Por que este teste ${CHEVRON}</summary>${porQue(t, cauda)}</details>
        </div>
      </div>`;
    }).join('');
    return `<div class="pc-resumo"><h2>${esc(r.title)}</h2><p>${esc(r.summary)}</p></div>
      <div class="pc-trilho">${passos}</div>`;
  },
};

module.exports = { A, B, C };
