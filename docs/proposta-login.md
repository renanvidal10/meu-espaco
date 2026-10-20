# Proposta: o login definitivo dos médicos no OncoGenYX

Equipe 1 (login). Versão para aprovação, 20/10/2026. Nada disto está no código ainda: pela regra 1 do projeto, a decisão do dono vem antes, e só depois entra em `docs/ARQUITETURA.md` e no código.

O documento tem duas partes:

- **Parte A, para o dono:** como o médico vai entrar, o que muda, o que o senhor precisa fazer e o que precisa decidir.
- **Parte B, técnica:** o que será construído, em que ordem, e como será testado.

Os requisitos de proteção de dados levantados pela equipe LGPD (Equipe 2) foram incorporados. Onde a minha recomendação difere da dela, isso está dito com o motivo (seção A.6).

---

# PARTE A: para o dono

## A.1 Em uma frase

Hoje qualquer pessoa que digite um nome e um número de CRM entra no OncoGenYX. A proposta é que cada médico tenha **uma conta própria, com senha, e com o CRM conferido no Conselho Federal de Medicina** antes de poder usar a ferramenta, sem pedir ao médico nada além do que ele já tem à mão.

## A.2 Como está hoje, e por que precisa mudar

Hoje funciona como a portaria de um prédio onde o porteiro anota o nome que a pessoa fala e libera a entrada sem pedir documento. Três problemas:

1. **Qualquer um entra como qualquer médico.** O nome digitado vai impresso na solicitação de exame que o médico assina. Alguém poderia gerar um documento com o nome e o CRM de outro.
2. **A conta some.** Sem banco de dados permanente, toda vez que o site é atualizado ou "dorme" por falta de uso, todas as contas são apagadas.
3. **Um grande grupo de saúde não compra assim.** Antes de contratar, o setor de segurança deles manda um questionário perguntando: tem senha? tem segundo fator? guarda registro de quem entrou? confere o registro profissional? Hoje a resposta seria "não" para tudo.

O código já tem quase metade do caminho pronto (um modo com senha e e-mail, feito na versão 1.0 e desligado desde então). A proposta reaproveita essa base e completa o que falta.

## A.3 Como o médico vai entrar, passo a passo

**Primeira vez (uma vez só, cerca de 2 minutos):**

1. O médico abre o site e toca em **"Criar acesso"**.
2. Preenche: **nome completo, número do CRM, estado do CRM** (uma lista com as 27 siglas), **e-mail** e **uma senha**. Marca a caixa de aceite dos Termos de Uso e do Aviso de Privacidade.
3. Recebe um e-mail do OncoGenYX e toca em **"Confirmar meu e-mail"**. É como o cartório que manda a carta para conferir que o endereço é mesmo seu.
4. **O CRM é conferido.** Com o serviço oficial do CFM contratado (ver decisão 1), isso acontece sozinho em poucos segundos: o sistema pergunta ao CFM se aquele CRM existe, está ativo e pertence àquele nome. Sem o serviço contratado, o senhor recebe um aviso, confere no site público do CFM e aprova com um toque; o médico recebe um e-mail "Seu acesso foi liberado".
5. Pronto. A partir daí ele entra normalmente.

**No dia a dia (alguns segundos):**

1. Digita o **e-mail** (ou, se preferir, o **CRM e o estado**) e a **senha**. O navegador do celular ou do computador oferece guardar a senha e preenche sozinho nas próximas vezes, inclusive com a digital ou o Face ID.
2. Se ficar **uma hora sem usar**, o sistema pede a senha de novo. Mesmo usando sem parar, depois de **12 horas** pede de novo. É como o caixa eletrônico que encerra a sessão se a pessoa se afasta.

**Se esquecer a senha:** toca em "Esqueci minha senha", recebe um e-mail com um link que vale 30 minutos e cria uma nova. Todas as outras entradas abertas (em outro computador, por exemplo) são encerradas na hora.

**Opcional, para quem quiser mais proteção:** em "Minha conta", o médico pode ligar o **segundo fator**: além da senha, um código de 6 números que aparece num aplicativo do celular (Google Authenticator, Microsoft Authenticator e semelhantes, todos gratuitos). É a mesma ideia do código que o banco pede. Para o médico avulso fica opcional; quando o cliente for um grupo de saúde, o grupo pode tornar obrigatório para os médicos dele.

## A.4 O que muda para o médico

| Hoje | Depois |
|---|---|
| Digita nome e CRM, e entra | Cria a conta uma vez; depois, e-mail e senha |
| Nenhuma conferência | CRM conferido no CFM antes de liberar |
| A conta some a cada atualização do site | A conta fica guardada de vez |
| Ninguém sabe quem entrou | Fica registrado data, hora e endereço de internet de cada entrada, por 6 meses, como a lei manda |
| Não há como apagar a conta | O médico vê, corrige, baixa e apaga os próprios dados quando quiser |

O que **não** muda: o caso clínico do paciente continua sem ser guardado em lugar nenhum. A conta guarda só os dados do médico.

O que **não** vamos pedir, de propósito, por ser burocracia sem ganho real: CPF, telefone, foto de documento, certificado digital, troca obrigatória de senha a cada 90 dias, senha com símbolo e letra maiúscula obrigatórios. A norma internacional mais usada hoje para senha (NIST, dos Estados Unidos, revisada em 2025) **proíbe** exigir troca periódica e símbolos obrigatórios, porque isso leva as pessoas a escolher senhas previsíveis e anotar em papel.

## A.5 O que o senhor precisa fazer (eu explico cada clique na hora)

Nenhuma destas coisas eu posso fazer pelo senhor, porque envolvem criar conta, pagar ou digitar senha em serviço externo. Quando chegar a hora, mando o passo a passo com cada clique.

| O quê | Para quê | Custo | Tempo do senhor |
|---|---|---|---|
| **Banco de dados Neon**, criado na região de São Paulo | Guardar as contas de forma permanente | Grátis para começar. Antes de vender ao grupo, o plano pago, que cobra pelo uso: estimo **US$ 5 a 20 por mês** nesse volume (conferir na hora) | 10 minutos |
| **Domínio próprio** (por exemplo `oncogenyx.com.br`), no registro.br | Os e-mails saírem de um endereço do OncoGenYX e não caírem no lixo eletrônico | Em torno de **R$ 40 por ano** (conferir) | 15 minutos |
| **Serviço de e-mail Resend**, ligado ao domínio | Mandar os e-mails de confirmação e de "esqueci a senha" | Grátis até 3.000 e-mails por mês (sobra muito); US$ 20 por mês acima disso | 20 minutos, mais a espera do domínio ser reconhecido (algumas horas) |
| **Plano pago do Render** (Starter) | O site parar de "dormir" depois de 15 minutos sem uso e demorar 1 minuto para acordar | **US$ 7 por mês** | 5 minutos |
| **Serviço oficial de consulta do CFM** | Conferir o CRM sozinho, em segundos, sem o senhor precisar olhar um por um | **R$ 948 por ano**, pago por empresa (exige CNPJ). Pedido pelo sistema SEI do CFM, em nome do representante legal da empresa | 30 minutos de cadastro, mais a espera da análise do CFM (prazo não informado) |
| **Colar as chaves no Render** | Ligar tudo isso no site | Nada | 10 minutos, comigo guiando |

Total aproximado, com tudo ligado: **cerca de R$ 1.000 por ano do CFM e do domínio, mais US$ 15 a 30 por mês** de banco, e-mail e servidor.

## A.6 O que o senhor precisa decidir

Para cada decisão, a primeira opção é a minha recomendação.

**Decisão 1. Contratar o serviço oficial do CFM?**
- **(Recomendado) Sim.** R$ 948 por ano (cerca de R$ 79 por mês). O CRM é conferido sozinho no cadastro e de novo a cada mês, então um médico que tiver o registro cassado ou suspenso perde o acesso sem ninguém precisar lembrar. É o que um grupo de saúde vai esperar. Exige que o OncoGenYX tenha CNPJ.
- Não, por enquanto. O senhor confere cada médico novo à mão no site público do CFM (cerca de 1 minuto por médico) por uma tela de aprovação que eu construo. Funciona bem com poucos médicos; não escala.
- Observação: existem empresas que revendem essa consulta, mas o próprio CFM proíbe intermediários no serviço oficial, e automatizar o site público seria burlar a proteção contra robôs dele. As duas coisas estão descartadas.
- Pergunta junto: **o OncoGenYX já tem CNPJ?**

**Decisão 2. O médico pode usar antes de o CRM ser conferido?**
- **(Recomendado) Não.** Ele cria a conta, confirma o e-mail e aguarda a liberação. Com o serviço do CFM, a espera é de segundos e ninguém percebe. Sem ele, a espera é o tempo de o senhor aprovar. É também o que pede a equipe LGPD: o nome do médico vai impresso num documento assinado.
- Sim, por até 48 horas, enquanto a conferência não sai. Menos atrito, mas por dois dias qualquer um gera documento em nome de outro.

**Decisão 3. Regra da senha**
- **(Recomendado) No mínimo 15 caracteres, sem exigir símbolo nem maiúscula, e recusando senhas conhecidas por vazamentos.** Parece muito, mas é uma frase curta e fácil de lembrar, como "caneta azul na gaveta". É exatamente o que a norma NIST de 2025 manda para quem entra só com senha. Quem guarda a senha no navegador nem digita.
- No mínimo 12 caracteres. Mais confortável, mas fica abaixo da norma e pode ser apontado no questionário de segurança de um grupo de saúde.

**Decisão 4. Quanto tempo a entrada fica aberta**
- **(Recomendado) Pede a senha de novo depois de 1 hora parado, e sempre depois de 12 horas.** É o que a norma NIST recomenda para esse nível de proteção. Com a senha guardada no navegador, voltar leva um toque.
- 30 minutos parado, como sugeriu a equipe LGPD. Mais rígido; num consultório, entre um paciente e outro, o médico vai digitar a senha várias vezes por dia. Minha sugestão é deixar 1 hora como padrão e permitir que **cada grupo de saúde cliente escolha 30 minutos** para os médicos dele, se a política interna exigir.

**Decisão 5. Segundo fator (o código do aplicativo)**
- **(Recomendado) Opcional para o médico avulso, obrigatório para o senhor (administrador) e configurável por grupo de saúde cliente.** O médico avulso não sente atrito; o grupo que exigir, liga para todos os seus médicos.
- Obrigatório para todos desde o primeiro dia. Mais seguro, mas é a maior fonte de reclamação ("perdi o celular, não consigo entrar").
- Observação: a equipe LGPD sugeriu também **código por e-mail** como segundo fator. A norma NIST de 2025 proíbe usar e-mail como segundo fator, porque quem descobre a senha muitas vezes também tem acesso ao e-mail. Por isso recomendo só o aplicativo (e, numa fase seguinte, a entrada por digital ou Face ID, chamada "passkey").

**Decisão 6. Login corporativo do grupo de saúde (o "SSO")**
Grandes grupos costumam querer que o médico entre com o mesmo usuário e senha do sistema do hospital (normalmente Microsoft ou Google), sem criar senha nova. É como o crachá do hospital abrir também a porta do OncoGenYX.
- **(Recomendado) Não construir agora, mas deixar o terreno preparado.** A estrutura da conta já nasce separando "quem é o médico" de "como ele entra", para que o login do hospital possa ser encaixado depois, em poucos dias, quando houver um cliente concreto e soubermos qual sistema ele usa. O CRM continua sendo conferido no CFM mesmo nesse caso, porque o sistema do hospital não garante o CRM.
- Construir já. Custo alto, sem saber ainda qual sistema o primeiro cliente usa.

**Decisão 7. Ordem do trabalho**
- **(Recomendado) Em duas fases.** Fase 1: tudo o que é preciso para ligar o login com senha de forma segura (descrito na Parte B). Fase 2, antes de assinar com o grupo de saúde: segundo fator, contas do grupo com administrador próprio (para o hospital cadastrar e desligar os seus médicos), entrada por digital.
- Tudo de uma vez. Demora mais para o médico ver alguma mudança.

## A.7 O que acontece com quem já usa hoje

Nada a migrar: as contas do modo atual já são apagadas a cada atualização do site. No dia da troca, quem entrar verá a tela nova de "Criar acesso". Recomendo um aviso curto na tela de entrada nas duas semanas anteriores.

---

# PARTE B: técnica

## B.1 Ponto de partida (conferido no código em 19/10/2026, commit 17a65bd)

- `AUTH_MODE=simples` é o padrão (`server/index.js`): `POST /api/auth/acesso` cria ou reaproveita conta pelo CRM normalizado e emite sessão.
- `AUTH_MODE=completo` já tem: cadastro com link de definição de senha (60 min, uso único, hash SHA-256), login, "esqueci a senha", revogação das sessões ao redefinir, respostas neutras contra enumeração, `requireAuth` por Bearer.
- `server/auth.js`: `crypto.scryptSync` com parâmetros padrão do Node (N=2^14, r=8, p=1, cerca de 16 MiB); mínimo de 10 caracteres; sessão fixa de 12 h; rate limit num `Map` em memória.
- `server/store.js`: Postgres ou arquivo; tabelas `users`, `sessions`, `resets`, `plaud_tokens`. Não existe exclusão de usuário. `plaud_tokens` em texto puro.
- Front (`server/public/app.js`): token de sessão em `localStorage`, enviado como `Authorization: Bearer`.

## B.2 Defeitos encontrados no código atual (cada um ganha teste de regressão, regra 3)

| # | Defeito | Consequência | Correção |
|---|---|---|---|
| D1 | `scryptSync` bloqueia o laço de eventos | Cada login trava o servidor inteiro por dezenas de milissegundos; 20 logins simultâneos travam todos os médicos | `crypto.scrypt` assíncrono (promisificado) |
| D2 | Parâmetros do scrypt abaixo do mínimo OWASP | Hash mais barato de quebrar se o banco vazar | N=2^15, r=8, p=3 (cerca de 32 MiB, cabe nos 512 MB) com `maxmem`; formato versionado `scrypt2$N$r$p$salt$hash`; rehash transparente no login bem sucedido |
| D3 | Limite de login só por IP+e-mail | Quem troca de IP tenta senhas sem limite contra uma conta | Contador por conta, além do por IP |
| D4 | Contador em memória | Zera a cada hibernação ou deploy | Contador no banco (tabela `tentativas`) |
| D5 | Token em `localStorage` | Um script injetado (XSS) rouba a sessão | Cookie `__Host-sessao`, HttpOnly, Secure, SameSite=Strict, Path=/ |
| D6 | Cadastro aceita CRM de 3 caracteres e sem UF | Impossível conferir no CFM | CRM numérico e UF de lista fechada, em campos separados |
| D7 | `email.js` com logotipo antigo ("O") e travessões no texto | Fora da identidade (§48) e da regra de escrita (§84) | Reescrever os modelos de e-mail; incluir `email.js` e telas novas em `escrita.test.js` |

## B.3 Decisões técnicas propostas (Fase 1)

**Identidade e cadastro**
- Campos: nome (3 a 120), CRM (somente dígitos, 1 a 7), UF (27 siglas), e-mail, senha, aceite de termos.
- `users` ganha: `crm_numero`, `crm_uf`, `email_verificado_em`, `crm_status` (`pendente`, `ativo`, `divergente`, `inativo`), `crm_conferido_em`, `crm_fonte` (`cfm_ws` ou `manual:<admin_id>`), `papel` (`medico`, `admin`), `organizacao_id` (nulo por ora), `termos_versao`, `termos_aceitos_em`, `desativado_em`.
- Unicidade em `(crm_numero, crm_uf)` e em `email`. Tentativa de cadastrar CRM já em uso: resposta neutra e aviso por e-mail ao dono da conta existente ("alguém tentou criar conta com seu CRM").
- Confirmação de e-mail por link de uso único (24 h), reaproveitando a tabela `resets` com uma coluna `finalidade` (`confirmar_email`, `redefinir_senha`).

**Conferência do CRM**
- Interface única `server/crm.js` com dois provedores: `cfm_ws` (quando `CFM_WS_CHAVE` existir) e `manual`.
- `cfm_ws`: consulta por CRM + UF; aprova se situação ativa e nome normalizado (sem acento, caixa, espaços) for compatível; nome incompatível vai para `divergente` e cai na fila manual em vez de bloquear (nome social, abreviações). Revalidação mensal das contas ativas. A especificação técnica do CFM disponível é de 2019; o contrato do CFM entrega a versão atual.
- `manual`: tela de administração (papel `admin`) com a fila de pendentes, link direto para a busca pública do CFM e botões "Conferido" e "Recusar". E-mail ao administrador a cada cadastro novo e ao médico na liberação.
- Enquanto `crm_status != 'ativo'`: sessão existe, mas `/api/extract`, `/api/chat` e a geração do documento respondem 403 com mensagem explicativa. (Se o dono escolher a opção B da decisão 2, liberação provisória de 48 h.)

**Senha**
- Mínimo 15 caracteres (decisão 3), máximo 128, espaços permitidos, normalização Unicode NFKC, nenhuma regra de composição.
- Lista local de senhas comuns e vazadas (arquivo estático com as 100 mil mais frequentes, sem chamada externa), mais termos do produto e o próprio nome, e-mail e CRM do médico.
- Medidor de força na tela, só informativo.
- Hash conforme D1 e D2.

**Tentativas e bloqueio**
- Tabela `tentativas (chave, falhas, bloqueado_ate, atualizado_em)`, com chaves por conta e por IP.
- Por conta: a partir da 5ª falha seguida, espera crescente (30 s, 1 min, 2 min, até 15 min); na 50ª falha seguida, a senha é desativada e só volta por "esqueci a senha" (NIST permite até 100; fica abaixo). Sem trava definitiva, para que um terceiro não consiga trancar um médico de propósito. E-mail ao médico quando a senha for desativada.
- Por IP: teto folgado (200 por 15 min) contra automação, sem barrar hospital atrás do mesmo IP.
- Respostas neutras mantidas ("e-mail ou senha incorretos").

**Sessão**
- Cookie `__Host-sessao` (D5). O token continua guardado só como hash.
- `sessions` ganha `ultimo_uso_em`, `ip`, `agente` (resumido: navegador e sistema). Inatividade de 1 h e teto de 12 h (decisão 4), configuráveis por organização no futuro. `ultimo_uso_em` é atualizado no máximo uma vez por minuto para não escrever no banco a cada chamada.
- Proteção contra requisição forjada: SameSite=Strict e conferência do cabeçalho `Origin` em todo método que altera estado.
- O callback do Plaud não depende do cookie (usa `state` assinado), então SameSite=Strict não o quebra; mesmo assim entra um teste.
- "Minha conta" mostra as sessões abertas e o botão "Sair de todos os dispositivos" (`deleteSessionsByUser` já existe).
- Troca de senha ou redefinição: encerra todas as sessões e manda e-mail de aviso.

**Recuperação**
- Link de 30 min, uso único, invalidado ao gerar outro (já existe; só cai de 60 para 30 min).
- O envio do e-mail passa a ser feito sem segurar a resposta, para o tempo de resposta não denunciar se a conta existe.
- Perda de acesso ao e-mail: procedimento manual pelo administrador, com conferência pelo CRM.

**Registro de acesso e trilha de auditoria** (Marco Civil art. 15; requisitos 6 e 7 da Equipe 2)
- Tabela `eventos (id, user_id nulo, tipo, ip, agente, criado_em, detalhe_json)`.
- Tipos: `cadastro`, `email_confirmado`, `crm_conferido`, `crm_recusado`, `login_ok`, `login_falha`, `logout`, `senha_trocada`, `senha_redefinida`, `senha_desativada`, `sessoes_encerradas`, `plaud_conectado`, `plaud_desconectado`, `conta_excluida`, `admin_acao`.
- Nunca registrar senha, token, conteúdo de caso ou dado de paciente. Em falha de login com e-mail inexistente, guarda só o hash do identificador.
- Retenção de 6 meses, apagada por `limparExpirados()`. Visível ao médico na própria conta (últimos acessos).

**Direitos do titular** (requisito 9)
- "Minha conta": ver e corrigir nome e e-mail (trocar e-mail exige confirmar o novo; trocar CRM ou UF volta o status para `pendente`), baixar os próprios dados em JSON (conta, sessões, eventos), excluir a conta.
- Excluir conta: apaga usuário, sessões, links, tokens do Plaud e tentativas; os eventos dos 6 meses ficam desvinculados (obrigação legal) e somem no prazo.

**Termos** (requisito 8)
- `TERMOS_VERSAO` no servidor; aceite gravado com versão e data no cadastro; versão nova pede novo aceite na próxima entrada. O texto dos termos é da Equipe 2 e do advogado.

**Tokens do Plaud** (requisito 10)
- Cifrados em repouso com AES-256-GCM e chave em `CHAVE_CIFRA` (variável de ambiente). Tokens antigos em texto puro são cifrados na primeira leitura.

**Administração**
- `papel = 'admin'` atribuído por `ADMIN_EMAILS` (variável de ambiente), nunca pela tela. Segundo fator obrigatório para administrador entra na Fase 2; até lá a tela de administração só tem a fila de conferência de CRM.

**Modo simples**
- Continua existindo para desenvolvimento e demonstração, mas o servidor passa a recusar subir com `AUTH_MODE=simples` em produção, a menos que `PERMITIR_MODO_SIMPLES=sim` seja definido de propósito. Falhar alto é melhor que deixar a porta aberta por esquecimento.

## B.4 Fase 2 (antes de assinar com o grupo de saúde)

- Segundo fator por aplicativo (TOTP, RFC 6238) com 10 códigos de recuperação de uso único; obrigatório para `admin`; política por organização.
- Passkeys (WebAuthn) como alternativa à senha, com digital ou Face ID.
- `organizacoes (id, nome, politica_json)` e papel `admin_org`: convidar, desligar e listar médicos da organização; política de inatividade e de segundo fator.
- Tabela `identidades (user_id, provedor, sujeito)` separada da senha, pronta para OIDC (Microsoft Entra ID, Google Workspace) e SAML quando houver cliente. Na Fase 1 a tabela já nasce, só com o provedor `senha`, para não exigir migração depois.

## B.5 Variáveis de ambiente

| Variável | Fase | Observação |
|---|---|---|
| `AUTH_MODE=completo` | 1 | Liga o fluxo novo |
| `DATABASE_URL` | 1 | Neon, região `aws-sa-east-1` (São Paulo). A região não muda depois de criado o projeto |
| `RESEND_API_KEY`, `MAIL_FROM` | 1 | Remetente no domínio próprio, nunca o de teste do Resend |
| `APP_ORIGIN` | 1 | Endereço oficial; os links dos e-mails dependem dele (§80) |
| `CHAVE_CIFRA` | 1 | 32 bytes aleatórios; perdê-la invalida os tokens do Plaud (o médico reconecta) |
| `ADMIN_EMAILS` | 1 | E-mail do dono |
| `SESSION_SECRET` | 1 | Já usado pelo Plaud; hoje cai num valor aleatório a cada reinício |
| `CFM_WS_CHAVE` | quando contratado | Ativa a conferência automática |

## B.6 Testes

- Unitários: hash novo e rehash do formato antigo; regras de senha e lista de bloqueio; espera progressiva; expiração por inatividade e por teto; cifra do Plaud; normalização e comparação de nome do CRM.
- Integração (servidor real em subprocesso, como `integracao.test.js`): cadastro, confirmação, conferência manual, bloqueio de `/api/extract` antes da conferência, login por e-mail e por CRM+UF, cookie com os atributos certos, recusa sem `Origin` válido, sessão expirada, redefinição encerrando sessões, exclusão de conta apagando tudo, eventos gravados sem segredo.
- Regressão para D1 a D7, um teste por defeito.
- Provedor do CFM simulado (como `stub-anthropic.js`) cobrindo ativo, inativo, inexistente, nome divergente e serviço fora do ar (cai para fila manual, nunca libera sozinho).
- `escrita.test.js` passa a vigiar `email.js` e os textos novos das telas.
- Telas no navegador (`test/navegador.js`, contraste e acessibilidade) para cada tela nova.

## B.7 Telas novas ou refeitas (atenção máxima ao design, regra 4)

Criar acesso; confirme seu e-mail; aguardando conferência do CRM; entrar; esqueci a senha; nova senha; sessão expirada; Minha conta (dados, segurança, sessões, últimos acessos, baixar dados, excluir conta); fila de conferência do administrador; os quatro modelos de e-mail com a marca atual. Tudo no sistema visual existente (`app.css`), sem fonte externa. Mostro cada tela ao dono antes de qualquer publicação.

## B.8 Fora do escopo desta equipe

Texto dos Termos e do Aviso de Privacidade, contrato de operador (DPA) com Neon, Resend e Render, e a questão da transferência internacional (o servidor do Render fica fora do Brasil): Equipe 2 e advogado.

## Fontes

- CFM, webservice de listagem de médicos (Res. CFM 2.309/2022, R$ 948 por ano para empresa privada, sem intermediários): https://sistemas.cfm.org.br/listamedicos/informacoes
- NIST SP 800-63B-4 (2025), senhas, limite de tentativas e e-mail como segundo fator: https://pages.nist.gov/800-63-4/sp800-63b/authenticators
- NIST SP 800-63B-4, tempos de sessão por nível (AAL2: 24 h e 1 h de inatividade): https://pages.nist.gov/800-63-4/sp800-63b/aal
- Marco Civil da Internet (Lei 12.965/2014), art. 15: registros de acesso por 6 meses
- Neon, preços e região de São Paulo: https://neon.com/pricing e https://neon.com/docs/introduction/regions
- Resend, preços (3.000 e-mails por mês grátis; conferir na página oficial): https://resend.com/pricing
- Render, plano Starter (US$ 7 por mês) e hibernação do plano grátis: https://render.com/pricing
