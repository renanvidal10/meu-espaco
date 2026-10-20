'use strict';
// ===================== AUTENTICAÇÃO =====================
  // §85. A sessão vive num cookie HttpOnly que a página não enxerga: o
  // navegador manda sozinho em toda chamada à API. Antes o token ficava em
  // localStorage, ao alcance de qualquer script injetado.
  // Nome e CRM vêm da conta no servidor, não são mais digitados por sessão.
  let doctorName = '';
  let doctorCRM = '';
  let contaAtual = null;

  // O token antigo pode ter ficado guardado de uma versão anterior. Não serve
  // mais para nada e não deve ficar exposto.
  try { localStorage.removeItem('oncogenyx.session'); } catch (e) { /* modo privado */ }

  // Wrapper único de API: trata 401 num só lugar, para uma sessão expirada
  // nunca virar erro genérico no meio de um fluxo clínico.
  async function api(path, { method = 'GET', body, isForm = false } = {}) {
    const headers = {};
    if (body && !isForm) headers['Content-Type'] = 'application/json';

    let response;
    try {
      response = await fetch(path, {
        method,
        headers,
        credentials: 'same-origin',
        body: isForm ? body : (body ? JSON.stringify(body) : undefined),
      });
    } catch {
      // "Failed to fetch" é o que o navegador diz. Não é o que o médico
      // precisa ler num auditório com wi-fi ruim. Ver §46.2
      throw new Error('Sem conexão com o servidor. Verifique a internet e tente de novo.');
    }

    // 401 numa tentativa de entrar é "senha errada", e quem mostra é a própria
    // tela de entrada. Em qualquer outra chamada, é sessão vencida.
    const tentandoEntrar = path.startsWith('/api/auth/') && method !== 'GET';
    if (response.status === 401 && !tentandoEntrar) {
      contaAtual = null;
      fecharModaisDeConta();
      showGate();
      alertGate('Sua sessão terminou por segurança. Entre novamente.', 'success');
      throw new Error('Sua sessão expirou. Entre novamente.');
    }

    let payload = null;
    try {
      payload = await response.json();
    } catch {
      payload = null;
    }
    if (!response.ok) {
      // Leitura de laudo barrada pela conferência do CRM: a faixa no topo da
      // tela passa a explicar o motivo, além da mensagem do erro.
      if (response.status === 403 && payload && payload.crm) atualizarContaEmSegundoPlano();
      const erro = new Error((payload && payload.error) || 'Não foi possível completar a operação.');
      erro.dados = payload;
      erro.status = response.status;
      throw erro;
    }
    // Portal cativo de hotel responde HTML com status 200: sem esta guarda o
    // médico via "Cannot read properties of undefined" na caixa de erro.
    if (payload === null) {
      throw new Error('A resposta do servidor veio em formato inesperado. Isso costuma ser rede com portal de acesso: abra uma página qualquer no navegador, aceite a conexão e tente de novo.');
    }
    return payload;
  }

  function applyDoctorInfo() {
    document.getElementById('doctor-chip-text').textContent = `${doctorName} · CRM ${doctorCRM}`;
    const initials = doctorName.replace(/^Dra?\.\s*/i, '').trim().split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase();
    document.getElementById('doctor-chip-avatar').textContent = initials || 'MD';
    // Os documentos de solicitação são gerados na tela de programas e já
    // nascem com nome e CRM, só precisam ser refeitos se já existirem.
    if (typeof lastResult !== 'undefined' && lastResult) renderPrograms();
  }

  function showGate(view) {
    document.body.classList.add('gate-active');
    showView(view || (authMode === 'simples' ? 'acesso' : 'login'));
  }

  function showView(view) {
    document.querySelectorAll('.gate-view').forEach((el) => el.classList.remove('active'));
    const target = document.getElementById(`view-${view}`);
    if (target) target.classList.add('active');
    clearAlert();
    const firstInput = target && target.querySelector('input:not([type="checkbox"])');
    if (firstInput) setTimeout(() => firstInput.focus(), 40);
  }

  function alertGate(message, kind) {
    const box = document.getElementById('gate-alert');
    box.className = `gate-alert ${kind}`;
    box.textContent = message;
    box.style.display = '';
  }
  function clearAlert() {
    const box = document.getElementById('gate-alert');
    box.style.display = 'none';
    box.textContent = '';
  }

  function togglePw(inputId, btn) {
    const input = document.getElementById(inputId);
    const showing = input.type === 'text';
    input.type = showing ? 'password' : 'text';
    btn.setAttribute('aria-label', showing ? 'Mostrar senha' : 'Ocultar senha');
  }

  // Regra decidida pelo dono (§85.1, decisão 3), espelhada do servidor para o
  // médico ver cada exigência sendo cumprida enquanto digita. A palavra final
  // é sempre do servidor, que também recusa senhas comuns.
  const REGRAS_SENHA = {
    tamanho: (v) => v.length >= 8,
    maiuscula: (v) => /\p{Lu}/u.test(v),
    especial: (v) => /[^\p{L}\p{N}]/u.test(v),
  };

  function conferirRegras(inputId, listaId) {
    const valor = document.getElementById(inputId).value;
    let todas = true;
    document.querySelectorAll(`#${listaId} li`).forEach((li) => {
      const ok = REGRAS_SENHA[li.dataset.regra](valor);
      li.classList.toggle('ok', ok);
      todas = todas && ok;
    });
    return todas;
  }

  function busy(btnId, isBusy, busyLabel) {
    const btn = document.getElementById(btnId);
    if (isBusy) {
      btn.dataset.label = btn.textContent;
      btn.textContent = busyLabel;
      btn.disabled = true;
    } else {
      btn.textContent = btn.dataset.label || btn.textContent;
      btn.disabled = false;
    }
  }

  function quando(isoData) {
    if (!isoData) return '';
    const d = new Date(isoData);
    if (Number.isNaN(d.getTime())) return '';
    return d.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  }

  function quandoCurto(isoData) {
    const d = new Date(isoData);
    if (Number.isNaN(d.getTime())) return '';
    return d.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }).replace(',', ' às');
  }

  // Faixa no topo da tela enquanto a conferência do CRM não terminou.
  function atualizarAvisoCrm(user) {
    const faixa = document.getElementById('aviso-crm');
    const texto = document.getElementById('aviso-crm-texto');
    faixa.classList.remove('bloqueado');
    if (!user || !user.crmStatus || user.crmStatus === 'ativo') { faixa.hidden = true; return; }
    if (user.crmStatus === 'recusado') {
      texto.textContent = 'Não conseguimos confirmar seu CRM no CFM, e a leitura de laudos está bloqueada.';
      faixa.classList.add('bloqueado');
    } else if (user.crmLiberado) {
      texto.textContent = `Seu CRM está em conferência no CFM. O acesso está liberado até ${quandoCurto(user.liberadoAte)}.`;
    } else {
      texto.textContent = 'Seu CRM ainda está em conferência e a liberação de 48 horas terminou. A leitura de laudos volta quando a conferência for concluída.';
      faixa.classList.add('bloqueado');
    }
    faixa.hidden = false;
  }

  async function atualizarContaEmSegundoPlano() {
    try {
      const out = await api('/api/auth/me');
      contaAtual = out.user;
      atualizarAvisoCrm(contaAtual);
    } catch (e) { /* a faixa só some se a chamada der certo */ }
  }

  function enterApp(user) {
    contaAtual = user;
    doctorName = user.name;
    doctorCRM = user.crm;
    applyDoctorInfo();
    atualizarAvisoCrm(user);
    document.body.classList.remove('gate-active');
    refreshPlaudStatus();
    // Só depois de entrar: um modal por cima da tela de acesso seria um
    // obstáculo antes mesmo de o médico saber o que é a ferramenta.
    talvezMostrarBoasVindas();
    if (abrirConferenciaAoEntrar && user.admin) {
      abrirConferenciaAoEntrar = false;
      setTimeout(abrirConferencia, 300);
    }
  }

  // Modo de acesso vindo do servidor. Enquanto não é conhecido, a tela fica
  // no modo simples, que é o padrão, para não piscar entre dois formulários.
  let authMode = 'simples';

  async function doAcesso(event) {
    event.preventDefault();
    clearAlert();
    busy('acesso-submit', true, 'Entrando...');
    try {
      const out = await api('/api/auth/acesso', {
        method: 'POST',
        body: {
          name: document.getElementById('acesso-name').value,
          crm: document.getElementById('acesso-crm').value,
        },
      });
      enterApp(out.user);
    } catch (err) {
      alertGate(err.message, 'error');
    } finally {
      busy('acesso-submit', false);
    }
    return false;
  }

  // E-mail a que se refere a tela "Confira seu e-mail", para o reenvio.
  let emailAguardando = '';

  function mostrarEnviado(email, texto) {
    emailAguardando = email || '';
    document.getElementById('enviado-texto').textContent = texto;
    showView('enviado');
  }

  async function doLogin(event) {
    event.preventDefault();
    clearAlert();
    const crm = document.getElementById('login-crm').value.trim();
    const uf = document.getElementById('login-uf').value;
    const password = document.getElementById('login-password').value;
    if (!crm || !uf || !password) {
      alertGate('Informe o CRM, o estado e a senha.', 'error');
      return false;
    }
    busy('login-submit', true, 'Entrando...');
    try {
      const out = await api('/api/auth/login', { method: 'POST', body: { crm, uf, password } });
      lembrarCrm(crm, uf);
      document.getElementById('login-password').value = '';
      enterApp(out.user);
    } catch (err) {
      if (err.dados && err.dados.codigo === 'email_nao_confirmado') {
        mostrarEnviado(err.dados.email,
          `Falta confirmar o seu e-mail. Enviamos o link para ${err.dados.emailMascarado} no cadastro. Abra a mensagem e toque em "Confirmar meu e-mail".`);
      } else {
        alertGate(err.message, 'error');
      }
    } finally {
      busy('login-submit', false);
    }
    return false;
  }

  async function doRegister(event) {
    event.preventDefault();
    clearAlert();
    const campos = {
      name: document.getElementById('reg-name').value.trim(),
      crm: document.getElementById('reg-crm').value.trim(),
      uf: document.getElementById('reg-uf').value,
      email: document.getElementById('reg-email').value.trim(),
      password: document.getElementById('reg-password').value,
      aceite: document.getElementById('reg-aceite').checked,
    };
    // Conferência rápida antes de ir ao servidor, na ordem dos campos, para
    // o médico corrigir de cima para baixo.
    const falta = !campos.name ? 'Informe seu nome completo.'
      : !campos.crm ? 'Informe o número do CRM.'
      : !campos.uf ? 'Escolha o estado do seu CRM.'
      : !campos.email ? 'Informe o seu e-mail.'
      : !conferirRegras('reg-password', 'reg-regras') ? 'A senha ainda não cumpre as três exigências da lista.'
      : !campos.aceite ? 'Para criar a conta, marque o aceite dos Termos de Uso e do Aviso de Privacidade.'
      : '';
    if (falta) { alertGate(falta, 'error'); return false; }

    busy('reg-submit', true, 'Criando...');
    try {
      const out = await api('/api/auth/cadastro', { method: 'POST', body: campos });
      lembrarCrm(campos.crm, campos.uf);
      document.getElementById('reg-password').value = '';
      mostrarEnviado(out.email, out.message);
      // Sem provedor de e-mail (desenvolvimento), o servidor devolve o link
      // para o fluxo não travar. Em produção esse campo nunca vem.
      if (out.devUrl) console.info('[dev] Link de confirmação:', out.devUrl);
    } catch (err) {
      alertGate(err.message, 'error');
    } finally {
      busy('reg-submit', false);
    }
    return false;
  }

  async function reenviarConfirmacao() {
    clearAlert();
    if (!emailAguardando) {
      alertGate('Entre com CRM e senha para pedirmos um link novo.', 'error');
      return;
    }
    busy('enviado-reenviar', true, 'Enviando...');
    try {
      const out = await api('/api/auth/reenviar-confirmacao', { method: 'POST', body: { email: emailAguardando } });
      alertGate(out.message, 'success');
      if (out.devUrl) console.info('[dev] Link de confirmação:', out.devUrl);
    } catch (err) {
      alertGate(err.message, 'error');
    } finally {
      busy('enviado-reenviar', false);
    }
  }

  async function doForgot(event) {
    event.preventDefault();
    clearAlert();
    const email = document.getElementById('forgot-email').value.trim();
    if (!email) { alertGate('Informe o e-mail do seu cadastro.', 'error'); return false; }
    busy('forgot-submit', true, 'Enviando...');
    try {
      const out = await api('/api/auth/esqueci', { method: 'POST', body: { email } });
      showView('login');
      alertGate(out.message, 'success');
      if (out.devUrl) console.info('[dev] Link de nova senha:', out.devUrl);
    } catch (err) {
      alertGate(err.message, 'error');
    } finally {
      busy('forgot-submit', false);
    }
    return false;
  }

  async function doSetPassword(event) {
    event.preventDefault();
    clearAlert();
    const password = document.getElementById('set-password').value;
    if (!conferirRegras('set-password', 'set-regras')) {
      alertGate('A senha ainda não cumpre as três exigências da lista.', 'error');
      return false;
    }
    busy('set-submit', true, 'Salvando...');
    try {
      const out = await api('/api/auth/nova-senha', {
        method: 'POST',
        body: { token: pendingResetToken, password },
      });
      history.replaceState(null, '', location.pathname);
      pendingResetToken = '';
      document.getElementById('set-password').value = '';
      enterApp(out.user);
    } catch (err) {
      alertGate(err.message, 'error');
    } finally {
      busy('set-submit', false);
    }
    return false;
  }

  async function signOut() {
    try { await api('/api/auth/logout', { method: 'POST' }); } catch (e) { /* segue mesmo se falhar */ }
    location.reload();
  }

  // O CRM e a UF ficam lembrados neste aparelho para a próxima entrada. Não é
  // segredo (o CRM é público no portal do CFM) e poupa digitação no celular.
  const CRM_LEMBRADO_KEY = 'oncogenyx.crm';
  function lembrarCrm(crm, uf) {
    try { localStorage.setItem(CRM_LEMBRADO_KEY, JSON.stringify({ crm, uf })); } catch (e) { /* modo privado */ }
  }
  function preencherCrmLembrado() {
    try {
      const salvo = JSON.parse(localStorage.getItem(CRM_LEMBRADO_KEY) || 'null');
      if (salvo && salvo.crm) {
        document.getElementById('login-crm').value = salvo.crm;
        document.getElementById('login-uf').value = salvo.uf || '';
      }
    } catch (e) { /* nada lembrado */ }
  }

  function preencherUfs(ufs) {
    for (const id of ['login-uf', 'reg-uf', 'ct-in-uf']) {
      const sel = document.getElementById(id);
      if (!sel || sel.options.length > 1) continue;
      for (const uf of ufs) {
        const op = document.createElement('option');
        op.value = uf;
        op.textContent = uf;
        sel.appendChild(op);
      }
    }
  }

  let pendingResetToken = '';
  let abrirConferenciaAoEntrar = false;

  (async function initAuth() {
    const params = new URLSearchParams(location.search);

    // Aviso de conta temporária: mostrado só quando o servidor está de fato
    // sem banco persistente, para não virar texto decorativo permanente.
    try {
      const cfg = await fetch('/api/config').then((r) => r.json());
      authMode = cfg.authMode || 'simples';
      document.body.dataset.modoAcesso = authMode;
      if (cfg.ufs) preencherUfs(cfg.ufs);
      if (cfg.ephemeralAccounts) {
        if (authMode === 'completo') {
          document.getElementById('gate-beta-texto').textContent =
            'Esta instalação ainda não tem banco de dados permanente: as contas podem ser apagadas a cada atualização do site.';
        }
        document.getElementById('gate-beta-note').style.display = '';
      }
    } catch (e) { /* mantém o modo simples, que é o padrão do servidor */ }

    // Retorno do OAuth do Plaud, se houver.
    const plaudStatus = params.get('plaud');
    if (plaudStatus) {
      history.replaceState(null, '', location.pathname);
      setTimeout(() => reportPlaudReturn(plaudStatus), 400);
    }

    if (authMode === 'completo') {
      preencherCrmLembrado();

      // Link de nova senha vindo do e-mail.
      const nova = params.get('nova-senha');
      if (nova) {
        pendingResetToken = nova;
        history.replaceState(null, '', location.pathname);
        showGate('set');
        return;
      }

      // Link de confirmação vindo do e-mail: confirma e já entra.
      const confirmar = params.get('confirmar-email');
      if (confirmar) {
        history.replaceState(null, '', location.pathname);
        try {
          const out = await api('/api/auth/confirmar-email', { method: 'POST', body: { token: confirmar } });
          enterApp(out.user);
        } catch (err) {
          showGate('login');
          alertGate(err.message, 'error');
        }
        return;
      }

      // Aviso por e-mail ao administrador leva direto à conferência.
      if (params.get('conferencia')) {
        abrirConferenciaAoEntrar = true;
        history.replaceState(null, '', location.pathname);
      }
    }

    // Fetch direto, e não api(): quem abre o site sem sessão não "perdeu"
    // sessão nenhuma, e não deve ler o aviso de sessão terminada.
    try {
      const r = await fetch('/api/auth/me', { credentials: 'same-origin' });
      if (!r.ok) { showGate(); return; }
      enterApp((await r.json()).user);
    } catch (err) {
      showGate();
    }
  })();

  // ===================== SUBTIPO ONCOLÓGICO =====================
  // Tudo daqui pra frente é dirigido pelo registro em /tumors.js: campos da
  // revisão, motor de regra, tela de resultado, cards de programa e
  // documentos de solicitação. Acrescentar um tumor lá acrescenta a
  // especialidade inteira aqui, sem tocar nesta camada de renderização.
  const H = TUMORS.helpers;

  let currentSubtype = TUMORS.ORDER[0];
  let lastResult = null;

  function tumor() { return TUMORS.get(currentSubtype); }

  // Popula o seletor uma única vez, na ordem de prevalência definida no registro.
  // Chips de cobertura na tela 1, direto do registro: o médico vê de relance
  // se o caso dele está no escopo, sem ler um parágrafo.
  (function listarTumoresCobertos() {
    const el = document.getElementById('tumores-cobertos');
    if (!el) return;
    // Eram sete pílulas cinza, que o olho lê como filtro clicável, e não
    // são. A mesma informação numa linha de texto some como ruído e continua
    // respondendo "meu caso está no escopo?". §50
    const nomes = TUMORS.list().map((t) => t.short);
    el.textContent = nomes.slice(0, -1).join(', ') + ' e ' + nomes[nomes.length - 1] + '.';
  })();

  // ===================== BOAS-VINDAS =====================
  // Mostrado uma vez por navegador. Reabrir é sempre possível pelo link
  // "Como funciona", a explicação não some para quem quiser consultar.
  const BOAS_VINDAS_KEY = 'oncogenyx.boas-vindas.v1';
  let focoAntesDoModal = null;

  // ===================== ARMADILHA DE FOCO =====================
  // Os dois modais declaravam `aria-modal="true"` e não prendiam o foco: um
  // Tab a partir do botão do rodapé já saía para a página de trás, e
  // Shift+Tab a partir do botão de fechar caía direto num controle da tela 1.
  // Para leitor de tela e para teclado, a promessa de modalidade era falsa,
  // o usuário continuava navegando por um conteúdo que estava visualmente
  // bloqueado, sem nenhuma pista de que havia saído do diálogo.
  const FOCAVEIS = [
    'a[href]', 'button:not([disabled])', 'input:not([disabled])',
    'select:not([disabled])', 'textarea:not([disabled])', '[tabindex]:not([tabindex="-1"])',
  ].join(',');

  function focaveisDe(container) {
    return Array.from(container.querySelectorAll(FOCAVEIS))
      .filter((el) => el.offsetParent !== null || el === document.activeElement);
  }

  function prenderFoco(container, evento) {
    if (evento.key !== 'Tab') return;
    const itens = focaveisDe(container);
    if (!itens.length) {
      evento.preventDefault();
      return;
    }
    const primeiro = itens[0];
    const ultimo = itens[itens.length - 1];
    const atual = document.activeElement;

    // Recicla nas duas pontas. O `!container.contains(atual)` cobre o caso de
    // o foco já ter escapado por outro caminho (clique no fundo, por exemplo).
    if (evento.shiftKey && (atual === primeiro || !container.contains(atual))) {
      evento.preventDefault();
      ultimo.focus();
    } else if (!evento.shiftKey && (atual === ultimo || !container.contains(atual))) {
      evento.preventDefault();
      primeiro.focus();
    }
  }

  function ligarArmadilha(idDoModal) {
    const el = document.getElementById(idDoModal);
    el.addEventListener('keydown', (e) => {
      if (el.classList.contains('aberto')) prenderFoco(el, e);
    });
  }
  ligarArmadilha('boas-vindas');
  ligarArmadilha('privacidade');

  function abrirBoasVindas() {
    focoAntesDoModal = document.activeElement;
    document.getElementById('boas-vindas').classList.add('aberto');
    setTimeout(() => document.getElementById('bv-comecar').focus(), 60);
  }

  function fecharBoasVindas() {
    document.getElementById('boas-vindas').classList.remove('aberto');
    try { localStorage.setItem(BOAS_VINDAS_KEY, '1'); } catch (e) { /* modo privado */ }
    if (focoAntesDoModal && focoAntesDoModal.focus) focoAntesDoModal.focus();
  }

  // Clique no fundo e Esc fecham, um modal sem saída óbvia irrita mais do
  // que a informação que ele carrega.
  document.getElementById('boas-vindas').addEventListener('click', (e) => {
    if (e.target.id === 'boas-vindas') fecharBoasVindas();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && document.getElementById('boas-vindas').classList.contains('aberto')) {
      fecharBoasVindas();
    }
  });

  // Privacidade: aberto pelo link do passo 1 e pelo modal de boas-vindas.
  // Sempre disponível, não é aviso que aparece uma vez e some.
  let focoAntesDaPrivacidade = null;

  function abrirPrivacidade() {
    focoAntesDaPrivacidade = document.activeElement;
    document.getElementById('privacidade').classList.add('aberto');
    setTimeout(() => document.getElementById('pv-fechar').focus(), 60);
  }

  function fecharPrivacidade() {
    document.getElementById('privacidade').classList.remove('aberto');
    if (focoAntesDaPrivacidade && focoAntesDaPrivacidade.focus) focoAntesDaPrivacidade.focus();
  }

  document.getElementById('privacidade').addEventListener('click', (e) => {
    if (e.target.id === 'privacidade') fecharPrivacidade();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && document.getElementById('privacidade').classList.contains('aberto')) {
      fecharPrivacidade();
    }
  });

  /* ===================== MINHA CONTA E CONFERÊNCIA DE CRM (§85) ===================== */

  ligarArmadilha('conta');
  ligarArmadilha('conferencia');

  const NOMES_DE_EVENTO = {
    login_ok: 'Entrada',
    login_falha: 'Tentativa com senha errada',
    logout: 'Saída',
    cadastro: 'Conta criada',
    cadastro_repetido: 'Tentativa de criar outra conta com seus dados',
    email_confirmado: 'E-mail confirmado',
    senha_trocada: 'Senha trocada',
    senha_redefinida: 'Senha nova criada pelo link do e-mail',
    senha_desativada: 'Senha bloqueada por excesso de tentativas',
    sessoes_encerradas: 'Saiu de todos os aparelhos',
    perfil_alterado: 'Nome ou CRM corrigido',
    crm_conferido: 'CRM conferido',
    crm_recusado: 'CRM não confirmado',
    admin_acao: 'Conferência de CRM feita por você',
    plaud_conectado: 'Plaud conectado',
    plaud_desconectado: 'Plaud desconectado',
  };

  const SITUACOES_CRM = {
    ativo: { rotulo: 'Conferido', classe: 'ok' },
    pendente: { rotulo: 'Em conferência', classe: 'warn' },
    recusado: { rotulo: 'Não confirmado', classe: 'alerta' },
  };

  let focoAntesDaConta = null;

  function alertaConta(id, mensagem, tipo) {
    const box = document.getElementById(id);
    if (!mensagem) { box.hidden = true; box.textContent = ''; return; }
    box.className = `conta-alerta ${tipo || 'success'}`;
    box.textContent = mensagem;
    box.hidden = false;
  }

  function preencherConta(dados) {
    const u = dados.user;
    contaAtual = u;
    document.getElementById('ct-nome').textContent = u.name;
    document.getElementById('ct-crm').textContent = u.crm;
    document.getElementById('ct-email').textContent = u.email || '';

    const sit = SITUACOES_CRM[u.crmStatus];
    const selo = document.getElementById('ct-situacao');
    selo.textContent = sit ? sit.rotulo : '';
    selo.className = `selo ${sit ? sit.classe : ''}`;
    const nota = document.getElementById('ct-situacao-nota');
    if (u.crmStatus === 'pendente') {
      nota.textContent = u.crmLiberado
        ? `Conferimos cada cadastro no portal do Conselho Federal de Medicina. Até lá, o acesso está liberado até ${quando(u.liberadoAte)}, e você recebe um e-mail quando terminar.`
        : 'A liberação provisória de 48 horas terminou. A leitura de laudos volta assim que a conferência for concluída, e você recebe um e-mail.';
      nota.hidden = false;
    } else if (u.crmStatus === 'recusado') {
      nota.textContent = 'Não encontramos um registro ativo com este nome e este CRM no portal do CFM. Se houve erro de digitação, corrija abaixo e a conferência é feita de novo.';
      nota.hidden = false;
    } else {
      nota.hidden = true;
    }

    document.getElementById('ct-in-nome').value = u.name;
    if (u.crmUf) {
      document.getElementById('ct-in-crm').value = u.crmNumero;
      document.getElementById('ct-in-uf').value = u.crmUf;
    } else {
      document.getElementById('ct-in-crm-livre').value = u.crm;
    }

    const sessoes = document.getElementById('ct-sessoes');
    sessoes.innerHTML = (dados.sessoes || []).map((s) => `
      <li><span class="conta-lista-titulo">${esc(s.agente || 'Aparelho sem identificação')}${s.atual ? ' <span class="selo ok">este aparelho</span>' : ''}</span>
        <span class="conta-lista-apoio">Último uso em ${esc(quando(s.ultimoUso || s.criadaEm))}</span></li>`).join('')
      || '<li><span class="conta-lista-apoio">Nenhuma outra entrada aberta.</span></li>';

    const acessos = document.getElementById('ct-acessos');
    acessos.innerHTML = (dados.acessos || []).map((e) => `
      <li><span class="conta-lista-titulo${e.tipo === 'login_falha' || e.tipo === 'senha_desativada' ? ' atencao' : ''}">${esc(NOMES_DE_EVENTO[e.tipo] || e.tipo)}</span>
        <span class="conta-lista-apoio">${esc(quando(e.em))}${e.agente ? ' · ' + esc(e.agente) : ''}${e.ip ? ' · ' + esc(e.ip) : ''}</span></li>`).join('')
      || '<li><span class="conta-lista-apoio">Nenhum acesso registrado ainda.</span></li>';

    document.getElementById('ct-admin').hidden = !u.admin;
    if (u.admin) contarPendentes();
  }

  async function abrirConta() {
    focoAntesDaConta = document.activeElement;
    alertaConta('ct-alerta', '');
    document.querySelectorAll('#conta details').forEach((d) => { d.open = false; });
    const painel = document.getElementById('conta');
    painel.classList.add('aberto');
    setTimeout(() => painel.querySelector('.modal-x').focus(), 60);
    try {
      preencherConta(await api('/api/auth/conta'));
    } catch (err) {
      alertaConta('ct-alerta', err.message, 'error');
    }
  }

  function fecharConta() {
    document.getElementById('conta').classList.remove('aberto');
    ['ct-senha-atual', 'ct-senha-nova', 'ct-excluir-senha'].forEach((id) => { document.getElementById(id).value = ''; });
    if (focoAntesDaConta && focoAntesDaConta.focus) focoAntesDaConta.focus();
  }

  function fecharModaisDeConta() {
    document.getElementById('conta').classList.remove('aberto');
    document.getElementById('conferencia').classList.remove('aberto');
  }

  async function salvarPerfil(event) {
    event.preventDefault();
    const corpo = { name: document.getElementById('ct-in-nome').value.trim() };
    if (contaAtual && contaAtual.crmUf) {
      corpo.crm = document.getElementById('ct-in-crm').value.trim();
      corpo.uf = document.getElementById('ct-in-uf').value;
    } else {
      corpo.crm = document.getElementById('ct-in-crm-livre').value.trim();
    }
    const situacaoAntes = contaAtual ? contaAtual.crmStatus : null;
    busy('ct-salvar', true, 'Salvando...');
    try {
      const out = await api('/api/auth/me', { method: 'PATCH', body: corpo });
      enterAppSemBoasVindas(out.user);
      preencherConta(await api('/api/auth/conta'));
      document.getElementById('ct-editar').open = false;
      const voltouParaConferencia = situacaoAntes && situacaoAntes !== 'pendente' && out.user.crmStatus === 'pendente';
      alertaConta('ct-alerta', voltouParaConferencia
        ? 'Dados salvos. Como o nome ou o CRM mudou, a conferência é feita de novo. Você continua usando normalmente por 48 horas.'
        : 'Dados salvos.', 'success');
    } catch (err) {
      alertaConta('ct-alerta', err.message, 'error');
    } finally {
      busy('ct-salvar', false);
    }
    return false;
  }

  // Atualiza o chip e a faixa sem repetir o modal de boas-vindas.
  function enterAppSemBoasVindas(user) {
    contaAtual = user;
    doctorName = user.name;
    doctorCRM = user.crm;
    applyDoctorInfo();
    atualizarAvisoCrm(user);
  }

  async function trocarSenha(event) {
    event.preventDefault();
    const atual = document.getElementById('ct-senha-atual').value;
    const nova = document.getElementById('ct-senha-nova').value;
    if (!atual) { alertaConta('ct-alerta', 'Digite a senha atual.', 'error'); return false; }
    if (!conferirRegras('ct-senha-nova', 'ct-regras')) {
      alertaConta('ct-alerta', 'A nova senha ainda não cumpre as três exigências da lista.', 'error');
      return false;
    }
    busy('ct-senha-salvar', true, 'Trocando...');
    try {
      await api('/api/auth/trocar-senha', { method: 'POST', body: { atual, nova } });
      document.getElementById('ct-senha-atual').value = '';
      document.getElementById('ct-senha-nova').value = '';
      document.getElementById('ct-senha').open = false;
      preencherConta(await api('/api/auth/conta'));
      alertaConta('ct-alerta', 'Senha trocada. As entradas abertas em outros aparelhos foram encerradas, e mandamos um aviso para o seu e-mail.', 'success');
    } catch (err) {
      alertaConta('ct-alerta', err.message, 'error');
    } finally {
      busy('ct-senha-salvar', false);
    }
    return false;
  }

  async function sairDeTodos() {
    if (!confirm('Sair de todos os aparelhos, inclusive deste? Você vai precisar entrar de novo.')) return;
    try { await api('/api/auth/sair-de-todos', { method: 'POST' }); } catch (e) { /* recarrega de qualquer jeito */ }
    location.reload();
  }

  function baixarMeusDados() {
    // O servidor responde como anexo: o navegador baixa sem sair da página.
    const a = document.createElement('a');
    a.href = '/api/auth/meus-dados';
    a.download = 'meus-dados-oncogenyx.json';
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  async function excluirConta(event) {
    event.preventDefault();
    const password = document.getElementById('ct-excluir-senha').value;
    if (contaAtual && contaAtual.crmUf && !password) {
      alertaConta('ct-alerta', 'Digite sua senha para confirmar a exclusão.', 'error');
      return false;
    }
    if (!confirm('Excluir a conta de vez? Não há como desfazer.')) return false;
    busy('ct-excluir-btn', true, 'Excluindo...');
    try {
      await api('/api/auth/conta', { method: 'DELETE', body: { password } });
      try { localStorage.removeItem(CRM_LEMBRADO_KEY); } catch (e) { /* modo privado */ }
      location.reload();
    } catch (err) {
      alertaConta('ct-alerta', err.message, 'error');
      busy('ct-excluir-btn', false);
    }
    return false;
  }

  document.getElementById('conta').addEventListener('click', (e) => {
    if (e.target.id === 'conta') fecharConta();
  });

  /* ---------- conferência de CRM (só administrador) ---------- */

  const PORTAL_CFM = 'https://portal.cfm.org.br/busca-medicos/';

  async function contarPendentes() {
    try {
      const out = await api('/api/admin/conferencias');
      const n = out.pendentes.length;
      document.getElementById('ct-admin-n').textContent = n ? String(n) : '';
    } catch (e) { /* o contador é só um atalho */ }
  }

  function cartaoDeConferencia(c) {
    const prazo = c.liberadoAte && new Date(c.liberadoAte) > new Date()
      ? `liberação provisória até ${quando(c.liberadoAte)}`
      : 'liberação provisória terminou';
    return `
      <li class="conferencia-item" data-id="${esc(c.id)}">
        <div class="conferencia-quem">
          <strong>${esc(c.name)}</strong>
          <span class="conferencia-crm">CRM ${esc(c.crm)}/${esc(c.uf)}</span>
          <span class="conta-lista-apoio">${esc(c.email)} · cadastro em ${esc(quando(c.criadaEm))} · ${esc(prazo)}</span>
        </div>
        <div class="conferencia-acoes">
          <a class="linklike" href="${PORTAL_CFM}" target="_blank" rel="noopener noreferrer">Abrir o portal do CFM</a>
          <button class="ghost compacto" type="button" onclick="decidirCrm('${esc(c.id)}', 'recusado')">Não confere</button>
          <button class="primary compacto" type="button" onclick="decidirCrm('${esc(c.id)}', 'ativo')">Conferido</button>
        </div>
      </li>`;
  }

  async function carregarConferencia() {
    try {
      const out = await api('/api/admin/conferencias');
      document.getElementById('cf-pendentes').innerHTML = out.pendentes.map(cartaoDeConferencia).join('')
        || '<li class="conferencia-vazia">Nenhum CRM aguardando conferência.</li>';
      document.getElementById('cf-decididas').innerHTML = out.decididas.map((c) => `
        <li><span class="conta-lista-titulo">${esc(c.name)} · CRM ${esc(c.crm)}/${esc(c.uf)}
          <span class="selo ${c.status === 'ativo' ? 'ok' : 'alerta'}">${c.status === 'ativo' ? 'Conferido' : 'Não confirmado'}</span></span>
          <span class="conta-lista-apoio">${esc(quando(c.conferidoEm))}</span></li>`).join('')
        || '<li><span class="conta-lista-apoio">Nada conferido ainda.</span></li>';
      document.getElementById('ct-admin-n').textContent = out.pendentes.length ? String(out.pendentes.length) : '';
    } catch (err) {
      alertaConta('cf-alerta', err.message, 'error');
    }
  }

  let focoAntesDaConferencia = null;

  function abrirConferencia() {
    focoAntesDaConferencia = document.activeElement;
    alertaConta('cf-alerta', '');
    document.getElementById('conta').classList.remove('aberto');
    const painel = document.getElementById('conferencia');
    painel.classList.add('aberto');
    setTimeout(() => painel.querySelector('.modal-x').focus(), 60);
    carregarConferencia();
  }

  function fecharConferencia() {
    document.getElementById('conferencia').classList.remove('aberto');
    if (focoAntesDaConferencia && focoAntesDaConferencia.focus) focoAntesDaConferencia.focus();
  }

  async function decidirCrm(id, decisao) {
    const item = document.querySelector(`.conferencia-item[data-id="${id}"]`);
    const nome = item ? item.querySelector('strong').textContent : '';
    if (decisao === 'recusado' && !confirm(`Marcar que o CRM de ${nome} não confere? A leitura de laudos fica bloqueada para essa conta e o médico recebe um e-mail explicando como corrigir.`)) return;
    try {
      await api(`/api/admin/conferencias/${encodeURIComponent(id)}`, { method: 'POST', body: { decisao } });
      alertaConta('cf-alerta', decisao === 'ativo'
        ? `${nome}: CRM conferido. O médico recebe um e-mail avisando.`
        : `${nome}: marcado como não confirmado. O médico recebe um e-mail explicando como corrigir.`, 'success');
      carregarConferencia();
    } catch (err) {
      alertaConta('cf-alerta', err.message, 'error');
    }
  }

  document.getElementById('conferencia').addEventListener('click', (e) => {
    if (e.target.id === 'conferencia') fecharConferencia();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (document.getElementById('conferencia').classList.contains('aberto')) fecharConferencia();
    else if (document.getElementById('conta').classList.contains('aberto')) fecharConta();
  });

  /* ===================== INSTALAR O APLICATIVO (§65) =====================
   *
   * Dois mundos diferentes, e é por isso que não dá para ter um botão só:
   *
   * - ANDROID/CHROME dispara `beforeinstallprompt`. Guardando o evento, o
   *   botão instala de verdade, com a caixa de confirmação do sistema.
   * - iPHONE não tem API nenhuma. Nunca teve. O único caminho é o médico
   *   abrir o compartilhar do Safari e escolher "Adicionar à Tela de Início".
   *   Então, no iOS, o passo a passo NÃO é documentação de apoio: é o
   *   mecanismo inteiro.
   *
   * O botão some quando instalar não é possível, já instalado, ou navegador
   * sem suporte. Botão que não faz nada ensina a desconfiar da barra toda. */
  let promptDeInstalacao = null;
  let focoAntesDoInstalar = null;

  function ehIOS() {
    const ua = navigator.userAgent || '';
    // iPad moderno se anuncia como Mac; o toque é o que o distingue.
    return /iPad|iPhone|iPod/.test(ua)
      || (/Macintosh/.test(ua) && typeof document.ontouchend !== 'undefined');
  }

  function ehAndroid() { return /Android/.test(navigator.userAgent || ''); }

  /* §77. Navegador embutido em outro aplicativo.
   *
   * É o modo de falhar que nunca chega como reclamação: o médico recebe o
   * link por WhatsApp ou LinkedIn, abre DENTRO do aplicativo de mensagem, e
   * aquele navegador não instala nada, não tem a API do Android nem o
   * "Adicionar à Tela de Início" do Safari. Sem aviso, o passo a passo manda
   * procurar um botão que ali não existe, e a conclusão do médico é que a
   * plataforma está quebrada.
   *
   * Detecta-se o que é detectável e diz-se só o que se sabe. Facebook,
   * Instagram, LinkedIn e Line se identificam na assinatura do navegador; a
   * webview genérica do Android traz " wv". O navegador interno do WhatsApp
   * no iPhone não se distingue com segurança, por isso o aviso é redigido
   * para servir a qualquer aplicativo, sem citar nome nenhum. */
  function navegadorEmbutido() {
    const ua = navigator.userAgent || '';
    if (/FBAN|FBAV|FB_IAB|Instagram|LinkedInApp|Line\//i.test(ua)) return true;
    if (/Android/.test(ua) && /;\s*wv\)/.test(ua)) return true;
    return false;
  }

  function aparelhoProvavel() {
    if (ehIOS()) return 'ios';
    if (ehAndroid()) return 'android';
    return 'computador';
  }

  function atualizarBotaoInstalar() {
    const btn = document.getElementById('instalar-btn');
    if (!btn) return;
    // Já instalado: não há o que oferecer.
    if (modoAplicativo()) { btn.hidden = true; return; }
    /* Quem mostra o botão:
     * - o evento do Chrome (Android e computador), que instala de verdade;
     * - o iPhone, sempre, porque lá o caminho é manual e o passo a passo É o
     *   mecanismo;
     * - o navegador embutido, porque ali o botão não instala, mas é o único
     *   lugar onde cabe explicar por que não instala e o que fazer. */
    btn.hidden = !(promptDeInstalacao || ehIOS() || navegadorEmbutido());
  }

  window.addEventListener('beforeinstallprompt', (e) => {
    // Sem isto o Chrome mostra a própria barra, fora do desenho do produto.
    e.preventDefault();
    promptDeInstalacao = e;
    atualizarBotaoInstalar();
  });

  window.addEventListener('appinstalled', () => {
    promptDeInstalacao = null;
    atualizarBotaoInstalar();
    fecharInstalar();
  });

  function abrirInstalar() {
    focoAntesDoInstalar = document.activeElement;
    // Abre já na aba do aparelho de quem está olhando.
    mostrarPassos(aparelhoProvavel());

    // §77. Quem já instalou não precisa de passo a passo de instalação.
    const jaInstalado = modoAplicativo();
    const pronto = document.getElementById('inst-pronto');
    const abas = document.getElementById('inst-abas');
    const duvidas = document.getElementById('inst-duvidas');
    if (pronto) pronto.hidden = !jaInstalado;
    if (abas) abas.hidden = jaInstalado;
    if (duvidas) duvidas.hidden = jaInstalado;
    // A linha de apoio vende a instalação ("abre em tela cheia, sem barra de
    // navegador"). Para quem já instalou, é propaganda do que ele já tem.
    const apoio = document.querySelector('#instalar .modal-sub');
    if (apoio) apoio.hidden = jaInstalado;
    /* Escopo no modal de instalação, não na página. `.modal-passos` também
     * monta os passos do modal de privacidade e o das boas-vindas: um
     * seletor solto apagava os dois de uma vez, e o estrago só apareceria
     * para quem abrisse "Como funciona" depois de instalar o app. */
    document.querySelectorAll('#instalar .modal-passos').forEach((el) => { if (jaInstalado) el.hidden = true; });

    const embutido = !jaInstalado && navegadorEmbutido();
    const aviso = document.getElementById('inst-embutido');
    if (aviso) aviso.hidden = !embutido;
    if (embutido) {
      // O rótulo do menu muda entre os sistemas; dizer o nome certo evita o
      // médico procurar uma opção que no aparelho dele tem outro nome.
      const acao = document.getElementById('inst-embutido-acao');
      if (acao) acao.textContent = ehIOS() ? 'Abrir no Safari' : 'Abrir no navegador';
    }

    const instalarAgoraBtn = document.getElementById('inst-instalar');
    if (instalarAgoraBtn) instalarAgoraBtn.hidden = !promptDeInstalacao || jaInstalado;
    const painel = document.getElementById('instalar');
    painel.classList.add('aberto');
    setTimeout(() => {
      const alvo = document.getElementById(promptDeInstalacao && !jaInstalado ? 'inst-instalar' : 'inst-fechar');
      /* §77. `focus()` rola o elemento para a vista, e "Fechar" mora no pé do
       * modal: quem abria sem botão de instalar, justamente o iPhone e o
       * navegador embutido, chegava com o painel já rolado até embaixo, com
       * o passo 1 e o aviso de bloqueio fora da tela. O foco é posto sem
       * rolagem, e o painel volta ao topo. */
      if (alvo) {
        try { alvo.focus({ preventScroll: true }); } catch { alvo.focus(); }
      }
      const caixa = painel.querySelector('.modal');
      if (caixa) caixa.scrollTop = 0;
      painel.scrollTop = 0;
    }, 60);
  }

  function fecharInstalar() {
    document.getElementById('instalar').classList.remove('aberto');
    if (focoAntesDoInstalar && focoAntesDoInstalar.focus) focoAntesDoInstalar.focus();
  }

  function mostrarPassos(sistema) {
    for (const nome of ['ios', 'android', 'computador']) {
      const painel = document.getElementById('passos-' + nome);
      const aba = document.getElementById('aba-' + nome);
      if (painel) painel.hidden = nome !== sistema;
      if (aba) {
        aba.setAttribute('aria-selected', String(nome === sistema));
        aba.classList.toggle('ativa', nome === sistema);
      }
    }
  }

  async function instalarAgora() {
    if (!promptDeInstalacao) return;
    const evento = promptDeInstalacao;
    // O evento só serve UMA vez: zerar antes evita um segundo clique chamar
    // um prompt já consumido, que o Chrome rejeita com erro no console.
    promptDeInstalacao = null;
    document.getElementById('inst-instalar').hidden = true;
    try { await evento.prompt(); } catch (e) { /* recusado pelo usuário */ }
    atualizarBotaoInstalar();
  }

  document.getElementById('instalar').addEventListener('click', (e) => {
    if (e.target.id === 'instalar') fecharInstalar();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && document.getElementById('instalar').classList.contains('aberto')) {
      fecharInstalar();
    }
  });
  atualizarBotaoInstalar();

  function talvezMostrarBoasVindas() {
    let visto = false;
    try { visto = localStorage.getItem(BOAS_VINDAS_KEY) === '1'; } catch (e) { visto = false; }
    if (!visto) abrirBoasVindas();
  }

  (function fillSubtypeSelect() {
    const select = document.getElementById('field-subtipo');
    select.innerHTML = TUMORS.list()
      .map((t) => `<option value="${t.id}">${t.label}</option>`)
      .join('');
  })();

  // Troca a especialidade ativa. `manual: true` significa que o médico
  // corrigiu a identificação automática, nesse caso a justificativa da IA
  // deixa de valer e os campos são remontados vazios para o novo subtipo.
  function setSubtype(id, { manual = false } = {}) {
    if (!TUMORS.get(id)) return;
    currentSubtype = id;
    document.getElementById('field-subtipo').value = id;

    const t = tumor();
    document.getElementById('fields-hint').textContent = t.hint || '';
    [1, 2, 3].forEach((i) => {
      const el = document.getElementById('eyebrow-' + i);
      // A barra de passos, logo acima, já diz em que passo o médico está.
      // Repetir "passo 2 de 4" aqui é ruído; o que o sobretítulo acrescenta
      // é o tumor identificado.
      if (el) el.textContent = t.short;
    });

    if (manual) {
      document.getElementById('tipo-tumor-justificativa').style.display = 'none';
      // Idade, histórico familiar e testes prévios são os mesmos nos sete
      // tumores: apagá-los ao corrigir o subtipo fazia a triagem seguinte cair
      // em "dados insuficientes" logo depois do médico ter CORRIGIDO o app.
      // O que não sobrevive é o que pertence ao tumor antigo. Ver §46.3
      const preservados = {};
      TUMORS.CHAVES_COMUNS.forEach((chave) => {
        const campo = document.getElementById('f-' + chave);
        if (campo && String(campo.value || '').trim()) preservados[chave] = campo.value;
      });
      renderFields(preservados);
    }
  }

  // Monta os campos da revisão a partir da definição do tumor ativo.
  // Campo com lista fechada vira <select>; campo livre vira <input>.
  // Campo com `justify` ganha embaixo a linha explicando a inferência da IA.
  function renderFields(values) {
    const grid = document.getElementById('fields-dynamic');
    const t = tumor();
    grid.innerHTML = '';

    t.fields.forEach((field) => {
      const wrap = document.createElement('div');
      wrap.className = 'field' + (field.full ? ' full' : '');

      const label = document.createElement('label');
      label.textContent = field.label;
      label.setAttribute('for', 'f-' + field.key);
      wrap.appendChild(label);

      const value = (values && values[field.key]) || '';
      let input;
      if (field.options) {
        input = document.createElement('select');
        input.innerHTML = ['<option value="">Não informado</option>']
          .concat(field.options.map((o) => `<option value="${o}">${o}</option>`))
          .join('');
        // Valor extraído que não bate exatamente com a lista vira opção
        // própria em vez de sumir, melhor mostrar o que a IA leu.
        if (value && !field.options.includes(value)) {
          // API de DOM em vez de HTML: o valor vem da saída do modelo e
          // interpolado cru permitia injetar atributo no <option>.
          const extra = document.createElement('option');
          extra.value = value;
          extra.textContent = value;
          input.appendChild(extra);
        }
      } else {
        input = document.createElement('input');
        input.type = 'text';
        input.placeholder = field.placeholder || '';
      }
      input.className = 'value editable';
      input.id = 'f-' + field.key;
      input.value = value;
      // Amarelo só em campo que muda o resultado. Pintar todo campo vazio de
      // alerta transforma "opcional" em "erro" e treina o médico a ignorar
      // o aviso, inclusive quando ele importa.
      input.classList.toggle('missing', Boolean(field.decisivo) && !value);
      input.addEventListener('input', onFieldInput);
      input.addEventListener('change', onFieldInput);
      wrap.appendChild(input);

      if (field.justify) {
        const hint = document.createElement('p');
        hint.className = 'hint';
        hint.id = 'j-' + field.key;
        hint.style.marginTop = '6px';
        const justification = (values && values[field.justify]) || '';
        hint.textContent = justification ? 'Inferido pela leitura: ' + justification : '';
        hint.style.display = justification ? '' : 'none';
        wrap.appendChild(hint);
      }

      grid.appendChild(wrap);
    });

    applyRelevance();
  }

  function onFieldInput(event) {
    const field = tumor().fields.find((f) => 'f-' + f.key === event.target.id);
    event.target.classList.toggle('missing', Boolean(field && field.decisivo) && !event.target.value.trim());
    applyRelevance();
  }

  // Lê o estado atual do formulário como o objeto que o motor de regra espera.
  function readFields() {
    const values = {};
    tumor().fields.forEach((field) => {
      const el = document.getElementById('f-' + field.key);
      values[field.key] = el ? el.value.trim() : '';
    });
    return values;
  }

  // Alguns tumores só precisam de certos campos dependendo do que já foi
  // preenchido (em ovário, grau e estágio só mudam o resultado para
  // histologia serosa/endometrioide). Marcar de amarelo um campo que não
  // muda a resposta seria pedir dado à toa.
  function applyRelevance() {
    const t = tumor();
    if (typeof t.relevance !== 'function') return;
    const relevance = t.relevance(readFields()) || {};
    t.fields.forEach((field) => {
      if (!(field.key in relevance)) return;
      const el = document.getElementById('f-' + field.key);
      if (!el) return;
      const relevante = relevance[field.key];
      el.classList.toggle('missing', relevante && !el.value.trim());
      if (el.tagName === 'INPUT') {
        el.placeholder = relevante ? (field.placeholder || '') : 'Não se aplica a este perfil';
      }
    });
  }

  // Código do caso: identificador de sessão, não é o nome do paciente.
  // Prefixo neutro (não mais "GYN-"), o subtipo só é conhecido depois da
  // extração, então o código do caso não pode presumir qual é.
  const caseCode = 'CASO-' + String(Math.floor(1000 + Math.random() * 9000));
  document.querySelectorAll('#case-code-1, #case-code-2, #case-code-3').forEach((el) => { el.textContent = caseCode; });

  // Extração real: envia texto + arquivos (PDF/foto) para o backend, que usa a
  // API da Anthropic com saída estruturada (Camada 3 real, não regex). A
  // própria extração identifica o subtipo oncológico (tipo_tumor no
  // retorno), não é mais escolhido manualmente antes de enviar.
  async function extractCase(text) {
    const formData = new FormData();
    formData.append('text', text || '');
    pdfFiles.forEach((f) => formData.append('files', f));
    photoFiles.forEach((f) => formData.append('files', f));

    const body = await api('/api/extract', { method: 'POST', body: formData, isForm: true });
    return { extracted: body.extracted, avisos: body.avisos || [] };
  }

  function currentSources() {
    const sources = [];
    pdfFiles.forEach((f) => sources.push('Laudo em PDF: ' + f.name));
    photoFiles.forEach((f) => sources.push('Foto do laudo: ' + f.name));
    if (document.getElementById('case-text').value.trim()) sources.push('Texto ou transcrição colada');
    if (recSeconds > 0) sources.push('Ditado por voz (' + document.getElementById('voice-time').textContent + ')');
    return sources;
  }

  function renderSources() {
    const sourcesGrid = document.getElementById('sources-grid');
    const sources = currentSources();
    // esc() obrigatório: `title` carrega o NOME DO ARQUIVO anexado, escolhido
    // por quem enviou o laudo ao médico. Sem escape, um nome como
    // laudo<img src=x onerror=...> executa script na origem do app e lê o
    // token de sessão do localStorage.
    sourcesGrid.innerHTML = (sources.length ? sources : ['Nenhuma fonte informada ainda'])
      .map((title) => `<div class="field"><label>Origem</label><div class="value">${esc(title)}</div></div>`)
      .join('');
  }

  // Nome do paciente extraído do material anexado (PDF/foto), se identificável.
  // Nunca é mostrado nas telas de revisão/triagem, só pré-preenche o campo
  // isolado da tela final de solicitação (ver renderDocs()).
  let extractedPatientName = '';

  async function runExtraction() {
    const text = document.getElementById('case-text').value.trim();
    const errorBox = document.getElementById('extract-error');
    const btn = document.getElementById('btn-extract');

    if (!text && !pdfFiles.length && !photoFiles.length) {
      errorBox.textContent = 'Descreva o caso em texto ou anexe ao menos um arquivo antes de estruturar.';
      errorBox.style.display = '';
      return;
    }

    errorBox.style.display = 'none';
    btn.disabled = true;
    const originalLabel = btn.textContent;
    btn.textContent = 'Lendo caso com IA...';
    // §67. O esqueleto entra junto com o rótulo e sai junto com ele.
    document.body.classList.add('lendo-caso');

    try {
      const { extracted, avisos } = await extractCase(text);
      mostrarAvisos(avisos);
      extractedPatientName = (extracted.nome_paciente || '').trim();

      // O subtipo vem da própria leitura do material. Se não deu para
      // determinar, não adianta abrir a revisão: os campos seriam de um
      // tumor arbitrário e a triagem sairia errada.
      const detected = TUMORS.list().find((t) => t.label === extracted.tipo_tumor);
      if (!detected) {
        errorBox.textContent = 'Não consegui identificar o subtipo oncológico a partir do que foi descrito ou anexado. Descreva de forma mais específica (o órgão de origem, a histologia, o estadiamento ou um marcador do laudo) e tente de novo.';
        errorBox.style.display = '';
        return;
      }

      setSubtype(detected.id);

      // A justificativa não é enfeite: é o indicador de confiança da leitura.
      // Medido contra a API real, em toda extração CORRETA o modelo explicou
      // por que identificou aquele subtipo; em TODA falha, tanto o abandono
      // (tudo vazio) quanto a troca de ovário por endométrio, ela veio
      // vazia. É um sinal que cobre os dois modos de falha, custa zero
      // chamada extra, e o único jeito de errar para o lado seguro é pedir
      // confirmação. Ver ARQUITETURA.md §33.5.
      const tipoJustEl = document.getElementById('tipo-tumor-justificativa');
      const campoSubtipo = document.getElementById('field-subtipo');
      const semJustificativa = !String(extracted.tipo_tumor_justificativa || '').trim();

      // Conflito de sítio conferido pelo servidor no texto do material: é a
      // suspeita mais forte que existe, porque não veio de palpite nenhum,
      // veio de o material nomear um sítio e a leitura ter escolhido o outro.
      if (extracted.subtipo_corrigido_de) {
        tipoJustEl.textContent = `A leitura havia classificado como ${extracted.subtipo_corrigido_de}, e foi corrigido para ${extracted.tipo_tumor} porque é o sítio nomeado no material. Confirme antes de seguir. A triagem inteira depende disto.`;
        tipoJustEl.className = 'hint confirmar-subtipo';
        tipoJustEl.style.display = '';
        campoSubtipo.classList.add('confirmar');
      } else if (!semJustificativa) {
        tipoJustEl.textContent = 'Identificado automaticamente: ' + extracted.tipo_tumor_justificativa;
        tipoJustEl.className = 'hint';
        tipoJustEl.style.display = '';
        campoSubtipo.classList.remove('confirmar');
      } else {
        tipoJustEl.textContent = 'A leitura não explicou por que escolheu este subtipo. Nos casos em que isso acontece, a identificação erra com mais frequência. Confirme o subtipo antes de seguir; trocar aqui remonta os campos e as regras.';
        tipoJustEl.className = 'hint confirmar-subtipo';
        tipoJustEl.style.display = '';
        campoSubtipo.classList.add('confirmar');
      }

      // Um único caminho de preenchimento para os sete tumores: a definição
      // do subtipo já diz quais campos existem e de onde vem cada valor.
      renderFields(extracted);

      renderSources();
      liberarPasso(1);
      goTo(1);
    } catch (err) {
      errorBox.textContent = (err.message || 'Não foi possível extrair o caso. Tente novamente.');
      errorBox.style.display = '';
    } finally {
      btn.disabled = false;
      btn.textContent = originalLabel;
      // No `finally`: o esqueleto precisa sair mesmo quando a leitura falha,
      // senão a tela fica pulsando para sempre sobre uma mensagem de erro.
      document.body.classList.remove('lendo-caso');
    }
  }

  // ===================== GENA =====================
  /* O que o médico JÁ preencheu na tela, para a Gena não perguntar de novo.
   *
   * O prompt dela proíbe explicitamente "perguntar o que a pessoa acabou de
   * dizer com outras palavras, o erro que mais faz uma conversa parecer
   * robô". Mas ela não tinha como saber: cada conversa começava do zero,
   * mesmo com o caso já estruturado na tela atrás do painel. O médico
   * preenchia histologia, grau e estágio no passo 2, abria a Gena, e ela
   * pedia histologia. Ver §51.
   *
   * O nome do paciente NUNCA entra aqui. É a única informação identificável
   * que o app toca, e ela não sobe para o modelo de conversa. */
  function contextoDaTela() {
    if (!currentSubtype) return null;
    const t = TUMORS.get(currentSubtype);
    if (!t) return null;
    const campos = {};
    t.fields.forEach((f) => {
      const el = document.getElementById('f-' + f.key);
      const v = el && String(el.value || '').trim();
      if (v) campos[f.label] = v.slice(0, 200);
    });
    if (!Object.keys(campos).length) return null;
    return { tumor: t.label, campos };
  }

  // Conversa real com o modelo (/api/chat), não roteiro fixo: a Gena entende
  // resposta em linguagem natural e sinaliza sozinha quando o caso está
  // completo o bastante para ir para a triagem estruturada.
  const GENA_GREETING = 'Oi! Sou a Gena. Me conte o caso do seu jeito (histologia, estágio, o que tiver em mãos) e eu organizo e levo para a triagem.';
  let genaMessages = [];
  let genaReadySummary = '';
  let genaBusy = false;

  function genaOpen() { return document.getElementById('gena').classList.contains('open'); }

  let focoAntesDaGena = null;

  function toggleGena(force) {
    const root = document.getElementById('gena');
    const open = typeof force === 'boolean' ? force : !genaOpen();
    root.classList.toggle('open', open);
    document.getElementById('gena-fab').setAttribute('aria-expanded', String(open));
    if (open) {
      focoAntesDaGena = document.activeElement;
      document.getElementById('gena-badge').classList.remove('on');
      if (!genaMessages.length) genaPush('assistant', GENA_GREETING);
      setTimeout(() => document.getElementById('gena-input').focus(), 60);
    } else if (focoAntesDaGena && focoAntesDaGena.focus) {
      // O botão flutuante some quando o painel abre. Sem devolver o foco, quem
      // fecha por teclado é largado num ponto arbitrário do DOM e não tem como
      // reabrir a Gena por Tab.
      const alvo = document.getElementById('gena-fab') || focoAntesDaGena;
      setTimeout(() => alvo.focus(), 60);
    }
  }

  // Esc fecha a Gena, como fecha os dois modais. Era o único painel do produto
  // que ignorava a tecla.
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && genaOpen()) toggleGena(false);
  });

  // Em tela estreita o painel cobre a viewport inteira: nesse caso ele é um
  // diálogo de fato e precisa prender o foco, senão o leitor de tela continua
  // percorrendo o conteúdo que está visualmente coberto.
  document.getElementById('gena').addEventListener('keydown', (e) => {
    const painel = document.getElementById('gena');
    if (!genaOpen()) return;
    const cobreTudo = painel.getBoundingClientRect().width >= window.innerWidth - 8;
    if (cobreTudo) prenderFoco(painel, e);
  });

  /* ============ A GENA FALA E OUVE ============
   *
   * O médico usa isto entre consultas, muitas vezes com as mãos ocupadas e o
   * laudo na outra. Digitar é o gargalo. O navegador já traz reconhecimento
   * de fala e síntese de voz nativos: nenhuma dependência nova, nenhum custo
   * por minuto, e o áudio não sai do aparelho, o que importa num app que
   * promete que o material do paciente não circula. Ver §51.
   *
   * Regras de comportamento:
   * A Gena NÃO fala de volta: foi decisão do dono do produto, e é a decisão
   * certa, um app que fala sozinho numa sala de consulta é um problema, não
   * um recurso. O microfone serve para ditar PARA o campo de texto: continua
   * sendo conversa digitada, só sem ocupar as mãos.
   */
  let genaEscutando = false;
  let genaReconhecimento = null;

  function genaAlternarEscuta() {
    if (!SpeechRecognitionAPI) return;
    if (genaEscutando) { genaReconhecimento && genaReconhecimento.stop(); return; }

    genaReconhecimento = new SpeechRecognitionAPI();
    genaReconhecimento.lang = 'pt-BR';
    genaReconhecimento.interimResults = true;
    genaReconhecimento.continuous = false;

    const botao = document.getElementById('gena-mic');
    const campo = document.getElementById('gena-input');
    let ditado = '';

    genaReconhecimento.onstart = () => {
      genaEscutando = true;
      botao.classList.add('ouvindo');
      botao.setAttribute('aria-label', 'Parar de falar');
    };
    genaReconhecimento.onresult = (e) => {
      let texto = '';
      for (let i = 0; i < e.results.length; i++) texto += e.results[i][0].transcript;
      ditado = texto.trim();
      campo.value = ditado;
    };
    genaReconhecimento.onerror = () => { /* sem permissão ou sem rede: o campo continua digitável */ };
    genaReconhecimento.onend = () => {
      genaEscutando = false;
      botao.classList.remove('ouvindo');
      botao.setAttribute('aria-label', 'Falar com a Gena');
      // Falou e parou: envia sozinho. Pedir para apertar enviar depois de
      // falar desfaz o ganho de não precisar das mãos.
      if (ditado) genaEnviar(ditado);
    };

    try { genaReconhecimento.start(); } catch { /* já estava ouvindo */ }
  }

  function genaPush(role, text) {
    genaMessages.push({ role, content: text });
    genaRender(role, text);
  }

  function genaRender(role, text) {
    const log = document.getElementById('gena-log');
    const msg = document.createElement('div');
    msg.className = 'gena-msg ' + (role === 'assistant' ? 'from-gena' : 'from-doc');
    const bubble = document.createElement('div');
    bubble.className = 'gena-bubble';
    bubble.textContent = text;
    msg.appendChild(bubble);
    log.appendChild(msg);
    log.scrollTop = log.scrollHeight;
  }

  function genaTyping(on) {
    const log = document.getElementById('gena-log');
    const existing = document.getElementById('gena-typing');
    if (!on) { if (existing) existing.remove(); return; }
    if (existing) return;
    const wrap = document.createElement('div');
    wrap.className = 'gena-msg from-gena';
    wrap.id = 'gena-typing';
    wrap.innerHTML = '<div class="gena-bubble gena-typing"><i></i><i></i><i></i></div>';
    log.appendChild(wrap);
    log.scrollTop = log.scrollHeight;
  }

  function genaSubmit(event) {
    event.preventDefault();
    const input = document.getElementById('gena-input');
    const text = input.value.trim();
    genaEnviar(text);
    return false;
  }

  async function genaEnviar(text) {
    if (!text || genaBusy) return false;
    const input = document.getElementById('gena-input');
    input.value = '';
    genaPush('user', text);
    await genaChamar();
    return false;
  }

  /* §69. A chamada ficou separada do envio para poder ser REFEITA.
   *
   * Antes, uma falha de rede renderizava "Tive um problema" e acabava ali: a
   * mensagem do médico já estava no histórico, sem resposta e sem caminho de
   * volta. Para tentar de novo ele teria que digitar tudo outra vez, num
   * aparelho em corredor de hospital, com sinal oscilando, é onde a conversa
   * morre. Agora o erro vem com um botão que reenvia a mesma mensagem. */
  async function genaChamar() {
    if (genaBusy) return;
    genaBusy = true;
    document.getElementById('gena-send').disabled = true;
    genaRemoverErro();
    genaTyping(true);

    try {
      const out = await api('/api/chat', { method: 'POST', body: { messages: genaMessages, contexto: contextoDaTela() } });
      genaTyping(false);
      if (out.reply) genaPush('assistant', out.reply);

      if (out.caseReady) {
        genaReadySummary = out.caseReady;
        document.getElementById('gena-cta').style.display = '';
      }
    } catch (err) {
      genaTyping(false);
      genaMostrarErro(err.message || 'Não consegui responder agora.');
    } finally {
      genaBusy = false;
      document.getElementById('gena-send').disabled = false;
      document.getElementById('gena-input').focus();
    }
  }

  function genaRemoverErro() {
    const velho = document.getElementById('gena-erro');
    if (velho) velho.remove();
  }

  function genaMostrarErro(texto) {
    const log = document.getElementById('gena-log');
    genaRemoverErro();
    const wrap = document.createElement('div');
    wrap.className = 'gena-msg from-gena';
    wrap.id = 'gena-erro';
    const bolha = document.createElement('div');
    bolha.className = 'gena-bubble gena-falha';
    const frase = document.createElement('span');
    frase.textContent = texto;
    const botao = document.createElement('button');
    botao.type = 'button';
    botao.className = 'gena-retentar';
    botao.textContent = 'Tentar de novo';
    botao.onclick = () => genaChamar();
    bolha.appendChild(frase);
    bolha.appendChild(botao);
    wrap.appendChild(bolha);
    log.appendChild(wrap);
    log.scrollTop = log.scrollHeight;
  }

  // Passa o caso reunido para o mesmo motor de extração do modo formulário.
  async function genaSendToTriage() {
    if (!genaReadySummary) return;
    const textarea = document.getElementById('case-text');
    textarea.value = genaReadySummary;
    textarea.dispatchEvent(new Event('input'));
    document.getElementById('gena-cta').style.display = 'none';
    toggleGena(false);
    goTo(0);
    await runExtraction();
  }

  function genaReset() {
    genaMessages = [];
    genaReadySummary = '';
    document.getElementById('gena-log').innerHTML = '';
    document.getElementById('gena-cta').style.display = 'none';
  }

  let pdfFiles = [];
  let photoFiles = [];

  // Alguns navegadores/SO não preenchem file.type de forma confiável para
  // todo PDF (fica vazio em vez de "application/pdf"), cair pra extensão
  // evita que o arquivo seja silenciosamente ignorado no drag-and-drop.
  function isPdfFile(f) {
    return f.type === 'application/pdf' || /\.pdf$/i.test(f.name);
  }
  // Só os formatos que a leitura automática abre. HEIC/HEIF (padrão do iPhone),
  // BMP e TIFF são reconhecidos como imagem para dar uma mensagem útil, mas o
  // servidor os barra antes de gastar chamada.
  const IMAGENS_SUPORTADAS = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];

  function isImageFile(f) {
    return IMAGENS_SUPORTADAS.includes(f.type)
      || /\.(png|jpe?g|gif|webp|heic|heif|bmp|tiff?)$/i.test(f.name);
  }

  function formatoNaoSuportado(f) {
    const ehHeic = /heic|heif/i.test(f.type) || /\.(heic|heif)$/i.test(f.name);
    if (ehHeic) {
      return `"${f.name}" está em HEIC, o formato padrão de foto do iPhone, que a leitura automática não abre. Abra a foto, toque em Compartilhar e escolha "Copiar foto": a cópia sai em JPEG. Ou anexe um print da tela.`;
    }
    if (/\.(bmp|tiff?)$/i.test(f.name)) {
      return `"${f.name}" está num formato que a leitura automática não abre. Converta para JPEG ou PNG, ou anexe um print da tela.`;
    }
    return null;
  }

  const LIMITE_ARQUIVO = 20 * 1024 * 1024;

  // Checa o arquivo no próprio navegador, antes de subir. Um PDF de 0 byte
  // (típico de arquivo que ainda está no iCloud e não foi baixado) só daria
  // erro depois da chamada paga, e com uma mensagem que não ajuda em nada.
  function problemaNoArquivo(f) {
    const formato = formatoNaoSuportado(f);
    if (formato) return formato;
    if (f.size === 0) {
      return `"${f.name}" está vazio (0 bytes). Costuma ser arquivo que ainda está no iCloud/Drive: abra-o uma vez no aparelho para baixar e anexe de novo.`;
    }
    if (f.size > LIMITE_ARQUIVO) {
      return `"${f.name}" tem ${(f.size / 1024 / 1024).toFixed(1)} MB, acima do limite de 20 MB. Anexe só as páginas que interessam, ou uma foto da página.`;
    }
    return null;
  }

  function addFiles(kind, fileList) {
    const files = Array.from(fileList || []);
    if (!files.length) return;

    const problemas = [];
    const bons = files.filter((f) => {
      const p = problemaNoArquivo(f);
      if (p) { problemas.push(p); return false; }
      return true;
    });

    if (problemas.length) mostrarAvisos(problemas.map((texto) => ({ motivo: texto })));
    if (!bons.length) return;

    if (kind === 'pdf') pdfFiles = pdfFiles.concat(bons);
    else photoFiles = photoFiles.concat(bons);
    refreshFileTiles();
  }

  function removeFile(kind, idx) {
    if (kind === 'pdf') pdfFiles.splice(idx, 1);
    else photoFiles.splice(idx, 1);
    refreshFileTiles();
  }

  // Redesenha os dois tiles (nome/contagem, miniaturas) e a lista de chips
  // removíveis a partir do estado atual de pdfFiles/photoFiles, chamado
  // sempre que um arquivo é adicionado ou removido, pra nunca dessincronizar.
  /* §60. "Limpar tudo" é ação destrutiva e rara, e ficava sempre na tela com
   * o mesmo peso da ação principal. Agora ela só existe quando há algo para
   * limpar, texto digitado ou arquivo anexado. Um botão que não tem o que
   * fazer é ruído, e ruído ao lado de um botão destrutivo é pior: ensina o
   * médico a ignorar aquele canto da tela. */
  function atualizarRascunho() {
    const campo = document.getElementById('case-text');
    const temTexto = !!(campo && campo.value.trim());
    const temArquivo = pdfFiles.length > 0 || photoFiles.length > 0;
    document.body.classList.toggle('tem-rascunho', temTexto || temArquivo);
  }

  function refreshFileTiles() {
    atualizarRascunho();
    document.getElementById('file-name-pdf').textContent = pdfFiles.length
      ? (pdfFiles.length === 1 ? pdfFiles[0].name : `${pdfFiles.length} arquivos anexados`)
      : '';
    document.getElementById('tile-pdf').classList.toggle('selected', pdfFiles.length > 0);

    document.getElementById('file-name-photo').textContent = photoFiles.length
      ? (photoFiles.length === 1 ? photoFiles[0].name : `${photoFiles.length} arquivos anexados`)
      : '';
    document.getElementById('tile-photo').classList.toggle('selected', photoFiles.length > 0);

    const thumbRow = document.getElementById('thumb-row');
    thumbRow.innerHTML = '';
    photoFiles.forEach((f) => {
      const img = document.createElement('img');
      img.src = URL.createObjectURL(f);
      img.alt = f.name;
      thumbRow.appendChild(img);
    });

    document.getElementById('ocr-disclaimer').style.display = (pdfFiles.length || photoFiles.length) ? '' : 'none';
    renderAttachedFiles();
  }

  function renderAttachedFiles() {
    const list = document.getElementById('attached-files-list');
    const all = [
      ...pdfFiles.map((f, idx) => ({ f, kind: 'pdf', idx })),
      ...photoFiles.map((f, idx) => ({ f, kind: 'photo', idx })),
    ];
    list.style.display = all.length ? 'flex' : 'none';
    list.innerHTML = '';
    all.forEach(({ f, kind, idx }) => {
      const chip = document.createElement('span');
      chip.className = 'file-chip';
      const nameSpan = document.createElement('span');
      nameSpan.className = 'name';
      nameSpan.textContent = f.name;
      const removeBtn = document.createElement('button');
      removeBtn.type = 'button';
      removeBtn.textContent = '×';
      removeBtn.setAttribute('aria-label', 'Remover ' + f.name);
      removeBtn.onclick = () => removeFile(kind, idx);
      chip.appendChild(nameSpan);
      chip.appendChild(removeBtn);
      list.appendChild(chip);
    });
  }

  // Reseta a tela de ingestão inteira: arquivos, texto, ditado por voz e
  // conversa com o OncoBot, pra começar um caso do zero sem recarregar a página.
  function clearIntake() {
    pdfFiles = [];
    photoFiles = [];
    document.getElementById('case-text').value = '';
    document.getElementById('extract-error').style.display = 'none';
    limparAvisos();

    if (recording) toggleRecording();
    recSeconds = 0;
    document.getElementById('voice-time').textContent = '00:00';
    document.getElementById('tile-voice').classList.remove('selected');
    document.getElementById('voice-panel').classList.remove('open');

    // O nome do paciente é a única informação identificável que o app toca.
    // Ele sobrevivia ao "Iniciar novo caso" e reaparecia no documento da
    // paciente seguinte, com o diagnóstico correto dela. Ver §46.1
    const campoNome = document.getElementById('patient-name');
    if (campoNome) campoNome.value = '';
    extractedPatientName = '';

    genaReset();
    refreshFileTiles();
    // O caso anterior deixou de existir: os passos seguintes voltam a ficar
    // fora de alcance até uma nova extração.
    reiniciarPassos();
  }

  // Rotea arquivo solto por tipo: PDF vira "Laudo em PDF", imagem vira "Foto do laudo".
  // Arquivo não reconhecido como nenhum dos dois avisa em vez de sumir sem explicação.
  function routeDroppedFiles(fileList) {
    const files = Array.from(fileList || []);
    const pdfs = files.filter(isPdfFile);
    const images = files.filter((f) => !isPdfFile(f) && isImageFile(f));
    const unknown = files.filter((f) => !isPdfFile(f) && !isImageFile(f));
    if (pdfs.length) addFiles('pdf', pdfs);
    if (images.length) addFiles('photo', images);
    if (unknown.length) {
      const errorBox = document.getElementById('extract-error');
      const names = unknown.map((f) => f.name).join(', ');
      errorBox.textContent = `Não reconheci "${names}" como PDF ou imagem. Anexe pelos tiles "Laudo em PDF" ou "Foto do laudo", ou confira o formato do arquivo.`;
      errorBox.style.display = '';
    }
  }

  function setupDropzone() {
    const zone = document.getElementById('dropzone');
    let dragDepth = 0;
    zone.addEventListener('dragenter', (e) => {
      e.preventDefault();
      dragDepth++;
      zone.classList.add('drag-over');
    });
    zone.addEventListener('dragover', (e) => e.preventDefault());
    zone.addEventListener('dragleave', () => {
      dragDepth = Math.max(0, dragDepth - 1);
      if (dragDepth === 0) zone.classList.remove('drag-over');
    });
    zone.addEventListener('drop', (e) => {
      e.preventDefault();
      dragDepth = 0;
      zone.classList.remove('drag-over');
      routeDroppedFiles(e.dataTransfer.files);
    });
  }

  // ===================== MOTOR DE TRIAGEM E RENDERIZAÇÃO =====================
  // Nenhuma regra clínica vive aqui: esta camada só lê o veredito devolvido
  // por TUMORS.get(id).classify(valores) e o transforma em tela. As regras,
  // com a diretriz que as sustenta, ficam em /tumors.js e em
  // docs/ARQUITETURA.md.

  function esc(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function todayBR() {
    const d = new Date();
    return String(d.getDate()).padStart(2, '0') + '/' + String(d.getMonth() + 1).padStart(2, '0') + '/' + d.getFullYear();
  }

  // Selo "N testes indicados" no topo do resultado, resposta imediata de
  // "quantos e quais", em vez de exigir ler o parágrafo inteiro do veredito.
  function setCountPill(count, titulo) {
    const pill = document.getElementById('verdict-count-pill');
    if (count === null) { pill.style.display = 'none'; return; }
    /* §57.3. A contagem aparecia TRÊS vezes no mesmo painel: no selo, no
     * título ("Este caso tem indicação para 2 testes") e no resumo ("Solicite
     * os 2 testes abaixo"). Repetir um número não o torna mais claro, enche
     * o painel e faz o médico reler para conferir se são três informações ou
     * a mesma. O título é texto clínico, vem do registro; o selo é decisão de
     * tela. Então é o selo que sai quando o título já diz o número. */
    if (titulo && new RegExp(`\\b${count}\\b`).test(titulo)) { pill.style.display = 'none'; return; }
    pill.textContent = count === 0 ? '0 testes indicados' : count === 1 ? '1 teste indicado' : `${count} testes indicados`;
    pill.classList.toggle('zero', count === 0);
    pill.style.display = '';
  }

  const CHEVRON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>';

  function runTriage() {
    const t = tumor();
    const values = readFields();
    const result = t.classify(values);
    lastResult = { result, values, tumor: t };

    const tests = result.tests || [];
    const blocked = result.state === 'insuficiente' || result.state === 'nao-reconhecida';

    const box = document.getElementById('verdict-box');
    const nextBtn = document.getElementById('verdict-next-btn');
    box.classList.toggle('negative', blocked);
    document.getElementById('verdict-glyph').textContent = blocked ? '!' : '✓';
    document.getElementById('verdict-title').textContent = blocked
      ? (result.state === 'insuficiente' ? 'Dados insuficientes para triagem' : 'Perfil não reconhecido por esta regra')
      : result.title;
    document.getElementById('verdict-text').textContent = blocked ? result.message : result.summary;
    setCountPill(blocked ? null : tests.length, blocked ? '' : result.title);

    renderTestSteps(tests, result);
    renderNotes(blocked ? [] : (result.notes || []));

    // Sem teste indicado não existe programa de acesso para mostrar, o
    // botão volta para a revisão em vez de levar a uma tela vazia.
    liberarPasso(2);
    if (tests.length) {
      liberarPasso(3);
      nextBtn.textContent = 'Ver programas de acesso →';
      nextBtn.onclick = () => goTo(3);
    } else {
      nextBtn.textContent = blocked ? '← Completar dados' : '← Revisar dados do caso';
      nextBtn.onclick = () => goTo(1);
    }

    renderPrograms();
    goTo(2);
  }

  function renderTestSteps(tests, result) {
    const wrap = document.getElementById('test-steps');
    const provisorio = result.state === 'provisorio';
    wrap.innerHTML = tests.map((test, i) => {
      // A descrição chega a 315 caracteres e ficava toda aberta em cada card.
      // A primeira frase diz o que é o teste; o resto é o porquê, e abre sob
      // demanda. Ver §45.
      const desc = String(test.description || '');
      const corte = desc.indexOf('. ');
      const cabeca = corte > 0 ? desc.slice(0, corte + 1) : desc;
      const cauda = corte > 0 ? desc.slice(corte + 2) : '';
      /* §63. O número vira NÓ DE UM TRILHO, não um selo dentro de um card
       * solto. Quando a triagem indica dois testes, a ordem entre eles é
       * clínica, no endométrio dMMR, pedir o germinativo antes da metilação
       * de MLH1 encaminha ao geneticista uma paciente cuja perda é
       * esporádica. Dois cards idênticos empilhados comunicam "menu, escolha
       * um". Um trilho comunica "primeiro este, depois aquele". */
      return `
      <div class="test-step${test.primary ? ' primary' : ''}">
        <div class="trilho" aria-hidden="true"><span class="step-num">${i + 1}</span></div>
        <div class="step-body">
          <div class="order">${esc(test.order || '')}</div>
          <h4>${esc(test.name)}${provisorio && test.primary ? ' <span class="pill warn">confirmar critério</span>' : ''}</h4>
          <p>${esc(cabeca)}</p>
          ${cauda || test.justify ? `<details class="detalhe-teste">
            <summary>Por que este teste</summary>
            ${cauda ? `<p>${esc(cauda)}</p>` : ''}
            ${/* §63.2. test.justify é o texto que vai IMPRESSO no pedido, no
                  campo "Justificativa clínica", acima da assinatura do médico,
                  e não aparecia em lugar nenhum da tela. O médico assinava
                  uma justificativa que nunca tinha lido. */''}
            ${test.justify ? `<div class="justificativa-assinada">
              <span class="rotulo">Vai assim no pedido, acima da sua assinatura</span>
              <p>${esc(test.justify)}</p>
            </div>` : ''}
          </details>` : ''}
          <div class="rodape-teste">
            ${test.stat ? `<span class="stat-badge">${esc(test.stat)}</span>` : ''}
            <span class="src">Amostra: ${esc(test.sample || '-')}</span>
          </div>
        </div>
      </div>`;
    }).join('');
    // §76. Cabeçalho sem nada embaixo é pior que nenhum cabeçalho: anuncia uma
    // seção que não existe. Some junto com a lista.
    const secao = document.getElementById('secao-solicitar');
    if (secao) secao.hidden = !tests.length;
  }

  function renderNotes(notes) {
    /* §45.2 uma camada acima: a nota que MUDA CONDUTA é enunciado e fica
     * aberta, ACIMA dos cards que ela governa. A que só explica uma ausência
     * é elaboração e recolhe.
     *
     * Antes disto, a regra de sequenciamento mais perigosa do app, pedir
     * metilação de MLH1 ANTES do germinativo, ficava atrás de um clique,
     * enquanto 55 palavras de texto jurídico ficavam totalmente abertas logo
     * abaixo. Ver §53. */
    const lista = notes || [];
    const acao = lista.filter((n) => n.nivel === 'acao' || n.warn);
    const contexto = lista.filter((n) => !(n.nivel === 'acao' || n.warn));
    const destino = document.getElementById('verdict-notes-acao');
    if (destino) destino.innerHTML = acao.map((n) => cartaoDeNota(n, true)).join('');
    document.getElementById('verdict-notes').innerHTML =
      (destino ? contexto : lista).map((n) => cartaoDeNota(n, false)).join('');
  }

  function cartaoDeNota(note, aberta) {
    return `
      <details class="note-card${note.warn ? ' warn' : ''}${aberta ? ' acao' : ''}"${aberta ? ' open' : ''}>
        <summary>
          <span class="summary-text">
            <span class="tag">${esc(note.tag)}</span>
            <h4>${esc(note.title)}</h4>
          </span>
          <span class="chevron">${CHEVRON}</span>
        </summary>
        <div class="card-body"><p>${esc(note.body)}</p></div>
      </details>`;
  }

  /* ---------------- Programas de acesso e documentos ---------------- */

  const ICONE_LAB = '<svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M14.5 2v17.5c0 1.4-1.1 2.5-2.5 2.5s-2.5-1.1-2.5-2.5V2"/><path d="M8.5 2h7"/><path d="M14.5 16h-5"/></svg>';
  const ICONE_DNA = '<svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><path d="m10 16 1.5 1.5"/><path d="m14 8-1.5-1.5"/><path d="M15 2c-1.798 1.998-2.518 3.995-2.807 5.993"/><path d="m16.5 10.5 1 1"/><path d="m17 6-2.891-2.891"/><path d="M2 15c6.667-6 13.333 0 20-6"/><path d="m20 9 .891.891"/><path d="M3.109 14.109 4 15"/><path d="m6.5 12.5 1 1"/><path d="m7 18 2.891 2.891"/><path d="M9 22c1.798-1.998 2.518-3.995 2.807-5.993"/></svg>';

  // Monta um card por teste efetivamente indicado, nunca um teste que a
  // triagem não indicou, para não oferecer ao médico uma opção que não se
  // aplica ao caso que ele acabou de rodar.
  function renderPrograms() {
    const container = document.getElementById('programs-dynamic');
    const note = document.getElementById('programs-note');
    // §76. O cabeçalho da seção acompanha a lista: sem programas na tela, ele
    // anunciaria uma seção vazia.
    const secao = document.getElementById('secao-programas');
    const mostrarSecao = (v) => { if (secao) secao.hidden = !v; };
    if (!lastResult) { container.innerHTML = ''; mostrarSecao(false); return; }

    const { result, values, tumor: t } = lastResult;
    const tests = result.tests || [];

    if (!tests.length) {
      container.innerHTML = '';
      mostrarSecao(false);
      note.textContent = 'Esta triagem não indicou nenhum teste genético para o caso informado, por isso nenhum programa de acesso é mostrado.';
      note.style.display = '';
      return;
    }
    note.style.display = 'none';
    mostrarSecao(true);

    const diagnostico = t.diagnosis(values);
    // "Nenhum relatado" / "Não relatado" são negativas explícitas, não
    // conteúdo, entrariam no documento como "Caso com diagnóstico acima
    // descrito, nenhum relatado." se fossem tratadas como texto.
    const testesPrevios = H.filled(values.testes_previos) ? values.testes_previos.trim() : '';
    const historico = H.filled(values.historico_familiar) ? values.historico_familiar.trim() : '';
    const date = todayBR();
    const provisorio = result.state === 'provisorio';
    const doctor = `${doctorName}, CRM ${doctorCRM}`;

    /* §66. A frase sobre custo era repetida DENTRO de cada card de teste, com
     * o mesmo texto. Ela não fala de um teste, fala dos programas de
     * indústria, que são os mesmos em toda a tela. Repetida, ela some: o olho
     * aprende que aquele parágrafo cinza não muda e para de lê-lo. Dita uma
     * vez, no topo, ela ainda informa. */
    const temIndustriaNaTela = tests.some((t) =>
      (t.programs || []).some((prog) => prog.tipo === 'patrocinado'));
    const avisoCusto = document.getElementById('programas-custo');
    if (avisoCusto) avisoCusto.hidden = !temIndustriaNaTela;

    container.innerHTML = tests.map((test, i) => {
      const provisional = provisorio && test.primary;
      // O toLowerCase() servia para emendar a frase, e destruía nome de gene e
      // de laboratório no documento ASSINADO: "Painel BRCA1/2 (Invitae)" saía
      // "painel brca1/2 (invitae)". Só a primeira letra desce. §47.6
      /* §81. A correção do §47.6 ficou pela metade, e o caso que sobrou é o
       * MAIS comum: o texto de testes prévios quase sempre começa pelo nome
       * do gene. "BRCA germinativo negativo em 2021" saía "bRCA germinativo
       * negativo em 2021" no documento que o médico assina, e some na tela,
       * porque a tela mostra `test.justify` sem este prefixo. Só aparece no
       * papel, que é onde menos se pode errar.
       * Agora a inicial só desce quando rebaixá-la não destrói nada: palavra
       * que não é toda maiúscula, não tem maiúscula interna e não tem
       * dígito. BRCA, MSI, MLH1, PD-L1 e DNA ficam intactos. */
      const primeiraPalavra = String(testesPrevios).split(/\s+/)[0] || '';
      const ehSigla = primeiraPalavra === primeiraPalavra.toUpperCase()
        || /[A-Z]/.test(primeiraPalavra.slice(1))
        || /\d/.test(primeiraPalavra);
      const previosNaFrase = testesPrevios
        ? (ehSigla ? testesPrevios : testesPrevios.charAt(0).toLowerCase() + testesPrevios.slice(1))
        : 'sem teste molecular prévio relatado';
      const justificativa = `Caso com diagnóstico acima descrito, ${previosNaFrase}. ${test.justify}` +
        (test.kind === 'germinativo' && historico ? ` Histórico familiar relatado: ${historico}, reforça encaminhamento para aconselhamento genético.` : '');
      const icon = test.kind === 'germinativo' ? ICONE_DNA : ICONE_LAB;

      // O selo diz, antes de qualquer leitura, o que aquela linha é: via sem
      // custo da indústria, laboratório parceiro, ou nenhuma via verificada.
      // E quando não há endereço, a linha precisa dizer POR ONDE se solicita,
      // uma linha sem botão e sem explicação parece produto quebrado. Ver §44.
      /* §56. O selo dizia "Sem custo" em cada programa de indústria. Como
       * TODOS os programas de indústria listados são sem custo, o selo não
       * distinguia nada, só empurrava o clique para quem o exibia primeiro.
       * O selo passou a dizer o que o programa É; o custo é dito uma vez, na
       * linha acima da lista, valendo para todos. */
      const SELO = {
        patrocinado: { txt: 'Programa da indústria', cls: 'ok' },
        laboratorio: { txt: 'Laboratório parceiro', cls: 'neutro' },
        'sem-via': { txt: 'Sem via verificada', cls: 'warn' },
      };
      /* Cortar a nota do programa em 78 CARACTERES partia a frase no meio do
       * critério. No teste HRD da GSK, o que ficava visível era
       * "Elegível: carcinoma seroso ou…", e o que sumia atrás do "mais" era
       * "de ALTO GRAU" e "EM PRIMEIRA LINHA de tratamento", ou seja, os dois
       * critérios que RECUSAM o paciente, mais o aviso de que a solicitação
       * não é por portal. O médico lia a metade que inclui e não lia a metade
       * que exclui. Agora o corte respeita o fim de frase: o que fica visível
       * é sempre um enunciado inteiro. Ver §53. */
      const cortarNota = (txt) => {
        const t = String(txt || '');
        if (t.length <= 120) return { cabeca: t, cauda: '' };
        let fim = t.indexOf('. ');
        // Uma primeira frase curta demais não explica nada: busca a seguinte.
        while (fim > 0 && fim < 60) {
          const prox = t.indexOf('. ', fim + 2);
          if (prox < 0) break;
          fim = prox;
        }
        if (fim <= 0 || fim >= t.length - 2) return { cabeca: t, cauda: '' };
        return { cabeca: t.slice(0, fim + 1), cauda: t.slice(fim + 2) };
      };

      // A ordem mora no registro clínico (§56), não aqui.
      const listaProgramas = TUMORS.ordenarProgramas(test.programs || []);

      /* §67. Marca-texto nos trechos que o registro declarou como excludentes.
       * Aplicado DEPOIS do escape de HTML, sobre o texto já seguro, e só nas
       * ocorrências exatas que o registro listou, nunca por padrão de letra
       * maiúscula, que confundiria nome de gene com critério. */
      const marcarDestaques = (textoEscapado, destaques) => {
        if (!destaques || !destaques.length) return textoEscapado;
        let saida = textoEscapado;
        for (const trecho of destaques) {
          const alvo = esc(trecho);
          if (!saida.includes(alvo)) continue;
          saida = saida.split(alvo).join(`<mark class="marca-criterio">${alvo}</mark>`);
        }
        return saida;
      };

      const programas = listaProgramas.map((p) => {
        const selo = SELO[p.tipo] || null;
        const nota = cortarNota(p.note);
        const acao = p.url
          ? `<a class="link" href="${esc(p.url)}" target="_blank" rel="noopener">Abrir portal ↗</a>`
          : (p.tipo === 'sem-via' ? '' : '<span class="link-ausente">Solicite pelo representante</span>');
        return `
        <div class="program-row">
          <div class="who">
            <span class="logo">${icon}</span>
            <div>
              <div class="name">${esc(p.name)}${selo ? ` <span class="selo ${selo.cls}">${selo.txt}</span>` : ''}</div>
              ${nota.cauda
                ? `<details class="prog-nota"><summary>${marcarDestaques(esc(nota.cabeca), p.destaques)}</summary><div class="test">${marcarDestaques(esc(nota.cauda), p.destaques)}</div></details>`
                : `<div class="test">${marcarDestaques(esc(nota.cabeca), p.destaques)}</div>`}
              ${p.verificadoEm ? `<div class="prog-verif">Via conferida em ${esc(p.verificadoEm.split('-').reverse().join('/'))}</div>` : ''}
            </div>
          </div>
          ${acao}
        </div>`;
      }).join('');

      return `
      <div class="card program-card">
        <!-- §57. A pílula ficava INLINE no fim do h3. Com um nome longo,
             "Painel germinativo multigênico (BRCA1/2, RAD51C, RAD51D, BRIP1,
             PALB2 e genes de Lynch)" tem 88 caracteres, o título quebrava em
             duas linhas e a pílula pousava no meio da segunda, colada na
             última palavra. Era a origem do "tudo um em cima do outro". Como
             status, ela pertence ACIMA do nome: diz em que pé está o item que
             vem a seguir, e nunca mais depende de onde o texto quebrou. -->
        <!-- §63.4. O MESMO NÚMERO da tela de resultado. As duas telas listam
             os mesmos testes na mesma ordem, e na tela de programas cada um
             virava um card idêntico ao anterior, sem nada que dissesse "este
             é o teste 1 que você acabou de ler". O número é a única ponte
             necessária, e custa um elemento. -->
        <div class="prog-topo">
          <div class="prog-cabeca">
            <span class="step-num">${i + 1}</span>
            <span class="pill ${provisional ? 'warn' : 'ok'}">${provisional ? 'indicação provável: confirmar' : 'indicado neste caso'}</span>
          </div>
          <h3>${esc(test.name)}</h3>
        </div>
        ${programas}

        <details class="doc-preview-wrap" id="doc-${esc(test.id)}">
          <summary><span class="doc-rotulo">Solicitação pronta para assinar</span></summary>
          <!-- §66.2. "Editar campos" morava FORA do documento, numa fileira de
               ações repetida em cada card e visível mesmo com o documento
               fechado, um botão oferecendo editar algo que não está na tela.
               Mora agora dentro do documento aberto, encostado no que ele
               edita, e some junto com ele. -->
          <div class="doc-ferramentas">
            <button class="ghost compacto" type="button" onclick="toggleEditDoc('doc-${esc(test.id)}', this)">Editar campos</button>
          </div>
          <div class="doc-preview">
            <!-- §64. A marca era conteúdo de um ::before em CSS. No
                 celular ela colidia com o tipo do documento, duas caixas
                 adjacentes sem respiro, uma delas quebrando em duas linhas:
                 "OncoGenYXFORMULÁRIO DE SOLICITAÇÃO". Pseudo-elemento também
                 não é mensurável por teste, nem legível por leitor de tela.
                 Texto de conteúdo mora na marcação. -->
            <div class="doc-head">
              <span class="doc-marca">OncoGenYX</span>
              <span class="doc-type">Formulário de solicitação</span>
            </div>
            <div class="doc-row"><span class="k">Paciente</span><span class="v doc-name">-</span></div>
            <div class="doc-row"><span class="k">Médico solicitante</span><span class="v">${esc(doctor)}</span></div>
            <div class="doc-row"><span class="k">Diagnóstico</span><span class="v">${esc(diagnostico)}</span></div>
            <div class="doc-row"><span class="k">Amostra</span><span class="v">${esc(test.sample || '-')}</span></div>
            <div class="doc-row"><span class="k">Teste solicitado</span><span class="v">${esc(test.name)}</span></div>
            <div class="doc-row"><span class="k">Data</span><span class="v">${esc(date)}</span></div>
            <div class="doc-justif">
              <div class="label">Justificativa clínica</div>
              <span>${esc(justificativa)}</span>
            </div>
            <div class="doc-sign">
              <span>Assinatura e carimbo do médico</span>
              <span>CRM ${esc(doctorCRM)}</span>
            </div>
          </div>
        </details>
        <!-- §58. Eram TRÊS blocos empilhados por programa: a barra
             "Solicitação pronta para assinar", e logo abaixo dois botões
             grandes de largura quase total. Com dois programas na tela, seis
             blocos só de ação. Agora a barra do documento E as ações moram na
             mesma linha: o rótulo explica, o botão age, e o card encolhe em
             mais de uma centena de pixels por programa. -->
        <div class="doc-actions">
          <button class="primary compacto" type="button" onclick="downloadDoc('doc-${esc(test.id)}')">Baixar PDF ↓</button>
        </div>
      </div>`;
    }).join('');

    // Nome identificado no material anexado pré-preenche o campo, mas nunca
    // sobrescreve o que o médico já digitou à mão.
    const nameInput = document.getElementById('patient-name');
    if (!nameInput.value.trim() && extractedPatientName) nameInput.value = extractedPatientName;
    updateDocs();
  }

  function updateDocs() {
    const preenchido = document.getElementById('patient-name').value.trim();
    const name = preenchido || '- (preencha o nome do paciente)';
    document.querySelectorAll('#programs-dynamic .doc-name').forEach((el) => { el.textContent = name; });

    /* §55. Sem nome, o documento é uma solicitação de exame cujo campo do
     * paciente diz "(preencha o nome do paciente)", e era possível baixar e
     * assinar exatamente isso. Documento assinado sem paciente não é um
     * rascunho: é um pedido em branco com a assinatura de um médico. O botão
     * de baixar só existe quando há nome. */
    document.querySelectorAll('#programs-dynamic .doc-actions .primary').forEach((b) => {
      b.disabled = !preenchido;
      b.title = preenchido ? '' : 'Preencha o nome do paciente para baixar o documento';
    });
    const aviso = document.getElementById('patient-name-aviso');
    if (aviso) aviso.hidden = !!preenchido;
  }

  function downloadDoc(wrapId) {
    // Segunda rede: o botão desabilitado já barra o clique, mas downloadDoc é
    // chamável por teclado em navegador antigo e por qualquer caminho futuro.
    if (!document.getElementById('patient-name').value.trim()) {
      const campo = document.getElementById('patient-name');
      campo.focus();
      campo.scrollIntoView({ block: 'center' });
      return;
    }
    /* §81. O mesmo raciocínio do §55, aplicado ao campo que o §55 esqueceu.
     * "Editar campos" torna editável TODA célula do documento, inclusive a
     * justificativa clínica, e era possível apagá-la por inteiro e baixar
     * assim mesmo. Sai um papel com a marca da plataforma, o campo
     * JUSTIFICATIVA CLÍNICA em branco e a assinatura do médico embaixo.
     * Documento assinado sem justificativa não é um rascunho: é uma
     * solicitação de exame sem a razão clínica que a sustenta. */
    const alvoPreview = document.getElementById(wrapId);
    const justif = alvoPreview && alvoPreview.querySelector('.doc-justif span');
    if (justif && !justif.textContent.trim()) {
      const detalhe = alvoPreview.closest('details');
      if (detalhe) detalhe.open = true;
      justif.scrollIntoView({ block: 'center' });
      if (typeof justif.focus === 'function') justif.focus();
      return;
    }

    document.querySelectorAll('.doc-preview-wrap').forEach((el) => el.classList.remove('print-target'));
    const alvo = document.getElementById(wrapId);
    // Um <details> fechado não entra na impressão: sem esta linha o médico
    // baixaria um PDF em branco.
    alvo.open = true;
    alvo.classList.add('print-target');

    /* §64.2. No iPhone, com o app instalado na tela de início, NÃO EXISTE
     * impressão: `window.print()` não abre nada e não lança erro, o médico
     * toca o botão e não acontece coisa alguma. Foi exatamente o relato.
     *
     * Não dá para detectar a falha depois do fato (print não devolve nada),
     * então o caminho é escolhido ANTES: em modo aplicativo, abre o documento
     * numa aba do navegador, onde o compartilhar do iOS oferece "Imprimir" e
     * "Salvar em Arquivos". Se a aba for bloqueada, baixa o arquivo. */
    if (modoAplicativo()) {
      sairDoModoImpressao();
      abrirDocumentoFora(alvo);
      return;
    }
    entrarNoModoImpressao();
    window.print();
  }

  // Instalado na tela de início (iOS usa navigator.standalone; o resto do
  // mundo usa display-mode). Em navegador comum, os dois dão falso.
  function modoAplicativo() {
    if (window.navigator && window.navigator.standalone === true) return true;
    return typeof window.matchMedia === 'function'
      && window.matchMedia('(display-mode: standalone)').matches;
  }

  /* Monta o documento como arquivo autocontido: a folha de estilo do app não
   * acompanha, então o essencial vai embutido. É o mesmo documento, não uma
   * segunda versão dele, o conteúdo sai do DOM que o médico acabou de ver. */
  function documentoAutocontido(alvo) {
    const papel = alvo.querySelector('.doc-preview');
    const nome = (document.getElementById('patient-name').value || '').trim();
    return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Solicitação: ${esc(nome)}</title>
<style>
  @page { margin: 16mm; }
  body { margin: 0; padding: 22px; background: #fff; color: #1c1c1c;
    font-family: -apple-system, BlinkMacSystemFont, "SF Pro Text", "Helvetica Neue", Helvetica, Arial, sans-serif;
    font-size: 15px; line-height: 1.5; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .doc-preview { max-width: 62ch; margin: 0 auto; position: relative; }
  .faixa { height: 3px; margin-bottom: 18px;
    background: linear-gradient(90deg, #11768f 0%, #0e6180 55%, #0b5570 100%); }
  .doc-head { display: flex; justify-content: space-between; align-items: baseline;
    gap: 6px 16px; flex-wrap: wrap; padding-bottom: 12px; margin-bottom: 18px;
    border-bottom: 1px solid #e4e9ee; }
  .doc-marca { font-size: 14px; font-weight: 700; letter-spacing: -0.02em; color: #0e6180; white-space: nowrap; }
  .doc-type { font-size: 12px; color: #6b6b6b; text-transform: uppercase; letter-spacing: .06em; text-align: right; }
  .doc-row { display: flex; justify-content: space-between; gap: 12px; font-size: 14px; padding: 8px 0; }
  .doc-row + .doc-row { border-top: 1px solid #f0f3f6; }
  .doc-row .k { color: #6b6b6b; }
  .doc-row .v { font-weight: 600; text-align: right; overflow-wrap: anywhere; }
  .doc-justif { margin-top: 16px; font-size: 14px; line-height: 1.65; color: #2a2a2a;
    background: #f6f9fb; border-left: 3px solid #0e6180; padding: 13px 15px; border-radius: 0 8px 8px 0; }
  .doc-justif .label { font-size: 12px; text-transform: uppercase; letter-spacing: .06em; color: #6b6b6b; margin-bottom: 5px; }
  .doc-sign { margin-top: 34px; padding-top: 14px; border-top: 1px solid #1c1c1c;
    display: flex; justify-content: space-between; gap: 12px; font-size: 12px; color: #6b6b6b; }
  .aviso { max-width: 62ch; margin: 26px auto 0; font-size: 12px; color: #6b6b6b; line-height: 1.5; }
  @media print { .aviso { display: none; } }
</style></head><body>
<div class="doc-preview"><div class="faixa"></div>${papel ? papel.innerHTML : ''}</div>
<p class="aviso">Para salvar em PDF ou imprimir: use o botão de compartilhar do navegador e escolha "Imprimir" ou "Salvar em Arquivos".</p>
</body></html>`;
  }

  function abrirDocumentoFora(alvo) {
    const html = documentoAutocontido(alvo);
    const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
    const endereco = URL.createObjectURL(blob);
    const aba = window.open(endereco, '_blank');
    if (!aba) {
      // Aba bloqueada: entrega o arquivo. Pior que abrir, melhor que nada
      // acontecer, que é o que acontecia antes.
      const nome = (document.getElementById('patient-name').value || 'solicitacao').trim();
      const a = document.createElement('a');
      a.href = endereco;
      a.download = `Solicitacao ${nome}.html`;
      document.body.appendChild(a);
      a.click();
      a.remove();
    }
    // O endereço temporário é liberado depois, para a aba ter tempo de ler.
    setTimeout(() => URL.revokeObjectURL(endereco), 60000);
  }
  function sairDoModoImpressao() {
    document.body.classList.remove('printing');
    document.querySelectorAll('.doc-preview-wrap').forEach((el) => el.classList.remove('print-target'));
  }
  window.addEventListener('afterprint', sairDoModoImpressao);
  // O afterprint não é confiável: em Chromium headless ele nunca dispara, e no
  // Safari do iPhone é irregular. Sem uma segunda saída, a tela fica presa no
  // modo impressão, sem topbar, sem passos, sem botões, e só volta com F5.
  // Duas redes: um tempo de segurança e a própria navegação entre passos.
  let saidaDeImpressao = null;
  function entrarNoModoImpressao() {
    document.body.classList.add('printing');
    clearTimeout(saidaDeImpressao);
    saidaDeImpressao = setTimeout(sairDoModoImpressao, 1500);
  }

  function toggleEditDoc(wrapId, btn) {
    const wrap = document.getElementById(wrapId);
    // O botão agora vive fora do painel: editar com o painel fechado não
    // mostraria nada ao médico.
    wrap.open = true;
    const editing = btn.dataset.editing === 'true';
    const fields = wrap.querySelectorAll('.doc-row .v, .doc-justif span');
    fields.forEach((el) => { el.contentEditable = String(!editing); });
    wrap.querySelector('.doc-preview').classList.toggle('editing', !editing);
    btn.textContent = editing ? 'Editar campos' : 'Concluir edição';
    btn.dataset.editing = String(!editing);
  }

  let recording = false;
  let recTimer = null;
  let recSeconds = 0;
  let speechRecognition = null;
  const SpeechRecognitionAPI = window.SpeechRecognition || window.webkitSpeechRecognition;

  function toggleVoicePanel() {
    document.getElementById('voice-panel').classList.toggle('open');
  }

  // Ditado por voz real via reconhecimento de fala nativo do navegador
  // (Web Speech API), roda só no dispositivo do médico, sem enviar áudio
  // a nenhum servidor. Funciona em Chrome/Edge; navegadores sem suporte
  // (ex.: Firefox) recebem um aviso em vez de um botão que não faz nada.
  function toggleRecording() {
    if (!SpeechRecognitionAPI) {
      document.getElementById('voice-unsupported').style.display = '';
      return;
    }

    recording = !recording;
    const wave = document.getElementById('voice-wave');
    const btn = document.getElementById('rec-btn');
    wave.classList.toggle('recording', recording);
    btn.textContent = recording ? '■' : '●';

    if (recording) {
      recSeconds = 0;
      recTimer = setInterval(() => {
        recSeconds++;
        const m = String(Math.floor(recSeconds / 60)).padStart(2, '0');
        const s = String(recSeconds % 60).padStart(2, '0');
        document.getElementById('voice-time').textContent = `${m}:${s}`;
      }, 1000);

      const textarea = document.getElementById('case-text');
      const baseText = textarea.value.trim();
      let finalTranscript = '';

      speechRecognition = new SpeechRecognitionAPI();
      speechRecognition.lang = 'pt-BR';
      speechRecognition.continuous = true;
      speechRecognition.interimResults = false;
      speechRecognition.onresult = (event) => {
        for (let i = event.resultIndex; i < event.results.length; i++) {
          if (event.results[i].isFinal) {
            finalTranscript += event.results[i][0].transcript + ' ';
          }
        }
        textarea.value = (baseText ? baseText + ' ' : '') + finalTranscript.trim();
        textarea.dispatchEvent(new Event('input'));
      };
      speechRecognition.onerror = (event) => {
        if (event.error === 'not-allowed' || event.error === 'permission-denied') {
          document.getElementById('voice-unsupported').textContent = 'Permissão de microfone negada. Autorize o acesso ao microfone no navegador e tente de novo.';
          document.getElementById('voice-unsupported').style.display = '';
        }
      };
      speechRecognition.start();
    } else {
      clearInterval(recTimer);
      document.getElementById('tile-voice').classList.toggle('selected', recSeconds > 0);
      if (speechRecognition) { speechRecognition.stop(); speechRecognition = null; }
    }
  }

  // Passo mais adiantado já alcançado de verdade. Existe porque os quatro
  // botões da barra eram clicáveis desde o início: entrar e clicar em
  // "3 Resultado da triagem" mostrava o card do veredito com o glifo ✓ VERDE
  // de sucesso, título "Resultado da triagem", texto "-" e zero testes
  // listados. Para um oncologista, um card verde com check e sem teste nenhum
  // lê exatamente como "nenhum teste indicado", que é um veredito clínico,
  // não uma tela vazia. É o pior modo de falha que esta interface tinha.
  let passoMaximo = 0;

  function liberarPasso(i) {
    if (i > passoMaximo) passoMaximo = i;
    sincronizarPassos();
  }

  function reiniciarPassos() {
    passoMaximo = 0;
    sincronizarPassos();
  }

  function sincronizarPassos() {
    document.querySelectorAll('.step-btn').forEach((el, idx) => {
      const bloqueado = idx > passoMaximo;
      el.disabled = bloqueado;
      el.setAttribute('aria-disabled', bloqueado ? 'true' : 'false');
      el.title = bloqueado ? 'Disponível depois de estruturar o caso' : '';
    });
  }

  // §57.4. Quem pediu menos movimento ao sistema operacional não pode receber
  // rolagem suave: `behavior: 'smooth'` é movimento, e é decidido em JS, onde
  // a regra de CSS não alcança. Uma função só, usada em todos os pontos.
  const QUER_MENOS_MOVIMENTO = () =>
    typeof window.matchMedia === 'function'
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const comportamentoDeRolagem = () => (QUER_MENOS_MOVIMENTO() ? 'auto' : 'smooth');

  function goTo(i) {
    // Nunca avança além do que foi realmente calculado, nem por clique na
    // barra, nem por chamada direta.
    const alvo = Math.min(i, passoMaximo);
    // Direção do movimento: avançar traz a tela da direita, voltar da
    // esquerda. Ver §57.4.
    const telas = Array.from(document.querySelectorAll('.screen'));
    const atual = telas.findIndex((el) => el.classList.contains('active'));
    document.body.dataset.sentido = (atual >= 0 && alvo < atual) ? 'tras' : 'frente';
    document.querySelectorAll('.screen').forEach((el, idx) => el.classList.toggle('active', idx === alvo));
    document.querySelectorAll('.step-btn').forEach((el, idx) => {
      el.classList.toggle('active', idx === alvo);
      el.classList.toggle('done', idx < alvo);
      if (idx === alvo) el.setAttribute('aria-current', 'step');
      else el.removeAttribute('aria-current');
      // Se a barra de passos estiver rolando (telas estreitas), traz o passo
      // atual para a área visível, senão o médico avança e o indicador de
      // onde ele está fica fora da tela.
      if (idx === alvo && el.scrollIntoView) {
        el.scrollIntoView({ behavior: comportamentoDeRolagem(), block: 'nearest', inline: 'center' });
      }
    });
    window.scrollTo({ top: 0, behavior: comportamentoDeRolagem() });
    anunciarTela(alvo);
    prepararRevelacao();
  }

  /* §76. Revelação ao rolar.
   *
   * A entrada escalonada da tela (§57.4) acerta o que está visível quando ela
   * abre. O que está abaixo da dobra animava no mesmo instante: quando o
   * médico chegava rolando, já tinha acabado. Dez programas viravam lista
   * morta.
   *
   * Três cuidados, e os três vêm de defeito já cometido neste projeto:
   *
   * 1. O ESTADO ESCONDIDO SÓ NASCE AQUI. `.revela` não existe no HTML. Se
   *    esta função não rodar, se o navegador não tiver IntersectionObserver,
   *    se o script quebrar antes, nada chega a ficar invisível. É o §67
   *    cumprido ao pé da letra, e a lição do PDF em branco.
   * 2. SÓ O QUE ESTÁ ABAIXO DA DOBRA. Esconder o que o médico já está vendo
   *    para revelar em seguida seria piscada, não apresentação.
   * 3. REDE DE SEGURANÇA. Passados 12s, tudo é liberado de qualquer forma.
   *    Um observador que não dispara, navegador com comportamento próprio,
   *    elemento que nunca cruza o limiar, não pode deixar conteúdo clínico
   *    escondido. O prazo é longo de propósito: curto demais desligaria a
   *    revelação antes de o médico terminar de ler a primeira tela.
   */
  let relogioDaRevelacao = null;
  function prepararRevelacao() {
    const tela = document.querySelector('.screen.active');
    if (!tela) return;

    const candidatos = Array.from(tela.querySelectorAll(
      '.test-step, #programs-dynamic > .card, .regras-gerais, .disclaimer, .secao',
    ));
    const liberar = (el) => { el.classList.remove('revela'); el.classList.remove('revela-visivel'); };

    // Limpa o que sobrou da tela anterior antes de qualquer coisa.
    document.querySelectorAll('.revela, .revela-visivel').forEach(liberar);
    if (relogioDaRevelacao) { clearTimeout(relogioDaRevelacao); relogioDaRevelacao = null; }

    const semMovimento = window.matchMedia
      && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (semMovimento || typeof IntersectionObserver !== 'function') return;

    /* A posição é medida em relação ao TOPO DO DOCUMENTO, não ao da janela.
     * Medir pela janela parecia certo e estava errado: esta função roda logo
     * depois do `scrollTo` para o topo, que é SUAVE, a rolagem ainda está
     * em curso, `scrollY` ainda marca a posição da tela anterior, e a conta
     * de "abaixo da dobra" saía toda deslocada. Medido assim, um caso de
     * ovário marcava 1 de 4 blocos na tela de programas e nenhum na de
     * resultado: a revelação simplesmente não acontecia.
     * Como sempre aterrissamos no topo, a dobra é a altura da janela. */
    const dobra = window.innerHeight;
    const abaixoDaDobra = candidatos.filter((el) => {
      if (el.hidden) return false;
      const r = el.getBoundingClientRect();
      const topoNoDocumento = r.top + window.scrollY;
      return r.height > 0 && topoNoDocumento > dobra - 40;
    });
    if (!abaixoDaDobra.length) return;

    abaixoDaDobra.forEach((el) => el.classList.add('revela'));

    const observador = new IntersectionObserver((entradas) => {
      entradas.forEach((entrada) => {
        if (!entrada.isIntersecting) return;
        const el = entrada.target;
        observador.unobserve(el);
        el.classList.add('revela-visivel');
        // A transição precisa de um quadro com o estado inicial ainda
        // aplicado; remover `.revela` no mesmo quadro faria o elemento
        // saltar para o lugar sem animar.
        requestAnimationFrame(() => el.classList.remove('revela'));
      });
    }, { threshold: 0.04, rootMargin: '0px 0px -5% 0px' });

    abaixoDaDobra.forEach((el) => observador.observe(el));

    relogioDaRevelacao = setTimeout(() => {
      observador.disconnect();
      abaixoDaDobra.forEach(liberar);
    }, 12000);
  }

  // Troca de tela era completamente silenciosa: o foco ficava no <body> e nada
  // era falado. Quem usa leitor de tela acionava "Estruturar caso", a tela
  // mudava, e a única pista era o Tab seguinte retomar de um ponto arbitrário
  // do DOM. Mover o foco para o título resolve as duas coisas de uma vez, o
  // anúncio e o ponto de partida da navegação.
  function anunciarTela(i) {
    const tela = document.getElementById('screen-' + i);
    if (!tela) return;
    const titulo = tela.querySelector('h1');
    const vivo = document.getElementById('anuncio-tela');
    if (vivo) vivo.textContent = `Passo ${i + 1} de 4: ${titulo ? titulo.textContent.trim() : ''}`;
    if (titulo) {
      titulo.setAttribute('tabindex', '-1');
      // Sem o atraso o foco compete com a animação de entrada da tela.
      setTimeout(() => titulo.focus({ preventScroll: true }), 80);
    }
  }

  document.querySelectorAll('.step-btn').forEach((btn, idx) => {
    btn.addEventListener('click', () => goTo(idx));
  });
  sincronizarPassos();
  // §60. O ladrilho "Texto" marcava a si mesmo quando havia texto digitado.
  // Ele não existe mais, o campo é a própria superfície. O que ainda importa
  // é o compositor saber que tem conteúdo, para "Limpar tudo" só aparecer
  // quando houver o que limpar.
  document.getElementById('case-text').addEventListener('input', atualizarRascunho);
  setupDropzone();

  // Estado inicial da revisão: o primeiro tumor da ordem de prevalência,
  // já com seus campos montados, para a tela nunca aparecer vazia caso o
  // médico navegue direto para o passo 2 antes de estruturar um caso.
  setSubtype(TUMORS.ORDER[0]);
  renderFields({});

  // ===================== PLAUD =====================
  // Três estados possíveis, todos honestos, nunca simulamos uma transcrição:
  //   indisponível  -> credenciais ainda não liberadas para esta instalação
  //   desconectado  -> disponível, o médico precisa autorizar via OAuth
  //   conectado     -> lista as gravações reais e importa a transcrição
  let plaudState = { configured: false, connected: false };

  async function refreshPlaudStatus() {
    const sub = document.getElementById('plaud-sub');
    const dot = document.getElementById('plaud-dot');
    const action = document.getElementById('plaud-action');
    const list = document.getElementById('plaud-list');

    try {
      plaudState = await api('/api/plaud/status');
    } catch (err) {
      // Falha ao verificar: a linha não aparece. Uma mensagem de erro sobre
      // uma integração que o médico nem sabe que existe não ajuda ninguém.
      document.getElementById('plaud-row').style.display = 'none';
      return;
    }

    dot.classList.toggle('on', plaudState.connected);
    list.style.display = 'none';
    list.innerHTML = '';

    if (!plaudState.configured) {
      // Indisponível: a linha inteira fica fora da tela.
      document.getElementById('plaud-row').style.display = 'none';
      action.style.display = 'none';
      return;
    }
    // Disponível de verdade: aparece, e o selo "em breve" deixa de fazer sentido.
    document.getElementById('plaud-row').style.display = '';
    document.getElementById('plaud-soon').style.display = 'none';

    action.style.display = '';
    if (plaudState.connected) {
      sub.textContent = 'Conectado. Importe a transcrição de uma gravação direto para o caso.';
      action.textContent = 'Ver gravações';
    } else {
      sub.textContent = 'Conecte sua conta Plaud para importar transcrições de consulta sem digitar.';
      action.textContent = 'Conectar';
    }
  }

  async function plaudAction() {
    if (!plaudState.connected) {
      try {
        const out = await api('/api/plaud/connect');
        window.location.href = out.url;
      } catch (err) {
        showExtractError(err.message);
      }
      return;
    }
    await loadPlaudRecordings();
  }

  async function loadPlaudRecordings() {
    const list = document.getElementById('plaud-list');
    list.style.display = '';
    list.innerHTML = '<div class="plaud-item"><span class="d">Carregando gravações...</span></div>';

    try {
      const out = await api('/api/plaud/recordings');
      list.innerHTML = '';

      if (!out.recordings.length) {
        list.innerHTML = '<div class="plaud-item"><span class="d">Nenhuma gravação encontrada na sua conta Plaud.</span></div>';
        return;
      }

      out.recordings.forEach((rec) => {
        const row = document.createElement('div');
        row.className = 'plaud-item';

        const meta = document.createElement('div');
        meta.className = 'meta';
        const title = document.createElement('div');
        title.className = 't';
        title.textContent = rec.title;
        const date = document.createElement('div');
        date.className = 'd';
        date.textContent = rec.createdAt ? new Date(rec.createdAt).toLocaleString('pt-BR') : 'Data não informada';
        meta.appendChild(title);
        meta.appendChild(date);

        const btn = document.createElement('button');
        btn.className = 'ghost';
        btn.type = 'button';
        btn.textContent = 'Importar';
        btn.onclick = () => importPlaudTranscript(rec.id, btn);

        row.appendChild(meta);
        row.appendChild(btn);
        list.appendChild(row);
      });
    } catch (err) {
      list.innerHTML = '';
      const row = document.createElement('div');
      row.className = 'plaud-item';
      const span = document.createElement('span');
      span.className = 'd';
      span.textContent = err.message;
      row.appendChild(span);
      list.appendChild(row);
      if (/expirou/i.test(err.message)) refreshPlaudStatus();
    }
  }

  async function importPlaudTranscript(recordingId, btn) {
    const original = btn.textContent;
    btn.textContent = 'Importando...';
    btn.disabled = true;
    try {
      const out = await api(`/api/plaud/transcript/${encodeURIComponent(recordingId)}`);
      const textarea = document.getElementById('case-text');
      textarea.value = (textarea.value.trim() ? textarea.value.trim() + '\n\n' : '') + out.text;
      textarea.dispatchEvent(new Event('input'));
      document.getElementById('plaud-list').style.display = 'none';
      btn.textContent = original;
    } catch (err) {
      showExtractError(err.message);
      btn.textContent = original;
    } finally {
      btn.disabled = false;
    }
  }

  function showExtractError(message) {
    const box = document.getElementById('extract-error');
    box.textContent = message;
    box.style.display = '';
    limparAvisos();
  }

  // Avisos por arquivo: o que houve com aquele anexo e o que fazer a respeito.
  // Ficam separados do erro geral porque a extração pode ter dado certo com
  // as outras fontes e mesmo assim ter algo a comunicar.
  function limparAvisos() {
    document.querySelectorAll('.aviso-arquivo').forEach((el) => el.remove());
  }

  function montaAviso(a) {
    const div = document.createElement('div');
    div.className = 'ocr-disclaimer aviso-arquivo';
    // Sem isto o médico que usa leitor de tela anexa um HEIC, o aviso
    // aparece na tela e ele não ouve absolutamente nada.
    div.setAttribute('role', 'alert');
    const motivo = document.createElement('span');
    motivo.textContent = a.motivo || '';
    div.appendChild(motivo);
    if (a.comoResolver) {
      const como = document.createElement('span');
      como.className = 'resolver';
      como.textContent = a.comoResolver;
      div.appendChild(como);
    }
    return div;
  }

  function mostrarAvisos(avisos) {
    limparAvisos();
    if (!avisos || !avisos.length) return;
    const ancora = document.getElementById('extract-error');

    // O MESMO aviso vai para as duas telas. Quando a extração falha o médico
    // fica na tela 1 e lê ali; quando dá certo ele avança para a revisão e lê
    // lá. Renderizar só na tela 1 era um aviso que ninguém via, inclusive o
    // de PDF com assinatura digital, que existia desde a v1.5.
    const naRevisao = document.getElementById('avisos-revisao');
    if (naRevisao) {
      avisos.forEach((a) => naRevisao.appendChild(montaAviso(a)));
    }

    avisos.forEach((a) => {
      const div = montaAviso(a);
      ancora.parentNode.insertBefore(div, ancora.nextSibling);
    });
  }

  function reportPlaudReturn(status) {
    const messages = {
      conectado: 'Conta Plaud conectada. Suas gravações já podem ser importadas.',
      negado: 'Você cancelou a conexão com o Plaud.',
      falha: 'Não foi possível concluir a conexão com o Plaud. Tente novamente.',
      'estado-invalido': 'O link de retorno do Plaud expirou. Inicie a conexão novamente.',
      'sem-codigo': 'O Plaud não retornou o código de autorização. Tente novamente.',
    };
    showExtractError(messages[status] || 'Retorno inesperado do Plaud.');
    refreshPlaudStatus();
  }
