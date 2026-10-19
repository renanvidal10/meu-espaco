// Gera a imagem de pré-visualização do link (public/compartilhar.png).
//
// §79. O texto do cartão mora AQUI, num lugar só. Ele aparece em dois sítios
// que ninguém olha ao mesmo tempo: desenhado na imagem, e escrito nas
// marcações og: do index.html. Mantidos à mão, divergem — e a divergência é
// invisível, porque a imagem é um arquivo binário e as marcações são texto.
// A bateria do aplicativo lê estas constantes e exige que as marcações digam
// o mesmo; mudar o texto sem gerar a imagem de novo reprova.
//
// Rodar:  node test/gerar-cartao.js
'use strict';
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const TEXTO = {
  titulo: 'Apoio à decisão genética do seu paciente.',
  apoio: 'Qual teste solicitar e por quê. Triagem baseada em diretrizes. Não é indicação terapêutica.',
  // Alternativa textual da imagem, para quem usa leitor de tela.
  alt: 'OncoGenYX. Apoio à decisão genética do seu paciente. Cobre ovário, mama, próstata, colorretal, pulmão, pâncreas e endométrio.',
};

const COBERTOS = ['Ovário', 'Mama', 'Próstata', 'Colorretal', 'Pulmão', 'Pâncreas', 'Endométrio'];

// A mesma hélice da marca, do index.html.
const HELICE = '<svg class="helice" viewBox="0 0 24 24" aria-hidden="true"><path d="M17.4 4.5L17.0 5.3L15.8 6.0L14.1 6.8L12.0 7.5L9.9 8.3L8.2 9.0L7.0 9.8L6.6 10.5L7.0 11.3L8.2 12.0L9.9 12.8L12.0 13.5L14.1 14.3L15.8 15.0L17.0 15.8L17.4 16.5L17.0 17.3L15.8 18.0L14.1 18.8L12.0 19.5"/><path class="atras" d="M6.6 4.5L7.0 5.3L8.2 6.0L9.9 6.8L12.0 7.5L14.1 8.3L15.8 9.0L17.0 9.8L17.4 10.5L17.0 11.3L15.8 12.0L14.1 12.8L12.0 13.5L9.9 14.3L8.2 15.0L7.0 15.8L6.6 16.5L7.0 17.3L8.2 18.0L9.9 18.8L12.0 19.5"/><path d="M6.6 4.5L7.0 5.3L8.2 6.0L9.9 6.8L12.0 7.5L14.1 8.3L15.8 9.0L17.0 9.8L17.4 10.5L17.0 11.3L15.8 12.0L14.1 12.8L12.0 13.5L9.9 14.3L8.2 15.0L7.0 15.8L6.6 16.5L7.0 17.3L8.2 18.0L9.9 18.8L12.0 19.5"/></svg>';

// Sem fonte externa, aqui também: a promessa ao médico é que o material não
// gera pedido a terceiro, e vale para a imagem do cartão.
const MOLDE = `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"/><style>
:root{--accent:#0e6180}
*{margin:0;padding:0;box-sizing:border-box}
html,body{width:1200px;height:630px}
body{background:linear-gradient(165deg,#11768f 0%,#0e6180 58%,#0a4f68 100%);background-color:var(--accent);color:#fff;
font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif;
position:relative;overflow:hidden;display:flex;flex-direction:column;justify-content:space-between;padding:68px 76px 60px}
body::after{content:'';position:absolute;inset:0;background:radial-gradient(1100px 620px at 88% -12%,rgba(255,255,255,.17),transparent 62%);pointer-events:none}
.topo{display:flex;align-items:center;gap:18px;position:relative;z-index:1}
.marca{width:64px;height:64px;border-radius:16px;background:rgba(255,255,255,.14);border:1px solid rgba(255,255,255,.26);display:flex;align-items:center;justify-content:center}
.marca svg{width:40px;height:40px}
.helice path{fill:none;stroke:#fff;stroke-width:1.5;stroke-linecap:round}
.helice path.atras{stroke:rgba(255,255,255,.45)}
.nome{font-size:36px;font-weight:700;letter-spacing:-.02em}
.meio{position:relative;z-index:1}
h1{font-size:62px;line-height:1.08;font-weight:700;letter-spacing:-.032em;max-width:21ch}
.sub{margin-top:22px;font-size:27px;line-height:1.45;color:rgba(255,255,255,.84);max-width:46ch;font-weight:400}
.base{position:relative;z-index:1;display:flex;align-items:center;gap:12px;flex-wrap:wrap;padding-top:26px;border-top:1px solid rgba(255,255,255,.2)}
.selo{font-size:20px;font-weight:600;padding:9px 16px;border-radius:999px;background:rgba(255,255,255,.12);border:1px solid rgba(255,255,255,.24);color:rgba(255,255,255,.95)}
</style></head><body>
<div class="topo"><span class="marca">${HELICE}</span><span class="nome">OncoGenYX</span></div>
<div class="meio"><h1>${TEXTO.titulo}</h1><p class="sub">${TEXTO.apoio}</p></div>
<div class="base">${COBERTOS.map((t) => `<span class="selo">${t}</span>`).join('')}</div>
</body></html>`;

function carregarPlaywright() {
  try { return require('playwright'); } catch { /* instalação global */ }
  const raiz = execFileSync('npm', ['root', '-g'], { encoding: 'utf8' }).trim();
  return require(path.join(raiz, 'playwright'));
}

async function gerar() {
  const { chromium } = carregarPlaywright();
  const destino = path.join(__dirname, '..', 'public', 'compartilhar.png');
  const molde = path.join(require('os').tmpdir(), 'cartao-oncogenyx.html');
  fs.writeFileSync(molde, MOLDE);
  const navegador = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const pagina = await navegador.newPage({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1 });
  await pagina.goto('file://' + molde);
  await pagina.waitForTimeout(300);
  await pagina.screenshot({ path: destino });
  await navegador.close();
  fs.unlinkSync(molde);
  return destino;
}

module.exports = { TEXTO, COBERTOS, gerar };

if (require.main === module) {
  gerar().then((d) => { console.log('cartão gerado em ' + d); process.exit(0); })
    .catch((e) => { console.error(e); process.exit(1); });
}
