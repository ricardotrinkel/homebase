// Assistente por voz: recebe o que a pessoa falou (já em texto) e devolve
// as coisas para adicionar no app. Nada é salvo aqui: o app mostra a lista
// e a pessoa confirma antes. Precisa da variável ANTHROPIC_API_KEY na Vercel.
import Anthropic from '@anthropic-ai/sdk';

const S = (desc) => ({ type: ['string', 'null'], description: desc });
const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['actions', 'reply'],
  properties: {
    reply: { type: 'string', description: 'Resposta curta e simpática em português do Brasil dizendo o que vai ser adicionado, ou pedindo o que faltou.' },
    actions: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['kind', 'title', 'date', 'until', 'start', 'end', 'repeat', 'owner', 'list', 'vis', 'year', 'place'],
        properties: {
          kind: { type: 'string', enum: ['event', 'trip', 'birthday', 'shopping', 'todo'] },
          title: { type: 'string', description: 'Nome do compromisso/viagem, nome de quem faz aniversário, ou o item da lista.' },
          date: S('AAAA-MM-DD. event: o dia; trip: a ida; birthday: a data do aniversário (qualquer ano).'),
          until: S('AAAA-MM-DD. trip: a volta. event que repete: último dia (ou null).'),
          start: S('HH:MM (event).'),
          end: S('HH:MM (event).'),
          repeat: { type: 'string', enum: ['none', 'daily', 'weekly', 'biweekly', 'monthly'] },
          owner: S('event/trip: id da pessoa ou "familia".'),
          list: { type: ['string', 'null'], enum: ['mercado', 'farmacia', null] },
          vis: { type: ['string', 'null'], enum: ['eu', 'familia', null], description: 'birthday: "familia" (todos veem) ou "eu" (só quem pediu).' },
          year: { type: ['integer', 'null'], description: 'birthday: ano de nascimento, se dito.' },
          place: S('Local, se dito.'),
        },
      },
    },
  },
};

async function whoIs(token) {
  const url = process.env.SUPABASE_URL, key = process.env.SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_ANON_KEY;
  if (!token || !url || !key) return null;
  const r = await fetch(`${url}/auth/v1/user`, { headers: { apikey: key, Authorization: `Bearer ${token}` } });
  return r.ok ? r.json() : null;
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).json({ error: 'method' });
  if (!process.env.ANTHROPIC_API_KEY) return res.status(503).json({ error: 'no_key' });
  const user = await whoIs((req.headers.authorization || '').replace(/^Bearer\s+/i, ''));
  if (!user) return res.status(401).json({ error: 'login' });

  const b = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
  const text = String(b.text || '').slice(0, 2000).trim();
  if (!text) return res.status(400).json({ error: 'empty' });
  const people = (Array.isArray(b.people) ? b.people : []).slice(0, 20).map(p => `- ${String(p.name).slice(0, 40)} (${String(p.role).slice(0, 10)}): id "${String(p.id).slice(0, 40)}"`).join('\n');
  const me = String(b.me || '').slice(0, 40);

  const system = `Você é o assistente do Homebase, a agenda de uma família. A pessoa fala (ditado por voz, pode ter erros de transcrição) e você transforma o pedido em itens para adicionar.
Tipos:
- event: compromisso com horário. Sem horário dito, use 09:00–10:00. Sem fim dito, 1 hora depois do início. Lembre "toda segunda" = weekly, etc.
- trip: viagem de vários dias (ida = date, volta = until).
- birthday: aniversário (date = a data; o ano do date não importa). vis "familia" se for de alguém da família ou se a pessoa disser que todos podem ver; senão "eu".
- shopping: item da lista de supermercado (list "mercado") ou farmácia (list "farmacia"). Um item por ação.
- todo: tarefa pessoal da pessoa ("minhas tarefas").
Datas relativas ("amanhã", "sexta que vem", "dia 10") são calculadas a partir de hoje. Se a data já passou este ano, use a próxima.
owner: quem fala é o padrão. Use o id de outra pessoa ou "familia" só se a pessoa pedir${b.admin ? '' : ' (esta pessoa não é admin: use sempre o id dela)'}.
Se faltar algo essencial (ex.: a data), não invente: deixe actions vazio para esse item e pergunte no reply. Campos que não se aplicam ficam null.`;
  const context = `Hoje: ${String(b.today).slice(0, 30)} (${String(b.weekday || '').slice(0, 20)}). Fuso: ${String(b.tz || '').slice(0, 40)}.
Quem está falando: id "${me}".
Pessoas da família:
${people}`;

  const client = new Anthropic();
  try {
    const msg = await client.beta.messages.create({
      model: 'claude-opus-5-5',
      max_tokens: 4000,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      output_config: { effort: 'low', format: { type: 'json_schema', schema: SCHEMA } },
      system,
      messages: [{ role: 'user', content: `${context}\n\nPedido: ${text}` }],
    });
    if (msg.stop_reason === 'refusal') return res.status(200).json({ actions: [], reply: 'Não consegui entender esse pedido. Tente de outro jeito.' });
    const out = msg.content.filter(c => c.type === 'text').map(c => c.text).join('');
    const data = JSON.parse(out);
    return res.status(200).json(data);
  } catch (e) {
    if (e instanceof Anthropic.AuthenticationError) return res.status(503).json({ error: 'bad_key' });
    if (e instanceof Anthropic.RateLimitError) return res.status(429).json({ error: 'busy' });
    if (e instanceof SyntaxError) return res.status(502).json({ error: 'parse' });
    console.error('assistant', e);
    return res.status(502).json({ error: 'api' });
  }
}
