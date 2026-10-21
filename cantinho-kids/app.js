/*
  Cantinho Kids: lógica do app.
  Você não precisa mexer aqui para adicionar vídeos; isso fica em videos.js.

  Escrito sem recursos muito novos de JavaScript de propósito: o navegador
  de TVs Samsung mais antigas não entende coisas como "?." ou "??".
*/
(function () {
  "use strict";

  var ICONES = {
    livro: '<path d="M12 6.2C10.2 4.8 7.6 4 4.8 4.2c-.6 0-1 .5-1 1.1v11.9c0 .6.5 1.1 1.1 1.1 2.6-.1 5 .6 7.1 2.1 2.1-1.5 4.5-2.2 7.1-2.1.6 0 1.1-.5 1.1-1.1V5.3c0-.6-.4-1.1-1-1.1-2.8-.2-5.4.6-7.2 2Z" fill="currentColor"/><path d="M12 6.4v13.4" stroke="#0d0f2a" stroke-width="1.6" opacity=".35"/>',
    musica: '<path d="M9 17.5a3 3 0 1 1-2-2.83V6.2c0-.7.5-1.3 1.2-1.46l9-2A1.5 1.5 0 0 1 19 4.2v11.3a3 3 0 1 1-2-2.83V8.4l-8 1.8v7.3Z" fill="currentColor"/>',
    estrela: '<path d="m12 2.8 2.7 5.6 6.1.8-4.5 4.2 1.1 6.1L12 16.6l-5.4 2.9 1.1-6.1-4.5-4.2 6.1-.8L12 2.8Z" fill="currentColor"/>',
    coracao: '<path d="M12 20.5S3 15 3 8.8A4.8 4.8 0 0 1 12 6.3a4.8 4.8 0 0 1 9 2.5c0 6.2-9 11.7-9 11.7Z" fill="currentColor"/>',
    sol: '<circle cx="12" cy="12" r="4.5" fill="currentColor"/><path d="M12 2v2.5M12 19.5V22M2 12h2.5M19.5 12H22M4.9 4.9l1.8 1.8M17.3 17.3l1.8 1.8M4.9 19.1l1.8-1.8M17.3 6.7l1.8-1.8" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/>',
    tv: '<rect x="2.5" y="5" width="19" height="13" rx="2.5" fill="currentColor"/><path d="M8 21h8M9 2.5l3 2.5 3-2.5" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" fill="none"/>'
  };
  var PLAY = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 4.5v15l12.5-7.5L7 4.5Z" fill="#fff"/></svg>';
  var CORES = ["laranja", "rosa", "verde", "azul", "roxo", "amarelo"];

  var $ = function (id) { return document.getElementById(id); };

  // ---------- Leitura do link do YouTube ----------

  // Aceita youtube.com/watch?v=ID, youtu.be/ID, youtube.com/shorts/ID,
  // youtube.com/embed/ID, youtube.com/live/ID, ou só o código de 11 letras.
  function idDoYoutube(link) {
    if (!link) return null;
    var texto = String(link).trim();
    if (/^[A-Za-z0-9_-]{11}$/.test(texto)) return texto;
    var padroes = [
      /[?&]v=([A-Za-z0-9_-]{11})/,
      /youtu\.be\/([A-Za-z0-9_-]{11})/,
      /youtube(?:-nocookie)?\.com\/(?:shorts|embed|live|v)\/([A-Za-z0-9_-]{11})/
    ];
    for (var i = 0; i < padroes.length; i++) {
      var achou = texto.match(padroes[i]);
      if (achou) return achou[1];
    }
    return null;
  }

  function classeDoServico(servico) {
    var s = String(servico || "").toLowerCase();
    if (s.indexOf("disney") !== -1) return "servico-disney";
    if (s.indexOf("prime") !== -1 || s.indexOf("amazon") !== -1) return "servico-prime";
    return "servico-outro";
  }

  function escapar(texto) {
    return String(texto == null ? "" : texto)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }

  // ---------- Montagem da tela inicial ----------

  var fileiras = []; // fileiras[i] = lista de cartões daquela prateleira

  function montar(config) {
    if (config.nome) {
      $("nome-app").textContent = config.nome;
      document.title = config.nome;
    }
    if (config.saudacao) $("saudacao").textContent = config.saudacao;
    if (config.pergunta) $("pergunta").textContent = config.pergunta;

    var caixa = $("prateleiras");
    var prateleiras = config.prateleiras || [];

    prateleiras.forEach(function (prat) {
      var videos = prat.videos || [];
      if (!videos.length) return;

      var cor = CORES.indexOf(prat.cor) !== -1 ? prat.cor : "amarelo";
      var secao = document.createElement("section");
      secao.className = "prateleira";
      secao.style.setProperty("--cor", "var(--" + cor + ")");
      secao.innerHTML =
        '<h2 class="prateleira-titulo">' +
          '<span class="prateleira-icone"><svg viewBox="0 0 24 24" aria-hidden="true">' +
            (ICONES[prat.icone] || ICONES.estrela) +
          "</svg></span>" + escapar(prat.nome) +
        "</h2>";

      var fileira = document.createElement("div");
      fileira.className = "fileira";
      var cartoes = [];

      videos.forEach(function (video) {
        var cartao = criarCartao(video);
        cartao.setAttribute("data-fileira", fileiras.length);
        cartao.setAttribute("data-coluna", cartoes.length);
        fileira.appendChild(cartao);
        cartoes.push(cartao);
      });

      secao.appendChild(fileira);
      caixa.appendChild(secao);
      fileiras.push(cartoes);
    });

    if (fileiras.length) {
      focar(fileiras[0][0]);
    } else {
      caixa.innerHTML =
        '<div class="vazio"><b>Ainda não tem vídeos aqui</b>' +
        "<span>Adicione os vídeos no arquivo videos.js e recarregue a página.</span></div>";
    }
  }

  function criarCartao(video) {
    var botao = document.createElement("button");
    botao.type = "button";
    botao.className = "cartao focavel";
    var titulo = escapar(video.titulo);

    if (video.servico) {
      var classe = classeDoServico(video.servico);
      botao.innerHTML =
        '<span class="cartao-capa"><span class="cartao-servico ' + classe + '">' +
          '<span class="selo">' + escapar(video.servico) + "</span>" +
          "<b>" + titulo + "</b>" +
        "</span></span>" +
        '<span class="cartao-nome">' + titulo + "</span>";
      botao.addEventListener("click", function () { mostrarServico(video, classe); });
      return botao;
    }

    var id = idDoYoutube(video.link);
    if (!id) {
      botao.className += " cartao-quebrado";
      botao.innerHTML =
        '<span class="cartao-capa">Link não reconhecido. Confira em videos.js</span>' +
        '<span class="cartao-nome">' + titulo + "</span>";
      return botao;
    }

    botao.innerHTML =
      '<span class="cartao-capa">' +
        '<img src="https://i.ytimg.com/vi/' + id + '/hqdefault.jpg" alt="" loading="lazy">' +
        '<span class="cartao-play">' + PLAY + "</span>" +
      "</span>" +
      '<span class="cartao-nome">' + titulo + "</span>";
    botao.addEventListener("click", function () { tocar(id, botao); });
    return botao;
  }

  // ---------- Navegação com o controle remoto ----------

  var focoAtual = null;

  function focar(el) {
    if (!el) return;
    focoAtual = el;
    el.focus({ preventScroll: true });
    if (!el.classList.contains("cartao")) return;

    // Rola a fileira para o lado, deixando o cartão bem visível.
    var fileira = el.parentNode;
    var margem = parseFloat(getComputedStyle(fileira).paddingLeft) || 0;
    var alvo = el.offsetLeft - fileira.offsetLeft - margem;
    if (el.offsetLeft - fileira.offsetLeft + el.offsetWidth > fileira.scrollLeft + fileira.clientWidth - margem ||
        el.offsetLeft - fileira.offsetLeft < fileira.scrollLeft + margem) {
      fileira.scrollLeft = Math.max(0, alvo);
    }

    // Rola a página para cima ou para baixo até a prateleira.
    var secao = fileira.parentNode;
    var caixa = secao.getBoundingClientRect();
    var linha = Number(el.getAttribute("data-fileira"));
    if (linha === 0) {
      rolarPara(0);
    } else if (caixa.top < 0 || caixa.bottom > window.innerHeight) {
      rolarPara(window.pageYOffset + caixa.top - window.innerHeight * 0.18);
    }
  }

  function rolarPara(y) {
    try { window.scrollTo({ top: y, behavior: "smooth" }); }
    catch (e) { window.scrollTo(0, y); }
  }

  function andar(direcao) {
    if (!focoAtual || !focoAtual.hasAttribute("data-fileira")) {
      if (fileiras.length) focar(fileiras[0][0]);
      return;
    }
    var linha = Number(focoAtual.getAttribute("data-fileira"));
    var coluna = Number(focoAtual.getAttribute("data-coluna"));

    if (direcao === "esquerda") return focar(fileiras[linha][coluna - 1]);
    if (direcao === "direita") return focar(fileiras[linha][coluna + 1]);

    var nova = direcao === "cima" ? linha - 1 : linha + 1;
    if (nova < 0 || nova >= fileiras.length) return;

    // Na prateleira de cima ou de baixo, vai para o cartão mais próximo na tela.
    var meio = focoAtual.getBoundingClientRect();
    meio = meio.left + meio.width / 2;
    var melhor = null;
    var menor = Infinity;
    fileiras[nova].forEach(function (c) {
      var r = c.getBoundingClientRect();
      var d = Math.abs(r.left + r.width / 2 - meio);
      if (d < menor) { menor = d; melhor = c; }
    });
    focar(melhor);
  }

  // Códigos de tecla das setas, do OK e do Voltar em navegadores de TV.
  var TECLAS = {
    37: "esquerda", 38: "cima", 39: "direita", 40: "baixo",
    13: "ok",
    8: "voltar", 27: "voltar", 10009: "voltar", 461: "voltar"
  };

  document.addEventListener("keydown", function (e) {
    var acao = TECLAS[e.keyCode];
    if (!acao) return;

    if (!$("tela-aviso").hidden) {
      if (acao === "voltar" || acao === "ok") { e.preventDefault(); fecharTela(); }
      return;
    }
    if (!$("tela-player").hidden) {
      if (acao === "voltar") { e.preventDefault(); fecharTela(); }
      return;
    }
    if (acao === "ok") {
      if (focoAtual) { e.preventDefault(); focoAtual.click(); }
      return;
    }
    if (acao === "voltar") return;
    e.preventDefault();
    andar(acao);
  });

  // Se alguém usar mouse ou o dedo, o foco acompanha.
  document.addEventListener("focusin", function (e) {
    if (e.target.classList && e.target.classList.contains("cartao")) focoAtual = e.target;
  });

  // ---------- Telas por cima (vídeo e avisos) ----------
  // Cada tela aberta entra no histórico do navegador. Assim o botão Voltar
  // do controle fecha o vídeo em vez de sair do app.

  var telaAberta = null;
  var cartaoDeOrigem = null;

  function abrirTela(nome) {
    telaAberta = nome;
    $(nome).hidden = false;
    document.body.style.overflow = "hidden";
    history.pushState({ tela: nome }, "");
  }

  function fecharTela() {
    if (telaAberta) history.back(); // o popstate abaixo faz o resto
  }

  window.addEventListener("popstate", function () {
    if (!telaAberta) return;
    var nome = telaAberta;
    telaAberta = null;
    if (nome === "tela-player") pararVideo();
    $(nome).hidden = true;
    document.body.style.overflow = "";
    focar(cartaoDeOrigem);
  });

  function mostrarServico(video, classe) {
    cartaoDeOrigem = focoAtual;
    $("aviso-cartao").className = "aviso-cartao " + classe;
    $("aviso-selo").innerHTML = '<span class="selo">' + escapar(video.servico) + "</span>";
    $("aviso-titulo").textContent = video.titulo + " está no " + video.servico;
    $("aviso-texto").textContent =
      "Chame o papai ou a mamãe para abrir o aplicativo do " + video.servico + " na TV.";
    abrirTela("tela-aviso");
    $("aviso-voltar").focus();
  }

  function mostrarAvisoDeVideo() {
    // Troca o player pelo aviso sem mexer no histórico (o Voltar continua valendo).
    pararVideo();
    $("tela-player").hidden = true;
    telaAberta = "tela-aviso";
    $("aviso-cartao").className = "aviso-cartao";
    $("aviso-selo").innerHTML = "";
    $("aviso-titulo").textContent = "Esse vídeo não quis tocar aqui";
    $("aviso-texto").textContent =
      "O dono do vídeo não deixa ele passar fora do YouTube. Escolha outro, tá bom?";
    $("tela-aviso").hidden = false;
    $("aviso-voltar").focus();
  }

  $("aviso-voltar").addEventListener("click", fecharTela);

  // ---------- Player do YouTube ----------

  var player = null;
  var apiPronta = false;
  var esperando = null;
  var timerDica = null;

  function carregarApi() {
    if (window.YT && window.YT.Player) { apiPronta = true; return; }
    var s = document.createElement("script");
    s.src = "https://www.youtube.com/iframe_api";
    document.head.appendChild(s);
  }

  window.onYouTubeIframeAPIReady = function () {
    apiPronta = true;
    if (esperando) { var id = esperando; esperando = null; criarPlayer(id); }
  };

  function tocar(id, cartao) {
    cartaoDeOrigem = cartao;
    abrirTela("tela-player");
    telaCheia();

    var dica = $("dica-voltar");
    dica.className = "dica-voltar";
    clearTimeout(timerDica);
    timerDica = setTimeout(function () { dica.className = "dica-voltar sumiu"; }, 5000);

    if (apiPronta) criarPlayer(id);
    else esperando = id;
  }

  function criarPlayer(id) {
    if (telaAberta !== "tela-player") return;
    player = new YT.Player("player", {
      host: "https://www.youtube-nocookie.com",
      videoId: id,
      playerVars: {
        autoplay: 1,
        rel: 0,            // no fim, sugestões só do mesmo canal
        iv_load_policy: 3, // sem anotações por cima do vídeo
        playsinline: 1,
        fs: 0,
        disablekb: 0
      },
      events: {
        onReady: function (e) { e.target.playVideo(); },
        onStateChange: function (e) {
          // Acabou o vídeo: volta direto para a tela inicial,
          // antes do YouTube sugerir outros vídeos que você não escolheu.
          if (e.data === 0) fecharTela();
        },
        // 100: vídeo apagado; 101 e 150: o dono não deixa tocar fora do YouTube.
        onError: function () { mostrarAvisoDeVideo(); }
      }
    });
  }

  function pararVideo() {
    esperando = null;
    if (player && player.destroy) {
      try { player.destroy(); } catch (e) { /* já foi */ }
    }
    player = null;
    // O destroy troca o iframe pelo vazio; recria o lugar do próximo vídeo.
    if (!$("player")) {
      var div = document.createElement("div");
      div.id = "player";
      $("tela-player").insertBefore(div, $("dica-voltar"));
    }
  }

  function telaCheia() {
    var el = document.documentElement;
    var pedir = el.requestFullscreen || el.webkitRequestFullscreen;
    if (pedir && !document.fullscreenElement && !document.webkitFullscreenElement) {
      try {
        var r = pedir.call(el);
        if (r && r.catch) r.catch(function () {});
      } catch (e) { /* a TV não deixou; tudo bem */ }
    }
  }

  // ---------- Relógio do topo ----------

  function atualizarRelogio() {
    var agora = new Date();
    var h = agora.getHours();
    var m = agora.getMinutes();
    $("relogio").textContent = h + ":" + (m < 10 ? "0" : "") + m;
  }

  // ---------- Começo ----------

  function mostrarErro(html) {
    $("erro-texto").innerHTML = html;
    $("tela-erro").hidden = false;
  }

  if (window.ERRO_NA_LISTA) {
    mostrarErro(
      "O arquivo <code>videos.js</code> tem um problema perto da <b>linha " +
      window.ERRO_NA_LISTA.linha + "</b>.<br><br>" +
      "Confira na última linha que você mexeu: o título e o link estão entre aspas? " +
      "A linha termina com vírgula? Algum colchete ou chave ficou sem fechar?"
    );
    return;
  }
  if (typeof CANTINHO === "undefined") {
    mostrarErro("Não encontrei a lista de vídeos. O arquivo <code>videos.js</code> está na mesma pasta do app?");
    return;
  }

  montar(CANTINHO);
  carregarApi();
  atualizarRelogio();
  setInterval(atualizarRelogio, 15000);

  // Para os testes automáticos conseguirem conferir a leitura dos links.
  window.CantinhoTeste = { idDoYoutube: idDoYoutube };
})();
