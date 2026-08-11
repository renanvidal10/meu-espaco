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
const pdf = require('./pdf');

const app = express();
const IS_PRODUCTION = process.env.NODE_ENV === 'production';

// Modo de acesso.
//   'simples'  -> o médico entra só com nome e CRM. Não depende de domínio
//                 próprio, de provedor de email nem de banco persistente, e é
//                 o modo adequado para a fase de validação clínica.
//   'completo' -> cadastro por email com senha e link de definição (o fluxo
//                 já implementado abaixo), a ser ligado quando houver domínio.
// A sessão é emitida do mesmo jeito nos dois modos, então /api/extract e
// /api/chat continuam protegidos - o modo simples reduz o atrito de entrada,
// não remove a autenticação.
const AUTH_MODE = process.env.AUTH_MODE === 'completo' ? 'completo' : 'simples';
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });

if (!process.env.ANTHROPIC_API_KEY) {
  console.warn('AVISO: ANTHROPIC_API_KEY não está definida. Configure um arquivo .env (veja .env.example).');
}

// Sem DATABASE_URL o armazenamento é o disco local, que no Render é efêmero:
// some a cada deploy e a cada hibernação por inatividade. Decisão consciente
// para a fase beta — o app precisa rodar sem depender de provisionar banco.
// A UI avisa o médico de que a conta é temporária (ver /api/health -> ephemeral).
if (IS_PRODUCTION && !store.usingPostgres) {
  console.warn('AVISO: rodando sem DATABASE_URL. As contas são temporárias e');
  console.warn('serão perdidas no próximo deploy ou hibernação do serviço.');
}

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

app.set('trust proxy', 1);
app.use(cors());
app.use(express.json({ limit: '1mb' }));

// Schema e prompt de extração são GERADOS a partir do registro de tumores
// (public/tumors.js). Adicionar um tumor lá passa a valer aqui automaticamente,
// sem editar o schema à mão — que era a fonte de divergência antiga entre a
// lista de campos do backend e as regras clínicas do frontend.
const TUMORS = require('./public/tumors.js');

function buildSchema() {
  const properties = {
    tipo_tumor: {
      type: 'string',
      enum: [...TUMORS.labels(), 'Não identificado'],
      description: 'Subtipo oncológico identificado a partir do conteúdo do material. "Não identificado" apenas se não for possível determinar com segurança.',
    },
    tipo_tumor_justificativa: {
      type: 'string',
      description: 'Em 1 frase curta, o que no material levou a identificar esse subtipo. Vazio se "Não identificado".',
    },
  };

  // Um bloco de campos por tumor, com chave namespaced. Campos comuns entram
  // uma vez só. Ver a explicação longa em public/tumors.js: fundir chaves
  // iguais fazia a lista de valores de um tumor valer para todos.
  TUMORS.schemaFields().forEach((field) => {
    const prop = {
      type: 'string',
      description: field.escopo
        ? `[Só para ${field.escopo}. Deixe vazio para qualquer outro subtipo.] ${field.ai}`
        : `[Todos os subtipos.] ${field.ai}`,
    };
    // A string vazia precisa estar no enum: é como o modelo diz "este campo
    // não se aplica ao subtipo que identifiquei".
    if (field.options) prop.enum = [...field.options, ''];
    properties[field.schemaKey] = prop;
  });

  properties.fontes_usadas = {
    type: 'array',
    items: { type: 'string' },
    description: 'Lista curta descrevendo quais fontes (texto, PDF, imagem) contribuíram com dado real para a extração.',
  };
  properties.nome_paciente = {
    type: 'string',
    description: 'Nome completo do paciente, apenas se estiver literalmente escrito no material. Vazio se não identificável. Usado só para pré-preencher o documento de solicitação — nunca entra na triagem clínica.',
  };

  return {
    type: 'object',
    properties,
    required: Object.keys(properties),
    additionalProperties: false,
  };
}

const UNIFIED_SCHEMA = buildSchema();

const UNIFIED_SYSTEM_PROMPT = `Você é o motor de extração clínica do OncoGenYX, uma ferramenta de triagem genética em oncologia. Quem lê o material do outro lado é um oncologista, e o que você extrai vira a base de uma solicitação de exame assinada por ele.

Sua tarefa tem duas etapas, nessa ordem:

1. IDENTIFIQUE o subtipo oncológico a partir do próprio material (texto digitado, laudo em PDF, foto de laudo) e preencha tipo_tumor e tipo_tumor_justificativa. Pistas por subtipo:
${TUMORS.list().map((t) => `   - ${t.label}: ${t.detect}`).join('\n')}
   Use "Não identificado" apenas se o material realmente não permitir determinar com segurança.

2. PREENCHA os campos do subtipo identificado. Cada campo diz, na própria descrição, a qual subtipo pertence. Campos de outros subtipos ficam vazios. Os campos marcados "[Todos os subtipos.]" você preenche sempre que o dado existir.

Você NÃO decide qual teste pedir e NÃO dá conduta terapêutica — apenas estrutura o que está no material. A decisão de indicação é do motor de regras da plataforma.

=== A REGRA MAIS IMPORTANTE ===

Você INTERPRETA, não transcreve. Um dado escrito de forma não-canônica é um dado PRESENTE, e deixá-lo em branco é um erro grave — não é prudência. Só deixe vazio o que realmente não está no material.

Normalize sempre, inclusive quando a escrita for informal, abreviada, com erro de digitação ou fora do padrão do laudo:
- Numeral arábico para romano: "estágio 4" → "IV"; "estadiamento 3C" → "IIIC"; "EC IIIB" → "IIIB".
- Erro de digitação e grafia aproximada: "endometeioide"/"endometrioide"/"endometrióide" → "Endometrioide"; "ceroso" → "Seroso"; "adeno" → "Adenocarcinoma".
- Idade em qualquer forma: "Paciente de 86 anos" → "86"; "mulher, 61a" → "61"; "sexagenária" → vazio (não é idade exata).
- Grau: "G3", "grau 3", "pouco diferenciado", "alto grau" → "Alto grau"; "G1", "grau 1", "bem diferenciado" → "Baixo grau".
- Jargão de prontuário brasileiro: "CA de ovário" → carcinoma de ovário; "bloqueio hormonal" → terapia de privação androgênica.

Inferência com rigor clínico, quando o dado não está escrito mas os achados o determinam:
- Estadiamento costuma precisar ser inferido dos achados cirúrgicos e patológicos (lateralidade, integridade da cápsula, envolvimento de superfície, linfonodos por sítio, achados peritoneais/omentais) ou do TNM. Faça a inferência e explique no campo de justificativa correspondente.
- Extensão da doença vem do contexto: metástase à distância (M1) indica doença metastática; início de bloqueio hormonal pela primeira vez sugere hormônio-sensível; progressão sob enzalutamida/abiraterona sugere resistência à castração.
- Grau histopatológico e estadiamento são eixos independentes — nunca deduza um a partir do outro.

Limites:
- Não invente dado que não está no material, nem infira a partir de nada. Normalizar a grafia de um dado presente não é chutar; supor um dado ausente é.
- Para campos com lista fechada de valores, responda EXATAMENTE um dos valores da lista, ou vazio. Escolha o mais próximo do sentido clínico do que está escrito.
- Extraia nome_paciente somente se estiver literalmente escrito no material. Nunca infira um nome.
- O material pode estar em português, com abreviações e jargão médico brasileiro de laudos anatomopatológicos e evoluções clínicas.`;

/* ============================ AUTENTICAÇÃO ============================ */

// No modo simples as rotas de email/senha ficam desligadas: deixá-las de pé
// prometeria ao médico um email de recuperação que ninguém enviaria.
function requireFullAuthMode(req, res, next) {
  if (AUTH_MODE !== 'completo') {
    return res.status(404).json({ error: 'Este acesso não está habilitado nesta instalação.' });
  }
  next();
}

// Identidade estável a partir do CRM: o mesmo CRM sempre cai na mesma conta,
// então voltar em outro dia recupera o histórico (quando há banco) em vez de
// criar uma conta nova a cada login.
function crmIdentity(crm) {
  const slug = crm.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  return `crm-${slug}@acesso.oncogenyx`;
}

app.post('/api/auth/acesso', async (req, res, next) => {
  try {
    if (AUTH_MODE !== 'simples') {
      return res.status(404).json({ error: 'Este acesso não está habilitado nesta instalação.' });
    }

    const name = String(req.body.name || '').trim().replace(/\s+/g, ' ');
    const crm = String(req.body.crm || '').trim().replace(/\s+/g, ' ');

    if (name.length < 3) return res.status(400).json({ error: 'Informe seu nome completo.' });
    if (name.length > 120) return res.status(400).json({ error: 'Nome longo demais.' });
    // Formato livre porque o CRM brasileiro varia por conselho regional
    // (número, UF, com ou sem separador) - validar demais barraria médico real.
    if (!/^[A-Za-z0-9][A-Za-z0-9 .\/-]{2,29}$/.test(crm)) {
      return res.status(400).json({ error: 'Informe um CRM válido (números e, se quiser, a UF).' });
    }

    const limit = auth.rateLimit(`acesso:${req.ip}`, { max: 20, windowMs: 15 * 60 * 1000 });
    if (!limit.allowed) {
      return res.status(429).json({ error: 'Muitas tentativas deste dispositivo. Aguarde alguns minutos.' });
    }

    const email = crmIdentity(crm);
    let user = await store.findUserByEmail(email);
    if (!user) {
      user = await store.createUser({ id: crypto.randomUUID(), email, name, crm });
    } else if (user.name !== name) {
      // O nome vai impresso na solicitação assinada: vale sempre o que o
      // médico acabou de digitar, não o que ficou salvo de uma sessão antiga.
      await store.updateUserProfile(user.id, { name, crm });
      user = { ...user, name, crm };
    }

    await store.touchLogin(user.id);
    const session = await auth.issueSession(user.id);
    res.json({ ok: true, token: session, user: auth.publicUser(user) });
  } catch (err) {
    next(err);
  }
});

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
app.post('/api/auth/register', requireFullAuthMode, async (req, res, next) => {
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
app.post('/api/auth/request-reset', requireFullAuthMode, async (req, res, next) => {
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
app.post('/api/auth/set-password', requireFullAuthMode, async (req, res, next) => {
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

app.post('/api/auth/login', requireFullAuthMode, async (req, res, next) => {
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

/* =============================== GENA =============================== */

const GENA_SYSTEM_PROMPT = `Você é a Gena, assistente de triagem genômica do OncoGenYX. Fala com médicos oncologistas, urologistas e cirurgiões no Brasil.

Seu papel é reunir, por conversa, os dados clínicos necessários para a triagem de indicação de teste genético (germinativo e somático).

Como você se comporta:
- Tom profissional, direto e cordial. Você fala com um colega de trabalho, não com um leigo. Nada de formalidade excessiva, emoji ou entusiasmo artificial.
- Respostas curtas: 1 a 3 frases. Uma pergunta por vez. Nunca despeje um questionário inteiro de uma vez.
- Aceite resposta em linguagem natural, abreviada ou fora de ordem, e normalize internamente ("3C" é estágio IIIC, "G3" é alto grau, "PSA 225" é PSA de 225 ng/mL).
- Se o médico já der vários dados de uma vez, reconheça o que recebeu e pergunte só o que ainda falta.

Primeiro identifique de qual tumor se trata, pelo que o médico descrever. Se ainda não der para saber, pergunte. Os tumores cobertos e o que reunir em cada um:
${TUMORS.list().map((t) => `- ${t.label}: ${t.fields.map((f) => f.label).join(', ')}.`).join('\n')}

Limites que você não ultrapassa:
- Você NÃO decide qual teste pedir e NÃO dá conduta terapêutica. Quem faz a triagem é o motor de regras da plataforma, ancorado em diretrizes nacionais e internacionais vigentes. Se perguntarem qual teste pedir, diga que vai reunir o caso e rodar a triagem.
- Você NUNCA pede nome do paciente, CPF, data de nascimento ou qualquer dado que identifique a pessoa. Se o médico mencionar espontaneamente, ignore o dado e siga sem repeti-lo.

Quando tiver o suficiente para rodar a triagem, responda normalmente e termine a mensagem com uma linha isolada exatamente neste formato:

CASO_PRONTO: <resumo do caso em uma frase corrida, com todos os dados coletados>

Essa linha é lida pela plataforma para preencher o caso. Só a inclua quando realmente tiver dado suficiente.`;

app.post('/api/chat', auth.requireAuth(), async (req, res, next) => {
  try {
    const history = Array.isArray(req.body.messages) ? req.body.messages : [];
    if (!history.length) return res.status(400).json({ error: 'Conversa vazia.' });

    // Trava de custo e de contexto: uma conversa de triagem não passa disso,
    // e sem limite um cliente malicioso poderia inflar a fatura da API.
    const messages = history
      .slice(-24)
      .filter((m) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
      .map((m) => ({ role: m.role, content: m.content.slice(0, 4000) }));

    if (!messages.length || messages[messages.length - 1].role !== 'user') {
      return res.status(400).json({ error: 'A última mensagem precisa ser do médico.' });
    }

    const response = await client.messages.create({
      model: 'claude-opus-5',
      max_tokens: 600,
      system: GENA_SYSTEM_PROMPT,
      messages,
    });

    const raw = response.content.filter((b) => b.type === 'text').map((b) => b.text).join('').trim();

    // Separa o marcador de caso pronto do texto que o médico vê.
    const match = raw.match(/^CASO_PRONTO:\s*(.+)$/m);
    const reply = raw.replace(/^CASO_PRONTO:.*$/m, '').trim();

    res.json({ reply, caseReady: match ? match[1].trim() : null });
  } catch (err) {
    next(err);
  }
});

/* ============================== EXTRAÇÃO ============================== */

app.post('/api/extract', auth.requireAuth(), upload.array('files', 10), async (req, res) => {
  try {
    const text = (req.body.text || '').trim();
    const files = req.files || [];

    if (!files.length && !text) {
      return res.status(400).json({ error: 'Nenhum texto ou arquivo foi enviado.' });
    }

    const content = [];
    const avisos = [];
    // Guardados para o plano B: se a API recusar o documento, o texto destes
    // PDFs é extraído aqui e a chamada é refeita.
    const pdfsEnviados = [];

    for (const file of files) {
      const ehPdf = file.mimetype === 'application/pdf' || /\.pdf$/i.test(file.originalname || '');
      const ehImagem = (file.mimetype || '').startsWith('image/');

      if (ehPdf) {
        // Checagem barata antes de gastar chamada: arquivo vazio, protegido ou
        // que nem é PDF são recusados aqui, com instrução do que fazer.
        const check = pdf.inspecionar(file);
        if (!check.ok) {
          avisos.push({ arquivo: file.originalname, motivo: check.motivo, comoResolver: check.comoResolver });
          continue;
        }
        pdfsEnviados.push(file);
        content.push({
          type: 'document',
          source: { type: 'base64', media_type: 'application/pdf', data: file.buffer.toString('base64') },
        });
      } else if (ehImagem) {
        if (!file.buffer || !file.buffer.length) {
          avisos.push({
            arquivo: file.originalname,
            motivo: `"${file.originalname}" chegou vazio (0 bytes).`,
            comoResolver: 'Abra a imagem uma vez no aparelho para forçar o download e anexe de novo.',
          });
          continue;
        }
        content.push({
          type: 'image',
          source: { type: 'base64', media_type: file.mimetype, data: file.buffer.toString('base64') },
        });
      } else {
        avisos.push({
          arquivo: file.originalname,
          motivo: `"${file.originalname}" não é PDF nem imagem.`,
          comoResolver: 'Anexe o laudo em PDF, ou tire uma foto/print e anexe como imagem.',
        });
      }
    }

    // Nenhuma fonte utilizável sobrou: responde o porquê, sem gastar chamada.
    const temAnexoUtil = content.length > 0;
    if (!temAnexoUtil && !text) {
      return res.status(400).json({
        error: avisos.length
          ? `${avisos[0].motivo} ${avisos[0].comoResolver}`
          : 'Nenhum arquivo pôde ser lido. Anexe um laudo em PDF ou uma foto.',
        avisos,
      });
    }

    function montaMensagem(blocos, textoExtra) {
      const instrucao = (text || textoExtra)
        ? `Descrição em texto fornecida pelo médico:\n\n${[text, textoExtra].filter(Boolean).join('\n\n')}`
        : 'Nenhum texto foi digitado — extraia só a partir dos arquivos anexados.';
      return [...blocos, { type: 'text', text: `${instrucao}\n\nExtraia o caso clínico estruturado conforme o schema.` }];
    }

    async function chamar(blocos, textoExtra) {
      return client.messages.create({
        model: 'claude-opus-5',
        max_tokens: 2048,
        system: UNIFIED_SYSTEM_PROMPT,
        output_config: { format: { type: 'json_schema', schema: UNIFIED_SCHEMA } },
        messages: [{ role: 'user', content: montaMensagem(blocos, textoExtra) }],
      });
    }

    let response;
    try {
      response = await chamar(content);
    } catch (err) {
      // Plano B: a API recusou o documento. Em vez de devolver o erro cru ao
      // médico, o texto do PDF é extraído aqui e a chamada é refeita sem o
      // documento. Perde o layout, mas um laudo lido vale mais que um erro.
      if (!pdf.ehRecusaDePdf(err) || !pdfsEnviados.length) throw err;

      console.warn('API recusou o PDF; tentando extração local de texto.', err.message);
      const trechos = [];
      for (const file of pdfsEnviados) {
        try {
          const { texto, paginas } = await pdf.extrairTexto(file.buffer);
          if (texto.length > 40) {
            trechos.push(`--- Conteúdo extraído de "${file.originalname}" (${paginas} página(s)) ---\n${texto}`);
          } else {
            avisos.push({
              arquivo: file.originalname,
              motivo: `"${file.originalname}" não tem texto selecionável.`,
              comoResolver: 'O PDF parece ser uma imagem digitalizada que a leitura automática não conseguiu abrir. Tire uma foto ou print da página do laudo e anexe como imagem.',
            });
          }
        } catch (e) {
          avisos.push({
            arquivo: file.originalname,
            motivo: `Não consegui abrir "${file.originalname}".`,
            comoResolver: 'Tire uma foto ou print do laudo e anexe como imagem, ou reimprima o PDF a partir do sistema de origem.',
          });
        }
      }

      const semPdf = content.filter((b) => b.type !== 'document');
      if (!trechos.length && !semPdf.length && !text) {
        return res.status(422).json({
          error: `${avisos[0].motivo} ${avisos[0].comoResolver}`,
          avisos,
        });
      }
      if (trechos.length) {
        avisos.push({
          arquivo: pdfsEnviados.map((f) => f.originalname).join(', '),
          motivo: 'O PDF não pôde ser lido no formato original.',
          comoResolver: 'O texto foi extraído e usado assim mesmo — confira os campos com atenção extra, porque tabelas e imagens do laudo podem ter se perdido.',
          recuperado: true,
        });
      }
      response = await chamar(semPdf, trechos.join('\n\n'));
    }

    const textBlock = response.content.find((b) => b.type === 'text');
    if (!textBlock) {
      return res.status(502).json({ error: 'A leitura não retornou um caso estruturado. Tente novamente.' });
    }

    // O modelo responde com chave namespaced por tumor
    // ("prostata__extensao_doenca"). Aqui isso vira o objeto simples que o
    // navegador consome, já filtrado para o subtipo identificado.
    const extracted = TUMORS.unscope(JSON.parse(textBlock.text));
    res.json({ extracted, avisos, usage: response.usage });
  } catch (err) {
    // O detalhe técnico fica no servidor. O médico recebe uma frase que diz o
    // que houve e o que fazer - nunca o JSON cru da API, que além de não
    // ajudar ainda quebrava o layout por ser uma linha sem espaços.
    console.error('Erro na extração:', err);
    const status = err && err.status;
    const mensagem =
      status === 429 ? 'A leitura está com muitas solicitações no momento. Tente de novo em alguns segundos.'
      : status === 401 || status === 403 ? 'A chave de acesso à leitura automática está inválida ou sem crédito. Verifique a configuração do serviço.'
      : status === 413 ? 'O material anexado é grande demais. Anexe menos páginas ou apenas a parte relevante do laudo.'
      : pdf.ehRecusaDePdf(err) ? 'Não consegui abrir o PDF anexado. Tire uma foto ou print do laudo e anexe como imagem.'
      : 'Não consegui ler o caso agora. Tente novamente em instantes — se persistir, anexe o laudo como foto.';
    res.status(status && status < 500 ? 422 : 500).json({ error: mensagem });
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

// Configuração pública consumida pela tela de login para avisar, com todas as
// letras, quando as contas são temporárias — em vez de deixar o médico
// descobrir sozinho que a conta sumiu.
app.get('/api/config', (req, res) => {
  res.json({
    authMode: AUTH_MODE,
    ephemeralAccounts: !store.usingPostgres,
    emailEnabled: mailer.isConfigured(),
    plaudEnabled: plaud.isConfigured(),
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
