// Вход через Google и хранение прогресса в Firestore (Firebase JS SDK 12.19.0).
// Структура: users/{uid} — метаданные; users/{uid}/parts/{n} — части сжатого прогресса
// (у документа Firestore лимит 1 МБ, поэтому большой прогресс делится на части).
const V = '12.19.0';
const cfg = window.FIREBASE_CONFIG;

const ERR = {
  'auth/popup-closed-by-user': 'Окно входа закрыто до завершения',
  'auth/cancelled-popup-request': 'Вход отменён',
  'auth/unauthorized-domain': 'Этот адрес сайта не добавлен в Firebase: Authentication → Settings → Authorized domains',
  'auth/operation-not-allowed': 'Вход через Google не включён: Authentication → Sign-in method → Google',
  'auth/network-request-failed': 'Нет соединения с Google — проверьте интернет (из России иногда нужен VPN)',
  'permission-denied': 'Нет доступа к базе — проверьте правила Firestore (Rules)',
  'unavailable': 'База данных недоступна — проверьте интернет',
  'not-found': 'База Firestore не создана: Build → Firestore Database → Create database'
};
const human = e => ERR[e?.code] || e?.message || String(e);

if (!cfg?.apiKey) {
  window.FB = { configured: false };
  window.dispatchEvent(new Event('fb-ready'));
} else {
  const [{ initializeApp }, A, F] = await Promise.all([
    import(`https://www.gstatic.com/firebasejs/${V}/firebase-app.js`),
    import(`https://www.gstatic.com/firebasejs/${V}/firebase-auth.js`),
    import(`https://www.gstatic.com/firebasejs/${V}/firebase-firestore.js`)
  ]);
  const app = initializeApp(cfg);
  const auth = A.getAuth(app), db = F.getFirestore(app);
  const provider = new A.GoogleAuthProvider();
  provider.setCustomParameters({ prompt: 'select_account' });
  const listeners = [];
  let user = null, ready = false;

  A.onAuthStateChanged(auth, u => {
    user = u ? { uid: u.uid, name: u.displayName || u.email, email: u.email, photo: u.photoURL } : null;
    ready = true;
    listeners.forEach(cb => cb(user));
  });
  // Ошибка после входа через перенаправление (мобильные браузеры)
  A.getRedirectResult(auth).catch(e => listeners.forEach(cb => cb(user, human(e))));

  const PART = 700000;   // символов base64 в одной части (с запасом до лимита 1 МБ)
  window.FB = {
    configured: true,
    get user() { return user; },
    get ready() { return ready; },
    onUser(cb) { listeners.push(cb); if (ready) cb(user); },
    async signIn() {
      try { await A.signInWithPopup(auth, provider); }
      catch (e) {
        if (['auth/popup-blocked', 'auth/operation-not-supported-in-this-environment'].includes(e.code)) return A.signInWithRedirect(auth, provider);
        throw new Error(human(e));
      }
    },
    async signOut() { await A.signOut(auth); },
    // meta: {updatedAt, device, schema}; payload — строка (сжатый base64)
    async push(meta, payload) {
      if (!user) throw new Error('Не выполнен вход');
      const ref = F.doc(db, 'users', user.uid);
      const prev = await F.getDoc(ref).catch(() => null);
      const prevParts = prev?.exists() ? prev.data().parts || 0 : 0;
      const parts = Math.max(1, Math.ceil(payload.length / PART));
      try {
        const batch = F.writeBatch(db);
        for (let i = 0; i < parts; i++) batch.set(F.doc(db, 'users', user.uid, 'parts', String(i)), { data: payload.slice(i * PART, (i + 1) * PART) });
        for (let i = parts; i < prevParts; i++) batch.delete(F.doc(db, 'users', user.uid, 'parts', String(i)));
        batch.set(ref, { ...meta, parts, size: payload.length, savedAt: Date.now() });
        await batch.commit();
      } catch (e) { throw new Error(human(e)); }
    },
    async pullMeta() {
      if (!user) return null;
      try { const s = await F.getDoc(F.doc(db, 'users', user.uid)); return s.exists() ? s.data() : null; }
      catch (e) { throw new Error(human(e)); }
    },
    async pullPayload(parts) {
      try {
        const snaps = await Promise.all(Array.from({ length: parts }, (_, i) => F.getDoc(F.doc(db, 'users', user.uid, 'parts', String(i)))));
        return snaps.map(s => s.data()?.data || '').join('');
      } catch (e) { throw new Error(human(e)); }
    }
  };
  window.dispatchEvent(new Event('fb-ready'));
}
