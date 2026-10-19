// Registrar o service worker é o que faz o Android oferecer "instalar
// aplicativo" em vez de "adicionar atalho". Falhar aqui não pode derrubar
// nada: o app funciona igual sem ele.
//
// §80. Estas linhas moravam num <script> inline dentro do index.html, e eram
// a ÚNICA razão de a CSP precisar de `script-src 'unsafe-inline'`. Enquanto
// essa diretriz esteve ligada, qualquer HTML que entrasse na página virava
// script executável — foi o que transformou a injeção pelo cabeçalho Host
// (§80, abaixo) de defeito de conteúdo em execução de código. Sete linhas
// num arquivo próprio fecham a diretriz inteira.
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => undefined);
  });
}
