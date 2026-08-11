'use strict';

// Diretório temporário de dados para a suíte, com faxina no fim do processo.
//
// Cada arquivo de teste chamava mkdtempSync direto e nunca apagava nada. A
// auditoria mediu 5 diretórios vazados por execução; na máquina onde ela rodou
// havia 923 acumulados. Não é grave por si, mas é o tipo de sujeira que faz um
// ambiente de CI encher o disco depois de algumas centenas de builds — e disco
// cheio numa suíte que também escreve arquivo de dados produz falha
// intermitente, que é o pior tipo de falha para depurar.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const criados = [];
let faxinaRegistrada = false;

function registrarFaxina() {
  if (faxinaRegistrada) return;
  faxinaRegistrada = true;
  process.on('exit', () => {
    for (const dir of criados) {
      try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* nada a fazer no exit */ }
    }
  });
}

/**
 * Cria um diretório temporário e devolve o caminho do arquivo de dados dentro
 * dele. O diretório é apagado quando o processo termina, inclusive quando a
 * suíte falha.
 */
function arquivoDeDadosTemporario(prefixo) {
  registrarFaxina();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `oncogenyx-${prefixo}-`));
  criados.push(dir);
  return path.join(dir, 'dados.json');
}

module.exports = { arquivoDeDadosTemporario };
