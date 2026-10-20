'use strict';

// Quem responde pela leitura de laudo e pela Gena (ARQUITETURA.md §86).
//
//   IA_PROVEDOR=vertex     Claude pelo Vertex AI do Google, na região
//                          VERTEX_REGIAO (padrão southamerica-east1), sob o
//                          contrato do Google Cloud, que já traz as cláusulas
//                          da ANPD. É o caminho de produção.
//   IA_PROVEDOR=anthropic  API direta da Anthropic (EUA), com
//                          ANTHROPIC_API_KEY. Fica para desenvolvimento, para
//                          a suíte de testes (o stub fala esse protocolo) e
//                          como caminho de volta se o Vertex falhar.
//
// Sem IA_PROVEDOR vale "anthropic" fora de produção e "vertex" em produção:
// esquecer a variável no servidor não pode mandar laudo para os EUA.
//
// As duas bibliotecas expõem o mesmo `messages.create`, com o mesmo formato de
// pedido e de resposta; o resto do servidor não sabe qual está em uso. O nome
// do modelo também é o mesmo nos dois (`claude-opus-5`, conferido na tabela de
// IDs do Vertex em 20/10/2026).

const IS_PRODUCTION = process.env.NODE_ENV === 'production';

const PROVEDOR = String(process.env.IA_PROVEDOR || (IS_PRODUCTION ? 'vertex' : 'anthropic')).trim().toLowerCase();
const MODELO = String(process.env.IA_MODELO || 'claude-opus-5').trim();
const REGIAO = String(process.env.VERTEX_REGIAO || 'southamerica-east1').trim();
const PROJETO = String(process.env.VERTEX_PROJETO || '').trim();

// Padrão do SDK: 600 s por tentativa, 3 tentativas: até 30 minutos com a
// requisição do médico pendurada e ~180 MB de buffers presos. 90 s cobre laudo
// longo; travamento não. maxRetries 1 porque cada retentativa é chamada paga, e
// o caminho de recuperação já faz duas chamadas.
const OPCOES = { timeout: 90_000, maxRetries: 1 };

/**
 * Problemas de configuração que impedem o servidor de subir. Devolve a lista
 * de mensagens; vazia quando está tudo certo.
 */
function problemasDeConfiguracao() {
  const out = [];
  if (!['vertex', 'anthropic'].includes(PROVEDOR)) {
    out.push(`IA_PROVEDOR="${process.env.IA_PROVEDOR}" não é válido. Use "vertex" ou "anthropic".`);
    return out;
  }
  if (PROVEDOR === 'vertex') {
    if (!PROJETO) out.push('IA_PROVEDOR=vertex exige VERTEX_PROJETO (o ID do projeto no Google Cloud).');
    // O endpoint global não tem garantia nenhuma de onde o laudo é
    // processado (documentação do Vertex). Em produção ele só entra se alguém
    // pedir com todas as letras.
    if (IS_PRODUCTION && REGIAO === 'global' && process.env.PERMITIR_REGIAO_GLOBAL !== 'sim') {
      out.push('VERTEX_REGIAO=global não garante onde o laudo é processado. Use southamerica-east1 (ou defina PERMITIR_REGIAO_GLOBAL=sim de propósito).');
    }
  }
  return out;
}

function avisos() {
  const out = [];
  if (PROVEDOR === 'anthropic' && !process.env.ANTHROPIC_API_KEY) {
    out.push('ANTHROPIC_API_KEY não está definida. Configure um arquivo .env (veja .env.example).');
  }
  if (PROVEDOR === 'anthropic' && IS_PRODUCTION) {
    out.push('IA pela API direta da Anthropic em produção: o laudo é processado nos EUA (ver ARQUITETURA.md §86).');
  }
  if (PROVEDOR === 'vertex' && REGIAO !== 'southamerica-east1') {
    out.push(`IA pelo Vertex na região ${REGIAO}, fora de São Paulo.`);
  }
  return out;
}

let cliente = null;

/**
 * O cliente é criado na primeira chamada, não no carregamento: a biblioteca do
 * Vertex sai procurando credencial do Google assim que nasce, e sem
 * credencial (máquina do dev, suíte) isso virava uma exceção solta no boot.
 */
function obterCliente() {
  if (cliente) return cliente;
  if (PROVEDOR === 'vertex') {
    const { AnthropicVertex } = require('@anthropic-ai/vertex-sdk');
    // Credencial: a conta de serviço do Cloud Run (Application Default
    // Credentials). Nenhuma chave em arquivo ou variável.
    cliente = new AnthropicVertex({ projectId: PROJETO, region: REGIAO, ...OPCOES });
  } else {
    const Anthropic = require('@anthropic-ai/sdk');
    cliente = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, ...OPCOES });
  }
  return cliente;
}

/** Mesmo contrato de `client.messages.create`, com o modelo já escolhido. */
function criarMensagem(pedido) {
  return obterCliente().messages.create({ model: MODELO, ...pedido });
}

function descricao() {
  return PROVEDOR === 'vertex'
    ? `Vertex AI (${REGIAO}), modelo ${MODELO}`
    : `API direta da Anthropic, modelo ${MODELO}`;
}

module.exports = {
  PROVEDOR,
  MODELO,
  REGIAO,
  problemasDeConfiguracao,
  avisos,
  criarMensagem,
  descricao,
  configurado: () => (PROVEDOR === 'vertex' ? Boolean(PROJETO) : Boolean(process.env.ANTHROPIC_API_KEY)),
};
