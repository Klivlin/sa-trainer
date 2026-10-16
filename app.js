// ───────── Утилиты и состояние ─────────
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const KEY = 'sa-trainer-v1';
const pad = n => String(n).padStart(2, '0');
const dayKey = (dt = new Date()) => `${dt.getFullYear()}-${pad(dt.getMonth()+1)}-${pad(dt.getDate())}`;
const today = () => dayKey();
const dayNumOf = k => { const [y,m,d] = k.split('-').map(Number); return Math.floor(Date.UTC(y,m-1,d)/864e5); };
const dayNum = () => dayNumOf(today());
const keyOfNum = n => { const d = new Date(n*864e5); return `${d.getUTCFullYear()}-${pad(d.getUTCMonth()+1)}-${pad(d.getUTCDate())}`; };
const fmtDay = k => { const [y,m,d] = k.split('-').map(Number); return new Date(y,m-1,d).toLocaleDateString('ru-RU',{weekday:'long',day:'numeric',month:'long',year:'numeric'}); };

const def = () => ({results:{}, drafts:{}, checks:{}, cards:{}, cardLog:{}, log:[], journal:{}, mistakes:{}, plans:{}, days:{}, settings:{newCards:6, learn:true}, sprints:{}, elicitRun:{}, aiReviews:{}, vacancies:{}, assess:[], mocks:[], interrupts:[], mcards:[], gen:[], coach:{}, focus:{}, tutor:{}});
let S = (() => { try { const s = JSON.parse(localStorage.getItem(KEY)); if (s) return Object.assign(def(), s); } catch(e){} return def(); })();
function save(){ try { localStorage.setItem(KEY, JSON.stringify(S)); } catch(e){} }

// ───────── Реестр всех заданий ─────────
const STAGE_CAT = {p1:'Планирование',p2:'Коммуникации',p3:'Требования',p4:'Процессы',p5:'Требования',p6:'Моделирование',p7:'Интеграции',p8:'API',p9:'Требования',p10:'Качество и запуск'};
const KIND_LABEL = {sql:'SQL', case:'Кейс', quiz:'Тест', inbox:'Рабочая ситуация', stage:'Проект', interview:'Собеседование', cards:'Карточки', journal:'Рефлексия', standup:'Стендап', eod:'Отчёт руководителю'};
const ITEMS = {};
TASKS.forEach(t => ITEMS[t.id] = {...t, kind:t.type, cat: t.type==='sql' ? 'SQL и данные' : t.cat});
INBOX.forEach(t => ITEMS[t.id] = {...t, kind:'inbox', cat:'Коммуникации', level:2});
PROJECT.stages.forEach((t,i) => ITEMS[t.id] = {...t, kind:'stage', cat:STAGE_CAT[t.id], level:3, n:i+1});
INTERVIEW.forEach((q,i) => ITEMS['iv-'+i] = {id:'iv-'+i, kind:'interview', cat:'Собеседование', title:q[0], answer:q[1], level:2});
const XP_TABLE = {sql:it=>20+10*it.level, case:it=>40+10*it.level, quiz:it=>10*(it.questions?.length||4), inbox:()=>30, stage:()=>80, interview:()=>15, standup:()=>20, eod:()=>30};
const XPMAX = it => (XP_TABLE[it.kind] || (()=>10))(it);
const EST = {sql:10, case:25, quiz:5, inbox:10, stage:30, interview:7, cards:10, journal:5, diagram:20, openapi:25, elicit:20};

const timers = {};
function startTimer(id){ if (!timers[id]) timers[id] = Date.now(); }
function timerMins(id){ const t = timers[id]; delete timers[id]; return t ? Math.min(180, Math.max(1, Math.round((Date.now()-t)/60000))) : 1; }

function complete(id, score, extra = {}){
  const it = ITEMS[id], prev = S.results[id];
  const xp = Math.round(XPMAX(it) * score);
  const gained = Math.max(0, xp - (prev?.xp || 0));
  S.results[id] = {score: Math.max(score, prev?.score || 0), lastScore: score, xp: Math.max(xp, prev?.xp || 0), date: today(), attempts: (prev?.attempts || 0) + 1, ...extra};
  S.log.push({ts: Date.now(), day: today(), id, kind: it.kind, title: it.title, cat: it.cat, score, xp: gained, mins: timerMins(id)});
  const t = S.plans[today()] && ticketOf(id);
  if (t) logEvent(`${t.key} «${t.title}» закрыта: ${Math.round(score*100)}%`);
  save();
  toast(`Засчитано: ${Math.round(score*100)}% · +${gained} XP`);
}

// ───────── XP, уровни, серия ─────────
function totalXP(){ return Object.values(S.results).reduce((a,r)=>a+(r.xp||0),0) + Object.values(S.cardLog).reduce((a,c)=>a+(c.n||0)*2,0); }
const GRADES = [[0,'Стажёр'],[400,'Junior'],[1200,'Junior+'],[2400,'Middle'],[3800,'Middle+'],[5500,'Senior']];
function grade(xp){ let g = GRADES[0], next = null; for (let i=0;i<GRADES.length;i++){ if (xp >= GRADES[i][0]) { g = GRADES[i]; next = GRADES[i+1]||null; } } return {name:g[1], from:g[0], next}; }
function activeDays(){ const s = new Set(S.log.map(e=>e.day)); Object.entries(S.cardLog).forEach(([k,v])=>{ if (v.n) s.add(k); }); Object.keys(S.journal).forEach(k=>s.add(k)); return s; }
function streak(){ const s = activeDays(); let n = dayNum(); if (!s.has(keyOfNum(n))) n--; let c = 0; while (s.has(keyOfNum(n))) { c++; n--; } return c; }

// ───────── Карточки (интервальные повторения) ─────────
function cardQueue(){
  const d = dayNum(), due = [], fresh = [];
  const introduced = S.cardLog[today()]?.new || 0;
  CARDS.forEach((c,i) => { const st = S.cards[i]; if (st) { if (st.due <= d) due.push(i); } else fresh.push(i); });
  return due.concat(fresh.slice(0, Math.max(0, S.settings.newCards - introduced)));
}
let cardSession = null;
function gradeCard(i, q){
  const d = dayNum(), k = today();
  const L = S.cardLog[k] = S.cardLog[k] || {n:0, ok:0, new:0};
  let c = S.cards[i];
  if (!c) { c = {ef:2.5, int:0, reps:0}; L.new++; }
  L.n++; if (q >= 2) L.ok++;
  if (q === 0) { c.reps = 0; c.int = 0; c.due = d; cardSession.queue.push(i); }
  else {
    c.reps++;
    c.int = c.reps === 1 ? (q===3?3:1) : c.reps === 2 ? (q===1?2:4) : Math.max(1, Math.round(c.int * c.ef * (q===1?0.6:q===3?1.3:1)));
    c.ef = Math.max(1.3, c.ef + (q===1?-0.15:q===3?0.1:0));
    c.due = d + c.int;
  }
  S.cards[i] = c; save();
  cardSession.queue.shift(); cardSession.flipped = false;
  render();
}

// ───────── Дневной план ─────────
const isDoneToday = id => S.log.some(e => e.day === today() && e.id === id);
function pickNext(list, offset){
  const n = list.length;
  for (let k=0;k<n;k++){ const t = list[(offset+k)%n]; if (!S.results[t.id]) return t.id; }
  // всё пройдено — берём задание с самым низким баллом
  return list.slice().sort((a,b)=>(S.results[a.id].score-S.results[b.id].score) || (S.results[a.id].date<S.results[b.id].date?-1:1))[0].id;
}
// Тикет, не закрытый (или закрытый ниже 70%) вчера, возвращается на доработку
function carriedTicket(){
  const prev = Object.keys(S.plans).filter(k => k < today()).sort().pop();
  if (!prev) return null;
  const id = S.plans[prev].case;
  return id && (S.results[id]?.score || 0) < 0.7 ? id : null;
}
function getPlan(k = today()){
  if (S.plans[k] || k !== today()) return S.plans[k];
  const d = dayNum();
  const sqls = TASKS.filter(t=>t.type==='sql'), cases = TASKS.filter(t=>t.type==='case'), quizzes = TASKS.filter(t=>t.type==='quiz');
  const inb = INBOX.map(t=>({id:t.id}));
  const carried = carriedTicket();
  const work = [cases, DIAGRAMS, OPENAPI][d % 3];
  const caseId = carried || pickNext(work, d);
  const stage = PROJECT.stages.find(s=>!S.results[s.id]);
  const meet = stage ? stage.id : pickNext(cases.filter(c=>c.id!==caseId), d+1);
  const wd = new Date().getDay();
  const plan = {sql: pickNext(sqls, d), inbox: pickNext(inb, d), case: caseId, carried: !!carried, meet, quiz: d % 2 ? pickNext(ELICIT, d) : pickNext(quizzes, d), planning: wd === 1 || !S.sprints?.[weekKey(today())], retro: wd === 5};
  S.plans[k] = plan; save();
  return plan;
}
const ticketIds = p => [p.sql, p.inbox, p.case, p.meet, p.quiz];
const Dget = (k = today()) => (S.days[k] = S.days[k] || {ev:[], post:{}});
function logEvent(what){ Dget().ev.push({ts: Date.now(), what}); save(); }
const hm = ts => new Date(ts).toLocaleTimeString('ru-RU',{hour:'2-digit',minute:'2-digit'});

// ───────── Распорядок рабочего дня ─────────
const weekKey = k => { const n = dayNumOf(k); const wd = (new Date(n*864e5).getUTCDay()+6)%7; return keyOfNum(n-wd); };
const PEOPLE = {lead:'Ирина Соколова · руководитель отдела аналитики', po:'Дмитрий Орлов · Product Owner', tech:'Максим Белов · техлид', qa:'Ольга Ким · QA-лид'};
const WHO_BY_CAT = {'Требования':'po','Процессы':'lead','Моделирование':'tech','API':'tech','Интеграции':'tech','Разбор инцидентов':'tech','Коммуникации':'lead','Планирование':'lead'};
function phases(p){
  return [
    {t:'09:00', key:'arrive', title:'Начало рабочего дня'},
    {t:'09:10', key:'cards', title:'Кофе и разминка: повторение теории'},
    {t:'09:30', key:'standup', title:'Ежедневный стендап команды'},
    ...(p.planning ? [{t:'09:45', key:'planning', title:'Планирование спринта'}] : []),
    {t:'10:00', key:'tk', id:p.sql},
    {t:'11:15', key:'tk', id:p.inbox},
    {t:'11:45', key:'tk', id:p.case},
    {t:'13:00', key:'lunch', title:'Обед'},
    {t:'14:00', key:'tk', id:p.meet},
    {t:'16:30', key:'tk', id:p.quiz},
    ...(p.retro ? [{t:'17:00', key:'retro', title:'Демо и ретроспектива спринта'}] : []),
    {t:'17:30', key:'eod', title:'Отчёт руководителю за день'},
    {t:'18:00', key:'end', title:'Завершение рабочего дня'}
  ];
}
function phaseDone(ph, k = today()){
  const D = S.days[k] || {};
  switch (ph.key) {
    case 'arrive': return !!D.started;
    case 'cards': return !!D.cardsDone;
    case 'standup': return !!D.standup?.done;
    case 'lunch': return !!D.lunchDone;
    case 'eod': return !!D.eod?.done;
    case 'end': return !!D.ended;
    case 'planning': return !!S.sprints?.[weekKey(k)];
    case 'retro': return !!S.sprints?.[weekKey(k)]?.retro;
    default: return !!D.post?.[ph.id] || S.log.some(e => e.day === k && e.id === ph.id);
  }
}
function ticketOf(id, k = today()){
  const p = S.plans[k]; if (!p) return null;
  const i = ticketIds(p).indexOf(id); if (i < 0) return null;
  const it = ITEMS[id], key = 'SA-' + (100 + (dayNumOf(k)*5) % 800 + i);
  const who = {sql:PEOPLE.po, inbox:'Рабочий чат команды', case:PEOPLE[WHO_BY_CAT[it.cat]||'lead'], diagram:PEOPLE.tech, openapi:PEOPLE.tech, stage:PEOPLE.lead, quiz:PEOPLE.lead, elicit:PEOPLE.po}[it.kind];
  const carried = p.carried && id === p.case;
  const intro = {
    sql: `Привет! ${it.scenario} Сможешь вытащить данные до 12:00? Пришли SQL-запрос, результат вставлю в презентацию.`,
    inbox: 'Пока вы работаете, в рабочем чате появились сообщения. Реагируйте так, как поступили бы в реальной команде.',
    case: (carried ? 'Возвращаю на доработку со вчера — посмотри замечания ревью. ' : '') + 'Возьми, пожалуйста, в работу. Нужен результат к 16:00, посмотрю и дам обратную связь.',
    stage: `В 14:00 встреча по проекту «Клиника» с заказчиком. Подготовь материалы этапа «${it.title}», будем их обсуждать.`,
    quiz: 'Плановая проверка знаний для всей команды — 5 минут, без подсказок и поисковика.',
    diagram: 'Нужна диаграмма для обсуждения с командой — нарисуй в Mermaid, вставим в Confluence.',
    openapi: 'Фронтенд ждёт контракт. Подготовь, пожалуйста, спецификацию в OpenAPI — по ней сгенерируем клиент.',
    elicit: 'В 16:30 у тебя интервью с заказчиком. Выясни реальные потребности, ограничения и критерии успеха — у тебя 15–20 вопросов.'
  }[it.kind];
  return {key, who, intro, carried, prio:['High','Medium','High','Highest','Low'][i], due:['12:00','11:45','16:00','14:00','17:30'][i], title: it.kind==='stage' ? `Проект «Клиника»: ${it.title}` : it.title};
}
// Комментарий ревьюера к закрытому тикету
function reviewOf(id, k = today()){
  const e = S.log.filter(x => x.day === k && x.id === id).pop(); if (!e) return null;
  const it = ITEMS[id], missed = S.results[id]?.missed || [];
  if (it.kind === 'inbox') return {ok: e.score >= 0.7, text: e.score >= 0.85 ? 'Ситуацию отработал грамотно.' : 'Есть что улучшить в коммуникации — посмотри разбор в задаче.'};
  if (it.kind === 'quiz') return {ok: e.score >= 0.7, text: `Результат проверки: ${pct(e.score)}.${e.score < 1 ? ' Ошибки попали в «Работу над ошибками».' : ''}`};
  if (it.kind === 'sql') return {ok: true, text: e.score >= 0.85 ? 'Данные корректные, спасибо!' : 'Данные получил. В следующий раз сначала проверь запрос на выборке, чтобы не было нескольких итераций.'};
  const slow = e.mins > (EST[it.kind]||20)*2 ? ` Заняло ${e.mins} мин при норме ~${EST[it.kind]||20} — обрати внимание на скорость.` : '';
  if (it.kind === 'elicit') return {ok: e.score >= 0.7, text: (e.score >= 0.7 ? 'Хорошее интервью.' : 'Важное осталось невыясненным — смотри разбор.') + slow};
  if (e.score >= 0.85) return {ok:true, text:'✅ Принято. Хорошая, полная проработка.' + slow};
  if (e.score >= 0.7) return {ok:true, text:'Принято с замечаниями: ' + missed.join('; ') + '.' + slow};
  return {ok:false, text:'↩ Возвращено на доработку. Не хватает: ' + missed.join('; ') + '.' + (it.kind==='case' ? ' Задача перенесётся на завтра.' : '')};
}
function mgrFeedback(k){
  const p = S.plans[k], D = S.days[k];
  if (!p || !D?.eod?.done) return '';
  const ids = ticketIds(p), done = ids.filter(id => S.log.some(e => e.day === k && e.id === id));
  const scores = done.map(id => S.log.filter(e => e.day === k && e.id === id).pop().score);
  const avg = scores.length ? scores.reduce((a,b)=>a+b,0)/scores.length : 0;
  const L = [`Спасибо за отчёт! Закрыто задач: ${done.length} из ${ids.length}.`];
  L.push(avg >= 0.85 ? 'Качество работы высокое — так держать.' : avg >= 0.7 ? 'В целом хорошо, но обрати внимание на замечания в задачах.' : done.length ? 'Качество пока ниже ожидаемого — разберём замечания, часть задач вернётся на доработку.' : 'Сегодня почти ничего не закрыто — давай завтра обсудим, что мешает.');
  const post = ids.filter(id => D.post?.[id]);
  if (post.length || done.length < ids.length) L.push('Незакрытые и отложенные задачи — в приоритет на завтра.');
  if (D.eod.missed?.length) L.push('По самому отчёту: не хватило — ' + D.eod.missed.join('; ').toLowerCase() + '.');
  if (!D.standup?.done) L.push('И не пропускай стендап — команде важно знать твои планы.');
  return L.join(' ');
}

// ───────── Навигация ─────────
let view = 'today', current = null, revealed = {}, quizAns = {}, inboxRun = {}, filter = 'all';
function go(v, id){ view = v; current = id || null; if (id) startTimer(id); if (v === 'cards' && !cardSession) cardSession = {queue: cardQueue(), flipped:false}; if (v !== 'cards') cardSession = null; render(); window.scrollTo(0,0); }
function openTask(id){ go('task', id); }
function toast(msg){ const t = document.getElementById('toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(t._h); t._h = setTimeout(()=>t.classList.remove('show'), 2600); }

function render(){
  const xp = totalXP(), g = grade(xp);
  document.getElementById('chips').innerHTML =
    `<span class="chip" title="Дней подряд">🔥 ${streak()}</span><span class="chip">${xp} XP</span><span class="chip grade">${g.name}</span>`;
  document.querySelectorAll('nav button').forEach(b => b.classList.toggle('on', b.dataset.v === view || (view==='task' && b.dataset.v==='today' && false)));
  const m = document.getElementById('main');
  try {
    m.innerHTML = VIEWS[view]();
    if (view === 'reports') drawReport();
    AFTER_RENDER.forEach(f => f());
  } catch (e) {
    console.error(e);
    m.innerHTML = `<div class="card"><h2>Не удалось показать экран</h2><p class="err small">${esc(e.message)}</p><p class="muted small">Обновите страницу с очисткой кэша (Ctrl+Shift+R / Cmd+Shift+R). Если ошибка повторяется — пришлите этот текст.</p><button class="btn" onclick="go('today')">На главную</button></div>`;
  }
}

// ───────── Экран «Рабочий день» ─────────
const STANDUP_CHECK = ['Что сделано вчера — конкретно, с результатом','Что делаю сегодня — со ссылками на задачи (SA-…)','Блокеры или явное «блокеров нет»','Кратко: укладывается в 1 минуту'];
const EOD_CHECK = ['Статус по каждой задаче дня (сделано / в работе / отложено)','Результаты, а не только действия (что получено, где лежит)','Что не сделано и почему','Риски, блокеры, вопросы к руководителю','План на завтра'];
function vDay(){
  lastList = 'today';
  const k = today(), p = getPlan(), D = Dget(), ph = phases(p);
  const cur = ph.find(x => !phaseDone(x)) || ph[ph.length-1];
  const done = ph.filter(x => phaseDone(x)).length;
  const label = x => x.key === 'tk' ? (ticketOf(x.id)?.key + ' · ' + ticketOf(x.id).title) : x.title;
  const icon = x => ({arrive:'🏢', cards:'☕', standup:'🗣', planning:'🎯', retro:'🔁', lunch:'🍽', eod:'📝', end:'🏁'}[x.key] || ({sql:'🗄', inbox:'💬', case:'📋', stage:'🤝', quiz:'🎓', diagram:'📈', openapi:'🔌', elicit:'🎙'}[ITEMS[x.id].kind]));
  return `
  <section class="hero">
    <div><div class="muted">${esc(fmtDay(k))}</div><h1>Рабочий день · ${cur.t}</h1>
    <p class="muted">${D.started ? `Вы на работе с ${hm(D.started)}${D.ended ? `, день завершён в ${hm(D.ended)}` : ''}.` : 'Офис открыт. Начните день, когда будете готовы.'} Время в расписании — игровое, а фактическое время каждой задачи учитывается в отчёте.</p></div>
    <div class="ring"><b>${done}/${ph.length}</b><span>этапов дня</span></div>
  </section>
  <div class="bar"><i style="width:${Math.round(done/ph.length*100)}%"></i></div>
  <div class="daygrid">
    <div class="now">${phasePanel(cur, p, D)}</div>
    <aside class="timeline">${ph.map(x => { const ok = phaseDone(x), isCur = x === cur, r = x.key === 'tk' ? reviewOf(x.id) : null;
      const click = x.key === 'tk' && D.started ? `onclick="openTask('${x.id}')"` : '';
      return `<div class="tl ${ok?'ok':''} ${isCur?'cur':''} ${click?'clk':''}" ${click}><span class="tm">${x.t}</span><span class="ic">${ok?'✓':icon(x)}</span><div><div class="tlt">${esc(label(x))}</div>${D.post?.[x.id]?'<div class="small muted">отложено на завтра</div>':''}${r?`<div class="small ${r.ok?'good':'err'}">${esc(r.text)}</div>`:''}</div></div>`; }).join('')}</aside>
  </div>`;
}
function phasePanel(ph, p, D){
  const k = today();
  if (PANELS_X[ph.key]) return PANELS_X[ph.key](ph, p, D);
  switch (ph.key) {
  case 'arrive': {
    const prev = Object.keys(S.days).filter(d => d < k && S.days[d].eod?.done).sort().pop();
    return `<div class="card"><h2>🏢 Доброе утро!</h2><p>Вы — системный аналитик продуктовой команды интернет-магазина и параллельно ведёте проект онлайн-записи для клиники. Вам ставят задачи руководитель, Product Owner и техлид.</p>
    ${prev ? `<div class="msg"><div class="from">✉ ${PEOPLE.lead} · вчера</div>${esc(mgrFeedback(prev))}</div>` : ''}
    <div class="msg"><div class="from">✉ ${PEOPLE.lead} · 08:55</div>Привет! План на сегодня:<ul>${ticketIds(p).map(id => { const t = ticketOf(id); return `<li><b>${t.key}</b> ${esc(t.title)} — до ${t.due}, приоритет ${t.prio}${t.carried?' <i>(доработка со вчера)</i>':''}</li>`; }).join('')}</ul>В 09:30 стендап, в 14:00 встреча по проекту, в 17:30 жду короткий отчёт о результатах дня.</div>
    <button class="btn" onclick="startDay()">Начать рабочий день</button></div>`; }
  case 'cards':
    return `<div class="card"><h2>☕ Кофе и разминка</h2><p>До стендапа 20 минут. Повторите теорию по карточкам: в очереди ${cardQueue().length}. Интервальные повторения держат в голове термины, которые нужны на встречах и в спецификациях.</p>
    <div class="row"><button class="btn" onclick="go('cards')">Повторить карточки</button><button class="btn ghost" onclick="Dget().cardsDone=true;logEvent('Разминка пропущена');render()">Пропустить</button></div></div>`;
  case 'standup': {
    const prev = Object.keys(S.plans).filter(d => d < k).sort().pop();
    const y = prev ? S.log.filter(e => e.day === prev).map(e => `${ticketOf(e.id, prev)?.key || ''} ${e.title}`.trim()) : [];
    const checks = S.checks['standup@'+k] || [];
    return `<div class="card"><h2>🗣 Стендап, 09:30</h2><p>Команда по кругу рассказывает о статусе. Ваша очередь: напишите то, что сказали бы вслух.</p>
    <p class="muted small">Шпаргалка. Вчера: ${y.length ? esc(y.join('; ')) : 'не было активности в тренажёре'}. Сегодня: ${ticketIds(p).map(id => ticketOf(id).key).join(', ')}.</p>
    <textarea rows="6" oninput="saveDraft('standup@${k}',this.value)" placeholder="Вчера: …\nСегодня: …\nБлокеры: …">${esc(S.drafts['standup@'+k] || '')}</textarea>
    <h3>Самопроверка</h3>${window.AI?.enabled?`<button class="btn sm ghost" onclick="aiCheck('standup@${k}','Выступление на стендапе','Кратко рассказать команде: что сделано вчера, что делаю сегодня (с ключами задач SA-…), есть ли блокеры.',STANDUP_CHECK)">Проверить с ИИ</button>`:''}${aiBox('standup@'+k)}${STANDUP_CHECK.map((c,i) => `<label class="chk"><input type="checkbox" ${checks[i]?'checked':''} onchange="(S.checks['standup@${k}']=S.checks['standup@${k}']||[])[${i}]=this.checked;save()"> ${esc(c)}</label>`).join('')}
    <button class="btn" onclick="doStandup()">Выступить</button></div>`; }
  case 'tk': {
    const t = ticketOf(ph.id), it = ITEMS[ph.id];
    return `<div class="card ticket"><div class="tags"><span class="tag">${t.key}</span><span class="tag k-${it.kind}">${KIND_LABEL[it.kind]}</span><span class="tag">приоритет ${t.prio}</span><span class="tag">срок ${t.due}</span>${t.carried?'<span class="tag err">доработка</span>':''}</div>
    <h2>${esc(t.title)}</h2><div class="msg"><div class="from">✉ ${esc(t.who)}</div>${esc(t.intro)}</div>
    <div class="row"><button class="btn" onclick="openTask('${ph.id}')">${it.kind==='inbox'?'Открыть чат':'Взять в работу'}</button>${it.kind!=='inbox'&&it.kind!=='quiz'?`<button class="btn ghost" onclick="postpone('${ph.id}')">Отложить на завтра</button>`:''}</div></div>`; }
  case 'lunch':
    return `<div class="card"><h2>🍽 Обед, 13:00–14:00</h2>${D.lunchStart ? `<p>Вы ушли на обед в ${hm(D.lunchStart)}. Отдыхайте: это часть рабочего дня, а не его потеря.</p><button class="btn" onclick="endLunch()">Вернулся с обеда</button>`
      : `<p>Утренний блок закрыт. Отойдите от экрана, хотя бы на 20–30 минут. После обеда — встреча по проекту.</p><button class="btn" onclick="Dget().lunchStart=Date.now();logEvent('Ушёл на обед');render()">Уйти на обед</button>`}</div>`;
  case 'eod': {
    const checks = S.checks['eod@'+k] || [];
    return `<div class="card"><h2>📝 Отчёт руководителю, 17:30</h2><p>Напишите отчёт так, как отправили бы его в рабочий чат руководителю: коротко, по задачам, с результатами.</p>
    <button class="btn sm ghost" onclick="fillEod()">Вставить шаблон с фактами дня</button>
    <textarea id="eodt" rows="10" oninput="saveDraft('eod@${k}',this.value)">${esc(S.drafts['eod@'+k] || '')}</textarea>
    <h3>Самопроверка</h3>${window.AI?.enabled?`<button class="btn sm ghost" onclick="aiCheck('eod@${k}','Отчёт руководителю за день','Короткий отчёт руководителю в рабочий чат: статус по каждой задаче дня, результаты, что не сделано и почему, риски и вопросы, план на завтра.',EOD_CHECK)">Проверить с ИИ</button>`:''}${aiBox('eod@'+k)}${EOD_CHECK.map((c,i) => `<label class="chk"><input type="checkbox" ${checks[i]?'checked':''} onchange="(S.checks['eod@${k}']=S.checks['eod@${k}']||[])[${i}]=this.checked;save()"> ${esc(c)}</label>`).join('')}
    <button class="btn" onclick="sendEod()">Отправить руководителю</button></div>`; }
  case 'end': {
    const j = S.journal[k] || {};
    if (D.ended) return `<div class="card"><h2>🏁 День завершён в ${hm(D.ended)}</h2><div class="msg"><div class="from">✉ ${PEOPLE.lead}</div>${esc(mgrFeedback(k))}</div><p>Завтра вас ждёт новый план. Отчёт за день готов.</p><div class="row"><button class="btn" onclick="repDay='${k}';repMode='day';go('reports')">Открыть отчёт за день</button><button class="btn ghost" onclick="go('library')">Дополнительная практика</button></div></div>`;
    return `<div class="card"><h2>🏁 Конец дня</h2><div class="msg"><div class="from">✉ ${PEOPLE.lead} · ${hm(D.eod.at)}</div>${esc(mgrFeedback(k))}</div>
    <h3>Личная рефлексия</h3><p class="muted small">Видите только вы, попадает в ваш отчёт.</p>
    <label>Что я сделал и понял сегодня</label><textarea id="j-learned" rows="3">${esc(j.learned)}</textarea>
    <label>Что было трудно / где ошибся</label><textarea id="j-hard" rows="2">${esc(j.hard)}</textarea>
    <label>Что применю или изучу завтра</label><textarea id="j-next" rows="2">${esc(j.next)}</textarea>
    <label>Самооценка дня</label><div class="rate">${[1,2,3,4,5].map(n=>`<button class="btn ${j.mood==n?'':'ghost'} sm" onclick="setMood(${n})">${n}</button>`).join('')}</div>
    <button class="btn" onclick="endDay()">Завершить рабочий день</button></div>`; }
  }
}
function startDay(){ const D = Dget(); D.started = Date.now(); logEvent('Начало рабочего дня'); render(); }
function postpone(id){ Dget().post[id] = true; logEvent(`${ticketOf(id).key} отложена на завтра`); render(); }
function endLunch(){ const D = Dget(); D.lunchDone = true; logEvent(`Вернулся с обеда (${Math.max(1, Math.round((Date.now()-D.lunchStart)/60000))} мин)`); render(); }
function ensurePseudo(id, kind, title){ ITEMS[id] = ITEMS[id] || {id, kind, cat:'Коммуникации', title, level:1}; }
function doStandup(){
  const k = today(), id = 'standup@'+k, txt = (S.drafts[id]||'').trim();
  if (txt.length < 30) { toast('Расскажите о статусе подробнее'); return; }
  const ch = S.checks[id] || [], n = STANDUP_CHECK.filter((_,i)=>ch[i]).length;
  ensurePseudo(id, 'standup', 'Выступление на стендапе');
  Dget().standup = {done:true, text:txt, at:Date.now()};
  complete(id, n/STANDUP_CHECK.length, {missed: STANDUP_CHECK.filter((_,i)=>!ch[i])});
  logEvent('Выступил на стендапе'); render();
}
function fillEod(){
  const k = today(), p = getPlan(), D = Dget();
  const lines = ticketIds(p).map(id => { const t = ticketOf(id), e = S.log.filter(x=>x.day===k&&x.id===id).pop();
    return `- ${t.key} ${t.title} — ${e ? `сделано (${pct(e.score)})` : D.post[id] ? 'отложено: <причина>' : 'не сделано: <причина>'}`; });
  const txt = `Итоги дня:\n${lines.join('\n')}\n\nРезультаты: <что получено и где лежит>\nРиски/блокеры: <…>\nВопросы: <…>\nПлан на завтра: <…>`;
  S.drafts['eod@'+k] = txt; save(); render();
}
function sendEod(){
  const k = today(), id = 'eod@'+k, txt = (S.drafts[id]||'').trim();
  if (txt.length < 60 || /<[^>]+>/.test(txt)) { toast(txt.length < 60 ? 'Отчёт слишком короткий' : 'Заполните поля в угловых скобках <…>'); return; }
  const ch = S.checks[id] || [], missed = EOD_CHECK.filter((_,i)=>!ch[i]);
  ensurePseudo(id, 'eod', 'Отчёт руководителю');
  Dget().eod = {done:true, text:txt, at:Date.now(), missed};
  complete(id, (EOD_CHECK.length-missed.length)/EOD_CHECK.length, {missed});
  logEvent('Отправил отчёт руководителю'); render();
}
function endDay(){ readJournal(); const D = Dget(); D.ended = Date.now(); logEvent('Конец рабочего дня'); save(); render(); }
function readJournal(){ const k = today(); const j = S.journal[k] || {}; ['learned','hard','next'].forEach(f => { const el = document.getElementById('j-'+f); if (el) j[f] = el.value; }); S.journal[k] = j; return j; }
function saveJournal(){ readJournal(); save(); toast('Рефлексия сохранена'); render(); }
function setMood(n){ const j = readJournal(); j.mood = n; save(); render(); }

// ───────── Экран задания ─────────
function header(it){
  const r = S.results[it.id];
  const t = ticketOf(it.id);
  return `<button class="back" onclick="go(lastList)">← Назад</button>
  ${t ? `<div class="card ticket"><div class="tags"><span class="tag">${t.key}</span><span class="tag">приоритет ${t.prio}</span><span class="tag">срок ${t.due}</span></div><div class="msg"><div class="from">✉ ${esc(t.who)}</div>${esc(t.intro)}</div>${(() => { const r = reviewOf(it.id); return r ? `<div class="msg ${r.ok?'':'bad'}"><div class="from">💬 Ревью</div>${esc(r.text)}</div>` : ''; })()}</div>` : ''}
  <div class="tags"><span class="tag k-${it.kind}">${KIND_LABEL[it.kind]}</span><span class="tag">${esc(it.cat)}</span>${it.level?`<span class="tag">сложность ${'●'.repeat(it.level)}${'○'.repeat(4-Math.min(4,it.level))}</span>`:''}<span class="tag">до ${XPMAX(it)} XP</span>${r?`<span class="tag ok">лучший результат ${Math.round(r.score*100)}% · попыток ${r.attempts}</span>`:''}</div>
  <h1>${esc(it.title)}</h1>`;
}
let lastList = 'today';
const VIEWS = {today:()=>vDay(), task:()=>vTask(), cards:()=>vCards(), project:()=>vProject(), library:()=>vLibrary(), progress:()=>vProgress(), reports:()=>vReports(), interview:()=>vInterview()};
const AFTER_RENDER = [];
const TASK_VIEWS = {sql:it=>tSql(it), case:it=>tCase(it), stage:it=>tCase(it), quiz:it=>tQuiz(it), inbox:it=>tInbox(it), interview:it=>tInterview(it)};
function vTask(){
  const it = ITEMS[current];
  if (!it) return '';
  return header(it) + TASK_VIEWS[it.kind](it);
}
function saveDraft(id, v){ S.drafts[id] = v; save(); }

function tCase(it){
  const draft = S.drafts[it.id] || '', rev = revealed[it.id];
  const checks = S.checks[it.id] || [];
  return `
  ${it.kind==='stage'?`<div class="card note"><b>Проект:</b> ${esc(PROJECT.name)}</div>`:''}
  <div class="card"><h3>Ситуация</h3><div class="txt">${it.scenario}</div></div>
  <div class="card"><h3>Задание</h3><div class="txt pre">${esc(it.task)}</div>
  ${it.hint?`<details><summary>Подсказка</summary><p>${esc(it.hint)}</p></details>`:''}</div>
  <div class="card"><h3>Ваше решение</h3>
    <p class="muted">Пишите так, как отдали бы в команду: структурно, с конкретикой. Черновик сохраняется автоматически.</p>
    <textarea rows="14" class="mono" oninput="saveDraft('${it.id}',this.value)" placeholder="Ваш ответ…">${esc(draft)}</textarea>
    ${!rev?`<div class="row">${window.AI?.enabled?`<button class="btn" onclick="aiReviewCase('${it.id}')">Отправить на ревью (ИИ)</button><button class="btn ghost" onclick="revealCase('${it.id}')">Самопроверка по эталону</button>`:`<button class="btn" onclick="revealCase('${it.id}')">Сверить с эталоном</button><span class="muted small">&nbsp;Подключите ИИ-ревьюера во вкладке «Настройки» для независимой оценки</span>`}</div>`:''}
  </div>
  ${aiBox(it.id)}
  ${rev?`<div class="card ref"><h3>Эталонное решение (один из возможных вариантов)</h3><div class="txt">${it.reference}</div></div>
  <div class="card"><h3>Самопроверка по критериям</h3><p class="muted">Честно отметьте пункты, которые есть в <b>вашем</b> ответе. От этого зависят балл и отчёт.</p>
  ${AIR[it.id]?.res ? `<p class="muted small">Отметки проставил ИИ-ревьюер. Балл засчитывается по его оценке.</p>${it.checklist.map((c,i)=>`<div class="chk">${AIR[it.id].res.checklist[i]?'✅':'⬜'} ${esc(c)}</div>`).join('')}<button class="btn" onclick="finishCaseAI('${it.id}')">Засчитать (${AIR[it.id].res.score}/100)</button>`
  : `${it.checklist.map((c,i)=>`<label class="chk"><input type="checkbox" ${checks[i]?'checked':''} onchange="setCheck('${it.id}',${i},this.checked)"> ${esc(c)}</label>`).join('')}
  <button class="btn" onclick="finishCase('${it.id}')">Засчитать (${checks.filter(Boolean).length}/${it.checklist.length})</button>`}</div>`:''}`;
}
function revealCase(id){ if ((S.drafts[id]||'').trim().length < 40) { toast('Сначала напишите своё решение (хотя бы несколько предложений)'); return; } revealed[id] = true; render(); }
function setCheck(id,i,v){ (S.checks[id] = S.checks[id] || [])[i] = v; save(); const b = document.querySelector('.card:last-child .btn'); const it = ITEMS[id]; if (b) b.textContent = `Засчитать (${S.checks[id].filter(Boolean).length}/${it.checklist.length})`; }
function finishCase(id){ const it = ITEMS[id]; const n = (S.checks[id]||[]).filter(Boolean).length; complete(id, n/it.checklist.length, {missed: it.checklist.filter((_,i)=>!(S.checks[id]||[])[i])}); go(lastList); }

function tInterview(it){
  const rev = revealed[it.id];
  return `<div class="card"><p class="muted">Ответьте так, как ответили бы вслух на собеседовании: коротко, структурно, с примером из практики.</p>
  <textarea rows="8" oninput="saveDraft('${it.id}',this.value)" placeholder="Ваш ответ…">${esc(S.drafts[it.id]||'')}</textarea>
  ${!rev?`<button class="btn" onclick="revealed['${it.id}']=true;render()">Показать сильный ответ</button>`:''}</div>
  ${rev?`<div class="card ref"><h3>Сильный ответ</h3><p>${esc(it.answer)}</p></div>
  <div class="card"><h3>Насколько ваш ответ близок к сильному?</h3><div class="rate">${[1,2,3,4,5].map(n=>`<button class="btn ghost" onclick="complete('${it.id}',${n/5});go(lastList)">${n}</button>`).join('')}</div></div>`:''}`;
}

// ───────── SQL ─────────
const SQL_CDN = 'https://cdnjs.cloudflare.com/ajax/libs/sql.js/1.10.3/';
let SQLlib = null, sqlLoading = null;
function initSQL(){
  if (!sqlLoading) sqlLoading = (typeof initSqlJs === 'function' ? initSqlJs({locateFile: f => SQL_CDN + f}) : Promise.reject(new Error('библиотека не загружена'))).then(l => SQLlib = l);
  return sqlLoading;
}
function runSql(q){ const db = new SQLlib.Database(); try { db.run(SQL_SCHEMA); const r = db.exec(q); return r.length ? r[r.length-1] : {columns:[], values:[]}; } finally { db.close(); } }
function table(r){ if (!r.columns.length) return '<p class="muted">Пустой результат.</p>'; return `<div class="tw"><table><tr>${r.columns.map(c=>`<th>${esc(c)}</th>`).join('')}</tr>${r.values.map(v=>`<tr>${v.map(x=>`<td>${esc(x===null?'NULL':x)}</td>`).join('')}</tr>`).join('')}</table></div>`; }
const SCHEMA_HTML = `<b>customers</b>(id, name, city, registered_at) · <b>orders</b>(id, customer_id, status: new|paid|cancelled, created_at, amount) · <b>order_items</b>(order_id, product, qty, price)`;
const sqlFails = {};
function tSql(it){
  return `<div class="card"><h3>Контекст</h3><p>${esc(it.scenario)}</p><h3>Задание</h3><p>${esc(it.task)}</p>
  <details><summary>Подсказка</summary><p>${esc(it.hint)}</p></details>
  <details><summary>Схема БД (SQLite)</summary><p class="mono small">${SCHEMA_HTML}<br>${window.SCHEMA_EXTRA||''}</p><p class="muted small">Можно выполнить, например, <code>SELECT * FROM orders</code>, чтобы посмотреть данные.</p></details></div>
  <div class="card"><textarea id="sq" rows="7" class="mono" oninput="saveDraft('${it.id}',this.value)" placeholder="SELECT …">${esc(S.drafts[it.id]||'')}</textarea>
  <div class="row"><button class="btn ghost" onclick="sqlRun()">▶ Выполнить</button><button class="btn" onclick="sqlCheck('${it.id}')">Проверить</button><button class="btn ghost" onclick="sqlShow('${it.id}')">Показать решение</button></div>
  <div id="sqout"></div></div>`;
}
async function sqlExec(){
  const out = document.getElementById('sqout'), q = document.getElementById('sq').value;
  out.innerHTML = '<p class="muted">Выполняю…</p>';
  try { await initSQL(); } catch(e) { out.innerHTML = '<p class="err">Не удалось загрузить SQL-движок (нужен интернет при первом запуске).</p>'; return null; }
  try { return {q, r: runSql(q)}; } catch(e) { out.innerHTML = `<p class="err">Ошибка SQL: ${esc(e.message)}</p>`; return null; }
}
async function sqlRun(){ const x = await sqlExec(); if (x) document.getElementById('sqout').innerHTML = table(x.r); }
async function sqlCheck(id){
  const x = await sqlExec(); if (!x) { sqlFails[id] = (sqlFails[id]||0)+1; return; }
  const it = ITEMS[id], ref = runSql(it.ref);
  const norm = rs => rs.map(r => JSON.stringify(r.map(v => typeof v === 'number' ? Math.round(v*100)/100 : v)));
  let a = norm(x.r.values), b = norm(ref.values);
  if (!/order\s+by/i.test(it.ref)) { a.sort(); b.sort(); }
  const ok = x.r.columns.length === ref.columns.length && a.length === b.length && a.every((v,i)=>v===b[i]);
  const out = document.getElementById('sqout');
  if (ok) { const score = Math.max(0.4, 1 - 0.15*(sqlFails[id]||0)); delete sqlFails[id]; out.innerHTML = `<p class="good">✓ Верно!</p>${table(x.r)}`; complete(id, score, {answer:x.q}); render(); }
  else { sqlFails[id] = (sqlFails[id]||0)+1; out.innerHTML = `<p class="err">✗ Результат не совпадает с ожидаемым (${x.r.values.length} строк, ожидалось ${ref.values.length}${x.r.columns.length!==ref.columns.length?`; колонок ${x.r.columns.length}, ожидалось ${ref.columns.length}`:''}). Проверьте фильтры, группировку и сортировку.</p>${table(x.r)}`; }
}
async function sqlShow(id){
  try { await initSQL(); } catch(e){}
  const it = ITEMS[id];
  document.getElementById('sqout').innerHTML = `<div class="ref"><p class="mono">${esc(it.ref)}</p>${SQLlib?table(runSql(it.ref)):''}</div><button class="btn ghost" onclick="complete('${id}',0.2);go(lastList)">Засчитать как «разобрал решение» (20%)</button>`;
}

// ───────── Тест ─────────
function tQuiz(it){
  const st = quizAns[it.id] = quizAns[it.id] || {sel:{}, done:false};
  return it.questions.map((q,qi)=>`<div class="card"><h3>${qi+1}. ${esc(q.q)}</h3>
    ${q.o.map((o,oi)=>{ let cls = ''; if (st.done){ if (oi===q.a) cls='right'; else if (st.sel[qi]===oi) cls='wrong'; }
      return `<label class="opt ${cls}"><input type="radio" name="q${qi}" ${st.sel[qi]===oi?'checked':''} ${st.done?'disabled':''} onchange="quizAns['${it.id}'].sel[${qi}]=${oi}"> ${esc(o)}</label>`; }).join('')}
    ${st.done?`<p class="muted">💡 ${esc(q.e)}</p>`:''}</div>`).join('')
  + (st.done ? `<button class="btn" onclick="delete quizAns['${it.id}'];go(lastList)">Готово</button>` : `<button class="btn" onclick="submitQuiz('${it.id}')">Проверить ответы</button>`);
}
function submitQuiz(id){
  const it = ITEMS[id], st = quizAns[id];
  if (Object.keys(st.sel).length < it.questions.length) { toast('Ответьте на все вопросы'); return; }
  let ok = 0;
  it.questions.forEach((q,qi)=>{ const k = `${id}:${qi}`; if (st.sel[qi]===q.a) { ok++; delete S.mistakes[k]; } else S.mistakes[k] = today(); });
  st.done = true; complete(id, ok/it.questions.length); render();
}

// ───────── Рабочая ситуация ─────────
function tInbox(it){
  const st = inboxRun[it.id] = inboxRun[it.id] || {step:0, picks:[]};
  let h = `<div class="card note">${esc(it.ctx)}</div>`;
  it.steps.forEach((s,si)=>{
    if (si > st.step) return;
    h += `<div class="msg"><div class="from">✉ ${esc(s.from)}</div><div>${esc(s.text)}</div></div>`;
    if (si < st.step) { const o = s.opts[st.picks[si]]; h += `<div class="reply s${o.s}"><b>Ваше действие:</b> ${esc(o.t)}<div class="fb">${['✗','◐','✓'][o.s]} ${esc(o.fb)}</div>${o.s<2?`<div class="fb muted">Лучшее действие: ${esc(s.opts.find(x=>x.s===2).t)}</div>`:''}</div>`; }
    else h += `<div class="opts">${shuffleIdx(s.opts.length, it.id+si).map(oi=>`<button class="optbtn" onclick="pickInbox('${it.id}',${oi})">${esc(s.opts[oi].t)}</button>`).join('')}</div>`;
  });
  if (st.step >= it.steps.length) { const sc = st.picks.reduce((a,p,i)=>a+it.steps[i].opts[p].s,0); h += `<div class="card"><h3>Итог: ${sc} из ${it.steps.length*2}</h3><button class="btn" onclick="delete inboxRun['${it.id}'];go(lastList)">Готово</button></div>`; }
  return h;
}
function shuffleIdx(n, seed){ let h = 0; for (const c of String(seed)) h = (h*31 + c.charCodeAt(0)) >>> 0; const a = [...Array(n).keys()]; for (let i=n-1;i>0;i--){ h = (h*1103515245+12345)>>>0; const j = h % (i+1); [a[i],a[j]] = [a[j],a[i]]; } return a; }
function pickInbox(id, oi){
  const it = ITEMS[id], st = inboxRun[id]; st.picks.push(oi); st.step++;
  if (st.step >= it.steps.length) { const sc = st.picks.reduce((a,p,i)=>a+it.steps[i].opts[p].s,0); complete(id, sc/(it.steps.length*2)); }
  render();
}

// ───────── Карточки ─────────
function vCards(){
  const q = cardSession.queue, L = S.cardLog[today()] || {n:0, ok:0};
  const learned = Object.keys(S.cards).length;
  if (!q.length) { const D = Dget(); if (D.started && !D.cardsDone) { D.cardsDone = true; logEvent(`Разминка: повторено ${L.n} карточек`); } }
  if (!q.length) return `<h1>Карточки</h1><div class="card"><h3>На сегодня всё 🎉</h3><p>Повторено сегодня: ${L.n}. Изучено карточек: ${learned} из ${CARDS.length}.</p>
    <div class="row"><button class="btn" onclick="go('today')">Вернуться к рабочему дню</button><button class="btn ghost" onclick="cardSession={queue:CARDS.map((_,i)=>i).filter(i=>S.cards[i]).sort(()=>Math.random()-.5).slice(0,10),flipped:false};render()">Дополнительная тренировка (10)</button></div></div>`;
  const i = q[0], c = CARDS[i];
  return `<h1>Карточки</h1><p class="muted">Осталось ${q.length} · повторено сегодня ${L.n} · изучено ${learned}/${CARDS.length}. Сначала ответьте мысленно или вслух, затем переверните.</p>
  <div class="flash" onclick="cardSession.flipped=true;render()"><span class="tag">${esc(c[0])}</span><h2>${esc(c[1])}</h2>
  ${cardSession.flipped?`<hr><p>${esc(c[2])}</p>`:'<p class="muted">Нажмите, чтобы увидеть ответ</p>'}</div>
  ${cardSession.flipped?`<div class="rate grades"><button class="btn bad" onclick="gradeCard(${i},0)">Не помню</button><button class="btn ghost" onclick="gradeCard(${i},1)">Трудно</button><button class="btn" onclick="gradeCard(${i},2)">Помню</button><button class="btn ghost" onclick="gradeCard(${i},3)">Легко</button></div>`:''}`;
}

// ───────── Проект ─────────
function vProject(){
  lastList = 'project';
  const done = PROJECT.stages.filter(s=>S.results[s.id]).length;
  return `<h1>${esc(PROJECT.name)}</h1><div class="card"><p>${esc(PROJECT.intro)}</p><div class="bar"><i style="width:${done/PROJECT.stages.length*100}%"></i></div><p class="muted">Пройдено этапов: ${done}/${PROJECT.stages.length}</p>
  <button class="btn ghost" onclick="exportPortfolio()">Скачать портфолио проекта (.md)</button></div>
  ${PROJECT.stages.map((s,i)=>{ const r = S.results[s.id]; return `<div class="pitem ${r?'ok':''}" onclick="openTask('${s.id}')"><div class="num">${r?'✓':i+1}</div><div class="pbody"><div class="tags"><span class="tag">${esc(STAGE_CAT[s.id])}</span>${r?`<span class="tag">${Math.round(r.score*100)}%</span>`:''}</div><div class="ptitle">${esc(s.title)}</div></div><button class="btn ${r?'ghost':''}">${r?'Улучшить':'Открыть'}</button></div>`; }).join('')}`;
}
function exportPortfolio(){
  let md = `# Портфолио: ${PROJECT.name}\n\n${PROJECT.intro}\n\n`;
  PROJECT.stages.forEach((s,i)=>{ md += `## Этап ${i+1}. ${s.title}\n\n**Задание.** ${s.task}\n\n${(S.drafts[s.id]||'_нет ответа_')}\n\n`; });
  downloadFile(`portfolio-${today()}.md`, md);
}

// ───────── Библиотека ─────────
function vLibrary(){
  lastList = 'library';
  const kinds = [['all','Все'],['case','Кейсы'],['sql','SQL'],['diagram','Диаграммы'],['openapi','OpenAPI'],['elicit','Интервью с заказчиком'],['quiz','Тесты'],['inbox','Рабочие ситуации']];
  const list = Object.values(ITEMS).filter(it=>kinds.some(k=>k[0]===it.kind) && (filter==='all'||it.kind===filter));
  return `<h1>Библиотека заданий</h1><div class="row">${kinds.map(([k,l])=>`<button class="btn sm ${filter===k?'':'ghost'}" onclick="filter='${k}';render()">${l}</button>`).join('')}</div>
  <div class="grid">${list.map(it=>{ const r = S.results[it.id]; return `<div class="tile ${r?'ok':''}" onclick="openTask('${it.id}')"><div class="tags"><span class="tag k-${it.kind}">${KIND_LABEL[it.kind]}</span><span class="tag">${esc(it.cat)}</span></div><b>${esc(it.title)}</b><div class="muted small">${r?`Лучший результат ${Math.round(r.score*100)}%`:'Не пройдено'} · ${'●'.repeat(it.level||1)}</div></div>`; }).join('')}</div>`;
}
function vInterview(){
  lastList = 'interview';
  return `<h1>Подготовка к собеседованию</h1><p class="muted">Вопросы, которые реально задают на интервью системного аналитика. Ответьте письменно, сравните с сильным ответом и оцените себя.</p>
  ${INTERVIEW.map((q,i)=>{ const r = S.results['iv-'+i]; return `<div class="pitem ${r?'ok':''}" onclick="openTask('iv-${i}')"><div class="num">${r?'✓':i+1}</div><div class="pbody"><div class="ptitle">${esc(q[0])}</div>${r?`<div class="muted small">самооценка ${Math.round(r.lastScore*5)}/5</div>`:''}</div></div>`; }).join('')}`;
}

// ───────── Прогресс ─────────
function competencies(){
  const m = {};
  Object.values(ITEMS).filter(it=>!SERVICE_KINDS.includes(it.kind)).forEach(it=>{ const c = m[it.cat] = m[it.cat] || {total:0, done:0, sum:0}; c.total++; const r = S.results[it.id]; if (r) { c.done++; c.sum += r.score; } });
  return Object.entries(m).map(([cat,c])=>({cat, ...c, avg: c.done ? c.sum/c.done : 0, level: c.done ? (c.sum/c.total) : 0})).sort((a,b)=>b.level-a.level);
}
function vProgress(){
  lastList = 'progress';
  const xp = totalXP(), g = grade(xp), comp = competencies();
  const mist = Object.keys(S.mistakes);
  const days = [...activeDays()].sort();
  const heat = []; const d0 = dayNum();
  for (let n=d0-83;n<=d0;n++){ const k = keyOfNum(n); const x = S.log.filter(e=>e.day===k).reduce((a,e)=>a+e.mins,0) + (S.cardLog[k]?.n||0); heat.push(`<i title="${k}" class="h${x===0?0:x<20?1:x<45?2:x<90?3:4}"></i>`); }
  return `<h1>Прогресс</h1>
  <div class="kpis"><div class="kpi"><b>${g.name}</b><span>грейд${g.next?` · до «${g.next[1]}» ${g.next[0]-xp} XP`:''}</span></div><div class="kpi"><b>${xp}</b><span>XP всего</span></div><div class="kpi"><b>${streak()}</b><span>дней подряд</span></div><div class="kpi"><b>${days.length}</b><span>активных дней</span></div></div>
  <div class="card"><h3>Активность за 12 недель</h3><div class="heat">${heat.join('')}</div></div>
  <div class="card"><h3>Карта компетенций</h3><p class="muted small">Уровень = средний лучший балл с учётом покрытия всех заданий в направлении.</p>
  ${comp.map(c=>`<div class="comp"><span>${esc(c.cat)}</span><div class="bar"><i style="width:${Math.round(c.level*100)}%"></i></div><span class="muted small">${c.done}/${c.total} · ${Math.round(c.avg*100)}%</span></div>`).join('')}</div>
  <div class="card"><h3>Работа над ошибками</h3>${mist.length?mist.map(k=>{ const [id,qi] = k.split(':'); const q = ITEMS[id].questions[+qi]; return `<details><summary>${esc(q.q)}</summary><p>Правильно: <b>${esc(q.o[q.a])}</b></p><p class="muted">${esc(q.e)}</p><button class="btn sm ghost" onclick="delete S.mistakes['${k}'];save();render()">Разобрал</button></details>`; }).join(''):'<p class="muted">Ошибок в тестах нет.</p>'}
  ${weakItems().length?`<h3>Задания с результатом ниже 70% — стоит переделать</h3>${weakItems().map(it=>`<div class="link" onclick="openTask('${it.id}')">↻ ${esc(it.title)} — ${Math.round(S.results[it.id].score*100)}%</div>`).join('')}`:''}</div>
  <div class="card"><h3>Данные</h3><p class="muted small">Прогресс хранится в этом браузере. Сохраняйте резервную копию.</p>
  <div class="row"><button class="btn ghost" onclick="downloadFile('sa-trainer-backup-${today()}.json', JSON.stringify(S))">Экспорт резервной копии</button>
  <label class="btn ghost">Импорт<input type="file" accept=".json" hidden onchange="importBackup(this.files[0])"></label>
  <button class="btn ghost" onclick="if(confirm('Сбросить весь прогресс?')){S=def();save();render()}">Сбросить</button></div></div>`;
}
const SERVICE_KINDS = ['standup','eod','interrupt','assess','mock'];
const weakItems = () => Object.keys(S.results).filter(id=>S.results[id].score<0.7 && ITEMS[id] && !SERVICE_KINDS.includes(ITEMS[id].kind)).map(id=>ITEMS[id]);
function importBackup(f){ if (!f) return; f.text().then(t=>{ S = Object.assign(def(), JSON.parse(t)); save(); toast('Импортировано'); render(); }).catch(()=>toast('Не удалось прочитать файл')); }
function downloadFile(name, text){ const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text],{type:'text/plain;charset=utf-8'})); a.download = name; a.click(); setTimeout(()=>URL.revokeObjectURL(a.href), 1000); }

// ───────── Отчёты ─────────
let repDay = null, repMode = 'day';
function vReports(){
  lastList = 'reports';
  const days = [...new Set([today(), ...activeDays()])].sort().reverse();
  if (!repDay) repDay = today();
  return `<div class="noprint"><h1>Отчётность</h1><p class="muted">Ежедневный отчёт формируется автоматически по вашей работе в тренажёре: можно скачать, распечатать или сохранить в PDF.</p>
  <div class="row"><select onchange="repDay=this.value;render()">${days.map(d=>`<option value="${d}" ${d===repDay?'selected':''}>${d}${d===today()?' (сегодня)':''}</option>`).join('')}</select>
  <button class="btn sm ${repMode==='day'?'':'ghost'}" onclick="repMode='day';render()">День</button><button class="btn sm ${repMode==='week'?'':'ghost'}" onclick="repMode='week';render()">Неделя (7 дней)</button><button class="btn sm ${repMode==='month'?'':'ghost'}" onclick="repMode='month';render()">30 дней</button></div>
  <div class="row"><button class="btn" onclick="downloadFile(reportName(),reportMd())">Скачать .md</button><button class="btn ghost" onclick="window.print()">Печать / PDF</button><button class="btn ghost" onclick="navigator.clipboard.writeText(reportMd()).then(()=>toast('Скопировано'))">Копировать текст</button></div></div>
  <div id="report" class="card report"></div>`;
}
function reportDays(){ const n = dayNumOf(repDay); const len = repMode==='day'?1:repMode==='week'?7:30; return Array.from({length:len},(_,i)=>keyOfNum(n-len+1+i)); }
function reportName(){ const d = reportDays(); return d.length===1?`otchet-${d[0]}.md`:`otchet-${d[0]}_${d[d.length-1]}.md`; }
function reportData(){
  const days = reportDays(), set = new Set(days);
  const entries = S.log.filter(e=>set.has(e.day));
  const cards = days.reduce((a,d)=>{ const c = S.cardLog[d]; if (c){ a.n+=c.n; a.ok+=c.ok; a.new+=c.new||0; } return a; },{n:0,ok:0,new:0});
  const mins = entries.reduce((a,e)=>a+e.mins,0) + Math.round(cards.n*0.5);
  const xp = entries.reduce((a,e)=>a+e.xp,0) + cards.n*2;
  const avg = entries.length ? entries.reduce((a,e)=>a+e.score,0)/entries.length : 0;
  const byCat = {}; entries.forEach(e=>{ const c = byCat[e.cat] = byCat[e.cat] || {n:0,sum:0,mins:0}; c.n++; c.sum+=e.score; c.mins+=e.mins; });
  const weak = entries.filter(e=>e.score<0.7);
  const missed = entries.filter(e=>S.results[e.id]?.missed?.length && e.kind!=='sql').map(e=>({title:e.title, items:S.results[e.id].missed}));
  const plans = days.filter(d=>S.plans[d]).map(d=>{ const ph = phases(S.plans[d]); return {d, done:ph.filter(x=>phaseDone(x,d)).length, total:ph.length}; });
  const work = days.filter(d=>S.days[d]?.started).map(d=>({d, ...S.days[d], fb: mgrFeedback(d)}));
  const journals = days.filter(d=>S.journal[d]).map(d=>({d, ...S.journal[d]}));
  const active = days.filter(d=>entries.some(e=>e.day===d) || S.cardLog[d]?.n).length;
  return {days, entries, cards, mins, xp, avg, byCat, weak, missed, plans, journals, active, work};
}
function recs(R){
  const r = [];
  const cats = Object.entries(R.byCat).filter(([,c])=>c.sum/c.n<0.7).map(([k])=>k);
  if (cats.length) r.push(`Подтянуть направления: ${cats.join(', ')} — переделайте задания с низким баллом и повторите карточки по теме.`);
  if (!R.cards.n) r.push('Не было повторения карточек — уделите 10 минут теории, это закрепляет терминологию для интервью и спецификаций.');
  const kinds = new Set(R.entries.map(e=>e.kind));
  if (!kinds.has('sql')) r.push('Не было SQL-практики — решите хотя бы одну задачу, навык быстро теряется.');
  if (!kinds.has('stage') && PROJECT.stages.some(s=>!S.results[s.id])) r.push('Продвиньтесь по сквозному проекту — это ваше портфолио.');
  if (!R.journals.length) r.push('Заполните рефлексию: что получилось, что трудно, что дальше.');
  if (!r.length) r.push('Отличная сбалансированная работа. Попробуйте задания уровня сложнее и улучшите результаты ниже 90%.');
  return r;
}
const pct = x => Math.round(x*100)+'%';
function drawReport(){
  const R = reportData(), title = R.days.length===1 ? `Отчёт за ${fmtDay(R.days[0])}` : `Отчёт за период ${R.days[0]} — ${R.days[R.days.length-1]}`;
  document.getElementById('report').innerHTML = `
  <h2>${esc(title)}</h2><p class="muted small">Тренажёр системного аналитика · грейд: ${grade(totalXP()).name} · серия: ${streak()} дн.</p>
  <div class="kpis"><div class="kpi"><b>${R.mins} мин</b><span>время практики</span></div><div class="kpi"><b>${R.entries.length}</b><span>заданий выполнено</span></div><div class="kpi"><b>${R.entries.length?pct(R.avg):'—'}</b><span>средний балл</span></div><div class="kpi"><b>+${R.xp}</b><span>XP</span></div><div class="kpi"><b>${R.cards.n}</b><span>карточек (${R.cards.n?pct(R.cards.ok/R.cards.n):'—'} помню)</span></div>${R.days.length>1?`<div class="kpi"><b>${R.active}/${R.days.length}</b><span>активных дней</span></div>`:''}</div>
  ${R.work.map(w=>`<h3>Рабочий день${R.days.length>1?' '+w.d:''}: ${hm(w.started)} — ${w.ended?hm(w.ended):'не завершён'}</h3>
    <div class="chron">${w.ev.map(e=>`<div><span class="tm">${hm(e.ts)}</span> ${esc(e.what)}</div>`).join('')}</div>
    ${w.standup?.text?`<p><b>Стендап:</b></p><div class="quote">${esc(w.standup.text)}</div>`:''}
    ${w.eod?.text?`<p><b>Отчёт руководителю:</b></p><div class="quote">${esc(w.eod.text)}</div>`:''}
    ${w.fb?`<p><b>Ответ руководителя:</b></p><div class="quote">${esc(w.fb)}</div>`:''}`).join('')}
  ${R.plans.length?`<h3>Выполнение дневного плана</h3>${R.plans.map(p=>`<div class="comp"><span>${p.d}</span><div class="bar"><i style="width:${p.done/p.total*100}%"></i></div><span class="small">${p.done}/${p.total}</span></div>`).join('')}`:''}
  <h3>Выполненные задания</h3>
  ${R.entries.length?`<div class="tw"><table><tr>${R.days.length>1?'<th>Дата</th>':''}<th>Время</th><th>Тикет</th><th>Тип</th><th>Задание</th><th>Направление</th><th>Мин</th><th>Балл</th><th>XP</th></tr>
  ${R.entries.map(e=>`<tr>${R.days.length>1?`<td>${e.day}</td>`:''}<td>${hm(e.ts)}</td><td>${ticketOf(e.id,e.day)?.key||'—'}</td><td>${KIND_LABEL[e.kind]}</td><td>${esc(e.title)}</td><td>${esc(e.cat)}</td><td>${e.mins}</td><td class="${e.score<0.7?'err':'good'}">${pct(e.score)}</td><td>+${e.xp}</td></tr>`).join('')}</table></div>`:'<p class="muted">Заданий за период нет.</p>'}
  ${Object.keys(R.byCat).length?`<h3>По направлениям</h3>${Object.entries(R.byCat).map(([k,c])=>`<div class="comp"><span>${esc(k)}</span><div class="bar"><i style="width:${c.sum/c.n*100}%"></i></div><span class="small">${c.n} зад. · ${pct(c.sum/c.n)} · ${c.mins} мин</span></div>`).join('')}`:''}
  ${R.missed.length?`<h3>Что упущено в решениях</h3>${R.missed.map(m=>`<p><b>${esc(m.title)}:</b></p><ul>${m.items.map(x=>`<li>${esc(x)}</li>`).join('')}</ul>`).join('')}`:''}
  <h3>Рекомендации</h3><ul>${recs(R).map(x=>`<li>${esc(x)}</li>`).join('')}</ul>
  ${R.journals.length?`<h3>Рефлексия</h3>${R.journals.map(j=>`<div class="jr">${R.days.length>1?`<b>${j.d}</b>${j.mood?` · самооценка ${j.mood}/5`:''}`:j.mood?`Самооценка дня: ${j.mood}/5`:''}
    ${j.learned?`<p><b>Сделал и понял:</b> ${esc(j.learned)}</p>`:''}${j.hard?`<p><b>Трудности:</b> ${esc(j.hard)}</p>`:''}${j.next?`<p><b>План:</b> ${esc(j.next)}</p>`:''}</div>`).join('')}`:''}`;
}
function reportMd(){
  const R = reportData(), multi = R.days.length > 1;
  let md = `# ${multi?`Отчёт за период ${R.days[0]} — ${R.days[R.days.length-1]}`:`Отчёт за ${fmtDay(R.days[0])}`}\n\n_Тренажёр системного аналитика · грейд: ${grade(totalXP()).name} · серия: ${streak()} дн._\n\n`;
  md += `## Итоги\n\n- Время практики: ${R.mins} мин\n- Заданий выполнено: ${R.entries.length}\n- Средний балл: ${R.entries.length?pct(R.avg):'—'}\n- Получено XP: ${R.xp}\n- Карточек повторено: ${R.cards.n}${R.cards.n?` (помню ${pct(R.cards.ok/R.cards.n)}, новых ${R.cards.new})`:''}\n${multi?`- Активных дней: ${R.active} из ${R.days.length}\n`:''}`;
  R.work.forEach(w => { md += `\n## Рабочий день${multi?' '+w.d:''}: ${hm(w.started)} — ${w.ended?hm(w.ended):'не завершён'}\n\n${w.ev.map(e=>`- ${hm(e.ts)} ${e.what}`).join('\n')}\n`;
    if (w.standup?.text) md += `\n**Стендап:**\n\n> ${w.standup.text.replace(/\n/g,'\n> ')}\n`;
    if (w.eod?.text) md += `\n**Отчёт руководителю:**\n\n> ${w.eod.text.replace(/\n/g,'\n> ')}\n`;
    if (w.fb) md += `\n**Ответ руководителя:** ${w.fb}\n`; });
  if (R.plans.length) md += `\n## Дневной план\n\n${R.plans.map(p=>`- ${p.d}: ${p.done}/${p.total}`).join('\n')}\n`;
  md += `\n## Выполненные задания\n\n`;
  md += R.entries.length ? `| ${multi?'Дата | ':''}Тикет | Тип | Задание | Направление | Мин | Балл |\n|${multi?'---|':''}---|---|---|---|---|---|\n` + R.entries.map(e=>`| ${multi?e.day+' | ':''}${ticketOf(e.id,e.day)?.key||'—'} | ${KIND_LABEL[e.kind]} | ${e.title.replace(/\|/g,'/')} | ${e.cat} | ${e.mins} | ${pct(e.score)} |`).join('\n') + '\n' : '_нет_\n';
  if (Object.keys(R.byCat).length) md += `\n## По направлениям\n\n${Object.entries(R.byCat).map(([k,c])=>`- ${k}: ${c.n} зад., ${pct(c.sum/c.n)}, ${c.mins} мин`).join('\n')}\n`;
  if (R.missed.length) md += `\n## Что упущено в решениях\n\n${R.missed.map(m=>`**${m.title}:**\n${m.items.map(x=>`- ${x}`).join('\n')}`).join('\n\n')}\n`;
  md += `\n## Рекомендации\n\n${recs(R).map(x=>`- ${x}`).join('\n')}\n`;
  if (R.journals.length) md += `\n## Рефлексия\n\n${R.journals.map(j=>`${multi?`### ${j.d}\n`:''}${j.mood?`Самооценка: ${j.mood}/5\n\n`:''}${j.learned?`**Сделал и понял:** ${j.learned}\n\n`:''}${j.hard?`**Трудности:** ${j.hard}\n\n`:''}${j.next?`**План:** ${j.next}\n`:''}`).join('\n')}\n`;
  return md;
}


