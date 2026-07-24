require('dotenv').config();

const path = require('path');
const express = require('express');
const cors = require('cors');
const multer = require('multer');
const Anthropic = require('@anthropic-ai/sdk');

const app = express();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });

if (!process.env.ANTHROPIC_API_KEY) {
  console.warn('AVISO: ANTHROPIC_API_KEY não está definida. Configure um arquivo .env (veja .env.example).');
}

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

app.use(cors());
app.use(express.json());

// Schema do caso clínico estruturado — mesmos campos do mockup, mas
// preenchidos por extração real (texto + PDF + imagem), não por regex.
const CASO_CLINICO_SCHEMA = {
  type: 'object',
  properties: {
    histologia: {
      type: 'string',
      description: 'Histologia do tumor (ex.: "Seroso", "Endometrioide", "Células claras", "Mucinoso"). Vazio se não identificável.',
    },
    grau: {
      type: 'string',
      enum: ['Alto grau', 'Baixo grau', ''],
      description: 'Grau histopatológico, se explicitamente informado no material. Não inferir a partir do estágio — grau e estágio são eixos independentes.',
    },
    estadiamento: {
      type: 'string',
      description: 'Estágio FIGO (ex.: "IIIA1", "IVC"). Se não estiver escrito literalmente, infira a partir dos achados cirúrgicos/patológicos descritos (ex.: linfonodo retroperitoneal positivo isolado, sem doença peritoneal adicional → IIIA1) e explique o raciocínio em estadiamento_justificativa.',
    },
    estadiamento_justificativa: {
      type: 'string',
      description: 'Se o estágio foi inferido (não estava escrito literalmente), explique em 1-2 frases quais achados levaram a essa conclusão. Vazio se o estágio já estava explícito no material.',
    },
    idade_faixa: {
      type: 'string',
      description: 'Faixa etária de 5 anos (ex.: "60–64 anos"). Vazio se não informado.',
    },
    historico_familiar: {
      type: 'string',
      description: 'Resumo do histórico familiar oncológico relatado. "Não relatado" se explicitamente negado, vazio se não mencionado.',
    },
    testes_previos: {
      type: 'string',
      description: 'Testes genéticos já realizados e seus resultados, se houver (ex.: "BRCA germinativo negativo"). "Nenhum relatado" se explicitamente negado, vazio se não mencionado.',
    },
    fontes_usadas: {
      type: 'array',
      items: { type: 'string' },
      description: 'Lista curta descrevendo quais fontes (texto, PDF, imagem) contribuíram com dado real para a extração.',
    },
  },
  required: ['histologia', 'grau', 'estadiamento', 'estadiamento_justificativa', 'idade_faixa', 'historico_familiar', 'testes_previos', 'fontes_usadas'],
  additionalProperties: false,
};

const SYSTEM_PROMPT = `Você é o motor de extração clínica do OncoGenYX, uma ferramenta de triagem genética para oncologia ginecológica (câncer de ovário).

Sua única tarefa é extrair dados estruturados do material fornecido por um médico (texto digitado, laudo em PDF, foto de laudo) — você NÃO decide qual teste pedir, NÃO dá conduta terapêutica, só estrutura o que está no material.

Regras importantes:
- Estadiamento FIGO frequentemente não está escrito por extenso no laudo — precisa ser inferido a partir dos achados cirúrgicos e patológicos (lateralidade do tumor, integridade da cápsula, envolvimento de superfície, contagem de linfonodos positivos/negativos por sítio, achados peritoneais/omentais). Faça essa inferência com o mesmo rigor clínico que um oncologista ginecológico usaria, e sempre explique o raciocínio em estadiamento_justificativa quando inferir.
- Grau histopatológico e estadiamento são eixos clínicos independentes — nunca deduza um a partir do outro. Só preencha "grau" se estiver de fato relatado ou claramente descrito no material (ex.: "carcinoma de alto grau").
- O material pode estar em português, com abreviações e jargão médico brasileiro comuns em laudos de anatomopatológico.
- Não invente dado que não está no material. Campo vazio é melhor que chute.`;

app.post('/api/extract', upload.array('files', 10), async (req, res) => {
  try {
    const text = (req.body.text || '').trim();
    const files = req.files || [];

    const content = [];

    for (const file of files) {
      if (file.mimetype === 'application/pdf') {
        content.push({
          type: 'document',
          source: {
            type: 'base64',
            media_type: 'application/pdf',
            data: file.buffer.toString('base64'),
          },
        });
      } else if (file.mimetype.startsWith('image/')) {
        content.push({
          type: 'image',
          source: {
            type: 'base64',
            media_type: file.mimetype,
            data: file.buffer.toString('base64'),
          },
        });
      }
    }

    const instructionText = text
      ? `Descrição em texto fornecida pelo médico:\n\n${text}`
      : 'Nenhum texto foi digitado — extraia só a partir dos arquivos anexados.';
    content.push({ type: 'text', text: `${instructionText}\n\nExtraia o caso clínico estruturado conforme o schema.` });

    if (!files.length && !text) {
      return res.status(400).json({ error: 'Nenhum texto ou arquivo foi enviado.' });
    }

    const response = await client.messages.create({
      model: 'claude-opus-5',
      max_tokens: 2048,
      system: SYSTEM_PROMPT,
      output_config: {
        format: { type: 'json_schema', schema: CASO_CLINICO_SCHEMA },
      },
      messages: [{ role: 'user', content }],
    });

    const textBlock = response.content.find((b) => b.type === 'text');
    if (!textBlock) {
      return res.status(502).json({ error: 'A extração não retornou texto estruturado.' });
    }

    const extracted = JSON.parse(textBlock.text);
    res.json({ extracted, usage: response.usage });
  } catch (err) {
    console.error('Erro na extração:', err);
    res.status(500).json({ error: err.message || 'Erro interno na extração.' });
  }
});

app.get('/api/health', (req, res) => {
  res.json({ ok: true, hasApiKey: Boolean(process.env.ANTHROPIC_API_KEY) });
});

app.use(express.static(path.join(__dirname, 'public')));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`OncoGenYX server rodando em http://localhost:${PORT}`);
});
