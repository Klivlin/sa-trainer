// Продуктивность: адаптивный план, цикл ошибок, генератор заданий, ИИ-коуч недели,
// режим фокуса и помодоро, библиотека шаблонов, настройки провайдера ИИ.

['mcards','gen'].forEach(k => S[k] = S[k] || []); ['coach','focus'].forEach(k => S[k] = S[k] || {});
const _ensureState = ensureState;
ensureState = function(){ _ensureState(); ['mcards','gen'].forEach(k => S[k] = S[k] || []); ['coach','focus'].forEach(k => S[k] = S[k] || {}); };

// ───────── 1. Адаптивный план ─────────
const GRADE_LEVEL = {'Стажёр':2, 'Junior':3, 'Middle':4, 'Senior':5};
// Приоритет задания: новое > слабое > давно не повторялось; плюс слабое направление и подходящая сложность
pickNext = function(list, offset){
  const ul = GRADE_LEVEL[matrixGrade()] || 2, comp = Object.fromEntries(competencies().map(c => [c.cat, c.level])), d = dayNum();
  const recent = new Set(Object.keys(S.plans).filter(k => k < today() && dayNum() - dayNumOf(k) <= 2).flatMap(k => Object.values(S.plans[k]).filter(v => typeof v === 'string')));
  const scored = list.map((t, i) => {
    const it = ITEMS[t.id] || t, r = S.results[t.id], lv = it.level || 2;
    let p = 0;
    if (!r) p += 3 + (it.generated ? 0.5 : 0);
    else p += (1 - r.score) * 3 + Math.min(30, d - dayNumOf(r.date)) / 30 - (r.score >= 0.85 ? 2 : 0);
    p += (1 - (comp[it.cat] ?? 0)) * 2;
    p -= Math.max(0, lv - (ul + 1)) * 1.5 + Math.max(0, ul - 1 - lv) * 0.5;
    if (recent.has(t.id) && r) p -= 1;
    p += ((i + offset) % list.length) / list.length * 0.3;
    return {id: t.id, p};
  });
  return scored.sort((a, b) => b.p - a.p)[0].id;
};
const poolExhausted = id => { const r = S.results[id]; return r && r.score >= 0.85; };

// ───────── 1. Цикл ошибок: ошибки → карточки с повторением через 1-3-7-14-30 дней ─────────
const MSTEPS = [1, 3, 7, 14, 30];
function addMistakeCard(src, front, back, cat){
  const ex = S.mcards.find(m => m.src === src && !m.done);
  if (ex) { ex.front = front; ex.back = back; ex.reps = 0; ex.due = dayNum() + 1; return; }
  S.mcards.push({id: 'm' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5), src, front, back, cat, reps: 0, due: dayNum() + 1, created: today()});
}
const _complete = complete;
complete = function(id, score, extra = {}){
  _complete(id, score, extra);
  const it = ITEMS[id]; if (!it || SERVICE_KINDS.includes(it.kind)) return;
  if (it.kind === 'quiz' && quizAns[id]) {
    it.questions.forEach((q, qi) => { if (quizAns[id].sel[qi] !== q.a) addMistakeCard(`${id}:${qi}`, q.q + '\n\n' + q.o.map((o, i) => `${'АБВГ'[i]}) ${o}`).join('\n'), `Правильно: ${q.o[q.a]}\n\n${q.e}`, it.cat); });
  } else if (score < 0.85) {
    const issues = (AIR[id]?.res?.issues || []).filter(x => x.severity !== 'minor').map(x => x.text);
    const items = [...(extra.missed || []), ...issues];
    if (items.length) addMistakeCard(id, `Задача «${it.title}» (${it.cat}).\nЧто вы упустили в решении? Вспомните пункты и объясните, почему они важны.`, items.map(x => '• ' + x).join('\n'), it.cat);
  } else S.mcards.filter(m => m.src === id).forEach(m => m.done = true);
  save();
};
const _cardQueue = cardQueue;
cardQueue = function(){ const d = dayNum(); return S.mcards.filter(m => !m.done && m.due <= d).map(m => m.id).concat(_cardQueue()); };
const _gradeCard = gradeCard;
gradeCard = function(tok, q){
  if (typeof tok === 'number') return _gradeCard(tok, q);
  const m = S.mcards.find(x => x.id === tok), k = today(), L = S.cardLog[k] = S.cardLog[k] || {n:0, ok:0, new:0};
  L.n++; if (q >= 2) L.ok++;
  if (q === 0) { m.reps = 0; m.due = dayNum() + 1; cardSession.queue.push(tok); }
  else { m.reps = Math.min(MSTEPS.length, m.reps + (q === 3 ? 2 : q === 1 ? 0 : 1) || 1); m.due = dayNum() + MSTEPS[m.reps - 1]; if (m.reps >= MSTEPS.length) m.done = true; }
  save(); cardSession.queue.shift(); cardSession.flipped = false; render();
};
const _vCards = vCards;
vCards = function(){
  const q = cardSession.queue;
  if (!q.length || typeof q[0] === 'number') {
    const h = _vCards(), open = S.mcards.filter(m => !m.done).length;
    return h.replace('<h1>Карточки</h1>', `<h1>Карточки</h1>${open ? `<p class="muted small">В цикле ошибок: ${open} карточек — они возвращаются через 1, 3, 7, 14 и 30 дней, пока ошибка не перестанет повторяться.</p>` : ''}`);
  }
  const m = S.mcards.find(x => x.id === q[0]), L = S.cardLog[today()] || {n:0};
  return `<h1>Карточки</h1><p class="muted">Осталось ${q.length} · повторено сегодня ${L.n}. Сначала вспомните ответ, затем переверните.</p>
  <div class="flash mist" onclick="cardSession.flipped=true;render()"><span class="tag err">Работа над ошибками · ${esc(m.cat)}</span><p class="pre big">${esc(m.front)}</p>
  ${cardSession.flipped ? `<hr><p class="pre">${esc(m.back)}</p>` : '<p class="muted">Нажмите, чтобы увидеть ответ</p>'}</div>
  ${cardSession.flipped ? `<div class="rate grades"><button class="btn bad" onclick="gradeCard('${m.id}',0)">Не помню</button><button class="btn ghost" onclick="gradeCard('${m.id}',1)">Трудно</button><button class="btn" onclick="gradeCard('${m.id}',2)">Помню</button><button class="btn ghost" onclick="gradeCard('${m.id}',3)">Легко</button></div>` : ''}`;
};

// ───────── 2. Генератор заданий ─────────
const GEN_KINDS = {case:'Кейс', sql:'SQL-задача', quiz:'Тест', inbox:'Рабочая ситуация'};
const GEN_CATS = ['Требования','Процессы','Моделирование','API','Интеграции','Коммуникации','Документация','Разбор инцидентов','Планирование','Качество и запуск'];
const textHtml = s => esc(s).replace(/\n/g, '<br>');
function registerGen(g){
  if (ITEMS[g.id]) return;
  if (g.kind === 'inbox') { INBOX.push(g); ITEMS[g.id] = {...g, cat: g.cat || 'Коммуникации'}; }
  else { const t = {...g, type: g.kind}; TASKS.push(t); ITEMS[g.id] = {...t, cat: g.kind === 'sql' ? 'SQL и данные' : g.cat}; }
}
S.gen.forEach(registerGen);
function validateGen(kind, x){
  if (kind === 'quiz') { if (x.questions?.length < 3 || x.questions.some(q => q.o?.length !== 4 || !(q.a >= 0 && q.a <= 3))) throw new Error('некорректный тест'); }
  if (kind === 'inbox') { if (x.steps?.length < 2 || x.steps.some(s => s.opts?.length < 2 || !s.opts.some(o => o.s === 2))) throw new Error('некорректная ситуация'); }
  if (kind === 'case') { if (!x.checklist?.length || x.checklist.length < 3) throw new Error('нет критериев'); }
  if (kind === 'sql') { const r = runSql(x.ref); if (!r.values.length) throw new Error('эталонный запрос вернул 0 строк'); }
}
let GEN = {busy:false, err:null};
async function genTask(kind, cat, level){
  if (kind === 'sql') { cat = 'SQL и данные'; await initSQL(); }
  const avoid = Object.values(ITEMS).filter(it => it.kind === kind).map(it => it.title);
  const schemaText = SQL_SCHEMA.replace(/INSERT INTO[\s\S]*?;/g, '').trim() + '\n-- статусы заказов: new, paid, cancelled; события: view, cart, checkout, paid';
  let x, lastErr;
  for (let i = 0; i < 2; i++) {
    try { x = await AI.generate(kind, cat, level, avoid, schemaText); validateGen(kind, x); lastErr = null; break; }
    catch (e) { lastErr = e; }
  }
  if (lastErr) throw lastErr;
  const g = {id: 'gen-' + Date.now().toString(36), kind, cat, level: +level, generated: true, title: '✨ ' + x.title};
  if (kind === 'case') Object.assign(g, {scenario: textHtml(x.scenario), task: x.task, hint: x.hint, reference: textHtml(x.reference), checklist: x.checklist});
  if (kind === 'sql') Object.assign(g, {scenario: x.scenario, task: x.task, hint: x.hint, ref: x.ref.trim().replace(/;$/, '')});
  if (kind === 'quiz') g.questions = x.questions;
  if (kind === 'inbox') Object.assign(g, {ctx: x.ctx, steps: x.steps.map(s => ({from: s.from, text: s.text, opts: s.opts.map(o => ({t: o.t, s: Math.max(0, Math.min(2, o.s)), fb: o.fb}))}))});
  S.gen.push(g); registerGen(g); save();
  return g.id;
}
function genCardHtml(){
  if (!AI.enabled) return `<div class="card note">✨ Подключите ИИ во вкладке «Настройки» — появится генератор новых заданий под ваш уровень и слабые направления.</div>`;
  const ul = GRADE_LEVEL[matrixGrade()] || 2, weakest = competencies().filter(c => GEN_CATS.includes(c.cat)).sort((a, b) => a.level - b.level)[0]?.cat;
  return `<div class="card"><h2>✨ Новое задание от ИИ</h2><p class="muted small">Генерируется под выбранные тему и сложность, с эталоном и критериями. SQL-задачи проверяются на реальной базе.</p>
  <div class="row"><select id="g-kind">${Object.entries(GEN_KINDS).map(([k, l]) => `<option value="${k}">${l}</option>`).join('')}</select>
  <select id="g-cat">${GEN_CATS.map(c => `<option ${c === weakest ? 'selected' : ''}>${c}</option>`).join('')}</select>
  <select id="g-level">${[1,2,3,4,5].map(l => `<option value="${l}" ${l === Math.min(5, ul) ? 'selected' : ''}>Сложность ${l}</option>`).join('')}</select>
  <button class="btn" onclick="genFromLibrary()" ${GEN.busy ? 'disabled' : ''}>${GEN.busy ? 'Генерирую…' : 'Сгенерировать'}</button></div>${GEN.err ? `<p class="err small">${esc(GEN.err)}</p>` : ''}</div>`;
}
async function genFromLibrary(){
  GEN = {busy:true}; const k = document.getElementById('g-kind').value, c = document.getElementById('g-cat').value, l = document.getElementById('g-level').value; render();
  try { const id = await genTask(k, c, l); GEN = {busy:false}; openTask(id); } catch (e) { GEN = {busy:false, err: 'Не удалось сгенерировать: ' + e.message}; render(); }
}
// Замена тикета дня на свежее сгенерированное задание
const SLOT_OF = p => id => Object.keys(p).find(s => p[s] === id);
async function regenTicket(id){
  const it = ITEMS[id], p = getPlan(), slot = SLOT_OF(p)(id);
  GEN = {busy:true, slot: id}; render();
  try {
    const nid = await genTask(it.kind, GEN_CATS.includes(it.cat) ? it.cat : 'Требования', Math.max(it.level || 2, GRADE_LEVEL[matrixGrade()] || 2));
    p[slot] = nid; if (slot === 'case') p.carried = false; save(); logEvent(`Задача заменена на новую: ${ITEMS[nid].title}`); GEN = {busy:false};
  } catch (e) { GEN = {busy:false, err: e.message}; }
  render();
}
const _phasePanel = phasePanel;
phasePanel = function(ph, p, D){
  let h = _phasePanel(ph, p, D);
  if (ph.key === 'tk' && !phaseDone(ph) && AI.enabled && GEN_KINDS[ITEMS[ph.id].kind]) {
    const ex = poolExhausted(ph.id);
    h += `<div class="card ${ex ? 'note' : ''}">${ex ? '<p>Похожие задания вы уже решили на ≥85%. ИИ может сделать новое под ваш уровень.</p>' : ''}
    <button class="btn ${ex ? '' : 'ghost'} sm" onclick="regenTicket('${ph.id}')" ${GEN.busy ? 'disabled' : ''}>${GEN.busy && GEN.slot === ph.id ? 'Генерирую…' : '✨ Заменить на новое задание'}</button>${GEN.err ? `<span class="err small"> ${esc(GEN.err)}</span>` : ''}</div>`;
  }
  return h;
};

// ───────── 4. ИИ-коуч недели ─────────
function coachData(wk){
  const days = Array.from({length: 7}, (_, i) => keyOfNum(dayNumOf(wk) + i)), set = new Set(days);
  const E = S.log.filter(e => set.has(e.day) && !['standup','eod'].includes(e.kind));
  return {
    week: `${days[0]} — ${days[6]}`, sprint: S.sprints[wk] || null,
    tasks: E.map(e => ({day: e.day, title: e.title, kind: KIND_LABEL[e.kind], cat: e.cat, score: Math.round(e.score * 100), mins: e.mins, missed: S.results[e.id]?.missed || [], review: S.aiReviews[e.id]?.verdict || null})),
    reports: days.filter(d => S.days[d]?.eod?.text).map(d => ({day: d, eod: S.days[d].eod.text.slice(0, 600)})),
    journal: days.filter(d => S.journal[d]).map(d => ({day: d, ...S.journal[d]})),
    focus: days.map(d => ({day: d, ...(S.focus[d] || {})})).filter(f => f.pomo || f.clean),
    competencies: competencies().map(c => ({cat: c.cat, level: Math.round(c.level * 100)}))
  };
}
function coachOffline(wk){
  const D = coachData(wk), cnt = {};
  D.tasks.forEach(t => t.missed.forEach(m => cnt[m] = (cnt[m] || 0) + 1));
  const rep = Object.entries(cnt).sort((a, b) => b[1] - a[1]).filter(x => x[1] >= 2).slice(0, 5);
  const weak = D.competencies.filter(c => c.level < 100).sort((a, b) => a.level - b.level).slice(0, 3);
  const avgS = D.tasks.length ? Math.round(D.tasks.reduce((a, t) => a + t.score, 0) / D.tasks.length) : 0;
  return {offline: true, summary: `За неделю выполнено ${D.tasks.length} заданий, средний балл ${avgS}%.`,
    wins: D.tasks.filter(t => t.score >= 85).slice(0, 5).map(t => `${t.title} — ${t.score}%`),
    patterns: rep.length ? rep.map(([m, n]) => `${m} — упущено ${n} раз`) : D.tasks.filter(t => t.score < 70).map(t => `Низкий балл: ${t.title} (${t.score}%)`),
    focus: weak.map(c => `${c.cat} — уровень ${c.level}%`), plan: ['Переделать задания с баллом ниже 70%', 'Пройти карточки из цикла ошибок', 'Сгенерировать 2 задания по самому слабому направлению']};
}
let COACHING = false;
async function runCoach(wk){
  COACHING = true; render();
  try { S.coach[wk] = AI.enabled ? await AI.weekCoach(coachData(wk)) : coachOffline(wk); S.coach[wk].at = Date.now(); save(); }
  catch (e) { toast('Ошибка ИИ: ' + e.message); }
  COACHING = false; render();
}
function coachHtml(wk){
  const c = S.coach[wk];
  const btn = `<button class="btn ${c ? 'ghost' : ''} sm" onclick="runCoach('${wk}')" ${COACHING ? 'disabled' : ''}>${COACHING ? 'Анализирую неделю…' : c ? 'Обновить разбор' : (AI.enabled ? '🧭 Разбор недели от ИИ-коуча' : '🧭 Разбор недели')}</button>`;
  if (!c) return `<div class="noprint">${btn}</div>`;
  const L = (t, a) => a?.length ? `<h3>${t}</h3><ul>${a.map(x => `<li>${esc(x)}</li>`).join('')}</ul>` : '';
  return `<div class="card aibox coach"><b>🧭 Разбор недели${c.offline ? ' (без ИИ)' : ' от ИИ-коуча'}</b><p>${esc(c.summary)}</p>${L('Получилось', c.wins)}${L('Повторяющиеся ошибки', c.patterns)}${L('Фокус на следующую неделю', c.focus)}${L('План', c.plan)}<div class="noprint">${btn}</div></div>`;
}
const coachMd = wk => { const c = S.coach[wk]; if (!c) return ''; const L = (t, a) => a?.length ? `\n**${t}:**\n${a.map(x => `- ${x}`).join('\n')}\n` : ''; return `\n## Разбор недели${c.offline ? '' : ' от ИИ-коуча'}\n\n${c.summary}\n${L('Получилось', c.wins)}${L('Повторяющиеся ошибки', c.patterns)}${L('Фокус', c.focus)}${L('План', c.plan)}`; };
const _retro = PANELS_X.retro;
PANELS_X.retro = (ph, p, D) => _retro(ph, p, D).replace('<label>Что получилось хорошо</label>', coachHtml(weekKey(today())) + '<label>Что получилось хорошо</label>');

// ───────── 6. Режим фокуса и помодоро ─────────
const FOC = {mode: 'work', left: 25 * 60, running: false};
const Fday = () => (S.focus[today()] = S.focus[today()] || {pomo: 0, clean: 0, distr: 0});
function focusWidget(){
  let w = document.getElementById('focusw');
  if (!w) { w = document.createElement('div'); w.id = 'focusw'; w.className = 'focusw noprint'; document.body.appendChild(w); }
  const F = Fday(), mm = `${Math.floor(FOC.left / 60)}:${pad(FOC.left % 60)}`;
  w.innerHTML = `<span class="fmode ${FOC.mode}">${FOC.mode === 'work' ? '🍅' : '☕'} ${mm}</span>
  <button onclick="toggleTimer()" title="${FOC.running ? 'Пауза' : 'Старт'}">${FOC.running ? '⏸' : '▶'}</button>
  <button onclick="resetTimer()" title="Сбросить">↺</button>
  <button onclick="toggleFocus()" class="${document.body.classList.contains('focus') ? 'on' : ''}" title="Режим фокуса: скрыть всё лишнее">🎯</button>
  <span class="small muted" title="Помидоров сегодня · чистое время">${F.pomo}🍅 · ${Math.round(F.clean / 60)} мин</span>`;
}
function toggleTimer(){
  FOC.running = !FOC.running;
  if (FOC.running && 'Notification' in window && Notification.permission === 'default') Notification.requestPermission().catch(() => {});
  focusWidget();
}
function resetTimer(){ FOC.running = false; FOC.mode = 'work'; FOC.left = 25 * 60; focusWidget(); }
function toggleFocus(){ document.body.classList.toggle('focus'); S.settings.focus = document.body.classList.contains('focus'); save(); focusWidget(); }
function notify(text){
  toast(text); document.title = '⏰ ' + text;
  setTimeout(() => document.title = 'Тренажёр аналитика', 8000);
  try { if (Notification.permission === 'granted') new Notification('Тренажёр аналитика', {body: text}); } catch (e) {}
}
setInterval(() => {
  const F = Fday();
  if (view === 'task' && document.visibilityState === 'visible' && document.hasFocus()) { F.clean++; if (F.clean % 30 === 0) save(); }
  if (FOC.running && --FOC.left <= 0) {
    if (FOC.mode === 'work') { F.pomo++; save(); logEvent(`Помидор №${F.pomo} завершён`); FOC.mode = 'break'; FOC.left = (F.pomo % 4 === 0 ? 15 : 5) * 60; notify(`Помидор завершён! Перерыв ${F.pomo % 4 === 0 ? 15 : 5} минут`); }
    else { FOC.mode = 'work'; FOC.left = 25 * 60; FOC.running = false; notify('Перерыв окончен — запускайте следующий помидор'); }
  }
  focusWidget();
}, 1000);
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden' && view === 'task') { Fday().distr++; save(); } });
if (S.settings.focus) document.body.classList.add('focus');
function focusTotals(days){ return days.reduce((a, d) => { const f = S.focus[d] || {}; a.pomo += f.pomo || 0; a.clean += f.clean || 0; a.distr += f.distr || 0; return a; }, {pomo: 0, clean: 0, distr: 0}); }

// Фокус и коуч в отчётах
const _drawReport2 = drawReport;
drawReport = function(){
  _drawReport2();
  const days = reportDays(), F = focusTotals(days), el = document.getElementById('report');
  const kpis = el.querySelector('.kpis');
  if (kpis) kpis.insertAdjacentHTML('beforeend', `<div class="kpi"><b>${Math.round(F.clean / 60)} мин</b><span>чистое время в задачах</span></div><div class="kpi"><b>${F.pomo} 🍅</b><span>помидоров · отвлечений ${F.distr}</span></div>`);
  if (repMode !== 'day') el.insertAdjacentHTML('beforeend', coachHtml(weekKey(days[days.length - 1])));
};
const _reportMd2 = reportMd;
reportMd = function(){
  const days = reportDays(), F = focusTotals(days);
  let md = _reportMd2().replace('## Итоги\n\n', `## Итоги\n\n- Чистое время в задачах: ${Math.round(F.clean / 60)} мин, помидоров: ${F.pomo}, отвлечений: ${F.distr}\n`);
  if (repMode !== 'day') md += coachMd(weekKey(days[days.length - 1]));
  const mc = S.mcards.filter(m => days.includes(m.created));
  if (mc.length) md += `\n## Новые карточки в цикле ошибок\n\n${mc.map(m => `- ${m.front.split('\n')[0]}`).join('\n')}\n`;
  return md;
};

// ───────── 7. Библиотека шаблонов ─────────
let tplOpen = null;
function vTemplates(){
  lastList = 'templates';
  const cats = [...new Set(TEMPLATES.map(t => t.cat))];
  return `<h1>Шаблоны артефактов</h1><p class="muted">Готовые структуры для реальной работы: копируйте в Confluence/Jira или вставляйте прямо в ответ задания (кнопка «Шаблон» над полем ответа).</p>
  <div class="tplgrid"><aside>${cats.map(c => `<h3>${esc(c)}</h3>${TEMPLATES.filter(t => t.cat === c).map(t => `<div class="link ${tplOpen === t.id ? 'on' : ''}" onclick="tplOpen='${t.id}';render()">${esc(t.title)}</div>`).join('')}`).join('')}</aside>
  <div>${(() => { const t = TEMPLATES.find(x => x.id === tplOpen) || TEMPLATES[0];
    return `<div class="card"><div class="row" style="justify-content:space-between"><h2>${esc(t.title)}</h2><div><button class="btn sm" onclick="navigator.clipboard.writeText(TEMPLATES.find(x=>x.id==='${t.id}').body).then(()=>toast('Скопировано'))">Копировать</button><button class="btn sm ghost" onclick="downloadFile('${t.id}.md', TEMPLATES.find(x=>x.id==='${t.id}').body)">Скачать .md</button></div></div><pre class="tpl">${esc(t.body)}</pre></div>`; })()}</div></div>`;
}
const tplPicker = id => `<div class="row small">Шаблон: <select onchange="if(this.value)insertTemplate('${id}',this.value)"><option value="">— вставить в ответ —</option>${TEMPLATES.map(t => `<option value="${t.id}">${esc(t.title)}</option>`).join('')}</select></div>`;
function insertTemplate(id, tid){ const t = TEMPLATES.find(x => x.id === tid); S.drafts[id] = (S.drafts[id] ? S.drafts[id] + '\n\n' : '') + t.body; save(); render(); toast('Шаблон вставлен'); }
TASK_VIEWS.case = it => tCase(it).replace('<h3>Ваше решение</h3>', '<h3>Ваше решение</h3>' + tplPicker(it.id));
TASK_VIEWS.stage = TASK_VIEWS.case;

// ───────── Настройки ИИ (Gemini / Claude) ─────────
let modelsState = '';
vSettings = function(){
  if (!AI.PROVIDERS) return `<h1>Настройки</h1><div class="card"><p class="err">Модуль ИИ не загрузился — проверьте интернет и обновите страницу.</p></div>`;
  const c = AI.cfg, P = AI.PROVIDERS[c.provider];
  const models = c.provider === 'gemini' ? (c.geminiModels || []).map(m => [m, m]) : AI.CLAUDE_MODELS;
  return `<h1>Настройки</h1>
  <div class="card"><h2>ИИ-наставник</h2>
  <p>ИИ включает ревью решений, интервью с заказчиком, пробное собеседование, разбор вакансий, генератор заданий и недельного коуча. Без ИИ всё остальное работает на самопроверке.</p>
  <label>Провайдер</label><select onchange="AI.setProvider(this.value);modelsState='';render()">${Object.entries(AI.PROVIDERS).map(([k, v]) => `<option value="${k}" ${c.provider === k ? 'selected' : ''}>${esc(v.name)}${c.keys[k] ? ' — ключ сохранён' : ''}</option>`).join('')}</select>
  ${c.provider === 'gemini' ? `<ul class="small"><li>Бесплатный ключ: <b>aistudio.google.com</b> → Get API key. Подойдёт и ключ из вашего проекта — вставьте его сюда сами.</li><li>У бесплатного тарифа есть лимиты запросов в минуту и в день. Если упрётесь — подождите или выберите другую модель.</li><li>На бесплатном тарифе Google может использовать запросы для улучшения своих продуктов: не вставляйте в ответы персональные и коммерческие данные.</li></ul>`
  : `<ul class="small"><li>Ключ: <b>platform.claude.com</b> → API Keys. Оплата по факту, отдельно от подписки.</li></ul>`}
  <ul class="small"><li>Ключ хранится <b>только в этом браузере</b>, не попадает в резервные копии и репозиторий.</li></ul>
  <label>Ключ API ${c.hasKey ? '<span class="good">— сохранён</span>' : ''}</label><input id="aikey" type="password" autocomplete="off" placeholder="${c.hasKey ? '•••••••• (введите новый, чтобы заменить)' : P.keyHint}">
  <div class="row"><button class="btn" onclick="saveAI()">Сохранить ключ</button>${c.hasKey ? `<button class="btn ghost" onclick="pingAI()">Проверить подключение</button><button class="btn ghost" onclick="AI.clearKey();render()">Удалить ключ</button>` : ''}</div><p class="small">${pingState}</p>
  ${c.hasKey ? `<label>Модель</label><div class="row"><select onchange="AI.setModel(this.value);render()">${models.length ? models.map(([v, l]) => `<option value="${v}" ${c.model === v ? 'selected' : ''}>${esc(l)}</option>`).join('') : `<option>${esc(c.model || 'выберется автоматически')}</option>`}</select>
  ${c.provider === 'gemini' ? `<button class="btn ghost sm" onclick="loadModels()">Обновить список моделей</button>` : ''}</div><p class="small muted">${modelsState || (c.provider === 'gemini' ? 'Если у модели закончится бесплатная квота, тренажёр сам переключится на следующую доступную и запомнит её.' : '')}</p>
  <label>Глубина размышлений модели</label><select onchange="AI.setEffort(this.value)">${[['low','Быстро'],['medium','Стандартно'],['high','Тщательно (медленнее' + (c.provider === 'anthropic' ? ', дороже' : '') + ')']].map(([v, l]) => `<option value="${v}" ${c.effort === v ? 'selected' : ''}>${l}</option>`).join('')}</select>` : ''}
  </div>
  <div class="card"><h2>Данные</h2><p class="muted small">Прогресс хранится в этом браузере. На другом устройстве или адресе прогресс свой — переносите резервной копией.</p>
  <div class="row"><button class="btn ghost" onclick="downloadFile('sa-trainer-backup-${today()}.json', JSON.stringify(S))">Экспорт резервной копии</button><label class="btn ghost">Импорт<input type="file" accept=".json" hidden onchange="importBackup(this.files[0])"></label></div></div>`;
};
saveAI = async function(){
  const k = document.getElementById('aikey').value.trim(); if (!k) { toast('Вставьте ключ'); return; }
  AI.setKey(k); toast('Ключ сохранён'); render();
  if (AI.cfg.provider === 'gemini') loadModels();
};
async function loadModels(){ modelsState = '⏳ Загружаю список моделей…'; render(); try { const m = await AI.loadGeminiModels(); modelsState = `Доступно моделей: ${m.length}. Выбрана: ${AI.cfg.model}`; } catch (e) { modelsState = `<span class="err">${esc(e.message)}</span>`; } render(); }

// ───────── Подключение экранов ─────────
Object.assign(VIEWS, {
  templates: () => vTemplates(),
  library: () => vLibrary().replace('<h1>Библиотека заданий</h1>', '<h1>Библиотека заданий</h1>' + genCardHtml())
});
render();
