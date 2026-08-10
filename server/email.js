'use strict';

// Envio de email transacional via Resend (https://resend.com).
//
// Sem RESEND_API_KEY o email não é enviado. Em desenvolvimento isso é aceitável
// (o link cai no console do servidor). Em produção, um envio que falha em
// silêncio tranca o médico para fora da conta sem ninguém perceber — por isso
// aqui a falha é sempre propagada, e o index.js decide o que mostrar.

const RESEND_ENDPOINT = 'https://api.resend.com/emails';

const FROM = process.env.MAIL_FROM || 'OncoGenYX <onboarding@resend.dev>';
const APP_NAME = 'OncoGenYX';

function isConfigured() {
  return Boolean(process.env.RESEND_API_KEY);
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
    body: JSON.stringify({ from: FROM, to: [to], subject, html, text }),
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new Error(`Falha no envio de email (${response.status}): ${detail.slice(0, 300)}`);
  }

  return { delivered: true };
}

function layout({ title, intro, buttonLabel, buttonUrl, footer }) {
  return `<!doctype html>
<html lang="pt-BR"><body style="margin:0;padding:0;background:#eef2f0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#eef2f0;padding:32px 16px;">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;background:#ffffff;border-radius:14px;overflow:hidden;border:1px solid #cdd7d2;">
        <tr><td style="padding:22px 28px;border-bottom:1px solid #e4eae7;">
          <span style="display:inline-block;width:26px;height:26px;line-height:26px;text-align:center;background:#0f6b5c;color:#fff;border-radius:7px;font-weight:700;font-size:14px;">O</span>
          <span style="font-size:15px;font-weight:700;color:#1b2420;margin-left:8px;vertical-align:middle;">${APP_NAME}</span>
        </td></tr>
        <tr><td style="padding:28px;">
          <h1 style="margin:0 0 12px;font-size:19px;color:#1b2420;">${title}</h1>
          <p style="margin:0 0 22px;font-size:14px;line-height:1.6;color:#56645d;">${intro}</p>
          <a href="${buttonUrl}" style="display:inline-block;background:#0f6b5c;color:#ffffff;text-decoration:none;font-weight:600;font-size:14px;padding:12px 22px;border-radius:9px;">${buttonLabel}</a>
          <p style="margin:22px 0 0;font-size:12px;line-height:1.6;color:#6f7d76;">Se o botão não funcionar, copie e cole este endereço no navegador:<br>
            <span style="color:#0f6b5c;word-break:break-all;">${buttonUrl}</span></p>
        </td></tr>
        <tr><td style="padding:16px 28px;background:#f6f9f8;border-top:1px solid #e4eae7;">
          <p style="margin:0;font-size:11.5px;line-height:1.55;color:#6f7d76;">${footer}</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;
}

async function sendPasswordSetup({ to, name, url, isFirstAccess }) {
  const title = isFirstAccess ? 'Defina sua senha de acesso' : 'Redefinição de senha';
  const intro = isFirstAccess
    ? `Olá, ${name}. Sua conta no ${APP_NAME} foi criada. Defina uma senha para concluir o primeiro acesso — depois disso, você entra sempre com seu email e essa senha.`
    : `Olá, ${name}. Recebemos um pedido para redefinir a senha da sua conta no ${APP_NAME}. Se não foi você, pode ignorar este email com segurança — sua senha atual continua valendo.`;

  return send({
    to,
    subject: isFirstAccess ? `${APP_NAME} — defina sua senha de acesso` : `${APP_NAME} — redefinição de senha`,
    html: layout({
      title,
      intro,
      buttonLabel: isFirstAccess ? 'Definir minha senha' : 'Redefinir minha senha',
      buttonUrl: url,
      footer: 'Este link vale por 60 minutos e só pode ser usado uma vez. O OncoGenYX nunca pede sua senha por email, telefone ou mensagem.',
    }),
    text: `${title}\n\n${intro}\n\nAcesse: ${url}\n\nEste link vale por 60 minutos e só pode ser usado uma vez.`,
  });
}

module.exports = { isConfigured, sendPasswordSetup };
