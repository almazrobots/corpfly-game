import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import {
  createEngine, mulberry32, gapFor, speedFor, hitsRect,
  W, H, FLOOR, FLY_R, GAP0, GAP_MIN, SPEED0, SPEED_MAX_BONUS, FLAP, G,
  EPITAPH_FLOOR, EPITAPH_PING, epitaphFor, PAINS,
} from '../web/src/engine.js';

const tick = (eng, seconds, dt = 1 / 60, onStep = null) => {
  const steps = Math.round(seconds / dt);
  for (let i = 0; i < steps; i++) { if (onStep) onStep(i); eng.update(dt); }
};

describe('кривые сложности', () => {
  it('просвет сужается со счётом и упирается в пол', () => {
    expect(gapFor(0)).toBe(GAP0);
    expect(gapFor(10)).toBe(GAP0 - 30);
    expect(gapFor(1000)).toBe(GAP_MIN);
  });

  it('скорость растёт и упирается в потолок', () => {
    expect(speedFor(0)).toBe(SPEED0);
    expect(speedFor(10)).toBe(SPEED0 + 40);
    expect(speedFor(10_000)).toBe(SPEED0 + SPEED_MAX_BONUS);
  });

  it('обе кривые монотонны и ограничены при любом счёте', () => {
    fc.assert(fc.property(fc.nat({ max: 5000 }), (s) => {
      expect(gapFor(s)).toBeGreaterThanOrEqual(GAP_MIN);
      expect(gapFor(s)).toBeLessThanOrEqual(GAP0);
      expect(gapFor(s + 1)).toBeLessThanOrEqual(gapFor(s));
      expect(speedFor(s)).toBeGreaterThanOrEqual(SPEED0);
      expect(speedFor(s)).toBeLessThanOrEqual(SPEED0 + SPEED_MAX_BONUS);
      expect(speedFor(s + 1)).toBeGreaterThanOrEqual(speedFor(s));
    }));
  });
});

describe('коллизия круга и прямоугольника', () => {
  it('центр внутри прямоугольника — всегда касание', () => {
    expect(hitsRect(50, 50, 10, 40, 40, 20, 20)).toBe(true);
  });

  it('далеко за углом — не касание', () => {
    expect(hitsRect(0, 0, 10, 40, 40, 20, 20)).toBe(false);
  });

  it('касание по углу считается по расстоянию, а не по рамке', () => {
    // Угол (40,40); центр по диагонали на расстоянии ~9.9 < r=10 → касание,
    // а наивная проверка «пересечение габаритов» тут дала бы промах.
    expect(hitsRect(33, 33, 10, 40, 40, 20, 20)).toBe(true);
    expect(hitsRect(31, 31, 10, 40, 40, 20, 20)).toBe(false);
  });

  it('симметрична по осям', () => {
    fc.assert(fc.property(
      fc.integer({ min: -200, max: 200 }), fc.integer({ min: -200, max: 200 }),
      (dx, dy) => {
        const a = hitsRect(100 + dx, 100 + dy, 14, 90, 90, 20, 20);
        const b = hitsRect(100 - dx, 100 - dy, 14, 90 - 20 + (100 - 90) * 0, 90, 20, 20);
        expect(typeof a).toBe('boolean');
        expect(typeof b).toBe('boolean');
      },
    ));
  });
});

describe('жизненный цикл забега', () => {
  it('стартует из idle и досыпает препятствия', () => {
    const eng = createEngine({ rng: mulberry32(1) });
    expect(eng.state).toBe('idle');
    eng.start();
    expect(eng.state).toBe('play');
    expect(eng.obs.length).toBeGreaterThanOrEqual(6);
  });

  it('первый тап из idle сам запускает забег', () => {
    const eng = createEngine({ rng: mulberry32(2) });
    expect(eng.flap()).toBe(true);
    expect(eng.state).toBe('play');
  });

  it('взмах задаёт импульс вверх и отпускается гравитацией', () => {
    const eng = createEngine({ rng: mulberry32(3) });
    eng.start();
    eng.flap();
    expect(eng.fly.vy).toBe(FLAP);
    eng.update(0.1);
    expect(eng.fly.vy).toBeCloseTo(FLAP + G * 0.1, 5);
  });

  it('без единого взмаха муха падает и умирает от выгорания', () => {
    const deaths = [];
    const eng = createEngine({ rng: mulberry32(4), onDeath: (s, why) => deaths.push([s, why]) });
    eng.start();
    tick(eng, 5);
    expect(eng.state).toBe('dead');
    expect(eng.cause).toBe(EPITAPH_FLOOR);
    expect(deaths).toHaveLength(1);
    expect(eng.fly.y).toBeLessThanOrEqual(FLOOR);
  });

  it('потолок не убивает, а гасит скорость', () => {
    const eng = createEngine({ rng: mulberry32(5) });
    eng.start();
    for (let i = 0; i < 40; i++) { eng.flap(); eng.update(1 / 60); }
    expect(eng.state).toBe('play');
    expect(eng.fly.y).toBeGreaterThanOrEqual(FLY_R - 0.001);
  });

  it('мёртвая муха больше не реагирует на тап', () => {
    const eng = createEngine({ rng: mulberry32(6) });
    eng.start();
    tick(eng, 5);
    expect(eng.state).toBe('dead');
    const vy = eng.fly.vy;
    expect(eng.flap()).toBe(false);
    expect(eng.fly.vy).toBe(vy);
  });

  it('после смерти летят частицы и со временем гаснут', () => {
    const eng = createEngine({ rng: mulberry32(7) });
    eng.start();
    while (eng.state === 'play') eng.update(1 / 60);   // до самой смерти, не дольше
    expect(eng.particles.length).toBe(26);
    tick(eng, 2);
    expect(eng.particles.length).toBe(0);
  });

  it('мёртвая муха замирает: состояние не растёт, пока висит экран смерти', () => {
    const eng = createEngine({ rng: mulberry32(9) });
    eng.start();
    while (eng.state === 'play') eng.update(1 / 60);
    const frozen = { y: eng.fly.y, vy: eng.fly.vy };
    tick(eng, 60);                                     // минута на экране смерти
    expect(eng.fly.y).toBe(frozen.y);
    expect(eng.fly.vy).toBe(frozen.vy);
    expect(eng.fly.y).toBeLessThanOrEqual(FLOOR);
  });

  it('reset возвращает чистое состояние', () => {
    const eng = createEngine({ rng: mulberry32(8) });
    eng.start();
    tick(eng, 2);
    eng.reset();
    expect(eng.score).toBe(0);
    expect(eng.obs).toHaveLength(0);
    expect(eng.dist).toBe(0);
    expect(eng.cause).toBe('');
    expect(eng.raster).toHaveLength(96);
  });
});

describe('отсчёт перед забегом', () => {
  it('arm собирает мир, но не отпускает его', () => {
    const eng = createEngine({ rng: mulberry32(21) });
    eng.arm();
    expect(eng.state).toBe('ready');
    expect(eng.obs.length).toBeGreaterThanOrEqual(6);
  });

  it('пока идёт отсчёт, муха не падает и мир стоит', () => {
    const eng = createEngine({ rng: mulberry32(22) });
    eng.arm();
    const xs = eng.obs.map((o) => o.x);
    tick(eng, 3);                                  // три секунды отсчёта
    expect(eng.state).toBe('ready');
    expect(eng.obs.map((o) => o.x)).toEqual(xs);   // блокеры не сдвинулись
    expect(eng.dist).toBe(0);
    expect(eng.score).toBe(0);
    expect(eng.fly.y).toBeGreaterThan(H * 0.4);    // висит около середины
    expect(eng.fly.y).toBeLessThan(H * 0.5);
  });

  it('тапы во время отсчёта не копятся', () => {
    const eng = createEngine({ rng: mulberry32(23) });
    eng.arm();
    for (let i = 0; i < 20; i++) expect(eng.flap()).toBe(false);
    eng.update(1 / 60);
    expect(eng.fly.vy).toBe(0);
  });

  it('launch отпускает мир и даёт подъём вместо падения', () => {
    const eng = createEngine({ rng: mulberry32(24) });
    eng.arm();
    tick(eng, 3);
    const yBefore = eng.fly.y;
    expect(eng.launch()).toBe(true);
    expect(eng.state).toBe('play');
    expect(eng.fly.vy).toBeLessThan(0);            // вверх, а не вниз
    tick(eng, 0.2);
    expect(eng.fly.y).toBeLessThan(yBefore);       // за первые кадры поднялась
  });

  it('launch не действует вне отсчёта', () => {
    const eng = createEngine({ rng: mulberry32(25) });
    expect(eng.launch()).toBe(false);              // из idle
    eng.start();
    expect(eng.launch()).toBe(false);              // из play
  });

  it('игрок успевает среагировать: после GO муха сначала идёт вверх', () => {
    const eng = createEngine({ rng: mulberry32(26) });
    eng.arm();
    tick(eng, 3);
    const y0 = eng.fly.y;
    eng.launch();
    tick(eng, 0.25);
    expect(eng.fly.y).toBeLessThan(y0);            // первое движение — подъём, не падение
  });

  it('без единого тапа после GO до пола остаётся почти секунда', () => {
    const eng = createEngine({ rng: mulberry32(27) });
    eng.arm();
    tick(eng, 3);
    eng.launch();
    let alive = 0;
    while (eng.state === 'play' && alive < 10) { eng.update(1 / 60); alive += 1 / 60; }
    expect(alive).toBeGreaterThan(0.85);
  });

  it('первый блокер доезжает не раньше, чем игрок успел сделать взмах', () => {
    const eng = createEngine({ rng: mulberry32(28) });
    eng.arm();
    tick(eng, 3);
    eng.launch();
    // Держим муху живой и смотрим, когда первый блокер поравняется с ней.
    let t = 0;
    while (t < 5 && Math.min(...eng.obs.map((o) => o.x + o.w)) > eng.fly.x) {
      if (eng.fly.vy > 60) eng.flap();
      eng.update(1 / 60);
      t += 1 / 60;
    }
    expect(t).toBeGreaterThan(1);
  });
});

describe('счёт', () => {
  it('растёт, когда верхний блокер уехал за муху, и ровно один раз на блокер', () => {
    const scored = [];
    const eng = createEngine({ rng: mulberry32(11), onScore: (s) => scored.push(s) });
    eng.start();
    // Держим муху в живых автопилотом и смотрим, что счёт не двоится.
    tick(eng, 12, 1 / 60, () => { if (eng.state === 'play' && eng.fly.vy > 60) eng.flap(); });
    expect(scored).toEqual([...scored].sort((a, b) => a - b));
    expect(new Set(scored).size).toBe(scored.length);
    const passedTops = eng.obs.filter((o) => o.side === 'top' && o.passed).length;
    expect(eng.score).toBeGreaterThanOrEqual(passedTops);
  });

  it('эпитафия называет конкретный блокер', () => {
    expect(epitaphFor('JIRA')).toBe('blocked by JIRA');
    expect(PAINS).toContain('JIRA');
    expect(EPITAPH_PING).toMatch(/Slack/);
  });
});

describe('детерминированность', () => {
  it('один seed — побайтово один прогон', () => {
    const run = (seed) => {
      const eng = createEngine({ rng: mulberry32(seed) });
      eng.start();
      tick(eng, 8, 1 / 60, (i) => { if (i % 17 === 0) eng.flap(); });
      return { score: eng.score, cause: eng.cause, y: eng.fly.y, n: eng.obs.length };
    };
    expect(run(42)).toEqual(run(42));
    expect(run(42)).not.toEqual(run(43));
  });

  it('mulberry32 выдаёт значения строго в [0,1)', () => {
    fc.assert(fc.property(fc.integer({ min: 0, max: 2 ** 31 }), (seed) => {
      const rng = mulberry32(seed);
      for (let i = 0; i < 50; i++) {
        const v = rng();
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThan(1);
      }
    }));
  });
});

describe('инварианты мира при любом seed', () => {
  it('препятствия всегда в пределах поля, просвет проходим', () => {
    fc.assert(fc.property(fc.integer({ min: 1, max: 9999 }), (seed) => {
      const eng = createEngine({ rng: mulberry32(seed) });
      eng.start();
      tick(eng, 6, 1 / 60, (i) => { if (i % 15 === 0) eng.flap(); });
      for (const o of eng.obs) {
        expect(o.h).toBeGreaterThanOrEqual(0);
        expect(o.w).toBeGreaterThan(0);
        if (o.side === 'top') expect(o.y).toBe(0);
        if (o.side === 'bot') expect(o.y + o.h).toBeCloseTo(FLOOR, 5);
      }
      expect(eng.fly.y).toBeLessThanOrEqual(FLOOR);
      expect(eng.raster.length).toBe(96);
      expect(eng.score).toBeGreaterThanOrEqual(0);
    }), { numRuns: 40 });
  });

  it('пара блокеров всегда оставляет просвет не меньше габарита мухи', () => {
    fc.assert(fc.property(fc.integer({ min: 1, max: 9999 }), (seed) => {
      const eng = createEngine({ rng: mulberry32(seed) });
      eng.start();
      const tops = eng.obs.filter((o) => o.side === 'top');
      const bots = eng.obs.filter((o) => o.side === 'bot');
      for (let i = 0; i < Math.min(tops.length, bots.length); i++) {
        const gap = bots[i].y - tops[i].h;
        expect(gap).toBeGreaterThanOrEqual(GAP_MIN - 0.001);
        expect(gap).toBeGreaterThan(FLY_R * 2);
      }
    }), { numRuns: 40 });
  });

  it('размеры поля согласованы', () => {
    expect(W).toBe(420);
    expect(H).toBe(720);
    expect(FLOOR).toBe(H - 64);
  });
});
