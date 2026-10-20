# Progresso: login definitivo dos médicos (Equipe 1)

Branch: `claude/login-com-senha-d75125`, partiu de 17a65bd. Nada foi publicado e nada foi enviado ao GitHub.

## Estado (20/10/2026)

- ETAPA 1 concluída: `docs/proposta-login.md`.
- Decisões do dono recebidas em 20/10 e registradas em `docs/ARQUITETURA.md` §85.1: não contratar o webservice do CFM (conferência manual), liberar o uso por 48 h antes da conferência, senha de 8 caracteres com maiúscula e caractere especial, sessão de 1 h parada e 12 h no máximo, sem segundo fator, sem login corporativo (sempre CRM pessoal), sem fase 2.
- ETAPA 2 implementada e testada na branch (detalhes em ARQUITETURA.md §85.2 e §85.3):
  - `npm test`: 348 testes passando (eram 291).
  - `test/navegador.js`: 178 verificações passando (igual à versão anterior).
  - `test/contraste.js` e `test/acessibilidade.js`: passando.
  - `test/login-telas.js` (novo): passando no celular e no computador.
  - `test/aplicativo.js` não roda nesta máquina: aponta para `/home/user/...` (problema antigo do ambiente, não deste trabalho).
- Telas fotografadas para o dono (pasta de rascunho da sessão; para gerar de novo: `FOTOS=<pasta> CHROMIUM_PATH=... node test/login-telas.js`).

## Pendências que não são desta equipe
- Texto dos Termos de Uso e correção do modal de privacidade ("o controlador é você"): equipe LGPD e advogado.
- Divergências com os requisitos da equipe LGPD, por decisão do dono: sem segundo fator (req. 3) e sem administrador do grupo de saúde (req. 15).

## Próxima ação exata
AGUARDAR a aprovação do dono às telas e ao trabalho. Depois, só com aprovação:
1. Guiar o dono, passo a passo, para criar o banco Neon (região São Paulo), o domínio, a conta Resend com o domínio verificado e as variáveis no Render (lista em ARQUITETURA.md §85.3).
2. Publicar só quando as variáveis estiverem no Render: sem elas, este código recusa subir em produção, de propósito.
3. Nunca fazer push para `claude/oncology-genetic-screening-tool-81w16p` nem para `main` sem o dono mandar.
