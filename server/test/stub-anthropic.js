'use strict';

// Servidor que imita a API da Anthropic, para testar a rota /api/extract de
// ponta a ponta sem chave e sem custo.
//
// Sem isto, a única forma de testar o caminho do anexo era simular a resposta
// no navegador — que foi exatamente o erro que deixou passar a colisão de
// chaves do schema: um teste que mocka a fronteira valida tudo menos a
// fronteira. Aqui a fronteira é atravessada de verdade, por HTTP.
//
// O stub guarda a última requisição recebida, então dá para afirmar o que o
// servidor de fato enviou: se o PDF foi desembrulhado, quais blocos foram
// montados, qual schema foi usado.

const http = require('http');

function criarStub() {
  const estado = {
    requisicoes: [],
    // Fila de respostas. Cada item: { tipo: 'ok', extracao } ou
    // { tipo: 'erro', status, mensagem }. Vazia = responde ok com vazio.
    fila: [],
  };

  const servidor = http.createServer((req, res) => {
    let corpo = '';
    req.on('data', (c) => { corpo += c; });
    req.on('end', () => {
      let json = {};
      try { json = JSON.parse(corpo); } catch (e) { /* corpo não-JSON */ }
      estado.requisicoes.push({ url: req.url, headers: req.headers, corpo: json });

      const proxima = estado.fila.shift() || { tipo: 'ok', extracao: {} };

      // Resposta que não é o JSON estruturado — exercita os caminhos de
      // resposta estranha do modelo.
      if (proxima.tipo === 'texto-cru') {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({
          id: 'msg_stub', type: 'message', role: 'assistant', model: 'claude-opus-5',
          content: [{ type: 'text', text: proxima.texto === undefined ? 'conversa livre' : proxima.texto }],
          usage: { input_tokens: 5, output_tokens: 5 },
        }));
        return;
      }

      if (proxima.tipo === 'erro') {
        res.writeHead(proxima.status, { 'content-type': 'application/json' });
        res.end(JSON.stringify({
          type: 'error',
          error: { type: 'invalid_request_error', message: proxima.mensagem },
        }));
        return;
      }

      // O schema exige todas as chaves; o stub devolve o objeto completo com
      // vazios e sobrepõe o que o teste pediu, imitando a saída estruturada.
      const schema = (json.output_config && json.output_config.format && json.output_config.format.schema) || null;
      const completo = {};
      if (schema) {
        Object.entries(schema.properties).forEach(([chave, def]) => {
          completo[chave] = def.type === 'array' ? [] : '';
        });
      }
      Object.assign(completo, proxima.extracao);

      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({
        id: 'msg_stub',
        type: 'message',
        role: 'assistant',
        model: 'claude-opus-5',
        content: [{ type: 'text', text: JSON.stringify(completo) }],
        usage: { input_tokens: 10, output_tokens: 10 },
      }));
    });
  });

  return {
    servidor,
    estado,
    ouvir(porta) {
      return new Promise((resolve) => servidor.listen(porta, () => resolve(servidor.address().port)));
    },
    fechar() {
      return new Promise((resolve) => servidor.close(resolve));
    },
    // Programa a(s) próxima(s) resposta(s). `vezes` existe porque o SDK da
    // Anthropic reenvia sozinho em 429 e 5xx: uma resposta única na fila seria
    // consumida na primeira tentativa e a retentativa cairia no "ok" padrão.
    responderCom(item, vezes = 1) {
      for (let i = 0; i < vezes; i++) estado.fila.push(item);
    },
    limpar() { estado.requisicoes.length = 0; estado.fila.length = 0; },
    ultima() { return estado.requisicoes[estado.requisicoes.length - 1]; },
    // A primeira chamada é a que carrega o schema unificado. Quando a extração
    // volta abandonada, o servidor dispara uma SEGUNDA chamada com o schema
    // reduzido ao subtipo, e aí `ultima()` já não é a que se quer inspecionar.
    primeira() { return estado.requisicoes[0]; },
    quantasChamadas() { return estado.requisicoes.length; },
    // Blocos de conteúdo da última mensagem enviada pelo servidor do app.
    blocos() {
      const u = this.ultima();
      if (!u || !u.corpo.messages) return [];
      return u.corpo.messages[0].content || [];
    },
  };
}

module.exports = { criarStub };
