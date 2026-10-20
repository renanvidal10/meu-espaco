'use strict';

// Porta livre de verdade, pedida ao sistema operacional.
//
// Cada arquivo de teste sorteava uma porta numa faixa fixa (4300 a 5900). A
// faixa da Gena incluía a 5000, que o macOS ocupa com o receptor do AirPlay:
// quando o sorteio caía nela, o servidor de teste não subia e 30 testes
// falhavam juntos, sem relação com o que estava sendo testado. Pedir a porta
// ao sistema (listen na porta 0) elimina a colisão com qualquer processo.

const { execFileSync } = require('node:child_process');

function portaLivre() {
  return Number(execFileSync(process.execPath, ['-e',
    "const s=require('net').createServer().listen(0,'127.0.0.1',()=>{console.log(s.address().port);s.close();})"],
  { encoding: 'utf8' }).trim());
}

module.exports = { portaLivre };
