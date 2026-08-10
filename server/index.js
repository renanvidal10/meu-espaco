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

// Schema unificado — a IA identifica o subtipo oncológico a partir do
// próprio material (não é mais escolhido manualmente pelo médico) e só
// preenche os campos relevantes ao subtipo identificado; os campos do
// outro subtipo ficam vazios.
const UNIFIED_SCHEMA = {
  type: 'object',
  properties: {
    tipo_tumor: {
      type: 'string',
      enum: ['Ginecológico - Ovário', 'Próstata', 'Não identificado'],
      description: 'Subtipo oncológico identificado a partir do conteúdo do material (histologia, termos clínicos, órgão mencionado). "Não identificado" apenas se o material realmente não permitir determinar com segurança.',
    },
    tipo_tumor_justificativa: {
      type: 'string',
      description: 'Em 1 frase curta, o que no material levou a identificar esse subtipo (ex.: "menciona adenocarcinoma de próstata e PSA"). Vazio se tipo_tumor for "Não identificado".',
    },
    histologia: {
      type: 'string',
      description: 'Histologia do tumor. Ginecológico: ex. "Seroso", "Endometrioide", "Células claras", "Mucinoso". Próstata: ex. "Adenocarcinoma acinar", "Intraductal/cribriforme", "Neuroendócrino/pequenas células". Vazio se não identificável.',
    },
    grau: {
      type: 'string',
      enum: ['Alto grau', 'Baixo grau', ''],
      description: '[Só para Ginecológico] Grau histopatológico, se explicitamente informado ou claramente descrito no material (ex.: "carcinoma de alto grau", "G3" → "Alto grau"). Não inferir a partir do estágio — grau e estágio são eixos independentes. Deixe vazio se tipo_tumor for Próstata.',
    },
    estadiamento: {
      type: 'string',
      description: '[Só para Ginecológico] Estágio FIGO (ex.: "IIIA1", "IVC"), sempre no formato canônico romano. Se não estiver escrito literalmente, infira a partir dos achados cirúrgicos/patológicos (lateralidade do tumor, integridade da cápsula, envolvimento de superfície, contagem de linfonodos positivos/negativos por sítio, achados peritoneais/omentais) e explique em estadiamento_justificativa. Deixe vazio se tipo_tumor for Próstata.',
    },
    estadiamento_justificativa: {
      type: 'string',
      description: 'Se o estágio FIGO foi inferido (não escrito literalmente), explique em 1-2 frases os achados usados. Vazio se já estava explícito ou se não se aplica.',
    },
    gleason_grade_group: {
      type: 'string',
      description: '[Só para Próstata] Escore de Gleason e/ou Grade Group (ISUP), como relatado (ex.: "Gleason 4+3=7, Grade Group 3"). Deixe vazio se tipo_tumor for Ginecológico.',
    },
    psa: {
      type: 'string',
      description: '[Só para Próstata] PSA em ng/mL, como relatado (ex.: "18,4 ng/mL"). Deixe vazio se tipo_tumor for Ginecológico.',
    },
    extensao_doenca: {
      type: 'string',
      enum: ['Localizado', 'Linfonodo positivo (N1)', 'Metastático hormônio-sensível (mHSPC)', 'Metastático resistente à castração (mCRPC)', ''],
      description: '[Só para Próstata] Extensão da doença. Se não estiver escrita literalmente, infira do TNM e do contexto clínico (ex.: "M1b, iniciando bloqueio hormonal" → mHSPC; "progressão de PSA em uso de enzalutamida" → mCRPC; linfonodo pélvico positivo sem metástase à distância → "Linfonodo positivo (N1)"). Explique em extensao_justificativa quando inferir. Deixe vazio se tipo_tumor for Ginecológico.',
    },
    extensao_justificativa: {
      type: 'string',
      description: 'Se a extensão da doença (próstata) foi inferida, explique em 1-2 frases os achados usados. Vazio se já estava explícita ou se não se aplica.',
    },
    categoria_risco_localizado: {
      type: 'string',
      enum: ['Baixo', 'Intermediário favorável', 'Intermediário desfavorável', 'Alto', 'Muito alto', ''],
      description: '[Só para Próstata] Categoria de risco NCCN — só preencher quando extensao_doenca for "Localizado" ou "Linfonodo positivo (N1)". Infira de PSA + Gleason/Grade Group + estágio clínico T (ver tabela nas instruções do sistema), só quando tiver os três dados com confiança. Vazio se não der pra classificar com segurança ou se não se aplica.',
    },
    categoria_risco_justificativa: {
      type: 'string',
      description: 'Se a categoria de risco foi inferida, explique em 1-2 frases (PSA + Gleason/Grade Group + estágio T usados). Vazio se já estava explícita ou se não se aplica.',
    },
    ascendencia_ashkenazi: {
      type: 'string',
      enum: ['Sim', 'Não relatado', ''],
      description: '[Só para Próstata] "Sim" se ascendência judaica Ashkenazi for mencionada, "Não relatado" se explicitamente negada/perguntada e ausente, vazio se não mencionada ou não se aplica.',
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
      description: 'Nome completo do paciente, apenas se estiver literalmente escrito no material (ex.: cabeçalho de um laudo em PDF/foto). Vazio se não identificável. Este campo é usado só para pré-preencher o documento de solicitação ao final — nunca é usado na triagem clínica.',
    },
  },
  required: [
    'tipo_tumor', 'tipo_tumor_justificativa', 'histologia', 'grau', 'estadiamento', 'estadiamento_justificativa',
    'gleason_grade_group', 'psa', 'extensao_doenca', 'extensao_justificativa',
    'categoria_risco_localizado', 'categoria_risco_justificativa', 'ascendencia_ashkenazi',
    'idade_faixa', 'historico_familiar', 'testes_previos', 'fontes_usadas', 'nome_paciente',
  ],
  additionalProperties: false,
};

const UNIFIED_SYSTEM_PROMPT = `Você é o motor de extração clínica do OncoGenYX, uma ferramenta de triagem genética para oncologia. Hoje ela cobre duas verticais: Ginecológico (câncer de ovário) e Próstata.

Sua tarefa tem duas etapas, nessa ordem:
1. Identifique, a partir do próprio material (texto digitado, laudo em PDF, foto de laudo), qual das duas verticais está sendo descrita — preencha tipo_tumor e tipo_tumor_justificativa. Use termos como órgão mencionado, histologia (ex.: "adenocarcinoma de próstata" vs "carcinoma seroso de ovário"), marcadores específicos (PSA é próstata; CA-125/FIGO é ginecológico), Gleason/Grade Group (próstata) vs grau/estadiamento FIGO (ginecológico). Só use "Não identificado" se o material realmente não permitir determinar com segurança — nesse caso deixe os demais campos vazios.
2. Extraia SOMENTE os campos relevantes ao subtipo identificado (marcados "[Só para Ginecológico]" ou "[Só para Próstata]" no schema) — deixe os campos do outro subtipo vazios. Os campos comuns (idade, histórico familiar, testes prévios, fontes, nome) preencha sempre que disponíveis, independente do subtipo.

Você NÃO decide qual teste pedir, NÃO dá conduta terapêutica — só estrutura o que está no material.

Regras importantes:
- Interprete o SENTIDO clínico do que foi escrito — nunca faça transcrição literal ingênua. Normalize toda a informação para a nomenclatura padrão, mesmo quando o médico escrever de um jeito não-canônico: numeral arábico em vez de romano ("estadiamento 3C" → "IIIC"), abreviação, sinônimo, jargão comum em prontuário brasileiro, ou notação TNM ("T3a N0 M0" descrevendo doença local avançada).
- Estadiamento FIGO (ginecológico) frequentemente não está escrito por extenso — precisa ser inferido a partir dos achados cirúrgicos e patológicos (lateralidade do tumor, integridade da cápsula, envolvimento de superfície, contagem de linfonodos positivos/negativos por sítio, achados peritoneais/omentais). Faça essa inferência com o mesmo rigor clínico que um oncologista ginecológico usaria, e explique o raciocínio em estadiamento_justificativa quando inferir.
- Grau histopatológico e estadiamento (ginecológico) são eixos clínicos independentes — nunca deduza um a partir do outro. Só preencha "grau" se estiver de fato relatado ou claramente descrito ("G3"/"grau 3" → "Alto grau"; "G1"/"grau 1" → "Baixo grau").
- Extensão da doença (próstata) frequentemente precisa ser inferida do contexto clínico e do TNM: metástase à distância M1 = doença metastática; início de bloqueio hormonal/ADT pela primeira vez = hormônio-sensível (mHSPC); progressão de PSA ou da doença em uso de enzalutamida/abiraterona = resistente à castração (mCRPC); linfonodo regional positivo sem metástase à distância = "Linfonodo positivo (N1)", sem ser metastático. Explique o raciocínio em extensao_justificativa quando inferir.
- Categoria de risco NCCN (próstata, só doença localizada/N1) combina três eixos - PSA, Gleason/Grade Group e estágio clínico T:
  - Baixo: cT1-cT2a, Grade Group 1 (Gleason ≤6), PSA <10 ng/mL.
  - Intermediário favorável: Grade Group 2 (Gleason 3+4=7) predominância de padrão 3, <50% dos fragmentos positivos, no máximo 1 fator de risco intermediário (PSA 10-20, Gleason 7, ou cT2b-c).
  - Intermediário desfavorável: Grade Group 2-3 (Gleason 7) com ≥50% dos fragmentos positivos, ou 2-3 fatores de risco intermediário.
  - Alto: cT3a, ou Grade Group 4-5 (Gleason 8-10), ou PSA >20 ng/mL (qualquer um isolado já qualifica).
  - Muito alto: cT3b-T4, ou padrão primário de Gleason 5, ou mais de 4 fragmentos com Gleason 8-10.
  - Só classifique quando tiver os três dados disponíveis com razoável confiança - campo vazio é melhor que chute quando faltar algum.
- O material pode estar em português, com abreviações e jargão médico brasileiro comuns em laudos de anatomopatológico e evolução clínica.
- Não invente dado que não está no material. Campo vazio é melhor que chute — mas normalizar a grafia de um dado que está lá não é chutar, é interpretar corretamente.
- Extraia nome_paciente somente se estiver literalmente escrito no material. Nunca infira ou deduza um nome — campo vazio é o padrão seguro.`;

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
      system: UNIFIED_SYSTEM_PROMPT,
      output_config: {
        format: { type: 'json_schema', schema: UNIFIED_SCHEMA },
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
