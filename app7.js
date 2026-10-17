// Сохранность прогресса и обновления: версия формата данных с миграциями, ежедневные снимки
// в IndexedDB, постоянное хранилище, синхронизация через приватный GitHub Gist,
// уведомление о новой версии и окно «Что нового».

// ───────── Версия формата данных и миграции ─────────
const SCHEMA = 2;
const MIGRATIONS = {
  // v2: уровни освоения для уже пройденных уроков, служебные поля обучения
  2: s => { s.learn = s.learn || {}; ['done', 'ans', 'ai', 'm', 'exams', 'rq', 'diagDone'].forEach(k => s.learn[k] = s.learn[k] || {}); }
};
(function migrate(){
  const from = S.schema || 1; if (from >= SCHEMA) return;
  try { localStorage.setItem(`sa-trainer-pre-v${SCHEMA}`, JSON.stringify(S)); } catch (e) {}   // снимок «до миграции» для отката
  for (let v = from + 1; v <= SCHEMA; v++) MIGRATIONS[v]?.(S);
  S.schema = SCHEMA; save();
})();

// Защита от удалённых или переименованных заданий в плане дня и отчётах
const _ticketOf7 = ticketOf;
ticketOf = (id, k) => ITEMS[id] ? _ticketOf7(id, k) : null;
const _getPlan7 = getPlan;
getPlan = function(k = today()){
  const p = _getPlan7(k);
  if (p && k === today() && ticketIds(p).some(id => id && !ITEMS[id])) { delete S.plans[k]; return _getPlan7(k); }
  return p;
};

// ───────── Ежедневные снимки в IndexedDB (последние 14 дней) ─────────
function idbOpen(){ return new Promise((ok, fail) => { const r = indexedDB.open('sa-trainer', 1); r.onupgradeneeded = () => r.result.createObjectStore('snaps'); r.onsuccess = () => ok(r.result); r.onerror = () => fail(r.error); }); }
async function idb(mode, fn){ const db = await idbOpen(); return new Promise((ok, fail) => { const tx = db.transaction('snaps', mode), req = fn(tx.objectStore('snaps')); tx.oncomplete = () => { ok(req?.result); db.close(); }; tx.onerror = () => fail(tx.error); }); }
async function snapshot(){
  try {
    await idb('readwrite', st => st.put(JSON.stringify(S), today()));
    const keys = (await idb('readonly', st => st.getAllKeys())).sort();
    for (const old of keys.slice(0, -14)) await idb('readwrite', st => st.delete(old));
  } catch (e) { console.warn('Снимок не сохранён', e); }
}
snapshot(); setInterval(snapshot, 30 * 60000);
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') snapshot(); });
async function restoreSnapshot(k){
  if (!confirm(`Восстановить прогресс на состояние ${k}? Текущий прогресс будет заменён (его снимок за сегодня сохранится).`)) return;
  await snapshot();
  const v = await idb('readonly', st => st.get(k));
  S = Object.assign(def(), JSON.parse(v)); save(); location.reload();
}
// Просим браузер не удалять данные при нехватке места (после первого действия пользователя)
document.addEventListener('click', function once(){
  document.removeEventListener('click', once);
  navigator.storage?.persist?.().then(ok => { S.settings.persisted = ok; save(); }).catch(() => {});
});

// ───────── Синхронизация через приватный GitHub Gist ─────────
const SYNC_LS = 'sa-sync', GIST_FILE = 'sa-trainer-progress.json', GIST_DESC = 'SA Trainer — прогресс тренажёра (не удалять)';
let SY = (() => { try { return JSON.parse(localStorage.getItem(SYNC_LS)) || {}; } catch (e) { return {}; } })();
const persistSync = () => { try { localStorage.setItem(SYNC_LS, JSON.stringify(SY)); } catch (e) {} };
let syncState = '', syncConflict = null, pushTimer = null;
async function gh(path, opts = {}){
  const r = await fetch('https://api.github.com' + path, {...opts, headers: {Authorization: 'Bearer ' + SY.token, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', ...(opts.body ? {'Content-Type': 'application/json'} : {})}});
  if (!r.ok) throw new Error(r.status === 401 ? 'Неверный или просроченный токен GitHub' : r.status === 403 || r.status === 404 && !SY.gistId ? 'Токену не хватает доступа к gist' : `GitHub ответил ${r.status}`);
  return r.status === 204 ? null : r.json();
}
async function findGist(){
  for (let page = 1; page <= 5; page++) {
    const list = await gh(`/gists?per_page=100&page=${page}`);
    const g = list.find(x => x.description === GIST_DESC || x.files?.[GIST_FILE]);
    if (g) return g.id;
    if (list.length < 100) break;
  }
  return null;
}
async function pullRemote(){
  const g = await gh('/gists/' + SY.gistId), f = g.files[GIST_FILE];
  SY.gistUrl = g.html_url; persistSync();
  const text = f.truncated ? await (await fetch(f.raw_url)).text() : f.content;
  return JSON.parse(text);
}
async function pushNow(){
  if (!SY.token) return;
  const payload = {description: GIST_DESC, files: {[GIST_FILE]: {content: JSON.stringify({savedAt: Date.now(), schema: SCHEMA, device: navigator.userAgent.slice(0, 90), state: S})}}};
  if (!SY.gistId) { const g = await gh('/gists', {method: 'POST', body: JSON.stringify({...payload, public: false})}); SY.gistId = g.id; SY.gistUrl = g.html_url; }
  else await gh('/gists/' + SY.gistId, {method: 'PATCH', body: JSON.stringify(payload)});
  SY.lastPush = Date.now(); SY.pushedUpdatedAt = S.updatedAt; persistSync();
}
function schedulePush(){
  if (!SY.token || syncConflict) return;
  clearTimeout(pushTimer);
  pushTimer = setTimeout(() => pushNow().then(() => { syncState = ''; }).catch(e => { syncState = e.message; }), 90 * 1000);
}
// Каждое сохранение помечает время изменения и планирует выгрузку в облако
const _save7 = save;
save = function(){ S.updatedAt = Date.now(); _save7(); schedulePush(); };
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden' && SY.token && !syncConflict && S.updatedAt !== SY.pushedUpdatedAt) { clearTimeout(pushTimer); pushNow().catch(() => {}); }
});
// При открытии: сравниваем локальный и облачный прогресс
async function syncOnLoad(){
  if (!SY.token) return;
  try {
    if (!SY.gistId) SY.gistId = await findGist();
    if (!SY.gistId) { await pushNow(); return; }
    const remote = await pullRemote(), rU = remote.state?.updatedAt || 0, lU = S.updatedAt || 0;
    SY.lastPull = Date.now(); persistSync();
    if (rU > lU + 5000) { syncConflict = remote; render(); }
    else if (lU > rU + 5000) await pushNow();
  } catch (e) { syncState = e.message; }
}
function useRemote(){
  const remote = syncConflict; if (!remote) return;
  snapshot().finally(() => { S = Object.assign(def(), remote.state); _save7(); SY.pushedUpdatedAt = S.updatedAt; persistSync(); location.reload(); });
}
function keepLocal(){ syncConflict = null; pushNow().then(() => toast('Облако обновлено текущим прогрессом')).catch(e => toast(e.message)); render(); }
async function connectSync(){
  const t = document.getElementById('ghtoken').value.trim(); if (!t) { toast('Вставьте токен'); return; }
  SY = {token: t}; persistSync(); syncState = '⏳ Подключаюсь…'; render();
  try {
    SY.gistId = await findGist(); persistSync();
    if (SY.gistId) { const remote = await pullRemote(); if ((remote.state?.updatedAt || 0) > (S.updatedAt || 0) + 5000) syncConflict = remote; else await pushNow(); }
    else await pushNow();
    syncState = '✓ Синхронизация подключена';
  } catch (e) { syncState = '✗ ' + e.message; }
  render();
}
async function syncNow(){ syncState = '⏳ Синхронизирую…'; render(); try { await pushNow(); syncState = '✓ Прогресс выгружен в облако'; } catch (e) { syncState = '✗ ' + e.message; } render(); }
async function pullNow(){ syncState = '⏳ Загружаю…'; render(); try { syncConflict = await pullRemote(); syncState = ''; } catch (e) { syncState = '✗ ' + e.message; } render(); }
function disconnectSync(){ if (!confirm('Отключить синхронизацию? Данные в облаке останутся, токен будет удалён из браузера.')) return; SY = {}; persistSync(); syncState = ''; render(); }

// Баннер конфликта: в облаке более новый прогресс
AFTER_RENDER.push(() => {
  const old = document.getElementById('syncbar'); if (old) old.remove();
  if (!syncConflict) return;
  const r = syncConflict, d = new Date(r.state?.updatedAt || r.savedAt);
  document.querySelector('main').insertAdjacentHTML('afterbegin', `<div id="syncbar" class="card note"><b>☁️ В облаке более новый прогресс</b> — сохранён ${d.toLocaleString('ru-RU')} (${esc((r.device || '').split(')')[0].split('(')[1] || 'другое устройство')}).
  <div class="row"><button class="btn sm" onclick="useRemote()">Загрузить из облака</button><button class="btn sm ghost" onclick="keepLocal()">Оставить этот и перезаписать облако</button></div></div>`);
});

// ───────── Обновления: уведомление о новой версии и «Что нового» ─────────
const APP_VERSION = (document.querySelector('meta[name="app-version"]')?.content || '').replace('__APP_VERSION__', '') || 'dev';
async function checkVersion(){
  if (APP_VERSION === 'dev' || document.getElementById('updbar')) return;
  try {
    const v = await (await fetch('version.json?ts=' + Date.now(), {cache: 'no-store'})).json();
    if (v.version && v.version !== APP_VERSION) {
      document.body.insertAdjacentHTML('beforeend', `<div id="updbar" class="updbar noprint"><div><b>✨ Доступна новая версия тренажёра</b><div class="small">${esc((v.notes || []).slice(0, 2).join(' · '))}</div></div>
      <button class="btn sm" onclick="pushNow().catch(()=>{}).finally(()=>location.replace(location.pathname+'?u=${esc(v.version)}'))">Обновить</button><button class="btn sm ghost" onclick="this.parentNode.remove()">Позже</button></div>`);
    }
  } catch (e) {}
}
async function whatsNew(force){
  if (APP_VERSION === 'dev' && !force) return;
  try {
    const log = await (await fetch('changelog.json?ts=' + Date.now(), {cache: 'no-store'})).json();
    const fresh = force ? log.slice(0, 5) : log.filter(e => !S.seenChangelog || e.date > S.seenChangelog);
    if (!fresh.length) return;
    const ov = document.createElement('div'); ov.className = 'overlay'; ov.id = 'whatsnew';
    ov.innerHTML = `<div class="modal"><h2>✨ Что нового</h2>${fresh.map(e => `<h3>${esc(e.title)} <span class="small muted">${esc(e.date)}</span></h3><ul>${e.notes.map(n => `<li>${esc(n)}</li>`).join('')}</ul>`).join('')}
    <p class="small muted">Ваш прогресс сохранён — обновления его не трогают.</p><button class="btn" onclick="document.getElementById('whatsnew').remove()">Понятно</button></div>`;
    document.body.appendChild(ov);
    S.seenChangelog = log[0].date; save();
  } catch (e) {}
}
setTimeout(checkVersion, 4000); setInterval(checkVersion, 30 * 60000);
setTimeout(() => whatsNew(false), 1500);

// ───────── Раздел настроек ─────────
let snapList = null;
async function loadSnaps(){ try { const keys = (await idb('readonly', st => st.getAllKeys())).sort().reverse(); snapList = keys; } catch (e) { snapList = []; } render(); }
const _vSettings7 = vSettings;
vSettings = function(){
  if (snapList === null) loadSnaps();
  const used = (() => { try { return Math.round((localStorage.getItem(KEY) || '').length / 1024); } catch (e) { return 0; } })();
  return _vSettings7().replace('<div class="card"><h2>Данные</h2>', `<div class="card"><h2>☁️ Синхронизация и облачная копия</h2>
  <p>Прогресс автоматически сохраняется в ваш <b>приватный GitHub Gist</b>: при закрытии вкладки и через пару минут после изменений. На другом устройстве или после очистки браузера подключите тот же токен — прогресс загрузится. Это защищает и от Safari, который удаляет данные сайтов после 7 дней без посещения.</p>
  ${SY.token ? `<p class="small">Подключено${SY.lastPush ? ` · выгружено ${new Date(SY.lastPush).toLocaleString('ru-RU')}` : ''}${SY.gistUrl ? ` · <a href="${esc(SY.gistUrl)}" target="_blank" rel="noopener">открыть Gist</a>` : ''}</p>
    <div class="row"><button class="btn sm" onclick="syncNow()">Выгрузить сейчас</button><button class="btn sm ghost" onclick="pullNow()">Загрузить из облака</button><button class="btn sm ghost" onclick="disconnectSync()">Отключить</button></div>`
  : `<ol class="small"><li>Создайте токен: <a href="https://github.com/settings/tokens/new?scopes=gist&description=SA%20Trainer%20sync" target="_blank" rel="noopener">github.com → Settings → Tokens</a> — отмечен только доступ <b>gist</b>, срок — на ваш выбор.</li><li>Скопируйте токен и вставьте сюда. Он хранится только в этом браузере.</li></ol>
    <input id="ghtoken" type="password" autocomplete="off" placeholder="ghp_…"><button class="btn sm" onclick="connectSync()">Подключить</button>`}
  <p class="small">${esc(syncState)}</p></div>
  <div class="card"><h2>🗂 Снимки прогресса</h2><p class="small muted">Каждый день тренажёр сам сохраняет снимок прогресса в браузере (хранятся 14 последних дней). Если что-то пошло не так — восстановите вчерашнее состояние.</p>
  ${snapList === null ? '<p class="small muted">Загрузка…</p>' : snapList.length ? snapList.map(k => `<div class="lrow"><span class="lt">${k}${k === today() ? ' (сегодня, обновляется каждые 30 мин)' : ''}</span>${k !== today() ? `<button class="btn sm ghost" onclick="restoreSnapshot('${k}')">Восстановить</button>` : ''}</div>`).join('') : '<p class="small muted">Снимков пока нет.</p>'}
  <p class="small muted">Хранилище: прогресс занимает ~${used} КБ · ${S.settings.persisted ? 'браузер обещал не удалять данные ✓' : 'постоянное хранение не подтверждено браузером'} · версия формата данных ${S.schema} · версия приложения ${esc(APP_VERSION)} · <a href="#" onclick="whatsNew(true);return false">что нового</a></p></div>
  <div class="card"><h2>Данные</h2>`);
};

syncOnLoad().then(render);
render();
