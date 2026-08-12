'use strict';

// Renderiza o documento de validação clínica a partir do JSON gerado por
// gerar-criterios.js — que por sua vez vem da execução do motor.
//
//   node test/gerar-criterios.js > /tmp/criterios.json
//   node test/gerar-documento.js /tmp/criterios.json > /tmp/criterios.html

const fs = require('fs');

const dados = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));

const esc = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;');

const ESTADOS = {
  completo: { rotulo: 'Indica teste', tom: 'indica' },
  parcial: { rotulo: 'Indica parte dos testes', tom: 'indica' },
  provisorio: { rotulo: 'Indica, a confirmar no laudo', tom: 'confirmar' },
  'sem-indicacao': { rotulo: 'Não indica', tom: 'nao' },
  insuficiente: { rotulo: 'Dados insuficientes', tom: 'falta' },
  'nao-reconhecida': { rotulo: 'Fora de escopo', tom: 'fora' },
};

function campoLista(campos) {
  return campos.map((c) => `<li><span class="campo-nome">${esc(c.rotulo)}</span>${
    c.decisivo ? '<span class="marca-decisivo" title="Muda a conduta">decisivo</span>' : ''
  }${c.opcoes ? `<span class="campo-opcoes">${c.opcoes.map(esc).join(' · ')}</span>` : ''}</li>`).join('');
}

function entradaLegivel(entrada) {
  return Object.entries(entrada)
    .map(([k, v]) => `<span class="par"><span class="par-k">${esc(k.replace(/_/g, ' '))}</span><span class="par-v">${esc(v)}</span></span>`)
    .join('');
}

function cenario(c, numero, tumorId) {
  const estado = ESTADOS[c.estado] || { rotulo: c.estado, tom: 'fora' };
  const testes = c.testes.map((t) => `
    <div class="teste">
      <div class="teste-cabeca">
        <h4>${esc(t.nome)}</h4>
        <span class="amostra">${esc(t.amostra)}</span>
      </div>
      ${t.numero ? `<p class="numero">${esc(t.numero)}</p>` : ''}
      <p class="descricao">${esc(t.descricao)}</p>
      <div class="justificativa">
        <span class="justificativa-rotulo">Justificativa impressa na solicitação</span>
        <p>${esc(t.justificativa)}</p>
      </div>
      ${t.programas.length ? `<ul class="programas">${t.programas.map((p) => `
        <li>
          <span class="programa-nome">${esc(p.nome)}</span>
          <span class="programa-nota">${esc(p.nota)}</span>
          ${p.url ? `<span class="programa-url">${esc(p.url)}</span>` : '<span class="programa-url vazio">sem portal — a confirmar</span>'}
        </li>`).join('')}</ul>` : ''}
    </div>`).join('');

  const notas = c.notas.map((n) => `
    <div class="nota">
      <span class="nota-tag">${esc(n.tag)}</span>
      <div><strong>${esc(n.titulo)}</strong><p>${esc(n.corpo)}</p></div>
    </div>`).join('');

  return `
  <article class="cenario" id="${tumorId}-${numero}">
    <header class="cenario-cabeca">
      <span class="cenario-num">${tumorId.slice(0, 3).toUpperCase()}&nbsp;${numero}</span>
      <h3>${esc(c.rotulo)}</h3>
      <span class="selo selo-${estado.tom}">${estado.rotulo}</span>
    </header>

    <div class="entrada">${entradaLegivel(c.entrada)}</div>

    <div class="saida">
      <p class="resumo">${esc(c.resumo)}</p>
      <p class="dx"><span class="dx-rotulo">Diagnóstico impresso</span> ${esc(c.diagnostico)}</p>
      ${testes}
      ${notas}
    </div>

    <div class="validacao">
      <span class="validacao-rotulo">Parecer</span>
      <label class="marcar"><span class="caixa"></span>De acordo</label>
      <label class="marcar"><span class="caixa"></span>Ajustar</label>
      <span class="linha-obs">Observação</span>
    </div>
  </article>`;
}

function secaoTumor(t) {
  return `
  <section class="tumor" id="${t.id}">
    <header class="tumor-cabeca">
      <h2>${esc(t.label)}</h2>
      <p class="eixo">${esc(t.eixo)}</p>
      <p class="fontes"><span>Diretrizes de referência</span> ${esc(t.fontes)}</p>
    </header>

    <div class="campos">
      <h3 class="campos-titulo">Dados coletados neste subtipo</h3>
      <ul>${campoLista(t.campos)}</ul>
    </div>

    ${t.cenarios.map((c, i) => cenario(c, i + 1, t.id)).join('')}
  </section>`;
}

const divergencias = dados.divergencias.map((d, i) => `
  <article class="divergencia">
    <header>
      <span class="div-num">${String(i + 1).padStart(2, '0')}</span>
      <div>
        <span class="div-tumor">${esc(d.tumor)}</span>
        <h3>${esc(d.questao)}</h3>
      </div>
    </header>
    <p class="div-hoje"><span>Como está hoje</span> ${esc(d.hoje)}</p>
    <p class="div-contexto">${esc(d.contexto)}</p>
    <div class="validacao">
      <span class="validacao-rotulo">Decisão</span>
      <label class="marcar"><span class="caixa"></span>Manter</label>
      <label class="marcar"><span class="caixa"></span>Alterar para</label>
      <span class="linha-obs"></span>
    </div>
  </article>`).join('');

const totalCenarios = dados.tumores.reduce((n, t) => n + t.cenarios.length, 0);

const html = `<title>Critérios Clínicos OncoGenYX</title>
<style>
  :root {
    --papel: #fbfcfb;
    --papel-fundo: #eef1ef;
    --superficie: #ffffff;
    --tinta: #16211d;
    --tinta-media: #4a5a54;
    --tinta-fraca: #6b7c75;
    --regua: #dbe3df;
    --regua-forte: #c3cec9;
    --verde: #0f6b5c;
    --verde-claro: #e6f1ee;
    --ambar: #7d5509;
    --ambar-claro: #f6efdd;
    --neutro-selo: #5c6a64;
    --neutro-claro: #eceeed;
    --sombra: 0 1px 2px rgba(22, 33, 29, .05), 0 10px 30px -18px rgba(22, 33, 29, .25);
    --serif: Iowan Old Style, Palatino, "Palatino Linotype", Georgia, "Times New Roman", serif;
    --sans: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
    --mono: ui-monospace, SFMono-Regular, "SF Mono", Menlo, monospace;
  }
  @media (prefers-color-scheme: dark) {
    :root:not([data-theme="light"]) {
      --papel: #141a18;
      --papel-fundo: #0d1211;
      --superficie: #1b2321;
      --tinta: #e6ece9;
      --tinta-media: #a8b6b0;
      --tinta-fraca: #8b9a94;
      --regua: #2c3733;
      --regua-forte: #3b4842;
      --verde: #5cc3a9;
      --verde-claro: #17322c;
      --ambar: #dcb256;
      --ambar-claro: #33290f;
      --neutro-selo: #9aa8a2;
      --neutro-claro: #232c29;
      --sombra: 0 1px 2px rgba(0, 0, 0, .35), 0 10px 30px -18px rgba(0, 0, 0, .7);
    }
  }
  :root[data-theme="dark"] {
    --papel: #141a18;
    --papel-fundo: #0d1211;
    --superficie: #1b2321;
    --tinta: #e6ece9;
    --tinta-media: #a8b6b0;
    --tinta-fraca: #8b9a94;
    --regua: #2c3733;
    --regua-forte: #3b4842;
    --verde: #5cc3a9;
    --verde-claro: #17322c;
    --ambar: #dcb256;
    --ambar-claro: #33290f;
    --neutro-selo: #9aa8a2;
    --neutro-claro: #232c29;
    --sombra: 0 1px 2px rgba(0, 0, 0, .35), 0 10px 30px -18px rgba(0, 0, 0, .7);
  }

  * { box-sizing: border-box; }
  body {
    margin: 0;
    background: var(--papel-fundo);
    color: var(--tinta);
    font-family: var(--serif);
    font-size: 16px;
    line-height: 1.62;
    -webkit-text-size-adjust: 100%;
  }
  .folha {
    max-width: 62rem;
    margin: 0 auto;
    padding: clamp(1.5rem, 4vw, 4rem) clamp(1rem, 4vw, 3rem) 6rem;
    background: var(--papel);
  }

  h1, h2, h3, h4 { text-wrap: balance; margin: 0; }

  /* ---------- capa ---------- */
  .capa { border-bottom: 2px solid var(--tinta); padding-bottom: 2.25rem; margin-bottom: 3rem; }
  .selo-doc {
    font-family: var(--sans); font-size: .72rem; font-weight: 650;
    letter-spacing: .13em; text-transform: uppercase; color: var(--verde);
    display: block; margin-bottom: .9rem;
  }
  .capa h1 { font-size: clamp(2rem, 5vw, 3rem); line-height: 1.1; letter-spacing: -.02em; font-weight: 600; }
  .capa .sub { font-size: 1.12rem; color: var(--tinta-media); margin: 1rem 0 0; max-width: 46ch; }
  .meta {
    display: flex; flex-wrap: wrap; gap: 1.5rem 2.5rem; margin-top: 2rem;
    font-family: var(--sans); font-size: .82rem;
  }
  .meta div { display: flex; flex-direction: column; gap: .15rem; }
  .meta span:first-child { color: var(--tinta-fraca); letter-spacing: .04em; text-transform: uppercase; font-size: .68rem; }
  .meta span:last-child { color: var(--tinta); font-weight: 600; font-variant-numeric: tabular-nums; }

  /* ---------- instruções ---------- */
  .instrucoes {
    background: var(--superficie); border: 1px solid var(--regua);
    border-left: 3px solid var(--verde);
    padding: 1.5rem 1.75rem; margin-bottom: 3.5rem; box-shadow: var(--sombra);
  }
  .instrucoes h2 { font-size: 1.05rem; margin-bottom: .75rem; }
  .instrucoes p { margin: 0 0 .8rem; color: var(--tinta-media); max-width: 68ch; }
  .instrucoes p:last-child { margin-bottom: 0; }
  .instrucoes strong { color: var(--tinta); }

  /* ---------- tumor ---------- */
  .tumor { margin-bottom: 4.5rem; }
  .tumor-cabeca { border-top: 2px solid var(--tinta); padding-top: 1.25rem; margin-bottom: 2rem; }
  .tumor-cabeca h2 { font-size: 1.85rem; letter-spacing: -.015em; font-weight: 600; }
  .eixo { color: var(--tinta-media); margin: .6rem 0 0; max-width: 70ch; }
  .fontes { font-family: var(--sans); font-size: .8rem; color: var(--tinta-fraca); margin: .9rem 0 0; max-width: 70ch; line-height: 1.5; }
  .fontes span { text-transform: uppercase; letter-spacing: .08em; font-size: .67rem; font-weight: 650; color: var(--verde); display: block; margin-bottom: .2rem; }

  .campos { background: var(--neutro-claro); padding: 1.1rem 1.35rem; margin-bottom: 2.25rem; }
  .campos-titulo { font-family: var(--sans); font-size: .72rem; text-transform: uppercase; letter-spacing: .09em; color: var(--tinta-fraca); font-weight: 650; margin-bottom: .7rem; }
  .campos ul { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: .4rem; }
  .campos li { display: flex; flex-wrap: wrap; align-items: baseline; gap: .5rem; font-family: var(--sans); font-size: .85rem; }
  .campo-nome { font-weight: 600; }
  .marca-decisivo {
    font-size: .62rem; text-transform: uppercase; letter-spacing: .07em; font-weight: 700;
    color: var(--ambar); background: var(--ambar-claro); padding: .1rem .4rem; border-radius: 2px;
  }
  .campo-opcoes { color: var(--tinta-fraca); font-size: .78rem; font-family: var(--mono); }

  /* ---------- cenário ---------- */
  .cenario {
    background: var(--superficie); border: 1px solid var(--regua);
    margin-bottom: 1.5rem; box-shadow: var(--sombra);
    break-inside: avoid; page-break-inside: avoid;
  }
  .cenario-cabeca {
    display: flex; align-items: baseline; gap: .9rem; flex-wrap: wrap;
    padding: 1.1rem 1.4rem; border-bottom: 1px solid var(--regua);
  }
  .cenario-num {
    font-family: var(--mono); font-size: .72rem; font-weight: 600;
    color: var(--tinta-fraca); letter-spacing: .04em; white-space: nowrap;
  }
  .cenario-cabeca h3 { font-size: 1.08rem; font-weight: 600; flex: 1 1 18rem; }
  .selo {
    font-family: var(--sans); font-size: .68rem; font-weight: 700;
    text-transform: uppercase; letter-spacing: .06em;
    padding: .22rem .55rem; border-radius: 2px; white-space: nowrap;
  }
  .selo-indica { color: var(--verde); background: var(--verde-claro); }
  .selo-confirmar { color: var(--ambar); background: var(--ambar-claro); }
  .selo-nao, .selo-falta, .selo-fora { color: var(--neutro-selo); background: var(--neutro-claro); }

  .entrada {
    display: flex; flex-wrap: wrap; gap: .4rem .5rem;
    padding: .9rem 1.4rem; background: var(--neutro-claro);
    border-bottom: 1px solid var(--regua);
  }
  .par { display: inline-flex; align-items: baseline; gap: .35rem; font-family: var(--sans); font-size: .78rem; }
  .par-k { color: var(--tinta-fraca); }
  .par-v { font-family: var(--mono); font-weight: 600; color: var(--tinta); }

  .saida { padding: 1.3rem 1.4rem; }
  .resumo { margin: 0 0 .9rem; font-size: 1.02rem; max-width: 68ch; }
  .dx { margin: 0 0 1.3rem; font-family: var(--mono); font-size: .82rem; color: var(--tinta-media); }
  .dx-rotulo { font-family: var(--sans); text-transform: uppercase; letter-spacing: .07em; font-size: .64rem; color: var(--tinta-fraca); font-weight: 650; display: block; margin-bottom: .2rem; }

  .teste { border-top: 1px solid var(--regua); padding-top: 1rem; margin-top: 1rem; }
  .teste-cabeca { display: flex; align-items: baseline; gap: .75rem; flex-wrap: wrap; }
  .teste h4 { font-size: 1rem; font-weight: 650; color: var(--verde); }
  .amostra { font-family: var(--sans); font-size: .7rem; color: var(--tinta-fraca); text-transform: uppercase; letter-spacing: .05em; }
  .numero { font-family: var(--sans); font-size: .78rem; color: var(--tinta-media); margin: .35rem 0 0; font-variant-numeric: tabular-nums; }
  .descricao { margin: .5rem 0 0; font-size: .93rem; color: var(--tinta-media); max-width: 70ch; }
  .justificativa { margin-top: .8rem; padding: .7rem .9rem; background: var(--verde-claro); border-left: 2px solid var(--verde); }
  .justificativa-rotulo { font-family: var(--sans); font-size: .63rem; text-transform: uppercase; letter-spacing: .08em; font-weight: 700; color: var(--verde); }
  .justificativa p { margin: .25rem 0 0; font-size: .9rem; max-width: 68ch; }

  .programas { list-style: none; margin: .8rem 0 0; padding: 0; display: flex; flex-direction: column; gap: .5rem; }
  .programas li { font-family: var(--sans); font-size: .8rem; display: flex; flex-direction: column; gap: .15rem; padding-left: .8rem; border-left: 2px solid var(--regua-forte); }
  .programa-nome { font-weight: 650; }
  .programa-nota { color: var(--tinta-media); }
  .programa-url { font-family: var(--mono); font-size: .72rem; color: var(--tinta-fraca); overflow-wrap: anywhere; }
  .programa-url.vazio { color: var(--ambar); font-style: italic; }

  .nota { display: flex; gap: .75rem; margin-top: 1rem; padding-top: 1rem; border-top: 1px solid var(--regua); }
  .nota-tag { font-family: var(--sans); font-size: .63rem; font-weight: 700; text-transform: uppercase; letter-spacing: .06em; color: var(--ambar); background: var(--ambar-claro); padding: .2rem .45rem; height: fit-content; white-space: nowrap; border-radius: 2px; }
  .nota strong { font-size: .93rem; }
  .nota p { margin: .2rem 0 0; font-size: .89rem; color: var(--tinta-media); max-width: 66ch; }

  /* ---------- validação ---------- */
  .validacao {
    display: flex; align-items: center; gap: 1.1rem; flex-wrap: wrap;
    padding: .8rem 1.4rem; border-top: 1px dashed var(--regua-forte);
    font-family: var(--sans); font-size: .78rem;
  }
  .validacao-rotulo { text-transform: uppercase; letter-spacing: .08em; font-size: .64rem; font-weight: 700; color: var(--tinta-fraca); }
  .marcar { display: inline-flex; align-items: center; gap: .4rem; color: var(--tinta-media); }
  .caixa { width: .95rem; height: .95rem; border: 1.5px solid var(--regua-forte); display: inline-block; }
  .linha-obs { flex: 1 1 10rem; border-bottom: 1px solid var(--regua-forte); color: var(--tinta-fraca); font-size: .68rem; min-height: 1.2rem; }

  /* ---------- divergências ---------- */
  .abertas { margin-top: 5rem; }
  .abertas > h2 { font-size: 1.85rem; font-weight: 600; letter-spacing: -.015em; border-top: 2px solid var(--tinta); padding-top: 1.25rem; }
  .abertas > .intro { color: var(--tinta-media); margin: .7rem 0 2rem; max-width: 70ch; }
  .divergencia { background: var(--superficie); border: 1px solid var(--regua); border-top: 3px solid var(--ambar); margin-bottom: 1.25rem; box-shadow: var(--sombra); break-inside: avoid; page-break-inside: avoid; }
  .divergencia header { display: flex; gap: 1rem; padding: 1.1rem 1.4rem .5rem; }
  .div-num { font-family: var(--mono); font-size: 1.35rem; font-weight: 600; color: var(--ambar); line-height: 1; font-variant-numeric: tabular-nums; }
  .div-tumor { font-family: var(--sans); font-size: .66rem; text-transform: uppercase; letter-spacing: .09em; font-weight: 700; color: var(--tinta-fraca); display: block; margin-bottom: .2rem; }
  .divergencia h3 { font-size: 1.05rem; font-weight: 600; max-width: 60ch; }
  .div-hoje { margin: 0 1.4rem .6rem; font-family: var(--sans); font-size: .84rem; }
  .div-hoje span { text-transform: uppercase; letter-spacing: .07em; font-size: .64rem; font-weight: 700; color: var(--tinta-fraca); margin-right: .5rem; }
  .div-contexto { margin: 0 1.4rem 1rem; color: var(--tinta-media); font-size: .93rem; max-width: 70ch; }

  /* ---------- rodapé ---------- */
  .assinatura { margin-top: 4rem; border-top: 2px solid var(--tinta); padding-top: 2rem; display: flex; flex-wrap: wrap; gap: 2.5rem; }
  .assinatura div { flex: 1 1 14rem; }
  .assinatura .linha { border-bottom: 1px solid var(--tinta); height: 2.5rem; }
  .assinatura span { font-family: var(--sans); font-size: .72rem; text-transform: uppercase; letter-spacing: .07em; color: var(--tinta-fraca); display: block; margin-top: .4rem; }
  .aviso-final { margin-top: 3rem; font-family: var(--sans); font-size: .78rem; color: var(--tinta-fraca); max-width: 70ch; line-height: 1.55; }

  @media print {
    body { background: #fff; color: #000; }
    .folha { max-width: none; padding: 0; background: #fff; }
    .cenario, .divergencia, .instrucoes { box-shadow: none; }
    .tumor { page-break-before: auto; }
    .capa { page-break-after: avoid; }
    a { text-decoration: none; color: inherit; }
  }
</style>

<div class="folha">
  <header class="capa">
    <span class="selo-doc">Documento de validação clínica</span>
    <h1>Critérios de indicação de teste genético</h1>
    <p class="sub">O conjunto completo de regras que decidem qual exame a plataforma indica, para qual paciente e em que momento da doença.</p>
    <div class="meta">
      <div><span>Gerado em</span><span>${esc(dados.geradoEm)}</span></div>
      <div><span>Subtipos</span><span>${dados.tumores.length}</span></div>
      <div><span>Cenários</span><span>${totalCenarios}</span></div>
      <div><span>Questões em aberto</span><span>${dados.divergencias.length}</span></div>
    </div>
  </header>

  <section class="instrucoes">
    <h2>Como este documento foi feito, e como lê-lo</h2>
    <p>Cada cenário abaixo foi <strong>executado no motor da plataforma</strong> e o que aparece aqui é a resposta real dele — não uma descrição escrita à parte. Um documento redigido à mão diverge do sistema na primeira alteração e ninguém percebe; validar este texto é validar o comportamento.</p>
    <p>A leitura de cada bloco vai da <strong>condição clínica</strong> (a faixa cinza, com o que o médico informou) para o <strong>veredito</strong> — os exames indicados, a justificativa que sai impressa na solicitação assinada, e os programas de acesso oferecidos.</p>
    <p>Ao final há <strong>${dados.divergencias.length} questões em aberto</strong>: pontos em que as diretrizes divergem entre si ou em que a escolha atual foi uma decisão de produto, não uma imposição da literatura. São as que mais precisam do seu parecer.</p>
    <p>Cada bloco tem espaço para marcar <strong>De acordo</strong> ou <strong>Ajustar</strong>, com uma linha para observação.</p>
  </section>

  ${dados.tumores.map(secaoTumor).join('')}

  <section class="abertas">
    <h2>Questões em aberto</h2>
    <p class="intro">Nenhuma destas tem resposta única na literatura. A escolha atual está registrada; o parecer clínico decide se ela permanece.</p>
    ${divergencias}
  </section>

  <div class="assinatura">
    <div><div class="linha"></div><span>Médico responsável pela validação</span></div>
    <div><div class="linha"></div><span>CRM</span></div>
    <div><div class="linha"></div><span>Data</span></div>
  </div>

  <p class="aviso-final">Este documento descreve regras de triagem para indicação de exame genético. Não constitui recomendação terapêutica nem substitui aconselhamento genético. As diretrizes citadas são as vigentes na data de geração e devem ser reconfirmadas a cada revisão.</p>
</div>
`;

process.stdout.write(html);
