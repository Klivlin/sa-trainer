// Аккаунт: вход через Google (Firebase) и хранение прогресса в аккаунте.
// Прогресс принадлежит аккаунту (S.owner = uid). При входе локальный и облачный прогресс сверяются:
// новее облачный и локально ничего не менялось — подтягиваем; изменения есть с двух сторон или
// на устройстве чужой прогресс — спрашиваем пользователя. Перед любой заменой сохраняется снимок.

const ACC_LS = 'sa-account';
let AC = (() => { try { return JSON.parse(localStorage.getItem(ACC_LS)) || {}; } catch (e) { return {}; } })();
const persistAC = () => { try { localStorage.setItem(ACC_LS, JSON.stringify(AC)); } catch (e) {} };
let accState = '', accPrompt = null, accBusy = false, accTimer = null;
const FBx = () => window.FB || {configured: false};

// ───────── Упаковка: JSON → gzip → base64 ─────────
function toB64(bytes){ let s = ''; for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000)); return btoa(s); }
function fromB64(b){ const s = atob(b), out = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i); return out; }
async function packState(){
  const json = JSON.stringify(S);
  if ('CompressionStream' in window) {
    const buf = await new Response(new Blob([json]).stream().pipeThrough(new CompressionStream('gzip'))).arrayBuffer();
    return 'gz:' + toB64(new Uint8Array(buf));
  }
  return 'rw:' + toB64(new TextEncoder().encode(json));
}
async function unpackState(p){
  const bytes = fromB64(p.slice(3));
  if (p.startsWith('gz:')) return JSON.parse(await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))).text());
  return JSON.parse(new TextDecoder().decode(bytes));
}
const hasProgress = s => (s.log?.length || 0) + Object.keys(s.learn?.done || {}).length + Object.keys(s.cardLog || {}).length > 0;
function deviceName(){
  const u = navigator.userAgent;
  const os = /iPhone/.test(u) ? 'iPhone' : /iPad/.test(u) ? 'iPad' : /Android/.test(u) ? 'Android' : /Mac/.test(u) ? 'Mac' : /Windows/.test(u) ? 'Windows' : /Linux/.test(u) ? 'Linux' : 'устройство';
  const br = /Edg\//.test(u) ? 'Edge' : /YaBrowser/.test(u) ? 'Яндекс Браузер' : /Chrome\//.test(u) ? 'Chrome' : /Firefox\//.test(u) ? 'Firefox' : /Safari\//.test(u) ? 'Safari' : 'браузер';
  return `${os}, ${br}`;
}
// Записать состояние без изменения отметки времени (чтобы не вызвать встречную выгрузку)
const writeRaw = () => { try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (e) {} };

// ───────── Синхронизация ─────────
async function accPush(){
  const u = FBx().user;
  if (!u || accPrompt || S.owner !== u.uid) return;
  if (!S.updatedAt) { S.updatedAt = Date.now(); writeRaw(); }
  await FB.push({updatedAt: S.updatedAt, device: deviceName(), schema: S.schema}, await packState());
  AC = {...AC, uid: u.uid, syncedAt: S.updatedAt, lastPush: Date.now()}; persistAC();
}
function schedulePushAcc(){
  clearTimeout(accTimer);
  accTimer = setTimeout(() => accPush().then(() => { if (accState.startsWith('✗')) { accState = ''; render(); } }).catch(e => { accState = '✗ ' + e.message; render(); }), 60 * 1000);
}
const _save8 = save;
save = function(){ _save8(); const u = FBx().user; if (u && S.owner === u.uid && !accPrompt) schedulePushAcc(); };
document.addEventListener('visibilitychange', () => {
  const u = FBx().user;
  if (document.visibilityState === 'hidden' && u && S.owner === u.uid && !accPrompt && S.updatedAt !== AC.syncedAt) { clearTimeout(accTimer); accPush().catch(() => {}); }
});
async function applyRemote(meta){
  const remote = await unpackState(await FB.pullPayload(meta.parts));
  try { await snapshot(); } catch (e) {}
  S = Object.assign(def(), remote); S.owner = FB.user.uid;
  writeRaw();
  AC = {...AC, uid: FB.user.uid, syncedAt: S.updatedAt}; persistAC();
  location.reload();
}
async function reconcile(user){
  if (!user) { render(); return; }
  accBusy = true; render();
  try {
    const meta = await FB.pullMeta(), mine = S.owner === user.uid;
    const localChanged = (S.updatedAt || 0) > (AC.uid === user.uid ? AC.syncedAt || 0 : 0);
    if (!meta) {
      // в аккаунте ещё нет прогресса
      if (!S.owner || mine) { S.owner = user.uid; writeRaw(); AC = {uid: user.uid}; persistAC(); await accPush(); accState = '✓ Прогресс сохранён в аккаунте'; }
      else accPrompt = {type: 'foreign-local'};
    } else if (mine) {
      if (meta.updatedAt > (S.updatedAt || 0) + 2000) { if (!localChanged) { await applyRemote(meta); return; } accPrompt = {type: 'conflict', meta}; }
      else if ((S.updatedAt || 0) > meta.updatedAt + 2000) await accPush();
    } else if (!hasProgress(S)) { await applyRemote(meta); return; }
    else accPrompt = {type: 'choose', meta};
  } catch (e) { accState = '✗ ' + e.message; }
  accBusy = false; render();
}

// ───────── Действия пользователя ─────────
async function accSignIn(){
  accState = '⏳ Открываю вход через Google…'; render();
  try { await FB.signIn(); accState = ''; } catch (e) { accState = '✗ ' + e.message; toast(e.message); }
  render();
}
async function accSyncNow(){ accState = '⏳ Синхронизирую…'; render(); try { await accPush(); accState = '✓ Прогресс сохранён в аккаунте'; } catch (e) { accState = '✗ ' + e.message; } render(); }
async function accSignOut(clearLocal){
  if (clearLocal && !confirm('Выйти и удалить прогресс с этого устройства? В аккаунте он сохранится — войдите снова, чтобы продолжить.')) return;
  accState = '⏳ Сохраняю прогресс перед выходом…'; render();
  try { await accPush(); } catch (e) { if (!confirm('Не удалось сохранить последние изменения в аккаунт: ' + e.message + '\nВсё равно выйти?')) { accState = '✗ ' + e.message; render(); return; } }
  await FB.signOut();
  if (clearLocal) {
    localStorage.removeItem(KEY); localStorage.removeItem(ACC_LS);
    await new Promise(r => { const q = indexedDB.deleteDatabase('sa-trainer'); q.onsuccess = q.onerror = q.onblocked = r; });
    location.reload(); return;
  }
  accState = 'Вы вышли. Прогресс остался на этом устройстве и синхронизируется при следующем входе.'; render();
}
async function accResolve(choice){
  const p = accPrompt; accPrompt = null; accBusy = true; render();
  try {
    if (choice === 'remote') { await applyRemote(p.meta); return; }
    if (choice === 'local') { S.owner = FB.user.uid; save(); await accPush(); accState = '✓ Прогресс этого устройства сохранён в аккаунте'; }
    if (choice === 'fresh') { try { await snapshot(); } catch (e) {} S = def(); S.owner = FB.user.uid; S.updatedAt = Date.now(); writeRaw(); await accPush(); location.reload(); return; }
  } catch (e) { accState = '✗ ' + e.message; accPrompt = p; }
  accBusy = false; render();
}

// ───────── Интерфейс ─────────
AFTER_RENDER.push(() => {
  const F = FBx(), ch = document.getElementById('chips');
  if (F.configured && ch && !ch.querySelector('.acc')) {
    const u = F.user;
    ch.insertAdjacentHTML('afterbegin', u
      ? `<span class="chip acc" title="${esc(u.email || '')}" onclick="go('settings')">${u.photo ? `<img src="${esc(u.photo)}" alt="" referrerpolicy="no-referrer">` : '👤'} ${esc((u.name || '').split(' ')[0])}${accBusy ? ' ⏳' : ''}</span>`
      : `<button class="chip acc login" onclick="accSignIn()">Войти</button>`);
  }
  const old = document.getElementById('accbar'); if (old) old.remove();
  if (!accPrompt) return;
  const m = accPrompt.meta, when = m ? new Date(m.updatedAt).toLocaleString('ru-RU') : '';
  const text = {
    conflict: `<b>Прогресс менялся на двух устройствах.</b> В аккаунте — версия от ${when} (${esc(m?.device || 'другое устройство')}), на этом устройстве — более поздние изменения. Какую оставить?`,
    choose: `<b>В аккаунте уже есть прогресс</b> от ${when} (${esc(m?.device || '')}). На этом устройстве тоже есть прогресс${S.owner ? ' другого аккаунта' : ''}. Что оставить?`,
    'foreign-local': '<b>На этом устройстве прогресс другого аккаунта.</b> В вашем аккаунте прогресса пока нет.'
  }[accPrompt.type];
  const btns = accPrompt.type === 'foreign-local'
    ? `<button class="btn sm" onclick="accResolve('fresh')">Начать с чистого листа</button><button class="btn sm ghost" onclick="accResolve('local')">Перенести этот прогресс в мой аккаунт</button>`
    : `<button class="btn sm" onclick="accResolve('remote')">Загрузить из аккаунта</button><button class="btn sm ghost" onclick="accResolve('local')">Оставить этот и сохранить в аккаунт</button>`;
  document.querySelector('main').insertAdjacentHTML('afterbegin', `<div id="accbar" class="card note"><p>👤 ${text}</p><div class="row">${btns}</div><p class="small muted">Перед заменой сохраняется снимок — его можно восстановить в «Настройках».</p></div>`);
});
function accCard(){
  const F = FBx(), u = F.user;
  if (!F.configured) return `<div class="card"><h2>👤 Аккаунт</h2><p class="muted small">Вход через Google ещё не настроен: нужно заполнить firebase-config.js параметрами проекта Firebase.</p></div>`;
  if (!u) return `<div class="card"><h2>👤 Аккаунт</h2><p>Войдите через Google — прогресс будет храниться в вашем аккаунте и откроется на любом устройстве. Если браузер очистится или вы смените компьютер, ничего не потеряется.</p>
    <button class="btn" onclick="accSignIn()">Войти через Google</button><p class="small">${esc(accState)}</p></div>`;
  return `<div class="card"><h2>👤 Аккаунт</h2><div class="row" style="gap:12px">${u.photo ? `<img class="avatar" src="${esc(u.photo)}" alt="" referrerpolicy="no-referrer">` : ''}<div><b>${esc(u.name || '')}</b><div class="small muted">${esc(u.email || '')}</div></div></div>
  <p class="small">Прогресс хранится в аккаунте и сохраняется автоматически: через минуту после изменений и при закрытии вкладки.${AC.lastPush ? ` Последнее сохранение: ${new Date(AC.lastPush).toLocaleString('ru-RU')}.` : ''}</p>
  <div class="row"><button class="btn sm" onclick="accSyncNow()">Сохранить сейчас</button><button class="btn sm ghost" onclick="accSignOut(false)">Выйти</button><button class="btn sm ghost" onclick="accSignOut(true)">Выйти и удалить с этого устройства</button></div>
  <p class="small">${esc(accState)}</p></div>`;
}
const _vSettings8 = vSettings;
vSettings = function(){ return _vSettings8().replace('<h1>Настройки</h1>', '<h1>Настройки</h1>' + accCard()); };
// Напоминание войти — на главном экране, пока нет входа
const _today8 = VIEWS.today;
VIEWS.today = () => {
  const F = FBx();
  const nudge = F.configured && F.ready && !F.user && hasProgress(S)
    ? `<div class="card note row" style="justify-content:space-between"><span>👤 Войдите через Google, чтобы прогресс хранился в аккаунте и не потерялся.</span><button class="btn sm" onclick="accSignIn()">Войти</button></div>` : '';
  return nudge + _today8();
};

function accInit(){ const F = FBx(); if (F.configured) F.onUser((u, err) => { if (err) accState = '✗ ' + err; reconcile(u); }); render(); }
if (window.FB) accInit(); else window.addEventListener('fb-ready', accInit, {once: true});
