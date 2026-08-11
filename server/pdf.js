'use strict';

// Tratamento de PDF anexado.
//
// Motivo de existir: laudos brasileiros chegam de formas que a API recusa, e a
// recusa dela ("The PDF specified was not valid") não diz ao médico o que
// fazer. Pior: o caso mais comum no Brasil não é um arquivo corrompido — é um
// arquivo perfeitamente bom dentro de um envelope de assinatura digital.
//
// Estágios, nesta ordem:
//   1. preparar()      — desembrulha o que precisa ser desembrulhado e barra o
//                        que não tem conserto, ANTES de gastar chamada paga.
//   2. envio normal    — o PDF vai como documento para a API (melhor
//                        qualidade: ela lê layout, tabelas e imagens).
//   3. extrairTexto()  — se mesmo assim a API recusar, o texto é extraído aqui
//                        e reenviado como texto. Perde o layout, mas um laudo
//                        lido é infinitamente melhor que um erro na tela.

const MAX_BYTES = 20 * 1024 * 1024;
const MAX_PAGINAS = 100;

// PKCS#7 / CMS: OID 1.2.840.113549.1.7.2 (signedData). É o envelope usado
// pela assinatura digital ICP-Brasil quando o sistema de origem gera um
// arquivo ".pdf" que, nos bytes, é um contêiner de assinatura com o PDF
// dentro. Muito comum em laudo e receita emitidos por sistema hospitalar.
const OID_SIGNED_DATA = Buffer.from('2a864886f70d010702', 'hex');

/**
 * Desembrulha um PDF embutido em outro contêiner.
 *
 * Se o arquivo não começa com "%PDF-" mas contém um PDF completo mais adiante,
 * recorta do "%PDF-" até o último "%%EOF". É o que salva os laudos assinados
 * digitalmente: o conteúdo é válido, só está dentro de um envelope que a API
 * não sabe abrir.
 *
 * Devolve { buffer, envelope } — envelope é null quando nada foi feito.
 */
function desembrulhar(buffer) {
  if (buffer.subarray(0, 5).toString('latin1') === '%PDF-') {
    return { buffer, envelope: null };
  }

  const texto = buffer.toString('latin1');
  const inicio = texto.indexOf('%PDF-');
  if (inicio < 0) return { buffer, envelope: null };

  const fimEOF = texto.lastIndexOf('%%EOF');
  const fim = fimEOF > inicio ? fimEOF + 5 : buffer.length;
  const dentro = buffer.subarray(inicio, fim);
  if (dentro.length < 400) return { buffer, envelope: null };

  const assinado = buffer.indexOf(OID_SIGNED_DATA) >= 0 && buffer.indexOf(OID_SIGNED_DATA) < inicio;
  return {
    buffer: dentro,
    envelope: assinado ? 'assinatura-digital' : 'conteudo-extra',
  };
}

/** Procura /Encrypt no trailer — PDF protegido por senha ou com restrição. */
function pareceProtegido(buffer) {
  const cauda = buffer.subarray(Math.max(0, buffer.length - 8192)).toString('latin1');
  return /\/Encrypt\b/.test(cauda);
}

/**
 * Checagem e preparo, antes de qualquer chamada paga.
 *
 * Devolve:
 *   { ok: true, buffer, aviso? }              — pronto para enviar
 *   { ok: false, motivo, comoResolver }       — não tem conserto automático
 */
function preparar(file) {
  const nome = file.originalname || 'arquivo';
  const original = file.buffer;

  if (!original || original.length === 0) {
    return {
      ok: false,
      motivo: `"${nome}" chegou vazio (0 bytes).`,
      comoResolver: 'Isso costuma acontecer quando o arquivo ainda está no iCloud/Drive e não foi baixado para o aparelho. Abra o PDF uma vez no celular para forçar o download e anexe de novo.',
    };
  }

  if (original.length > MAX_BYTES) {
    const mb = (original.length / 1024 / 1024).toFixed(1);
    return {
      ok: false,
      motivo: `"${nome}" tem ${mb} MB, acima do limite de 20 MB.`,
      comoResolver: 'Anexe apenas as páginas do laudo que interessam, ou tire uma foto da página relevante.',
    };
  }

  const { buffer, envelope } = desembrulhar(original);

  // Depois de desembrulhar, o cabeçalho tem de estar no começo. Se não estiver,
  // não é PDF de jeito nenhum — extensão trocada ou download pela metade.
  if (buffer.subarray(0, 5).toString('latin1') !== '%PDF-') {
    return {
      ok: false,
      motivo: `"${nome}" não é um PDF válido — o conteúdo do arquivo não começa como PDF.`,
      comoResolver: 'O arquivo pode ter sido baixado pela metade ou ter a extensão trocada. Baixe de novo, ou tire uma foto/print do laudo e anexe como imagem.',
    };
  }

  if (pareceProtegido(buffer)) {
    return {
      ok: false,
      motivo: `"${nome}" está protegido por senha ou com restrição de cópia.`,
      comoResolver: 'Abra o PDF, imprima como um novo PDF sem proteção, e anexe esse. Ou tire uma foto/print do laudo e anexe como imagem.',
      protegido: true,
    };
  }

  const resultado = { ok: true, buffer };
  if (envelope === 'assinatura-digital') {
    resultado.aviso = {
      arquivo: nome,
      motivo: `"${nome}" veio dentro de um envelope de assinatura digital.`,
      comoResolver: 'O documento foi desembrulhado e lido normalmente — nenhuma ação necessária.',
      recuperado: true,
    };
  } else if (envelope === 'conteudo-extra') {
    resultado.aviso = {
      arquivo: nome,
      motivo: `"${nome}" tinha conteúdo antes do início do PDF.`,
      comoResolver: 'A parte válida do documento foi recortada e lida normalmente — confira os campos.',
      recuperado: true,
    };
  }
  return resultado;
}

/**
 * Extração de texto local, plano B quando a API recusa o documento.
 * Devolve { texto, paginas } ou lança.
 */
async function extrairTexto(buffer) {
  // O pdf.js usa Math.sumPrecise (proposta recente). Sem ele, cada página
  // despeja um TypeError no log do servidor. A soma ingênua basta aqui.
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

module.exports = { preparar, desembrulhar, extrairTexto, ehRecusaDePdf, MAX_BYTES, MAX_PAGINAS };
