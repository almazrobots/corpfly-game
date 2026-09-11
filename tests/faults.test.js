import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { openDb } from '../server/src/db.js';
import { createApi, createLimiter } from '../server/src/api.js';
import { signInitData } from '../server/src/initdata.js';

// L4 · Аномалии и внедрение отказов.
//
// Самый хрупкий слой — хранилище. Инвариант: при отказе базы данные не теряются
// и не портятся, ответ громкий (5xx), наружу не утекает внутренняя формулировка
// ошибки, а следующий запрос обслуживается как ни в чём не бывало.

const TOKEN = '8865521817:TEST_ONLY_NOT_A_REAL_TOKEN';
const idFor = (n) => signInitData({
  user: JSON.stringify({ id: n, first_name: 'Ada', last_name: 'Lovelace' }),
  auth_date: String(Math.floor(Date.now() / 1000)),
}, TOKEN);

let server, base, db, clock;
const listen = async (overrides = {}) => {
  server = createApi({
    db, botToken: TOKEN,
    limiter: createLimiter({ limit: 10_000 }),
    ipLimiter: createLimiter({ limit: 100_000 }),
    writeLimiter: createLimiter({ limit: 10_000 }),
    now: () => clock.t,
    ...overrides,
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
};
const call = async (path, body) => {
  const r = await fetch(base + path, {
    method: body ? 'POST' : 'GET',
    headers: body ? { 'content-type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: r.status, body: await r.json().catch(() => null) };
};

beforeEach(() => { db = openDb(':memory:'); clock = { t: Date.now() }; });
afterEach(async () => {
  if (server) await new Promise((r) => server.close(r));
  server = null;
  db.close();
});

describe('база отказывает', () => {
  it('падение на записи игрока — громкий 500, без утечки внутренностей', async () => {
    const broken = { ...db, upsertPlayer() { throw new Error('SQLITE_IOERR: disk I/O error /app/data/corpfly.sqlite'); } };
    await listen({ db: broken });
    const { status, body } = await call('/api/session', { initData: idFor(1) });
    expect(status).toBe(500);
    expect(body).toEqual({ ok: false, error: 'internal' });
    // Ни пути к базе, ни кода драйвера наружу.
    const dump = JSON.stringify(body);
    expect(dump).not.toMatch(/SQLITE|disk|\/app\/data/);
  });

  it('падение на чтении рейтинга — 500, а не пустой список', async () => {
    // Молча отдать [] здесь опаснее всего: игроки решат, что рекордов нет.
    const broken = { ...db, top() { throw new Error('SQLITE_CORRUPT'); } };
    await listen({ db: broken });
    const { status, body } = await call('/api/leaderboard');
    expect(status).toBe(500);
    expect(body.ok).toBe(false);
    expect(body.board).toBeUndefined();
  });

  it('после отказа сервис продолжает обслуживать следующие запросы', async () => {
    let fail = true;
    const flaky = {
      ...db,
      upsertPlayer(...a) {
        if (fail) { fail = false; throw new Error('transient'); }
        return db.upsertPlayer(...a);
      },
    };
    await listen({ db: flaky });
    expect((await call('/api/session', { initData: idFor(7) })).status).toBe(500);
    expect((await call('/api/health')).status).toBe(200);
    const ok = await call('/api/session', { initData: idFor(7) });
    expect(ok.status).toBe(200);
    expect(ok.body.you.seq).toBe(1);
  });

  it('счётчики падают — health честно краснеет, а не врёт нулями', async () => {
    const broken = { ...db, counts() { throw new Error('no db'); } };
    await listen({ db: broken });
    const { status } = await call('/api/health');
    expect(status).toBe(500);
  });
});

describe('состязание за рекорд', () => {
  it('пятьдесят одновременных сдач оставляют ровно максимум', async () => {
    await listen();
    await call('/api/session', { initData: idFor(500) });
    clock.t += 60 * 60 * 1000;
    const scores = Array.from({ length: 50 }, (_, i) => (i * 7) % 60);
    await Promise.all(scores.map((s) => call('/api/score', { initData: idFor(500), score: s })));
    const { body } = await call('/api/leaderboard');
    expect(body.board[0].best).toBe(Math.max(...scores));
  });

  it('параллельная запись разных игроков не теряет ни одного', async () => {
    await listen();
    const ids = Array.from({ length: 60 }, (_, i) => 2000 + i);
    await Promise.all(ids.map((id) => call('/api/session', { initData: idFor(id) })));
    expect((await call('/api/health')).body.players).toBe(60);
    // Номера непрерывны: ни дыр, ни дублей, сколько бы ни пришло сразу.
    clock.t += 60 * 60 * 1000;
    await Promise.all(ids.map((id, i) => call('/api/score', { initData: idFor(id), score: i + 1 })));
    const { body } = await call('/api/leaderboard?limit=100');
    const seqs = body.board.map((e) => e.seq).sort((a, b) => a - b);
    expect(seqs).toEqual(Array.from({ length: 60 }, (_, i) => i + 1));
  });
});
