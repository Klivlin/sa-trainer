// Наставник для новичка: теория по теме, «как решать», объяснение задачи, ступенчатые подсказки,
// проверка черновика, разбор решения и вопросы — в каждом задании и в тикетах рабочего дня.

S.tutor = S.tutor || {};
if (S.settings.learn === undefined) S.settings.learn = true;
const TUT = {busy: {}, err: {}, open: {}};

// Простая разметка: **жирный**, `код`, ```блоки```, списки «- » и «1. »
function mdLite(t){
  const parts = String(t || '').split(/```(?:\w+)?\n?/);
  return parts.map((p, i) => {
    if (i % 2) return `<pre class="mono small codeblk">${esc(p.replace(/\n$/, ''))}</pre>`;
    let html = '', list = null;
    const close = () => { if (list) { html += list === 'table' ? '</table></div>' : `</${list}>`; list = null; } };
    p.split('\n').forEach(line => {
      const inl = s => esc(s).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/`([^`]+)`/g, '<code>$1</code>');
      let m;
      if (/^\s*\|.*\|\s*$/.test(line)) {
        if (/^\s*\|[\s:|-]+\|\s*$/.test(line)) return;
        const cells = line.trim().slice(1, -1).split('|').map(c => inl(c.trim()));
        if (list !== 'table') { close(); html += '<div class="tw"><table>' + `<tr>${cells.map(c => `<th>${c}</th>`).join('')}</tr>`; list = 'table'; }
        else html += `<tr>${cells.map(c => `<td>${c}</td>`).join('')}</tr>`;
        return;
      }
      if ((m = line.match(/^\s*>\s?(.*)/))) { close(); html += `<blockquote>${inl(m[1])}</blockquote>`; }
      else if ((m = line.match(/^\s*#{1,6}\s+(.*)/))) { close(); html += `<h4>${inl(m[1])}</h4>`; }
      else if (/^\s*(---+|\*\*\*+)\s*$/.test(line)) { close(); html += '<hr>'; }
      else if ((m = line.match(/^\s*[-•*]\s+(.*)/))) { if (list !== 'ul') { close(); html += '<ul>'; list = 'ul'; } html += `<li>${inl(m[1])}</li>`; }
      else if ((m = line.match(/^\s*\d+[.)]\s+(.*)/))) { if (list !== 'ol') { close(); html += '<ol>'; list = 'ol'; } html += `<li>${inl(m[1])}</li>`; }
      else if (!line.trim()) close();
      else { close(); html += `<p>${inl(line)}</p>`; }
    });
    close(); return html;
  }).join('');
}

function tutorCtx(it){
  const c = {title: it.title, kind: KIND_LABEL[it.kind] || it.kind, cat: it.cat, scenario: strip(it.scenario || it.ctx || it.persona || ''), task: it.task || it.title, hint: it.hint || '', checklist: it.checklist || []};
  if (it.kind === 'sql') { c.reference = it.ref; c.extra = 'Диалект SQLite. Схема БД:\n' + SQL_SCHEMA.replace(/INSERT INTO[\s\S]*?;/g, '').trim(); }
  else if (it.kind === 'diagram') { c.reference = 'Код Mermaid:\n' + it.reference; c.extra = 'Ученик пишет диаграмму на языке Mermaid. Обязательные элементы: ' + it.required.map(r => r[0]).join('; '); }
  else if (it.kind === 'openapi') { c.extra = 'Ученик пишет спецификацию OpenAPI 3 в YAML. Нужно: ' + it.checks.paths.map(p => `${p[1].toUpperCase()} ${p[0]} (ответы ${p[2].join(', ')})`).join('; ') + '; схемы ' + it.checks.schemas.join(', '); c.reference = 'Пример стартового шаблона:\n' + OPENAPI_STARTER; }
  else if (it.kind === 'interview') c.reference = it.answer;
  else if (it.kind === 'quiz') c.extra = 'Вопросы теста: ' + it.questions.map(q => q.q).join(' | ');
  else if (it.kind === 'inbox') c.extra = 'Шаги ситуации: ' + it.steps.map(s => `${s.from}: ${s.text}`).join(' | ');
  else if (it.kind === 'elicit') c.extra = 'Это интервью с заказчиком: ученик задаёт вопросы, персонаж раскрывает скрытые факты. Скрытые факты НЕ называй.';
  else c.reference = strip(it.reference || '');
  return c;
}
const HAS_SOLUTION = it => ['case', 'stage', 'sql', 'diagram', 'interview', 'openapi'].includes(it.kind);
const T_ = id => (S.tutor[id] = S.tutor[id] || {hints: [], chat: []});

async function askTutor(id, mode){
  const it = ITEMS[id], T = T_(id);
  if (mode === 'hint' && T.hints.length >= 3) return;
  const opts = {};
  if (mode === 'hint') { opts.n = T.hints.length + 1; opts.prevHints = T.hints; }
  if (mode === 'check') { opts.draft = (S.drafts[id] || '').trim(); if (opts.draft.length < 20) { toast('Сначала напишите хотя бы черновик'); return; } }
  if (mode === 'ask') {
    const q = document.getElementById('tutq')?.value.trim(); if (!q) return;
    T.chat.push({who: 'me', text: q}); opts.history = T.chat;
  }
  TUT.busy[id] = mode; TUT.err[id] = null; TUT.open[id] = true; render();
  try {
    const r = await AI.tutor(tutorCtx(it), mode, opts);
    if (mode === 'explain') T.explain = r.text;
    if (mode === 'hint') { T.hints.push(r.text); T.hintsUsed = (T.hintsUsed || 0) + 1; }
    if (mode === 'solution') { T.solution = r.text; T.solSeen = true; }
    if (mode === 'check') T.check = r.text;
    if (mode === 'ask') T.chat.push({who: 'them', text: r.text});
  } catch (e) { TUT.err[id] = e.message; if (mode === 'ask') T.chat.pop(); }
  TUT.busy[id] = null; save(); render();
}
function showStaticSolution(id){ const T = T_(id); T.staticSol = true; T.solSeen = true; TUT.open[id] = true; save(); render(); }
function staticSolutionHtml(it){
  if (it.kind === 'sql') return `<pre class="mono small codeblk">${esc(it.ref)}</pre>`;
  if (it.kind === 'diagram') return `<pre class="mono small codeblk">${esc(it.reference)}</pre><div class="mmd" data-src="${encodeURIComponent(it.reference)}"></div>`;
  if (it.kind === 'interview') return `<p>${esc(it.answer)}</p>`;
  if (it.kind === 'openapi') return `<p>Эталонного YAML нет — ориентируйтесь на критерии:</p><ul>${it.checklist.map(c => `<li>${esc(c)}</li>`).join('')}</ul>`;
  return `<div class="txt">${it.reference || ''}</div>`;
}
function penaltyNote(id){
  const T = S.tutor[id] || {};
  const parts = [];
  if (T.solSeen) parts.push('открыт разбор решения — максимум 60% за задачу');
  if (T.hintsUsed) parts.push(`подсказок: ${T.hintsUsed} (−10% за каждую)`);
  return parts.length ? `<p class="small muted">ℹ️ ${parts.join('; ')}. Это честная отметка в прогрессе: разобранная задача вернётся к вам позже, чтобы вы решили её сами.</p>` : '';
}

function mentorPanel(it){
  const T = S.tutor[it.id] || {hints: [], chat: []}, busy = TUT.busy[it.id], ai = AI.enabled;
  const isOpen = TUT.open[it.id] ?? (S.settings.learn && !S.results[it.id]);
  const lesson = LESSONS[it.cat], guide = KIND_GUIDES[it.kind];
  const b = (mode, label, cls = 'ghost') => `<button class="btn sm ${cls}" onclick="askTutor('${it.id}','${mode}')" ${busy ? 'disabled' : ''}>${busy === mode ? '⏳ Думаю… (до минуты)' : label}</button>`;
  return `<details class="card mentor" ${isOpen ? 'open' : ''} ontoggle="TUT.open['${it.id}']=this.open">
  <summary><b>🎓 Наставник</b> <span class="muted small">— теория, как решать, подсказки и разбор</span></summary>
  ${guide ? `<details class="sub" ${!S.results[it.id] && S.settings.learn ? 'open' : ''}><summary>📋 Как решать такие задания</summary>${mdLite(guide)}</details>` : ''}
  ${lesson ? `<details class="sub"><summary>📘 Теория: ${esc(it.cat)}</summary>${mdLite(lesson)}</details>` : ''}
  <div class="row">
    ${ai ? b('explain', '🧭 Объясни задачу простыми словами', T.explain ? 'ghost' : '') : ''}
    ${ai && !['quiz', 'inbox'].includes(it.kind) ? b('hint', T.hints.length >= 3 ? 'Подсказки закончились' : `💡 Подсказка ${T.hints.length + 1}/3`) : ''}
    ${ai && ['case', 'stage', 'diagram', 'openapi', 'sql', 'interview'].includes(it.kind) ? b('check', '🔍 Проверь мой черновик') : ''}
    ${HAS_SOLUTION(it) ? (ai ? b('solution', '📖 Разбор решения') : `<button class="btn sm ghost" onclick="showStaticSolution('${it.id}')">📖 Показать решение</button>`) : ''}
  </div>
  ${!ai ? `<p class="small muted">Подключите бесплатный ИИ во вкладке «Настройки» — наставник сможет объяснять задачу простыми словами, давать подсказки, проверять черновик и отвечать на вопросы.</p>` : ''}
  ${TUT.err[it.id] ? `<p class="err small">${esc(TUT.err[it.id])}</p>` : ''}
  ${T.explain ? `<div class="tut"><h3>🧭 О чём задача и как к ней подступиться</h3>${mdLite(T.explain)}</div>` : ''}
  ${T.hints.map((h, i) => `<div class="tut hint"><h3>💡 Подсказка ${i + 1}</h3>${mdLite(h)}</div>`).join('')}
  ${T.check ? `<div class="tut"><h3>🔍 Отзыв на черновик</h3>${mdLite(T.check)}</div>` : ''}
  ${T.solution ? `<div class="tut sol"><h3>📖 Разбор решения</h3>${mdLite(T.solution)}</div>` : ''}
  ${T.staticSol && !T.solution ? `<div class="tut sol"><h3>📖 Решение</h3>${staticSolutionHtml(it)}${LESSONS[it.cat] ? '<p class="small muted">Почему так — см. «Теория» выше.</p>' : ''}</div>` : ''}
  ${(T.solution || T.staticSol) && ['case', 'stage', 'sql', 'diagram', 'openapi', 'interview'].includes(it.kind) ? `<p class="small"><b>Что дальше:</b> закройте разбор и напишите решение <b>своими словами</b> в поле ниже — так знание закрепится лучше, чем от чтения.</p>` : ''}
  ${penaltyNote(it.id)}
  ${ai ? `<div class="tutchat">${T.chat.map(m => `<div class="bubble ${m.who}">${m.who === 'me' ? esc(m.text) : mdLite(m.text)}</div>`).join('')}
  <div class="row"><input id="tutq" class="tutq" placeholder="Спросите наставника: что такое идемпотентность? с чего начать?" onkeydown="if(event.key==='Enter')askTutor('${it.id}','ask')"><button class="btn sm" onclick="askTutor('${it.id}','ask')" ${busy ? 'disabled' : ''}>${busy === 'ask' ? '⏳' : 'Спросить'}</button></div></div>` : ''}
  </details>`;
}

// Встраиваем панель во все типы заданий
const _baseViews = {...TASK_VIEWS};
Object.keys(_baseViews).forEach(k => TASK_VIEWS[k] = it => mentorPanel(it) + _baseViews[k](it));

// Учёт помощи в баллах: разбор — максимум 60%, подсказка — минус 10% (не ниже 30%)
const _complete4 = complete;
complete = function(id, score, extra = {}){
  const T = S.tutor[id];
  if (T && (T.solSeen || T.hintsUsed)) {
    let s = score * (1 - 0.1 * (T.hintsUsed || 0));
    if (T.solSeen) s = Math.min(s, 0.6);
    score = Math.max(Math.min(score, 0.3), s);
    extra = {...extra, assisted: true};
    T.solSeen = false; T.hintsUsed = 0;
  }
  _complete4(id, score, extra);
};

// В тикете дня — вход «не знаю, как подступиться»
function openLearn(id){
  TUT.open[id] = true; openTask(id);
  if (AI.enabled && !S.tutor[id]?.explain) askTutor(id, 'explain');
}
const _phasePanel4 = phasePanel;
phasePanel = function(ph, p, D){
  let h = _phasePanel4(ph, p, D);
  if (ph.key === 'tk' && !phaseDone(ph)) h += `<div class="card note row"><span>Не знаете, как подступиться? Наставник объяснит задачу простыми словами, даст теорию и подсказки.</span><button class="btn sm" onclick="openLearn('${ph.id}')">📘 Открыть с объяснением</button></div>`;
  return h;
};

// Переключатель режима обучения в настройках
const _vSettings4 = vSettings;
vSettings = function(){
  return _vSettings4().replace('<div class="card"><h2>Данные</h2>', `<div class="card"><h2>Режим обучения</h2>
  <label class="chk"><input type="checkbox" ${S.settings.learn ? 'checked' : ''} onchange="S.settings.learn=this.checked;save()"> Сразу раскрывать панель наставника и «Как решать» в новых заданиях</label>
  <p class="small muted">Удобно, пока вы осваиваетесь. Позже можно выключить — панель останется доступной, но будет свёрнута.</p></div>
  <div class="card"><h2>Данные</h2>`);
};
render();
