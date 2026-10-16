// «Обучение»: курс с нуля — модули, уроки, мини-проверки, практика и ИИ-помощь по уроку.

S.learn = S.learn || {done: {}, ans: {}, ai: {}};
['done', 'ans', 'ai'].forEach(k => S.learn[k] = S.learn[k] || {});
SERVICE_KINDS.push('lesson');
Object.assign(KIND_LABEL, {lesson: 'Урок'});
Object.assign(XP_TABLE, {lesson: () => 15});

const LESSON_LIST = COURSE.flatMap(m => m.lessons.map(l => ({...l, module: m})));
const lessonById = id => LESSON_LIST.find(l => l.id === id);
const nextLesson = () => LESSON_LIST.find(l => !S.learn.done[l.id]);
const LBUSY = {};
let curLesson = null, lessonChecked = {};

function openLesson(id){
  curLesson = id; S.learn.last = id; save();
  timers['lesson@' + id] = timers['lesson@' + id] || Date.now();
  go('lesson');
}

function vLearn(){
  lastList = 'learn';
  const total = LESSON_LIST.length, done = LESSON_LIST.filter(l => S.learn.done[l.id]).length, nx = nextLesson();
  const mins = LESSON_LIST.filter(l => !S.learn.done[l.id]).reduce((a, l) => a + l.mins, 0);
  return `<h1>Обучение</h1>
  <div class="card hero2"><div><h2>Системный аналитик с нуля</h2><p class="muted">${COURSE.length} модулей, ${total} уроков. Каждый урок — 8–15 минут: теория простым языком, примеры, мини-проверка и ссылки на практику. Уроки можно проходить в любом порядке, но лучше по порядку.</p>
  <div class="bar"><i style="width:${Math.round(done / total * 100)}%"></i></div><p class="small muted">Пройдено ${done} из ${total}${mins ? ` · осталось ~${Math.round(mins / 60 * 10) / 10} ч` : ''}</p>
  ${nx ? `<button class="btn" onclick="openLesson('${nx.id}')">${done ? 'Продолжить' : 'Начать'}: ${esc(nx.title)} →</button>` : '<p class="good">🎉 Курс пройден! Закрепляйте знания в рабочем дне и проектах.</p>'}</div></div>
  ${COURSE.map((m, mi) => { const md = m.lessons.filter(l => S.learn.done[l.id]).length;
    return `<div class="card module"><div class="row" style="justify-content:space-between"><h2>${m.icon} ${mi + 1}. ${esc(m.title)}</h2><span class="small muted">${md}/${m.lessons.length}</span></div>
    <div class="bar thin"><i style="width:${md / m.lessons.length * 100}%"></i></div>
    ${m.lessons.map((l, li) => `<div class="lrow ${S.learn.done[l.id] ? 'ok' : ''}" onclick="openLesson('${l.id}')"><span class="num sm">${S.learn.done[l.id] ? '✓' : li + 1}</span><span class="lt">${esc(l.title)}</span><span class="small muted">${l.mins} мин</span></div>`).join('')}</div>`; }).join('')}`;
}

function vLesson(){
  const l = lessonById(curLesson); if (!l) return vLearn();
  lastList = 'lesson';
  const i = LESSON_LIST.indexOf(l), prev = LESSON_LIST[i - 1], next = LESSON_LIST[i + 1];
  const A = S.learn.ai[l.id] || {chat: []}, busy = LBUSY[l.id], ans = S.learn.ans[l.id] || {}, checked = lessonChecked[l.id] ?? !!S.learn.done[l.id];
  const correct = l.check.filter((q, qi) => ans[qi] === q.a).length;
  const ai = AI.enabled;
  const btn = (mode, label) => `<button class="btn sm ghost" onclick="lessonAI('${l.id}','${mode}')" ${busy ? 'disabled' : ''}>${busy === mode ? '⏳ Думаю… (до минуты)' : label}</button>`;
  return `<button class="back" onclick="go('learn')">← Все уроки</button>
  <div class="tags"><span class="tag">${l.module.icon} ${esc(l.module.title)}</span><span class="tag">урок ${i + 1} из ${LESSON_LIST.length}</span><span class="tag">~${l.mins} мин</span>${S.learn.done[l.id] ? '<span class="tag ok">пройден</span>' : ''}</div>
  <h1>${esc(l.title)}</h1>
  <div class="card lesson">${mdLite(l.body)}</div>
  <div class="card"><h3>🤖 Не до конца понятно?</h3>
  ${ai ? `<div class="row">${btn('simpler', '🤔 Объясни проще')}${btn('example', '🧪 Ещё пример')}</div>` : `<p class="small muted">Подключите бесплатный ИИ во вкладке «Настройки» — наставник объяснит тему проще, даст ещё пример и ответит на вопросы.</p>`}
  ${LBUSY.err?.[l.id] ? `<p class="err small">${esc(LBUSY.err[l.id])}</p>` : ''}
  ${A.simpler ? `<div class="tut"><h3>🤔 Проще</h3>${mdLite(A.simpler)}</div>` : ''}
  ${A.example ? `<div class="tut"><h3>🧪 Пример</h3>${mdLite(A.example)}</div>` : ''}
  ${ai ? `<div class="tutchat">${A.chat.map(m => `<div class="bubble ${m.who}">${m.who === 'me' ? esc(m.text) : mdLite(m.text)}</div>`).join('')}
  <div class="row"><input id="tutq" class="tutq" placeholder="Вопрос по уроку, например: а чем 401 отличается от 403?" onkeydown="if(event.key==='Enter')lessonAI('${l.id}','ask')"><button class="btn sm" onclick="lessonAI('${l.id}','ask')" ${busy ? 'disabled' : ''}>${busy === 'ask' ? '⏳' : 'Спросить'}</button></div></div>` : ''}</div>
  <div class="card"><h3>✅ Проверь себя</h3>
  ${l.check.map((q, qi) => { const order = shuffleIdx(q.o.length, l.id + qi);
    return `<div class="asq"><b>${qi + 1}. ${esc(q.q)}</b>${order.map(oi => { let cls = ''; if (checked) { if (oi === q.a) cls = 'right'; else if (ans[qi] === oi) cls = 'wrong'; }
      return `<label class="opt ${cls}"><input type="radio" name="lq${qi}" ${ans[qi] === oi ? 'checked' : ''} ${checked ? 'disabled' : ''} onchange="(S.learn.ans['${l.id}']=S.learn.ans['${l.id}']||{})[${qi}]=${oi};save()"> ${esc(q.o[oi])}</label>`; }).join('')}
    ${checked ? `<p class="small muted">💡 ${esc(q.e)}</p>` : ''}</div>`; }).join('')}
  ${checked ? `<p class="${correct === l.check.length ? 'good' : correct >= l.check.length - 1 ? '' : 'err'}"><b>${correct} из ${l.check.length}</b> ${S.learn.done[l.id] ? '— урок засчитан.' : '— перечитайте урок и попробуйте ещё раз.'}</p>
    ${!S.learn.done[l.id] || correct < l.check.length ? `<button class="btn ghost sm" onclick="retryLesson('${l.id}')">Пройти проверку заново</button>` : ''}`
  : `<button class="btn" onclick="checkLesson('${l.id}')">Проверить</button>`}</div>
  ${l.practice.length ? `<div class="card"><h3>🛠 Практика по теме</h3><p class="small muted">Закрепите урок на задании — наставник в задании поможет, если застрянете.</p>${l.practice.filter(id => ITEMS[id]).map(id => `<div class="lrow" onclick="openTask('${id}')"><span class="tag k-${ITEMS[id].kind}">${KIND_LABEL[ITEMS[id].kind]}</span><span class="lt">${esc(ITEMS[id].title)}</span><span class="small muted">${S.results[id] ? Math.round(S.results[id].score * 100) + '%' : 'не пройдено'}</span></div>`).join('')}</div>` : ''}
  <div class="row" style="justify-content:space-between">${prev ? `<button class="btn ghost" onclick="openLesson('${prev.id}')">← ${esc(prev.title)}</button>` : '<span></span>'}${next ? `<button class="btn" onclick="openLesson('${next.id}')">${esc(next.title)} →</button>` : `<button class="btn" onclick="go('learn')">К списку уроков</button>`}</div>`;
}

function checkLesson(id){
  const l = lessonById(id), ans = S.learn.ans[id] || {};
  if (Object.keys(ans).length < l.check.length) { toast('Ответьте на все вопросы'); return; }
  lessonChecked[id] = true;
  const correct = l.check.filter((q, qi) => ans[qi] === q.a).length;
  l.check.forEach((q, qi) => { if (ans[qi] !== q.a) addMistakeCard(`${id}:${qi}`, q.q + '\n\n' + q.o.map((o, i) => `${'АБВГ'[i]}) ${o}`).join('\n'), `Правильно: ${q.o[q.a]}\n\n${q.e}`, l.module.cat); });
  if (correct >= l.check.length - 1 && !S.learn.done[id]) {
    S.learn.done[id] = today();
    const pid = 'lesson@' + id; ensurePseudo(pid, 'lesson', 'Урок: ' + l.title); ITEMS[pid].cat = l.module.cat;
    complete(pid, correct / l.check.length);
    logEvent(`Пройден урок «${l.title}»`);
  }
  save(); render();
}
function retryLesson(id){ delete S.learn.ans[id]; lessonChecked[id] = false; save(); render(); }

async function lessonAI(id, mode){
  const l = lessonById(id), A = (S.learn.ai[id] = S.learn.ai[id] || {chat: []});
  const opts = {};
  if (mode === 'ask') { const q = document.getElementById('tutq')?.value.trim(); if (!q) return; A.chat.push({who: 'me', text: q}); opts.history = A.chat; }
  LBUSY[id] = mode; LBUSY.err = LBUSY.err || {}; LBUSY.err[id] = null; render();
  try {
    const r = await AI.tutor({title: 'Урок: ' + l.title, kind: 'урок курса', cat: l.module.title, scenario: l.body.slice(0, 4000), task: 'Изучить и понять тему урока'}, mode, opts);
    if (mode === 'ask') A.chat.push({who: 'them', text: r.text}); else A[mode] = r.text;
  } catch (e) { LBUSY.err[id] = e.message; if (mode === 'ask') A.chat.pop(); }
  LBUSY[id] = null; save(); render();
}

// Баннер «урок дня» на главном экране
function learnBanner(){
  const nx = nextLesson(); if (!nx) return '';
  const done = Object.keys(S.learn.done).length, today_ = Object.values(S.learn.done).filter(d => d === today()).length;
  return `<div class="card note row" style="justify-content:space-between"><span>📚 ${today_ ? `Сегодня пройдено уроков: ${today_}. Следующий` : done ? 'Урок дня' : 'Новичок? Начните с курса'}: <b>${esc(nx.title)}</b> (~${nx.mins} мин)</span><button class="btn sm" onclick="openLesson('${nx.id}')">Открыть урок</button></div>`;
}
const _today5 = VIEWS.today;
Object.assign(VIEWS, {learn: () => vLearn(), lesson: () => vLesson(), today: () => learnBanner() + _today5()});
render();
