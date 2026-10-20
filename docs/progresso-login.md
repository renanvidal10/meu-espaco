# Progresso: login definitivo dos médicos (Equipe 1)

Branch: `claude/login-com-senha-d75125`, partiu de 17a65bd (confirmado). Nada foi publicado.

## Estado
ETAPA 1 CONCLUÍDA em 20/10/2026: `docs/proposta-login.md` escrito (parte A para o dono, parte B técnica), com os 15 requisitos da Equipe 2 (`equipe2-requisitos-login.md` na pasta compartilhada) incorporados. NIST conferido na fonte (15 caracteres sem segundo fator, até 100 falhas, AAL2 24 h e 1 h de inatividade, e-mail proibido como segundo fator). Neon São Paulo confirmado. Render Starter US$ 7/mês confirmado em fontes secundárias.

Divergências com a Equipe 2, explicadas na proposta (A.6): inatividade de 1 h como padrão (ela sugeriu 30 min; proposta deixa cada organização escolher 30) e segundo fator só por aplicativo (ela citou código por e-mail, que o NIST proíbe).

**Próxima ação exata:** AGUARDAR a aprovação do dono às 7 decisões da seção A.6. Depois: registrar a decisão como nova seção em `docs/ARQUITETURA.md`, implementar a Fase 1 (parte B.3) na branch, com os testes de B.6 e as regressões D1 a D7, rodar `npm test`, mostrar as telas e pedir aprovação antes de qualquer publicação.

## Achados no código (conferidos em 19/10/2026)
- `server/index.js`: `AUTH_MODE` simples (nome + CRM, sem senha) ou completo (cadastro por e-mail, link de 60 min, senha, login, esqueci a senha). Completo em produção exige `RESEND_API_KEY`.
- `server/auth.js`: senha com `scryptSync` padrão (N=2^14, r=8, p=1, 16 MiB), abaixo do mínimo OWASP; e é síncrono, trava o servidor durante o cálculo. Mínimo de 10 caracteres. Tokens de sessão e de reset guardados só como hash SHA-256. Sessão fixa de 12 h.
- Limite de tentativas em memória (`Map`): zera a cada hibernação do Render. Login limitado por IP+e-mail (8/15 min): quem troca de IP tenta sem limite contra uma conta. Falta contador por conta, gravado no banco.
- Token de sessão fica em `localStorage` (exposto a qualquer script injetado). Melhor: cookie HttpOnly, Secure, SameSite.
- Cadastro do modo completo pede CRM com só 3 caracteres e sem UF separada; nenhuma conferência de CRM.
- Não há verificação de e-mail separada (o link de definir senha faz esse papel, aceitável), nem aviso de troca de senha, nem registro de eventos de acesso.
- `server/store.js`: Postgres via `DATABASE_URL` (tabelas users, sessions, resets, plaud_tokens) ou arquivo efêmero. Testes nunca tocam Postgres (bom).
- `server/email.js`: textos antigos com travessão e logotipo "O" antigo (§48); reescrever ao mexer. `escrita.test.js` só vigia tumors.js, app.js e index.html: incluir os arquivos novos.
- Contas atuais do modo simples são efêmeras: não há o que migrar.
- Node local v22 (sem `crypto.argon2`): manter scrypt com parâmetros mais fortes e formato versionado (rehash no login).

## Achados na pesquisa
- **CFM tem webservice oficial** (Res. CFM 2.309/2022): consulta por CRM + UF + chave, devolve nome, CRM, UF, tipo e situação da inscrição, especialidade; atualização diária; sem CPF, e-mail ou telefone. **R$ 948,00 por ano para empresa privada**, contratação por pessoa jurídica via SEI-Medicina pelo representante legal do contrato social, pagamento por depósito da conta da empresa, sem nota fiscal (recibo). Proibido intermediário (então serviços como Infosimples não servem). Contato: webservice@portalmedico.org.br, (61) 3770-3594 / 3566. Fonte: https://sistemas.cfm.org.br/listamedicos/informacoes e manual https://sistemas.cfm.org.br/listamedicos/arquivos/manualwebservices.pdf (2019, conferir versão atual). A busca pública do portal é grátis mas manual; automatizar ela seria contornar proteção anti robô: não fazer.
- **NIST SP 800-63B-4 (final 2025):** senha como fator único: mínimo 15 caracteres; com segundo fator: mínimo 8; aceitar até 64 ou mais; lista de senhas vazadas/comuns obrigatória; proibido exigir símbolo/maiúscula e troca periódica. (conferir) limite de 100 falhas seguidas; AAL2: reautenticar a cada 24 h e inatividade de 1 h; e-mail não vale como segundo fator; passkeys sincronizadas aceitas em AAL2. Fontes: https://pages.nist.gov/800-63-4/sp800-63b/authenticators e https://pages.nist.gov/800-63-4/sp800-63b/aal
- **ANPD:** Guia de segurança para agentes de pequeno porte (out/2021), orientativo, cita controle de acesso e autenticação; não fixa número. Conferir texto no gov.br.
- **Marco Civil da Internet, art. 15:** provedor de aplicação (PJ com fins econômicos) deve guardar registros de acesso (data, hora, IP) por 6 meses, em sigilo. Implica tabela de eventos de acesso. Cruzar com a equipe LGPD.
- **Neon:** grátis com 0,5 GB e 100 CU-hora por projeto (sobra para contas de médicos); pago "Launch" por uso, US$ 0,106 por CU-hora e US$ 0,35 por GB-mês, sem mensalidade fixa. (conferir) região São Paulo (aws sa-east-1). https://neon.com/pricing
- **Resend:** grátis 3.000 e-mails/mês, 100/dia, 1 domínio; Pro US$ 20/mês. Exige domínio próprio verificado (DNS). Domínio .com.br no registro.br custa em torno de R$ 40/ano (conferir).
- **Render:** plano grátis hiberna; Starter em torno de US$ 7/mês (conferir) para ficar sempre ligado.

## Proposta em rascunho (recomendações)
1. Cadastro: nome, CRM, UF (lista), e-mail, senha. Confirmação do e-mail por link. Sem CPF nem telefone (minimização).
2. Conferência do CRM: com o webservice do CFM, automática no cadastro (nome confere, situação ativa) e revalidada periodicamente. Até contratar: conta liberada na hora como "conferência pendente" e o dono confere no portal público por um painel simples de administração. Decisão do dono: liberar já ou só depois da conferência.
3. Entrada: e-mail ou CRM/UF + senha. Senha mínima de 12 (ou 15 conforme NIST se não houver segundo fator: decisão), sem regra de símbolo, lista local de senhas vazadas, medidor de força.
4. Segundo fator: opcional para o médico (aplicativo autenticador e, em fase seguinte, passkey com digital/Face ID), obrigatório para administrador; a organização cliente pode tornar obrigatório para os seus médicos.
5. Bloqueio: atraso progressivo por conta (não trava a conta, para ninguém conseguir trancar um médico de propósito), contador no banco, aviso por e-mail.
6. Sessão: cookie HttpOnly; máximo 12 h e inatividade de 1 h por padrão, configurável por organização; sair de todos os dispositivos; troca de senha derruba sessões.
7. Recuperação: link por e-mail de 30 min, uso único; aviso de senha alterada.
8. Registro de eventos de acesso por 6 meses (Marco Civil).
9. SSO: não implementar agora; preparar o terreno (tabela de organizações e tabela de identidades separada da senha) para entrar OIDC/SAML (Microsoft Entra, Google) sem refazer. CRM continua conferido mesmo com SSO.
10. Hash: scrypt N=2^15, r=8, p=3 assíncrono, formato versionado.

Decisões para o dono: (a) contratar o webservice do CFM (precisa de CNPJ); (b) liberar acesso antes da conferência do CRM; (c) senha 12 com 2FA opcional ou 15; (d) duração da sessão; (e) domínio próprio e quem cria contas Neon/Resend; (f) plano pago do Render.
