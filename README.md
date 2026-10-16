# OncoGenYX

Triagem de indicação de teste genético em oncologia. O médico descreve o caso
ou anexa o laudo, o app identifica o subtipo, aplica as regras de diretriz e
devolve **quais exames pedir, por quê, e onde solicitar** — com o documento de
solicitação pronto para assinar.

Sete sítios tumorais: ovário, mama, próstata, colorretal, pulmão, pâncreas e
endométrio.

---

## Rodar no seu computador

### 1. Instalar o Node.js (uma vez só)

Baixe em **https://nodejs.org** a versão **LTS** e instale normalmente.
Para conferir se deu certo, abra o Terminal (Mac) ou o Prompt de Comando
(Windows) e digite:

```
node --version
```

Precisa aparecer `v18` ou maior.

### 2. Baixar o projeto (uma vez só)

No Terminal, cole uma linha de cada vez:

```
git clone https://github.com/renanvidal10/meu-espaco.git
cd meu-espaco/server
npm install
```

### 3. Criar o arquivo de configuração (uma vez só)

Ainda na pasta `server`, crie um arquivo chamado **`.env`** com este conteúdo:

```
ANTHROPIC_API_KEY=cole-aqui-a-sua-chave
SESSION_SECRET=qualquer-frase-longa-e-aleatoria
AUTH_MODE=simples
PORT=3000
```

> O arquivo `.env` **nunca** vai para o GitHub — ele está no `.gitignore`.
> A chave da Anthropic é o que permite a leitura automática de laudo.

### 4. Ligar

```
npm start
```

Abra o navegador em **http://localhost:3000**.

Para desligar, volte ao Terminal e aperte **Ctrl + C**.

Da próxima vez, só precisa de dois comandos: `cd meu-espaco/server` e
`npm start`.

### Atualizar quando houver mudança

```
cd meu-espaco
git pull
cd server
npm install
npm start
```

---

## Verificar que está tudo certo

```
cd meu-espaco/server
npm run test:tudo
```

Roda as cinco baterias de uma vez:

| Bateria | O que verifica |
| --- | --- |
| `npm test` | Regras clínicas, servidor, segurança, PDF |
| `npm run test:navegador` | A jornada completa, no celular e no desktop |
| `npm run test:contraste` | Contraste WCAG AA nos dois temas |
| `npm run test:a11y` | Foco, leitor de tela, alvo de toque de 44px |
| `npm run test:aplicativo` | Instalação como aplicativo e cache sem dado clínico |

Se alguma falhar, ela diz **qual caso** quebrou e **o que era esperado**.

---

## Publicar no Render

O serviço precisa destas configurações:

| Campo | Valor |
| --- | --- |
| Branch | `main` |
| Root Directory | `server` |
| Build Command | `npm install` |
| Start Command | `npm start` |
| Auto-Deploy | ligado |

Variáveis de ambiente (aba **Environment**):

| Variável | Obrigatória | Para que serve |
| --- | --- | --- |
| `ANTHROPIC_API_KEY` | sim | Leitura automática do laudo |
| `SESSION_SECRET` | sim | Assinatura das sessões |
| `NODE_ENV` | sim | `production` |
| `DATABASE_URL` | **sim em produção** | Postgres. Ver aviso abaixo |
| `AUTH_MODE` | sim | `simples` ou `email` |
| `APP_ORIGIN` | se `AUTH_MODE=email` | Endereço público do app |
| `RESEND_API_KEY` | se `AUTH_MODE=email` | Envio de email |

> **Por que `DATABASE_URL` é obrigatória em produção:** o disco do Render no
> plano gratuito é efêmero — zera a cada publicação e a cada hibernação, que
> acontece depois de 15 minutos sem uso. Sem banco, a sessão de todos os
> médicos some sozinha. O app **se recusa a subir** em produção sem essa
> variável, de propósito: falhar na publicação é melhor que perder sessão em
> silêncio.

Também existe um `render.yaml` na raiz: criando o serviço como **Blueprint**,
o Render lê esse arquivo e já preenche build, start e a lista de variáveis.

---

## Instalar no celular

- **iPhone:** abra no Safari → botão compartilhar → *Adicionar à Tela de Início*
- **Android:** abra no Chrome → menu → *Instalar aplicativo*

Abre em tela cheia, sem barra de endereço, com o ícone de dupla hélice.

---

## Onde está o raciocínio do projeto

**`docs/ARQUITETURA.md`** é o documento mais importante do repositório. Ele
registra, em ordem, **toda decisão clínica e técnica** — o que foi feito, por
que, qual diretriz sustenta, e o que foi recusado e por quê. Quarenta e nove
seções.

Regra do projeto: **diretriz primeiro, código depois.** Nenhuma regra clínica
entra no app sem estar documentada ali, com a fonte e o critério exato que a
dispara.

**`docs/Criterios-Testagem-Genetica-OncoGenYX.pdf`** é o resumo imprimível,
com linha de assinatura, para validação por oncologista.

---

## Estrutura

```
server/
  index.js          servidor e rotas
  extracao.js       schema e prompt da leitura de laudo
  store.js          persistência (Postgres ou arquivo)
  auth.js           acesso e sessão
  public/
    index.html      o app inteiro (interface e lógica de tela)
    tumors.js       o cérebro clínico — regras dos 7 tumores
    sw.js           service worker (instalação como aplicativo)
  test/             as cinco baterias
docs/
  ARQUITETURA.md    histórico de decisões
```

O arquivo **`server/public/tumors.js`** é o coração: um registro declarativo
que, sozinho, alimenta o formulário, as regras, a tela de resultado, os cards
de programa e o documento de solicitação. Acrescentar um tumor lá aparece
automaticamente em todas essas telas.
