# Racional da jornada: da chegada ao Café ou à célula

Contexto: igreja (IBA). Fluxo para transformar visitantes em pessoas numa célula, com o sistema fazendo o que der sozinho e pessoas nomeadas no resto. O fluxograma visual está em `fluxograma-jornada.png` (e `.svg` editável), na branch `fluxograma-jornada` do repositório `renanvidal10/meu-espaco`.

Legenda do fluxograma: verde = o sistema faz sozinho; azul = feito por pessoas.

## Pessoas e papéis
- **Pastor Everton**: recebe a visibilidade e cobra pelos números.
- **Matheus**: líder da Integração. Distribui as pessoas da Integração e, hoje, cobra os líderes de célula. Em 2027, os líderes de rede assumem essa cobrança.
- **Integração**: equipe que liga e acompanha quem quer conhecer mais (ex.: Renan liga para o João).
- **Líder de célula**: recebe a pessoa e a convida.

## Jornada (resumida)
1. **Chegada no culto** (automático): a pessoa preenche o formulário de visitante (inclui bairro, dias, faixa etária, Kids) e ele entra sozinho no sistema.
2. **Mensagem do pastor Everton** (automática): vídeo no WhatsApp 1 hora depois do fim do culto (ex.: termina 21h, chega 22h). Convida para o Café (1x por mês) ou direto para uma célula.
3. **Três caminhos**: 1 · Quero conhecer uma célula; 2 · Quero conhecer mais (Café); 3 · Não respondeu. Não existe "sem interesse": quem preencheu já é, no mínimo, um contato morno.

### Caminho 1: Quero conhecer uma célula
- Pula o Café; o sistema segue sozinho, sem ninguém no meio (vai ao passo "Mensagem com 5 células").

### Caminho 2: Quero conhecer mais (Café)
- Domingo marca a opção; na segunda, o Matheus já direciona a pessoa para alguém da Integração (o responsável é avisado).
- O responsável liga, conhece a pessoa e convida para o Café, com prazo até quarta.
- Na quarta, cobrança automática por WhatsApp ao responsável: 1 consegui · 2 ainda não · 3 a pessoa não respondeu.
- Quem aceita o Café segue para: confirmação até sexta (o responsável entrega a lista de quem vai) → lembrete automático (2 dias antes e no sábado) → check-in na entrada (voluntário da Integração marca a presença) → Café de Conexão (3º domingo do mês, com os pastores). No Café há QR code no telão para quem não tem cadastro.
- Depois do Café, a pessoa segue para "Mensagem com 5 células".

### Caminho 3: Não respondeu
- Aba da Integração com os nomes de quem não respondeu à mensagem ou que o responsável não achou.
- Matheus escolhe os responsáveis; contato humano (ligação ou mensagem pessoal), sem automação. Quem aceita o Café segue o fluxo do caminho 2.

### Etapas finais (comuns aos caminhos 1 e 2)
1. **Mensagem com 5 células** (automática, WhatsApp): 5 sugestões pelo bairro do formulário, faixa etária e Kids. Se faltar célula no bairro, completa com as mais próximas. Cada opção traz bairro, horário e líderes. A pessoa toca na escolhida. Sem escolha em 2 dias, cai em "Quem não respondeu". A lista de células estará sempre atualizada.
2. **Aviso ao líder da célula** (automático): na hora da escolha o líder recebe "Renan, a Mariana quer conhecer sua célula, entre em contato", e a pessoa entra na lista do Matheus.
3. **Convite do líder**: o líder liga e convida em até 2 dias.
4. **Cobrança do líder da célula**: "você entrou em contato?" O pastor vê no painel quem foi contatado. Hoje: Matheus; 2027: líderes de rede.
5. **Pessoa na célula**.

## Visibilidade para o pastor (números que ele cobra)
- Pessoa direcionada na segunda.
- Contato do responsável até quarta (consegui, ainda não, não respondeu).
- Presença real no Café (check-in).
- Líder da célula contatou em até 2 dias.
- Lista de quem não respondeu.

## Decisões em aberto
- **Relatórios do pastor (rotina quarta e sexta)**: proposta de relatório na quarta à noite (status de cada pessoa, Integração) e na sexta (só pendências com responsável + confirmados do Café), com cobrança automática aos responsáveis e escalada ao líder de rede na quarta para pendentes. Falta ele definir: WhatsApp ou painel? A sexta serve também para fechar o Café, ou só pendências?
- Texto exato das mensagens automáticas e do formulário (campos obrigatórios) ainda não definidos.
