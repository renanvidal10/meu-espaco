'use strict';

// A sessão chega só no cookie (§85): o corpo da resposta de entrada não traz
// mais o token. Os testes leem o cookie e o mandam de volta como cabeçalho
// Authorization, que o servidor aceita para scripts e testes.

function tokenDaResposta(resposta) {
  const cabecalhos = typeof resposta.headers.getSetCookie === 'function'
    ? resposta.headers.getSetCookie()
    : [resposta.headers.get('set-cookie') || ''];
  for (const c of cabecalhos) {
    const m = /^(?:__Host-)?sessao=([^;]*)/.exec(c);
    if (m && m[1]) return m[1];
  }
  return null;
}

module.exports = { tokenDaResposta };
