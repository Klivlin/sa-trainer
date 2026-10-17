// Карточки с развёрнутой теорией: новая карточка сначала показывается целиком (знакомство),
// при повторении — вопрос, затем ответ с блоком «Подробнее», примером, уроком и объяснением ИИ.

S.cardAI = S.cardAI || {};
const CBUSY = {};

function cardTheory(i, open){
  const c = CARDS[i], d = CARD_DETAILS[c[1]] || {}, l = d.lesson && lessonById(d.lesson), ai = S.cardAI[i];
  return `<details class="card cardmore" ${open ? 'open' : ''}><summary>📖 Подробнее: теория и пример</summary>
  ${d.more ? `<div class="lesson">${mdLite(d.more)}</div>` : ''}
  ${d.ex ? `<div class="tut"><b>Пример.</b> ${esc(d.ex)}</div>` : ''}
  <div class="row">${l ? `<button class="btn sm ghost" onclick="openLesson('${l.id}')">📚 Урок: ${esc(l.title)}</button>` : ''}
  ${AI.enabled ? `<button class="btn sm ghost" onclick="cardExplain(${i})" ${CBUSY[i] ? 'disabled' : ''}>${CBUSY[i] ? '⏳ Думаю… (до минуты)' : ai ? '🤔 Объяснить ещё раз' : '🤔 Объясни проще'}</button>` : ''}</div>
  ${CBUSY.err?.[i] ? `<p class="err small">${esc(CBUSY.err[i])}</p>` : ''}
  ${ai ? `<div class="tut"><h3>🤔 Проще</h3>${mdLite(ai)}</div>` : ''}</details>`;
}
async function cardExplain(i){
  const c = CARDS[i], d = CARD_DETAILS[c[1]] || {};
  CBUSY[i] = true; CBUSY.err = CBUSY.err || {}; CBUSY.err[i] = null; render();
  try { const r = await AI.tutor({title: 'Карточка: ' + c[1], kind: 'карточка теории', cat: c[0], scenario: c[2] + '\n\n' + (d.more || '') + '\nПример: ' + (d.ex || ''), task: 'Понять и запомнить тему карточки'}, 'simpler'); S.cardAI[i] = r.text; save(); }
  catch (e) { CBUSY.err[i] = e.message; }
  CBUSY[i] = false; render();
}

const _vCards9 = vCards;
vCards = function(){
  const q = cardSession.queue;
  if (!q.length || typeof q[0] !== 'number') return _vCards9();
  const i = q[0], c = CARDS[i], st = S.cards[i], L = S.cardLog[today()] || {n: 0};
  const learned = Object.keys(S.cards).length;
  const head = `<h1>Карточки</h1><p class="muted">Осталось ${q.length} · повторено сегодня ${L.n} · изучено ${learned}/${CARDS.length}</p>`;
  // Новая карточка: сначала знакомство — всё сразу, без угадывания
  if (!st) return head + `<div class="flash new"><div class="tags"><span class="tag">${esc(c[0])}</span><span class="tag ok">Новая тема</span></div>
    <h2>${esc(c[1])}</h2><hr><p><b>Коротко:</b> ${esc(c[2])}</p></div>
    ${cardTheory(i, true)}
    <p class="small muted">Прочитайте и постарайтесь пересказать своими словами. Завтра карточка вернётся уже как вопрос.</p>
    <div class="rate grades"><button class="btn" onclick="gradeCard(${i},2)">Понятно, повторить завтра</button><button class="btn ghost" onclick="gradeCard(${i},3)">Я это уже знаю</button></div>`;
  // Повторение: вопрос → ответ + теория (для недавно изученных раскрыта сразу)
  return head + `<div class="flash" onclick="cardSession.flipped=true;render()"><span class="tag">${esc(c[0])}</span><h2>${esc(c[1])}</h2>
  ${cardSession.flipped ? `<hr><p>${esc(c[2])}</p>` : '<p class="muted">Вспомните ответ, затем нажмите, чтобы проверить</p>'}</div>
  ${cardSession.flipped ? cardTheory(i, (st.reps || 0) < 2) + `<div class="rate grades"><button class="btn bad" onclick="gradeCard(${i},0)">Не помню</button><button class="btn ghost" onclick="gradeCard(${i},1)">Трудно</button><button class="btn" onclick="gradeCard(${i},2)">Помню</button><button class="btn ghost" onclick="gradeCard(${i},3)">Легко</button></div>` : ''}`;
};
render();
