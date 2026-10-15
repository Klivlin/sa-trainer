// Расширения: ИИ-ревью, диаграммы, OpenAPI, интервью с заказчиком, ассессменты,
// матрица компетенций, карьера, спринт и ретро, прерывания, настройки.

// Заглушка до загрузки модуля ai.js (или если CDN недоступен)
window.AI = window.AI || {enabled:false, cfg:{}, MODELS:[]};

// ───────── Регистрация новых заданий и состояния ─────────
[...DIAGRAMS, ...OPENAPI, ...ELICIT].forEach(t => ITEMS[t.id] = t);
Object.assign(KIND_LABEL, {diagram:'Диаграмма', openapi:'OpenAPI', elicit:'Интервью с заказчиком', interrupt:'Прерывание', assess:'Ассессмент', mock:'Пробное собеседование'});
Object.assign(XP_TABLE, {diagram:it=>30+10*it.level, openapi:it=>40+10*it.level, elicit:()=>80, interrupt:()=>10, assess:()=>150, mock:()=>60});
Object.assign(TASK_VIEWS, {diagram:it=>tDiagram(it), openapi:it=>tOpenapi(it), elicit:it=>tElicit(it)});
const ensureState = () => { ['sprints','elicitRun','aiReviews','vacancies'].forEach(k => S[k] = S[k] || {}); ['assess','mocks','interrupts'].forEach(k => S[k] = S[k] || []); };
ensureState();
const strip = s => String(s || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
const loadingCard = t => `<div class="card note">⏳ ${esc(t)}</div>`;
window.addEventListener('ai-ready', () => render());

// ───────── ИИ-ревью ─────────
const AIR = {};
const SEV = {critical:'критично', major:'существенно', minor:'мелочь'};
function reviewHtml(r){
  return `<div class="card aibox"><div class="row"><span class="score ${r.score>=85?'good':r.score>=70?'':'err'}">${r.score}</span><div><b>Ревью наставника (ИИ)</b><div class="muted small">${esc(r.verdict)}</div></div></div>
  ${r.strengths.length?`<h3>Сильные стороны</h3><ul>${r.strengths.map(x=>`<li>${esc(x)}</li>`).join('')}</ul>`:''}
  ${r.issues.length?`<h3>Замечания</h3><ul>${r.issues.map(x=>`<li><span class="tag sev-${x.severity}">${SEV[x.severity]}</span> ${esc(x.text)}</li>`).join('')}</ul>`:''}</div>`;
}
function aiBox(id){
  const a = AIR[id]; if (!a) return '';
  if (a.loading) return loadingCard('Ревьюер читает ваше решение… обычно 20–60 секунд');
  if (a.err) return `<div class="card"><p class="err">Ошибка ИИ: ${esc(a.err)}</p></div>`;
  return reviewHtml(a.res);
}
async function runReview(id, payload, answer){
  AIR[id] = {loading:true}; render();
  try { const res = await AI.review(payload, answer); AIR[id] = {res}; S.aiReviews[id] = {score:res.score, verdict:res.verdict, at:Date.now()}; save(); }
  catch(e){ AIR[id] = {err: e.message}; }
  render(); return AIR[id].res;
}
async function aiReviewCase(id){
  const it = ITEMS[id], ans = (S.drafts[id]||'').trim();
  if (ans.length < 40) { toast('Сначала напишите своё решение'); return; }
  const r = await runReview(id, {title:it.title, task:it.task, context:strip(it.scenario), reference:strip(it.reference), checklist:it.checklist}, ans);
  if (r) { revealed[id] = true; render(); }
}
function finishCaseAI(id){
  const it = ITEMS[id], r = AIR[id].res;
  complete(id, r.score/100, {missed: it.checklist.filter((_,i)=>!r.checklist[i]), ai:true});
  go(lastList);
}
// ИИ-проверка стендапа и отчёта руководителю: проставляет чек-лист
async function aiCheck(id, title, task, checklist){
  const ans = (S.drafts[id]||'').trim(); if (ans.length < 30) { toast('Сначала напишите текст'); return; }
  const r = await runReview(id, {title, task, checklist}, ans);
  if (r) { S.checks[id] = r.checklist; save(); render(); }
}

// ───────── Диаграммы (Mermaid) ─────────
let mermaidReady = null, mmdSeq = 0;
function initMermaid(){
  if (!mermaidReady) mermaidReady = new Promise((ok, fail) => {
    if (window.mermaid) return ok();
    const s = document.createElement('script'); s.src = 'https://cdn.jsdelivr.net/npm/mermaid@10.9.1/dist/mermaid.min.js';
    s.onload = ok; s.onerror = () => fail(new Error('не удалось загрузить Mermaid')); document.head.appendChild(s);
  }).then(() => { const dark = matchMedia('(prefers-color-scheme: dark)').matches; mermaid.initialize({startOnLoad:false, theme: dark ? 'dark' : 'default', securityLevel:'strict'}); });
  return mermaidReady;
}
async function drawMermaid(el, code){
  try { await initMermaid(); await mermaid.parse(code); const {svg} = await mermaid.render('mmd' + (++mmdSeq), code); el.innerHTML = svg; el.classList.remove('bad'); return true; }
  catch(e){ el.innerHTML = `<p class="err small">Ошибка синтаксиса: ${esc(String(e.message||e).split('\n').slice(0,3).join(' '))}</p>`; el.classList.add('bad'); return false; }
}
AFTER_RENDER.push(() => document.querySelectorAll('.mmd[data-src]').forEach(el => { drawMermaid(el, decodeURIComponent(el.dataset.src)); el.removeAttribute('data-src'); }));
const diagChecks = (it, code) => it.required.map(([label, re]) => ({label, ok: new RegExp(re, 'i').test(code)}));
let mmdTimer = null;
function onDiagramInput(id, v){
  saveDraft(id, v);
  clearTimeout(mmdTimer);
  mmdTimer = setTimeout(() => {
    const it = ITEMS[id], box = document.getElementById('mprev'); if (!box) return;
    drawMermaid(box, v);
    document.getElementById('dchecks').innerHTML = checksHtml(diagChecks(it, v));
  }, 500);
}
const checksHtml = cs => cs.map(c => `<div class="chk ${c.ok?'good':'muted'}">${c.ok?'✓':'○'} ${esc(c.label)}</div>`).join('');
function tDiagram(it){
  const code = S.drafts[it.id] ?? it.starter, done = AIR[it.id]?.res || revealed[it.id];
  return `<div class="card"><h3>Ситуация</h3><p>${esc(it.scenario)}</p><h3>Задание</h3><p>${esc(it.task)}</p>
  <details><summary>Шпаргалка по Mermaid</summary><p class="small mono">sequenceDiagram: A->>B: вызов · B-->>A: ответ · alt / else / end · loop / end<br>stateDiagram-v2: [*] --> S1 · S1 --> S2: событие<br>erDiagram: A ||--o{ B : "связь" (русские подписи — в кавычках) · атрибуты — каждый с новой строки внутри { }<br>flowchart TD: A[Шаг] --> B{Решение} · B -- да --> C</p><p class="small">Документация: mermaid.js.org</p></details></div>
  <div class="split"><div class="card"><h3>Код диаграммы</h3><textarea rows="18" class="mono" oninput="onDiagramInput('${it.id}',this.value)">${esc(code)}</textarea>
  <h3>Автопроверка</h3><div id="dchecks">${checksHtml(diagChecks(it, code))}</div>
  ${!done?`<div class="row"><button class="btn" onclick="submitDiagram('${it.id}')">Сдать диаграмму</button></div>`:''}</div>
  <div class="card"><h3>Предпросмотр</h3><div id="mprev" class="mmd" data-src="${encodeURIComponent(code)}"></div></div></div>
  ${aiBox(it.id)}
  ${done?`<div class="card ref"><h3>Эталонная диаграмма</h3><div class="mmd" data-src="${encodeURIComponent(it.reference)}"></div><details><summary>Код эталона</summary><pre class="mono small">${esc(it.reference)}</pre></details>
  <button class="btn" onclick="finishDiagram('${it.id}')">Засчитать (${diagScore(it)}%)</button></div>`:''}`;
}
function diagScore(it){
  const code = S.drafts[it.id] ?? it.starter, cs = diagChecks(it, code);
  const auto = cs.filter(c=>c.ok).length / cs.length, ai = AIR[it.id]?.res?.score;
  return Math.round((ai != null ? (auto + ai/100)/2 : auto) * 100);
}
async function submitDiagram(id){
  const it = ITEMS[id], code = S.drafts[id] ?? it.starter;
  const ok = await drawMermaid(document.getElementById('mprev'), code);
  if (!ok) { toast('Сначала исправьте синтаксис — диаграмма должна рендериться'); return; }
  if (AI.enabled) await runReview(id, {title:it.title, task:it.task, context:it.scenario, reference:it.reference, checklist:it.checklist}, 'Код Mermaid:\n' + code);
  revealed[id] = true; render();
}
function finishDiagram(id){ const it = ITEMS[id]; const cs = diagChecks(it, S.drafts[id] ?? it.starter); complete(id, diagScore(it)/100, {missed: cs.filter(c=>!c.ok).map(c=>c.label)}); go(lastList); }

// ───────── OpenAPI ─────────
function oaChecks(it, text){
  let doc;
  try { doc = jsyaml.load(text); } catch(e) { return {err: 'YAML не разбирается: ' + e.message.split('\n')[0], checks: []}; }
  if (!doc || typeof doc !== 'object') return {err:'Пустой документ', checks:[]};
  const C = [], add = (label, ok) => C.push({label, ok: !!ok});
  add('openapi: 3.x', /^3\./.test(String(doc.openapi || '')));
  add('info.title и info.version', doc.info?.title && doc.info?.version);
  it.checks.paths.forEach(([p, m, codes]) => {
    const op = doc.paths?.[p]?.[m];
    add(`${m.toUpperCase()} ${p}`, op);
    codes.forEach(c => add(`${m.toUpperCase()} ${p} → ${c}`, op?.responses?.[c] || op?.responses?.[Number(c)]));
  });
  it.checks.schemas.forEach(s => add(`components.schemas.${s}`, doc.components?.schemas?.[s]));
  const flat = JSON.stringify(doc);
  it.checks.params.forEach(n => add(`параметр ${n}`, flat.includes(`"name":"${n}"`)));
  const ops = Object.values(doc.paths || {}).flatMap(pi => Object.values(pi || {}).filter(o => o && o.responses));
  add('у всех ответов есть description', ops.length && ops.every(o => Object.values(o.responses).every(r => r?.$ref || r?.description)));
  const refs = [...flat.matchAll(/"\$ref":"#\/([^"]+)"/g)].map(m => m[1]);
  add('все $ref разрешаются', refs.every(r => r.split('/').reduce((o, k) => o?.[k], doc)));
  return {doc, checks: C};
}
function oaPreview(doc){
  if (!doc?.paths) return '';
  return Object.entries(doc.paths).map(([p, pi]) => Object.entries(pi || {}).filter(([m]) => ['get','post','put','patch','delete'].includes(m)).map(([m, o]) =>
    `<div class="op"><span class="verb v-${m}">${m.toUpperCase()}</span> <code>${esc(p)}</code> <span class="muted small">${esc(o?.summary || '')}</span><div class="small muted">${Object.keys(o?.responses || {}).map(c => `<span class="tag">${esc(c)}</span>`).join(' ')}</div></div>`).join('')).join('');
}
let oaTimer = null;
function onOaInput(id, v){
  saveDraft(id, v); clearTimeout(oaTimer);
  oaTimer = setTimeout(() => { const box = document.getElementById('oares'); if (box) box.innerHTML = oaResultHtml(ITEMS[id], v); }, 400);
}
function oaResultHtml(it, text){
  const r = oaChecks(it, text);
  if (r.err) return `<p class="err small">${esc(r.err)}</p>`;
  return `<h3>Валидация ${r.checks.filter(c=>c.ok).length}/${r.checks.length}</h3>${checksHtml(r.checks)}<h3>Операции</h3>${oaPreview(r.doc)}`;
}
function tOpenapi(it){
  const text = S.drafts[it.id] ?? OPENAPI_STARTER, done = revealed[it.id];
  return `<div class="card"><h3>Ситуация</h3><p>${esc(it.scenario)}</p><h3>Задание</h3><p>${esc(it.task)}</p>
  <details><summary>Подсказка по OpenAPI 3</summary><p class="small">paths → путь → метод → parameters (in: path/query) · requestBody → content → application/json → schema · responses → код → description + content. Переиспользуемые схемы — components.schemas, ссылка — <code>$ref: '#/components/schemas/Error'</code>. Проверить вручную можно в editor.swagger.io.</p></details></div>
  <div class="split"><div class="card"><h3>Спецификация (YAML)</h3><textarea rows="24" class="mono" spellcheck="false" oninput="onOaInput('${it.id}',this.value)">${esc(text)}</textarea>
  ${!done?`<button class="btn" onclick="submitOa('${it.id}')">Сдать спецификацию</button>`:''}</div>
  <div class="card" id="oares">${window.jsyaml ? oaResultHtml(it, text) : '<p class="muted">Загрузка валидатора…</p>'}</div></div>
  ${aiBox(it.id)}
  ${done?`<div class="card"><button class="btn" onclick="finishOa('${it.id}')">Засчитать (${oaScore(it)}%)</button></div>`:''}`;
}
function oaScore(it){
  const r = oaChecks(it, S.drafts[it.id] ?? OPENAPI_STARTER);
  const auto = r.err ? 0 : r.checks.filter(c=>c.ok).length / r.checks.length, ai = AIR[it.id]?.res?.score;
  return Math.round((ai != null ? (auto + ai/100)/2 : auto) * 100);
}
async function submitOa(id){
  const it = ITEMS[id], text = S.drafts[id] ?? OPENAPI_STARTER;
  if (oaChecks(it, text).err) { toast('Исправьте YAML — документ не разбирается'); return; }
  if (AI.enabled) await runReview(id, {title:it.title, task:it.task, context:it.scenario, checklist:it.checklist}, 'OpenAPI YAML:\n' + text);
  revealed[id] = true; render();
}
function finishOa(id){ const it = ITEMS[id], r = oaChecks(it, S.drafts[id] ?? OPENAPI_STARTER); complete(id, oaScore(it)/100, {missed: (r.checks||[]).filter(c=>!c.ok).map(c=>c.label)}); go(lastList); }

// ───────── Интервью с заказчиком ─────────
const MAX_Q = 20;
function tElicit(it){
  if (!AI.enabled) return `<div class="card"><p>${esc(it.opening)}</p><p class="muted">Для интервью нужен ИИ: заказчика играет модель, а скрытые факты раскрываются только на правильные вопросы. Подключите ключ во вкладке «Настройки».</p><button class="btn" onclick="go('settings')">Открыть настройки</button></div>`;
  const R = S.elicitRun[it.id] = S.elicitRun[it.id] || {history:[{who:'them', text:it.opening}], revealed:[], start:Date.now()};
  const asked = R.history.filter(m => m.who === 'me').length;
  let h = `<div class="card note"><b>Собеседник:</b> ${esc(it.persona.split('.')[0])}. У вас до ${MAX_Q} вопросов. Цель — выяснить настоящую проблему, цели и метрики, пользователей, ограничения, исключения и кто принимает решения. В конце подведите итог.</div>
  <div class="chat">${R.history.map(m => `<div class="bubble ${m.who}">${esc(m.text)}</div>`).join('')}${R.busy?'<div class="bubble them muted">печатает…</div>':''}</div>`;
  if (R.result) {
    const x = R.result;
    h += `<div class="card aibox"><div class="row"><span class="score ${x.score>=70?'good':'err'}">${x.score}</span><div><b>Итог интервью</b><div class="muted small">Раскрыто фактов ${R.revealed.length} из ${it.facts.length} · качество интервью ${x.quality}/100</div></div></div>
    <p>${esc(x.feedback)}</p>${x.good.length?`<h3>Хорошие приёмы</h3><ul>${x.good.map(g=>`<li>${esc(g)}</li>`).join('')}</ul>`:''}${x.missed.length?`<h3>Что упустили</h3><ul>${x.missed.map(g=>`<li>${esc(g)}</li>`).join('')}</ul>`:''}
    <h3>Все скрытые факты</h3>${it.facts.map(f=>`<div class="chk ${R.revealed.includes(f[0])?'good':'err'}">${R.revealed.includes(f[0])?'✓':'✗'} ${esc(f[1])}</div>`).join('')}
    <div class="row"><button class="btn" onclick="go(lastList)">Готово</button><button class="btn ghost" onclick="delete S.elicitRun['${it.id}'];save();render()">Пройти заново</button></div></div>`;
  } else {
    h += `<div class="card"><div class="muted small">Вопросов задано: ${asked}/${MAX_Q} · раскрыто фактов: ${R.revealed.length}</div>
    <textarea id="elq" rows="3" placeholder="Ваш вопрос…" onkeydown="if(event.key==='Enter'&&(event.metaKey||event.ctrlKey))askStake('${it.id}')" ${R.busy||asked>=MAX_Q?'disabled':''}></textarea>
    <div class="row"><button class="btn" onclick="askStake('${it.id}')" ${R.busy||asked>=MAX_Q?'disabled':''}>Спросить (Ctrl+Enter)</button><button class="btn ghost" onclick="finishElicit('${it.id}')" ${R.busy||asked<3?'disabled':''}>Завершить интервью и получить разбор</button></div>
    ${R.err?`<p class="err small">${esc(R.err)}</p>`:''}</div>`;
  }
  return h;
}
async function askStake(id){
  const it = ITEMS[id], R = S.elicitRun[id], q = document.getElementById('elq').value.trim();
  if (!q || R.busy) return;
  R.history.push({who:'me', text:q}); R.busy = true; R.err = null; save(); render();
  try {
    const a = await AI.stakeholder(it, R.history);
    R.history.push({who:'them', text:a.reply});
    a.revealed.filter(f => it.facts.some(x=>x[0]===f) && !R.revealed.includes(f)).forEach(f => R.revealed.push(f));
  } catch(e){ R.history.pop(); R.err = e.message; }
  R.busy = false; save(); render();
  document.getElementById('elq')?.focus();
}
async function finishElicit(id){
  const it = ITEMS[id], R = S.elicitRun[id]; R.busy = true; render();
  try {
    const ev = await AI.elicitEval(it, R.history, R.revealed);
    const cov = R.revealed.length / it.facts.length;
    R.result = {...ev, score: Math.round((0.6*cov + 0.4*ev.quality/100)*100)};
    complete(id, R.result.score/100, {missed: it.facts.filter(f=>!R.revealed.includes(f[0])).map(f=>f[1])});
  } catch(e){ R.err = e.message; }
  R.busy = false; save(); render();
}

// ───────── Ассессмент ─────────
let AS = null;
const sqlMatches = (u, r, ref) => {
  const norm = rs => rs.map(x => JSON.stringify(x.map(v => typeof v === 'number' ? Math.round(v*100)/100 : v)));
  let a = norm(u.values), b = norm(r.values); if (!/order\s+by/i.test(ref)) { a.sort(); b.sort(); }
  return u.columns.length === r.columns.length && a.length === b.length && a.every((v,i)=>v===b[i]);
};
function startAssess(){
  const round = S.assess.length % 3;
  AS = {round, start: Date.now(), sql:{}, fails:{}, sel:{}, caseText:'', checks:[]};
  go('assess');
  AS.tick = setInterval(() => { const el = document.getElementById('astimer'); if (!el) return; const left = ASSESS.minutes*60 - Math.floor((Date.now()-AS.start)/1000); el.textContent = left > 0 ? `${Math.floor(left/60)}:${pad(left%60)}` : 'время вышло'; el.classList.toggle('err', left < 300); }, 1000);
}
const asQs = r => ASSESS.questions.slice(r*8, r*8+8);
function vAssess(){
  lastList = 'progress';
  if (!AS) {
    const last = S.assess[S.assess.length-1];
    return `<h1>Контрольный ассессмент</h1><div class="card"><p>45 минут, три блока: 3 SQL-задачи, 8 вопросов теории и мини-кейс. Задания в каждом раунде новые (3 разных варианта по кругу). Проходите раз в месяц — так виден реальный рост.</p>
    ${last?`<p class="muted">Последний: ${last.date}, результат ${last.total}%.</p>`:'<p class="muted">Это будет входной ассессмент — точка отсчёта.</p>'}
    <p class="muted small">Без подсказок и поиска — иначе график роста потеряет смысл.</p><button class="btn" onclick="startAssess()">Начать</button></div>`;
  }
  const r = AS.round, c = ASSESS.cases[r];
  return `<div class="assesshead"><h1>Ассессмент · вариант ${r+1}</h1><span class="chip" id="astimer">--:--</span></div>
  <div class="card"><h2>1. SQL</h2><p class="muted small">Схема: ${SCHEMA_HTML}<br>${SCHEMA_EXTRA}</p>
  ${ASSESS.rounds[r].map((id,i) => { const t = ASSESS.sql.find(x=>x.id===id), ok = AS.sql[id] != null;
    return `<div class="astask"><b>${i+1}. ${esc(t.title)}</b><p>${esc(t.task)}</p>
    <textarea id="as-${id}" rows="3" class="mono" ${ok?'disabled':''}>${esc(AS[id]||'')}</textarea>
    ${ok?`<p class="good small">✓ Решено${AS.fails[id]?` с ${AS.fails[id]+1}-й попытки`:''}</p>`:`<button class="btn sm" onclick="asSql('${id}')">Проверить</button> <span class="small muted" id="asr-${id}">${AS.fails[id]?`Неверно, попыток: ${AS.fails[id]}`:''}</span>`}</div>`; }).join('')}</div>
  <div class="card"><h2>2. Теория</h2>${asQs(r).map((q,qi) => { const order = shuffleIdx(q.o.length, 'as'+r+qi);
    return `<div class="asq"><b>${qi+1}. ${esc(q.q)}</b>${order.map(oi=>`<label class="opt"><input type="radio" name="asq${qi}" ${AS.sel[qi]===oi?'checked':''} onchange="AS.sel[${qi}]=${oi}"> ${esc(q.o[oi])}</label>`).join('')}</div>`; }).join('')}</div>
  <div class="card"><h2>3. Мини-кейс: ${esc(c.title)}</h2><p>${esc(c.task)}</p><textarea rows="10" oninput="AS.caseText=this.value">${esc(AS.caseText)}</textarea>
  ${AI.enabled?'<p class="muted small">Кейс оценит ИИ-ревьюер.</p>':`<p class="muted small">Без ИИ: после завершения отметите критерии самостоятельно.</p>`}</div>
  ${AS.selfCheck?`<div class="card"><h3>Самопроверка кейса</h3>${c.checklist.map((x,i)=>`<label class="chk"><input type="checkbox" onchange="AS.checks[${i}]=this.checked"> ${esc(x)}</label>`).join('')}<button class="btn" onclick="finishAssess(true)">Подтвердить и посмотреть результат</button></div>`
  :`<button class="btn" onclick="finishAssess()" ${AS.busy?'disabled':''}>${AS.busy?'Проверяю кейс…':'Завершить ассессмент'}</button>`}`;
}
async function asSql(id){
  const t = ASSESS.sql.find(x=>x.id===id), q = document.getElementById('as-'+id).value; AS[id] = q;
  try { await initSQL(); } catch(e){ toast('SQL-движок не загрузился'); return; }
  let ok = false; try { ok = sqlMatches(runSql(q), runSql(t.ref), t.ref); } catch(e){}
  if (ok) AS.sql[id] = Math.max(0.25, 1 - 0.25*(AS.fails[id]||0)); else AS.fails[id] = (AS.fails[id]||0) + 1;
  render();
}
async function finishAssess(selfDone){
  const r = AS.round, c = ASSESS.cases[r];
  document.querySelectorAll('[id^="as-as-"]').forEach(el => AS[el.id.slice(3)] = el.value);
  let caseScore;
  if (AI.enabled) {
    if (AS.caseText.trim().length < 30) caseScore = 0;
    else { AS.busy = true; render(); try { const rv = await AI.review({title:c.title, task:c.task, checklist:c.checklist}, AS.caseText); caseScore = rv.score/100; AS.review = rv; } catch(e){ AS.busy = false; toast('Ошибка ИИ: ' + e.message); render(); return; } }
  } else if (!selfDone) { AS.selfCheck = true; render(); return; }
  else caseScore = c.checklist.filter((_,i)=>AS.checks[i]).length / c.checklist.length;
  const sqlScore = ASSESS.rounds[r].reduce((a,id)=>a+(AS.sql[id]||0),0) / 3;
  const qs = asQs(r), quizScore = qs.filter((q,i)=>AS.sel[i]===q.a).length / qs.length;
  const total = Math.round((0.4*sqlScore + 0.3*quizScore + 0.3*caseScore)*100);
  const mins = Math.round((Date.now()-AS.start)/60000);
  const rec = {date: today(), round: r, sql: Math.round(sqlScore*100), quiz: Math.round(quizScore*100), case: Math.round(caseScore*100), total, mins};
  S.assess.push(rec);
  const id = 'assess@' + S.assess.length; ensurePseudo(id, 'assess', `Контрольный ассессмент №${S.assess.length}`); ITEMS[id].cat = 'Ассессмент';
  timers[id] = AS.start; complete(id, total/100);
  clearInterval(AS.tick); const review = AS.review; AS = null;
  ASSESS_RESULT = {rec, review}; go('assessResult');
}
let ASSESS_RESULT = null;
function vAssessResult(){
  const {rec, review} = ASSESS_RESULT || {}; if (!rec) return vAssess();
  const prev = S.assess.length > 1 ? S.assess[S.assess.length-2] : null;
  const delta = prev ? rec.total - prev.total : null;
  return `<h1>Результат ассессмента</h1><div class="kpis"><div class="kpi"><b>${rec.total}%</b><span>итог${delta!=null?` · ${delta>=0?'+':''}${delta} к прошлому`:''}</span></div><div class="kpi"><b>${rec.sql}%</b><span>SQL</span></div><div class="kpi"><b>${rec.quiz}%</b><span>теория</span></div><div class="kpi"><b>${rec.case}%</b><span>кейс</span></div><div class="kpi"><b>${rec.mins} мин</b><span>время</span></div></div>
  ${review?reviewHtml(review):''}<button class="btn" onclick="go('progress')">К прогрессу</button>`;
}

// ───────── Графики роста ─────────
function lineChart(points, {max = 100, unit = '%', label}){
  if (points.length < 2) return `<p class="muted small">Нужно минимум два значения для графика${points.length?` (сейчас ${points[0].v}${unit})`:''}.</p>`;
  const W = 640, H = 200, L = 36, R = 12, T = 12, B = 28;
  const x = i => L + i*(W-L-R)/(points.length-1), y = v => T + (1 - v/max)*(H-T-B);
  const grid = [0, max/2, max].map(v => `<line x1="${L}" x2="${W-R}" y1="${y(v)}" y2="${y(v)}" class="gridl"/><text x="${L-6}" y="${y(v)+4}" class="axt" text-anchor="end">${Math.round(v)}</text>`).join('');
  const path = points.map((p,i) => `${i?'L':'M'}${x(i)},${y(p.v)}`).join(' ');
  const step = Math.ceil(points.length / 8);
  return `<svg viewBox="0 0 ${W} ${H}" class="chart" role="img" aria-label="${esc(label)}">${grid}
  <path d="${path}" class="ln"/>
  ${points.map((p,i) => `<g class="pt"><circle cx="${x(i)}" cy="${y(p.v)}" r="14" class="hit"/><circle cx="${x(i)}" cy="${y(p.v)}" r="4.5" class="dot"/><title>${esc(p.l)}: ${p.v}${unit}</title></g>${i%step===0||i===points.length-1?`<text x="${x(i)}" y="${H-8}" class="axt" text-anchor="${i===0?'start':i===points.length-1?'end':'middle'}">${esc(p.l)}</text>`:''}`).join('')}
  <text x="${x(points.length-1)}" y="${y(points[points.length-1].v)-10}" class="lbl" text-anchor="end">${points[points.length-1].v}${unit}</text></svg>`;
}
function speedSeries(kinds){
  const byWeek = {};
  S.log.filter(e => kinds.includes(e.kind)).forEach(e => { (byWeek[weekKey(e.day)] = byWeek[weekKey(e.day)] || []).push(e.mins); });
  return Object.keys(byWeek).sort().map(w => { const a = byWeek[w].sort((p,q)=>p-q); return {l: w.slice(5), v: a[Math.floor(a.length/2)]}; });
}

// ───────── Матрица компетенций ─────────
const best = id => S.results[id]?.score || 0;
const kindScores = k => Object.values(ITEMS).filter(it => it.kind === k && S.results[it.id]).map(it => S.results[it.id].score);
const avg = a => a.length ? a.reduce((x,y)=>x+y,0)/a.length : 0;
const SKILLS = [
 ['Junior','Пишет SQL с JOIN, GROUP BY, HAVING', ()=>['sql-3','sql-4','sql-5'].every(i=>best(i)>=0.8), 'SQL-задачи 3–5 на ≥80%'],
 ['Junior','Формулирует проверяемые требования и критерии приёмки', ()=>best('case-req-1')>=0.7 && best('case-uc-1')>=0.7, 'кейсы «Личный кабинет» и «Восстановление пароля» на ≥70%'],
 ['Junior','Знает HTTP и REST', ()=>best('quiz-http')>=0.75, 'тест HTTP/REST на ≥75%'],
 ['Junior','Описывает процессы As-Is / To-Be', ()=>best('case-proc-1')>=0.7 || best('dg-4')>=0.7, 'кейс «Согласование отпуска» или flowchart возврата на ≥70%'],
 ['Junior','Пишет понятные статус-отчёты', ()=>kindScores('eod').filter(s=>s>=0.8).length>=3, '3 отчёта руководителю на ≥80%'],
 ['Junior','Владеет базовой теорией', ()=>Object.values(S.cards).filter(c=>c.reps>=2).length>=30, '30 карточек повторены минимум дважды'],
 ['Middle','Оконные функции и CTE', ()=>['sql-9','sql-10','sql-11','sql-16'].filter(i=>best(i)>=0.8).length>=3, '3 из 4 задач с окнами/CTE на ≥80%'],
 ['Middle','Проектирует API и пишет OpenAPI', ()=>kindScores('openapi').filter(s=>s>=0.75).length>=2, '2 спецификации OpenAPI на ≥75%'],
 ['Middle','Моделирует диаграммами (sequence, state, ER)', ()=>kindScores('diagram').filter(s=>s>=0.75).length>=3, '3 диаграммы на ≥75%'],
 ['Middle','Проектирует интеграции с учётом сбоев', ()=>best('case-int-1')>=0.7 && (best('p7')>=0.7 || best('dg-5')>=0.7), 'кейс «Платёжный шлюз» + МИС на ≥70%'],
 ['Middle','Выявляет требования на интервью', ()=>kindScores('elicit').filter(s=>s>=0.7).length>=2, '2 интервью с заказчиком на ≥70%'],
 ['Middle','Пишет измеримые НФТ', ()=>best('case-nfr-1')>=0.75 && best('p9')>=0.75, 'кейс НФТ + этап 9 проекта на ≥75%'],
 ['Middle','Проводит ревью чужой документации', ()=>best('case-doc-1')>=0.75 && best('case-doc-2')>=0.75, 'оба ревью документации на ≥75%'],
 ['Middle','Ведёт проект от целей до запуска', ()=>PROJECT.stages.every(s=>best(s.id)>=0.7), 'все 10 этапов проекта на ≥70%'],
 ['Senior','Разбирает инциденты системно', ()=>best('case-inc-1')>=0.85, 'кейс «Дубли SMS» на ≥85%'],
 ['Senior','Разрешает конфликты стейкхолдеров', ()=>best('case-conf-1')>=0.85 && kindScores('inbox').filter(s=>s>=0.85).length>=5, 'кейс конфликта ≥85% и 5 рабочих ситуаций ≥85%'],
 ['Senior','Оценивает и декомпозирует крупные задачи', ()=>best('case-est-1')>=0.85, 'кейс «Миграция данных» на ≥85%'],
 ['Senior','Стабильно высокий уровень', ()=>S.assess.length>=3 && S.assess.slice(-3).every(a=>a.total>=85), '3 ассессмента подряд на ≥85%'],
 ['Senior','Уверенно проходит собеседование', ()=>S.mocks.filter(m=>m.avg>=8).length>=2, '2 пробных собеседования со средним ≥8/10']
];
function matrixGrade(){
  let g = 'Стажёр';
  for (const lvl of ['Junior','Middle','Senior']) { const s = SKILLS.filter(x=>x[0]===lvl); if (s.filter(x=>x[2]()).length/s.length >= 0.8) g = lvl; else break; }
  return g;
}
function growthHtml(){
  const pts = S.assess.map((a,i) => ({l: `№${i+1} ${a.date.slice(5)}`, v: a.total}));
  const sp = speedSeries(['sql']), sc = speedSeries(['case','stage','diagram','openapi']);
  const last = S.assess[S.assess.length-1], due = !last || dayNum() - dayNumOf(last.date) >= 28;
  return `<div class="card"><div class="row" style="justify-content:space-between"><h2>Рост по контрольным ассессментам</h2><button class="btn ${due?'':'ghost'} sm" onclick="AS=null;go('assess')">${S.assess.length?'Пройти ассессмент':'Пройти входной ассессмент'}</button></div>
  ${lineChart(pts, {label:'Итоговый балл ассессментов'})}
  ${S.assess.length?`<details><summary>Таблица</summary><div class="tw"><table><tr><th>№</th><th>Дата</th><th>Итог</th><th>SQL</th><th>Теория</th><th>Кейс</th><th>Мин</th></tr>${S.assess.map((a,i)=>`<tr><td>${i+1}</td><td>${a.date}</td><td>${a.total}%</td><td>${a.sql}%</td><td>${a.quiz}%</td><td>${a.case}%</td><td>${a.mins}</td></tr>`).join('')}</table></div></details>`:''}</div>
  <div class="card"><h2>Скорость работы</h2><p class="muted small">Медиана фактических минут на задачу по неделям. Меньше — лучше: на работе важна не только полнота, но и темп.</p>
  <h3>SQL-задачи</h3>${lineChart(sp, {max: Math.max(20, ...sp.map(p=>p.v)), unit:' мин', label:'Медиана минут на SQL'})}
  <h3>Кейсы, диаграммы, спецификации</h3>${lineChart(sc, {max: Math.max(40, ...sc.map(p=>p.v)), unit:' мин', label:'Медиана минут на кейс'})}</div>
  <div class="card"><h2>Матрица компетенций · грейд по матрице: ${matrixGrade()}</h2><p class="muted small">Каждый навык подтверждается конкретными результатами. Грейд засчитывается, когда закрыто 80% навыков уровня и всех уровней ниже.</p>
  ${['Junior','Middle','Senior'].map(l => { const s = SKILLS.filter(x=>x[0]===l), n = s.filter(x=>x[2]()).length;
    return `<h3>${l} · ${n}/${s.length}</h3>${s.map(x=>`<div class="skill ${x[2]()?'ok':''}"><span>${x[2]()?'✅':'⬜'}</span><div><b>${esc(x[1])}</b><div class="muted small">Подтверждение: ${esc(x[3])}</div></div></div>`).join('')}`; }).join('')}</div>`;
}

// ───────── Карьера ─────────
let MOCK = null, VAC = null;
function vCareer(){
  lastList = 'career';
  return `<h1>Карьера</h1>
  <div class="card"><h2>🎤 Пробное собеседование</h2>
  ${AI.enabled ? mockHtml() : `<p class="muted">ИИ-интервьюер задаёт 5 вопросов, уточняет поверхностные ответы и оценивает каждый по шкале 0–10. Нужен ключ API во вкладке «Настройки».</p>`}
  <p class="small"><a href="#" onclick="go('interview');return false">Письменная тренировка по вопросам (без ИИ) →</a></p></div>
  <div class="card"><h2>🔎 Разбор вакансии</h2><p class="muted small">Вставьте текст вакансии с hh.ru или из другого источника. Тренажёр сопоставит требования с вашими уровнями и предложит план подготовки.</p>
  <textarea id="vac" rows="6" placeholder="Текст вакансии…">${esc(VAC?.text||'')}</textarea><button class="btn" onclick="analyzeVacancy()" ${VAC?.busy?'disabled':''}>${VAC?.busy?'Анализирую…':'Разобрать вакансию'}</button>
  ${VAC?.err?`<p class="err">${esc(VAC.err)}</p>`:''}${VAC?.res?vacancyHtml(VAC.res):''}</div>
  <div class="card"><h2>📁 Портфолио</h2><p>Соберите работы в документ Markdown для GitHub: проект «Клиника» по этапам, диаграммы Mermaid (GitHub отрисует их сам), спецификации OpenAPI и лучшие кейсы.</p>
  ${portfolioReadiness()}<button class="btn" onclick="exportPortfolioFull()">Скачать портфолио (.md)</button></div>`;
}
function mockHtml(){
  if (!MOCK) {
    const hist = S.mocks.slice(-5);
    return `<p>5 вопросов, около 3 минут на ответ. Отвечайте так, как ответили бы вслух — по структуре и с примерами.</p>
    ${hist.length?`<p class="muted small">Прошлые попытки: ${hist.map(m=>`${m.date}: ${m.avg}/10`).join(' · ')}</p>`:''}<button class="btn" onclick="startMock()">Начать собеседование</button>`;
  }
  const cur = MOCK.items[MOCK.i];
  if (!cur) {
    const a = (MOCK.items.reduce((s,x)=>s+x.score,0)/MOCK.items.length).toFixed(1);
    return `<h3>Итог: ${a}/10</h3>${MOCK.items.map(x=>`<details><summary>${x.score}/10 — ${esc(x.q)}</summary><p>${esc(x.feedback)}</p></details>`).join('')}<button class="btn" onclick="MOCK=null;render()">Закрыть</button>`;
  }
  const left = Math.max(0, 180 - Math.floor((Date.now()-MOCK.qStart)/1000));
  return `<div class="muted small">Вопрос ${MOCK.i+1} из ${MOCK.items.length} · <span id="mocktimer">${Math.floor(left/60)}:${pad(left%60)}</span></div>
  <div class="chat">${cur.qa.map(m=>`<div class="bubble ${m.who}">${esc(m.text)}</div>`).join('')}${MOCK.busy?'<div class="bubble them muted">интервьюер слушает…</div>':''}</div>
  <textarea id="mocka" rows="5" placeholder="Ваш ответ…" ${MOCK.busy?'disabled':''}></textarea><button class="btn" onclick="answerMock()" ${MOCK.busy?'disabled':''}>Ответить</button>${MOCK.err?`<p class="err small">${esc(MOCK.err)}</p>`:''}`;
}
function startMock(){
  const idx = shuffleIdx(INTERVIEW.length, Date.now()).slice(0,5);
  MOCK = {i:0, qStart:Date.now(), start:Date.now(), items: idx.map(i => ({q: INTERVIEW[i][0], model: INTERVIEW[i][1], qa:[{who:'them', text: INTERVIEW[i][0]}], followed:false}))};
  MOCK.tick = setInterval(() => { const el = document.getElementById('mocktimer'); if (!el || !MOCK) return; const l = 180 - Math.floor((Date.now()-MOCK.qStart)/1000); el.textContent = l > 0 ? `${Math.floor(l/60)}:${pad(l%60)}` : 'время вышло'; el.classList.toggle('err', l <= 0); }, 1000);
  render();
}
async function answerMock(){
  const cur = MOCK.items[MOCK.i], a = document.getElementById('mocka').value.trim(); if (!a) return;
  cur.qa.push({who:'me', text:a}); MOCK.busy = true; MOCK.err = null; render();
  try {
    const r = await AI.interviewer(cur.q, cur.model, cur.qa, !cur.followed);
    if (r.follow_up && !cur.followed) { cur.followed = true; cur.qa.push({who:'them', text:r.follow_up}); }
    else { cur.score = r.score; cur.feedback = r.feedback; MOCK.i++; MOCK.qStart = Date.now(); }
  } catch(e){ cur.qa.pop(); MOCK.err = e.message; }
  MOCK.busy = false;
  if (MOCK.i >= MOCK.items.length) {
    clearInterval(MOCK.tick);
    const avgScore = +(MOCK.items.reduce((s,x)=>s+x.score,0)/MOCK.items.length).toFixed(1);
    S.mocks.push({date: today(), avg: avgScore, items: MOCK.items.map(x=>({q:x.q, score:x.score, feedback:x.feedback}))});
    const id = 'mock@' + S.mocks.length; ensurePseudo(id, 'mock', `Пробное собеседование №${S.mocks.length}`); ITEMS[id].cat = 'Собеседование';
    timers[id] = MOCK.start; complete(id, avgScore/10);
  }
  render();
}
async function analyzeVacancy(){
  const text = document.getElementById('vac').value.trim(); if (text.length < 80) { toast('Вставьте полный текст вакансии'); return; }
  const comp = competencies(), levels = Object.fromEntries(comp.map(c => [c.cat, Math.round(c.level*100)]));
  VAC = {text, busy:true}; render();
  try {
    if (AI.enabled) VAC.res = await AI.vacancy(text, comp.map(c=>c.cat), levels);
    else {
      const low = text.toLowerCase();
      VAC.res = {role:'—', grade:'—', plan:[], offline:true, requirements: Object.entries(VACANCY_KEYWORDS).filter(([,ws]) => ws.some(w=>low.includes(w))).map(([cat, ws]) => ({text: ws.filter(w=>low.includes(w)).join(', '), category: cat, importance:'must'}))};
    }
    VAC.res.levels = levels;
    S.vacancies[Date.now()] = {text: text.slice(0,300), res: VAC.res}; save();
  } catch(e){ VAC.err = e.message; }
  VAC.busy = false; render();
}
function vacancyHtml(r){
  const lv = c => r.levels[c] ?? 0;
  const gaps = r.requirements.filter(q => q.importance === 'must' && q.category in r.levels && lv(q.category) < 60);
  return `${r.offline?'<p class="muted small">Анализ по ключевым словам (без ИИ). Подключите ИИ для точного разбора и плана.</p>':`<p><b>${esc(r.role)}</b> · грейд: ${esc(r.grade)}</p>`}
  <div class="tw"><table><tr><th>Требование</th><th>Направление</th><th>Важность</th><th>Ваш уровень</th></tr>${r.requirements.map(q=>`<tr><td>${esc(q.text)}</td><td>${esc(q.category)}</td><td>${q.importance==='must'?'обязательно':'плюс'}</td><td class="${q.category in r.levels ? (lv(q.category)>=60?'good':'err') : 'muted'}">${q.category in r.levels ? lv(q.category)+'%' : '—'}</td></tr>`).join('')}</table></div>
  ${gaps.length?`<p><b>Главные пробелы:</b> ${[...new Set(gaps.map(g=>g.category))].join(', ')}</p>`:'<p class="good">Обязательные требования закрыты на уровне ≥60%.</p>'}
  ${r.plan?.length?`<h3>План подготовки</h3><ol>${r.plan.map(p=>`<li>${esc(p)}</li>`).join('')}</ol>`:''}`;
}
function portfolioReadiness(){
  const items = [
    ['Проект «Клиника»: все 10 этапов', PROJECT.stages.filter(s=>S.results[s.id]).length, 10],
    ['Диаграммы Mermaid', DIAGRAMS.filter(d=>S.results[d.id]).length, 3],
    ['Спецификации OpenAPI', OPENAPI.filter(d=>S.results[d.id]).length, 2],
    ['Сильные кейсы (≥85%)', TASKS.filter(t=>t.type==='case' && best(t.id)>=0.85).length, 3]];
  return items.map(([l,n,m]) => `<div class="comp"><span>${l}</span><div class="bar"><i style="width:${Math.min(100,n/m*100)}%"></i></div><span class="small">${n}/${m}</span></div>`).join('');
}
function exportPortfolioFull(){
  let md = `# Портфолио системного аналитика\n\n> Работы выполнены в тренажёре системного аналитика. Дата выгрузки: ${today()}. Грейд по матрице компетенций: ${matrixGrade()}.\n\n## Содержание\n\n1. [Проект «${PROJECT.name}»](#проект)\n2. [Диаграммы](#диаграммы)\n3. [Спецификации API](#спецификации-api)\n4. [Избранные кейсы](#избранные-кейсы)\n\n`;
  md += `## Проект\n\n**${PROJECT.name}.** ${PROJECT.intro}\n\n`;
  PROJECT.stages.forEach((s,i) => { if (S.drafts[s.id]) md += `### Этап ${i+1}. ${s.title}\n\n_Задание:_ ${s.task}\n\n${S.drafts[s.id]}\n\n`; });
  md += `## Диаграммы\n\n`;
  DIAGRAMS.filter(d => S.drafts[d.id]).forEach(d => { md += `### ${d.title}\n\n${d.scenario}\n\n\`\`\`mermaid\n${S.drafts[d.id]}\n\`\`\`\n\n`; });
  md += `## Спецификации API\n\n`;
  OPENAPI.filter(d => S.drafts[d.id]).forEach(d => { md += `### ${d.title}\n\n${d.scenario}\n\n\`\`\`yaml\n${S.drafts[d.id]}\n\`\`\`\n\n`; });
  md += `## Избранные кейсы\n\n`;
  TASKS.filter(t => t.type === 'case' && best(t.id) >= 0.7 && S.drafts[t.id]).sort((a,b)=>best(b.id)-best(a.id)).slice(0,5).forEach(t => { md += `### ${t.title}\n\n_Ситуация:_ ${strip(t.scenario)}\n\n_Задание:_ ${t.task}\n\n${S.drafts[t.id]}\n\n`; });
  download(`portfolio-${today()}.md`, md);
}

// ───────── Спринт: планирование и ретро ─────────
const PANELS_X = {
  planning(ph, p, D){
    const k = today(), comp = competencies().filter(c=>c.total>1), weakest = comp.slice().sort((a,b)=>a.level-b.level)[0]?.cat;
    return `<div class="card"><h2>🎯 Планирование спринта</h2><p>Спринт — одна неделя. Поставьте цель и измеримые ориентиры: в пятницу на ретро вы сравните план с фактом.</p>
    <label>Цель спринта (одно предложение)</label><textarea id="sp-goal" rows="2" placeholder="Например: закрыть пробел по интеграциям — 2 диаграммы sequence и кейс про платёжный шлюз на ≥80%"></textarea>
    <label>Фокусное направление</label><select id="sp-focus">${comp.map(c=>`<option ${c.cat===weakest?'selected':''}>${esc(c.cat)}</option>`).join('')}</select>
    <div class="row"><label>Рабочих дней в тренажёре <input id="sp-days" type="number" min="1" max="7" value="5"></label><label>Целевой средний балл, % <input id="sp-avg" type="number" min="50" max="100" value="80"></label><label>Часов на неделю <input id="sp-hours" type="number" min="1" max="60" value="8"></label></div>
    <button class="btn" onclick="saveSprint()">Утвердить план спринта</button></div>`;
  },
  retro(ph, p, D){
    const sp = S.sprints[weekKey(today())], W = weekStats(weekKey(today()));
    if (!sp) return `<div class="card"><p>На эту неделю не было планирования.</p><button class="btn" onclick="S.sprints[weekKey(today())]={goal:'—',focus:'—',days:5,avg:80,hours:8,at:Date.now()};save();render()">Пропустить ретро</button></div>`;
    return `<div class="card"><h2>🔁 Демо и ретроспектива</h2><div class="msg"><div class="from">Цель спринта</div>${esc(sp.goal)}</div>${sprintFactHtml(sp, W)}
    <label>Что получилось хорошо</label><textarea id="rt-good" rows="2"></textarea><label>Что мешало / что улучшить</label><textarea id="rt-bad" rows="2"></textarea><label>Действия на следующий спринт</label><textarea id="rt-act" rows="2"></textarea>
    <button class="btn" onclick="saveRetro()">Завершить ретро</button></div>`;
  }
};
function weekStats(wk){
  const days = Array.from({length:7}, (_,i) => keyOfNum(dayNumOf(wk)+i)), set = new Set(days);
  const E = S.log.filter(e => set.has(e.day) && !SERVICE_KINDS.includes(e.kind));
  return {E, active: days.filter(d => S.log.some(e=>e.day===d)).length, avg: avg(E.map(e=>e.score)), mins: E.reduce((a,e)=>a+e.mins,0)};
}
function sprintFactHtml(sp, W){
  const focus = W.E.filter(e=>e.cat===sp.focus);
  const row = (l, plan, fact, ok) => `<tr><td>${l}</td><td>${plan}</td><td class="${ok?'good':'err'}">${fact}</td></tr>`;
  return `<div class="tw"><table><tr><th>Показатель</th><th>План</th><th>Факт</th></tr>
  ${row('Активных дней', sp.days, W.active, W.active>=sp.days)}${row('Средний балл', sp.avg+'%', Math.round(W.avg*100)+'%', W.avg*100>=sp.avg)}
  ${row('Время практики', sp.hours+' ч', (W.mins/60).toFixed(1)+' ч', W.mins/60>=sp.hours)}${row('Задач по фокусу «'+esc(sp.focus)+'»', '≥2', focus.length, focus.length>=2)}</table></div>`;
}
function saveSprint(){
  const goal = document.getElementById('sp-goal').value.trim(); if (goal.length < 10) { toast('Сформулируйте цель спринта'); return; }
  S.sprints[weekKey(today())] = {goal, focus: document.getElementById('sp-focus').value, days:+document.getElementById('sp-days').value, avg:+document.getElementById('sp-avg').value, hours:+document.getElementById('sp-hours').value, at:Date.now()};
  event('Планирование спринта: ' + goal); render();
}
function saveRetro(){
  const sp = S.sprints[weekKey(today())]; const v = id => document.getElementById(id).value.trim();
  if (!v('rt-good') || !v('rt-act')) { toast('Заполните хотя бы «что хорошо» и «действия»'); return; }
  sp.retro = {good:v('rt-good'), bad:v('rt-bad'), act:v('rt-act'), at:Date.now()}; event('Ретроспектива спринта'); render();
}
// Спринт в недельном отчёте
const _drawReport = drawReport;
drawReport = function(){
  _drawReport();
  const sp = repMode !== 'day' && S.sprints[weekKey(reportDays()[reportDays().length-1])];
  if (sp) document.getElementById('report').insertAdjacentHTML('afterbegin', `<h3>Спринт недели</h3><p><b>Цель:</b> ${esc(sp.goal)}</p>${sprintFactHtml(sp, weekStats(weekKey(reportDays()[reportDays().length-1])))}${sp.retro?`<p><b>Ретро.</b> Хорошо: ${esc(sp.retro.good)}. Улучшить: ${esc(sp.retro.bad||'—')}. Действия: ${esc(sp.retro.act)}</p>`:''}`);
};
const _reportMd = reportMd;
reportMd = function(){
  let md = _reportMd();
  const wk = weekKey(reportDays()[reportDays().length-1]), sp = repMode !== 'day' && S.sprints[wk];
  if (sp) { const W = weekStats(wk); md += `\n## Спринт недели\n\n**Цель:** ${sp.goal}\n\n| Показатель | План | Факт |\n|---|---|---|\n| Активных дней | ${sp.days} | ${W.active} |\n| Средний балл | ${sp.avg}% | ${Math.round(W.avg*100)}% |\n| Время | ${sp.hours} ч | ${(W.mins/60).toFixed(1)} ч |\n${sp.retro?`\n**Ретро.** Хорошо: ${sp.retro.good}. Улучшить: ${sp.retro.bad||'—'}. Действия: ${sp.retro.act}\n`:''}`; }
  const R = reportData(), ai = R.entries.filter(e => S.aiReviews[e.id] && S.aiReviews[e.id].at >= new Date(R.days[0]).getTime());
  if (ai.length) md += `\n## Комментарии ИИ-ревьюера\n\n${ai.map(e=>`- **${e.title}** (${S.aiReviews[e.id].score}/100): ${S.aiReviews[e.id].verdict}`).join('\n')}\n`;
  return md;
};

// ───────── Прерывания в реальном времени ─────────
let intTimer = null;
const _go = go;
go = function(v, id){
  _go(v, id);
  clearTimeout(intTimer);
  const D = S.days[today()], it = id && ITEMS[id];
  if (v !== 'task' || !it || !['case','stage','diagram','openapi','sql'].includes(it.kind) || !D?.started || D.ended) return;
  const n = (D.ints || 0); if (n >= 2) return;
  intTimer = setTimeout(() => { if (view === 'task' && current === id) showInterrupt(); }, (3 + Math.random()*4) * 60000);
};
function showInterrupt(){
  const D = Dget(), n = D.ints = (D.ints || 0) + 1, x = INTERRUPTS[(dayNum()*2 + n) % INTERRUPTS.length]; save();
  const ov = document.createElement('div'); ov.className = 'overlay'; ov.id = 'intov';
  ov.innerHTML = `<div class="modal"><div class="from">🔔 Новое сообщение · ${esc(x.from)}</div><p>${esc(x.text)}</p><div class="opts">${shuffleIdx(x.opts.length, n+'i').map(i=>`<button class="optbtn" onclick="answerInterrupt(${INTERRUPTS.indexOf(x)},${i})">${esc(x.opts[i][0])}</button>`).join('')}</div></div>`;
  document.body.appendChild(ov);
}
function answerInterrupt(xi, oi){
  const x = INTERRUPTS[xi], o = x.opts[oi], id = `int@${today()}@${Dget().ints}`;
  ensurePseudo(id, 'interrupt', 'Прерывание: ' + x.from.split(' · ')[0]);
  S.interrupts.push({day: today(), from: x.from, pick: o[0], score: o[1]});
  complete(id, o[1]/2); event(`Прерывание от ${x.from.split(' · ')[0]}: ${o[1]===2?'отреагировал верно':'реакция неоптимальна'}`);
  document.querySelector('#intov .modal').innerHTML = `<p class="${o[1]===2?'good':o[1]===1?'':'err'}">${['✗','◐','✓'][o[1]]} ${esc(o[2])}</p><button class="btn" onclick="document.getElementById('intov').remove()">Вернуться к задаче</button>`;
}

// ───────── Настройки ─────────
let pingState = '';
function vSettings(){
  const c = AI.cfg || {};
  return `<h1>Настройки</h1>
  <div class="card"><h2>ИИ-наставник (Claude)</h2>
  <p>ИИ включает независимое ревью решений, интервью с заказчиком, пробное собеседование и разбор вакансий. Без ИИ всё остальное работает на самопроверке.</p>
  <ul class="small"><li>Нужен ключ API Anthropic: platform.claude.com → API Keys. Оплата по факту, ориентир — несколько центов за одно ревью (зависит от модели).</li>
  <li>Ключ хранится <b>только в этом браузере</b>, не попадает в резервные копии и отправляется только в API Anthropic.</li>
  <li>Создайте отдельный ключ с месячным лимитом расходов и не вводите его на чужих компьютерах.</li></ul>
  ${!AI.MODELS.length?'<p class="err">Модуль ИИ ещё не загрузился (нужен интернет).</p>':`
  <label>Ключ API ${c.hasKey?'<span class="good">— сохранён</span>':''}</label><input id="aikey" type="password" autocomplete="off" placeholder="${c.hasKey?'•••••••• (введите новый, чтобы заменить)':'sk-ant-…'}">
  <label>Модель</label><select id="aimodel">${AI.MODELS.map(([v,l])=>`<option value="${v}" ${c.model===v?'selected':''}>${esc(l)}</option>`).join('')}</select>
  <label>Глубина проверки</label><select id="aieffort">${[['low','Быстро и дёшево'],['medium','Стандартно'],['high','Тщательно (дороже)']].map(([v,l])=>`<option value="${v}" ${c.effort===v?'selected':''}>${l}</option>`).join('')}</select>
  <div class="row"><button class="btn" onclick="saveAI()">Сохранить</button><button class="btn ghost" onclick="pingAI()">Проверить подключение</button>${c.hasKey?`<button class="btn ghost" onclick="AI.clearKey();render()">Удалить ключ</button>`:''}</div><p class="small">${pingState}</p>`}</div>
  <div class="card"><h2>Данные</h2><p class="muted small">Прогресс хранится в этом браузере. На другом устройстве или адресе (например, на GitHub Pages и локальном файле) прогресс разный — переносите его резервной копией.</p>
  <div class="row"><button class="btn ghost" onclick="download('sa-trainer-backup-${today()}.json', JSON.stringify(S))">Экспорт резервной копии</button><label class="btn ghost">Импорт<input type="file" accept=".json" hidden onchange="importBackup(this.files[0])"></label></div></div>`;
}
function saveAI(){
  const k = document.getElementById('aikey').value.trim();
  if (k) AI.set('key', k);
  AI.set('model', document.getElementById('aimodel').value); AI.set('effort', document.getElementById('aieffort').value);
  toast('Настройки ИИ сохранены'); render();
}
async function pingAI(){ pingState = '⏳ Проверяю…'; render(); try { await AI.ping(); pingState = '<span class="good">✓ Подключение работает</span>'; } catch(e){ pingState = `<span class="err">✗ ${esc(e.message)}</span>`; } render(); }

// ───────── Подключение экранов ─────────
Object.assign(VIEWS, {
  career: () => vCareer(), assess: () => vAssess(), assessResult: () => vAssessResult(), settings: () => vSettings(),
  progress: () => vProgress().replace('<h1>Прогресс</h1>', '<h1>Прогресс</h1>' + growthHtml()),
  today: () => (S.assess.length ? '' : `<div class="card note row" style="justify-content:space-between"><span>📊 Пройдите входной ассессмент — это точка отсчёта для графика вашего роста.</span><button class="btn sm" onclick="AS=null;go('assess')">Пройти (45 мин)</button></div>`) + vDay()
});
const _vInterview = vInterview;
vInterview = function(){ const h = _vInterview(); lastList = 'career'; return h; };
// После сброса или импорта — дополнить состояние новыми полями
const _importBackup = importBackup;
importBackup = function(f){ _importBackup(f); setTimeout(ensureState, 300); };
render();
