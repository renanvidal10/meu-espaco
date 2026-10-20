# Progresso: redesenho da tela "Resultado da triagem" (Equipe 3, design)

Branch: `claude/design-resultado-3179de`. Nada publicado, nada enviado ao GitHub.

## Feito (20/10/2026)

1. Lidas as regras (CLAUDE.md) e as seções de design de `docs/ARQUITETURA.md`
   (§43 escala, §45 densidade, §57 identidade, §63 trilho, §64, §67, §71 a §74, §84).
2. Três propostas montadas sobre o app real, com o caso de ovário seroso de alto
   grau IVC, sem mudar uma palavra de conteúdo clínico:
   * `mockup/resultado-propostas/propostas.js`: CSS (só tokens do app) e HTML de cada proposta.
   * `mockup/resultado-propostas/captura.js`: sobe no app local, injeta a proposta e fotografa.
   * `mockup/resultado-propostas/capturas/`: fotos (celular claro e escuro, computador)
     e `comparacao-celular.png` com as quatro lado a lado.
3. Propostas entregues ao dono. **Escolhida: B, com destaque da contagem. IMPLEMENTADA (§88).**
   Fotos do resultado final em `mockup/resultado-propostas/final/`.

## As propostas

* **A, Cartões enxutos (recomendada).** Veredito sem o bloco azul em degradê (só o
  título e o resumo, com um visto verde). Cada teste num cartão branco: número,
  nome, linha curta de "Prioridade · tipo · amostra", a primeira frase da
  descrição e a evidência com ícone. "Por que este teste" vira a faixa inferior
  do cartão, que abre a explicação e a justificativa que vai no pedido.
* **B, Lista que abre.** Veredito e testes num único painel. Cada teste mostra só
  nome, prioridade, tipo e amostra; descrição, evidência e justificativa abrem
  no toque. A mais curta, mas a descrição deixa de estar à vista.
* **C, Trilho limpo.** Mantém a linha do tempo de hoje (§63), tirando a caixa
  azul, a faixa "O QUE SOLICITAR", a sobrelinha em caixa alta e a pílula.

Comum às três: nome longo com genes entre parênteses passa a título + linha de
genes; a sobrelinha "TUMORAL · SOMÁTICO · PRIORIDADE" sai porque repetia a
amostra (o tipo vem de `test.kind`, a prioridade de `test.primary`).

## Pedidos que chegaram depois (coordenador, 20/10/2026)

* **Impressão vazando interface: CORRIGIDO** (commit 51d2d1d, §87.1 e §87.2). Regra
  de raiz no `@media print` e teste de navegador que agora pega o defeito.
* **Pedido em meia folha A4: FEITO** (commit aa87e23, §87.3). PDF de exemplo em
  `mockup/resultado-propostas/capturas/pedido-meia-folha.pdf`. Teste imprime de
  verdade e exige uma folha.
* **Tela de programas: DECIDIDO E FEITO (§89).** Dono decidiu: nenhum critério na tela, nem recolhido. Histórico da discussão: Fotos em
  `capturas/comparacao-programas.png`. Conflito: no GSK e no Amgen o texto embaixo
  do nome é o critério que recusa o paciente (§53, §67.3, trava em regras.test.js).
  Opção 1 (recomendada): critério continua à vista só nesses dois, o resto sai.
  Opção 2: critério recolhido em "Ver critério de elegibilidade".
  Também a confirmar: a linha "Sem via patrocinada verificada" (não aparece no
  ovário) perde a instrução "encaminhe pela anatomia patológica ou convênio" se o
  texto sair; recomendo manter.
  Implementação prevista: em `renderPrograms` (app.js) tirar `prog-verif`, tirar o
  selo `laboratorio`, renomear o programa em tumors.js para "Life Genomics", e
  mostrar a nota só quando `p.destaques` existir (opção 1) ou recolhida (opção 2).
  Testes: ajustar os que exigem o selo ou a data; novo teste de que nenhum
  programa sem `destaques` mostra nota e de que "Laboratório parceiro" não aparece.

## Próximo passo exato

1. Dono ver as duas telas implementadas (fotos em `mockup/resultado-propostas/final/`) e dar o ok.
2. Nada de publicação ou push sem o ok do dono e do coordenador.
