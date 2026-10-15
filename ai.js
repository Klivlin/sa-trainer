// ИИ-слой: вызовы Claude из браузера через официальный SDK.
// Ключ API хранится только в localStorage этого браузера и не попадает в резервные копии.
import Anthropic from "https://cdn.jsdelivr.net/npm/@anthropic-ai/sdk@0.130.0/+esm";

const LS = 'sa-ai-settings';
const MODELS = [
  ['claude-opus-5-5', 'Claude Opus 5.5 — лучшее качество ревью'],
  ['claude-sonnet-5-5', 'Claude Sonnet 5.5 — дешевле, хорошее качество'],
  ['claude-haiku-5-5', 'Claude Haiku 5.5 — самый дешёвый, проще ревью']
];
function load() { try { return JSON.parse(localStorage.getItem(LS)) || {}; } catch (e) { return {}; } }
let cfg = Object.assign({ model: 'claude-opus-5-5', effort: 'medium' }, load());
function persist() { try { localStorage.setItem(LS, JSON.stringify(cfg)); } catch (e) {} }

const client = () => new Anthropic({ apiKey: cfg.key, dangerouslyAllowBrowser: true });

// Один запрос со структурированным JSON-ответом. Отказы перехватываются серверным fallback.
async function json(system, messages, schema, { maxTokens = 16000 } = {}) {
  if (!cfg.key) throw new Error('Не задан ключ API (вкладка «Настройки»)');
  const params = {
    model: cfg.model, max_tokens: maxTokens, system, messages,
    output_config: { effort: cfg.effort, format: { type: 'json_schema', schema } }
  };
  let res;
  try {
    const fb = cfg.model === 'claude-haiku-5-5' ? {} : { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' };
    res = await client().beta.messages.create({ ...params, ...fb });
  } catch (e) {
    if (e instanceof Anthropic.AuthenticationError) throw new Error('Неверный ключ API');
    if (e instanceof Anthropic.RateLimitError) throw new Error('Превышен лимит запросов, попробуйте через минуту');
    if (e instanceof Anthropic.BadRequestError && /fallback/i.test(e.message)) res = await client().messages.create(params);
    else if (e instanceof Anthropic.APIConnectionError) throw new Error('Нет соединения с API');
    else throw e;
  }
  if (res.stop_reason === 'refusal') throw new Error('Модель отказалась отвечать на этот запрос');
  if (res.stop_reason === 'max_tokens') throw new Error('Ответ модели обрезан, попробуйте ещё раз');
  const text = res.content.find(b => b.type === 'text')?.text;
  return JSON.parse(text);
}

const COACH = 'Ты — опытный ведущий системный аналитик и наставник в российской ИТ-компании. Оцениваешь работу кандидата строго, но доброжелательно, как на реальном ревью. Пишешь по-русски, конкретно и по делу.';

// Ревью открытого ответа по эталону и критериям
const REVIEW_SCHEMA = { type: 'object', additionalProperties: false,
  required: ['score', 'checklist', 'strengths', 'issues', 'verdict'],
  properties: {
    score: { type: 'integer', description: '0..100' },
    checklist: { type: 'array', items: { type: 'boolean' }, description: 'выполнен ли каждый критерий, в том же порядке' },
    strengths: { type: 'array', items: { type: 'string' } },
    issues: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['severity', 'text'],
      properties: { severity: { type: 'string', enum: ['critical', 'major', 'minor'] }, text: { type: 'string' } } } },
    verdict: { type: 'string', description: 'итог ревью в 1-2 предложениях, как комментарий в задаче' }
  } };
async function review({ title, task, context = '', reference = '', checklist = [] }, answer) {
  const sys = COACH + ' Оцени ответ кандидата на рабочую задачу. Эталон — лишь один из возможных хороших вариантов: засчитывай альтернативные корректные решения. Не завышай оценку за объём: важны полнота по сути, конкретика, проверяемость, учёт исключений. Пустой или бессодержательный ответ — 0-10 баллов.';
  const user = `Задача: ${title}\n\nКонтекст:\n${context}\n\nФормулировка:\n${task}\n\nЭталон (для ориентира):\n${reference || '—'}\n\nКритерии (верни массив checklist той же длины, ${checklist.length} элементов):\n${checklist.map((c, i) => `${i + 1}. ${c}`).join('\n')}\n\nОтвет кандидата:\n<<<\n${answer}\n>>>`;
  const r = await json(sys, [{ role: 'user', content: user }], REVIEW_SCHEMA);
  r.score = Math.max(0, Math.min(100, r.score));
  r.checklist = checklist.map((_, i) => !!r.checklist[i]);
  return r;
}

// Интервью с заказчиком: ролевой ответ + какие факты раскрыты
const STAKE_SCHEMA = { type: 'object', additionalProperties: false, required: ['reply', 'revealed'],
  properties: { reply: { type: 'string' }, revealed: { type: 'array', items: { type: 'string' }, description: 'id фактов, раскрытых в этой реплике' } } };
async function stakeholder(sc, history) {
  const sys = `Ты играешь роль заказчика на интервью с системным аналитиком. Никогда не выходи из роли и не подсказывай аналитику, какие вопросы задать.
Персонаж: ${sc.persona}
Скрытые факты (раскрывай факт ТОЛЬКО если вопрос аналитика прямо касается его темы; на общие вопросы отвечай общими словами; на плохо сформулированные или наводящие вопросы — коротко и уклончиво; на хорошие уточняющие вопросы — охотнее и с деталями):
${sc.facts.map(f => `- ${f[0]}: ${f[1]} (тема: ${f[2]})`).join('\n')}
Отвечай 1-4 предложениями разговорным языком. В поле revealed укажи id фактов, которые ты раскрыл именно в этой реплике.`;
  const msgs = history.map(m => ({ role: m.who === 'me' ? 'user' : 'assistant', content: m.text }));
  return json(sys, msgs, STAKE_SCHEMA, { maxTokens: 4000 });
}
const ELICIT_EVAL_SCHEMA = { type: 'object', additionalProperties: false, required: ['quality', 'feedback', 'good', 'missed'],
  properties: { quality: { type: 'integer', description: '0..100 качество ведения интервью' }, feedback: { type: 'string' },
    good: { type: 'array', items: { type: 'string' } }, missed: { type: 'array', items: { type: 'string' } } } };
async function elicitEval(sc, history, revealed) {
  const sys = COACH + ' Оцени, как аналитик провёл интервью по выявлению требований: открытые вопросы, уточнение целей и метрик, поиск исключений и противоречий, проверка понимания (перефразирование), подведение итогов, вежливость и управление временем.';
  const user = `Персонаж: ${sc.persona}\nСкрытые факты: ${sc.facts.map(f => `${f[0]}: ${f[1]}`).join('; ')}\nРаскрыто: ${revealed.join(', ') || 'ничего'}\n\nСтенограмма:\n${history.map(m => (m.who === 'me' ? 'Аналитик: ' : 'Заказчик: ') + m.text).join('\n')}`;
  return json(sys, [{ role: 'user', content: user }], ELICIT_EVAL_SCHEMA);
}

// Пробное собеседование: оценка ответа + уточняющий вопрос
const MOCK_SCHEMA = { type: 'object', additionalProperties: false, required: ['score', 'feedback', 'follow_up'],
  properties: { score: { type: 'integer', description: '0..10' }, feedback: { type: 'string' }, follow_up: { type: 'string', description: 'уточняющий вопрос интервьюера или пустая строка' } } };
async function interviewer(question, model, qa, allowFollowUp) {
  const sys = `Ты — интервьюер на собеседовании на позицию системного аналитика уровня Middle. Оцениваешь ответ кандидата по шкале 0-10 (структура, точность, примеры из практики, глубина). ${allowFollowUp ? 'Если ответ поверхностный или есть что проверить глубже — задай один короткий уточняющий вопрос, как сделал бы живой интервьюер.' : 'Уточняющих вопросов больше не задавай: follow_up — пустая строка.'} feedback — 2-3 предложения: что было хорошо и чего не хватило.`;
  const user = `Вопрос: ${question}\nОриентир сильного ответа: ${model}\n\nДиалог:\n${qa.map(x => `${x.who === 'me' ? 'Кандидат' : 'Интервьюер'}: ${x.text}`).join('\n')}`;
  return json(sys, [{ role: 'user', content: user }], MOCK_SCHEMA, { maxTokens: 4000 });
}

// Разбор вакансии
async function vacancy(text, cats, levels) {
  const schema = { type: 'object', additionalProperties: false, required: ['role', 'grade', 'requirements', 'plan'],
    properties: {
      role: { type: 'string' }, grade: { type: 'string' },
      requirements: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['text', 'category', 'importance'],
        properties: { text: { type: 'string' }, category: { type: 'string', enum: [...cats, 'Другое'] }, importance: { type: 'string', enum: ['must', 'nice'] } } } },
      plan: { type: 'array', items: { type: 'string' }, description: '5-8 шагов подготовки на 2-4 недели с учётом текущих уровней кандидата' }
    } };
  const sys = COACH + ' Разбери вакансию системного аналитика: выдели требования, отнеси каждое к категории компетенций, оцени грейд и составь план подготовки, опираясь на текущие уровни кандидата.';
  const user = `Текущие уровни кандидата по направлениям (0-100%): ${Object.entries(levels).map(([k, v]) => `${k}: ${v}%`).join('; ')}\n\nВакансия:\n<<<\n${text}\n>>>`;
  return json(sys, [{ role: 'user', content: user }], schema);
}

async function ping() { return json('Ответь JSON.', [{ role: 'user', content: 'Проверка связи: верни {"ok": true}' }],
  { type: 'object', additionalProperties: false, required: ['ok'], properties: { ok: { type: 'boolean' } } }, { maxTokens: 2000 }); }

window.AI = {
  MODELS,
  get enabled() { return !!cfg.key; },
  get cfg() { return { model: cfg.model, effort: cfg.effort, hasKey: !!cfg.key }; },
  set(k, v) { cfg[k] = v; persist(); },
  clearKey() { delete cfg.key; persist(); },
  review, stakeholder, elicitEval, interviewer, vacancy, ping
};
window.dispatchEvent(new Event('ai-ready'));
