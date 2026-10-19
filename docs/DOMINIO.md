# Domínio próprio — passo a passo

Documento operacional. Quem executa não precisa saber programar: cada passo diz
onde clicar, o que colar e como conferir se deu certo.

**Situação de partida:** a aplicação roda no Render, num endereço
`...onrender.com`. **Situação de chegada:** `oncogenyx.com.br`, com certificado
de segurança, e-mail próprio e login fechado.

Disponibilidade verificada no registro.br em **19/10/2026**: `oncogenyx.com.br`,
`oncogenyx.med.br`, `oncogenyx.net.br`, `oncogenyx.tec.br`, `oncogenyx.srv.br` e
`onco-genyx.com.br` estavam **livres**. `oncogenyx.com` também, pelo registro do
`.com` — mas esse não se registra no registro.br.

---

## Etapa 1 — Registrar o domínio (registro.br)

**Tenha em mãos:** CPF ou CNPJ. Para vender a plataforma depois, CNPJ é mais
limpo: transferir um domínio que está no nome de uma pessoa física dá mais
trabalho numa operação societária.

1. Abra **https://registro.br**.
2. Busque **`oncogenyx.com.br`** → deve aparecer "está disponível".
3. **Registrar** → crie a conta (CPF ou CNPJ) → confirme o e-mail.
   - O e-mail precisa ser um que você vá manter. É por ele que chega o aviso de
     renovação, e domínio que expira volta ao mercado.
4. Escolha o período. **3 anos** sai mais barato por ano e tira o risco de
   esquecimento.
5. Pague. **Pix libera em minutos**; boleto leva de 1 a 3 dias úteis.
6. Painel → o domínio → **Renovação automática** → ligar.

**Não contrate nada além do domínio.** O registro.br vende DNS, e-mail e
certificado; nenhum dos três é necessário. O DNS configuramos no passo 2, e o
certificado o Render emite de graça.

---

## Etapa 2 — Ligar o domínio ao Render

### 2.1 No Render

1. **https://dashboard.render.com** → serviço **`oncogenyx`**.
2. **Settings** → role até **Custom Domains** → **Add Custom Domain**.
3. Digite `oncogenyx.com.br` → **Save**.
   - O Render adiciona `www.oncogenyx.com.br` sozinho e redireciona para a raiz.
4. A tela passa a mostrar os registros a criar e fica em **"Verification
   pending"**. **Deixe essa aba aberta** — você volta aqui no passo 2.3.
5. Anote o endereço `.onrender.com` do serviço, que aparece ali. Chamaremos de
   `SEU-SERVICO.onrender.com`.

### 2.2 No registro.br

1. Painel → o domínio → **DNS** → **Editar zona** (ou **Gerenciar DNS**).
2. Crie **dois** registros:

| Tipo | Nome / Host | Valor / Dados |
|---|---|---|
| **A** | `@` *(ou deixe vazio — é a raiz)* | `216.24.57.1` |
| **CNAME** | `www` | `SEU-SERVICO.onrender.com.` |

3. **Apague qualquer registro `AAAA`** que exista. O Render só usa IPv4, e um
   `AAAA` sobrando faz o site responder de forma intermitente — o tipo de falha
   que aparece só para alguns médicos, em alguns momentos, e que é horrível de
   diagnosticar depois.
4. Apague também qualquer redirecionamento ou "estacionamento" que o painel
   tenha criado sozinho.
5. Salve.

> **Por que `A` na raiz e não `CNAME`?** O padrão do DNS não permite `CNAME` na
> raiz de um domínio. Alguns provedores contornam com `ALIAS`/`ANAME`; o
> registro.br não oferece esses tipos, então na raiz vai o `A` com o IP do
> balanceador do Render.

### 2.3 Conferir

A propagação costuma levar de minutos a algumas horas.

- Teste rápido: **https://dnschecker.org** → digite `oncogenyx.com.br` → tipo
  **A** → o valor esperado é `216.24.57.1` na maioria dos pontos.
- Volte à aba do Render. Quando verificar, o estado muda para **Verified** e o
  certificado é emitido automaticamente, em poucos minutos.
- Abra **https://oncogenyx.com.br**. Tem de carregar com o cadeado fechado.

---

## Etapa 3 — Avisar a aplicação do novo endereço

Sem isto, o CORS continua fechado e a pré-visualização do link aponta para o
endereço antigo.

1. Render → serviço **`oncogenyx`** → **Environment**.
2. **Add Environment Variable**:

| Chave | Valor |
|---|---|
| `APP_ORIGIN` | `https://oncogenyx.com.br` |

   Sem barra no fim.
3. **Save Changes**. O Render republica sozinho; espere ficar **Live**.

**Como conferir:** abra `https://oncogenyx.com.br`, veja o código-fonte da
página (`Ctrl+U`) e procure por `og:url`. Tem de aparecer
`https://oncogenyx.com.br/`. Há teste automatizado que garante que esse campo
nunca fica com o marcador por preencher, mas o valor certo depende desta
variável.

---

## Etapa 4 — Pré-visualização do link

Depois do passo 3, mande o endereço para você mesmo no WhatsApp. Tem de aparecer
o cartão com a imagem teal, o nome e a descrição — não um endereço cru.

Se vier cru, é cache do WhatsApp/LinkedIn guardando a versão antiga. Para forçar
releitura:

- **Facebook/WhatsApp:** https://developers.facebook.com/tools/debug/ → cole o
  endereço → **Scrape Again**.
- **LinkedIn:** https://www.linkedin.com/post-inspector/

---

## Etapa 5 — E-mail próprio e login fechado

> Esta etapa **exige** as anteriores concluídas: o provedor de e-mail precisa
> provar que o domínio é seu, e isso se faz por registros de DNS.

Hoje o acesso é `AUTH_MODE=simples`: **qualquer pessoa entra com qualquer nome e
CRM**. Fechar o acesso depende de conseguir enviar e-mail, e enviar e-mail
depende do domínio.

Resumo do que vem (o passo a passo detalhado sai quando chegarmos aqui):

1. Criar conta no **Resend**, adicionar `oncogenyx.com.br` como domínio
   verificado.
2. Colar no registro.br os registros `TXT`/`CNAME` que o Resend indicar (SPF,
   DKIM e DMARC) — é o que impede o e-mail de cair em spam e o que impede
   terceiros de mandarem e-mail fingindo ser você.
3. No Render, criar `RESEND_API_KEY`.
4. Trocar `AUTH_MODE` para `completo`.

**A aplicação se recusa a subir com `AUTH_MODE=completo` sem `RESEND_API_KEY` em
produção** — de propósito: subir sem e-mail deixaria o médico sem como definir
senha, com o cadastro aberto do mesmo jeito.

**Não anuncie a plataforma a nenhum médico antes desta etapa.**

---

## Sobre o HostGator

A aplicação é **Node.js**. Os planos de hospedagem compartilhada do HostGator
servem site estático e PHP — **não rodam esta aplicação**.

O arranjo correto é: **domínio registrado por você + aplicação no Render**. O
Render dá domínio personalizado e certificado de graça, inclusive no plano
gratuito. Trocar o Render pelo HostGator seria piorar a infraestrutura, não
profissionalizá-la.

Se a vontade de sair do Render tiver outro motivo (custo, hibernação de 15
minutos, expiração do banco gratuito), aí a conversa é outra e as alternativas
reais são Railway, Fly.io ou um VPS.

---

## Pendência que atravessa tudo isto

O **Postgres do plano gratuito do Render expira 30 dias depois de criado**, com
14 dias de carência. A aplicação **se recusa a subir em produção sem
`DATABASE_URL`** — por desenho, porque o disco do plano gratuito zera a cada
publicação e a cada hibernação, e sem banco a sessão de todos os médicos sumiria
sozinha.

Domínio bonito em aplicação que não sobe não resolve nada. Confira a data em
Render → **Postgres** → o banco → aba **Info** → campo **Created**.
