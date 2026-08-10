require('dotenv').config();

const path = require('path');
const crypto = require('crypto');
const express = require('express');
const cors = require('cors');
const multer = require('multer');
const Anthropic = require('@anthropic-ai/sdk');

const store = require('./store');
const auth = require('./auth');
const mailer = require('./email');
const plaud = require('./plaud');

const app = express();
const IS_PRODUCTION = process.env.NODE_ENV === 'production';
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });

if (!process.env.ANTHROPIC_API_KEY) {
  console.warn('AVISO: ANTHROPIC_API_KEY não está definida. Configure um arquivo .env (veja .env.example).');
}

// Em produção o armazenamento em arquivo é uma armadilha: o disco do Render é
// efêmero e as contas dos médicos sumiriam no próximo deploy, sem erro visível.
// Falhar aqui, no boot, é muito melhor do que perder dado de usuário depois.
if (IS_PRODUCTION && !store.usingPostgres) {
  console.error('ERRO FATAL: em produção é obrigatório definir DATABASE_URL.');
  console.error('Sem banco, as contas seriam apagadas a cada deploy. Veja server/.env.example.');
  process.exit(1);
}

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

app.set('trust proxy', 1);
app.use(cors());
app.use(express.json({ limit: '1mb' }));

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

/* ============================ AUTENTICAÇÃO ============================ */

// Resposta deliberadamente idêntica exista ou não a conta: a tela de login não
// pode virar um oráculo que confirma "este médico usa a plataforma".
const NEUTRAL_RESET_RESPONSE = {
  ok: true,
  message: 'Se este email estiver cadastrado, você receberá um link para definir a senha em instantes.',
};

function appOrigin(req) {
  if (process.env.APP_ORIGIN) return process.env.APP_ORIGIN.replace(/\/$/, '');
  const proto = req.get('x-forwarded-proto') || req.protocol;
  return `${proto}://${req.get('host')}`;
}

async function deliverResetLink({ req, user, isFirstAccess }) {
  const token = await auth.issueResetToken(user.id);
  const url = `${appOrigin(req)}/?definir-senha=${token}`;
  const result = await mailer.sendPasswordSetup({ to: user.email, name: user.name, url, isFirstAccess });
  // Sem provedor de email configurado (dev), devolve o link para o fluxo não travar.
  // Em produção isso nunca acontece: o boot já exige a chave via /api/health.
  return { delivered: result.delivered, devUrl: result.delivered ? null : url };
}

// Cadastro/primeiro acesso: cria a conta e dispara o link de definição de senha.
app.post('/api/auth/register', async (req, res, next) => {
  try {
    const email = auth.normalizeEmail(req.body.email);
    const name = String(req.body.name || '').trim();
    const crm = String(req.body.crm || '').trim();

    if (!auth.isValidEmail(email)) return res.status(400).json({ error: 'Informe um email válido.' });
    if (name.length < 3) return res.status(400).json({ error: 'Informe seu nome completo.' });
    if (crm.length < 3) return res.status(400).json({ error: 'Informe seu CRM.' });

    const limit = auth.rateLimit(`register:${req.ip}`, { max: 5, windowMs: 60 * 60 * 1000 });
    if (!limit.allowed) {
      return res.status(429).json({ error: 'Muitas tentativas. Tente novamente mais tarde.' });
    }

    const existing = await store.findUserByEmail(email);
    if (existing) {
      // Conta já existe: não confirmamos isso. Se ainda não tem senha, é um
      // primeiro acesso interrompido — reenviamos o link em vez de barrar.
      if (!existing.password_hash) {
        const out = await deliverResetLink({ req, user: existing, isFirstAccess: true });
        return res.json({ ...NEUTRAL_RESET_RESPONSE, devUrl: out.devUrl });
      }
      return res.json(NEUTRAL_RESET_RESPONSE);
    }

    const user = await store.createUser({ id: crypto.randomUUID(), email, name, crm });
    const out = await deliverResetLink({ req, user, isFirstAccess: true });
    res.json({ ...NEUTRAL_RESET_RESPONSE, devUrl: out.devUrl });
  } catch (err) {
    next(err);
  }
});

// Pedido de redefinição (também cobre "esqueci minha senha").
app.post('/api/auth/request-reset', async (req, res, next) => {
  try {
    const email = auth.normalizeEmail(req.body.email);
    if (!auth.isValidEmail(email)) return res.status(400).json({ error: 'Informe um email válido.' });

    const limit = auth.rateLimit(`reset:${email}`, { max: 5, windowMs: 60 * 60 * 1000 });
    if (!limit.allowed) {
      return res.status(429).json({ error: 'Muitos pedidos para este email. Aguarde alguns minutos.' });
    }

    const user = await store.findUserByEmail(email);
    if (!user) return res.json(NEUTRAL_RESET_RESPONSE);

    const out = await deliverResetLink({ req, user, isFirstAccess: !user.password_hash });
    res.json({ ...NEUTRAL_RESET_RESPONSE, devUrl: out.devUrl });
  } catch (err) {
    next(err);
  }
});

// Define a senha a partir do token do email e já entrega a sessão.
app.post('/api/auth/set-password', async (req, res, next) => {
  try {
    const token = String(req.body.token || '');
    const password = String(req.body.password || '');

    const invalid = auth.validatePassword(password);
    if (invalid) return res.status(400).json({ error: invalid });

    const reset = await auth.consumeResetToken(token);
    if (!reset) {
      return res.status(400).json({ error: 'Este link expirou ou já foi usado. Peça um novo link de acesso.' });
    }

    const user = await store.findUserById(reset.user_id);
    if (!user) return res.status(400).json({ error: 'Conta não encontrada.' });

    await store.setUserPassword(user.id, auth.hashPassword(password));
    await store.touchLogin(user.id);
    const session = await auth.issueSession(user.id);
    res.json({ ok: true, token: session, user: auth.publicUser(user) });
  } catch (err) {
    next(err);
  }
});

app.post('/api/auth/login', async (req, res, next) => {
  try {
    const email = auth.normalizeEmail(req.body.email);
    const password = String(req.body.password || '');
    if (!auth.isValidEmail(email) || !password) {
      return res.status(400).json({ error: 'Informe email e senha.' });
    }

    const limit = auth.rateLimit(`login:${req.ip}:${email}`, { max: 8, windowMs: 15 * 60 * 1000 });
    if (!limit.allowed) {
      return res.status(429).json({
        error: `Muitas tentativas de login. Tente novamente em ${Math.ceil(limit.retryAfterSec / 60)} minutos.`,
      });
    }

    const user = await store.findUserByEmail(email);
    // Mesma mensagem para email inexistente, senha errada e conta sem senha
    // definida: nenhuma delas revela em qual dos casos o atacante caiu.
    const genericFail = { error: 'Email ou senha incorretos.' };

    if (!user || !user.password_hash) return res.status(401).json(genericFail);
    if (!auth.verifyPassword(password, user.password_hash)) return res.status(401).json(genericFail);

    await store.touchLogin(user.id);
    const session = await auth.issueSession(user.id);
    res.json({ ok: true, token: session, user: auth.publicUser(user) });
  } catch (err) {
    next(err);
  }
});

app.post('/api/auth/logout', async (req, res, next) => {
  try {
    await auth.revokeSession(auth.bearerToken(req));
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

app.get('/api/auth/me', auth.requireAuth(), (req, res) => {
  res.json({ user: auth.publicUser(req.user) });
});

app.patch('/api/auth/me', auth.requireAuth(), async (req, res, next) => {
  try {
    const name = String(req.body.name || '').trim();
    const crm = String(req.body.crm || '').trim();
    if (name.length < 3) return res.status(400).json({ error: 'Informe seu nome completo.' });
    if (crm.length < 3) return res.status(400).json({ error: 'Informe seu CRM.' });
    await store.updateUserProfile(req.user.id, { name, crm });
    res.json({ ok: true, user: { ...auth.publicUser(req.user), name, crm } });
  } catch (err) {
    next(err);
  }
});

/* =============================== PLAUD =============================== */

// state assinado: amarra o callback ao médico que iniciou a conexão, sem
// precisar de sessão em cookie no retorno do provedor.
const PLAUD_STATE_SECRET = process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex');

function signState(userId) {
  const payload = `${userId}.${Date.now()}`;
  const sig = crypto.createHmac('sha256', PLAUD_STATE_SECRET).update(payload).digest('base64url');
  return `${Buffer.from(payload).toString('base64url')}.${sig}`;
}

function verifyState(state) {
  const [encoded, sig] = String(state || '').split('.');
  if (!encoded || !sig) return null;
  const payload = Buffer.from(encoded, 'base64url').toString('utf8');
  const expected = crypto.createHmac('sha256', PLAUD_STATE_SECRET).update(payload).digest('base64url');
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  const [userId, issuedAt] = payload.split('.');
  if (Date.now() - Number(issuedAt) > 10 * 60 * 1000) return null;
  return userId;
}

app.get('/api/plaud/status', auth.requireAuth(), async (req, res, next) => {
  try {
    const configured = plaud.isConfigured();
    const tokens = configured ? await store.getPlaudTokens(req.user.id) : null;
    res.json({ configured, connected: Boolean(tokens) });
  } catch (err) {
    next(err);
  }
});

app.get('/api/plaud/connect', auth.requireAuth(), (req, res) => {
  if (!plaud.isConfigured()) {
    return res.status(503).json({
      error: 'A integração com o Plaud ainda não foi liberada para esta instalação.',
    });
  }
  res.json({ url: plaud.authorizeUrl({ req, state: signState(req.user.id) }) });
});

// Callback do OAuth: o provedor redireciona o navegador para cá, então a
// resposta é um redirect para a home com o resultado na query string.
app.get('/api/plaud/callback', async (req, res) => {
  const back = (status) => res.redirect(`/?plaud=${status}`);
  try {
    if (req.query.error) return back('negado');
    const userId = verifyState(req.query.state);
    if (!userId) return back('estado-invalido');
    if (!req.query.code) return back('sem-codigo');

    const tokens = await plaud.exchangeCode({ req, code: String(req.query.code) });
    await store.savePlaudTokens(userId, tokens);
    back('conectado');
  } catch (err) {
    console.error('Erro no callback do Plaud:', err);
    back('falha');
  }
});

app.post('/api/plaud/disconnect', auth.requireAuth(), async (req, res, next) => {
  try {
    await store.deletePlaudTokens(req.user.id);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

app.get('/api/plaud/recordings', auth.requireAuth(), async (req, res, next) => {
  try {
    res.json({ recordings: await plaud.listRecordings(req.user.id) });
  } catch (err) {
    if (err.code === 'PLAUD_REAUTH') return res.status(409).json({ error: err.message, reauth: true });
    next(err);
  }
});

app.get('/api/plaud/transcript/:id', auth.requireAuth(), async (req, res, next) => {
  try {
    res.json({ text: await plaud.fetchTranscript(req.user.id, req.params.id) });
  } catch (err) {
    if (err.code === 'PLAUD_REAUTH') return res.status(409).json({ error: err.message, reauth: true });
    next(err);
  }
});

/* ============================== EXTRAÇÃO ============================== */

app.post('/api/extract', auth.requireAuth(), upload.array('files', 10), async (req, res) => {
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
  res.json({
    ok: true,
    hasApiKey: Boolean(process.env.ANTHROPIC_API_KEY),
    storage: store.usingPostgres ? 'postgres' : 'arquivo (efêmero)',
    email: mailer.isConfigured() ? 'configurado' : 'não configurado',
    plaud: plaud.isConfigured() ? 'configurado' : 'aguardando credenciais',
  });
});

app.use(express.static(path.join(__dirname, 'public')));

// Handler de erro final: registra o detalhe no servidor mas nunca devolve stack
// trace nem mensagem interna para o cliente em produção.
app.use((err, req, res, _next) => {
  console.error('Erro não tratado:', err);
  if (res.headersSent) return;
  res.status(500).json({ error: 'Erro interno. Tente novamente em instantes.' });
});

const PORT = process.env.PORT || 3000;

store.init()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`OncoGenYX rodando em http://localhost:${PORT}`);
      console.log(`  Armazenamento: ${store.usingPostgres ? 'Postgres' : 'arquivo local (efêmero)'}`);
      console.log(`  Email:         ${mailer.isConfigured() ? 'Resend configurado' : 'NÃO configurado (links vão para o console)'}`);
      console.log(`  Plaud:         ${plaud.isConfigured() ? 'credenciais presentes' : 'aguardando credenciais'}`);
    });
  })
  .catch((err) => {
    console.error('Falha ao inicializar o armazenamento:', err);
    process.exit(1);
  });
