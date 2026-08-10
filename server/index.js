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

// Schema do caso clínico estruturado — Ginecológico (Ovário).
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
    nome_paciente: {
      type: 'string',
      description: 'Nome completo do paciente, apenas se estiver literalmente escrito no material (ex.: cabeçalho de um laudo em PDF/foto). Vazio se não identificável ou se o médico só descreveu o caso em texto livre sem citar nome. Este campo é usado só para pré-preencher o documento de solicitação ao final — nunca é usado na triagem clínica.',
    },
  },
  required: ['histologia', 'grau', 'estadiamento', 'estadiamento_justificativa', 'idade_faixa', 'historico_familiar', 'testes_previos', 'fontes_usadas', 'nome_paciente'],
  additionalProperties: false,
};

const SYSTEM_PROMPT = `Você é o motor de extração clínica do OncoGenYX, uma ferramenta de triagem genética para oncologia ginecológica (câncer de ovário).

Sua única tarefa é extrair dados estruturados do material fornecido por um médico (texto digitado, laudo em PDF, foto de laudo) — você NÃO decide qual teste pedir, NÃO dá conduta terapêutica, só estrutura o que está no material.

Regras importantes:
- Interprete o SENTIDO clínico do que foi escrito — nunca faça transcrição literal ingênua. Normalize toda a informação para a nomenclatura padrão, mesmo quando o médico escrever de um jeito não-canônico: numeral arábico em vez de romano ("estadiamento 3C", "estágio 3 C", "estagio IIIc" → "IIIC"), abreviação, ordem de palavras diferente, sinônimo ou jargão comum em prontuário brasileiro. O campo estadiamento deve sempre sair no formato canônico FIGO (algarismo romano I–IV + subletra opcional A/B/C), não importa como o médico digitou.
- Estadiamento FIGO frequentemente não está escrito por extenso no laudo — precisa ser inferido a partir dos achados cirúrgicos e patológicos (lateralidade do tumor, integridade da cápsula, envolvimento de superfície, contagem de linfonodos positivos/negativos por sítio, achados peritoneais/omentais). Faça essa inferência com o mesmo rigor clínico que um oncologista ginecológico usaria, e sempre explique o raciocínio em estadiamento_justificativa quando inferir (inclusive quando só normalizar notação, não precisa justificar — justificativa é só para inferência real a partir de achados).
- Grau histopatológico e estadiamento são eixos clínicos independentes — nunca deduza um a partir do outro. Só preencha "grau" se estiver de fato relatado ou claramente descrito no material (ex.: "carcinoma de alto grau", "G3", "grau 3" → "Alto grau"; "G1", "grau 1" → "Baixo grau").
- O material pode estar em português, com abreviações e jargão médico brasileiro comuns em laudos de anatomopatológico.
- Não invente dado que não está no material. Campo vazio é melhor que chute — mas normalizar a grafia de um dado que está lá não é chutar, é interpretar corretamente.
- Extraia nome_paciente somente se estiver literalmente escrito no material (ex.: cabeçalho de um laudo). Nunca infira ou deduza um nome — campo vazio é o padrão seguro.`;

// Schema do caso clínico estruturado — Próstata.
const PROSTATA_SCHEMA = {
  type: 'object',
  properties: {
    histologia: {
      type: 'string',
      description: 'Histologia (ex.: "Adenocarcinoma acinar", "Intraductal/cribriforme", "Neuroendócrino/pequenas células", "Ductal"). Vazio se não identificável.',
    },
    gleason_grade_group: {
      type: 'string',
      description: 'Escore de Gleason e/ou Grade Group (ISUP), como relatado (ex.: "Gleason 4+3=7, Grade Group 3"). Vazio se não informado.',
    },
    psa: {
      type: 'string',
      description: 'PSA em ng/mL, como relatado (ex.: "18,4 ng/mL"). Vazio se não informado.',
    },
    extensao_doenca: {
      type: 'string',
      enum: ['Localizado', 'Linfonodo positivo (N1)', 'Metastático hormônio-sensível (mHSPC)', 'Metastático resistente à castração (mCRPC)', ''],
      description: 'Extensão da doença. Se não estiver escrito literalmente, infira a partir do estadiamento TNM e do contexto clínico descrito (ex.: "M1b, iniciando bloqueio hormonal" → mHSPC; "progressão de PSA em uso de enzalutamida" → mCRPC; linfonodo pélvico positivo sem metástase à distância → Linfonodo positivo (N1)). Explique o raciocínio em extensao_justificativa quando inferir.',
    },
    extensao_justificativa: {
      type: 'string',
      description: 'Se a extensão da doença foi inferida (não estava escrita literalmente), explique em 1-2 frases quais achados levaram a essa conclusão. Vazio se já estava explícita no material.',
    },
    categoria_risco_localizado: {
      type: 'string',
      enum: ['Baixo', 'Intermediário favorável', 'Intermediário desfavorável', 'Alto', 'Muito alto', ''],
      description: 'Categoria de risco NCCN — só preencher quando extensao_doenca for "Localizado" ou "Linfonodo positivo (N1)". Se não estiver escrita literalmente, infira a partir de PSA + Gleason/Grade Group + estágio clínico T, usando a tabela NCCN (ver instruções do sistema), só quando tiver os três dados. Vazio se não for possível classificar com segurança.',
    },
    categoria_risco_justificativa: {
      type: 'string',
      description: 'Se a categoria de risco foi inferida, explique em 1-2 frases (PSA + Gleason/Grade Group + estágio T usados). Vazio se já estava explícita no material ou se o campo categoria_risco_localizado ficou vazio.',
    },
    ascendencia_ashkenazi: {
      type: 'string',
      enum: ['Sim', 'Não relatado', ''],
      description: '"Sim" se ascendência judaica Ashkenazi for mencionada, "Não relatado" se explicitamente negada/perguntada e ausente, vazio se não mencionada.',
    },
    idade_faixa: {
      type: 'string',
      description: 'Faixa etária de 5 anos (ex.: "60–64 anos"). Vazio se não informado.',
    },
    historico_familiar: {
      type: 'string',
      description: 'Resumo do histórico familiar oncológico relatado (câncer de próstata, mama, ovário, pâncreas, cólon e outros). "Não relatado" se explicitamente negado, vazio se não mencionado.',
    },
    testes_previos: {
      type: 'string',
      description: 'Testes genéticos já realizados e seus resultados, se houver. "Nenhum relatado" se explicitamente negado, vazio se não mencionado.',
    },
    fontes_usadas: {
      type: 'array',
      items: { type: 'string' },
      description: 'Lista curta descrevendo quais fontes (texto, PDF, imagem) contribuíram com dado real para a extração.',
    },
    nome_paciente: {
      type: 'string',
      description: 'Nome completo do paciente, apenas se estiver literalmente escrito no material. Vazio se não identificável. Este campo é usado só para pré-preencher o documento de solicitação ao final — nunca é usado na triagem clínica.',
    },
  },
  required: ['histologia', 'gleason_grade_group', 'psa', 'extensao_doenca', 'extensao_justificativa', 'categoria_risco_localizado', 'categoria_risco_justificativa', 'ascendencia_ashkenazi', 'idade_faixa', 'historico_familiar', 'testes_previos', 'fontes_usadas', 'nome_paciente'],
  additionalProperties: false,
};

const PROSTATA_SYSTEM_PROMPT = `Você é o motor de extração clínica do OncoGenYX, uma ferramenta de triagem genética para oncologia - vertical de câncer de próstata.

Sua única tarefa é extrair dados estruturados do material fornecido por um médico (texto digitado, laudo em PDF, foto de laudo) - você NÃO decide qual teste pedir, NÃO dá conduta terapêutica, só estrutura o que está no material.

Regras importantes:
- Interprete o SENTIDO clínico do que foi escrito — nunca faça transcrição literal ingênua. Normalize toda a informação para a nomenclatura padrão, mesmo quando o médico escrever de um jeito não-canônico: abreviação, ordem de palavras diferente, sinônimo, numeral diferente ou jargão comum em prontuário brasileiro (ex.: "T3a N0 M0" descrevendo doença local avançada, "iniciando hormonioterapia" sugerindo mHSPC se for a primeira vez, "PSA 0,3" após tratamento não indica necessariamente doença ativa).
- Extensão da doença frequentemente precisa ser inferida do contexto clínico e do TNM (ex.: presença de metástase à distância M1 = doença metastática; se o texto menciona início de bloqueio hormonal/ADT pela primeira vez = hormônio-sensível (mHSPC); se menciona progressão de PSA ou da doença em uso de enzalutamida, abiraterona ou outro tratamento hormonal = resistente à castração (mCRPC); linfonodo regional positivo sem metástase à distância = "Linfonodo positivo (N1)", sem ser considerado metastático). Sempre explique o raciocínio em extensao_justificativa quando inferir.
- Categoria de risco NCCN para doença localizada (só preencher quando a doença for localizada ou N1) combina três eixos - PSA, Gleason/Grade Group e estágio clínico T:
  - Baixo: cT1-cT2a, Grade Group 1 (Gleason ≤6), PSA <10 ng/mL.
  - Intermediário favorável: Grade Group 2 (Gleason 3+4=7) predominância de padrão 3, com <50% dos fragmentos de biópsia positivos, e no máximo 1 fator de risco intermediário (PSA 10-20, Gleason 7, ou cT2b-c).
  - Intermediário desfavorável: Grade Group 2-3 (Gleason 7) com ≥50% dos fragmentos positivos, ou 2-3 fatores de risco intermediário.
  - Alto: cT3a, ou Grade Group 4-5 (Gleason 8-10), ou PSA >20 ng/mL (qualquer um isolado já qualifica).
  - Muito alto: cT3b-T4, ou padrão primário de Gleason 5, ou mais de 4 fragmentos com Gleason 8-10.
  - Só classifique quando tiver PSA + Gleason/Grade Group + estágio T disponíveis com razoável confiança - campo vazio é melhor que chute quando faltar algum dos três.
- O material pode estar em português, com abreviações e jargão médico brasileiro comuns em laudos de anatomopatológico e evolução urológica/oncológica.
- Não invente dado que não está no material. Campo vazio é melhor que chute.
- Extraia nome_paciente somente se estiver literalmente escrito no material. Nunca infira ou deduza um nome - campo vazio é o padrão seguro.`;

app.post('/api/extract', upload.array('files', 10), async (req, res) => {
  try {
    const text = (req.body.text || '').trim();
    const files = req.files || [];
    const subtype = req.body.subtype === 'prostata' ? 'prostata' : 'gyn';
    const schema = subtype === 'prostata' ? PROSTATA_SCHEMA : CASO_CLINICO_SCHEMA;
    const systemPrompt = subtype === 'prostata' ? PROSTATA_SYSTEM_PROMPT : SYSTEM_PROMPT;

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
      system: systemPrompt,
      output_config: {
        format: { type: 'json_schema', schema: schema },
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
