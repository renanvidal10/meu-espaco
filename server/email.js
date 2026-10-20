'use strict';

// Envio de email transacional via Resend (https://resend.com).
//
// Sem RESEND_API_KEY o email não é enviado. Em desenvolvimento isso é aceitável
// (o link cai no console do servidor). Em produção, um envio que falha em
// silêncio tranca o médico para fora da conta sem ninguém perceber: por isso
// aqui a falha é sempre propagada, e o index.js decide o que mostrar.
//
// Todo texto que vem do médico (o nome) passa por `esc` antes de entrar no
// HTML. Sem isso, um nome cadastrado como "<a href=...>" virava link dentro de
// um e-mail com a marca do OncoGenYX (§85, defeito D8).

const RESEND_ENDPOINT = 'https://api.resend.com/emails';

const FROM = process.env.MAIL_FROM || 'OncoGenYX <onboarding@resend.dev>';
const APP_NAME = 'OncoGenYX';

// Cores da marca (app.css, tema claro). E-mail não lê variável de CSS.
const COR = {
  fundo: '#f2f6fa', cartao: '#ffffff', borda: '#e0e8f0', tinta: '#10202e',
  apoio: '#4c6276', fraco: '#53697d', marca: '#0e6180', rodape: '#eaf1f7',
};

function isConfigured() {
  return Boolean(process.env.RESEND_API_KEY);
}

function esc(valor) {
  return String(valor == null ? '' : valor)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

async function send({ to, subject, html, text }) {
  if (!isConfigured()) {
    // Modo desenvolvimento: registra no console para o dev conseguir seguir o fluxo.
    console.warn(`[email] RESEND_API_KEY ausente. Email para ${to} NÃO foi enviado.`);
    console.warn(`[email] Assunto: ${subject}`);
    console.warn(`[email] Conteúdo:\n${text}`);
    return { delivered: false, reason: 'not_configured' };
  }

  const response = await fetch(RESEND_ENDPOINT, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ from: FROM, to: Array.isArray(to) ? to : [to], subject, html, text }),
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new Error(`Falha no envio de email (${response.status}): ${detail.slice(0, 300)}`);
  }

  return { delivered: true };
}

/**
 * Molde único dos e-mails. `paragrafos` é texto puro (escapado aqui dentro);
 * o botão é opcional. O logotipo é o ícone PNG servido pelo próprio app:
 * leitor de e-mail não mostra SVG.
 */
function layout({ origem, titulo, paragrafos, botao, nota }) {
  const logo = origem
    ? `<img src="${esc(origem)}/icone-192.png" width="28" height="28" alt="" style="vertical-align:middle;border-radius:7px;border:0;">`
    : '';
  const corpo = paragrafos
    .map((p) => `<p style="margin:0 0 14px;font-size:15px;line-height:1.6;color:${COR.apoio};">${esc(p)}</p>`)
    .join('');
  const acao = botao ? `
          <p style="margin:8px 0 22px;"><a href="${esc(botao.url)}" style="display:inline-block;background:${COR.marca};color:#ffffff;text-decoration:none;font-weight:600;font-size:15px;padding:13px 24px;border-radius:8px;">${esc(botao.rotulo)}</a></p>
          <p style="margin:0;font-size:12px;line-height:1.6;color:${COR.fraco};">Se o botão não abrir, copie este endereço no navegador:<br>
            <span style="color:${COR.marca};word-break:break-all;">${esc(botao.url)}</span></p>` : '';
  return `<!doctype html>
<html lang="pt-BR"><body style="margin:0;padding:0;background:${COR.fundo};font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${COR.fundo};padding:32px 16px;">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:${COR.cartao};border-radius:16px;overflow:hidden;border:1px solid ${COR.borda};">
        <tr><td style="padding:20px 28px;border-bottom:1px solid ${COR.borda};">
          ${logo}<span style="font-size:16px;font-weight:700;color:${COR.tinta};margin-left:9px;vertical-align:middle;">${APP_NAME}</span>
        </td></tr>
        <tr><td style="padding:28px 28px 26px;">
          <h1 style="margin:0 0 14px;font-size:20px;line-height:1.3;color:${COR.tinta};">${esc(titulo)}</h1>
          ${corpo}${acao}
        </td></tr>
        <tr><td style="padding:16px 28px;background:${COR.rodape};border-top:1px solid ${COR.borda};">
          <p style="margin:0;font-size:12px;line-height:1.55;color:${COR.fraco};">${esc(nota || 'O OncoGenYX nunca pede sua senha por e-mail, telefone ou mensagem.')}</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;
}

function texto({ titulo, paragrafos, botao, nota }) {
  return [titulo, '', ...paragrafos, ...(botao ? ['', `${botao.rotulo}: ${botao.url}`] : []), '', nota || ''].join('\n').trim();
}

function montar(conteudo) {
  return { html: layout(conteudo), text: texto(conteudo) };
}

function saudacao(name) {
  const nome = String(name || '').trim();
  return nome ? `Olá, ${nome}.` : 'Olá.';
}

/* ---------- os e-mails ---------- */

async function sendConfirmacao({ to, name, url, origem }) {
  const c = {
    origem,
    titulo: 'Confirme seu e-mail',
    paragrafos: [
      saudacao(name),
      'Sua conta no OncoGenYX foi criada. Toque no botão abaixo para confirmar que este e-mail é seu e entrar pela primeira vez.',
    ],
    botao: { rotulo: 'Confirmar meu e-mail', url },
    nota: 'Este link vale por 24 horas e só pode ser usado uma vez. Se não foi você quem criou a conta, ignore este e-mail.',
  };
  return send({ to, subject: 'OncoGenYX: confirme seu e-mail', ...montar(c) });
}

async function sendRedefinicao({ to, name, url, origem }) {
  const c = {
    origem,
    titulo: 'Criar uma nova senha',
    paragrafos: [
      saudacao(name),
      'Recebemos um pedido para criar uma nova senha na sua conta. Se não foi você, ignore este e-mail: sua senha atual continua valendo.',
    ],
    botao: { rotulo: 'Criar nova senha', url },
    nota: 'Este link vale por 30 minutos e só pode ser usado uma vez. O OncoGenYX nunca pede sua senha por e-mail.',
  };
  return send({ to, subject: 'OncoGenYX: criar uma nova senha', ...montar(c) });
}

async function sendSenhaAlterada({ to, name, origem }) {
  const c = {
    origem,
    titulo: 'Sua senha foi alterada',
    paragrafos: [
      saudacao(name),
      'A senha da sua conta no OncoGenYX acabou de ser alterada, e todas as entradas abertas em outros aparelhos foram encerradas.',
      'Se foi você, não precisa fazer nada. Se não foi, use "Esqueci minha senha" na tela de entrada agora mesmo.',
    ],
    botao: origem ? { rotulo: 'Abrir o OncoGenYX', url: origem } : null,
  };
  return send({ to, subject: 'OncoGenYX: sua senha foi alterada', ...montar(c) });
}

async function sendSenhaDesativada({ to, name, origem }) {
  const c = {
    origem,
    titulo: 'Sua senha foi bloqueada por segurança',
    paragrafos: [
      saudacao(name),
      'Houve muitas tentativas de entrada com senha errada na sua conta. Para proteger o seu acesso, a senha atual foi desativada.',
      'Para voltar a entrar, toque em "Esqueci minha senha" na tela de entrada e crie uma nova. Se não foi você quem tentou, é exatamente isso que deve fazer.',
    ],
    botao: origem ? { rotulo: 'Ir para a tela de entrada', url: origem } : null,
  };
  return send({ to, subject: 'OncoGenYX: senha bloqueada por segurança', ...montar(c) });
}

async function sendCadastroRepetido({ to, name, origem, motivo }) {
  const oQue = motivo === 'crm' ? 'o seu CRM' : 'este e-mail';
  const c = {
    origem,
    titulo: 'Tentativa de criar outra conta',
    paragrafos: [
      saudacao(name),
      `Alguém tentou criar uma conta nova no OncoGenYX usando ${oQue}, que já pertence à sua conta. Nenhuma conta nova foi criada.`,
      'Se foi você e esqueceu a senha, use "Esqueci minha senha" na tela de entrada. Se não foi você, não precisa fazer nada.',
    ],
    botao: origem ? { rotulo: 'Abrir o OncoGenYX', url: origem } : null,
  };
  return send({ to, subject: 'OncoGenYX: tentativa de criar outra conta', ...montar(c) });
}

async function sendCrmLiberado({ to, name, origem }) {
  const c = {
    origem,
    titulo: 'Seu CRM foi conferido',
    paragrafos: [
      saudacao(name),
      'Conferimos o seu registro no Conselho Federal de Medicina. Seu acesso ao OncoGenYX está liberado de forma definitiva.',
    ],
    botao: origem ? { rotulo: 'Abrir o OncoGenYX', url: origem } : null,
  };
  return send({ to, subject: 'OncoGenYX: seu acesso está liberado', ...montar(c) });
}

async function sendCrmRecusado({ to, name, origem }) {
  const c = {
    origem,
    titulo: 'Não conseguimos conferir seu CRM',
    paragrafos: [
      saudacao(name),
      'Procuramos o CRM informado no cadastro do Conselho Federal de Medicina e não encontramos um registro ativo com o seu nome. Por isso a leitura de laudos ficou bloqueada nesta conta.',
      'Se houve erro de digitação, abra "Minha conta", corrija o nome ou o CRM e a conferência é feita de novo.',
    ],
    botao: origem ? { rotulo: 'Abrir minha conta', url: origem } : null,
  };
  return send({ to, subject: 'OncoGenYX: conferência do CRM', ...montar(c) });
}

async function sendNovoCadastroAdmin({ to, medico, origem }) {
  const c = {
    origem,
    titulo: 'Novo médico aguardando conferência',
    paragrafos: [
      `${medico.name}, CRM ${medico.crm}/${medico.crm_uf}, confirmou o e-mail e está usando a liberação provisória de 48 horas.`,
      'Confira o registro no portal do CFM e marque o resultado em "Minha conta", na área de conferência de CRM.',
    ],
    botao: origem ? { rotulo: 'Abrir a conferência', url: `${origem}/?conferencia=1` } : null,
    nota: 'Você recebe este aviso porque está na lista de administradores do OncoGenYX.',
  };
  return send({ to, subject: `OncoGenYX: conferir CRM ${medico.crm}/${medico.crm_uf}`, ...montar(c) });
}

module.exports = {
  isConfigured,
  esc,
  layout,
  sendConfirmacao,
  sendRedefinicao,
  sendSenhaAlterada,
  sendSenhaDesativada,
  sendCadastroRepetido,
  sendCrmLiberado,
  sendCrmRecusado,
  sendNovoCadastroAdmin,
};
