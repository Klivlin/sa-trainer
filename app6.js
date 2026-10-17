// Прогресс обучения: дерево навыков (как достижения в Minecraft), уровни освоения с интервальным
// повторением, входная диагностика, экзамены модулей и сертификаты, цель дня и напоминания, глоссарий.

['m', 'exams', 'rq', 'diagDone'].forEach(k => S.learn[k] = S.learn[k] || {});
if (S.settings.goal === undefined) S.settings.goal = 45;
SERVICE_KINDS.push('review', 'exam');
Object.assign(KIND_LABEL, {review: 'Повторение урока', exam: 'Экзамен модуля'});
Object.assign(XP_TABLE, {review: () => 10, exam: () => 100});
const LVL = ['Не изучено', 'Изучено', 'Закреплено', 'Освоено'];
const LVL_NEXT_DAYS = {1: 3, 2: 10, 3: 30};

// Уровень освоения появляется после прохождения урока
function initMastery(id){ if (S.learn.done[id] && !S.learn.m[id]) S.learn.m[id] = {lvl: 1, due: dayNum() + LVL_NEXT_DAYS[1]}; }
const _checkLesson6 = checkLesson;
checkLesson = function(id){ _checkLesson6(id); initMastery(id); save(); };

// ───────── Узлы дерева ─────────
const examId = mid => 'ex-' + mid;
const moduleOf = id => COURSE.find(m => m.lessons.some(l => l.id === id) || examId(m.id) === id);
const ORDER = ['root', ...COURSE.flatMap(m => [...m.lessons.map(l => l.id), examId(m.id)]), 'final'];
function prereqOf(id){
  if (id === 'root') return [];
  if (id === 'final') return COURSE.map(m => examId(m.id));
  if (id.startsWith('ex-')) { const m = COURSE.find(x => examId(x.id) === id); return m.lessons.map(l => l.id); }
  return TREE_PREREQ[id] || ['root'];
}
const examBest = mid => S.learn.exams[mid]?.best || 0;
function nodeState(id){
  if (id === 'root') return 'mastered';
  let done, mastered;
  if (id === 'final') { done = COURSE.every(m => examBest(m.id) >= 0.7); mastered = done && COURSE.every(m => examBest(m.id) >= 0.85); }
  else if (id.startsWith('ex-')) { const b = examBest(id.slice(3)); done = b >= 0.7; mastered = b >= 0.85; }
  else { done = !!S.learn.done[id]; mastered = (S.learn.m[id]?.lvl || 0) >= 3; }
  if (done) return mastered ? 'mastered' : 'learned';
  return prereqOf(id).every(p => ['learned', 'mastered'].includes(nodeState(p))) ? 'available' : 'locked';
}
const nextNode = () => ORDER.find(id => nodeState(id) === 'available');
function nodeInfo(id){
  if (id === 'root') return {icon: '🌱', title: 'Начало пути', short: 'Старт'};
  if (id === 'final') return {icon: '⭐', title: 'Готов к стажировке', short: 'Готов к стажировке'};
  const m = moduleOf(id);
  if (id.startsWith('ex-')) return {icon: '🏆', title: `Экзамен: ${m.title}`, short: 'Экзамен', module: m};
  const l = lessonById(id); return {icon: m.icon, title: l.title, short: l.title, module: m, lesson: l};
}

// ───────── Раскладка дерева: колонка = глубина, строка = ветка ─────────
function treeLayout(){
  const depth = {}, row = {}, taken = {}; let maxRow = 0;
  const d = id => depth[id] ?? (depth[id] = id === 'root' ? 0 : 1 + Math.max(...prereqOf(id).map(d)));
  ORDER.forEach(id => {
    d(id);
    if (id === 'root') { row[id] = 0; return; }
    const parent = id === 'final' ? null : id.startsWith('ex-') ? prereqOf(id).slice(-1)[0] : prereqOf(id)[0];
    if (parent && !taken[parent]) { row[id] = row[parent]; taken[parent] = true; }
    else row[id] = ++maxRow;
  });
  row.final = 0;
  return {depth, row, maxRow, maxDepth: Math.max(...Object.values(depth))};
}
let treeSel = null;
function wrap2(t, n = 15){
  const w = t.split(' '), lines = ['']; w.forEach(x => { if ((lines[lines.length - 1] + ' ' + x).trim().length > n && lines.length < 2) lines.push(x); else lines[lines.length - 1] = (lines[lines.length - 1] + ' ' + x).trim(); });
  if (lines[1] && lines[1].length > n) lines[1] = lines[1].slice(0, n - 1) + '…';
  return lines;
}
function treeSvg(){
  const L = treeLayout(), CW = 124, RH = 104, N = 52, PX = 20, PY = 16;
  const x = id => PX + L.depth[id] * CW, y = id => PY + L.row[id] * RH;
  const nx = nextNode();
  const W = PX * 2 + L.maxDepth * CW + N + 60, H = PY * 2 + L.maxRow * RH + N + 36;
  let lines = '', nodes = '';
  ORDER.forEach(id => prereqOf(id).forEach(p => {
    if (id === 'final' || (id.startsWith('ex-') && p !== prereqOf(id).slice(-1)[0])) return;
    const x1 = x(p) + N, y1 = y(p) + N / 2, x2 = x(id), y2 = y(id) + N / 2, mid = x1 + (x2 - x1) / 2;
    const st = nodeState(id);
    lines += `<path d="M${x1},${y1} H${mid} V${y2} H${x2}" class="tl-line ${st}"/>`;
  }));
  // к финалу — от всех экзаменов пунктиром
  COURSE.forEach(m => { const e = examId(m.id), x1 = x(e) + N, y1 = y(e) + N / 2, x2 = x('final'), y2 = y('final') + N / 2, mid = x2 - 26;
    lines += `<path d="M${x1},${y1} H${mid} V${y2} H${x2}" class="tl-line dash ${nodeState(e) === 'locked' ? 'locked' : 'learned'}"/>`; });
  ORDER.forEach(id => {
    const st = nodeState(id), inf = nodeInfo(id), lbl = wrap2(inf.short), lv = S.learn.m[id]?.lvl || 0;
    const due = S.learn.m[id] && S.learn.m[id].due <= dayNum();
    nodes += `<g class="tn ${st} ${treeSel === id ? 'sel' : ''} ${id === nx ? 'next' : ''}" onclick="treeSel='${id}';render()" transform="translate(${x(id)},${y(id)})">
      <title>${esc(inf.title)} — ${{locked: 'закрыто', available: 'доступно', learned: 'изучено', mastered: 'освоено'}[st]}</title>
      ${id === nx ? `<rect x="-6" y="-6" width="${N + 12}" height="${N + 12}" rx="10" class="glow"/>` : ''}
      <rect width="${N}" height="${N}" rx="${id.startsWith('ex-') || id === 'final' ? 14 : 6}" class="frame"/>
      <text x="${N / 2}" y="${N / 2 + 7}" text-anchor="middle" class="ico">${st === 'locked' ? '🔒' : inf.icon}</text>
      ${lv ? `<text x="${N - 3}" y="${N - 3}" text-anchor="end" class="stars">${'★'.repeat(lv)}</text>` : ''}
      ${due ? `<circle cx="${N - 2}" cy="2" r="6" class="duedot"/>` : ''}
      ${lbl.map((t, i) => `<text x="${N / 2}" y="${N + 14 + i * 12}" text-anchor="middle" class="lbl">${esc(t)}</text>`).join('')}
    </g>`;
  });
  return `<div class="treewrap"><svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" class="tree" role="img" aria-label="Дерево навыков">${lines}${nodes}</svg></div>`;
}
function treePanel(){
  const id = treeSel || nextNode() || 'final', st = nodeState(id), inf = nodeInfo(id), mm = S.learn.m[id];
  const pre = prereqOf(id).filter(p => p !== 'root' && !['learned', 'mastered'].includes(nodeState(p)));
  let act = '';
  if (inf.lesson) act = `<button class="btn" onclick="openLesson('${id}')">${S.learn.done[id] ? 'Открыть урок' : 'Начать урок'}</button>${mm && mm.due <= dayNum() ? `<button class="btn ghost" onclick="openReview('${id}')">🔁 Повторить</button>` : ''}`;
  else if (id.startsWith('ex-')) { const mid = id.slice(3); act = `<button class="btn" onclick="openExam('${mid}')" ${st === 'locked' ? 'disabled' : ''}>${examBest(mid) ? 'Пересдать экзамен' : 'Сдать экзамен'}</button>${examBest(mid) >= 0.7 ? `<button class="btn ghost" onclick="openCert('${mid}')">📜 Сертификат</button>` : ''}`; }
  return `<div class="card tpanel"><div class="row" style="gap:12px"><span class="tico ${st}">${inf.icon}</span><div><div class="small muted">${inf.module ? esc(inf.module.title) : 'Курс'}</div><h2 style="margin:0">${esc(inf.title)}</h2></div></div>
  <p><b>${{locked: '🔒 Закрыто', available: '▶ Доступно', learned: '✅ Изучено', mastered: '🏅 Освоено'}[st]}</b>${id === nextNode() ? ' · <span class="good">следующий шаг по программе</span>' : ''}</p>
  ${mm ? `<p class="small">Уровень: ${'★'.repeat(mm.lvl)}${'☆'.repeat(3 - mm.lvl)} ${LVL[mm.lvl]} · ${mm.due <= dayNum() ? '<b>пора повторить</b>' : `повторение ${keyOfNum(mm.due)}`}</p>` : ''}
  ${id.startsWith('ex-') && examBest(id.slice(3)) ? `<p class="small">Лучший результат: ${Math.round(examBest(id.slice(3)) * 100)}%</p>` : ''}
  ${pre.length ? `<p class="small muted">Сначала: ${pre.map(p => esc(nodeInfo(p).title)).join(', ')}</p>` : ''}
  ${inf.lesson?.practice?.length ? `<p class="small muted">Открывает практику: ${inf.lesson.practice.filter(t => ITEMS[t]).map(t => esc(ITEMS[t].title)).join(', ')}</p>` : ''}
  ${id === 'final' ? `<p class="small">Сдайте экзамены всех ${COURSE.length} модулей на 70%+ — и вы готовы к стажировке. Сейчас сдано: ${COURSE.filter(m => examBest(m.id) >= 0.7).length}/${COURSE.length}.</p>` : ''}
  <div class="row">${act}</div></div>`;
}

// ───────── Повторение уроков ─────────
const dueReviews = () => LESSON_LIST.filter(l => S.learn.m[l.id] && S.learn.m[l.id].due <= dayNum());
let curReview = null; const RBUSY = {};
async function openReview(id){
  curReview = id; const R = S.learn.rq[id];
  if (!R || R.checked) {
    const l = lessonById(id);
    S.learn.rq[id] = {qs: null, ans: {}, checked: false};
    go('review');
    if (AI.enabled) {
      RBUSY[id] = true; render();
      try { const qs = await AI.lessonQuiz(l.title, l.body, l.check.map(q => q.q)); if (qs?.length >= 2 && qs.every(q => q.o?.length === 4 && q.a >= 0 && q.a <= 3)) S.learn.rq[id].qs = qs; } catch (e) { toast('ИИ недоступен — повторяем по вопросам урока'); }
      RBUSY[id] = false;
    }
    if (!S.learn.rq[id].qs) S.learn.rq[id].qs = l.check;
    save(); render(); return;
  }
  go('review');
}
function vReview(){
  const l = lessonById(curReview); if (!l) return vLearnTabs();
  const R = S.learn.rq[curReview], mm = S.learn.m[curReview] || {lvl: 1};
  lastList = 'review';
  if (RBUSY[curReview] || !R?.qs) return `<h1>Повторение: ${esc(l.title)}</h1>${loadingCard('ИИ составляет новые вопросы по уроку…')}`;
  const ok = R.qs.filter((q, i) => R.ans[i] === q.a).length;
  return `<button class="back" onclick="LTAB='review';go('learn')">← К повторению</button><h1>🔁 ${esc(l.title)}</h1>
  <p class="muted">Текущий уровень: ${'★'.repeat(mm.lvl)}${'☆'.repeat(3 - mm.lvl)} ${LVL[mm.lvl]}. Ответьте без подсказок — так проверяется, что знание осталось в памяти. ${R.qs === l.check ? '' : 'Вопросы новые, составлены ИИ.'}</p>
  <div class="card">${R.qs.map((q, qi) => { const order = shuffleIdx(q.o.length, curReview + today() + qi);
    return `<div class="asq"><b>${qi + 1}. ${esc(q.q)}</b>${order.map(oi => { let cls = ''; if (R.checked) { if (oi === q.a) cls = 'right'; else if (R.ans[qi] === oi) cls = 'wrong'; }
      return `<label class="opt ${cls}"><input type="radio" name="rq${qi}" ${R.ans[qi] === oi ? 'checked' : ''} ${R.checked ? 'disabled' : ''} onchange="S.learn.rq['${curReview}'].ans[${qi}]=${oi};save()"> ${esc(q.o[oi])}</label>`; }).join('')}${R.checked ? `<p class="small muted">💡 ${esc(q.e)}</p>` : ''}</div>`; }).join('')}
  ${R.checked ? `<p class="${ok >= R.qs.length - 1 ? 'good' : 'err'}"><b>${ok} из ${R.qs.length}.</b> ${R.result}</p><div class="row"><button class="btn" onclick="nextReview()">Дальше</button><button class="btn ghost" onclick="openLesson('${curReview}')">Перечитать урок</button></div>`
  : `<button class="btn" onclick="checkReview()">Проверить</button>`}</div>`;
}
function checkReview(){
  const id = curReview, R = S.learn.rq[id], l = lessonById(id), mm = S.learn.m[id] || (S.learn.m[id] = {lvl: 1, due: dayNum()});
  if (Object.keys(R.ans).length < R.qs.length) { toast('Ответьте на все вопросы'); return; }
  const ok = R.qs.filter((q, i) => R.ans[i] === q.a).length, pass = ok >= R.qs.length - 1;
  R.qs.forEach((q, i) => { if (R.ans[i] !== q.a) addMistakeCard(`rev:${id}:${q.q.slice(0, 40)}`, q.q + '\n\n' + q.o.map((o, k) => `${'АБВГ'[k]}) ${o}`).join('\n'), `Правильно: ${q.o[q.a]}\n\n${q.e}`, l.module.cat); });
  if (pass) { const before = mm.lvl; mm.lvl = Math.min(3, mm.lvl + 1); mm.due = dayNum() + (before === 3 ? 60 : LVL_NEXT_DAYS[mm.lvl]); R.result = before < 3 ? `Уровень повышен: ${LVL[mm.lvl]}! Следующее повторение через ${mm.due - dayNum()} дн.` : `Знание держится. Следующее повторение через ${mm.due - dayNum()} дн.`; }
  else { mm.due = dayNum() + 1; R.result = 'Пока не закрепилось — перечитайте урок, повторим завтра.'; }
  R.checked = true;
  const pid = `review@${id}@${today()}`; ensurePseudo(pid, 'review', 'Повторение: ' + l.title); ITEMS[pid].cat = l.module.cat;
  timers[pid] = timers[pid] || Date.now() - 60000; complete(pid, ok / R.qs.length);
  logEvent(`Повторение урока «${l.title}»: ${ok}/${R.qs.length}`); save(); render();
}
function nextReview(){ const n = dueReviews()[0]; if (n) openReview(n.id); else { LTAB = 'review'; go('learn'); } }

// ───────── Входная диагностика ─────────
let DG = null;
const diagQuestions = () => COURSE.flatMap(m => { const ls = m.lessons; return [0, 1, 2].map(i => { const l = ls[i % ls.length], q = l.check[Math.floor(i / ls.length) % l.check.length]; return {mid: m.id, lid: l.id, ...q}; }); });
function vDiag(){
  const qs = diagQuestions(), last = S.learn.diag;
  if (!DG && last) {
    return `<div class="card"><h2>Результат диагностики (${last.date})</h2>${COURSE.map(m => { const s = last.modules[m.id]; return `<div class="comp"><span>${m.icon} ${esc(m.title)}</span><div class="bar"><i style="width:${s / 3 * 100}%"></i></div><span class="small ${s >= 2 ? 'good' : 'muted'}">${s}/3 ${s >= 2 ? '— знаете' : '— изучить'}</span></div>`; }).join('')}
    <p class="small muted">Модули, где вы ответили на 2+ из 3, отмечены как изученные — их уроки придут на повторение, чтобы подтвердить знания.</p><button class="btn ghost" onclick="DG={ans:{}};render()">Пройти заново</button></div>`;
  }
  if (!DG) return `<div class="card"><h2>🎯 Входная диагностика</h2><p>${qs.length} вопросов по всем модулям, около 15 минут. Модули, которые вы уже знаете, отметятся как изученные, и дерево покажет, с чего начинать именно вам.</p><p class="small muted">Отвечайте честно, без поиска: если не знаете — выбирайте «наугад» не нужно, просто пропустите вопрос.</p><button class="btn" onclick="DG={ans:{}};render()">Начать</button></div>`;
  return `<div class="card"><h2>Диагностика</h2>${COURSE.map(m => `<h3>${m.icon} ${esc(m.title)}</h3>${qs.map((q, qi) => q.mid !== m.id ? '' : `<div class="asq"><b>${esc(q.q)}</b>${shuffleIdx(q.o.length, 'dg' + qi).map(oi => `<label class="opt"><input type="radio" name="dg${qi}" ${DG.ans[qi] === oi ? 'checked' : ''} onchange="DG.ans[${qi}]=${oi}"> ${esc(q.o[oi])}</label>`).join('')}</div>`).join('')}`).join('')}
  <button class="btn" onclick="finishDiag()">Завершить диагностику</button></div>`;
}
function finishDiag(){
  const qs = diagQuestions(), mods = {};
  COURSE.forEach(m => mods[m.id] = 0);
  qs.forEach((q, i) => { if (DG.ans[i] === q.a) mods[q.mid]++; });
  S.learn.diag = {date: today(), modules: mods};
  COURSE.forEach(m => { if (mods[m.id] >= 2) m.lessons.forEach(l => { if (!S.learn.done[l.id]) { S.learn.done[l.id] = today(); S.learn.diagDone[l.id] = true; initMastery(l.id); } }); });
  logEvent(`Входная диагностика: знакомых модулей ${Object.values(mods).filter(v => v >= 2).length} из ${COURSE.length}`);
  DG = null; save(); LTAB = 'tree'; treeSel = null; render(); toast('Готово! Дерево навыков обновлено под ваш уровень');
}

// ───────── Экзамены модулей и сертификаты ─────────
let curExam = null; const EX = {};
function openExam(mid){ curExam = mid; EX[mid] = EX[mid] || {sel: {}, sqlOk: {}, fails: {}, checks: [], attempt: (S.learn.exams[mid]?.attempts || 0)}; timers['exam@' + mid] = Date.now(); go('exam'); }
const examMcq = (m, attempt) => { const all = m.lessons.flatMap(l => l.check.map(q => ({...q, lid: l.id}))); return shuffleIdx(all.length, m.id + 'att' + attempt).slice(0, Math.min(5, all.length)).map(i => all[i]); };
function vExam(){
  const m = COURSE.find(x => x.id === curExam); if (!m) return vLearnTabs();
  const E = EXAMS[m.id], X = EX[m.id], st = nodeState(examId(m.id)), mcq = examMcq(m, X.attempt);
  lastList = 'exam';
  if (st === 'locked') return `<button class="back" onclick="go('learn')">← Обучение</button><h1>🏆 Экзамен: ${esc(m.title)}</h1><div class="card"><p>Экзамен откроется, когда будут пройдены все уроки модуля:</p>${m.lessons.map(l => `<div class="lrow" onclick="openLesson('${l.id}')"><span>${S.learn.done[l.id] ? '✅' : '⬜'}</span><span class="lt">${esc(l.title)}</span></div>`).join('')}</div>`;
  if (X.result) return `<button class="back" onclick="go('learn')">← Обучение</button><h1>🏆 Результат: ${esc(m.title)}</h1>
    <div class="kpis"><div class="kpi"><b>${X.result.total}%</b><span>итог</span></div><div class="kpi"><b>${X.result.open}%</b><span>${E.sql ? 'SQL-задачи' : 'практическое задание'}</span></div><div class="kpi"><b>${X.result.mcq}%</b><span>теория</span></div></div>
    ${X.review ? reviewHtml(X.review) : ''}
    ${X.result.total >= 70 ? `<div class="card note"><b>🎉 Экзамен сдан!</b> ${X.result.total >= 85 ? 'Модуль освоен на «золото».' : 'Наберите 85%+ при пересдаче, чтобы получить «золото».'}</div><div class="row"><button class="btn" onclick="openCert('${m.id}')">📜 Открыть сертификат</button><button class="btn ghost" onclick="LTAB='tree';go('learn')">К дереву навыков</button></div>`
    : `<div class="card"><p>Нужно 70% для сдачи. Повторите уроки модуля и попробуйте снова — вопросы будут другими.</p><div class="row"><button class="btn" onclick="EX['${m.id}']=null;openExam('${m.id}')">Пересдать</button><button class="btn ghost" onclick="LTAB='list';go('learn')">К урокам</button></div></div>`}`;
  return `<button class="back" onclick="go('learn')">← Обучение</button><h1>🏆 Экзамен: ${esc(m.title)}</h1>
  <p class="muted">Две части: ${E.sql ? '3 SQL-задачи с автопроверкой' : 'практическое задание'} (60% оценки) и ${mcq.length} вопросов по урокам (40%). Порог сдачи — 70%, «золото» — 85%. Без подсказок наставника.</p>
  <div class="card"><h2>1. ${E.sql ? 'SQL' : 'Практическое задание'}</h2>
  ${E.sql ? `<p class="small muted">${SCHEMA_HTML}</p>` + E.sql.map((t, i) => `<div class="astask"><b>${i + 1}. ${esc(t.title)}</b><p>${esc(t.task)}</p><textarea id="exs${i}" rows="3" class="mono" ${X.sqlOk[i] != null ? 'disabled' : ''} oninput="saveDraft('exam-${m.id}-${i}',this.value)">${esc(S.drafts[`exam-${m.id}-${i}`] || '')}</textarea>
    ${X.sqlOk[i] != null ? '<p class="good small">✓ Верно</p>' : `<button class="btn sm" onclick="examSql('${m.id}',${i})">Проверить</button> <span class="small muted">${X.fails[i] ? `неверно, попыток: ${X.fails[i]}` : ''}</span>`}</div>`).join('')
  : `<p class="pre">${esc(E.task)}</p><textarea rows="12" oninput="saveDraft('exam-${m.id}',this.value)" placeholder="Ваш ответ…">${esc(S.drafts['exam-' + m.id] || '')}</textarea>
    ${X.selfCheck ? `<h3>Самопроверка</h3>${E.checklist.map((c, i) => `<label class="chk"><input type="checkbox" onchange="EX['${m.id}'].checks[${i}]=this.checked"> ${esc(c)}</label>`).join('')}` : ''}`}</div>
  <div class="card"><h2>2. Теория</h2>${mcq.map((q, qi) => `<div class="asq"><b>${qi + 1}. ${esc(q.q)}</b>${shuffleIdx(q.o.length, m.id + 'ex' + X.attempt + qi).map(oi => `<label class="opt"><input type="radio" name="ex${qi}" ${X.sel[qi] === oi ? 'checked' : ''} onchange="EX['${m.id}'].sel[${qi}]=${oi}"> ${esc(q.o[oi])}</label>`).join('')}</div>`).join('')}</div>
  <button class="btn" onclick="finishExam('${m.id}')" ${X.busy ? 'disabled' : ''}>${X.busy ? 'Проверяю…' : X.selfCheck ? 'Подтвердить и завершить' : 'Завершить экзамен'}</button>`;
}
async function examSql(mid, i){
  const t = EXAMS[mid].sql[i], q = document.getElementById('exs' + i).value, X = EX[mid];
  try { await initSQL(); } catch (e) { toast('SQL-движок не загрузился'); return; }
  let ok = false; try { ok = sqlMatches(runSql(q), runSql(t.ref), t.ref); } catch (e) {}
  if (ok) X.sqlOk[i] = Math.max(0.4, 1 - 0.2 * (X.fails[i] || 0)); else X.fails[i] = (X.fails[i] || 0) + 1;
  render();
}
async function finishExam(mid){
  const m = COURSE.find(x => x.id === mid), E = EXAMS[mid], X = EX[mid], mcq = examMcq(m, X.attempt);
  if (Object.keys(X.sel).length < mcq.length) { toast('Ответьте на все вопросы теории'); return; }
  let open;
  if (E.sql) open = E.sql.reduce((a, _, i) => a + (X.sqlOk[i] || 0), 0) / E.sql.length;
  else {
    const ans = (S.drafts['exam-' + mid] || '').trim();
    if (ans.length < 60) { toast('Ответ на практическое задание слишком короткий'); return; }
    if (AI.enabled) { X.busy = true; render(); try { X.review = await AI.review({title: 'Экзамен: ' + m.title, task: E.task, checklist: E.checklist}, ans); open = X.review.score / 100; } catch (e) { X.busy = false; toast('Ошибка ИИ: ' + e.message + '. Можно оценить самостоятельно.'); X.selfCheck = true; render(); return; } X.busy = false; }
    else if (!X.selfCheck) { X.selfCheck = true; render(); toast('Отметьте критерии самопроверки и подтвердите'); return; }
    else open = E.checklist.filter((_, i) => X.checks[i]).length / E.checklist.length;
  }
  const mq = mcq.filter((q, i) => X.sel[i] === q.a).length / mcq.length;
  mcq.forEach((q, i) => { if (X.sel[i] !== q.a) addMistakeCard(`${q.lid}:ex:${q.q.slice(0, 30)}`, q.q + '\n\n' + q.o.map((o, k) => `${'АБВГ'[k]}) ${o}`).join('\n'), `Правильно: ${q.o[q.a]}\n\n${q.e}`, m.cat); });
  const total = 0.6 * open + 0.4 * mq, prev = S.learn.exams[mid] || {};
  S.learn.exams[mid] = {best: Math.max(total, prev.best || 0), last: total, date: total > (prev.best || 0) ? today() : prev.date, attempts: (prev.attempts || 0) + 1};
  X.result = {total: Math.round(total * 100), open: Math.round(open * 100), mcq: Math.round(mq * 100)};
  const pid = `exam@${mid}@${S.learn.exams[mid].attempts}`; ensurePseudo(pid, 'exam', 'Экзамен: ' + m.title); ITEMS[pid].cat = m.cat;
  timers[pid] = timers['exam@' + mid]; complete(pid, total);
  logEvent(`Экзамен «${m.title}»: ${X.result.total}%${total >= 0.7 ? ' — сдан' : ''}`);
  save(); render();
}
let curCert = null;
function openCert(mid){ curCert = mid; go('cert'); }
function certCode(mid){ const e = S.learn.exams[mid]; let h = 0; for (const c of mid + e.date + Math.round(e.best * 100) + (S.settings.name || '')) h = (h * 31 + c.charCodeAt(0)) >>> 0; return 'SA-' + h.toString(36).toUpperCase().padStart(7, '0'); }
function vCert(){
  const m = COURSE.find(x => x.id === curCert), e = S.learn.exams[curCert];
  if (!m || !e || e.best < 0.7) return vLearnTabs();
  return `<div class="noprint"><button class="back" onclick="LTAB='tree';go('learn')">← Дерево навыков</button>
  <div class="row"><label>Имя в сертификате <input id="certname" value="${esc(S.settings.name || '')}" placeholder="Имя Фамилия" class="tutq" onchange="S.settings.name=this.value.trim();save();render()"></label><button class="btn" onclick="window.print()">Печать / PDF</button></div></div>
  <div class="cert ${e.best >= 0.85 ? 'gold' : ''}"><div class="cert-top">Тренажёр системного аналитика</div><div class="cert-title">СЕРТИФИКАТ</div>
  <div class="cert-text">подтверждает, что</div><div class="cert-name">${esc(S.settings.name || 'Имя Фамилия')}</div>
  <div class="cert-text">успешно сдал(а) экзамен модуля</div><div class="cert-mod">${m.icon} ${esc(m.title)}</div>
  <div class="cert-text">с результатом <b>${Math.round(e.best * 100)}%</b>${e.best >= 0.85 ? ' — уровень «освоено» 🏅' : ''}</div>
  <div class="cert-list">Темы: ${m.lessons.map(l => esc(l.title)).join(' · ')}</div>
  <div class="cert-foot"><span>Дата: ${e.date}</span><span>Код: ${certCode(curCert)}</span></div></div>`;
}
// Сертификаты — в портфолио
const _exportPortfolio6 = exportPortfolioFull;
exportPortfolioFull = function(){
  const certs = COURSE.filter(m => examBest(m.id) >= 0.7);
  if (certs.length) { const _dl = downloadFile; downloadFile = (name, md) => { downloadFile = _dl; _dl(name, md.replace('## Проект\n', `## Сертификаты курса\n\n${certs.map(m => `- ${m.icon} **${m.title}** — ${Math.round(examBest(m.id) * 100)}%, ${S.learn.exams[m.id].date}, код ${certCode(m.id)}`).join('\n')}\n\n## Проект\n`)); }; }
  _exportPortfolio6();
};

// ───────── Цель дня и напоминания ─────────
const minutesToday = () => Math.round(S.log.filter(e => e.day === today()).reduce((a, e) => a + (e.mins || 0), 0) + (S.cardLog[today()]?.n || 0) * 0.5);
AFTER_RENDER.push(() => {
  const ch = document.getElementById('chips'); if (!ch || ch.querySelector('.goal')) return;
  const m = minutesToday(), g = S.settings.goal || 45, ok = m >= g;
  ch.insertAdjacentHTML('afterbegin', `<span class="chip goal ${ok ? 'ok' : ''}" title="Цель дня: ${g} минут практики" onclick="go('settings')">🎯 ${Math.min(m, g)}/${g} мин</span>`);
  if (ok && S.settings.goalHit !== today()) { S.settings.goalHit = today(); save(); logEvent(`Цель дня выполнена: ${m} мин`); toast(`🎯 Цель дня выполнена: ${m} минут!`); }
});
setInterval(() => {
  const t = S.settings.remind; if (!t || S.settings.reminded === today()) return;
  const now = new Date(), [h, mi] = t.split(':').map(Number);
  if (now.getHours() * 60 + now.getMinutes() < h * 60 + mi || minutesToday() >= (S.settings.goal || 45)) return;
  S.settings.reminded = today(); save();
  notify(`Цель дня: ${minutesToday()} из ${S.settings.goal} минут. Самое время позаниматься!`);
}, 60000);
function downloadIcs(){
  const t = (S.settings.remind || '19:00').replace(':', ''), d = today().replace(/-/g, ''), url = location.origin + location.pathname;
  const ics = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//SA Trainer//RU', 'BEGIN:VEVENT', `UID:sa-trainer-${d}@local`, `DTSTAMP:${d}T000000`, `DTSTART:${d}T${t}00`, 'DURATION:PT' + (S.settings.goal || 45) + 'M', 'RRULE:FREQ=DAILY',
    'SUMMARY:Тренажёр системного аналитика', `DESCRIPTION:Цель дня — ${S.settings.goal || 45} минут практики. ${url}`, `URL:${url}`, 'BEGIN:VALARM', 'ACTION:DISPLAY', 'DESCRIPTION:Пора заниматься', 'TRIGGER:-PT0M', 'END:VALARM', 'END:VEVENT', 'END:VCALENDAR'].join('\r\n');
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([ics], {type: 'text/calendar'})); a.download = 'sa-trainer-reminder.ics'; a.click();
}
const _vSettings6 = vSettings;
vSettings = function(){
  return _vSettings6().replace('<div class="card"><h2>Режим обучения</h2>', `<div class="card"><h2>Цель дня и напоминания</h2>
  <div class="row"><label>Цель, минут в день <input type="number" min="10" max="300" value="${S.settings.goal || 45}" onchange="S.settings.goal=+this.value;save();render()"></label>
  <label>Напоминание в <input type="time" value="${S.settings.remind || ''}" onchange="S.settings.remind=this.value;S.settings.reminded=null;save();if('Notification' in window&&Notification.permission==='default')Notification.requestPermission()"></label></div>
  <p class="small muted">Напоминание приходит, если сайт открыт во вкладке и цель ещё не выполнена. Надёжнее — добавить ежедневное событие в календарь телефона или компьютера:</p>
  <button class="btn ghost sm" onclick="downloadIcs()">📅 Добавить напоминание в календарь (.ics)</button></div>
  <div class="card"><h2>Режим обучения</h2>`);
};

// ───────── Глоссарий ─────────
let glossQ = '';
function glossList(){
  const q = glossQ.trim().toLowerCase();
  const list = GLOSSARY.filter(g => !q || g[0].toLowerCase().includes(q) || g[1].toLowerCase().includes(q)).sort((a, b) => a[0].localeCompare(b[0], 'ru'));
  return list.length ? list.map(g => `<div class="gl"><b>${esc(g[0])}</b> — ${esc(g[1])} ${lessonById(g[2]) ? `<a href="#" class="small" onclick="openLesson('${g[2]}');return false">урок «${esc(lessonById(g[2]).title)}» →</a>` : ''}</div>`).join('') : '<p class="muted">Ничего не найдено. Спросите наставника в любом уроке.</p>';
}
function vGloss(){ return `<div class="card"><input class="tutq" style="width:100%" placeholder="Поиск термина: идемпотентность, JOIN, p95…" value="${esc(glossQ)}" oninput="glossQ=this.value;document.getElementById('glist').innerHTML=glossList()"><p class="small muted">${GLOSSARY.length} терминов</p><div id="glist">${glossList()}</div></div>`; }

// ───────── Вкладки «Обучения» ─────────
let LTAB = 'tree';
function vLearnTabs(){
  const n = dueReviews().length, done = LESSON_LIST.filter(l => S.learn.done[l.id]).length;
  const tabs = [['tree', '🌳 Дерево навыков'], ['list', '📚 Уроки'], ['review', `🔁 Повторение${n ? ` (${n})` : ''}`], ['gloss', '📖 Глоссарий'], ['diag', '🎯 Диагностика']];
  let body;
  if (LTAB === 'tree') {
    const mastered = LESSON_LIST.filter(l => (S.learn.m[l.id]?.lvl || 0) >= 3).length, certs = COURSE.filter(m => examBest(m.id) >= 0.7).length, nx = nextNode();
    body = `${!done && !S.learn.diag ? `<div class="card note row" style="justify-content:space-between"><span>Уже что-то знаете? Пройдите диагностику — изученные модули откроются сразу.</span><button class="btn sm" onclick="LTAB='diag';render()">Диагностика</button></div>` : ''}
    <div class="kpis"><div class="kpi"><b>${done}/${LESSON_LIST.length}</b><span>уроков изучено</span></div><div class="kpi"><b>${mastered}</b><span>освоено (★★★)</span></div><div class="kpi"><b>${certs}/${COURSE.length}</b><span>сертификатов</span></div><div class="kpi"><b>${n}</b><span>ждут повторения</span></div></div>
    ${nx ? `<div class="card note row" style="justify-content:space-between"><span>▶ <b>Следующий шаг:</b> ${esc(nodeInfo(nx).title)}</span><button class="btn sm" onclick="treeSel='${nx}';${nx.startsWith('ex-') ? `openExam('${nx.slice(3)}')` : `openLesson('${nx}')`}">Перейти</button></div>` : ''}
    <div class="legend small"><span class="lg locked"></span>закрыто <span class="lg available"></span>доступно <span class="lg learned"></span>изучено <span class="lg mastered"></span>освоено <span>★ уровень освоения</span> <span class="duedot-l"></span>пора повторить</div>
    ${treeSvg()}${treePanel()}`;
  } else if (LTAB === 'list') body = vLearn().replace('<h1>Обучение</h1>', '');
  else if (LTAB === 'review') {
    const due = dueReviews(), up = LESSON_LIST.filter(l => S.learn.m[l.id] && S.learn.m[l.id].due > dayNum()).sort((a, b) => S.learn.m[a.id].due - S.learn.m[b.id].due);
    body = `<div class="card"><h2>🔁 Повторение уроков</h2><p class="small muted">Знания забываются, если к ним не возвращаться. Каждый пройденный урок возвращается на короткую проверку через 3, 10 и 30 дней. Успешное повторение повышает уровень: ★ изучено → ★★ закреплено → ★★★ освоено.</p>
    ${due.length ? `<button class="btn" onclick="openReview('${due[0].id}')">Начать повторение (${due.length})</button>${due.map(l => `<div class="lrow" onclick="openReview('${l.id}')"><span>${'★'.repeat(S.learn.m[l.id].lvl)}</span><span class="lt">${esc(l.title)}</span><span class="small err">сегодня</span></div>`).join('')}` : '<p class="good">На сегодня повторять нечего 👍</p>'}
    ${up.length ? `<h3>Скоро</h3>${up.slice(0, 12).map(l => `<div class="lrow" onclick="openLesson('${l.id}')"><span>${'★'.repeat(S.learn.m[l.id].lvl)}${'☆'.repeat(3 - S.learn.m[l.id].lvl)}</span><span class="lt">${esc(l.title)}</span><span class="small muted">${keyOfNum(S.learn.m[l.id].due)}</span></div>`).join('')}` : ''}</div>`;
  } else if (LTAB === 'gloss') body = vGloss();
  else body = vDiag();
  return `<h1>Обучение</h1><div class="row ltabs">${tabs.map(([k, l]) => `<button class="btn sm ${LTAB === k ? '' : 'ghost'}" onclick="LTAB='${k}';render()">${l}</button>`).join('')}</div>${body}`;
}

// Баннер на главном экране: повторение + следующий шаг по дереву
const _learnBanner6 = learnBanner;
learnBanner = function(){
  const n = dueReviews().length;
  return (n ? `<div class="card note row" style="justify-content:space-between"><span>🔁 Пора повторить уроков: <b>${n}</b> — это 2–3 минуты на каждый.</span><button class="btn sm" onclick="openReview('${dueReviews()[0].id}')">Повторить</button></div>` : '') + _learnBanner6();
};

Object.assign(VIEWS, {learn: () => vLearnTabs(), review: () => vReview(), exam: () => vExam(), cert: () => vCert()});
LESSON_LIST.forEach(l => initMastery(l.id));
render();
