// ИИ-слой: два провайдера — Google Gemini (бесплатный тариф, по умолчанию) и Anthropic Claude (платный).
// Ключи хранятся только в localStorage этого браузера и не попадают в резервные копии.

const LS = 'sa-ai-settings';
const PROVIDERS = {
  gemini: { name: 'Google Gemini — бесплатный тариф', keyHint: 'AIza…', keyUrl: 'aistudio.google.com → Get API key' },
  anthropic: { name: 'Anthropic Claude — платно, по факту', keyHint: 'sk-ant-…', keyUrl: 'platform.claude.com → API Keys' }
};
const CLAUDE_MODELS = [
  ['claude-opus-5-5', 'Claude Opus 5.5 — лучшее качество ревью'],
  ['claude-sonnet-5-5', 'Claude Sonnet 5.5 — дешевле, хорошее качество'],
  ['claude-haiku-5-5', 'Claude Haiku 5.5 — самый дешёвый']
];
function load() { try { return JSON.parse(localStorage.getItem(LS)) || {}; } catch (e) { return {}; } }
let cfg = Object.assign({ provider: 'gemini', keys: {}, models: { anthropic: 'claude-opus-5-5' }, effort: 'medium', geminiModels: [] }, load());
// миграция со старого формата настроек (один ключ Claude)
if (cfg.key) { cfg.keys.anthropic = cfg.key; cfg.provider = 'anthropic'; delete cfg.key; }
if (cfg.model) { cfg.models.anthropic = cfg.model; delete cfg.model; }
function persist() { try { localStorage.setItem(LS, JSON.stringify(cfg)); } catch (e) {} }
const key = () => cfg.keys[cfg.provider];
const sleep = ms => new Promise(r => setTimeout(r, ms));

// Разбор JSON из ответа модели (на случай обёртки в ```json)
function parseJson(text) {
  const t = String(text || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '');
  try { return JSON.parse(t); } catch (e) {
    const m = t.match(/[\[{][\s\S]*[\]}]/); if (m) return JSON.parse(m[0]);
    throw new Error('Модель вернула некорректный JSON, попробуйте ещё раз');
  }
}

// ───────── Gemini (Interactions API) ─────────
const GEM = 'https://generativelanguage.googleapis.com/v1beta';
const stripAP = x => Array.isArray(x) ? x.map(stripAP) : (x && typeof x === 'object') ? Object.fromEntries(Object.entries(x).filter(([k]) => k !== 'additionalProperties').map(([k, v]) => [k, k === 'properties' ? Object.fromEntries(Object.entries(v).map(([pk, pv]) => [pk, stripAP(pv)])) : stripAP(v)])) : x;
async function gemFetch(path, body) {
  let r;
  // не ждём одну модель дольше 60 секунд — при зависании переходим к следующей
  const ctrl = new AbortController(), timer = setTimeout(() => ctrl.abort(), 60000);
  try {
    r = await fetch(GEM + path, { method: body ? 'POST' : 'GET', signal: ctrl.signal, headers: { 'x-goog-api-key': key(), ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
  } catch (e) {
    if (e.name === 'AbortError') { const t = new Error('Модель Gemini не ответила за 60 секунд'); t.status = 504; throw t; }
    throw new Error('Нет соединения с Gemini API');
  } finally { clearTimeout(timer); }
  if (r.ok) return r.json();
  const err = await r.json().catch(() => ({}));
  const msg = err.error?.message || r.statusText;
  const e = new Error(`Gemini API ${r.status}: ${msg}`); e.status = r.status;
  if (r.status === 429) e.quota = true;
  if (r.status === 403 || (r.status === 400 && /api key/i.test(msg))) e.message = 'Неверный ключ Gemini API или нет доступа';
  throw e;
}
async function geminiModels() {
  const res = await gemFetch('/models?pageSize=200');
  return (res.models || []).filter(m => (m.supportedGenerationMethods || []).includes('generateContent'))
    .map(m => m.name.replace('models/', ''))
    .filter(n => /^gemini-\d/.test(n) && /flash/.test(n) && !/(image|tts|audio|live|embedding|vision|native|transcribe|robotics|computer|omni|banana|customtools)/.test(n));
}
// Порядок перебора: сначала выбранная, затем flash по убыванию версии, затем lite
function candidates(names) {
  const ver = n => parseFloat((n.match(/gemini-(\d+(?:\.\d+)?)/) || [])[1] || 0);
  const sorted = names.slice().sort((a, b) => (/lite/.test(a) - /lite/.test(b)) || ver(b) - ver(a));
  return [...new Set([cfg.models.gemini, ...sorted].filter(Boolean))];
}
const pickDefault = names => candidates(names)[0];
async function geminiJson(system, messages, schema, maxTokens) {
  if (!cfg.geminiModels?.length) { cfg.geminiModels = await geminiModels(); persist(); }
  const steps = messages.map(m => ({ type: m.role === 'assistant' ? 'model_output' : 'user_input', content: [{ type: 'text', text: m.content }] }));
  if (steps[0]?.type === 'model_output') steps.unshift({ type: 'user_input', content: [{ type: 'text', text: '(начало разговора)' }] });
  const body = { store: false, system_instruction: system, input: steps,
    generation_config: { max_output_tokens: maxTokens, thinking_level: cfg.effort } };
  if (schema) body.response_format = { type: 'text', mime_type: 'application/json', schema: stripAP(schema) };
  let res, lastErr;
  // Если у модели кончилась бесплатная квота — пробуем следующую и запоминаем рабочую
  for (const model of candidates(cfg.geminiModels).slice(0, 5)) {
    try { res = await gemFetch('/interactions', { model, ...body }); if (cfg.models.gemini !== model) { cfg.models.gemini = model; persist(); } break; }
    catch (e) { lastErr = e; if (!e.quota && e.status !== 404 && !(e.status >= 500)) throw e; }
  }
  if (!res) throw new Error(lastErr?.quota ? 'Бесплатные лимиты Gemini исчерпаны: подождите минуту (или до завтра, если кончился дневной лимит)' : lastErr?.status >= 500 ? 'Серверы Gemini сейчас перегружены — попробуйте через минуту' : lastErr?.message || 'Gemini не ответил');
  const text = (res.steps || []).filter(s => s.type === 'model_output').flatMap(s => s.content || []).map(c => c.text || '').join('');
  if (!text) throw new Error(`Gemini не вернул ответ (статус: ${res.status || 'неизвестно'})`);
  return schema ? parseJson(text) : { text };
}

// ───────── Claude (официальный SDK, загружается только при выборе провайдера) ─────────
let AnthropicSDK = null;
async function claudeJson(system, messages, schema, maxTokens) {
  if (!AnthropicSDK) AnthropicSDK = (await import('https://cdn.jsdelivr.net/npm/@anthropic-ai/sdk@0.130.0/+esm')).default;
  const Anthropic = AnthropicSDK, client = new Anthropic({ apiKey: key(), dangerouslyAllowBrowser: true });
  const model = cfg.models.anthropic;
  const params = { model, max_tokens: maxTokens, system, messages, output_config: { effort: cfg.effort, ...(schema ? { format: { type: 'json_schema', schema } } : {}) } };
  let res;
  try {
    const fb = model === 'claude-haiku-5-5' ? {} : { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' };
    res = await client.beta.messages.create({ ...params, ...fb });
  } catch (e) {
    if (e instanceof Anthropic.AuthenticationError) throw new Error('Неверный ключ API');
    if (e instanceof Anthropic.RateLimitError) throw new Error('Превышен лимит запросов, попробуйте через минуту');
    if (e instanceof Anthropic.BadRequestError && /fallback/i.test(e.message)) res = await client.messages.create(params);
    else if (e instanceof Anthropic.APIConnectionError) throw new Error('Нет соединения с API');
    else throw e;
  }
  if (res.stop_reason === 'refusal') throw new Error('Модель отказалась отвечать на этот запрос');
  if (res.stop_reason === 'max_tokens') throw new Error('Ответ модели обрезан, попробуйте ещё раз');
  const out = res.content.filter(b => b.type === 'text').map(b => b.text).join('');
  return schema ? parseJson(out) : { text: out };
}

// Один запрос: со схемой — структурированный JSON, без схемы (null) — обычный текст {text}
async function json(system, messages, schema, { maxTokens = 16000 } = {}) {
  if (!key()) throw new Error('Не задан ключ API (вкладка «Настройки»)');
  return cfg.provider === 'gemini' ? geminiJson(system, messages, schema, maxTokens) : claudeJson(system, messages, schema, maxTokens);
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

// Генерация новых заданий в формате банка тренажёра
const S_ = (props, req = Object.keys(props)) => ({ type: 'object', additionalProperties: false, required: req, properties: props });
const str = { type: 'string' }, strArr = { type: 'array', items: { type: 'string' } };
const GEN_SCHEMAS = {
  case: S_({ title: str, scenario: str, task: str, hint: str, reference: str, checklist: strArr }),
  sql: S_({ title: str, scenario: str, task: str, hint: str, ref: str }),
  quiz: S_({ title: str, questions: { type: 'array', items: S_({ q: str, o: strArr, a: { type: 'integer' }, e: str }) } }),
  inbox: S_({ title: str, ctx: str, steps: { type: 'array', items: S_({ from: str, text: str, opts: { type: 'array', items: S_({ t: str, s: { type: 'integer' }, fb: str }) } }) } })
};
const GEN_RULES = {
  case: 'Открытый рабочий кейс: реалистичная ситуация из практики российской ИТ-компании (2-5 предложений с конкретными цифрами и деталями), формулировка задания (что сдать), подсказка, развёрнутое эталонное решение (обычный текст, списки через переносы строк) и 5-7 проверяемых критериев оценки.',
  sql: 'SQL-задача (диалект SQLite) строго по схеме БД ниже. ref — эталонный запрос, который выполняется без ошибок на этих данных и возвращает хотя бы одну строку. Если важен порядок строк — укажи сортировку в задании и используй ORDER BY. В задании явно перечисли, какие колонки вывести.',
  quiz: 'Тест: ровно 4 вопроса, у каждого 4 варианта ответа (o), индекс правильного a от 0 до 3 (правильные ответы в разных позициях), объяснение e. Вопросы проверяют понимание, а не память на термины.',
  inbox: 'Рабочая ситуация из 3 шагов: в каждом шаге сообщение от коллеги (from — имя и роль, text) и ровно 3 варианта действия (t) с оценкой s: одно лучшее действие (2), одно частично верное (1), одно плохое (0), и пояснением fb. Порядок вариантов перемешан.'
};
async function generate(kind, cat, level, avoidTitles, schemaText) {
  const sys = COACH + ' Ты составляешь новые тренировочные задания для тренажёра системного аналитика. Задание должно быть реалистичным, однозначным и проверяемым. Пиши по-русски.';
  const user = `Тип: ${kind}. ${GEN_RULES[kind]}\nНаправление: ${cat}. Сложность: ${level} из 5.\n${kind === 'sql' ? 'Схема БД (SQLite):\n' + schemaText + '\n' : ''}Не повторяй эти задания: ${avoidTitles.slice(0, 40).join('; ') || '—'}`;
  return json(sys, [{ role: 'user', content: user }], GEN_SCHEMAS[kind]);
}

// Недельный разбор от ИИ-коуча
const COACH_SCHEMA = S_({ summary: str, wins: strArr, patterns: strArr, focus: strArr, plan: strArr });
async function weekCoach(data) {
  const sys = COACH + ' Проведи еженедельный разбор практики подопечного: что получилось, какие ошибки повторяются (patterns — именно повторяющиеся паттерны, со ссылкой на задачи), 3 главных фокуса на следующую неделю и конкретный план по дням. Будь конкретным, опирайся только на данные.';
  return json(sys, [{ role: 'user', content: 'Данные недели (JSON):\n' + JSON.stringify(data) }], COACH_SCHEMA);
}

// Наставник для новичка: объясняет задачу, даёт ступенчатые подсказки, разбирает решение, отвечает на вопросы
const TUTOR_MODES = {
  explain: 'Объясни задачу новичку: 1) о чём она простыми словами и зачем такое делают на реальной работе; 2) какие термины встречаются — расшифруй каждый; 3) пошаговый план, как к ней подступиться (4-6 шагов); 4) на что обратить внимание, где новички чаще ошибаются. НЕ давай готового решения и не пересказывай эталон.',
  hint: 'Дай ОДНУ следующую подсказку (уровень {n} из 3): уровень 1 — наводящий вопрос или направление мысли; уровень 2 — конкретнее: какие пункты/конструкции нужны; уровень 3 — почти решение: структура ответа или каркас запроса с пропусками. Не повторяй прошлые подсказки. Готовый ответ целиком не давай.',
  solution: 'Разбери эталонное решение для новичка: покажи его по шагам и для каждого шага объясни, ПОЧЕМУ так делается и что было бы, если этого не сделать. Для SQL разбери запрос по частям (каждую строку). В конце — 2-3 главных урока из этой задачи.',
  check: 'Посмотри черновик ученика и дай обратную связь как наставник: что уже хорошо, чего не хватает (по пунктам), что улучшить в первую очередь. Готовый ответ не пиши — направляй.',
  simpler: 'Это урок курса. Объясни его тему ещё проще — как другу без ИТ-опыта: бытовая аналогия, затем суть в 3-5 пунктах, затем один маленький пример. Без новых сложных терминов.',
  example: 'Это урок курса. Приведи один подробный реалистичный пример из работы системного аналитика по теме урока (ситуация → что делает аналитик по шагам → результат). В конце дай маленькое упражнение для самопроверки, а ответ на него напиши после строки «Ответ:».',
  ask: 'Ответь на вопрос ученика по этой задаче простым языком, с примером. Если вопрос просит готовое решение — дай сильную подсказку, но оставь последний шаг ученику.'
};
async function tutor(ctx, mode, { n = 1, prevHints = [], draft = '', history = [] } = {}) {
  const sys = 'Ты — терпеливый наставник для начинающего системного аналитика (почти без опыта, учится с нуля). Объясняй простым русским языком, без лишнего жаргона, а необходимые термины сразу расшифровывай. Приводи примеры из жизни. Пиши структурно: короткие абзацы, списки «- », нумерация «1. », **жирный** для главного, `код` для SQL и технических имён. Отвечай по существу, без вступлений.';
  const task = `Задание «${ctx.title}» (тип: ${ctx.kind}, направление: ${ctx.cat}).\nКонтекст: ${ctx.scenario || '—'}\nЧто нужно сделать: ${ctx.task || '—'}\nПодсказка из задания: ${ctx.hint || '—'}\n${ctx.extra || ''}\nЭталон (для тебя; показывать ученику только в режиме разбора): ${ctx.reference || '—'}\nКритерии оценки: ${(ctx.checklist || []).join('; ') || '—'}`;
  let instr = TUTOR_MODES[mode].replace('{n}', n);
  if (mode === 'hint' && prevHints.length) instr += '\nПрошлые подсказки: ' + prevHints.join(' | ');
  if (mode === 'check') instr += '\nЧерновик ученика:\n<<<\n' + draft + '\n>>>';
  const msgs = [{ role: 'user', content: task + '\n\nЗадача наставника: ' + instr }];
  if (mode === 'ask') history.forEach(m => msgs.push({ role: m.who === 'me' ? 'user' : 'assistant', content: m.text }));
  return json(sys, msgs, null, { maxTokens: 8000 });
}

async function ping() { return json('Ответь JSON.', [{ role: 'user', content: 'Проверка связи: верни {"ok": true}' }],
  { type: 'object', additionalProperties: false, required: ['ok'], properties: { ok: { type: 'boolean' } } }, { maxTokens: 2000 }); }

window.AI = {
  PROVIDERS, CLAUDE_MODELS,
  get enabled() { return !!key(); },
  get cfg() { return { provider: cfg.provider, model: cfg.models[cfg.provider], effort: cfg.effort, hasKey: !!key(), keys: Object.fromEntries(Object.keys(PROVIDERS).map(p => [p, !!cfg.keys[p]])), geminiModels: cfg.geminiModels }; },
  setProvider(p) { cfg.provider = p; persist(); },
  setKey(v) { cfg.keys[cfg.provider] = v; if (cfg.provider === 'gemini') { cfg.models.gemini = null; cfg.geminiModels = []; } persist(); },
  setModel(v) { cfg.models[cfg.provider] = v; persist(); },
  setEffort(v) { cfg.effort = v; persist(); },
  clearKey() { delete cfg.keys[cfg.provider]; persist(); },
  async loadGeminiModels() { cfg.geminiModels = await geminiModels(); if (!cfg.models.gemini || !cfg.geminiModels.includes(cfg.models.gemini)) cfg.models.gemini = pickDefault(cfg.geminiModels); persist(); return cfg.geminiModels; },
  review, stakeholder, elicitEval, interviewer, vacancy, generate, weekCoach, tutor, ping
};
window.dispatchEvent(new Event('ai-ready'));
