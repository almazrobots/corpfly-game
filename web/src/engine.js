// Чистое ядро игры: никакого canvas, DOM и Math.random. Всё случайное приходит
// через инжектируемый rng, поэтому прогон детерминирован и проверяем в vitest.

export const W = 420;
export const H = 720;
export const FLOOR = H - 64;

export const G = 1900;        // гравитация, px/s^2
export const FLAP = -520;     // импульс взмаха, px/s
export const SPEED0 = 190;    // стартовая горизонтальная скорость, px/s
export const SPEED_MAX_BONUS = 120;
export const GAP0 = 210;      // стартовый просвет между блокерами
export const GAP_MIN = 140;
export const FLY_R = 14;      // радиус коллизии мухи
export const BLOCK_W = 78;

export const PAINS = [
  'ALIGNMENT', 'SYNERGY', 'DEADLINE', 'Q4 FREEZE', 'OKR REVIEW', 'JIRA', 'COMPLIANCE', 'SECURITY REVIEW',
  'VENDOR LOCK-IN', 'HALLUCINATION', 'RAG PIPELINE', 'TOKEN BUDGET', 'LEGACY DB', 'PROCUREMENT', 'SAML SSO',
  'POC PURGATORY', 'GDPR', 'TECH DEBT', 'ON-CALL', 'STAKEHOLDERS', 'RETRO', 'REORG', 'AI STRATEGY DECK',
  'INDEXING', 'LATENCY', 'SLA', 'ROADMAP', 'SCOPE CREEP', 'MVP', 'ARCHITECTURE BOARD', 'BUDGET CUT',
  'CHANGE REQUEST', 'LOW-CODE', 'DATA GOVERNANCE', 'PROMPT INJECTION', 'RATE LIMIT', 'MIGRATION',
  'STANDUP', 'ALL-HANDS', 'ESCALATION', 'LEGAL', 'INFOSEC', 'CONTEXT WINDOW', 'EVAL SET', 'CHURN',
  'SYNC CALL', 'DEPENDENCY HELL', 'ACCESS REQUEST', 'AGENT LOOP', 'KPI', 'SANDBOX ONLY', 'ROI SLIDE',
];

/**
 * Бонусы в коридоре. Монета — частая и просто даёт очки; усилители редки и меняют
 * правила на время. Веса заданы целыми числами, а выбор идёт по накопленной сумме —
 * так добавление нового вида не требует пересчёта вероятностей руками.
 */
/**
 * Цена достижений. Блокер дороже монеты: пролететь сквозь коридор труднее, чем
 * подобрать то, что уже висит по дороге. Но монета — не декорация: семь монет
 * весят как три с половиной блокера, и в рейтинге это видно.
 */
export const BLOCKER_POINTS = 10;
export const COIN_POINTS = 5;

export const PICKUPS = {
  coin:   { weight: 60, r: 13, score: COIN_POINTS, ms: 0, label: 'BUDGET' },
  shield: { weight: 15, r: 15, score: 0, ms: 5000, label: 'EXEC SPONSOR' },
  slow:   { weight: 15, r: 15, score: 0, ms: 4500, label: 'DEADLINE SLIP' },
  mult:   { weight: 10, r: 15, score: 0, ms: 8000, label: 'OKR x2' },
};
export const PICKUP_KINDS = Object.keys(PICKUPS);
const TOTAL_WEIGHT = PICKUP_KINDS.reduce((n, k) => n + PICKUPS[k].weight, 0);

export const SLOW_FACTOR = 0.6;   // «сдвинули срок» — мир едет медленнее
export const MULT_FACTOR = 2;     // «OKR x2» — очки идут вдвойне
export const PICKUP_CHANCE = 0.55;

/** Выбор вида бонуса по весам. Вынесено отдельно, чтобы проверять распределение. */
export function pickKind(r) {
  let acc = 0;
  const x = r * TOTAL_WEIGHT;
  for (const k of PICKUP_KINDS) {
    acc += PICKUPS[k].weight;
    if (x < acc) return k;
  }
  return PICKUP_KINDS[PICKUP_KINDS.length - 1];
}

/** Пересечение двух кругов — муха и бонус. */
export const circlesTouch = (ax, ay, ar, bx, by, br) =>
  (ax - bx) ** 2 + (ay - by) ** 2 < (ar + br) ** 2;

export const EPITAPH_FLOOR = 'burnout. The floor was burnout.';
export const EPITAPH_PING = 'a Slack @here at 23:40';
export const epitaphFor = (label) => `blocked by ${label}`;

/** Детерминированный ГПСЧ (mulberry32) — нужен и тестам, и воспроизводимым прогонам. */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function rng() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Просвет сужается с каждым пройденным блокером, но не ниже GAP_MIN. */
export const gapFor = (score) => Math.max(GAP_MIN, GAP0 - score * 3);

/** Скорость растёт со счётом и упирается в потолок. */
export const speedFor = (score) => SPEED0 + Math.min(SPEED_MAX_BONUS, score * 4);

/** Круг (муха) против прямоугольника (блокер) — ближайшая точка прямоугольника. */
export function hitsRect(cx, cy, r, rx, ry, rw, rh) {
  const px = Math.max(rx, Math.min(cx, rx + rw));
  const py = Math.max(ry, Math.min(cy, ry + rh));
  return (cx - px) ** 2 + (cy - py) ** 2 < r * r;
}

export function createEngine({ rng = Math.random, onDeath = null, onScore = null, onFlap = null, onPickup = null } = {}) {
  const eng = {
    state: 'idle',      // idle | play | dead
    fly: null,
    obs: [],
    spikes: [],
    particles: [],
    raster: [],
    t: 0,
    score: 0,
    coins: 0,
    blockers: 0,
    // Всплывающие «+10» / «+5»: чистые данные, рисует их render.js.
    pops: [],
    dist: 0,
    nextX: 0,
    cause: '',
    pickups: [],
    // Оставшееся время эффектов в секундах. Ноль — эффекта нет.
    fx: { shield: 0, slow: 0, mult: 0 },
  };

  const pickPain = () => PAINS[Math.floor(rng() * PAINS.length) % PAINS.length];

  function reset() {
    eng.fly = { x: 110, y: H * 0.45, vy: 0, a: 0, wing: 0 };
    eng.obs = [];
    eng.spikes = [];
    eng.particles = [];
    eng.raster = new Array(96).fill(0);
    eng.pickups = [];
    eng.pops = [];
    eng.fx = { shield: 0, slow: 0, mult: 0 };
    eng.t = 0;
    eng.score = 0;
    eng.coins = 0;
    eng.blockers = 0;
    eng.dist = 0;
    eng.nextX = W + 120;
    eng.cause = '';
  }

  function spawn() {
    const gap = gapFor(eng.score);
    const cy = 120 + gap / 2 + rng() * (FLOOR - 240 - gap);
    const top = { x: eng.nextX, y: 0, w: BLOCK_W, h: cy - gap / 2, label: pickPain(), side: 'top', passed: false };
    const bot = { x: eng.nextX, y: cy + gap / 2, w: BLOCK_W, h: FLOOR - (cy + gap / 2), label: pickPain(), side: 'bot', passed: false };
    eng.obs.push(top, bot);
    // Пинг в слаке — редкий летающий блокер, появляется только на высоком счёте.
    if (eng.score > 6 && rng() < 0.35) {
      const fy = rng() < 0.5 ? top.h + 18 : bot.y - 40;
      eng.obs.push({
        x: eng.nextX + BLOCK_W + 120 + rng() * 40, y: fy, yy: fy, w: 64, h: 22,
        label: '@here', side: 'ping', passed: true, float: rng() * Math.PI * 2,
      });
    }
    // Бонус висит В КОРИДОРЕ за парой блокеров, а не в самом просвете: так за ним
    // надо лететь осознанно, а не собирать случайно по дороге.
    if (rng() < PICKUP_CHANCE) {
      const kind = pickKind(rng());
      const halfGap = gap / 2 - PICKUPS[kind].r - 6;
      eng.pickups.push({
        kind,
        x: eng.nextX + BLOCK_W + 70,
        y: cy + (rng() * 2 - 1) * Math.max(0, halfGap),
        r: PICKUPS[kind].r,
        spin: rng() * Math.PI * 2,
        taken: false,
      });
    }
    eng.nextX += 250 + rng() * 60;
  }

  function start() {
    reset();
    eng.state = 'play';
    spawn(); spawn(); spawn();
  }

  /**
   * Собрать мир и замереть. Игрок видит поле и первый блокер, но муха не падает:
   * на это время идёт отсчёт. Без него забег начинался падением, и человек
   * тратил первую жизнь на то, чтобы понять, что игра уже идёт.
   */
  function arm() {
    reset();
    eng.state = 'ready';
    spawn(); spawn(); spawn();
  }

  /** Отсчёт кончился — отпускаем мир. */
  function launch() {
    if (eng.state !== 'ready') return false;
    eng.state = 'play';
    // Полноценный первый взмах делает игра — как будто игрок тапнул ровно на GO.
    // Половинного импульса не хватало: до пола оставалось 0.73 с, и человек всё
    // ещё не успевал поставить палец. С полным — около 0.9 с и подъём в начале,
    // то есть первое движение на экране направлено вверх, а не вниз.
    eng.fly.vy = FLAP;
    eng.fly.wing = 1;
    return true;
  }

  function flap() {
    if (eng.state === 'idle') { start(); return true; }
    // Во время отсчёта тапы не копятся: иначе к слову GO накопленный импульс
    // выкидывает муху в потолок.
    if (eng.state !== 'play') return false;
    eng.fly.vy = FLAP;
    eng.fly.wing = 1;
    eng.spikes.push({ x: eng.fly.x, y: eng.fly.y, r: 4 });
    if (onFlap) onFlap();
    return true;
  }

  /** Всплывашки поднимаются, уезжают вместе с миром и гаснут. */
  function decayPops(dt, speed) {
    for (const q of eng.pops) { q.y -= 34 * dt; q.x -= speed * dt * 0.6; q.life -= dt * 1.1; }
    eng.pops = eng.pops.filter((q) => q.life > 0);
  }

  /** Цифра, всплывающая над местом начисления. Живёт секунду и гаснет. */
  function pop(x, y, text, kind) {
    eng.pops.push({ x, y, text, kind, life: 1 });
    // Экран не должен превратиться в ленту цифр, если игрок собрал десяток разом.
    if (eng.pops.length > 12) eng.pops.shift();
  }

  function collect(p) {
    p.taken = true;
    const def = PICKUPS[p.kind];
    if (def.score) {
      eng.coins += 1;
      const gained = def.score * (eng.fx.mult > 0 ? MULT_FACTOR : 1);
      eng.score += gained;
      pop(p.x, p.y, `+${gained}`, 'coin');
    }
    // Эффект не складывается, а продлевается от текущего момента: подобрать два
    // щита подряд должно быть выгодно, но не давать десятикратный запас.
    if (def.ms) eng.fx[p.kind] = Math.min(eng.fx[p.kind] + def.ms / 1000, (def.ms / 1000) * 2);
    if (onPickup) onPickup(p.kind, eng);
  }

  function die(why) {
    eng.state = 'dead';
    eng.cause = why;
    for (let i = 0; i < 26; i++) {
      eng.particles.push({
        x: eng.fly.x, y: eng.fly.y,
        vx: (rng() - 0.5) * 420, vy: (rng() - 0.8) * 420, life: 1,
      });
    }
    if (onDeath) onDeath(eng.score, why);
  }

  function update(dt) {
    eng.t += dt;

    // Отсчёт: мир собран и виден, но ничто не движется. Муха мягко висит на месте.
    if (eng.state === 'ready') {
      eng.fly.y = H * 0.45 + Math.sin(eng.t * 6) * 6;
      eng.fly.vy = 0;
      eng.fly.a = 0;
      eng.fly.wing = 0.6;
      return;
    }

    // Гравитация работает только в живом забеге. Мёртвую муху на экране уже заменили
    // частицы, и продолжать её ронять незачем: за минуту на экране смерти y уходил
    // в десятки тысяч пикселей — состояние, которое растёт и никому не нужно.
    if (eng.state === 'play') {
      eng.fly.vy += G * dt;
      eng.fly.y += eng.fly.vy * dt;
      eng.fly.a = Math.max(-0.5, Math.min(1.1, eng.fly.vy / 600));
      eng.fly.wing = Math.max(0, eng.fly.wing - dt * 6);
    }
    // Всплывающие цифры гаснут и после смерти: иначе последние «+10» замирают
    // на экране блокировки и висят там до перезапуска.
    decayPops(dt, 0);

    if (eng.state !== 'play') {
      for (const p of eng.particles) { p.x += p.vx * dt; p.y += p.vy * dt; p.vy += 900 * dt; p.life -= dt * 1.4; }
      eng.particles = eng.particles.filter((p) => p.life > 0);
      return;
    }

    // Таймеры эффектов идут по игровому времени и гаснут сами.
    for (const k of ['shield', 'slow', 'mult']) {
      if (eng.fx[k] > 0) eng.fx[k] = Math.max(0, eng.fx[k] - dt);
    }

    // «Сдвинули срок» замедляет мир целиком — и блокеры, и бонусы.
    const speed = speedFor(eng.score) * (eng.fx.slow > 0 ? SLOW_FACTOR : 1);
    eng.dist += speed * dt;
    for (const o of eng.obs) o.x -= speed * dt;
    eng.obs = eng.obs.filter((o) => o.x + o.w > -10);

    // В живом забеге они уезжают вместе с миром; общий спад уже применён выше.
    for (const q of eng.pops) q.x -= speed * dt * 0.6;
    for (const p of eng.pickups) { p.x -= speed * dt; p.spin += dt * 3.4; }
    eng.pickups = eng.pickups.filter((p) => !p.taken && p.x + p.r > -10);

    // Досыпаем препятствия, когда самое правое уехало внутрь экрана.
    const lastX = eng.obs.length ? Math.max(...eng.obs.map((o) => o.x)) : 0;
    if (lastX < W - 60) {
      eng.nextX = Math.max(lastX + 250 + rng() * 60, W + 20);
      spawn();
    }

    const { x: fx, y: fy } = eng.fly;
    for (const o of eng.obs) {
      if (o.side === 'ping') { o.float += dt * 3; o.yy = o.y + Math.sin(o.float) * 8; }
      const oy = o.side === 'ping' ? o.yy : o.y;
      if (!o.passed && o.side === 'top' && o.x + o.w < fx) {
        o.passed = true;
        eng.blockers += 1;
        const gained = BLOCKER_POINTS * (eng.fx.mult > 0 ? MULT_FACTOR : 1);
        eng.score += gained;
        pop(o.x + o.w, o.h + 24, `+${gained}`, 'blocker');
        if (onScore) onScore(eng.score);
      }
      // Щит пропускает сквозь блокеры. Пол он не отменяет: выгорание сильнее спонсора.
      if (eng.fx.shield <= 0 && hitsRect(fx, fy, FLY_R, o.x, oy, o.w, o.h)) {
        die(o.side === 'ping' ? EPITAPH_PING : epitaphFor(o.label));
        return;
      }
    }
    for (const p of eng.pickups) {
      if (!p.taken && circlesTouch(fx, fy, FLY_R, p.x, p.y, p.r)) collect(p);
    }
    eng.pickups = eng.pickups.filter((p) => !p.taken);

    if (fy + FLY_R > FLOOR) { eng.fly.y = FLOOR - FLY_R; die(EPITAPH_FLOOR); return; }
    if (fy - FLY_R < 0) { eng.fly.y = FLY_R; eng.fly.vy = 0; }

    eng.raster.shift();
    eng.raster.push(Math.min(1, Math.abs(eng.fly.vy) / 700 + (eng.fly.wing > 0 ? 0.6 : 0)));
    for (const s of eng.spikes) { s.x -= speed * dt; s.r += dt * 90; }
    eng.spikes = eng.spikes.filter((s) => s.r < 40);
  }

  reset();
  return Object.assign(eng, { reset, start, arm, launch, flap, update, spawn, _die: die, _collect: collect });
}
