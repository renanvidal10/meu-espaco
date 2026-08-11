# OncoGenYX — Arquitetura Conceitual

> Desenho de produto para uma ferramenta de **triagem multimodal no ponto de cuidado**: o médico sobe dados brutos do paciente (PDF, imagem, texto, áudio) e recebe direcionamento sobre qual teste molecular pedir e onde pedir de graça, com apoio de um Hub de Acesso (catálogo de programas da indústria) e de um assistente conversacional (OncoBot) como via alternativa de entrada.

---

## 1. O que essa ferramenta É e NÃO É

**É:**
- Uma ferramenta de **triagem e direcionamento** — "existe alvo molecular relevante nesse caso? Qual teste pedir? Onde pedir de graça?"
- Um tradutor entre **dado clínico bruto e desfecho acionável**: perfil do paciente → biomarcador elegível → programa de acesso da indústria.
- Um **facilitador de logística e literacia clínica** no momento da decisão (o gargalo real, conforme os dados SGO/Labcorp-Illumina que você trouxe).

**NÃO é:**
- Uma ferramenta de **decisão terapêutica** (não sugere droga, dose ou linha de tratamento).
- Um **repositório de dados de pacientes** (não hospeda, não cruza dados entre médicos, não é banco retrospectivo).
- Um substituto de **aconselhamento genético** (sempre encaminha para especialista quando indicado, ex.: critérios de síndrome hereditária).

Essa distinção é a base regulatória e de MLR: o produto orienta *processo de solicitação de exame*, não *conduta terapêutica*. Isso muda a régua de risco (mais perto de "suporte administrativo/educacional" do que "software as medical device" de decisão terapêutica) — mas ainda exige disclaimers e trilha de auditoria, porque toca decisão clínica indiretamente.

---

## 2. Jornada do médico (fluxo ponta a ponta)

```mermaid
flowchart TD
    A[Médico faz login] --> B[Abre novo caso]
    B --> C{Como vai inserir dado do paciente?}
    C -->|Upload PDF/Imagem| D[Laudo, biópsia, prontuário]
    C -->|Texto livre| E[Descrição do perfil]
    C -->|Colar transcrição| F[Áudio da consulta já transcrito]
    C -->|Conectar Plaud| G[Sincroniza gravação e transcreve]
    D --> H[Pseudonimização automática]
    E --> H
    F --> H
    G --> H
    H --> I[Extração estruturada do caso clínico]
    I --> J[Motor de Triagem Genômica]
    J --> K{Alvo molecular elegível?}
    K -->|Sim| L[Recomenda teste: qual, sequência, critério]
    K -->|Não claro| M[Sinaliza dado insuficiente + o que falta coletar]
    L --> N[Mostra programas da indústria disponíveis para aquele teste]
    N --> O[Redireciona ao portal oficial do laboratório/indústria]
    M --> P[Médico complementa dado e reprocessa]
    L --> Q[Gera resumo do caso para o médico arquivar/exportar]
```

---

## 3. Arquitetura em camadas

### Camada 1 — Ingestão multimodal
Responsável por receber o dado bruto, seja qual for o formato.

| Fonte | Mecanismo | Observação |
|---|---|---|
| PDF (laudo anatomopatológico, prontuário) | Upload + parsing (texto nativo ou OCR se digitalizado) | Extrai texto, tenta localizar campos-chave (diagnóstico, estadiamento, IHQ) |
| Imagem (foto de laudo, lâmina, prescrição) | Upload + OCR | Mesma pipeline do PDF escaneado |
| Texto livre | Campo de descrição | Médico descreve o caso em linguagem natural |
| Ditado clínico por voz | Gravação de áudio no próprio app + transcrição automática (speech-to-text) | O médico dita o caso em vez de digitar; a transcrição alimenta a mesma extração da Camada 3. Diferente da transcrição colada: a gravação acontece dentro da sessão, não é importada de outro app |
| Transcrição de áudio colada | Campo de texto | Médico cola transcrição já pronta (de qualquer gravador) |
| Plaud (cartão gravador) | Integração via API/webhook do Plaud, se disponível, ou export manual do arquivo de transcrição | **Ver seção 7 — depende de disponibilidade de API pública do Plaud** |

Todo dado bruto (PDF, imagem, áudio) é **processado e descartado** — não fica retido além do necessário para gerar o resumo estruturado do caso (ver seção 5, retenção de dados).

### Camada 2 — Pseudonimização (LGPD by design)
Executa **antes** de qualquer outro processamento, inclusive antes de qualquer chamada a modelo de IA externo.

- Nome completo → iniciais + identificador sequencial gerado pela plataforma (ex.: "Renan Lourenço Vidal" → `R.L.V. — Caso #0142`).
- Nenhum CPF, data de nascimento completa, endereço, telefone ou nome de familiar é mantido em texto pleno — campos sensíveis são mascarados ou removidos na extração.
- A tabela de correspondência **nome real ↔ código do caso** fica isolada, criptografada, e só é visível para o médico dono do caso (nunca trafega para o motor de triagem nem para qualquer chamada de IA/terceiro).
- Esse desenho segue o princípio de **minimização de dados** da LGPD (Art. 6º, III) — a IA e qualquer processamento downstream só enxergam o caso pseudonimizado.

### Camada 3 — Extração e estruturação do caso clínico
Converte o dado bruto (já pseudonimizado) em um **objeto clínico estruturado**:

```
CasoClinico {
  codigo_caso: "R.L.V.-0142"
  sexo, idade
  subtipo_oncologico: enum [Ginecológico, Geniturinário, Mama, Pulmão, ...]
  histologia, grau, estadiamento
  biomarcadores_ja_conhecidos: []
  historico_familiar: { presente: bool, detalhes_relevantes }
  tratamentos_previos: []
  fonte_dados: [PDF, texto, áudio-Plaud, ...]
  dados_insuficientes: []   // o que falta para triagem completa
}
```

Aqui entra o parsing de PDF/OCR + um modelo de linguagem para extrair essas entidades do texto livre/transcrição. Idade e sexo viram faixas/categorias sempre que possível, para reduzir ainda mais a identificabilidade.

### Camada 4 — Motor de Triagem Genômica
O coração do produto. Uma árvore de decisão **por subtipo oncológico**, baseada em diretrizes NCCN/ESMO, que responde três perguntas:

1. Existe alvo molecular relevante para esse subtipo/perfil?
2. Qual(is) teste(s) pedir (germinativo, somático, HRD, painel amplo) e em que ordem?
3. Que critério de elegibilidade o caso já cumpre ou ainda precisa documentar?

Ver seção 6 para o desenho por subtipo.

### Camada 4-B — OncoBot (via conversacional, mesmo motor)
Alternativa à ingestão por formulário/upload: o médico conversa com um assistente que faz perguntas dirigidas ("qual a histologia?", "há histórico familiar?", "já foi feito algum teste?") até reunir os mesmos campos do `CasoClinico` estruturado (Camada 3). Não é um motor de decisão paralelo — é **outra porta de entrada para a mesma Camada 4**: as perguntas do bot são geradas a partir das lacunas do objeto estruturado, e a resposta final passa pelas mesmas regras versionadas e citáveis por diretriz.

- Útil quando o médico não tem laudo/arquivo em mãos e quer só descrever o caso rapidamente entre consultas.
- Pode ser usado em conjunto com upload (ex.: sobe o laudo, o bot só pergunta o que ficou faltando — histórico familiar, testes prévios).
- Mesma régua de pseudonimização da Camada 2 se aplica à conversa: o bot nunca pede nome, CPF ou dado que identifique o paciente: só dado clínico.
- Mesmo disclaimer da Camada 7: o bot direciona qual exame pedir, não sugere conduta terapêutica.

### Camada 5 — Base de Programas da Indústria (o "Hub" de acesso)
Catálogo pesquisável por **patologia × biomarcador × empresa** (`Catálogo de Programas`, Fase 1). Para cada teste elegível identificado na Camada 4, a plataforma:
- Lista quais indústrias oferecem aquele teste gratuitamente/patrocinado naquele subtipo.
- Mostra critérios de elegibilidade do programa (podem ser mais restritos que o critério clínico puro).
- Redireciona para o **portal oficial** de cada laboratório/indústria parceira — a plataforma nunca processa a solicitação em si (é facilitador, não gestor do processo).

Essa base precisa de **manutenção contínua** (programas mudam, critérios mudam) — é dado curado, não gerado por IA.

### Camada 6 — Output / Resumo do caso
Gera um resumo que o médico pode salvar/exportar:
- Caso pseudonimizado (`R.L.V.-0142`)
- Alvo(s) molecular(es) elegível(is) e por quê (critério aplicado)
- Teste(s) recomendado(s) e sequência
- Programas de acesso disponíveis + link oficial
- Disclaimer: "Esta é uma ferramenta de triagem e direcionamento, não substitui julgamento clínico nem aconselhamento genético."

### Camada 7 — Compliance, auditoria e disclaimers
- Log de auditoria: quem gerou qual triagem, quando, com base em qual versão da diretriz (importante para defensibilidade médico-legal e para eventual submissão a Medical/Regulatory).
- Disclaimer fixo em toda tela de recomendação.
- Trilha de decisão explicável: a recomendação sempre aponta a regra/diretriz que a gerou (não é "caixa-preta" de IA generativa pura — a IA ajuda a extrair dado, mas a lógica de triagem é regras auditáveis mapeadas a NCCN/ESMO).

### Camada 8 — Geração do documento de solicitação
Este é o segundo gargalo que você identificou, e é tão importante quanto o primeiro: o médico pode saber exatamente qual teste pedir e ainda assim não pedir, porque não tem staff para preencher o formulário certo do jeito certo para cada laboratório/programa. Esta camada fecha esse hiato — gera o **documento de solicitação já preenchido**, pronto para revisar, assinar e enviar.

- **Entrada isolada de nome real**: até aqui, todo o pipeline (Camadas 2 a 7) trabalha só com o caso pseudonimizado (`A.F.M.-0231`). O nome completo do paciente só é **usado** (exibido, preenchido no documento) **nesta camada**, num campo separado — nunca entra no motor de triagem, nunca fica salvo junto do histórico de casos, nunca aparece nas telas de revisão/resultado. É reidentificação pontual e local, controlada pelo médico, no exato momento em que ele precisa do documento final.
  - **Atualização v0.4**: quando o material de origem é um PDF/foto de laudo (que já contém o nome do paciente no cabeçalho, inevitavelmente visível ao modelo que lê o documento para extrair o dado clínico), o motor de extração da Camada 3 também captura esse nome — como campo isolado (`nome_paciente`), nunca combinado com o objeto clínico estruturado. Ele só é usado para pré-preencher o campo desta camada, poupando o médico de digitar de novo algo que a IA já viu. Continua nunca aparecendo nas telas 2 e 3 (revisão/resultado), continua nunca influenciando a triagem. Quando a entrada é só texto digitado (sem nome mencionado), o campo simplesmente vem vazio para preenchimento manual, como antes.
- **Templates por parceiro**: cada laboratório/indústria tem seu próprio formulário de solicitação (campos, layout, texto de justificativa exigido). Assim como a base de programas (Camada 5), esses templates são **dado curado**, mantido e validado por você — não gerado livremente por IA.
- **Preenchimento automático**: nome do paciente, dados do médico (CRM, instituição), diagnóstico, teste solicitado e a **justificativa clínica já redigida**, citando a diretriz que embasa a indicação (o mesmo texto rastreável da Camada 7).
- **Múltiplos documentos por caso**: quando a triagem recomenda teste pareado (ex.: HRD tumoral + BRCA germinativo, ver seção 10), a plataforma gera um documento para cada um — cada teste pode ter parceiro, laboratório e formulário diferentes.
- **Saída**: PDF para download, com aviso de que a responsabilidade pela solicitação final é do médico assistente (a plataforma preenche, não decide nem envia em nome dele).

**Atualização v0.4**: o fluxo real (`server/public/index.html`) juntou as telas de Programas de acesso e Modelo de solicitação num único passo 4 — cada card de teste indicado já mostra, na sequência, o(s) programa(s)/portal(is) e o documento de solicitação pré-preenchido daquele mesmo teste, em vez de duas telas separadas. Ver `mockup/oncogyn-flow.html` (versão anterior, 5 passos, sem backend) para o histórico do desenho original.

---

## 4. Estrutura de telas (informação, não visual ainda)

1. **Login/Cadastro do médico** (CRM, especialidade, instituição) — acesso seguro ao Hub.
2. **Dashboard** — casos recentes, catálogo de programas.
3. **Novo Caso** — tela de ingestão multimodal: formulário/upload (texto, PDF, imagem, áudio, Plaud) **ou** conversa com o OncoBot (ver Camada 4-B).
4. **Revisão do Caso Estruturado** — médico confirma/corrige o que foi extraído antes de rodar a triagem (humano no loop, reduz risco de erro de extração).
5. **Resultado da Triagem** — alvo(s), teste(s), critério, programas disponíveis, botão para portal oficial.
6. **Histórico de Casos** — lista de `R.L.V.-0142`, `R.L.V.-0143`... só o médico logado enxerga a tabela de correspondência real.
7. **Área de Educação** (Fase 3).
8. **Analytics/Dashboard agregado** (Fase 3, para parceiros da indústria — sempre agregado e anonimizado).

---

## 5. Retenção e segurança de dados (LGPD)

- **Dado bruto** (PDF/imagem/áudio original): processado em memória/storage temporário, descartado após extração (ou retido criptografado por prazo curto definido em política, só se o médico optar por manter o anexo original).
- **Caso estruturado pseudonimizado**: retido enquanto o médico mantiver a conta, para consulta de histórico.
- **Tabela de reidentificação** (código ↔ nome real): armazenada separadamente, criptografada em repouso, acesso restrito ao médico dono do caso — nem a equipe de produto acessa em operação normal.
- Base legal LGPD: execução de serviço solicitado pelo próprio médico (controlador dos dados do paciente) + apoio a cuidado de saúde — o produto atua como **operador** dos dados do médico, que segue sendo controlador em relação ao paciente dele.
- Necessário: Termo de Uso + Aviso de Privacidade explícitos, e — dado que se trata de dado de saúde (dado sensível, Art. 11 LGPD) — atenção redobrada a criptografia em trânsito/repouso e a não usar esses dados para treinar modelos de terceiros sem anonimização irreversível.

---

## 6. Base de diretrizes — critérios de indicação (Ginecológico · Ovário)

**Processo obrigatório daqui pra frente**: antes de qualquer regra entrar no motor de triagem, ela precisa estar documentada nesta seção, com a fonte (diretriz + ano/versão) e o critério exato de histologia/grau/estágio que a aciona. O motor de código (Camada 4 do mockup) só pode implementar o que estiver aqui — nunca o contrário. Isso evita o erro que já aconteceu uma vez: a primeira versão do protótipo só reconhecia "seroso de alto grau" e deixava de fora "endometrioide de alto grau em estágio III/IV", que segundo a NCCN tem exatamente a mesma indicação.

### Sociedades de referência usadas nesta triagem

- **NCCN** — Ovarian Cancer Guidelines (versão vigente)
- **ASCO** — "Germline and Somatic Tumor Testing in Epithelial Ovarian Cancer: ASCO Guideline" (*Journal of Clinical Oncology*, 2020; PMID 32074015)
- **ESMO** — Clinical Practice Guideline para câncer epitelial de ovário, incluindo a adaptação Pan-Ásia (ESMO Open, 2025) que reforça HRD tanto em histologia serosa quanto não-serosa
- **SGO** — Society of Gynecologic Oncology, referência de prática clínica específica para oncologia ginecológica, usada como checagem cruzada para os critérios acima

### Regra 1 — Teste germinativo (BRCA1/2 + painel ampliado)

**Indicado para toda histologia epitelial não-borderline de ovário, independente de grau ou estágio**: seroso, endometrioide, células claras, mucinoso, carcinossarcoma, indiferenciado.

> Fonte: ASCO (JCO 2020) — recomenda oferecer teste germinativo a toda mulher diagnosticada com câncer epitelial de ovário, independente de histórico familiar. Histologias não-serosas (endometrioide, células claras, baixo grau, carcinossarcoma) têm taxa de mutação germinativa BRCA próxima à do seroso de alto grau (~28%); mucinoso tem o menor rendimento para BRCA, mas ainda é ofertado — e tem indicação adicional de considerar teste somático de dMMR.

### Regra 2 — Teste somático tumoral (HRD)

**Indicado quando histologia é seroso OU endometrioide, de alto grau, em estágio III ou IV** (qualquer subestágio A/B/C) — orienta elegibilidade a terapia de manutenção com inibidor de PARP.

> Fonte: NCCN Ovarian Cancer Guidelines — teste somático de HRD recomendado para doença avançada (estágio III/IV) de histologia serosa **ou endometrioide** de alto grau. O erro corrigido nesta versão: a regra anterior só cobria "seroso", excluindo endometrioide — que a NCCN trata com o mesmo critério.
>
> **Nomenclatura (v0.4)**: os ensaios comerciais de HRD (ex.: myChoice CDx, FoundationOne CDx HRD) já incluem a análise de mutação BRCA1/2 tumoral como parte do mesmo teste/laudo — não são dois exames separados. Por isso a UI e os documentos de solicitação usam só "HRD Somático" (não mais "HRD + BRCA1/2 tumoral"), evitando parecer dois pedidos quando é um único teste.

### Regra 3 (referência, ainda não implementada no motor) — dMMR/MSI (Lynch)

Considerar teste somático de dMMR/MSI para histologia de células claras, endometrioide ou mucinoso.

> Fonte: ASCO (JCO 2020).

### Tabela-resumo

| Perfil do caso | Germinativo | Somático (HRD) |
|---|---|---|
| Seroso ou endometrioide, alto grau, estágio III/IV (confirmados) | Indicado | Indicado — par completo |
| Seroso ou endometrioide, grau e/ou estágio não informados | Indicado | Indicado como mais provável, com ressalva de confirmar no laudo (ver "Campo obrigatório vs. recomendado" abaixo) |
| Seroso ou endometrioide, mas baixo grau ou estágio I/II (confirmados) | Indicado | Não coberto por esta regra — fora do critério NCCN |
| Células claras, mucinoso, carcinossarcoma, indiferenciado | Indicado | Não coberto por esta regra (considerar dMMR — Regra 3) |
| Histologia não identificada ou não mapeada | Triagem insuficiente — completar dado | — |

### Campo obrigatório vs. recomendado

Grau e estadiamento (FIGO) são **eixos clínicos independentes** — estágio mede extensão anatômica da doença, grau é uma leitura patológica do tecido (arquitetura + atipia nuclear); um caso em estágio IIIC/IVC pode ser tanto de alto quanto de baixo grau, o segundo não se deduz do primeiro (fonte: ISGyP, grading de endometrioide "independente do estágio do tumor"; existe inclusive uma entidade reconhecida — carcinoma seroso de baixo grau avançado — que é estágio III/IV e baixo grau ao mesmo tempo).

Por isso, **só a histologia é campo obrigatório** para a triagem rodar (sem ela não há como dizer nada). Grau e estadiamento são recomendados, não obrigatórios: se a histologia já é elegível ao par (seroso/endometrioide) e nenhum dos dois contradiz o critério, a triagem indica o par como **mais provável para o perfil**, sinaliza visualmente o que não foi confirmado, e pede para o médico confirmar no laudo patológico antes de solicitar — sem bloquear a navegação nem forçar o preenchimento de campo que só é "bom ter", não indispensável. Só bloqueia navegação quando o dado realmente impede qualquer resposta (histologia ausente ou não reconhecida) ou quando grau/estágio **já confirmam** que o caso está fora do critério (aí a resposta é germinativo-somente, não uma pendência).

**Refinamento importante**: grau e estadiamento só são sinalizados como pendentes (amarelo) quando a histologia já informada é seroso ou endometrioide — as únicas com o par somático na regra. Para qualquer outra histologia (células claras, mucinoso, carcinossarcoma, indiferenciado), preencher grau/estágio não muda a resposta — germinativo já está indicado e o par somático não se aplica de qualquer forma — então o mockup não pede nem destaca esses campos nesses casos. Essa relevância é recalculada ao vivo, toda vez que o médico edita a histologia na tela de revisão (`updateGrauEstadioRelevance()` em `mockup/oncogyn-flow.html`).

**Tela de Programas e Solicitação mostra só o que foi indicado**: o card/documento do teste somático só aparece quando a triagem confirmou ou indicou provisoriamente o par completo — nunca para um caso que resultou em "só germinativo". Mostrar um teste sem indicação confundiria o médico exatamente do jeito que o produto existe para evitar. Quando só o germinativo é indicado, a tela exibe uma nota curta explicando por que o card do somático não aparece, em vez de simplesmente omitir sem explicação.

**Sem nome de indústria/parceiro específico na UI (v0.4)**: os cards de programa de acesso não citam mais indústria (ex. AstraZeneca, GSK) por nome — usam rótulo genérico ("Programa de acesso ao teste — parceiro 1/2"). A curadoria de quem realmente patrocina cada programa, com critério de elegibilidade vigente, continua sendo trabalho da Camada 5 (ver abaixo) — só não é mais hardcoded na tela como exemplo de marca específica, para não parecer que a ferramenta favorece uma indústria sobre outra antes dessa curadoria acontecer.

### Outros subtipos oncológicos (fora do escopo desta fase)

A mesma exigência de "primeiro a diretriz, depois o código" vale para qualquer subtipo futuro. Ainda não foi feito o levantamento de critérios para os subtipos abaixo — não implementar nenhuma regra para eles até essa etapa acontecer:

| Subtipo | Status |
|---|---|
| Ovário | **Implementado (v0.3)** — ver seção 6 |
| Próstata | **Implementado (v0.5)** — ver seção 6-B |
| Mama | **Implementado (v1.2)** — ver seção 16.1 |
| Pâncreas | **Implementado (v1.2)** — ver seção 16.2 |
| Colorretal | **Implementado (v1.2)** — ver seção 16.3 |
| Endométrio | **Implementado (v1.2)** — ver seção 16.4 |
| Pulmão (NSCLC) | **Implementado (v1.2)** — ver seção 16.5 |
| Pulmão de pequenas células | Fora de escopo — o motor recusa explicitamente |
| Neuroendócrino de pâncreas | Fora de escopo — o motor recusa explicitamente |

O mapeamento **indústria × teste × programa gratuito** (quem oferece HRD, quem oferece germinativo) continua sendo uma camada separada (Camada 5) e uma etapa de validação sua — não faz parte da diretriz clínica em si e não deve influenciá-la (ver regra de ouro da seção 10).

## 6-B. Base de diretrizes — critérios de indicação (Próstata)

Segunda vertical implementada, seguindo o mesmo processo obrigatório da seção 6: diretriz pesquisada e documentada primeiro, motor de código depois. Sociedades de referência trocadas para as que emitem diretriz de próstata — NCCN Prostate Cancer Guidelines, ASCO ("Germline and Somatic Genomic Testing for Metastatic Prostate Cancer", JCO 2025), AUA/SUO Advanced Prostate Cancer Guideline (2026) e EAU Guidelines on Prostate Cancer (2026) — no lugar de ESMO/SGO, que são as de referência do GYN.

**Eixo central da regra**: ao contrário do GYN (onde histologia é o campo obrigatório e FIGO/grau refinam), aqui o campo obrigatório é a **extensão da doença** (Localizado / Linfonodo positivo N1 / Metastático hormônio-sensível mHSPC / Metastático resistente à castração mCRPC) — analogamente ao estadiamento FIGO, é frequentemente inferido pelo motor a partir do TNM e do contexto clínico (ex.: "iniciando bloqueio hormonal pela primeira vez" → mHSPC; "progressão de PSA em uso de enzalutamida" → mCRPC), nunca chutado sem base no material.

### Regra 1 — Teste germinativo

**Indicado quando qualquer um destes critérios é atendido:**
- Doença metastática (mHSPC ou mCRPC), qualquer histologia.
- Linfonodo positivo (N1), doença localizada.
- Categoria de risco NCCN Alto ou Muito alto, doença localizada.
- Histologia intraductal/cribriforme, mesmo em risco intermediário.
- Ascendência judaica Ashkenazi.
- Histórico familiar oncológico relatado (não automatiza a contagem exata de parentes/idade do critério NCCN completo — sinaliza a indicação e pede avaliação do médico).

> Fontes: NCCN Prostate Cancer Guidelines — germinativo para nódulo positivo, alto/muito alto risco localizado e metastático; considerar para intraductal/cribriforme mesmo em risco intermediário, ascendência Ashkenazi e critério de histórico familiar (≥3 parentes de primeiro grau com próstata/mama do mesmo lado, óbito por próstata <60 anos, etc.). ASCO (JCO 2025) e AUA/SUO (2026): germinativo para todo paciente com doença metastática e/ou avançada.

### Regra 2 — Teste somático tumoral (painel HRR, 15 genes)

**Indicado apenas quando a doença é metastática** (mHSPC ou mCRPC) — não indicado para doença localizada nesta versão da regra, mesmo em alto/muito alto risco, porque o painel HRR é um biomarcador de elegibilidade a inibidor de PARP em doença metastática, não um teste de rastreio para doença local.

> Fontes: ASCO (JCO 2025) — doença metastática (mHSPC e mCRPC) candidata a tratamento sistêmico direcionado por biomarcador deve fazer teste somático. EAU (2026) — mCRPC: oferecer teste somático e/ou germinativo (recomendação forte); mHSPC (M1): testar HRR para elegibilidade a niraparib + abiraterona (recomendação fraca). AUA/SUO (2026): teste tumoral somático para todo paciente com doença metastática.
>
> **Genes do painel** (estudo PROfound, base da aprovação do olaparibe em mCRPC): BRCA1, BRCA2, ATM, BARD1, BRIP1, CDK12, CHEK1, CHEK2, FANCL, PALB2, PPP2R2A, RAD51B, RAD51C, RAD51D, RAD54L. Maior benefício clínico documentado em BRCA1/2, CDK12 e PALB2; benefício não estabelecido para ATM e CHEK2 isolados — dado clínico relevante para o médico, não usado para excluir o gene do painel solicitado.

### Tabela-resumo

| Perfil do caso | Germinativo | Somático (painel HRR) |
|---|---|---|
| Metastático (mHSPC ou mCRPC) | Indicado | Indicado — par completo |
| Localizado, linfonodo positivo (N1), alto/muito alto risco, intraductal/cribriforme, Ashkenazi ou histórico familiar | Indicado | Não coberto por esta regra — biomarcador de doença metastática |
| Localizado, risco baixo ou intermediário favorável, sem outro critério | Não indicado por esta regra | Não coberto por esta regra |
| Extensão da doença e categoria de risco não identificadas | Triagem insuficiente — completar dado | — |

### Categoria de risco NCCN (doença localizada) — como o motor infere

Quando a categoria de risco não vem pronta no laudo, o motor de extração (`server/index.js`, `PROSTATA_SYSTEM_PROMPT`) só a infere se tiver PSA + Gleason/Grade Group + estágio clínico T disponíveis com razoável confiança, usando a tabela resumida do NCCN (Baixo: cT1-T2a, Grade Group 1, PSA<10; Intermediário favorável: Grade Group 2 predominância padrão 3, <50% fragmentos positivos, ≤1 fator de risco intermediário; Intermediário desfavorável: Grade Group 2-3 com ≥50% fragmentos positivos ou ≥2 fatores; Alto: cT3a ou Grade Group 4-5 ou PSA>20; Muito alto: cT3b-T4 ou padrão primário Gleason 5 ou >4 fragmentos Gleason 8-10) — mesma filosofia do estadiamento FIGO no GYN: campo vazio é melhor que chute quando faltar um dos três eixos.

### Interface

Campos de revisão, motor de regra (`classifyCaseProstata()`), resultado, programas e documento de solicitação são todos independentes dos equivalentes GYN — vivem lado a lado em `server/public/index.html`, alternados por `setSubtype()`.

**Atualização v0.7 — parceiros de programa específicos por subtipo (não reaproveitados do GYN)**: a primeira versão desta tela reaproveitou os mesmos parceiros do card somático do GYN (ProgramAID + Myriad myChoice CDx) pro card de próstata, por analogia — isso estava errado. Pesquisa dedicada (o usuário pediu explicitamente "varredura grande na internet" antes de implementar) encontrou:
- **GSK não tem programa de acesso para próstata** — o programa de tratamento com Zejula (niraparibe) da GSK no Brasil é explicitamente para câncer de ovário (SUS), sem nenhuma menção a próstata. Removido do card de próstata (nunca deveria estar lá).
- **Myriad myChoice CDx é o companion diagnostic do Zejula/GSK (ovário), não de próstata** — o painel somático de próstata (olaparibe/Lynparza) usa companion diagnostics diferentes: **FoundationOne CDx** e **FoundationOne Liquid CDx** (Foundation Medicine, comercializados pela Roche no Brasil, com parceiros locais confirmados: Dasa Genômica, Fleury Genômica, Einstein, Laboratório Silveira, A+ Medicina Diagnóstica) para o tecido tumoral e biópsia líquida respectivamente, e **BRACAnalysis CDx** (Myriad) para o germinativo especificamente.
- **ProgramAID (Programa ID.AZ) cobre próstata de verdade** — confirmado que o programa oferece teste genético gratuito em tecido tumoral para próstata metastática, e — respondendo diretamente ao que o usuário perguntou — **se o resultado vier inconclusivo ou cancelado, permite reteste gratuito por biópsia líquida (ctDNA)**, sem custo adicional. É por isso que o card de próstata cita essa biópsia líquida explicitamente na descrição do programa.
- **Pfizer tem programa de suporte diagnóstico ligado a HRR** — "Cuidar Mais" (especificamente o sub-programa "PAF"), vinculado à combinação Talzenna (talazoparibe) + Xtandi (enzalutamida), aprovada em ~60 países para câncer de próstata metastático HRR-mutado. Adicionado ao card de próstata no lugar da GSK.
- **Janssen (Akeega) e a ligação direta da Pfizer com um laboratório específico não foram confirmados** para o mercado brasileiro nesta pesquisa — não foram adicionados como card. Reavaliar se/quando houver confirmação de aprovação Anvisa e programa de acesso local.

Germinativo continua usando Life Genomics como ponte de acesso (parceiro genérico de genômica de precisão, não específico de subtipo tumoral) — nenhuma informação nova encontrada que mude isso.

**Atualização v0.6 — detecção automática do subtipo**: o seletor manual (botões "Ginecológico"/"Próstata" no passo 1) foi removido a pedido do usuário. O médico não escolhe mais o subtipo antes de descrever o caso — ele só descreve/anexa o material, e a própria extração da Camada 3 identifica qual vertical está sendo descrita (campo `tipo_tumor` no schema unificado, `UNIFIED_SCHEMA`/`UNIFIED_SYSTEM_PROMPT` em `server/index.js`) a partir do conteúdo (órgão mencionado, histologia, marcador — PSA é próstata, FIGO/CA-125 é ginecológico). O backend não recebe mais um parâmetro de subtipo do frontend: uma única chamada à API já faz as duas coisas — identifica o tipo e extrai só os campos relevantes a ele (os do outro subtipo ficam vazios no retorno). O frontend chama `setSubtype()` automaticamente com o resultado.

Duas salvaguardas foram mantidas: (1) se a IA não conseguir determinar o subtipo com segurança, `tipo_tumor` volta como "Não identificado" e a extração é rejeitada com uma mensagem pedindo pra descrever de forma mais específica, em vez de adivinhar; (2) na tela de revisão, um botão "Não é isso? Trocar tipo" permite correção manual caso a IA classifique errado — troca o conjunto de campos exibido, mas não reextraí nada (o médico completa os campos do subtipo correto manualmente). O código do caso também deixou de usar o prefixo fixo `GYN-` (agora `CASO-`), já que o subtipo não é mais conhecido no momento em que o código é gerado.

### Estado real do upload de PDF/foto no mockup (importante)

O mockup permite anexar PDF e foto (inclusive por arrastar-e-soltar, múltiplos arquivos de uma vez), mas **não lê o conteúdo desses arquivos** — só guarda o nome/miniatura como registro de que a fonte foi anexada. A extração de dado estruturado (Camada 3) continua rodando só sobre o campo de texto. A interface agora avisa isso explicitamente (ao anexar um arquivo, aparece a nota "este protótipo ainda não lê o conteúdo automaticamente") em vez de falhar silenciosamente, que foi o comportamento que gerou confusão antes.

Ler de verdade o conteúdo de um laudo em PDF/foto exige OCR + extração via modelo de linguagem sobre esse texto — a mesma dependência de backend real já registrada para a extração de texto livre (seção 10, "protótipo final real"). Isso não é uma correção pontual: é a mesma pendência estrutural, agora também para PDF/imagem, não só para texto digitado.

---

## 7. Integração com Plaud

Pontos a resolver antes de desenhar o encaixe técnico:
- O Plaud (cartão gravador) tem **API pública/webhook** para exportar transcrições automaticamente, ou o fluxo real hoje é "gravar → app do Plaud transcreve → médico exporta/copia o texto"?
- Se não houver API aberta, a "integração" no MVP é simplesmente: **campo de colar transcrição** (o que você já descreveu como opção separada) — sem sincronização automática. Isso já resolve 90% do valor sem depender de integração externa incerta.
- Uma integração automática (OAuth do Plaud → puxa transcrição direto) fica como item de Fase 2/3, condicionado à Plaud ter API disponível para isso.

---

## 8. Stack sugerida para prototipagem (MVP rápido)

- **Frontend**: Web app simples (Next.js/React), mobile-responsive — médico usa no celular/tablet entre consultas.
- **Backend**: API leve (Node ou Python/FastAPI) para orquestrar ingestão, pseudonimização, extração e motor de regras.
- **OCR/parsing**: biblioteca de PDF/OCR (Tesseract ou serviço gerenciado) para laudos digitalizados.
- **Extração estruturada**: chamada a LLM (ex.: Claude) **apenas sobre o dado já pseudonimizado**, com prompt restrito a extrair entidades clínicas — nunca envia dado identificável a provedor externo. O mesmo modelo conduz a via conversacional do OncoBot (Camada 4-B).
- **Motor de triagem**: regras explícitas versionadas (não IA generativa pura) — cada regra referencia a diretriz-fonte, para auditabilidade. Compartilhado pelas duas vias de entrada (formulário/upload e OncoBot).
- **Banco de dados**: separar fisicamente/logicamente a tabela de reidentificação (nome real) do banco de casos estruturados.
- **Base de programas da indústria**: tabela curada, com painel administrativo (CMS) simples para gestão dos programas sem necessidade de código.

---

## 9. Elementos centrais do Hub de Acesso

| Elemento | Onde entra no desenho |
|---|---|
| OncoBot (conversa) / Suporte à Decisão Clínica | Camada 4-B (via de entrada) + Camada 4 (Motor de Triagem) + Camada 6 (Output) |
| Catálogo de Programas | Camada 5 |
| Portal do Médico / login / CRM | Estrutura de telas, item 1 |
| Painel Administrativo (CMS) | Camada 5, manutenção da base |
| Pré-Validação de elegibilidade | Camada 4, parte "critério de elegibilidade" |
| Disclosure (privacidade do paciente) | Camada 2 (pseudonimização) — cobre tanto dado real do paciente (PDF, áudio) quanto a conversa com o OncoBot |
| Fases 1/2/3 e orçamento | Fase 1 (MVP): ingestão multimodal + estrutura de telas. Fase 2: motor de triagem completo + OncoBot + Plaud. Fase 3: educação, analytics, parcerias |

---

## 10. Modelo de negócio: os dois gargalos

Você identificou dois gargalos distintos, e é importante mantê-los separados porque cada um tem uma camada técnica própria (acima) e implica uma fonte de receita diferente:

| Gargalo | Medo/barreira do médico | Camada que resolve | Quem tem interesse em financiar |
|---|---|---|---|
| **1. Não sabe qual teste pedir** | "Não tenho certeza se esse caso tem indicação, nem de qual exame — HRD? germinativo? os dois?" | Camada 4 (Motor de Triagem) + Camada 4-B (OncoBot) | Indústria farmacêutica (quer mais pacientes elegíveis identificados) e instituições de saúde (querem qualidade assistencial) |
| **2. Não sabe/não tem staff para pedir** | "Mesmo sabendo qual exame, o formulário é complexo e eu não tenho secretária para preencher" | Camada 8 (Geração do documento de solicitação) + Camada 5 (Programas de acesso) | Indústria farmacêutica (reduz abandono no meio do funil — o mesmo gargalo "Atrito na Solicitação" e "Gargalo Operacional") e laboratórios parceiros (mais pedidos corretamente preenchidos, menos retrabalho) |

### Opções de modelo de receita

1. **Patrocínio por indústria via orçamento de acesso/educação médica (modelo principal recomendado).**
   A indústria farmacêutica (ex.: quem já mantém programas de teste gratuito, como no exemplo HRD) financia o uso da ferramenta como parte do próprio orçamento de programas de acesso e educação médica — o mesmo tipo de budget que já paga por materiais educacionais e suporte administrativo hoje. A plataforma cobra por **disponibilizar a ferramenta e manter o catálogo/templates atualizados**, não por paciente direcionado nem por teste solicitado — isso evita qualquer aparência de pagamento por indicação (que seria antiético e um risco regulatório sério). É essencial que isso passe por aprovação de Medical/Regulatory (MLR) como ferramenta educacional/de suporte operacional, não promocional.

2. **Assinatura institucional B2B (SaaS).**
   Clínicas, hospitais ou grupos oncológicos pagam uma assinatura mensal/anual pelo acesso da equipe médica à ferramenta — independe de qual indústria patrocina qual teste. Reduz a dependência de um único patrocinador e fortalece a percepção de neutralidade clínica.

3. **Freemium para o médico individual.**
   Triagem (Camada 4) gratuita e sempre disponível — é a porta de entrada e o que gera adesão. Funcionalidades de "conforto operacional" (geração de documento pré-preenchido, histórico de casos, integração com Plaud) como camada paga ou patrocinada, para quem "carreira solo" sem staff sente mais esse gargalo.

4. **Métricas agregadas como produto complementar (já previsto na ideia original de dashboard/analytics).**
   Dados agregados e anonimizados (nunca por paciente) sobre onde o funil de testagem vaza por região/especialidade viram um produto de inteligência para os parceiros da indústria — sem vender dado de paciente, só padrão de uso da ferramenta.

### A regra de ouro para qualquer um desses modelos

**A Camada 4 (motor de triagem clínica) nunca pode ser influenciada por quem patrocina.** A separação estrutural já desenhada — a lógica de indicação vem só de diretriz (NCCN/ESMO/ASCO/...), e a Camada 5/8 (quem oferece o teste de graça e como pedir) é uma camada comercial à parte, sempre exibida *depois* da recomendação clínica, nunca antes — é o que sustenta qualquer um dos modelos acima perante Medical/Regulatory e perante o próprio médico usuário. Se essa linha for borrada, o produto deixa de ser "ferramenta de suporte" e vira material promocional, com toda a régua regulatória que isso implica.

---

## 11. Decisões já tomadas (v0.2)

- **Escopo agora**: mockup navegável (ver `mockup/oncogyn-flow.html`) para validar o fluxo antes de qualquer código de produção.
- **Vertical piloto**: Ginecológico (câncer de ovário), com expansão posterior para outros subtipos com componente genético relevante.
- **Plaud**: integração via API é o alvo (Fase 2/3); no MVP o campo "colar transcrição" já cobre o mesmo caso de uso sem depender de disponibilidade de API.
- **Regra de ouro do GYN (corrigida na v0.3 — ver seção 6)**: germinativo é indicado para **toda** histologia epitelial não-borderline de ovário, sempre. Somático (HRD+BRCA tumoral, elegibilidade PARP) só é indicado quando histologia é **seroso OU endometrioide**, de **alto grau**, em **estágio III/IV** — não é regra de "sempre os dois juntos". A versão anterior só reconhecia "seroso de alto grau" e deixava de fora "endometrioide de alto grau em estágio III/IV", que pela NCCN tem exatamente a mesma indicação de par completo — esse bug foi corrigido no motor do mockup (`classifyCase()` em `mockup/oncogyn-flow.html`).
- **Tom da cópia clínica**: texto direto, sucinto e objetivo — sem linguagem decorativa, ícones afetivos ou blocos de texto longos. O card sobre indicação do germinativo é uma nota clínica curta (rótulo + uma frase de justificativa + estatísticas em linha + uma sugestão de comunicação, sem enfeite visual), porque o médico navega a ferramenta rápido entre consultas e espera objetividade, não acolhimento estético.
- **Princípio de exibição — só o que é acionável agora**: a tela de Programas não lista mais testes/painéis fora do escopo do caso atual (removido o card "Painel para status de reparo homólogo ampliado — fora do escopo"). Mostrar algo marcado como "não se aplica aqui" não dá nenhuma ação possível ao médico, só adiciona leitura e ruído. Esse princípio vale para o produto inteiro: qualquer informação que não seja necessária ao passo em que o médico está fica fora da tela. Se um caminho condicional futuro precisar ser sinalizado (ex.: painel de HRR ampliado, relevante só se o BRCA tumoral vier selvagem), ele deve aparecer **depois**, quando o resultado anterior o tornar de fato relevante — não antes, como aviso do que "não se aplica ainda".
- **Fonte das regras de indicação**: diretrizes publicadas e reconhecidas internacionalmente — NCCN, ESMO, ASCO e **SGO** (Society of Gynecologic Oncology, referência de prática específica para oncologia ginecológica). Cada regra no motor de triagem carrega a diretriz de origem e a versão/ano, para rastreabilidade. Ver o detalhamento completo, com o critério exato de cada regra, na seção 6.
- **Processo daqui pra frente**: diretriz primeiro, código depois — nenhuma regra nova entra no motor sem antes estar documentada na seção 6 com fonte e critério. Essa ordem foi adotada depois do bug do "endometrioide" (ver acima), que aconteceu justamente por implementar uma regra sem levantar todos os critérios da diretriz antes.
- **Mapeamento indústria × teste**: fica como dado a validar por você antes de publicar (ver seção 12) — o motor de triagem e a base de programas são desacoplados de propósito, para que a parte clínica (diretriz) nunca dependa da parte comercial (quem patrocina o teste hoje).
- **Segundo gargalo endereçado**: além de "qual teste pedir", a Camada 8 gera o **documento de solicitação já preenchido** (nome do paciente, dados do médico, teste e justificativa citando diretriz) — ver passo 5 do mockup. O nome real do paciente só existe nessa camada, isolado do resto do pipeline pseudonimizado.

---

## 12. Pendente da sua validação

O mockup já mostra a estrutura da tela de programas (AstraZeneca e GSK como exemplo para HRD), mas os dados de **quem oferece o quê, com qual critério de elegibilidade, hoje** precisam ser confirmados por você antes de qualquer publicação — isso inclui:
- Critérios de elegibilidade atuais de cada programa (podem ser mais restritos que o critério clínico da diretriz).
- Se há programa de acesso gratuito para o **teste germinativo** em GYN (o mockup mostra esse card como "pendente" propositalmente).
- Cobertura por região/rede (nem todo programa está disponível em todo lugar).
- Quais laboratórios/templates de formulário usar para o **documento de solicitação do germinativo** (a tela de programas mostra esse teste como "pendente" de parceiro, mas o documento de solicitação em si pode ser gerado com um template genérico de laboratório enquanto isso).

---

## 13. Próximas perguntas em aberto

1. Olhando o mockup (`mockup/oncogyn-flow.html`), o fluxo de 5 passos (incluindo o novo passo de documento de solicitação) faz sentido, ou falta/sobra alguma etapa?
2. O tom do card "Por que também pedir o germinativo" está no nível certo de acolhimento, ou precisa ajustar (mais direto/mais suave)?
3. Para a tela de Programas: você já tem a lista real de critérios de elegibilidade AstraZeneca/GSK para HRD que eu possa estruturar, ou isso fica para uma rodada de validação conjunta depois do mockup aprovado?
4. Depois do GYN, qual subtipo entra em seguida — Mama (exemplo TNBC + idade <45) ou outro?
5. Sobre o modelo de negócio (seção 10): qual das quatro opções faz mais sentido como ponto de partida — patrocínio direto da indústria, assinatura institucional, freemium individual, ou uma combinação? Isso muda o que priorizamos construir a seguir.
6. Os templates reais de formulário de solicitação (AstraZeneca para HRD, por exemplo) — você tem acesso a eles hoje para eu estruturar os campos com precisão, ou isso também entra na rodada de validação conjunta?

---

## 11. Autenticação e contas de médico (v1.0)

Até a v0.7 a "entrada" era um formulário local de nome + CRM guardado em
`localStorage` — suficiente para preencher documentos num protótipo, mas sem
nenhuma noção de conta, credencial ou sessão. A v1.0 substitui isso por
autenticação real, porque a plataforma passa a tratar dado de saúde sob
responsabilidade de um profissional identificável.

### Fluxo

1. **Criar acesso** — o médico informa nome, CRM e email. A conta é criada sem
   senha e um link de definição é enviado por email.
2. **Definir senha** — o link (válido por 60 min, uso único) abre a tela de
   definição de senha e, ao concluir, já entrega a sessão autenticada.
3. **Login** — a partir daí, email + senha. A sessão dura 12 horas.
4. **Redefinir** — "Esqueci minha senha" está sempre disponível e usa
   exatamente o mesmo mecanismo do primeiro acesso.

### Decisões de segurança

| Decisão | Motivo |
|---|---|
| Senha via **scrypt** (KDF nativo do Node), salt por usuário, comparação em tempo constante | Sem dependência nativa a compilar no deploy; resistente a GPU |
| Token de sessão e de reset gerados por CSPRNG e guardados **apenas como hash SHA-256** | Um vazamento do banco não entrega sessões ativas nem links de reset |
| Token de reset de **uso único**, invalidado ao emitir um novo | Link reenviado ou interceptado depois do uso não vale mais |
| Respostas **neutras** em "criar acesso" e "esqueci a senha" | A tela não vira oráculo que confirma "este médico usa a plataforma" |
| Mensagem única para email inexistente / senha errada / conta sem senha | Não revela em qual dos casos o atacante caiu |
| **Rate limiting** por IP+email no login e por email no envio de link | Trava força bruta oportunista |
| Mínimo de **10 caracteres**, sem exigir símbolo/maiúscula | NIST SP 800-63B: comprimento supera complexidade, que só empurra o usuário para padrões previsíveis |
| Validação de senha **antes** de consumir o token de reset | Digitar uma senha fraca não queima o link do médico |
| `/api/extract` exige sessão | Antes, qualquer um com a URL consumia crédito de API |

### Persistência — e por que o servidor recusa subir sem banco

`server/store.js` tem dois back-ends com a mesma interface: Postgres (quando
`DATABASE_URL` existe) e arquivo JSON (desenvolvimento local).

O disco do Render free tier é **efêmero**: zera a cada deploy e a cada restart.
Um arquivo JSON ali daria a impressão de funcionar e apagaria as contas dos
médicos sem erro visível. Por isso `index.js` **encerra o processo no boot** se
`NODE_ENV=production` e `DATABASE_URL` estiver ausente. Falhar alto no deploy é
muito melhor do que perder conta de usuário em silêncio semanas depois.

Postgres gratuito e permanente: **Neon** (neon.tech) ou **Supabase**. O free
tier de Postgres do próprio Render expira em 30 dias — não serve aqui.

### Email

`server/email.js` usa a API do **Resend**. Sem `RESEND_API_KEY` o link cai no
console do servidor (aceitável em desenvolvimento) e a resposta da API traz um
campo `devUrl` para o fluxo não travar — campo que nunca aparece em produção,
já que lá a chave é obrigatória.

---

## 12. Integração Plaud (v1.0)

`server/plaud.js` implementa o fluxo OAuth 2.0 completo: `authorize` →
`callback` → troca de código por token → refresh automático → listagem de
gravações → importação da transcrição direto para o campo de texto do caso.

**Estado atual**: a API do Plaud Developer Platform está em **beta privado**. O
código está pronto e se ativa sozinho assim que `PLAUD_CLIENT_ID` e
`PLAUD_CLIENT_SECRET` existirem no ambiente — nenhuma mudança de código será
necessária. Enquanto isso, a UI mostra o estado honesto ("integração ainda não
liberada para esta instalação") em vez de um toggle decorativo que não faz nada,
que era o comportamento anterior.

Detalhes de implementação que importam:

- O parâmetro `state` do OAuth é um **HMAC assinado** que amarra o callback ao
  médico que iniciou a conexão e expira em 10 minutos — sem isso, o retorno do
  provedor não teria como ser atribuído com segurança a uma conta.
- O `redirect_uri` respeita `x-forwarded-proto`: o Render termina o TLS no proxy
  e, sem isso, o callback seria montado como `http://` e o provedor recusaria.
- As respostas do Plaud passam por normalização (`normalizeRecording`,
  `extractTranscriptText`) porque o formato de um beta ainda pode mudar; a UI
  não quebra a cada ajuste do provedor.
- Os endpoints são sobrescrevíveis por variável de ambiente, para o caso de o
  beta publicar caminhos diferentes dos previstos.

---

## 13. Gena — assistente conversacional flutuante (v1.1)

A via conversacional era uma aba dentro do passo 1, com um roteiro fixo de três
perguntas e respostas pré-escritas. Duas limitações sérias: só existia na tela
de ingestão, e não era conversa — era um formulário disfarçado que ignorava o
que o médico realmente escrevia.

A v1.1 substitui isso pela **Gena**: assistente com nome, rosto e presença
permanente, acessível de qualquer tela por um botão flutuante no canto inferior.

### Conversa real

`POST /api/chat` conversa com o modelo de verdade (`GENA_SYSTEM_PROMPT` em
`server/index.js`). A Gena entende resposta em linguagem natural, aceita vários
dados de uma vez, normaliza notação ("3C" → IIIC, "G3" → alto grau) e pergunta
só o que ainda falta.

**Handoff estruturado**: quando reúne o mínimo necessário, a Gena encerra a
mensagem com uma linha `CASO_PRONTO: <resumo>`. O frontend separa essa linha do
texto exibido e a usa para preencher o caso e disparar a mesma extração
estruturada do modo formulário. Ou seja: a conversa é outra porta de entrada
para o mesmo motor — nunca um segundo motor de decisão paralelo.

### Limites embutidos no prompt

- Não decide qual teste pedir nem dá conduta terapêutica; se perguntarem, ela
  diz que vai reunir o caso e rodar a triagem no motor de regras.
- Nunca pede nome, CPF ou data de nascimento. Se o médico mencionar
  espontaneamente, ela ignora e não repete o dado.
- Respostas de 1 a 3 frases, uma pergunta por vez — tom de colega, não de
  chatbot entusiasmado.

### Personagem e comportamento visual

O rosto é SVG inline desenhado com `currentColor`, então a Gena herda a cor do
contexto (branca sobre o botão flutuante, verde sobre o cabeçalho claro do
painel) sem precisar de dois arquivos. A piscada é esporádica (a cada ~6,5s) e
some sob `prefers-reduced-motion`: movimento constante puxaria atenção de uma
tela de decisão clínica.

No celular o painel ocupa a tela inteira — um cartão de 380px numa viewport de
390px vira uma caixa apertada assim que o teclado abre.

### Custo e contexto

O endpoint trunca a conversa nas últimas 24 mensagens e cada mensagem em 4000
caracteres. Sem esse limite, uma conversa longa (ou um cliente malicioso)
inflaria a fatura da API sem teto.

---

## 14. Nota sobre persistência na fase beta

A v1.0 fazia o servidor **encerrar no boot** em produção sem `DATABASE_URL`,
para não perder contas em silêncio. Essa trava foi removida na v1.1 por decisão
de produto: nesta fase o app precisa rodar sem depender de provisionar banco, e
perder conta entre versões é aceitável.

O comportamento honesto foi preservado de outra forma: `GET /api/config` expõe
`ephemeralAccounts`, e a tela de login mostra um aviso explícito de que as contas
são temporárias — em vez de o médico descobrir sozinho que o acesso sumiu.

Quando houver banco (`DATABASE_URL` de um Neon/Supabase), o aviso desaparece
sozinho e as contas passam a persistir, sem nenhuma mudança de código.

## 15. Registro único de tumores (v1.2) — `server/public/tumors.js`

Até a v1.1 cada subtipo tinha o seu próprio conjunto de campos no HTML, a sua
função `classifyCase*`, a sua `renderDocs*` e o seu bloco de programas —
duplicado por cópia. Com dois tumores isso já era ruim; com sete seria
insustentável, e pior: o schema de extração do backend e a regra clínica do
frontend viviam em arquivos diferentes e saíam de sincronia sem ninguém notar.

A v1.2 troca isso por **um registro declarativo único**, `server/public/tumors.js`,
carregado dos dois lados por um wrapper UMD:

- **servidor** — `require('./public/tumors.js')` monta o `UNIFIED_SCHEMA` da
  extração e a lista de subtipos do prompt;
- **navegador** — `<script src="/tumors.js">` monta os campos da revisão, roda a
  regra, desenha o resultado e gera os documentos de solicitação.

Cada tumor declara `{ id, label, short, detect, fields[], hint, classify(v),
diagnosis(v) }` e, opcionalmente, `relevance(v)`. **Toda a camada de tela é
genérica**: ela não sabe o nome de nenhum tumor. Acrescentar um subtipo é
acrescentar um objeto no registro — o schema de extração, os campos, o motor, os
cards de programa e os PDFs de solicitação passam a existir sozinhos.

O processo obrigatório continua valendo e não mudou: **diretriz primeiro, código
depois**. Nenhuma regra entra no registro sem estar nesta documentação, com a
fonte e o critério exato que a aciona.

## 16. Base de diretrizes — os cinco subtipos da v1.2

Mesmo processo das seções 6 e 6-B: diretriz pesquisada e documentada antes de
qualquer linha de motor. As fontes abaixo são as sociedades que emitem diretriz
para cada sítio; na interface elas **não** são citadas por nome (decisão de
produto da v1.2 — o médico lê "diretrizes nacionais e internacionais vigentes",
e a rastreabilidade fica aqui, neste documento).

### 16.1 Mama

**Fontes**: NCCN Genetic/Familial High-Risk Assessment: Breast, Ovarian,
Pancreatic and Prostate (v2.2026); ASCO–SSO "Germline Testing in Patients With
Breast Cancer" (JCO 2024, DOI 10.1200/JCO.23.02225).

**Eixo central**: subtipo por imuno-histoquímica (RE/RP/HER2) + idade ao
diagnóstico. Extensão da doença define o teste somático.

**Regra germinativa — indicado quando qualquer um destes é atendido:**
- Diagnóstico aos 50 anos ou menos, qualquer subtipo.
- Subtipo triplo-negativo, **em qualquer idade** (o corte etário de 60 anos das
  versões antigas do NCCN foi removido; hoje o critério é universal para TNBC).
- Doença metastática, qualquer subtipo — o resultado define elegibilidade a
  inibidor de PARP.
- Histórico familiar oncológico relatado.

**Regra somática — indicado quando:** doença metastática **e** subtipo luminal
(RH+/HER2−). O painel cobre PIK3CA, ESR1 e alvos acionáveis; ESR1 deve ser
reavaliado à progressão sob terapia endócrina.

> **Divergência conhecida e deliberada**: a ASCO–SSO recomenda oferecer teste
> germinativo a **todo** paciente com câncer de mama diagnosticado aos 65 anos
> ou menos, um critério mais largo que o do NCCN. O motor segue a linha do NCCN
> (≤50 + TNBC + metastático + histórico familiar) por ser a mais usada na prática
> brasileira. Trocar para o corte de 65 anos é mudar um número em `classify()` —
> mas é decisão clínica, não de código, e precisa ser tomada aqui primeiro.

### 16.2 Pâncreas

**Fonte**: NCCN Pancreatic Adenocarcinoma Guidelines; NCCN Genetic/Familial
High-Risk Assessment (v2.2026).

**Regra germinativa — indicação universal.** Todo adenocarcinoma ductal (PDAC)
tem indicação de teste germinativo ao diagnóstico, **independente de idade,
estágio ou histórico familiar**. Esta é a regra mais importante da seção e a
mais desobedecida na prática: em uma série de 854 pacientes com PDAC, apenas 3
de 33 portadores de mutação deletéria (9%) tinham histórico familiar relevante —
ou seja, **triar por histórico familiar deixa passar 91% dos portadores**.

**Regra somática — indicado quando:** doença metastática. Perfil tumoral +
MSI/MMR, para alvos acionáveis e para confirmar alterações em genes de reparo
quando o germinativo é negativo.

**Fora de escopo**: tumor neuroendócrino de pâncreas segue outra diretriz. O
motor **recusa explicitamente** em vez de aplicar a regra do PDAC por analogia.

**Nota de impacto terapêutico** (exibida quando metastático + platina): em
doença metastática com mutação germinativa BRCA1/2 e resposta mantida à platina
há indicação de manutenção com inibidor de PARP — o resultado muda a conduta
dentro dessa janela, o que torna o tempo do teste clinicamente relevante.

### 16.3 Colorretal

**Fontes**: NCCN Genetic/Familial High-Risk Assessment: Colorectal, Endometrial
and Gastric (2025); NCCN Colon/Rectal Cancer Guidelines (2026).

**Regra 1 — pesquisa de MMR/MSI: universal.** Todo carcinoma colorretal recém-
diagnosticado tem indicação, **independente de idade ou histórico familiar**. Um
único teste informa três coisas de uma vez: prognóstico, elegibilidade a
imunoterapia e risco familiar (síndrome de Lynch). Não há evidência que
favoreça IHQ das proteínas de reparo sobre análise de MSI ou vice-versa — os
dois métodos são aceitos.

**Regra 2 — confirmação germinativa de Lynch:** indicada quando o tumor é
dMMR/MSI-alto. Painel MLH1, MSH2, MSH6, PMS2, EPCAM. **Ressalva embutida no
texto do resultado**: perda isolada de MLH1 exige antes afastar causa esporádica
(metilação do promotor ou BRAF V600E) — pular esse passo gera encaminhamento
genético desnecessário.

**Regra 3 — perfil somático:** indicado em doença metastática, antes de definir
terapia dirigida. RAS mutado contraindica anti-EGFR; BRAF V600E define esquema
específico; HER2 amplificado abre linha dirigida.

Quando MMR/MSI já foi feito e veio pMMR/MSS em doença não metastática, o motor
responde **"nenhum teste adicional indicado"** — e diz que reavaliar faz sentido
se a doença progredir. Não é o mesmo que "sem indicação".

### 16.4 Endométrio

**Fontes**: NCCN Uterine Neoplasms (2025/2026); NCCN Genetic/Familial High-Risk
Assessment: Colorectal, Endometrial and Gastric (2025).

**Regra 1 — classificação molecular: universal.** Pesquisa de MMR/MSI indicada
para todo carcinoma de endométrio, independente de idade ou histórico familiar —
mesma lógica do colorretal, e as duas neoplasias são rastreadas juntas na
diretriz de Lynch. A classificação molecular completa acrescenta **POLE** e
**p53**, com impacto prognóstico e de conduta adjuvante. Os quatro grupos são
POLE-mutado, dMMR, p53-anormal e NSMP; **POLE prevalece sobre os demais
marcadores** em tumores multi-classificadores.

**Regra 2 — confirmação germinativa de Lynch:** indicada quando dMMR, com a
mesma ressalva de MLH1 do colorretal.

### 16.5 Pulmão — não pequenas células (NSCLC)

**Fonte**: NCCN Non-Small Cell Lung Cancer Guidelines (2026).

**Eixo central**: ao contrário dos demais sítios, aqui a indicação é
**predominantemente somática** — não há regra germinativa universal.

**Regra — painel molecular amplo:** indicado em doença **localmente avançada ou
metastática**, antes de definir a primeira linha. Cobre no mínimo EGFR, ALK,
ROS1, BRAF V600E, KRAS (incl. G12C), MET (ex14 skipping e amplificação), RET,
NTRK1/2/3 e ERBB2/HER2.

**Por que amplo e não gene a gene**: a própria diretriz recomenda perfil amplo
em vez de testagem sequencial, para **minimizar consumo e desperdício de
tecido** — e, na prática, para não atrasar a decisão terapêutica. Quando o
tecido é insuficiente, a biópsia líquida é alternativa aceita.

**Doença inicial ressecável**: o motor responde "sem indicação de painel amplo"
mas registra que cenários iniciais podem ter pesquisa dirigida (ex.: EGFR para
terapia adjuvante) — e pede reavaliação conforme a conduta.

**Fora de escopo**: carcinoma de **pequenas células** segue via clínica
distinta. O motor recusa explicitamente em vez de aplicar a regra do NSCLC.

## 17. Modo de acesso simples (v1.2)

A v1.0 implementou autenticação completa por email + senha (seção 11). Ela
depende de duas coisas que a fase de validação clínica ainda não tem: **domínio
próprio** (o remetente de sandbox do Resend só entrega ao dono da conta, então
um médico real nunca receberia o link de redefinição) e **banco persistente**.

A v1.2 introduz `AUTH_MODE`, com dois valores:

| Valor | Comportamento |
|---|---|
| `simples` (padrão) | O médico entra com **nome + CRM**. `POST /api/auth/acesso` emite a sessão; as rotas de email/senha respondem 404. |
| `completo` | O fluxo da seção 11 (cadastro, link por email, senha). `POST /api/auth/acesso` responde 404. |

Decisões relevantes:

- **Não é "sem autenticação".** A sessão emitida é a mesma dos dois modos, com o
  mesmo TTL e o mesmo armazenamento por hash. `/api/extract` e `/api/chat`
  continuam protegidos — o que muda é o atrito de entrada, não a proteção. Isso
  importa porque `/api/extract` consome créditos pagos da API.
- **Identidade estável por CRM.** O CRM é normalizado em um identificador
  interno (`crm-123456-sp@acesso.oncogenyx`), então o mesmo CRM sempre cai na
  mesma conta e o histórico é recuperado quando há banco. O nome é atualizado a
  cada entrada: é ele que vai impresso na solicitação assinada, então vale
  sempre o que o médico acabou de digitar.
- **As rotas do modo desligado somem de verdade** (404), em vez de ficarem de pé
  prometendo um email de recuperação que ninguém enviaria.
- **Voltar para o modo completo é uma variável de ambiente**, não um refactor: o
  código dos dois fluxos convive.

## 18. Diretrizes na interface (v1.2)

Decisão de produto: a interface **não cita sociedades por nome**. Onde antes
aparecia "conforme NCCN Ovarian Cancer Guideline e ESMO (2026)", hoje aparece
"com base em diretrizes clínicas nacionais e internacionais vigentes".

Motivos:

- Citar seis siglas em toda tela polui a leitura sem ajudar a decisão.
- A rastreabilidade continua existindo — ela mora **aqui**, com a fonte e o
  critério exato, que é onde alguém que precise auditar vai procurar.
- Evita a leitura de endosso: a plataforma **aplica** critérios publicados, não
  fala em nome de nenhuma sociedade.

As citações permanecem nos prompts de extração quando são instrução técnica ao
modelo (ex.: a definição das categorias de risco na próstata), porque ali o nome
da diretriz é o que ancora a resposta correta — e esse texto nunca é exibido ao
médico.

## 19. Incidente: colisão de chaves no schema de extração (v1.3)

**O que aconteceu.** A v1.2 montava o schema de extração fundindo campos de
mesmo nome entre tumores. `extensao_doenca` existe em cinco tumores com listas
de valores completamente diferentes; a fusão fazia o schema levar a lista de
**um** deles e aplicá-la a todos. Na prática, o modelo só podia responder com
os valores da mama:

| Tumor | Valores que a regra precisa | Valores que o schema permitia |
|---|---|---|
| Próstata | Localizado, N1, mHSPC, mCRPC | Inicial (operável), Localmente avançado, Metastático |
| Pâncreas | Ressecável, Borderline, Metastático | idem |
| Colorretal | Localizado / ressecado, Metastático | idem |
| Pulmão | Inicial (ressecável), Localmente avançado, Metastático | idem |

Ou seja: **mCRPC e "Linfonodo positivo (N1)" eram impossíveis de extrair.** Um
caso de próstata metastática resistente à castração — o cenário de maior
impacto terapêutico do sítio — não chegava íntegro ao motor. O mesmo valia para
`histologia`, que recebia a descrição do ovário para os sete tumores e perdia a
lista fechada do pulmão.

**Por que os testes não pegaram.** A suíte de ponta a ponta simulava a
extração e **injetava os valores corretos à mão**. Ela exercitava o motor e a
tela, nunca o schema. Um teste que mocka a fronteira valida tudo menos a
fronteira.

**Correção.** O schema passa a usar chave namespaced por tumor
(`prostata__extensao_doenca`), cada uma com a sua descrição e a sua lista. O
servidor desfaz o prefixo em `TUMORS.unscope()` antes de responder, então o
navegador continua lendo `extensao_doenca`. Ver seção 15.

**O que ficou para não repetir.** `server/test/` (roda com `npm test`):

- `schema.test.js` — integridade do contrato. Falha se duas chaves de schema
  colidirem, se a lista de valores do schema divergir da do tumor, se
  `classify()` ler um campo que o tumor não declara (pega renomeação
  esquecida), se um teste indicado vier sem amostra, justificativa ou programa.
- `regras.test.js` — 62 casos clínicos com grafia variada, incluindo o caso
  real que expôs o problema.

E a suíte de navegador passou a **usar o mesmo `unscope()` do servidor** em vez
de injetar valores prontos.

## 20. Tolerância de escrita no motor (v1.3)

O campo da revisão é editável: o médico corrige à mão e escreve do jeito dele.
A regra passou a normalizar antes de comparar.

- `estadioNumero()` aceita romano e arábico, com ou sem subletra, com ou sem
  prefixo: `IV`, `4`, `estágio 4`, `IIIC`, `3C`, `FIGO IV`, `EC IIIB`.
  Antes, `/^(iii|iv)/` exigia romano — "estágio 4" era lido como estádio
  desconhecido e o caso perdia a indicação do teste somático.
- `grauAlto()` / `grauBaixo()` aceitam `Alto grau`, `alto`, `G3`, `grau 3`,
  `pouco diferenciado`, `indiferenciado` — e os equivalentes de baixo grau.
- `num()` aceita vírgula decimal e unidade colada (`18,4 ng/mL`, `86 anos`).
- `filled()` trata `Não relatado` / `Nenhum relatado` como ausência de
  conteúdo, não como conteúdo.

A mesma exigência foi para o prompt de extração, com exemplos explícitos —
inclusive de erro de digitação (`endometeioide` → `Endometrioide`). A regra
declarada ao modelo é: **dado escrito de forma não-canônica é dado presente, e
deixá-lo em branco é erro, não prudência.**

### Idade unificada

`idade_faixa` (faixa quinquenal) virou `idade` (anos). A faixa existia por
pseudonimização, mas idade isolada não identifica ninguém, é critério clínico
direto (mama ≤50) e obrigava o modelo a converter "paciente de 86 anos" numa
faixa — conversão que ele simplesmente não fazia. Mama deixou de ter campo
próprio de idade: era duplicidade na mesma tela.

### Campo decisivo

Só campo marcado `decisivo: true` no registro aparece destacado em amarelo
quando vazio. Pintar todo campo vazio de alerta transforma "opcional" em
"erro" e treina o médico a ignorar o aviso — inclusive quando ele importa.
O ovário vai além: `relevance()` devolve `null` enquanto a histologia estiver
vazia, porque nesse momento ainda não se sabe se grau e estágio influenciam.

## 21. Primeiro acesso e densidade de texto (v1.3)

Três correções de leitura, todas na tela 1:

- **Boas-vindas em modal**, uma vez por navegador, com o fluxo em três linhas
  e um botão "Começar". Reabre pelo link "Como funciona" — a explicação não
  some para quem quiser consultar. Fecha com Esc, com clique no fundo e
  devolve o foco para onde estava.
- **Cobertura em chips** em vez de frase corrida. Sete subtipos numa linha de
  texto viravam um parágrafo que ninguém lê; como chips, é escaneável.
- **Textos encurtados**: o exemplo dentro do campo de texto tinha três linhas
  e competia com o próprio campo.
