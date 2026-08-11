'use strict';

// Tratamento de PDF anexado.
//
// Motivo de existir: a API recusa PDFs que ela não consegue abrir e devolve
// "The PDF specified was not valid" — uma mensagem que não diz ao médico o que
// fazer e que, se vazar crua para a tela, ainda quebra o layout.
//
// Aqui o PDF passa por três estágios:
//   1. inspecionar()  — checa os bytes antes de gastar chamada: arquivo vazio,
//                       que não é PDF, protegido por senha, grande demais.
//   2. envio normal   — se passar, vai como documento para a API (melhor
//                       qualidade: a API lê layout, tabelas e imagens).
//   3. extrairTexto() — se mesmo assim a API recusar, o texto é extraído aqui
//                       e reenviado como texto. Perde o layout, mas um laudo
//                       lido é infinitamente melhor que um erro na tela.

const MAX_BYTES = 20 * 1024 * 1024;
const MAX_PAGINAS = 100;

// Todo PDF começa com "%PDF-" nos primeiros bytes. Alguns geradores colocam
// lixo antes do cabeçalho, então a busca é nos primeiros 1024 bytes.
function achaCabecalho(buffer) {
  const inicio = buffer.subarray(0, 1024).toString('latin1');
  return inicio.indexOf('%PDF-');
}

/**
 * Checagem barata, antes de qualquer chamada paga.
 * Devolve { ok: true } ou { ok: false, motivo, comoResolver }.
 */
function inspecionar(file) {
  const nome = file.originalname || 'arquivo';

  if (!file.buffer || file.buffer.length === 0) {
    return {
      ok: false,
      motivo: `"${nome}" chegou vazio (0 bytes).`,
      comoResolver: 'Isso costuma acontecer quando o arquivo ainda está no iCloud/Drive e não foi baixado para o aparelho. Abra o PDF uma vez no celular para forçar o download e anexe de novo.',
    };
  }

  if (file.buffer.length > MAX_BYTES) {
    const mb = (file.buffer.length / 1024 / 1024).toFixed(1);
    return {
      ok: false,
      motivo: `"${nome}" tem ${mb} MB, acima do limite de 20 MB.`,
      comoResolver: 'Anexe apenas as páginas do laudo que interessam, ou tire uma foto da página relevante.',
    };
  }

  if (achaCabecalho(file.buffer) < 0) {
    return {
      ok: false,
      motivo: `"${nome}" não é um PDF válido — o conteúdo do arquivo não começa como PDF.`,
      comoResolver: 'O arquivo pode ter sido baixado pela metade ou ter a extensão trocada. Baixe de novo, ou tire uma foto/print do laudo e anexe como imagem.',
    };
  }

  // /Encrypt no trailer indica PDF protegido. A API não abre esses, e a
  // extração de texto aqui também não vai abrir sem a senha.
  const cauda = file.buffer.subarray(Math.max(0, file.buffer.length - 4096)).toString('latin1');
  if (/\/Encrypt\b/.test(cauda)) {
    return {
      ok: false,
      motivo: `"${nome}" está protegido por senha ou com restrição de cópia.`,
      comoResolver: 'Abra o PDF, imprima como um novo PDF sem proteção, e anexe esse. Ou tire uma foto/print do laudo e anexe como imagem.',
      protegido: true,
    };
  }

  return { ok: true };
}

/**
 * Extração de texto local, usada como plano B quando a API recusa o documento.
 * Devolve { texto, paginas } ou lança.
 */
async function extrairTexto(buffer) {
  // O pdf.js usa Math.sumPrecise (proposta recente). Sem ele, cada página
  // despeja um TypeError no log do servidor. A soma ingênua é suficiente aqui.
  if (typeof Math.sumPrecise !== 'function') {
    Math.sumPrecise = (valores) => Array.from(valores).reduce((a, b) => a + b, 0);
  }
  const { extractText, getDocumentProxy } = await import('unpdf');
  // Uint8Array próprio: o pdf.js consome (e neutraliza) o buffer que recebe,
  // e o buffer original ainda pode ser necessário depois.
  const documento = await getDocumentProxy(new Uint8Array(buffer));
  const paginas = Math.min(documento.numPages, MAX_PAGINAS);
  const { text } = await extractText(documento, { mergePages: true });
  return { texto: String(text || '').trim(), paginas };
}

/** Reconhece a recusa específica da API para documento ilegível. */
function ehRecusaDePdf(err) {
  const msg = String((err && err.message) || '');
  return /pdf/i.test(msg) && /not valid|invalid|could not|unable|corrupt/i.test(msg);
}

module.exports = { inspecionar, extrairTexto, ehRecusaDePdf, MAX_BYTES, MAX_PAGINAS };
