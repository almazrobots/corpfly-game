import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import {
  createEngine, mulberry32, pickKind, circlesTouch, speedFor,
  PICKUPS, PICKUP_KINDS, SLOW_FACTOR, MULT_FACTOR, FLY_R, FLOOR, W,
  BLOCKER_POINTS, COIN_POINTS,
} from '../web/src/engine.js';

/** Ставит бонус прямо на муху — так проверяется сбор, а не везение при генерации. */
function put(eng, kind, over = {}) {
  const p = { kind, x: eng.fly.x, y: eng.fly.y, r: PICKUPS[kind].r, spin: 0, taken: false, ...over };
  eng.pickups.push(p);
  return p;
}

describe('выбор вида бонуса', () => {
  it('всегда возвращает существующий вид', () => {
    fc.assert(fc.property(fc.double({ min: 0, max: 0.999999, noNaN: true }), (r) => {
      expect(PICKUP_KINDS).toContain(pickKind(r));
    }));
  });

  it('края диапазона не выпадают за таблицу', () => {
    expect(PICKUP_KINDS).toContain(pickKind(0));
    expect(PICKUP_KINDS).toContain(pickKind(0.999999));
    expect(PICKUP_KINDS).toContain(pickKind(1));
  });

  it('монета частая, множитель редкий — распределение примерно по весам', () => {
    const rng = mulberry32(1234);
    const seen = { coin: 0, shield: 0, slow: 0, mult: 0 };
    for (let i = 0; i < 4000; i++) seen[pickKind(rng())] += 1;
    expect(seen.coin).toBeGreaterThan(seen.shield);
    expect(seen.coin).toBeGreaterThan(seen.mult);
    expect(seen.mult).toBeGreaterThan(0);
    // 60% из 4000 — ждём около 2400, допускаем широкий разброс.
    expect(seen.coin).toBeGreaterThan(2000);
    expect(seen.coin).toBeLessThan(2800);
  });
});

describe('пересечение кругов', () => {
  it('касание считается по сумме радиусов', () => {
    expect(circlesTouch(0, 0, 10, 19, 0, 10)).toBe(true);
    expect(circlesTouch(0, 0, 10, 21, 0, 10)).toBe(false);
  });

  it('симметрично', () => {
    fc.assert(fc.property(
      fc.integer({ min: -300, max: 300 }), fc.integer({ min: -300, max: 300 }),
      (dx, dy) => {
        expect(circlesTouch(0, 0, 14, dx, dy, 13)).toBe(circlesTouch(dx, dy, 13, 0, 0, 14));
      },
    ));
  });
});

describe('монета', () => {
  it('даёт очко и увеличивает счётчик бюджета', () => {
    const eng = createEngine({ rng: mulberry32(2) });
    eng.start();
    put(eng, 'coin');
    eng.update(1 / 60);
    expect(eng.coins).toBe(1);
    expect(eng.score).toBe(COIN_POINTS);
  });

  it('подбирается один раз и исчезает из мира', () => {
    const eng = createEngine({ rng: mulberry32(3) });
    eng.start();
    put(eng, 'coin');
    eng.update(1 / 60);
    eng.update(1 / 60);
    expect(eng.coins).toBe(1);
    expect(eng.pickups.some((p) => p.kind === 'coin' && p.x === eng.fly.x)).toBe(false);
  });

  it('под множителем стоит вдвое', () => {
    const eng = createEngine({ rng: mulberry32(4) });
    eng.start();
    eng.fx.mult = 5;
    put(eng, 'coin');
    eng.update(1 / 60);
    expect(eng.score).toBe(COIN_POINTS * MULT_FACTOR);
  });

  it('сообщает наружу, что именно подобрано', () => {
    const got = [];
    const eng = createEngine({ rng: mulberry32(5), onPickup: (k) => got.push(k) });
    eng.start();
    put(eng, 'coin');
    put(eng, 'shield', { y: eng.fly.y + 1 });
    eng.update(1 / 60);
    expect(got.sort()).toEqual(['coin', 'shield']);
  });
});

describe('щит', () => {
  it('включается на объявленное время', () => {
    const eng = createEngine({ rng: mulberry32(6) });
    eng.start();
    put(eng, 'shield');
    eng.update(1 / 60);
    expect(eng.fx.shield).toBeGreaterThan(PICKUPS.shield.ms / 1000 - 0.1);
  });

  it('проносит сквозь блокер, который иначе убил бы', () => {
    const eng = createEngine({ rng: mulberry32(7) });
    eng.start();
    // Блокер ровно на мухе.
    eng.obs = [{ x: eng.fly.x - 20, y: 0, w: 80, h: FLOOR, label: 'JIRA', side: 'top', passed: true }];
    eng.fx.shield = 3;
    eng.update(1 / 60);
    expect(eng.state).toBe('play');
  });

  it('без щита тот же блокер убивает — значит проверка не сломана', () => {
    const eng = createEngine({ rng: mulberry32(8) });
    eng.start();
    eng.obs = [{ x: eng.fly.x - 20, y: 0, w: 80, h: FLOOR, label: 'JIRA', side: 'top', passed: true }];
    eng.update(1 / 60);
    expect(eng.state).toBe('dead');
    expect(eng.cause).toContain('JIRA');
  });

  it('истекает и перестаёт защищать', () => {
    const eng = createEngine({ rng: mulberry32(9) });
    eng.start();
    eng.fx.shield = 0.1;
    eng.obs = [];
    for (let i = 0; i < 12; i++) eng.update(1 / 60);
    expect(eng.fx.shield).toBe(0);
    eng.obs = [{ x: eng.fly.x - 20, y: 0, w: 80, h: FLOOR, label: 'SLA', side: 'top', passed: true }];
    eng.update(1 / 60);
    expect(eng.state).toBe('dead');
  });

  it('пол сильнее щита: выгорание не отменяется', () => {
    const eng = createEngine({ rng: mulberry32(10) });
    eng.start();
    eng.fx.shield = 5;
    eng.fly.y = FLOOR - FLY_R + 1;
    eng.fly.vy = 500;
    eng.update(1 / 60);
    expect(eng.state).toBe('dead');
    expect(eng.cause).toContain('burnout');
  });
});

describe('замедление', () => {
  it('мир едет медленнее ровно на объявленный множитель', () => {
    const mk = (slow) => {
      const eng = createEngine({ rng: mulberry32(11) });
      eng.start();
      eng.obs = [{ x: 300, y: 0, w: 78, h: 100, label: 'X', side: 'top', passed: true }];
      if (slow) eng.fx.slow = 5;
      eng.update(0.1);
      return 300 - eng.obs[0].x;
    };
    const normal = mk(false);
    const slowed = mk(true);
    expect(slowed / normal).toBeCloseTo(SLOW_FACTOR, 2);
  });

  it('бонусы едут с тем же замедлением, что и блокеры', () => {
    const eng = createEngine({ rng: mulberry32(12) });
    eng.start();
    eng.obs = [{ x: 300, y: 0, w: 78, h: 100, label: 'X', side: 'top', passed: true }];
    const p = put(eng, 'coin', { x: 300, y: 10 });
    eng.fx.slow = 5;
    eng.update(0.1);
    expect(p.x).toBeCloseTo(eng.obs[0].x, 5);
  });

  it('истекает и скорость возвращается', () => {
    const eng = createEngine({ rng: mulberry32(13) });
    eng.start();
    eng.fx.slow = 0.05;
    eng.update(0.1);
    expect(eng.fx.slow).toBe(0);
    expect(speedFor(eng.score)).toBeGreaterThan(0);
  });
});

describe('множитель', () => {
  it('удваивает очки за пройденный блокер', () => {
    const pass = (mult) => {
      const eng = createEngine({ rng: mulberry32(14) });
      eng.start();
      // Блокер уже позади мухи, но ещё в мире: дальше -10 он был бы отброшен
      // как уехавший за экран и очко бы не начислилось.
      eng.obs = [{ x: eng.fly.x - 100, y: 0, w: 78, h: 10, label: 'X', side: 'top', passed: false }];
      if (mult) eng.fx.mult = 5;
      eng.update(1 / 60);
      return eng.score;
    };
    expect(pass(false)).toBe(BLOCKER_POINTS);
    expect(pass(true)).toBe(BLOCKER_POINTS * MULT_FACTOR);
  });
});

describe('вклад в итоговый счёт', () => {
  const passBlocker = (eng) => {
    eng.obs = [{ x: eng.fly.x - 100, y: 0, w: 78, h: 10, label: 'X', side: 'top', passed: false }];
    eng.update(1 / 60);
  };

  it('блокеры и монеты считаются раздельно, а счёт — их сумма', () => {
    const eng = createEngine({ rng: mulberry32(30) });
    eng.start();
    passBlocker(eng);
    put(eng, 'coin'); eng.update(1 / 60);
    put(eng, 'coin'); eng.update(1 / 60);
    expect(eng.blockers).toBe(1);
    expect(eng.coins).toBe(2);
    expect(eng.score).toBe(BLOCKER_POINTS + 2 * COIN_POINTS);
  });

  it('монеты реально двигают счёт — иначе ловить их незачем', () => {
    const withCoins = createEngine({ rng: mulberry32(31) });
    withCoins.start();
    for (let i = 0; i < 4; i++) { put(withCoins, 'coin'); withCoins.update(1 / 60); }
    expect(withCoins.score).toBe(4 * COIN_POINTS);
    expect(withCoins.score).toBeGreaterThan(0);
  });

  it('блокер весомее монеты — мастерство дороже подбирания', () => {
    expect(BLOCKER_POINTS).toBeGreaterThan(COIN_POINTS);
  });

  it('каждое начисление даёт всплывающую цифру с суммой', () => {
    const eng = createEngine({ rng: mulberry32(32) });
    eng.start();
    passBlocker(eng);
    expect(eng.pops.at(-1).text).toBe(`+${BLOCKER_POINTS}`);
    expect(eng.pops.at(-1).kind).toBe('blocker');
    put(eng, 'coin'); eng.update(1 / 60);
    expect(eng.pops.at(-1).text).toBe(`+${COIN_POINTS}`);
    expect(eng.pops.at(-1).kind).toBe('coin');
  });

  it('под множителем всплывает удвоенная сумма', () => {
    const eng = createEngine({ rng: mulberry32(33) });
    eng.start();
    eng.fx.mult = 5;
    put(eng, 'coin'); eng.update(1 / 60);
    expect(eng.pops.at(-1).text).toBe(`+${COIN_POINTS * MULT_FACTOR}`);
  });

  it('всплывающие цифры гаснут и не копятся без предела', () => {
    const eng = createEngine({ rng: mulberry32(34) });
    eng.start();
    for (let i = 0; i < 40; i++) { put(eng, 'coin'); eng.update(1 / 600); }
    expect(eng.pops.length).toBeLessThanOrEqual(12);
    for (let i = 0; i < 120; i++) eng.update(1 / 60);
    expect(eng.pops.length).toBe(0);
  });

  it('и гаснут даже на экране смерти — там мир стоит, а они висели бы вечно', () => {
    const eng = createEngine({ rng: mulberry32(36) });
    eng.start();
    put(eng, 'coin');
    eng.update(1 / 60);
    expect(eng.pops.length).toBe(1);
    eng._die('тест');
    for (let i = 0; i < 120; i++) eng.update(1 / 60);
    expect(eng.state).toBe('dead');
    expect(eng.pops.length).toBe(0);
  });

  it('reset обнуляет и блокеры, и всплывашки', () => {
    const eng = createEngine({ rng: mulberry32(35) });
    eng.start();
    passBlocker(eng);
    eng.reset();
    expect(eng.blockers).toBe(0);
    expect(eng.pops).toEqual([]);
  });
});

describe('накопление эффектов', () => {
  it('второй такой же бонус продлевает, но не копится без предела', () => {
    const eng = createEngine({ rng: mulberry32(15) });
    eng.start();
    const full = PICKUPS.shield.ms / 1000;
    for (let i = 0; i < 6; i++) { put(eng, 'shield'); eng.update(1 / 600); }
    expect(eng.fx.shield).toBeGreaterThan(full);
    expect(eng.fx.shield).toBeLessThanOrEqual(full * 2 + 0.01);
  });
});

describe('мир с бонусами остаётся корректным', () => {
  it('бонусы появляются, но не в стене и не за экраном по вертикали', () => {
    fc.assert(fc.property(fc.integer({ min: 1, max: 4000 }), (seed) => {
      const eng = createEngine({ rng: mulberry32(seed) });
      eng.start();
      for (let i = 0; i < 400; i++) {
        if (eng.state !== 'play') break;
        if (i % 12 === 0) eng.flap();
        eng.update(1 / 60);
      }
      for (const p of eng.pickups) {
        expect(PICKUP_KINDS).toContain(p.kind);
        expect(p.r).toBeGreaterThan(0);
        expect(p.y).toBeGreaterThan(0);
        expect(p.y).toBeLessThan(FLOOR);
      }
      expect(eng.coins).toBeGreaterThanOrEqual(0);
      expect(eng.score).toBeGreaterThanOrEqual(0);
    }), { numRuns: 30 });
  });

  it('reset убирает бонусы и гасит все эффекты', () => {
    const eng = createEngine({ rng: mulberry32(16) });
    eng.start();
    put(eng, 'shield'); put(eng, 'coin', { y: eng.fly.y + 1 });
    eng.update(1 / 60);
    eng.reset();
    expect(eng.pickups).toEqual([]);
    expect(eng.fx).toEqual({ shield: 0, slow: 0, mult: 0 });
    expect(eng.coins).toBe(0);
  });

  it('за забег бонусы действительно встречаются, а не только в теории', () => {
    const eng = createEngine({ rng: mulberry32(17) });
    eng.start();
    for (let i = 0; i < 900; i++) eng.spawn();
    expect(eng.pickups.length).toBeGreaterThan(300);
    const kinds = new Set(eng.pickups.map((p) => p.kind));
    expect(kinds.size).toBe(PICKUP_KINDS.length);
  });

  it('детерминированность сохраняется: тот же seed — те же бонусы', () => {
    const run = (seed) => {
      const eng = createEngine({ rng: mulberry32(seed) });
      eng.start();
      for (let i = 0; i < 120; i++) { if (i % 11 === 0) eng.flap(); eng.update(1 / 60); }
      return eng.pickups.map((p) => `${p.kind}@${p.x.toFixed(2)}:${p.y.toFixed(2)}`);
    };
    expect(run(99)).toEqual(run(99));
    expect(run(99)).not.toEqual(run(100));
  });

  it('бонус уезжает за левый край и убирается из мира', () => {
    const eng = createEngine({ rng: mulberry32(18) });
    eng.start();
    put(eng, 'coin', { x: -5, y: 20 });
    const before = eng.pickups.length;
    eng.update(1 / 60);
    expect(eng.pickups.length).toBeLessThan(before + 1);
    expect(eng.pickups.some((p) => p.x < -20)).toBe(false);
  });

  it('в состоянии отсчёта бонусы не двигаются и не подбираются', () => {
    const eng = createEngine({ rng: mulberry32(19) });
    eng.arm();
    const p = put(eng, 'coin', { x: W / 2, y: eng.fly.y });
    const x0 = p.x;
    for (let i = 0; i < 60; i++) eng.update(1 / 60);
    expect(p.x).toBe(x0);
    expect(eng.coins).toBe(0);
  });
});
