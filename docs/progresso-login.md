# Progresso: login definitivo e mudança para o Google Cloud (Equipe 1)

Branch: `claude/login-com-senha-d75125`. Nada foi publicado e nada foi enviado ao GitHub.

## Estado (20/10/2026)

**Etapa 1 (proposta):** concluída, `docs/proposta-login.md`.

**Etapa 2 (login, §85):** implementada, commit d1a5874. Decisões do dono em ARQUITETURA.md §85.1.

**Etapa 3 (Google Cloud em São Paulo, §86):** implementada nesta branch, aguardando o dono.
- Commit e50b2c3 (frase do áudio) trazido por cherry-pick (86da829).
- `server/ia.js`: Vertex AI (padrão em produção, região southamerica-east1) ou API direta (padrão fora de produção), por `IA_PROVEDOR`.
- Consentimento separado para o e-mail no cadastro (LGPD art. 33, VIII), gravado em `consentimento_email_em`.
- `server/Dockerfile` e `.dockerignore`; `TRUST_PROXY` configurável.
- `docs/roteiro-google-cloud.md`: passo a passo do dono.
- Testes: `npm test` 356 passando; `test/navegador.js` 178 verificações; contraste, acessibilidade e `test/login-telas.js` passando.

**Contato de privacidade (20/10/2026):** Renan Vidal, renan.lvidal@gmail.com, no rodapé da entrada e em Minha conta (ARQUITETURA.md §85.4). Testes: 359 passando, três rodadas seguidas; navegador e telas do login ok.

## Ressalva importante (ARQUITETURA.md §86.2)
A documentação do Google se contradiz sobre o Claude em São Paulo: a página de regiões lista, as fichas dos modelos não. O passo 5 do roteiro testa na conta real. Se falhar, a saída é `VERTEX_REGIAO=us` (EUA, sob o contrato do Google com cláusulas da ANPD), decisão do dono.

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
AGUARDAR o dono. Depois, com o coordenador guiando, o dono segue `docs/roteiro-google-cloud.md` do passo 1 ao 9. Antes do passo 8.1, o coordenador decide qual branch o Cloud Run vai publicar (esta branch precisa ser enviada ao GitHub, com aprovação do dono). Nunca fazer push para `claude/oncology-genetic-screening-tool-81w16p` nem para `main` sem o dono mandar.
