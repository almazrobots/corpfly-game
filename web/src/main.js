import { createEngine, W, H, BLOCKER_POINTS, COIN_POINTS } from './engine.js';
import { draw } from './render.js';
import { triangleCount } from './fly3d.js';
import { formatHandle } from './identity-view.js';
import * as tg from './tg.js';
import * as api from './api.js';
import { createSfx } from './sfx.js';

const $ = (id) => document.getElementById(id);
const show = (id) => $(id).classList.remove('hidden');
const hide = (id) => $(id).classList.add('hidden');

tg.boot();

// ---------- звук ----------
const sfx = createSfx();
// Две кнопки, одно состояние: в панели (между раундами) и мелкая поверх игры.
const SOUND_BUTTONS = ['soundBtn', 'soundMini'];
function paintSound() {
  for (const id of SOUND_BUTTONS) $(id).setAttribute('aria-pressed', String(sfx.enabled));
}
function toggleSound() {
  const on = sfx.toggle();
  paintSound();
  // Щелчок подтверждения — только когда включаем, иначе он прозвучал бы после выключения.
  if (on) { sfx.unlock(); sfx.play('count'); }
  tg.haptic('flap');
}
for (const id of SOUND_BUTTONS) $(id).onclick = toggleSound;

/**
 * Панель и её дублёр всегда в противофазе: доступ к звуку не должен пропадать
 * ни на одном экране, но и две одинаковые кнопки одновременно не нужны.
 */
function setBarHidden(hidden) {
  $('bar').classList.toggle('hidden', hidden);
  $('soundMini').classList.toggle('hidden', !hidden);
}

// ---------- canvas ----------
const cv = $('c');
const ctx = cv.getContext('2d');
let scale = 1;
function resize() {
  scale = Math.min(innerWidth / W, innerHeight / H);
  const dpr = Math.min(devicePixelRatio || 1, 2.5);
  cv.width = Math.round(W * dpr);
  cv.height = Math.round(H * dpr);
  cv.style.width = `${W * scale}px`;
  cv.style.height = `${H * scale}px`;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}
addEventListener('resize', resize);
resize();

// ---------- состояние игрока ----------
// В Telegram рекорд живёт на сервере (он же основание рейтинга). В обычном браузере
// сервера для нас нет — там честный локальный рекорд, чтобы игра не ломалась.
const LOCAL_BEST = 'corpfly_best';
const me = {
  handle: null,
  best: Number(localStorage.getItem(LOCAL_BEST) || 0),
  rank: null,
  total: 0,
  online: false,
};

function paintIdentity() {
  $('myHandle').textContent = me.handle ?? (tg.isTelegram ? '…' : 'offline');
  $('best').textContent = String(me.best);
  $('rank').textContent = me.rank ? `${me.rank} of ${me.total}` : '—';
}

async function openSession() {
  if (!tg.isTelegram) { paintIdentity(); return; }
  try {
    const r = await api.session();
    me.online = true;
    me.handle = r.you.handle;
    me.best = Math.max(me.best, r.you.best);
    me.rank = r.you.rank;
    me.total = r.total;
  } catch (e) {
    me.handle = 'offline';
    console.warn('session failed:', e.message);
  }
  paintIdentity();
}

// ---------- движок ----------
const eng = createEngine({
  onFlap: () => { tg.haptic('flap'); sfx.play('flap'); },
  onScore: () => { tg.haptic('flap'); sfx.play('score'); },
  onPickup: (kind) => {
    tg.haptic(kind === 'coin' ? 'flap' : 'record');
    sfx.play(kind === 'coin' ? 'coin' : 'power');
  },
  onDeath: (score, why) => finish(score, why),
});

// Окончание эффекта слышно: иначе игрок замечает пропажу щита уже столкновением.
const fxWas = { shield: false, slow: false, mult: false };
function watchEffects() {
  for (const k of ['shield', 'slow', 'mult']) {
    const on = eng.fx[k] > 0;
    if (fxWas[k] && !on && eng.state === 'play') sfx.play('powerOff');
    fxWas[k] = on;
  }
}

async function finish(score, why) {
  tg.haptic('hit');
  sfx.play('crash');
  sfx.play('death');
  sfx.stopAmbient();
  const localRecord = score > me.best;
  if (localRecord) { me.best = score; localStorage.setItem(LOCAL_BEST, String(score)); }

  if (me.online) {
    try {
      const r = await api.submitScore(score);
      me.best = r.you.best;
      me.rank = r.you.rank;
      me.total = r.total;
      if (r.improved) { tg.haptic('record'); sfx.play('record'); }
    } catch (e) {
      console.warn('score submit failed:', e.message);
    }
  } else if (localRecord) {
    tg.haptic('record');
    sfx.play('record');
  }

  setTimeout(() => {
    $('cause').textContent = why;
    // Слагаемые и итог: видно, что монеты вошли в рейтинг, а не пропали.
    $('sc').textContent = `${eng.blockers} x ${BLOCKER_POINTS} = ${eng.blockers * BLOCKER_POINTS}`;
    $('budget').textContent = `${eng.coins} x ${COIN_POINTS} = ${eng.coins * COIN_POINTS}`;
    $('total').textContent = String(score);
    $('dopa').textContent = `${(score * 0.013).toFixed(2)} units`;
    paintIdentity();
    show('over');
    $('go').textContent = 'RE-RUN SIMULATION';
    setBarHidden(false);
  }, 650);
}

// ---------- отсчёт перед забегом ----------
// Раньше забег начинался падением: мир отпускали в тот же кадр, когда исчезала
// карточка, и первая жизнь уходила на осознание, что игра уже идёт. Теперь поле
// сначала собирается и замирает, а игрок видит 3-2-1.
const COUNT_STEP_MS = 700;
const COUNT_GO_MS = 450;
let countTimer = null;

function paintCount(text, isGo) {
  const el = $('countNum');
  el.classList.remove('go');
  if (isGo) el.classList.add('go');
  // Перезапуск анимации: без снятия и возврата класса браузер её не проигрывает заново.
  el.style.animation = 'none';
  void el.offsetWidth;
  el.style.animation = '';
  el.textContent = text;
}

function abortCountdown() {
  if (countTimer) { clearTimeout(countTimer); countTimer = null; }
  hide('count');
  sfx.stopAmbient();
}

function beginRun() {
  abortCountdown();
  // Жест пользователя — единственный момент, когда браузер отдаёт звук.
  sfx.unlock();
  hide('start'); hide('over'); hide('board');
  setBarHidden(true);
  eng.arm();
  show('count');

  let n = 3;
  const step = () => {
    if (n > 0) {
      paintCount(String(n), false);
      tg.haptic('flap');
      sfx.play('count');
      n -= 1;
      countTimer = setTimeout(step, COUNT_STEP_MS);
    } else {
      paintCount('GO', true);
      tg.haptic('record');
      sfx.play('go');
      sfx.startAmbient();
      countTimer = setTimeout(() => {
        countTimer = null;
        hide('count');
        eng.launch();
      }, COUNT_GO_MS);
    }
  };
  step();
}

// ---------- ввод ----------
function flap() {
  // Из покоя тап запускает забег — но через отсчёт, а не сразу в падение.
  if (eng.state === 'idle') { beginRun(); return; }
  eng.flap();
}
const overCard = (e) => e.target.closest?.('.card') || e.target.closest?.('#bar') || e.target.closest?.('#soundMini');
addEventListener('pointerdown', (e) => { if (!overCard(e)) { e.preventDefault(); flap(); } }, { passive: false });
addEventListener('keydown', (e) => {
  if (e.code === 'Space' || e.code === 'ArrowUp') { e.preventDefault(); flap(); }
  if (e.code === 'Escape') closeBoard();
});

$('go').onclick = beginRun;

// ---------- рейтинг ----------
let boardReturnsTo = 'start';
async function openBoard() {
  // Куда вернуть: на стартовый экран или на экран смерти — смотрим, что открыто.
  boardReturnsTo = $('over').classList.contains('hidden') ? 'start' : 'over';
  hide('start'); hide('over');
  setBarHidden(true);
  const list = $('boardList');
  list.innerHTML = '<li class="empty">Loading ranking…</li>';
  $('youLine').textContent = '';
  show('board');
  try {
    const r = await api.leaderboard(50);
    me.total = r.total;
    renderBoard(r);
  } catch (e) {
    list.innerHTML = `<li class="empty">Ranking unavailable${tg.isTelegram ? '' : ' — open the game in Telegram'}.</li>`;
    console.warn('leaderboard failed:', e.message);
  }
}

function renderBoard(r) {
  const list = $('boardList');
  // Свою строку узнаём по собственному номеру, полученному при открытии сессии.
  const mySeq = me.handle ? Number(String(me.handle).slice(1).split(' ')[0]) : null;
  if (!r.board.length) {
    list.innerHTML = '<li class="empty">No records yet. Be the first.</li>';
  } else {
    list.innerHTML = '';
    for (const row of r.board) {
      const li = document.createElement('li');
      if (row.rank <= 3) li.classList.add(`top${row.rank}`);
      if (mySeq && row.seq === mySeq) li.classList.add('me');
      const pos = document.createElement('span'); pos.className = 'pos'; pos.textContent = `${row.rank}.`;
      const who = document.createElement('span'); who.className = 'who';
      who.textContent = formatHandle(row.seq, row.initials);
      const pts = document.createElement('span'); pts.className = 'pts'; pts.textContent = String(row.best);
      li.append(pos, who, pts);
      list.append(li);
    }
  }
  $('youLine').textContent = me.handle && me.online
    ? `You are ${me.handle} · best ${me.best}${me.rank ? ` · rank ${me.rank} of ${r.total}` : ''}`
    : `Players with a record: ${r.total}`;
}

function closeBoard() {
  if ($('board').classList.contains('hidden')) return;
  hide('board');
  show(boardReturnsTo);
  setBarHidden(false);
}
$('boardBtn').onclick = openBoard;
$('closeBoard').onclick = closeBoard;

// ---------- цикл ----------
let last = 0;
function loop(now) {
  const dt = Math.min(0.033, (now - last) / 1000 || 0);
  last = now;
  eng.update(dt);
  watchEffects();
  draw(ctx, eng, now);
  requestAnimationFrame(loop);
}
setInterval(() => {
  if (eng.state === 'idle') {
    eng.fly.y = H * 0.45 + Math.sin(performance.now() / 300) * 8;
    eng.fly.wing = 0.5;
  }
}, 30);

$('polys').textContent = `${triangleCount} tris`;
setBarHidden(false);
paintSound();
paintIdentity();
openSession();
requestAnimationFrame(loop);
