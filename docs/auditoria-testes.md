# Auditoria de qualidade da suíte de testes — OncoGenYX

**Escopo:** `server/` (Node.js/Express), 179 testes em `node:test` + bateria de navegador.
**Data da medição:** 2026-08-11 · **Node:** v22.22.2 · **Commit:** `39f8ce7` · **Branch:** `claude/oncology-genetic-screening-tool-81w16p`
**Natureza:** auditoria somente-leitura. Nenhum teste novo foi criado. As mutações de código foram aplicadas e revertidas uma a uma.

---

## 1. Veredito em uma página

A suíte é **acima da média para um produto nesta fase**, e o motor de regras clínicas
(`server/public/tumors.js`) é o pedaço mais bem protegido do repositório: 99,17% de linha,
97,07% de ramo e 25 de 30 mutações clínicas mortas. Isso não é comum e deve ser dito com
todas as letras numa sala de due diligence.

O problema não está onde a suíte olha. Está **na fronteira entre o que é testado e o que roda
em produção**:

| Camada | Roda em produção? | Coberta? |
|---|---|---|
| Motor de regras (`tumors.js`) | sim (navegador) | **sim, muito bem** |
| Tratamento de PDF (`pdf.js`) | sim | sim (100% linha) |
| Rotas HTTP (`index.js`) | sim | parcial (77% linha / 72% ramo) |
| **Persistência Postgres (`store.js`)** | **sim, é o modo de produção** | **não — 0 testes, 46% linha** |
| **Pilha de senha / token de reset (`auth.js`)** | sim no `AUTH_MODE=completo` | **não** |
| **Interface (`public/index.html`)** | sim | **não — a bateria de navegador está quebrada** |
| `plaud.js` / `email.js` | sim | não (29% / 24%) |

Três achados são bloqueantes para a venda:

1. **A suíte de testes executa `DELETE` contra o banco de produção** se `DATABASE_URL` estiver
   no ambiente de quem roda `npm test`. Medido, não inferido.
2. **`npm run test:navegador` não roda** — `playwright` não é dependência declarada. Uma tier
   inteira de teste está morta e ninguém percebeu porque ela não faz parte do `npm test`.
3. **O back-end Postgres tem zero cobertura.** Todo `if (usingPostgres)` de `store.js` é código
   que nunca foi executado por um teste — inclusive o `ON CONFLICT` idempotente e o
   `consumeReset` de uso único, que são exatamente as duas correções de concorrência que os
   comentários do arquivo dizem ter sido feitas.

**Score de mutação global: 82,0% (41 mortas / 9 sobreviventes em 50 mutações dirigidas).**

---

## 2. Tabela de achados (ordenada por severidade)

| # | Sev. | Arquivo:linha | O que está errado | Correção recomendada |
|---|---|---|---|---|
| A1 | **Crítico** | `server/test/robustez.test.js:233` + `server/store.js:22` | O teste chama `store.limparExpirados()` no **processo do teste**, e `store.js` lê `DATABASE_URL` do ambiente ambiente. Com a variável exportada, a suíte roda `DELETE FROM sessions` e `DELETE FROM resets` no banco real. | Definir `DATABASE_URL=''` e `DATA_FILE=<tmp>` no topo de todo arquivo de teste que faz `require('../store.js')`, antes do require. Ou introduzir `store.criar({config})` e nunca ler `process.env` no escopo do módulo. |
| A2 | **Crítico** | `server/package.json:11`, `server/test/navegador.js:2` | `npm run test:navegador` falha com `MODULE_NOT_FOUND: playwright`. A dependência não está em `package.json`. Toda a verificação de UI — renderização das regras, `relevance()`, ramo UMD de navegador — não roda. | Declarar `playwright` em `devDependencies`, remover o caminho absoluto e o `executablePath` fixo, subir o servidor pelo próprio script (porta 0) e ligar a bateria ao CI. |
| A3 | **Crítico** | `server/store.js:25-43, 51-84, 108-110, 117-119, 134-145, 152-161, 165-167, 176-178, 189-194, 202-207, 213-221, 225-239, 241-259, 263-283, 285-291, 293-301, 310-313, 324-332` | Back-end Postgres com **zero** testes (46,11% linha / 52,78% ramo). Todo o ramo `usingPostgres` nunca executou. Ver §7 para o detalhamento risco a risco. | Subir Postgres efêmero no CI (contêiner ou `pg-mem`) e rodar a mesma bateria de contrato nos dois back-ends, com um teste de dupla escrita concorrente para `createUser` e `consumeReset`. |
| A4 | **Alto** | `server/public/tumors.js:662` e `:750` | **Mutação M17 sobreviveu.** Reduzir `has(v.mmr_msi,'dmmr','msi-alto','msi alto')` para `has(v.mmr_msi,'dmmr')` não quebra nenhum teste: os casos só usam o valor de enum `'dMMR / MSI-alto'`, que já contém `dmmr`. Os sinônimos que o médico digita à mão no campo editável (`MSI alto`, `MSI-H`) não têm caso. Se a regra regredir, um tumor dMMR escrito assim **perde a indicação de painel germinativo de Lynch** — e cai em `sem-indicacao` no colorretal localizado. | Adicionar casos com `mmr_msi: 'MSI alto'`, `'MSI-alto'` e `'MSI-H'` em colorretal e endométrio. |
| A5 | **Alto** | `server/public/tumors.js:97-100` | **Mutação M02 sobreviveu.** `estadioInicial` de `<= 2` para `< 2` passa incólume: **nenhum caso da bateria usa estádio II em nenhum tumor**. Com a regressão, ovário seroso de alto grau estádio II sai de `parcial` (só germinativo) para `provisorio` com HRD somático — indicação de teste tumoral em doença inicial, fora do critério FIGO III/IV. | Casos de fronteira em estádio II (e I) por tumor: `<=2` e `>=3` são os dois limites que definem o par somático. |
| A6 | **Alto** | `server/index.js:69-73`; teste em `server/test/robustez.test.js:108-119` | **Mutação M50 sobreviveu.** As linhas do teto por requisição aparecem como **descobertas nas 3 execuções de cobertura**. O teste chamado "requisição acima do teto por requisição é recusada" aceita `413 \|\| 400` e passa por causa do `fileSize` de 12 MB do multer, não do teto. Trocar o `if` por `if(false)` não muda nada. | Exigir `413` e a mensagem específica, com um corpo entre 12 MB e 25 MB que não dispare o multer (ex.: campo de texto, não arquivo). Cobrir também `TETO_BYTES_EM_VOO` com duas requisições simultâneas. |
| A7 | **Alto** | `server/pdf.js:175` | **Mutação M36 sobreviveu.** Trocar `&&` por `\|\|` em `ehRecusaDePdf` é indetectável: os três casos negativos do teste (`rate_limit_error…`, `overloaded`, `undefined`) não casam nenhum dos dois lados. Medido, sob a mutação `"invalid x-api-key"`, `"invalid_request_error: bad field"`, `"could not process request"` e `"image is corrupt"` passariam a ser tratados como recusa de PDF — disparando extração local e **uma segunda chamada paga** a cada erro 401. | Casos negativos que casem **um lado só**: `'invalid x-api-key'` (casa o 2º, não o 1º) e `'pdf recebido com sucesso'` (casa o 1º, não o 2º). |
| A8 | **Alto** | `server/auth.js:24-28, 30-39, 43-53, 82-86, 88-91, 131-134` | Pilha de senha (`hashPassword`, `verifyPassword`, `validatePassword`) e de token de redefinição (`issueResetToken`, `consumeResetToken`) com **zero** testes. `isValidEmail` também — e ela contém a trava anti-takeover que recusa o domínio interno `@acesso.oncogenyx` (`auth.js:129-133`). Sem teste, essa trava pode cair num refactor e alguém se cadastra com o email sintético de um CRM e assume a conta daquele médico. | Testes unitários diretos: round-trip scrypt, rejeição de hash malformado, `timingSafeEqual` com comprimentos diferentes, uso único do token de reset, expiração, e a recusa explícita de `@acesso.oncogenyx`. |
| A9 | **Alto** | `server/index.js:1046-1056` | **Código morto comprovado.** `process.nextTick` roda antes do `.then()` de `store.init()`, então `servidor` é sempre `null` quando o guarda é avaliado e o listener de `'error'` **nunca é anexado**. Porta ocupada não produz a mensagem amigável prometida pelo comentário. Sem teste. | Anexar o listener dentro do `.then()`, junto do `app.listen`, e cobrir com um teste que sobe dois servidores na mesma porta e afirma a mensagem e o código de saída. |
| A10 | **Alto** | `server/test/robustez.test.js:76, 85, 93, 101, 208, 240, 249` | **7 testes verificam o código-fonte com `assert.match(fonte('index.js'), /regex/)`, não comportamento.** Passam se a string existir em qualquer lugar do arquivo, inclusive num comentário. Dão a impressão de que travas de robustez estão verificadas quando o que está verificado é a presença de texto — foi exatamente o que deixou A6 passar. | Converter cada um em teste de comportamento observável (resposta HTTP, código de saída, efeito medido). Onde não houver comportamento observável, marcar explicitamente como *lint de arquitetura*, não como teste. |
| A11 | Médio | `server/public/tumors.js:158`; `server/test/regras.test.js:55` | **Mutação M28 sobreviveu.** `montaDx` pode parar de acrescentar o órgão (`"Carcinoma seroso"` em vez de `"Carcinoma seroso de ovário"`) sem quebrar nada — o texto vai impresso na solicitação que o médico assina. Agrava: as asserções comparam com `.toLowerCase()`, o que também esconde o defeito de caixa hoje presente (`"Carcinoma Seroso de ovário, alto grau, estágio IIIC"`). | Asserção exata (`strictEqual`) do diagnóstico completo em pelo menos um caso por tumor, sem `toLowerCase`. |
| A12 | Médio | `server/index.js:305` | **Mutação M40 sobreviveu.** O teto de 120 caracteres do nome em `POST /api/auth/acesso` não tem teste. O único teste de nome longo (`robustez.test.js:282`) usa `PATCH /api/auth/me`. Nome de 5000 caracteres entra pelo acesso e vai impresso no documento assinado. | Espelhar o caso de nome longo/controle nas duas rotas. |
| A13 | Médio | `server/pdf.js:52` | **Mutação M31 sobreviveu.** O limite de 400 bytes do desembrulho pode cair para 40 sem detecção — o teste de "PDF interno pequeno demais" usa 12 bytes, que continua abaixo dos dois valores. Fragmento de `%PDF-` entre 40 e 400 bytes passaria a ser recortado e enviado à API paga. | Caso de fronteira com conteúdo interno de ~399 e ~401 bytes. |
| A14 | Médio | `server/public/tumors.js:89-91` | **Código morto.** `estadioIlegivel` é exportada em `helpers` e **nunca chamada** em lugar nenhum (`index.js`, `index.html`, testes). Cobertura confirma: linhas 90-91 descobertas. A mutação M30 sobreviveu por isso. | Remover, ou ligar ao texto do resultado (era esse o propósito declarado no comentário: não dizer "não informado" quando há informação ilegível). |
| A15 | Médio | `server/test/robustez.test.js:14` (+`:233`) | A suíte **reescreve `server/.data/oncogenyx.json`**, o arquivo de dados real do desenvolvedor. Medido: md5 `f933e268…` → `e19450aa…` após um `npm test`. Está no `.gitignore`, então a árvore fica limpa e ninguém nota — mas é estado compartilhado real entre execuções. | Mesmo remédio de A1: `DATA_FILE` apontando para `mkdtemp` no processo de teste. |
| A16 | Médio | `integracao.test.js:46`, `gena.test.js:67`, `seguranca.test.js:34`, `robustez.test.js:31` | **5 diretórios temporários vazados por execução**, nunca removidos. Medido: 721 → 726 num único `npm test`; 726 acumulados na máquina. | `test.after()` com `fs.rmSync(dir,{recursive:true,force:true})` em cada arquivo. |
| A17 | Médio | `server/plaud.js:29-166` | 29,14% linha / **8,33% funções**. Cinco das seis exportadas sem nenhum teste (`authorizeUrl`, `exchangeCode`, `listRecordings`, `fetchTranscript`, `redirectUri`). O módulo faz `fetch` para `api.plaud.ai`: no dia em que as credenciais entrarem no ambiente, a suíte passa a bater na rede. | Testar contra um stub HTTP local (o padrão de `stub-anthropic.js` já existe e serve). Cobrir `normalizeRecording`/`extractTranscriptText`, que são puras e baratas. |
| A18 | Médio | `server/email.js:19-89` | 24,18% linha / **25% funções**. `sendPasswordSetup` e `layout` sem teste. `layout()` interpola `name` e `url` **crus** no HTML (`email.js:56-60`) — sem teste que fixe o escape. | Testar `layout()` com nome contendo `<script>` e afirmar que sai escapado; testar `send()` sem chave (não entrega, não lança) e com erro HTTP (propaga). |
| A19 | Médio | `server/index.js:480-485, 489, 505-596, 942-947` | Sem teste: `POST /api/auth/logout` (e `store.deleteSession`, função inteira descoberta), `GET /api/auth/me`, `GET /api/config` e **todo o bloco Plaud** — incluindo `signState`/`verifyState` (`index.js:515-532`), que é uma verificação HMAC com janela de 10 min. | Cobrir logout (token revogado deixa de autenticar), `/api/config`, e `verifyState` com assinatura inválida, tamanho divergente e estado expirado. |
| A20 | Médio | `server/test/robustez.test.js:295-298` | **Asserção condicional:** `if (controle.status === 200) { … }`. Se o servidor devolver 400, o teste termina sem executar asserção nenhuma sobre o caractere de controle. Hoje o `if` provavelmente não entra — o teste passa sem testar. | Decidir o contrato (400 *ou* 200 sanitizado) e afirmar os dois ramos explicitamente. |
| A21 | Médio | `server/test/gena.test.js:234-345` | Os 10 "roteiros de conversa real" são o caso de **mock que devolve exatamente o que o teste espera**: o stub retorna a string `turno.gena` escrita no próprio roteiro, e as asserções verificam que o servidor retirou `CASO_PRONTO` dela. Não existe lógica conversacional no servidor além dessa regex — são 10 testes exercitando duas linhas (`index.js:681-682`). Inflacionam a contagem (10 de 179) sem poder de detecção. | Manter 2 (marcador presente / ausente) e mover os outros 8 para uma avaliação de comportamento do modelo, fora do `npm test`. |
| A22 | Médio | `gena.test.js:364, 379, 391, 407`; `integracao.test.js:439` | 5 testes afirmam substrings dentro das constantes de prompt (`UNIFIED_SYSTEM_PROMPT`, `GENA_SYSTEM_PROMPT`). Testam texto contra si mesmo: quebram em qualquer reescrita legítima e não conseguem detectar um prompt ruim. | Reduzir ao que é contrato verificável (os 7 rótulos e os campos decisivos vêm de `TUMORS`, isso é bom) e descartar as asserções estilísticas (`/emoji/i`, `/marcadores/i`). |
| A23 | Médio | `server/index.js:752-758` | **Cobertura não determinística:** as linhas do aviso de imagem de 0 byte aparecem cobertas em 2 de 3 execuções idênticas (índice global de `index.js` oscilando entre 76,70% e 77,37%). Indica um caminho alcançado por corrida — provavelmente o multipart truncado de `robustez.test.js:157`. | Adicionar um teste determinístico de imagem de 0 byte; oscilação de cobertura em auditoria de produto médico é ruído que custa caro explicar. |
| A24 | Baixo | `server/test/robustez.test.js:297` | O arquivo contém **bytes de controle crus** (`0x00`, `0x1F`, `0x7F`) dentro de uma classe de regex. `git` e `grep` tratam o arquivo como binário ("binary file matches"), o que degrada diff, revisão de código e busca. | Escrever a classe como `/[\x00-\x1f\x7f]/`. |
| A25 | Baixo | `server/test/navegador.js:4, 6, 45` | Caminho absoluto `/home/user/meu-espaco/...`, `BASE` fixo em `localhost:3311` (exige servidor subido à mão) e `executablePath: '/opt/pw-browsers/chromium'`. Não roda em outra máquina nem em CI. | Caminho relativo, porta efêmera, servidor subido pelo próprio script, browser resolvido pelo Playwright. |
| A26 | Baixo | `server/public/tumors.js:17` | O ramo UMD de navegador (`root.TUMORS = factory()`) nunca é exercitado por `node:test` — é justamente o ramo que roda em produção. Cobertura confirma linha 17 descoberta. | Coberto de graça assim que A2 for resolvido. |
| A27 | Baixo | `server/public/tumors.js:1027-1028` | **Mutação M29 sobreviveu.** O casamento por normalização em `encaixarValor` é **redundante**: a estratégia seguinte (por inclusão, `norm(o).includes(norm(bruto))`) já cobre todos os casos testados. A suíte não distingue as duas. | Ou remover o ramo, ou adicionar um caso que só ele resolve. |
| A28 | Baixo | `integracao.test.js:47`, `gena.test.js:68`, `seguranca.test.js:35`, `robustez.test.js:32` | Portas por faixa aleatória (`4300+rand(500)`, `4800+rand(400)`, `5200+rand(400)`, `5600+rand(300)`). As faixas são disjuntas — bom desenho —, mas não há retry: uma porta ocupada por qualquer outro processo derruba o arquivo inteiro após 12 s com a mensagem genérica "o servidor não subiu a tempo". | `listen(0)` e ler a porta efetiva, ou retry com nova porta. |
| A29 | Baixo | `server/abc` | Socket unix órfão dentro de `server/`. Não versionado, mas presente no diretório de trabalho — resíduo de experimento. | Remover; adicionar ao `.gitignore` se for recorrente. |
| A30 | Baixo | `server/test/regras.test.js:38` | De 57 casos clínicos, 9 não declaram `testes:`. Oito são estados `insuficiente`/`nao-reconhecida` (onde não há testes a afirmar — correto); apenas 1 é lacuna real: *"histologia com prefixo do laudo"* verifica só o `state`. | Declarar `testes:` também nesse caso. |

---

## 3. Cobertura por linha e por ramo

Comando: `node --test --experimental-test-coverage test/*.test.js` (Node 22.22.2, cobertura nativa).
Nota metodológica: a instrumentação **propaga para os processos filhos** (os testes sobem `index.js` via `spawn` herdando `NODE_V8_COVERAGE`), então os números de `index.js` refletem execução real por HTTP.

```
file                | line % | branch % | funcs % |
--------------------|--------|----------|---------|
auth.js             |  72.32 |    92.00 |   50.00 |
email.js            |  24.18 |   100.00 |   25.00 |
index.js            |  77.37 |    72.02 |   59.68 |
pdf.js              | 100.00 |    92.31 |   71.43 |
plaud.js            |  29.14 |    66.67 |    8.33 |
public/tumors.js    |  99.17 |    97.07 |   97.06 |
store.js            |  46.11 |    52.78 |   64.29 |
--------------------|--------|----------|---------|
all files           |  87.99 |    90.01 |   87.20 |
```

**Onde os números enganam.** `email.js` marca 100% de ramo com 24% de linha e 25% de funções:
o único ramo executado é o `if (!isConfigured())` no início de `send()`. Um percentual de ramo
alto sobre um corpo de código nunca chamado não é sinal de qualidade — é artefato.
`auth.js` com 92% de ramo e **50% de funções** conta a mesma história: metade das funções
exportadas nunca foi chamada por um teste.

**O que está descoberto e por que importa:**

- **`store.js` — todo o ramo Postgres.** É o modo de produção. Ver §7.
- **`auth.js:24-53` (senha), `:82-91` (reset), `:131-134` (validação de email).** Operacional e de
  segurança: a trava do domínio interno (A8) é um controle anti-takeover sem rede de proteção.
- **`index.js:69-79`** — teto de memória por requisição, a defesa medida contra SIGKILL em
  cgroup de 512 MB. Nunca executada (A6). Se ela regredir, o sintoma em produção é o processo
  morrendo e, com disco efêmero, **deslogando todos os médicos ao mesmo tempo**.
- **`index.js:368-476`** — `register`, `request-reset`, `set-password`, `login`. Todo o
  `AUTH_MODE=completo` está desligado hoje e sem teste; é o caminho que a health tech vai
  querer ligar no dia 1.
- **`index.js:505-596`** — bloco Plaud inteiro, incluindo a verificação HMAC do `state` do OAuth.
- **`index.js:871-872`** — resposta da API sem bloco de texto → 502. Caminho de erro do fornecedor.
- **`index.js:1050-1054`** — código morto (A9).
- **`tumors.js:17`** — o ramo UMD que roda no navegador (A26).
- **`tumors.js:90-91`** — `estadioIlegivel`, função morta (A14).
- **`tumors.js:278-283`** — `ovario.relevance()`, consumida só por `index.html:2490`. É o que
  decide se a tela marca grau e estádio como "pendentes"; sem a bateria de navegador (A2),
  ninguém verifica.

---

## 4. Teste de mutação (50 mutações dirigidas)

Metodologia: cada mutação foi aplicada ao arquivo de produção, `npm test` executado por
inteiro, o arquivo restaurado com `git checkout --` e a limpeza da árvore verificada com
`git status --short` **entre cada mutação**. Harness e log brutos preservados fora do repositório.

| Arquivo | Mutações | Mortas | Sobreviventes | Score |
|---|---|---|---|---|
| `public/tumors.js` | 30 | 25 | 5 | 83,3% |
| `pdf.js` | 8 | 6 | 2 | 75,0% |
| `index.js` | 12 | 10 | 2 | 83,3% |
| **Total** | **50** | **41** | **9** | **82,0%** |

### 4.1 As 9 sobreviventes

| ID | Arquivo | Mutação | Achado |
|---|---|---|---|
| M02 | `tumors.js:99` | `estadioInicial`: `n <= 2` → `n < 2` | A5 |
| M17 | `tumors.js:662` | `dmmr`: perde os sinônimos `'msi-alto'`/`'msi alto'` | A4 |
| M28 | `tumors.js:158` | `montaDx`: nunca acrescenta o órgão ao diagnóstico | A11 |
| M29 | `tumors.js:1027` | `encaixarValor`: remove o casamento por normalização | A27 (ramo redundante) |
| M30 | `tumors.js:90` | `estadioIlegivel`: remove `filled(value) &&` | A14 (função morta) |
| M31 | `pdf.js:52` | Limite do desembrulho: 400 → 40 bytes | A13 |
| M36 | `pdf.js:175` | `ehRecusaDePdf`: `&&` → `\|\|` | A7 |
| M40 | `index.js:305` | `/acesso`: remove o teto de 120 caracteres do nome | A12 |
| M50 | `index.js:69` | `reservaDeMemoria`: remove o teto por requisição | A6 |

**Leitura clínica:** das 5 sobreviventes em `tumors.js`, **duas são regra clínica de fato sem
teste** (M02 e M17), uma é o texto impresso no documento assinado (M28) e duas são código
morto ou redundante (M29, M30). Ou seja: das ~28 mutações que tocam decisão clínica real,
26 foram mortas. O motor de regras está genuinamente protegido — as duas exceções são
exatamente onde o campo é editável pelo médico e a grafia varia (estádio II; `MSI alto`).

### 4.2 As mortes que valem registrar

O critério da idade em mama (`<= 50`), a exclusão de pequenas células em pulmão, a
independência entre grau e estádio em ovário, o `filled()` que trata "Não relatado" como
ausência, a idempotência do reconhecimento de estádio arábico, a leitura do envelope
PKCS#7 e o teto de gasto por conta foram **todos** mortos por casos nominais e específicos.
A mutação que troca `metastatico && luminal` por `||` em mama derrubou 6 testes; a que
inverte a guarda de MMR já feito em colorretal derrubou 6. Isso é uma suíte com poder de
detecção real na dimensão que mais importa.

---

## 5. Testes frágeis / flaky

**Medição:** 5 execuções consecutivas de `npm test` + 1 execução isolada de cada arquivo.

```
run1 rc=0 # pass 179 # fail 0  tempo=10.17s
run2 rc=0 # pass 179 # fail 0  tempo=10.06s
run3 rc=0 # pass 179 # fail 0  tempo=10.11s
run4 rc=0 # pass 179 # fail 0  tempo=10.13s
run5 rc=0 # pass 179 # fail 0  tempo=10.27s
```

Execução isolada por arquivo (soma exatamente 179 — **sem dependência de ordem entre arquivos**):

```
gena 26 · integracao 22 · pdf 14 · regras 62 · robustez 20 · schema 24 · seguranca 11
```

**Nenhuma falha intermitente observada em 5 execuções.** Ainda assim, os vetores de
fragilidade existem e estão medidos:

- **Estado compartilhado real (A1, A15):** a suíte grava em `server/.data/oncogenyx.json` e, se
  `DATABASE_URL` existir, no Postgres do ambiente. É o vetor mais perigoso do conjunto — não é
  flakiness, é dano.
- **Relógio (baixo):** `esperarSaude` faz 60 × 200 ms (12 s de orçamento); `robustez.test.js:261`
  usa timeout fixo de 8 s para o boot com `AUTH_MODE` inválido; `seguranca.test.js:217` espera
  300 ms fixos para o stderr do filho chegar. Numa máquina de CI carregada (aqui: 4 vCPU, com
  `node:test` rodando 4 arquivos em paralelo, cada um com processo Express próprio), esses
  orçamentos são o que vai estourar primeiro.
- **Porta (baixo, A28):** faixas aleatórias disjuntas, sem retry.
- **Rede:** o `stub-anthropic` fecha a fronteira da Anthropic corretamente (`ANTHROPIC_BASE_URL`
  para `127.0.0.1`), e é um dos melhores acertos de desenho da suíte. `plaud.js` não tem
  equivalente (A17).
- **Sinal não determinístico (A23):** a cobertura de `index.js` oscila entre 76,70% e 77,37%
  entre execuções idênticas — há um caminho alcançado por corrida.

---

## 6. Testes que não testam nada (ou quase)

Não há nenhum `assert.ok(true)` nem teste sem asserção. As categorias encontradas são mais sutis:

1. **Grep no código-fonte disfarçado de teste (A10)** — 7 casos em `robustez.test.js`. É a
   categoria mais cara, porque cria falsa confiança sobre travas de robustez. Prova: A6 passou
   por baixo de um desses.
2. **Asserção condicional (A20)** — `robustez.test.js:295`, pode terminar sem asserção nenhuma.
3. **Mock que devolve o esperado (A21)** — os 10 roteiros da Gena.
4. **Texto contra si mesmo (A22)** — 5 testes de conteúdo de prompt.
5. **Asserção fraca demais para o propósito declarado:**
   - `robustez.test.js:234` — "limpeza de sessões e resets expirados existe e roda" afirma
     `typeof r === 'object'` e `typeof store.deleteSessionsByUser === 'function'`. Passa com o
     corpo das funções esvaziado.
   - `robustez.test.js:115` — aceita `413 || 400`, e é o 400 do multer que satisfaz (A6).
   - `regras.test.js:55` — compara diagnóstico com `toLowerCase()`, escondendo defeitos de
     caixa no documento assinado (A11).

**Estimativa:** ~24 dos 179 testes (13%) têm poder de detecção próximo de zero. Não são
prejudiciais em si; o problema é que inflam a contagem que aparece na sala de negociação.

---

## 7. Lacuna principal: `server/store.js` sem nenhum teste

`store.js` tem 0 testes diretos. Os 46,11% de cobertura vêm de execução **indireta** do
back-end de arquivo, através do servidor spawnado. **Nenhuma linha do ramo Postgres jamais
executou** — e Postgres é o modo de produção (`index.js:101` avisa no boot quando *não* é).

| Função | Estado | O que deveria ser testado | Risco de não testar |
|---|---|---|---|
| `init()` (`:45-85`) | ramo PG descoberto | DDL idempotente: rodar 2× no mesmo banco não falha; índices criados | Um deploy com o schema já existente derruba o boot. Sem banco, ninguém entra. |
| `createUser()` (`:123-150`) | ramo PG descoberto | **Duas chamadas concorrentes com o mesmo email** devolvem o mesmo usuário e atualizam nome/CRM (o `ON CONFLICT` de `:140`) | É a correção declarada para o duplo toque / duas abas. Sem teste, uma regressão devolve 500 "Erro interno" no **primeiro acesso** do médico. |
| `consumeReset()` (`:241-259`) | **função inteira descoberta** | Uso único sob concorrência: 2 chamadas simultâneas, só uma devolve linha; token expirado devolve `null`; token já usado devolve `null` | É a trava de uso único do link de redefinição. Regressão = link de senha reutilizável = **takeover de conta**. |
| `createReset()` (`:225-239`) | **função inteira descoberta** | Um pedido novo invalida os anteriores não usados | Links antigos continuam válidos; amplia a janela de um link vazado. |
| `findSession()` (`:200-211`) | ramo PG descoberto | Sessão expirada devolve `null` **nos dois back-ends** (PG filtra por `expires_at > NOW()`, arquivo compara em JS) | Divergência silenciosa entre back-ends: sessão expirada continua válida em um deles. |
| `deleteSession()` (`:213-221`) | **função inteira descoberta** | Logout revoga: token deixa de autenticar | `POST /api/auth/logout` (`index.js:479`) também está descoberto. **O logout nunca foi verificado.** |
| `setUserPassword()` (`:152-161`) | **função inteira descoberta** | Persiste o hash e o login subsequente funciona | Modo completo quebrado no dia em que for ligado. |
| `savePlaudTokens()` / `getPlaudTokens()` / `deletePlaudTokens()` (`:263-301`) | **funções inteiras descobertas** | Upsert por usuário; token de um médico nunca visível a outro | Credencial OAuth de terceiro por usuário. Vazamento entre contas é incidente de dado de saúde. |
| `limparExpirados()` (`:308-321`) | ramo PG descoberto; ramo arquivo executado **contra dados reais** | Remove só o que expirou; preserva o que vale; devolve contagem | Já é problema hoje (A1/A15). Regressão apaga sessão válida = deslogar médicos em produção. |
| `deleteSessionsByUser()` (`:324-332`) | **função inteira descoberta e nunca chamada** | — | **Código morto**: exportada, sem chamador em `index.js` nem `auth.js`. O "sair de todos os dispositivos" não existe como funcionalidade; só o teste tautológico de `robustez.test.js:235` sugere que sim. |
| `readFile()` (`:89-95`) | `catch` descoberto (`:93-94`) | Arquivo corrompido/truncado devolve estrutura vazia em vez de lançar | Disco efêmero + escrita não atômica: um crash no meio do `writeFileSync` corrompe o arquivo. O `catch` que salva disso nunca foi exercitado. |
| `writeFile()` (`:97-100`) | executado | **Escrita não é atômica** — `writeFileSync` direto no destino | Não é lacuna de teste, é lacuna de desenho: crash durante a escrita perde **todas** as contas. Recomendo `write` em temporário + `rename`. |

**Recomendação de execução:** um único arquivo `store.test.js` parametrizado que roda a mesma
bateria de contrato contra os dois back-ends (Postgres efêmero no CI via contêiner; arquivo em
`mkdtemp`), mais 3 testes de concorrência (`createUser`, `consumeReset`, `createSession`).
Estimo ~40 testes e meio dia de trabalho — é o maior ganho de confiança por hora investida em
todo o repositório.

---

## 8. Higiene: árvore de trabalho, processos e portas

| Verificação | Resultado |
|---|---|
| Árvore limpa após `npm test` | ✅ `git status --short` vazio |
| Arquivos temporários no repositório | ✅ nenhum |
| **Escrita fora do repositório** | ❌ 5 diretórios em `/tmp` vazados por execução (721 → 726 medido; 726 acumulados) — **A16** |
| **Escrita em dado real** | ❌ `server/.data/oncogenyx.json` reescrito (md5 muda) — **A15** |
| **Escrita em banco externo** | ❌ `DELETE` no Postgres de `DATABASE_URL` se a variável existir — **A1** |
| Processos sobreviventes do `npm test` | ✅ nenhum `index.js` órfão após a suíte |
| Portas 4300-5899 abertas após a suíte | ✅ nenhuma |
| Resíduos no diretório | ⚠️ `server/abc` (socket unix órfão) — **A29** |

Observação: a suíte **fecha bem** os processos que abre (`app.kill()` + handler `SIGTERM` em
`index.js:1021` com `servidor.close()`), e isso foi confirmado por inspeção de `ps` e `ss`
após a execução. O que ela não limpa é o que escreve em disco.

---

## 9. Plano de correção priorizado

**Bloqueante para a venda (fazer antes da due diligence técnica):**

1. **A1** — isolar `store.js` do ambiente nos testes. Uma linha por arquivo de teste. *(1 h)*
2. **A2** — declarar `playwright` e ligar `test:navegador` ao CI. *(2 h)*
3. **A3** — bateria de contrato de `store.js` nos dois back-ends + 3 testes de concorrência. *(4 h)*
4. **A8** — testes unitários de senha, token de reset e `isValidEmail`. *(2 h)*

**Alto (fazer no mesmo ciclo):**

5. **A4, A5** — casos clínicos de estádio II e dos sinônimos de MSI. *(1 h — são as duas regras
   clínicas de fato sem teste)*
6. **A6, A7** — converter os dois testes de robustez que passam pelo motivo errado. *(2 h)*
7. **A9** — corrigir o código morto do listener de porta e cobrir. *(1 h)*
8. **A10** — reclassificar os 7 greps de código-fonte como lint de arquitetura, e substituir por
   testes de comportamento onde houver comportamento. *(3 h)*

**Higiene (barato, alto retorno de percepção):**

9. **A15, A16, A24, A29** — limpeza de temporários, `DATA_FILE` de teste, bytes de controle,
   socket órfão. *(1 h no total)*
10. **A21, A22** — enxugar os 15 testes de baixo poder de detecção. Contar 164 testes com poder
    real vale mais, numa auditoria de terceiro, do que 179 com 13% de enchimento. *(1 h)*

---

## 10. Confirmação de integridade da árvore

Todas as 50 mutações foram revertidas com `git checkout --` e a limpeza foi verificada
**entre cada uma delas** pelo próprio harness (que aborta se a árvore não voltar limpa).

Estado ao final da auditoria:

```
$ git diff --stat
(vazio)

$ git status --porcelain --untracked-files=all
?? docs/auditoria-frontend.md
?? docs/auditoria-testes.md
```

**Nenhum arquivo rastreado foi modificado** — `git diff` está vazio, o que cobre todo
`server/` (produção e testes). A árvore de código está exatamente como estava no início.

Sobre os dois arquivos não rastreados: `docs/auditoria-testes.md` é este relatório, o
entregável solicitado. `docs/auditoria-frontend.md` **não foi produzido por esta auditoria** —
apareceu no diretório durante a execução, vindo de uma sessão concorrente, e não foi lido nem
alterado aqui. Registro para que ninguém o atribua a este trabalho.

### O que não foi medido

- **Cobertura de `server/public/index.html`** (138 KB de lógica de interface): não instrumentada,
  porque a única bateria que a exercitaria (`navegador.js`) não executa (A2). É a maior área
  cinzenta remanescente do repositório.
- **Qualidade conversacional da Gena e qualidade de extração do modelo:** fora de escopo de uma
  suíte determinística, e corretamente reconhecido como tal pelos comentários de `gena.test.js`.
- **Comportamento sob Postgres real:** nenhum banco estava disponível no ambiente de auditoria.
  A conclusão de A3 é por ausência de cobertura medida, não por execução contra Postgres.
- **Mutações em `auth.js`, `store.js`, `email.js` e `plaud.js`:** não foram executadas. Mutação
  nesses arquivos seria vácua — sem testes que os cubram, 100% das mutações sobreviveriam por
  construção. A lacuna está registrada em A3, A8, A17 e A18.
