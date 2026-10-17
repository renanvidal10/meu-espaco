// Medição de contraste WCAG contra o produto rodando, nos dois temas.
//
// Existe porque a auditoria de acessibilidade encontrou 56 combinações
// reprovadas e o card do veredito clínico — a resposta central do produto —
// media 1,88:1 no tema escuro. Um número desses não pode voltar sem ninguém
// perceber, então a verificação vira parte da bateria em vez de ficar num
// relatório.
//
// As cores vêm de getComputedStyle, com composição das camadas semitransparentes
// até achar o fundo efetivo. Nada aqui é estimado.

const path = require('path');
const { arquivoDeDadosTemporario } = require('./temporario.js');
const fs = require('fs');
const { execFileSync } = require('child_process');

function carregarPlaywright() {
  try {
    return require('playwright');
  } catch (err) {
    if (err.code !== 'MODULE_NOT_FOUND') throw err;
  }
  const raizGlobal = execFileSync('npm', ['root', '-g'], { encoding: 'utf8' }).trim();
  return require(path.join(raizGlobal, 'playwright'));
}

const { chromium } = carregarPlaywright();

// AA: 4,5:1 para texto normal, 3:1 para texto grande (>=18,66px, ou >=14px em
// negrito) e para o limite visual de componentes de UI.
const ALVOS = [
  { seletor: '#verdict-title', minimo: 3, nota: 'titulo do veredito clinico' },
  { seletor: '#verdict-text', minimo: 4.5, nota: 'texto do veredito clinico' },
  { seletor: '#verdict-glyph', minimo: 3, nota: 'glifo do veredito' },
  { seletor: '.gate-aside h2', minimo: 3, nota: 'titulo do painel de acesso' },
  { seletor: '.gate-aside > p', minimo: 4.5, nota: 'texto do painel de acesso' },
  { seletor: '.gate-points li', minimo: 4.5, nota: 'lista do painel de acesso' },
  { seletor: '.gate-aside-foot', minimo: 4.5, nota: 'rodape do painel de acesso' },
  { seletor: '.field label', minimo: 4.5, nota: 'rotulo de campo (--ink-faint)' },
  { seletor: '.eyebrow', minimo: 4.5, nota: 'sobretitulo (--ink-faint)' },
  { seletor: '.doc-preview .doc-row .k', minimo: 4.5, nota: 'rotulo do documento' },
  // §54. O selo da nota de ação trocou --warn por --accent. A cor de destaque
  // foi escolhida para botão (fundo cheio, texto branco por cima); aqui ela
  // vira TEXTO de 12px sobre superfície clara, que é o caso mais exigente.
  { seletor: '.note-card.acao .tag', minimo: 4.5, nota: 'selo da nota de acao (--accent como texto)' },
  { seletor: '.note-card.acao h4', minimo: 4.5, nota: 'titulo da nota de acao' },
  // §55. Aviso que explica por que o download está barrado: --warn como texto
  // de 12px. Se não for legível, o botão desabilitado fica sem motivo visível
  // e a tela parece travada.
  { seletor: '#patient-name-aviso', minimo: 4.5, nota: 'aviso do campo obrigatorio (--warn como texto)' },
  // §61. O texto de exemplo do compositor instrui o médico sobre o que colar.
  // Placeholder costuma ficar fora de medição de contraste porque "é só
  // dica" — aqui ele é a única orientação da tela de entrada.
  { seletor: '#case-text', minimo: 4.5, nota: 'texto de exemplo do compositor', placeholder: true },
  // §63. Os nós numerados da sequência. Número dentro de círculo pintado é
  // texto pequeno sobre cor forte — o caso em que o olho perdoa e o medidor
  // não. Medido nas duas telas onde ele aparece.
  { seletor: '.test-step.primary .step-num', minimo: 4.5, nota: 'no da sequencia (resultado)' },
  { seletor: '.prog-cabeca .step-num', minimo: 4.5, nota: 'no da sequencia (programas)' },
  // §67. O marca-texto no critério que EXCLUI: texto sobre fundo de alerta.
  // É o trecho do card que o médico MAIS precisa conseguir ler.
  { seletor: 'mark.marca-criterio', minimo: 4.5, nota: 'criterio de exclusao marcado' },
  // §69. O balão de falha da Gena: --warn sobre --warn-soft, par que nenhum
  // outro alvo media. É a mensagem que aparece quando a rede cai — justamente
  // quando o médico precisa ler depressa.
  { seletor: '.gena-bubble.gena-falha', minimo: 4.5, nota: 'balao de falha da Gena' },
  { seletor: '.gena-retentar', minimo: 4.5, nota: 'botao tentar de novo' },
];

function paraRgb(css) {
  const m = String(css).match(/rgba?\(([^)]+)\)/);
  if (!m) return null;
  const p = m[1].split(',').map((v) => parseFloat(v.trim()));
  return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 };
}

function sobrepor(frente, fundo) {
  const a = frente.a;
  return {
    r: a * frente.r + (1 - a) * fundo.r,
    g: a * frente.g + (1 - a) * fundo.g,
    b: a * frente.b + (1 - a) * fundo.b,
    a: 1,
  };
}

function luminancia(c) {
  const f = (v) => {
    const x = v / 255;
    return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b);
}

function contraste(a, b) {
  const l1 = luminancia(a);
  const l2 = luminancia(b);
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
}

// Sobe a árvore acumulando as camadas de fundo até achar uma opaca, para que
// o fundo efetivo de um texto sobre superfície semitransparente seja o real.
function coletar(sel) {
  const el = document.querySelector(sel);
  if (!el) return null;
  const cs = getComputedStyle(el);
  const camadas = [];
  let no = el;
  while (no) {
    const estilo = getComputedStyle(no);
    /* §57.2. PONTO CEGO FECHADO. Um elemento com `background: linear-gradient(...)`
     * tem backgroundColor transparente: esta subida de árvore atravessava o
     * gradiente como se ele não existisse e media o texto contra o fundo da
     * PÁGINA. Texto branco sobre um painel azul-escuro foi medido em 1,09:1 —
     * reprovação inventada. O inverso é o perigo real: texto escuro sobre um
     * gradiente escuro mediria contra a página clara e PASSARIA.
     *
     * A regra agora é dura: toda superfície com gradiente precisa declarar
     * também a cor sólida equivalente. Ela serve de medida aqui e de pintura
     * de reserva no navegador que não renderizar o gradiente. */
    const temGradiente = /gradient\(/.test(String(estilo.backgroundImage || ''));
    const bg = estilo.backgroundColor;
    const corDeFundo = String(bg).match(/rgba?\(([^)]+)\)/);
    const opaca = corDeFundo
      && (corDeFundo[1].split(',').length < 4 || parseFloat(corDeFundo[1].split(',')[3]) === 1);
    if (temGradiente && !opaca) {
      return { erroGradiente: no.id || no.className || no.tagName };
    }
    const m = corDeFundo;
    if (m) {
      const p = m[1].split(',').map((v) => parseFloat(v.trim()));
      const a = p.length > 3 ? p[3] : 1;
      if (a > 0) camadas.push(bg);
      if (a === 1) break;
    }
    no = no.parentElement;
  }
  // A cor do ::placeholder não sai em getComputedStyle(el).color. Lê-se pelo
  // pseudo-elemento; sem isto, mediríamos a cor do texto DIGITADO e daríamos
  // por aprovada uma dica ilegível.
  const ps = getComputedStyle(el, '::placeholder');
  return { cor: cs.color, corPlaceholder: ps && ps.color, tamanho: cs.fontSize, peso: cs.fontWeight, camadas };
}

async function medirTema(pagina, tema, entrar) {
  await pagina.emulateMedia({ colorScheme: tema === 'dark' ? 'dark' : 'light' });
  await pagina.evaluate((t) => document.documentElement.setAttribute('data-theme', t), tema);
  await pagina.waitForTimeout(120);

  const resultados = [];
  for (const alvo of ALVOS) {
    const dados = await pagina.evaluate(coletar, alvo.seletor);
    if (!dados) continue;
    if (dados.erroGradiente) {
      resultados.push({
        seletor: alvo.seletor, nota: alvo.nota, tema,
        razao: 0, minimo: alvo.minimo, passou: false,
        motivo: `gradiente sem background-color sólido em "${dados.erroGradiente}" — impossível medir`,
      });
      continue;
    }

    let fundo = { r: 255, g: 255, b: 255, a: 1 };
    for (let i = dados.camadas.length - 1; i >= 0; i--) {
      const c = paraRgb(dados.camadas[i]);
      if (c) fundo = c.a === 1 ? c : sobrepor(c, fundo);
    }
    const cor = paraRgb(alvo.placeholder && dados.corPlaceholder ? dados.corPlaceholder : dados.cor);
    if (!cor) continue;
    const frente = cor.a === 1 ? cor : sobrepor(cor, fundo);

    const razao = contraste(frente, fundo);
    resultados.push({
      seletor: alvo.seletor,
      nota: alvo.nota,
      tema,
      razao,
      minimo: alvo.minimo,
      passou: razao >= alvo.minimo,
    });
  }
  return resultados;
}

module.exports = { medirTema, contraste, paraRgb, sobrepor, ALVOS };

// Execução direta: sobe o servidor, percorre até a tela de resultado e mede.
if (require.main === module) {
  (async () => {
    const { criarStub } = require('./stub-anthropic.js');
    const os = require('os');
    const stub = criarStub();
    const portaStub = await stub.ouvir(0);
    const porta = 6100 + Math.floor(Math.random() * 200);
    const base = `http://127.0.0.1:${porta}`;

    const servidor = require('child_process').spawn(
      process.execPath,
      [path.join(__dirname, '..', 'index.js')],
      {
        env: {
          ...process.env,
          PORT: String(porta),
          NODE_ENV: 'test',
          DATA_FILE: arquivoDeDadosTemporario('cor'),
          ANTHROPIC_API_KEY: 'chave-de-teste',
          ANTHROPIC_BASE_URL: `http://127.0.0.1:${portaStub}`,
          DATABASE_URL: '', RESEND_API_KEY: '', APP_ORIGIN: '',
        },
        stdio: ['ignore', 'ignore', 'pipe'],
      },
    );

    for (let i = 0; i < 100; i++) {
      try { if ((await fetch(base + '/api/health')).ok) break; } catch { /* subindo */ }
      await new Promise((r) => setTimeout(r, 200));
    }

    const navegador = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
    const contexto = await navegador.newContext({ viewport: { width: 1280, height: 900 } });
    const pagina = await contexto.newPage();

    const todos = [];
    // Tela de acesso primeiro: os alvos do painel lateral só existem aqui.
    await pagina.goto(base);
    await pagina.waitForTimeout(500);
    for (const tema of ['light', 'dark']) todos.push(...await medirTema(pagina, tema));

    // Depois entra e roda a triagem, para alcançar o card do veredito.
    stub.responderCom({
      tipo: 'ok',
      extracao: {
        tipo_tumor: 'Ginecológico - Ovário',
        histologia: 'Seroso', grau: 'Alto grau', estadiamento: 'IIIC', idade: '61',
      },
    }, 1);
    if (await pagina.locator('#acesso-name').isVisible()) {
      await pagina.fill('#acesso-name', 'Renan Vidal');
      await pagina.fill('#acesso-crm', '339324');
      await pagina.click('#acesso-submit');
    }
    await pagina.waitForSelector('body:not(.gate-active)');
    if (await pagina.locator('#boas-vindas.aberto').count()) await pagina.click('#bv-comecar');
    await pagina.fill('#case-text', 'Mulher 61 anos, carcinoma seroso de alto grau de ovario, FIGO IIIC.');
    await pagina.click('#btn-extract');
    await pagina.waitForTimeout(1500);
    const seguir = pagina.locator('#btn-to-result');
    if (await seguir.count()) { await seguir.click(); await pagina.waitForTimeout(600); }

    for (const tema of ['light', 'dark']) todos.push(...await medirTema(pagina, tema));

    // Segundo caso: endométrio dMMR é o único que renderiza a nota de AÇÃO, e
    // a nota de ação é a única que usa --accent como texto. Sem rodar este
    // caso, os dois alvos novos seriam silenciosamente pulados — medirTema
    // ignora seletor ausente, então um alvo que nunca aparece passa por
    // aprovado sem nunca ter sido medido.
    stub.responderCom({
      tipo: 'ok',
      extracao: {
        tipo_tumor: 'Ginecológico - Endométrio',
        histologia: 'Endometrioide', estadiamento: 'IA', mmr_msi: 'dMMR / MSI-alto', idade: '58',
      },
    }, 1);
    await pagina.click('.step-btn[data-step="0"]');
    await pagina.waitForTimeout(300);
    await pagina.fill('#case-text', 'Mulher 58 anos, carcinoma endometrioide de endometrio, FIGO IA, dMMR.');
    await pagina.click('#btn-extract');
    await pagina.waitForSelector('#screen-1.active');
    // A nota de ação só existe depois da triagem rodar: ela é renderizada por
    // JS, não está na marcação. Diferente do card do veredito, que existe
    // vazio no HTML e por isso podia ser medido sem navegar.
    await pagina.click('button:has-text("Rodar triagem")');
    await pagina.waitForSelector('#screen-2.active');
    await pagina.waitForTimeout(300);

    const medidos = await pagina.locator('.note-card.acao .tag').count();
    if (medidos === 0) {
      console.error('FALHA: o caso de endométrio dMMR não renderizou nota de ação — os alvos de --accent não foram medidos.');
      process.exitCode = 1;
    }

    // Tela 3 com o campo do paciente vazio: é onde o aviso de §55 aparece. A
    // extração deste caso não traz nome, então o aviso está visível de fato.
    await pagina.click('#verdict-next-btn');
    await pagina.waitForSelector('#screen-3.active');
    await pagina.waitForTimeout(300);
    const nosMedidos = await pagina.locator('.prog-cabeca .step-num').count();
    if (nosMedidos === 0) {
      console.error('FALHA: o no numerado da tela de programas nao apareceu — o alvo nao foi medido.');
      process.exitCode = 1;
    }
    const avisoPresente = await pagina.locator('#patient-name-aviso:visible').count();
    if (avisoPresente === 0) {
      console.error('FALHA: o aviso do campo obrigatório não apareceu — o alvo de --warn não foi medido.');
      process.exitCode = 1;
    }
    for (const tema of ['light', 'dark']) todos.push(...await medirTema(pagina, tema));

    /* §67. Terceiro caso: ovário em primeira linha é o único que renderiza o
     * marca-texto, porque é o programa da GSK que declara `destaques`. Sem
     * rodar este caso o alvo seria pulado em silêncio — a armadilha do
     * §54.4, que já custou um alvo "aprovado" sem nunca ter sido medido. */
    stub.responderCom({
      tipo: 'ok',
      extracao: {
        tipo_tumor: 'Ginecológico - Ovário',
        histologia: 'Seroso', grau: 'Alto grau', estadiamento: 'IIIC', idade: '61',
      },
    }, 1);
    await pagina.click('.step-btn[data-step="0"]');
    await pagina.waitForTimeout(300);
    await pagina.fill('#case-text', 'Mulher 61 anos, carcinoma seroso de alto grau de ovario, FIGO IIIC.');
    await pagina.click('#btn-extract');
    await pagina.waitForSelector('#screen-1.active');
    await pagina.click('button:has-text("Rodar triagem")');
    await pagina.waitForSelector('#screen-2.active');
    await pagina.click('#verdict-next-btn');
    await pagina.waitForSelector('#screen-3.active');
    await pagina.waitForTimeout(400);

    const marcados = await pagina.locator('mark.marca-criterio').count();
    if (marcados === 0) {
      console.error('FALHA: o marca-texto do criterio nao apareceu — o alvo nao foi medido.');
      process.exitCode = 1;
    }
    /* §69. O balão de falha só existe quando a rede cai. Em vez de derrubar a
     * chamada, a própria função que o desenha é invocada — é o mesmo elemento
     * que o médico veria, e a bateria mede cor, não o caminho até ela. */
    await pagina.evaluate(() => {
      toggleGena(true);
      genaMostrarErro('Não consegui responder agora.');
    });
    await pagina.waitForTimeout(300);
    const falhaNaTela = await pagina.locator('.gena-bubble.gena-falha').count();
    if (falhaNaTela === 0) {
      console.error('FALHA: o balao de erro da Gena nao foi desenhado — o alvo nao foi medido.');
      process.exitCode = 1;
    }
    for (const tema of ['light', 'dark']) todos.push(...await medirTema(pagina, tema));

    await navegador.close();
    servidor.kill('SIGTERM');
    if (stub.fechar) await stub.fechar();

    const reprovados = todos.filter((r) => !r.passou);
    const vistos = new Set();
    for (const r of todos) {
      const chave = r.tema + r.seletor;
      if (vistos.has(chave)) continue;
      vistos.add(chave);
      console.log(
        `${r.passou ? '  ✓ ' : '  ✗ '}[${r.tema.padEnd(5)}] ${r.seletor.padEnd(26)} ${r.razao.toFixed(2)}:1 (mín ${r.minimo}) — ${r.nota}`,
      );
    }
    console.log('');
    if (reprovados.length) {
      console.log(`REPROVARAM: ${reprovados.length}`);
      process.exit(1);
    }
    console.log(`Contraste WCAG AA: ${vistos.size} medições, todas aprovadas, nos dois temas.`);
    process.exit(0);
  })();
}
