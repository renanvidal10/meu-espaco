# Briefing — segundo produto (triagem em doenças imunomediadas)

Documento de partida para a conversa nova. Nasceu dentro do projeto OncoGenYX,
mas descreve um **produto separado**: repositório próprio, domínio próprio,
banco próprio, marca própria.

Quem abrir a conversa nova deve começar apontando para este arquivo.

---

## 1. O que é o produto

Triagem baseada em diretrizes para **doenças imunomediadas**, cruzando quatro
especialidades que não se juntam por órgão, e sim pelos mesmos pacientes e
pelas mesmas drogas:

| Especialidade | Doenças |
|---|---|
| Reumatologia | Artrite reumatoide, espondiloartrite axial, artrite psoriásica |
| Gastroenterologia | Doença de Crohn, retocolite ulcerativa |
| Dermatologia | Psoríase, dermatite atópica, hidradenite supurativa |
| Pneumologia | Asma grave eosinofílica / T2 |

**A pergunta que o motor responde (decisão a confirmar com o dono):**

> **Opção A (recomendada).** Quais exames de rastreio precisam ser solicitados
> **antes** de iniciar imunobiológico, e por quê: tuberculose latente, hepatite
> B e C, HIV, hemograma, função hepática, situação vacinal.

Por que a A:

1. É a gêmea exata da pergunta do OncoGenYX — "qual exame solicitar e por quê,
   com a diretriz que sustenta". A forma do motor não muda.
2. É necessidade clínica real e grave: iniciar anti-TNF sem rastrear TB latente
   reativa tuberculose. Evento sério, conhecido e evitável.
3. É **rastreio de segurança, não indicação terapêutica**. Mantém a
   classificação regulatória leve, que no OncoGenYX já é um ativo.
4. Mesma economia de acesso: a indústria patrocina o rastreio porque ele
   antecede a prescrição.

> **Opção B.** "Este paciente tem critério para biológico, e qual classe."
> Mais vendável e mais arriscada — entra em indicação terapêutica. Pode vir
> depois, apoiada na base da A.

---

## 2. Decisão de arquitetura

**Começar como cópia; extrair o núcleo depois.**

Não extrair um "motor compartilhado" agora. Com um exemplo só, a separação
entre o que é genérico e o que é oncológico é adivinhação — e uma biblioteca
com o formato errado é pior do que não ter biblioteca.

- **Fase 1:** repositório novo, cópia da infraestrutura, conteúdo clínico novo.
  Regra dura: **não alterar as partes clínico-agnósticas do motor**. Correção
  de motor vai primeiro no OncoGenYX e é portada.
- **Fase 2 (depois da primeira doença rodando de ponta a ponta):** extrair o
  núcleo genérico para um pacote próprio que os dois produtos consomem.

---

## 3. O que se copia da infraestrutura (e funciona sem tocar)

Conferido linha a linha no motor do OncoGenYX:

| Camada | Reaproveita |
|---|---|
| Leitura por IA, com schema gerado pelo registro | 100% |
| Tela de revisão, com campos gerados pelo registro | 100% |
| Máquina de 6 estados de saída | 100% |
| Cards de programa de acesso e ordenação por indústria | 100% |
| Geração de PDF assinável | 100% |
| Auditoria por varredura de combinações + invariantes | 100% |
| Baterias de teste de infraestrutura | ~90% |
| Vocabulário (`tumor`, `histologia`, `estadiamento`) | renomear — 135 ocorrências |
| **Conteúdo clínico** | **0% — tudo novo** |

Os 6 estados de saída, que valem para qualquer triagem:
`completo` · `provisorio` · `parcial` · `sem-indicacao` · `nao-reconhecida` ·
`insuficiente`.

---

## 4. O que o motor atual NÃO sabe fazer, e precisa ganhar

Quatro acréscimos reais de engenharia:

1. **Um paciente, vários domínios.** Em oncologia um caso é um tumor. Aqui o
   paciente tem psoríase **e** artrite psoriásica **e** Crohn. O motor precisa
   classificar em paralelo e consolidar sem duplicar exame.
2. **Contas, não só categorias.** DAS28, PASI, BSA, DLQI, índice de Mayo,
   Harvey-Bradshaw, ACT/ACQ, eosinófilos, FeNO. O motor atual compara texto;
   não faz aritmética nem faixas numéricas.
3. **Falha terapêutica prévia.** "Após falha a dois DMARDs sintéticos" é
   condição temporal e sequencial, não um campo simples.
4. **Doença crônica se reavalia.** Câncer se estadia uma vez; artrite se
   reavalia a cada três meses. Isso pressiona o pilar de que **nada do paciente
   é guardado**.
   **Recomendação: manter a promessa.** Cada avaliação é um caso novo, sem
   histórico. Perde conveniência, preserva o diferencial.

---

## 5. Regras de processo herdadas — não negociáveis

Vieram de erro cometido e custam caro quando abandonadas.

- **Diretriz primeiro, código depois.** Nenhuma regra clínica entra no motor
  sem antes estar documentada com a **fonte** e o **critério exato** que a
  dispara. Esta regra nasceu de um bug causado por implementar antes de
  levantar todos os critérios.
- **Programa de acesso nunca se associa a uma doença por analogia.** Só com
  verificação documentada. Sem verificação, o card aparece marcado como
  pendente, de propósito.
- **Todo bug corrigido vira teste de regressão.** E o teste precisa ser visto
  **falhando** com o defeito presente — teste que nunca falhou é decoração.
- **Animação nunca esconde conteúdo clínico.** O estado de repouso é o visível.
- **Nenhuma fonte externa** (Google Fonts incluído): a promessa ao médico é que
  o material não gera pedido a terceiro.
- **O nome do paciente não entra no motor de triagem nem é gravado em servidor
  nenhum.** Atenção à redação: no OncoGenYX isto **não** significa que o nome
  não chega ao modelo. O material anexado sobe íntegro, e o modelo é instruído
  a localizar o nome para pré-preencher o documento. O filtro que existe no
  servidor (`ROTULO_PROIBIDO`) protege apenas o bloco de contexto do chat, não
  o fluxo de extração. **No produto novo, decidir isto no desenho, antes da
  primeira linha de código** — redação no navegador antes do envio é a única
  medida que de fato reduz o que cruza a fronteira.
- **Nada de `/api/` entra em cache do service worker.**
- **A suíte de testes nunca toca banco de produção.**
- **Medição se confere contra expectativa independente.** Três medições deste
  projeto devolveram números plausíveis e errados.

---

## 6. O que NÃO se copia

Cada produto tem o seu, sem exceção: marca e nome, domínio, banco de dados,
chave de API, variáveis de ambiente, decisão de LGPD, conta de e-mail,
repositório e deploy.

**Sobre a marca:** "OncoGenYX" não cabe neste produto — é um nome oncológico.
Ou a plataforma ganha um nome-guarda-chuva e cada vertical o seu, ou o produto
novo nasce com marca independente. Decidir **antes** de investir em identidade
visual.

---

## 7. Divisão realista do esforço

| | Peso | Quem |
|---|---|---|
| Generalizar o motor (renomear, multi-domínio, índices, falha prévia) | ~15% | Claude |
| **Conteúdo clínico**, cada regra com fonte e critério | **~75%** | **Renan + especialistas** |
| Curadoria dos programas de acesso | ~10% | **Renan**, com verificação documentada |

Os 15% saem em dias. Os 75% são o projeto.

**Diretrizes de referência:** SBR, ACR, EULAR · GEDIIB, ECCO, AGA · SBD, AAD ·
GINA, SBPT, ATS/ERS.

**Indústrias com programa de acesso em imunobiológico** (lista a verificar, uma
a uma, nunca por analogia): AbbVie, Janssen, Novartis, Lilly, UCB, Takeda,
Pfizer, Amgen, Sanofi, GSK, AstraZeneca.

---

## 8. Primeira entrega proposta

**Artrite reumatoide + rastreio pré-biológico**, de ponta a ponta.

Escolhida porque a diretriz é madura e consensual, o rastreio é o mesmo que
serve a Crohn, psoríase e asma grave — então uma entrada bem feita já demonstra
as quatro —, e o risco clínico de errar é baixo, por ser rastreio de segurança.

Com uma entrada no registro já se vê o fluxo inteiro: a IA lê o caso, o médico
confere, a regra classifica, o resultado mostra o que pedir com a diretriz, e
sai o documento assinável.

---

## 9. Perguntas em aberto para a conversa nova

1. Opção A (rastreio pré-biológico) confirmada?
2. Quem valida clinicamente a primeira regra? Há reumatologista disponível?
3. Nome e marca do produto novo.
4. Começar pelo esqueleto técnico (multi-domínio, índices numéricos, falha
   prévia) sem nenhuma regra clínica dentro? Isso independe da validação, e
   quando a diretriz chegar é só preencher.

---

## 10. Como abrir a conversa nova

Repositório novo, não uma pasta dentro do `meu-espaco`. Na primeira mensagem,
apontar para este arquivo e responder às quatro perguntas da seção 9.

**Antes de abrir:** o OncoGenYX tem commits não publicados e pendências de
infraestrutura. Abrir a segunda frente com a primeira fora do ar divide a
atenção e atrasa as duas. Publicar primeiro.
