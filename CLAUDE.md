# Regras permanentes do projeto OncoGenYX

O dono não é programador: todo passo a passo deve ser BEM detalhado.

1. Diretriz primeiro, código depois: nenhuma regra clínica entra no código sem estar em `docs/ARQUITETURA.md` com fonte e critério exato.
2. Programa de parceiro/acesso nunca é associado a um tumor por analogia, só por verificação documentada.
3. Todo bug corrigido ganha um teste de regressão.
4. Design: atenção máxima em toda área nova (o dono é muito crítico nisso).
5. Sem fontes externas (Google Fonts etc.). Nada de `/api/` em cache no service worker.
6. **Escrita: nunca usar travessão ou hífen como pontuação ("—", "–", " - ") em texto novo, seja na tela, no documento ou nas respostas ao dono.** É marca de texto de IA e foge da linguagem do produto. Reescreva com dois-pontos, vírgula, ponto ou parênteses. Hífen que faz parte de palavra (imuno-histoquímica, pós-operatório) e intervalos numéricos continuam normais. Detalhes e histórico em ARQUITETURA.md §84.
