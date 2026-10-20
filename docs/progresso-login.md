# Progresso: login definitivo e mudança para o Google Cloud (Equipe 1)

Branch: `claude/login-com-senha-d75125`. Nada foi publicado e nada foi enviado ao GitHub.

## Estado (20/10/2026)

**Etapa 1 (proposta):** concluída, `docs/proposta-login.md`.

**Etapa 2 (login, §85):** implementada, commit d1a5874. Decisões do dono em ARQUITETURA.md §85.1.

**Etapa 3 (Google Cloud em São Paulo, §86):** implementada nesta branch, aguardando o dono.
- Commit e50b2c3 (frase do áudio) trazido por cherry-pick (86da829).
- `server/ia.js`: Vertex AI (padrão em produção, porta `us`) ou API direta (padrão fora de produção), por `IA_PROVEDOR`.
- Consentimento separado para o e-mail no cadastro (LGPD art. 33, VIII), gravado em `consentimento_email_em`.
- `server/Dockerfile` e `.dockerignore`; `TRUST_PROXY` configurável.
- `docs/roteiro-google-cloud.md`: passo a passo do dono.
- Testes: `npm test` 356 passando; `test/navegador.js` 178 verificações; contraste, acessibilidade e `test/login-telas.js` passando.

**Contato de privacidade (20/10/2026):** só o e-mail renan.lvidal@gmail.com, sem nome nem cargo, na última linha do Aviso de Privacidade; retirado da entrada e de Minha conta a pedido do dono (ARQUITETURA.md §85.4). Testes: 359 passando, três rodadas seguidas; navegador e telas do login ok.

## Andamento na conta real (feito pelo coordenador com o dono)
Conta de faturamento ativa (BRL, sem créditos de avaliação), projeto `oncogenyx-br`, orçamento de alerta R$ 200, APIs ligadas, Claude Opus 5 liberado no Model Garden.

Concluídos no Cloud Shell pelo coordenador (20/10/2026): 6.1 (conta de serviço `oncogenyx-app` com aiplatform.user, cloudsql.client e secretmanager.secretAccessor), 6.2 (Cloud SQL `oncogenyx-db`, POSTGRES_16, db-f1-micro, zona southamerica-east1-c, banco e usuário `oncogenyx`) e 6.3 (segredos `database-url`, `chave-cifra`, `session-secret` e `resend-api-key` com "a-preencher", todos em southamerica-east1).

**Passo 5 falhou com 429:** num projeto novo, a cota do Claude Opus 5 é **zero** em us, eu e global. As cotas "US multi-region, base_model: anthropic-claude-opus" (pedidos, tokens de entrada e de saída por minuto) aparecem como ajustáveis. Roteiro ganhou o passo 5.1: pedir 60 pedidos/min, 500.000 tokens de entrada/min e 50.000 de saída/min na porta `us`, com justificativa em inglês pronta. O site e o login podem ir ao ar antes; só a leitura e a Gena esperam a cota.

**Próximos passos do roteiro:** 5.1 (pedir a cota, dono), 7 (domínio e Resend, dono), 8 (Cloud Run), 9 (conferir). Depois da cota aprovada: repetir o passo 5 e rodar a bateria de laudos reais pelo Vertex.

## Claude fora do Brasil (ARQUITETURA.md §86.8, 20/10/2026)
O Google oferece o Claude Opus 5 só em `global`, `us` e `eu`. Decidido `us`: laudo processado nos EUA sob o contrato do Google com as cláusulas da ANPD; servidor, banco e cofres em São Paulo. Roteiro e código ajustados (padrão `VERTEX_REGIAO=us`). Domínio próprio no site: começar com `.run.app`; depois Firebase Hosting (grátis, limite de 60 s) ou balanceador (US$ 18 a 25 por mês), conforme o tempo de leitura medido.

## Não verificado (sem conta, de propósito)
- Chamada real ao Vertex (passo 5 do roteiro).
- Montagem da imagem com Docker (Docker não instalado; conferido o boot com só as dependências de produção).
- IP correto atrás do Cloud Run (passo 9 do roteiro).
- Bateria de extração pela IA real via Vertex (§42), a rodar antes de liberar aos médicos.

## Pendências de outras equipes
- Texto dos Termos de Uso e correção do modal de privacidade ("o controlador é você"): equipe LGPD e advogado.
- Pergunta ao advogado: consentimento obrigatório para o e-mail é "livre"? Alternativa: Amazon SES em São Paulo.
- Divergências por decisão do dono: sem segundo fator e sem administrador do grupo de saúde.

## Próxima ação exata
Com o coordenador guiando, o dono segue `docs/roteiro-google-cloud.md` a partir do passo 5.1 (pedido de cota), depois 7, 8 e 9. Antes do passo 8.1, o coordenador decide qual branch o Cloud Run vai publicar (esta branch precisa ser enviada ao GitHub, com aprovação do dono). Nunca fazer push para `claude/oncology-genetic-screening-tool-81w16p` nem para `main` sem o dono mandar.
