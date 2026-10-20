# Roteiro: levar o OncoGenYX para o Google Cloud (servidor e banco em São Paulo)

Para o senhor Renan. Escrito em 20/10/2026 pela equipe do login. O coordenador acompanha cada passo com o senhor.

**Regra de ouro deste roteiro:** só o senhor cria contas, aceita termos, paga e cola chaves. Ninguém da equipe faz isso por segurança. Onde houver uma caixa cinza com comandos, o senhor copia o bloco inteiro (botão de copiar no canto da caixa) e cola no lugar indicado. Cada bloco vem com a explicação do que ele faz, antes.

---

## 0. O que vai acontecer, em uma página

Hoje o OncoGenYX funciona como uma loja alugada fora do país: o prédio (o servidor, no Render) e a cozinha onde o laudo é lido (a IA, na Anthropic) ficam nos Estados Unidos, sem contrato com as cláusulas que a lei brasileira exige. Vamos mudar o prédio e o arquivo das contas para um shopping do Google em São Paulo. A cozinha (o Claude) continua nos Estados Unidos, porque o Google não oferece o Claude Opus 5 em São Paulo, mas passa a funcionar dentro do mesmo contrato do Google, que já traz as cláusulas-padrão da ANPD para enviar dados ao exterior.

| Peça | Hoje | Depois |
|---|---|---|
| Servidor do site | Render, EUA | **Cloud Run**, São Paulo |
| Leitura do laudo e Gena (Claude) | Anthropic, EUA, sem cláusulas da ANPD | **Claude pelo Vertex AI**, porta dos EUA do Google (`us`), sob o contrato do Google com as cláusulas da ANPD |
| Banco das contas dos médicos | não existe (contas somem) | **Cloud SQL**, São Paulo |
| Senhas e chaves | variáveis no Render | **Secret Manager**, guardado em São Paulo |
| E-mail da conta (confirmação, nova senha) | Resend | Resend, com autorização do médico no cadastro |
| Login | nome e CRM, sem senha | CRM, estado e senha, já pronto |

**Tempo do senhor:** cerca de 2 horas, de preferência numa sessão só, com o coordenador. Mais a espera do domínio (algumas horas) e da primeira publicação (uns 10 minutos).

**Custo estimado por mês, no volume da fase de teste:**

| Item | Estimativa | Observação |
|---|---|---|
| Cloud Run (servidor) | R$ 0 a R$ 30 | Há uma cota grátis mensal; só paga o que passar dela |
| Cloud SQL (banco, a menor máquina) | R$ 60 a R$ 90 | É o item fixo; roda 24 horas |
| Claude no Vertex | conforme o uso | Preço da Anthropic mais 10%, por ser a porta fixa dos EUA (a porta "global" não tem o acréscimo; ver passo 5) |
| Secret Manager e Cloud Build | centavos | |
| Domínio (registro.br) | cerca de R$ 40 por ano | |
| Resend (e-mail) | R$ 0 | Grátis até 3.000 e-mails por mês |

Os valores do Google são estimativas; o número exato aparece na calculadora oficial (cloud.google.com/products/calculator), escolhendo a região "southamerica-east1".

**O que ter à mão antes de começar:** um cartão de crédito em seu nome, o celular (para códigos de confirmação), acesso ao e-mail que vai ser do administrador e acesso à conta do GitHub onde está o código do OncoGenYX.

---

## 1. Criar a conta no Google Cloud e o faturamento

É como abrir a conta no shopping: identifica o senhor e diz como pagar o aluguel.

1. Abra **console.cloud.google.com** e entre com a sua conta Google (a do Gmail serve).
2. Aceite os Termos de Serviço do Google Cloud quando aparecerem.
3. No topo, clique em **"Ativar avaliação gratuita"** (ou **"Faturamento"**, no menu de três traços à esquerda).
4. País: **Brasil**. Tipo de conta: **Individual** (pessoa física).
   - **Atenção:** o Google avisa que o tipo de conta não muda depois. Quando houver CNPJ, cria-se outra conta de faturamento e o projeto é transferido para ela; nada se perde.
5. Preencha nome, endereço e cartão. O Google pode cobrar um valor pequeno de verificação e devolver em seguida.
6. **Alerta de gasto (importante):** no menu, vá em **Faturamento > Orçamentos e alertas > Criar orçamento**. Nome: "OncoGenYX". Valor: **R$ 200 por mês**. Deixe marcados os avisos de 50%, 90% e 100%. Clique em **Concluir**.
   - Isso não bloqueia nada; só manda e-mail ao senhor se o gasto subir. É o "aviso de luz acesa".

---

## 2. Criar o projeto

O projeto é a "sala" dentro do shopping onde tudo do OncoGenYX vai ficar.

1. No topo do console, clique no seletor de projeto (ao lado do logotipo do Google Cloud) e em **"Novo projeto"**.
2. Nome do projeto: **oncogenyx-br**.
3. Logo abaixo do nome aparece o **ID do projeto** (por exemplo, `oncogenyx-br` ou `oncogenyx-br-123456`). **Anote esse ID exatamente como aparece.** Ele será usado em vários passos.
4. Clique em **Criar** e, quando terminar, selecione o projeto novo no seletor do topo.

---

## 3. Liberar o Claude no Google (Model Garden)

O Google vende modelos de várias empresas numa "vitrine" chamada Model Garden. Para usar o Claude é preciso pedir a liberação uma vez, como habilitar um produto importado.

1. No menu de três traços, procure **Vertex AI** (em algumas telas o nome aparece como **Agent Platform**) e clique em **Model Garden**.
2. Na busca, digite **Claude Opus 5** e abra o cartão do modelo.
3. Clique em **Ativar** (ou **Enable**). O Google mostra um formulário da Anthropic sobre o uso: preencha com o nome do senhor, "OncoGenYX" e uma descrição curta, como "apoio à decisão de testagem genética em oncologia, usado por médicos".
4. Leia e aceite os termos. A liberação costuma ser imediata.

> Não use os modelos chamados **Fable** ou **Mythos**: eles guardam o conteúdo por 30 dias, e o OncoGenYX promete não guardar nada.

---

## 4. Abrir o terminal do Google (Cloud Shell)

O Cloud Shell é uma janela de comandos que roda dentro do navegador, já logada na conta do senhor. Não instala nada no computador.

1. No canto superior direito do console, clique no ícone **">_"** (Ativar o Cloud Shell).
2. Uma faixa preta abre na parte de baixo da tela. Se ele perguntar algo, clique em **Continuar** ou **Autorizar**.
3. Para colar um bloco: clique dentro da faixa preta e use **Ctrl+V** (no Mac, **Cmd+V**). Depois aperte **Enter**.
4. Se o Cloud Shell fechar ou ficar muito tempo parado, os valores do bloco 4.1 se perdem: basta colar o bloco 4.1 de novo antes de continuar.

### 4.1 Dizer ao terminal qual é o projeto

**O que faz:** guarda o ID do projeto e a região de São Paulo para os próximos comandos. **Antes de colar, troque `COLE-AQUI-O-ID-DO-PROJETO` pelo ID anotado no passo 2** (mantenha as aspas).

```bash
PROJETO="COLE-AQUI-O-ID-DO-PROJETO"
REGIAO="southamerica-east1"
gcloud config set project "$PROJETO"
```

Resposta esperada: `Updated property [core/project].`

### 4.2 Ligar os serviços que vamos usar

**O que faz:** liga, no projeto, o servidor (Cloud Run), a montagem do servidor (Cloud Build e Artifact Registry), o banco (Cloud SQL), o cofre de senhas (Secret Manager) e a IA (Vertex AI). É como ligar as chaves gerais da sala. Leva 1 a 2 minutos.

```bash
gcloud services enable run.googleapis.com cloudbuild.googleapis.com artifactregistry.googleapis.com sqladmin.googleapis.com secretmanager.googleapis.com aiplatform.googleapis.com
```

Resposta esperada: `Operation ... finished successfully.`

---

## 5. Teste de 1 minuto: o Claude responde pela porta dos EUA do Google?

**O que já se sabe.** Ao liberar o Claude Opus 5 no Model Garden, o coordenador viu que o Google oferece o modelo só em três "portas": **global**, **us** (Estados Unidos) e **eu** (Europa). **Não há São Paulo.** As fichas dos modelos no site do Google dizem o mesmo. Por isso o laudo vai ser lido nos Estados Unidos, enquanto o servidor e o banco ficam em São Paulo.

**Por que a porta "us" e não a "global".** As duas estão cobertas pelo mesmo contrato do Google, que traz as cláusulas-padrão da ANPD para transferência internacional (o que resolve o problema legal apontado no plano de conformidade). A diferença:

| | Porta `us` (escolhida) | Porta `global` |
|---|---|---|
| Onde o laudo é processado | Nos Estados Unidos | Em qualquer país onde o Google tiver capacidade livre naquele momento |
| O que dizemos ao médico | "processado nos Estados Unidos, sob contrato do Google com as cláusulas da ANPD" | "processado em país não determinado", frase que o jurídico de um hospital não aceita bem |
| Preço | Mais 10% | Sem acréscimo |

Os 10% a mais custam pouco no volume atual e compram uma frase clara e verdadeira no Aviso de Privacidade. O programa recusa a porta "global" em produção, de propósito.

**O que faz o bloco abaixo:** manda ao Claude, pela porta dos EUA do Google, a pergunta "Responda só: ok". Nenhum dado de paciente.

```bash
curl -s -X POST \
  -H "Authorization: Bearer $(gcloud auth print-access-token)" \
  -H "Content-Type: application/json" \
  "https://aiplatform.us.rep.googleapis.com/v1/projects/$PROJETO/locations/us/publishers/anthropic/models/claude-opus-5:rawPredict" \
  -d '{"anthropic_version":"vertex-2023-10-16","max_tokens":20,"messages":[{"role":"user","content":"Responda só: ok"}]}'
```

**Como ler a resposta:**

| O que aparece | O que significa | O que fazer |
|---|---|---|
| Um texto com `"text":"ok"` (ou parecido) | Tudo certo | Siga para o passo 6 |
| `PERMISSION_DENIED` ou fala em "terms" | O modelo ainda não foi liberado | Volte ao passo 3 e confira o botão Ativar |
| `NOT_FOUND` | Nome do modelo ou da porta não reconhecido | Chame o coordenador, com a mensagem inteira |
| `RESOURCE_EXHAUSTED` ou "quota" | Falta cota | Chame o coordenador: o pedido de cota é feito em "IAM e administrador > Cotas" |

## 6. Preparar a conta de serviço, o banco e o cofre

### 6.1 Criar o "crachá" do servidor

**O que faz:** cria uma identidade só para o servidor do OncoGenYX (uma "conta de serviço") e dá a ela três permissões, e só essas: usar o Claude, conectar ao banco e ler o cofre de senhas. É como um crachá de funcionário que abre só três portas.

```bash
gcloud iam service-accounts create oncogenyx-app --display-name="Servidor do OncoGenYX"
CONTA="oncogenyx-app@$PROJETO.iam.gserviceaccount.com"
for PAPEL in roles/aiplatform.user roles/cloudsql.client roles/secretmanager.secretAccessor; do
  gcloud projects add-iam-policy-binding "$PROJETO" --member="serviceAccount:$CONTA" --role="$PAPEL" --condition=None --quiet > /dev/null && echo "ok: $PAPEL"
done
```

Resposta esperada: três linhas começando com `ok:`.

### 6.2 Criar o banco de dados (leva uns 10 minutos)

**O que faz:** cria um banco PostgreSQL na menor máquina do Google, em São Paulo, com cópia de segurança automática todo dia às 3 da manhã. Depois cria o banco "oncogenyx" e um usuário com uma senha sorteada pelo próprio computador. **O senhor não precisa ver nem digitar essa senha:** ela vai direto para o cofre no passo 6.3.

```bash
gcloud sql instances create oncogenyx-db \
  --database-version=POSTGRES_16 --edition=enterprise --tier=db-f1-micro \
  --region="$REGIAO" --storage-size=10 --storage-type=SSD \
  --backup-start-time=03:00 --availability-type=zonal
gcloud sql databases create oncogenyx --instance=oncogenyx-db
SENHA_BANCO="$(openssl rand -hex 24)"
gcloud sql users create oncogenyx --instance=oncogenyx-db --password="$SENHA_BANCO"
```

Enquanto o primeiro comando roda, aparecem pontinhos. Pode demorar. Resposta esperada no fim: `Created user [oncogenyx].`

> Esta máquina menor ("db-f1-micro") é compartilhada e não tem garantia formal de disponibilidade do Google. Serve bem para a fase de teste. Quando houver contrato com um grupo de saúde, sobe-se para uma máquina dedicada com um comando, sem perder dados.

### 6.3 Guardar as senhas no cofre (Secret Manager), em São Paulo

**O que faz:** cria quatro cofres, todos guardados só em São Paulo:
- `database-url`: o endereço do banco, com a senha sorteada no passo 6.2;
- `chave-cifra`: a chave que tranca as conexões com o Plaud dentro do banco (sorteada);
- `session-secret`: a chave que assina o retorno do Plaud (sorteada);
- `resend-api-key`: fica vazio por enquanto; o senhor cola a chave do Resend no passo 7.

```bash
guardar() { printf '%s' "$2" | gcloud secrets create "$1" --data-file=- --replication-policy=user-managed --locations="$REGIAO" --quiet > /dev/null && echo "guardado: $1"; }
guardar database-url "postgresql://oncogenyx:$SENHA_BANCO@localhost/oncogenyx?host=/cloudsql/$PROJETO:$REGIAO:oncogenyx-db"
guardar chave-cifra "$(openssl rand -hex 32)"
guardar session-secret "$(openssl rand -hex 32)"
guardar resend-api-key "a-preencher"
unset SENHA_BANCO
```

Resposta esperada: quatro linhas começando com `guardado:`.

> **Nunca apague o cofre `chave-cifra`.** Se ele se perder, quem conectou o Plaud precisa conectar de novo (nada mais se perde).

---

## 7. Domínio e e-mail (fora do Google)

O e-mail de confirmação e de "esqueci a senha" precisa sair de um endereço do OncoGenYX, senão cai no lixo eletrônico. Para isso são precisos um domínio (o "endereço" na internet) e o Resend (o "carteiro").

### 7.1 Registrar o domínio

1. Abra **registro.br**, entre com o CPF do senhor e procure o nome desejado (por exemplo, `oncogenyx.com.br`).
2. Se estiver livre, registre por 1 ano e pague (cerca de R$ 40).

### 7.2 Criar a conta no Resend e ligar o domínio

1. Abra **resend.com** e crie a conta (plano grátis).
2. Em **Domains > Add Domain**, digite o domínio registrado.
   - Região de envio: pode deixar a sugerida. A escolha da região só muda por onde o e-mail sai; os dados da conta ficam nos EUA de qualquer jeito, e é por isso que o cadastro do médico pede a autorização separada (ver ARQUITETURA.md §86).
3. O Resend mostra uma lista de registros DNS (linhas com "Type", "Name" e "Value"). Abra o registro.br, entre no domínio, vá em **DNS > Editar zona** e crie cada linha exatamente como o Resend mostrou. O coordenador confere com o senhor, linha por linha.
4. Volte ao Resend e clique em **Verify**. Pode levar de minutos a algumas horas até ficar verde.
5. Em **API Keys > Create API Key**, crie uma chave com permissão **Sending access**. **Copie a chave** (começa com `re_`); ela só aparece uma vez.

### 7.3 Colar a chave do Resend no cofre

**O que faz:** troca o "a-preencher" do cofre pela chave verdadeira. O comando pede que o senhor cole a chave: **ao colar, nada aparece na tela, é de propósito.** Cole e aperte Enter.

```bash
read -rsp "Cole a chave do Resend e aperte Enter: " CHAVE && echo && printf '%s' "$CHAVE" | gcloud secrets versions add resend-api-key --data-file=- > /dev/null && echo "chave guardada" ; unset CHAVE
```

---

## 8. Publicar o servidor no Cloud Run

### 8.1 Ligar o Cloud Run ao GitHub (pelo console, com cliques)

Assim, como acontece hoje no Render, toda vez que a branch escolhida receber uma atualização aprovada, o Google monta e publica sozinho.

1. No menu, abra **Cloud Run** e clique em **Implantar contêiner > Serviço**.
2. Escolha **"Implantar continuamente de um repositório (origem ou função)"** e clique em **Configurar com o Cloud Build**.
3. **Provedor:** GitHub. Clique em **Autenticar**, entre no GitHub e autorize o "Google Cloud Build" **só no repositório do OncoGenYX**.
4. **Repositório:** o do OncoGenYX. Clique em **Avançar**.
5. **Branch:** a que o coordenador indicar (escreva o nome exato; ele confirma com o senhor). **Tipo de build:** Dockerfile. **Local da origem:** `/server/Dockerfile`. Clique em **Salvar**.
6. **Nome do serviço:** `oncogenyx`. **Região:** `southamerica-east1 (São Paulo)`.
7. **Autenticação:** marque **"Permitir acesso público"** (o site é aberto; quem protege é o login do próprio app).
8. Abra **"Contêineres, volumes, rede, segurança"** > aba **Segurança** > **Conta de serviço:** escolha **Servidor do OncoGenYX** (oncogenyx-app).
9. Clique em **Criar**.

**Atenção:** esta primeira publicação **vai aparecer com erro vermelho**, e é esperado. O servidor novo se recusa a ligar sem o banco e as chaves, de propósito, para nunca abrir sem proteção. O passo 8.2 entrega tudo isso a ele.

### 8.2 Entregar configurações e cofres ao servidor

**O que faz:** diz ao servidor onde está o banco, qual IA usar e por qual porta, quem é o administrador e qual o endereço do site; liga os quatro cofres; e define o tamanho da máquina (1 GB de memória, até 3 cópias ao mesmo tempo para nunca disparar custo, tempo máximo de 5 minutos por pedido). **Antes de colar, troque `seu-email@exemplo.com.br` pelo e-mail do administrador e `seudominio.com.br` pelo domínio do passo 7.**

```bash
URL="$(gcloud run services describe oncogenyx --region="$REGIAO" --format='value(status.url)')"
echo "Endereço do site: $URL"
gcloud run services update oncogenyx --region="$REGIAO" \
  --service-account="oncogenyx-app@$PROJETO.iam.gserviceaccount.com" \
  --add-cloudsql-instances="$PROJETO:$REGIAO:oncogenyx-db" \
  --memory=1Gi --cpu=1 --concurrency=20 --timeout=300 --min-instances=0 --max-instances=3 \
  --set-env-vars="NODE_ENV=production,AUTH_MODE=completo,IA_PROVEDOR=vertex,VERTEX_PROJETO=$PROJETO,VERTEX_REGIAO=us,DATABASE_SSL=off,APP_ORIGIN=$URL,ADMIN_EMAILS=seu-email@exemplo.com.br,MAIL_FROM=OncoGenYX <acesso@seudominio.com.br>" \
  --set-secrets="DATABASE_URL=database-url:latest,CHAVE_CIFRA=chave-cifra:latest,SESSION_SECRET=session-secret:latest,RESEND_API_KEY=resend-api-key:latest"
```

Resposta esperada no fim: `Service [oncogenyx] revision [...] has been deployed and is serving 100 percent of traffic.` e o endereço do site, terminado em `.run.app`.

> `VERTEX_REGIAO=us` é a porta dos EUA do Google para o Claude (passo 5). Todo o resto (servidor, banco e cofres) fica em São Paulo.

---

## 9. Conferir que tudo funciona

1. Abra o endereço `.../api/health` (o endereço do site com `/api/health` no fim). Deve aparecer, entre outras coisas: `"ok":true`, `"storage":"postgres"`, `"ia":"vertex us"`, `"email":"configurado"`.
2. Abra o endereço do site. Toque em **Criar acesso** e crie a conta do senhor **com o mesmo e-mail colocado em ADMIN_EMAILS**. Marque as duas caixas de autorização.
3. Abra o e-mail que chegou e toque em **Confirmar meu e-mail**. O senhor já entra.
4. Toque no seu nome (canto de cima) > **Minha conta**. Em **Últimos acessos**, confira o endereço de internet (IP). Procure no Google "qual é meu ip" e compare. **Se for diferente**, avise o coordenador: ajusta-se com uma variável (`TRUST_PROXY`), sem mudar o programa.
5. Ainda em Minha conta, deve aparecer **Administração > Conferir CRMs**. Confira o seu próprio CRM ali, como teste.
6. Faça um caso de teste **sem dado de paciente real** (por exemplo, o exemplo que aparece no campo do caso) e veja o resultado chegar.

---

## 9.1 E o endereço com o nome do OncoGenYX no site?

No começo o site fica num endereço do Google, terminado em `.southamerica-east1.run.app`. Funciona, tem cadeado (HTTPS) e não custa nada. Para trocar por um endereço com o domínio do OncoGenYX, há três caminhos:

| Caminho | Funciona em São Paulo? | Custo | Problema |
|---|---|---|---|
| Mapeamento de domínio do próprio Cloud Run | **Não.** Só existe em dez regiões, nenhuma no Brasil, e ainda está em pré-lançamento | | Não serve |
| Firebase Hosting na frente do Cloud Run | Sim, aceita São Paulo | **Grátis** no volume atual | Corta qualquer pedido que passe de **60 segundos**. A leitura de um laudo longo pode passar disso, e o médico veria erro |
| Balanceador de carga do Google | Sim | Cerca de **US$ 18 a 25 por mês** | Nenhum para o uso do OncoGenYX |

**Recomendação:** começar com o endereço `.run.app`, que é grátis, e decidir o domínio no site depois que a bateria de testes com laudos reais medir o tempo da leitura pelo Google. Se quase toda leitura terminar bem antes de 60 segundos, o Firebase Hosting serve, de graça. Se não, o balanceador. O domínio registrado no passo 7 continua sendo usado desde o primeiro dia, para os e-mails.

## 10. Desligar o que ficou para trás (só depois do passo 9 dar certo)

1. Avise os médicos do endereço novo. As contas antigas não existiam de verdade (sumiam a cada atualização), então ninguém perde nada; cada um cria a conta nova uma vez.
2. No painel do Render, **suspenda** o serviço antigo (não precisa apagar logo).
3. Em **console.anthropic.com**, apague a chave de API antiga, para nenhum caminho antigo continuar ativo. Antes, confirme com o coordenador que nenhum teste usa a chave.

---

## 11. Se algo der errado

| O que aparece | Causa provável | O que fazer |
|---|---|---|
| A publicação fica vermelha depois do passo 8.2 | Faltou uma configuração | No Cloud Run, abra o serviço > **Registros** (Logs). A primeira linha começando com `ERRO:` diz o que falta, em português |
| `ERRO: AUTH_MODE=completo em produção exige ...` | Cofre ou variável faltando | Refaça o bloco 8.2 |
| `ERRO: IA_PROVEDOR=vertex exige VERTEX_PROJETO` | Variável faltando | Refaça o bloco 8.2 |
| O site abre, mas a leitura do laudo dá erro | Claude não liberado, cota ou região | Refaça o teste do passo 5 e chame o coordenador |
| O e-mail não chega | Domínio ainda não verificado no Resend, ou chave errada | Confira o "Verify" verde no Resend; refaça o bloco 7.3 |
| `/api/health` mostra `"storage":"postgres INDISPONÍVEL"` | O servidor não alcança o banco | Confira se o bloco 6.1 mostrou os três `ok:` e se o 8.2 tem `--add-cloudsql-instances` |
| A montagem (Cloud Build) falha com `iam.serviceAccounts.actAs` | A montagem não pode publicar usando o "crachá" do servidor | Cole no Cloud Shell, depois do bloco 4.1: `gcloud iam service-accounts add-iam-policy-binding oncogenyx-app@$PROJETO.iam.gserviceaccount.com --member="serviceAccount:$(gcloud projects describe $PROJETO --format='value(projectNumber)')-compute@developer.gserviceaccount.com" --role=roles/iam.serviceAccountUser` e peça ao coordenador para refazer a publicação |
| Conta do Google pede verificação de identidade | Procedimento normal de conta nova | Siga as instruções na tela; pode levar até um dia |

---

## 12. Quem faz o quê

| Quem | O quê |
|---|---|
| **O senhor** | Contas (Google, registro.br, Resend, GitHub), cartão, aceite de termos, colar os blocos no Cloud Shell, colar a chave do Resend, os cliques do passo 8.1 |
| **O coordenador** | Acompanhar cada passo, indicar a branch do passo 8.1, conferir as linhas de DNS, ler os registros se algo falhar |
| **A equipe** | Já deixou o código pronto (ARQUITETURA.md §85 e §86) e não toca em nenhuma conta |
