# Imagem do OncoGenYX para o Cloud Run, em São Paulo (ARQUITETURA.md §86).
#
# O Cloud Build lê este arquivo a cada publicação. Só entram as dependências
# de produção: Playwright e o banco de teste (PGlite) ficam de fora, o que
# deixa a imagem menor e sem navegador nenhum dentro.

FROM node:22-bookworm-slim

ENV NODE_ENV=production
WORKDIR /app

# Dependências primeiro: enquanto package-lock.json não mudar, o Cloud Build
# reaproveita esta camada e a publicação fica mais rápida.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund

COPY . .

# Nunca rodar como root dentro do contêiner.
USER node

# O Cloud Run informa a porta em PORT (8080); o servidor já lê essa variável.
EXPOSE 8080
CMD ["node", "index.js"]
