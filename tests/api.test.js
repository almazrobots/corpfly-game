import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { openDb } from '../server/src/db.js';
import { createApi, createLimiter } from '../server/src/api.js';
import { signInitData } from '../server/src/initdata.js';

const TOKEN = '8865521817:TEST_ONLY_NOT_A_REAL_TOKEN';

let db, server, base, clock;

const initDataFor = (id, first = 'Алмаз', last = 'Салимзянов') => signInitData({
  user: JSON.stringify({ id, first_name: first, last_name: last }),
  auth_date: String(Math.floor(Date.now() / 1000)),
}, TOKEN);

const call = async (path, opts = {}) => {
  const r = await fetch(base + path, {
    method: opts.method ?? 'GET',
    headers: { ...(opts.body ? { 'content-type': 'application/json' } : {}), ...(opts.headers ?? {}) },
    body: opts.body === undefined ? undefined : (typeof opts.body === 'string' ? opts.body : JSON.stringify(opts.body)),
  });
  return { status: r.status, body: await r.json().catch(() => null) };
};

// Управляемые часы: проверка правдоподобия счёта меряет время от предыдущей активности
// игрока, и ждать эти секунды по-настоящему в тестах незачем.
const advance = (ms) => { clock.t += ms; };

beforeEach(async () => {
  db = openDb(':memory:');
  clock = { t: Date.now() };
  server = createApi({
    db, botToken: TOKEN, revision: 'testsha',
    limiter: createLimiter({ limit: 1000 }),
    ipLimiter: createLimiter({ limit: 100_000 }),
    writeLimiter: createLimiter({ limit: 1000 }),
    now: () => clock.t,
  });
  await new Promise((res) => server.listen(0, '127.0.0.1', res));
  base = `http://127.0.0.1:${server.address().port}`;
});
afterEach(async () => {
  await new Promise((res) => server.close(res));
  db.close();
});

describe('GET /api/health', () => {
  it('отдаёт ревизию и счётчики — это то, что сверяет выкат', async () => {
    const { status, body } = await call('/api/health');
    expect(status).toBe(200);
    expect(body).toMatchObject({ ok: true, revision: 'testsha', players: 0, ranked: 0 });
  });

  it('видит новых игроков', async () => {
    await call('/api/session', { method: 'POST', body: { initData: initDataFor(1) } });
    expect((await call('/api/health')).body.players).toBe(1);
  });
});

describe('POST /api/session', () => {
  it('заводит игрока и возвращает его анонимный ярлык', async () => {
    const { status, body } = await call('/api/session', { method: 'POST', body: { initData: initDataFor(777) } });
    expect(status).toBe(200);
    expect(body.you).toMatchObject({ seq: 1, initials: 'AS', handle: '#1 AS', best: 0, rank: null });
  });

  it('в ответе нет ни tg_id, ни имени, ни username', async () => {
    const { body } = await call('/api/session', {
      method: 'POST',
      body: { initData: signInitData({
        user: JSON.stringify({ id: 777, first_name: 'Алмаз', last_name: 'Салимзянов', username: 'almazrobots' }),
        auth_date: String(Math.floor(Date.now() / 1000)),
      }, TOKEN) },
    });
    const dump = JSON.stringify(body);
    expect(dump).not.toContain('777');
    expect(dump).not.toContain('almazrobots');
    expect(dump).not.toContain('Салимзянов');
    expect(Object.keys(body.you).sort()).toEqual(['best', 'handle', 'initials', 'plays', 'rank', 'seq']);
  });

  it('без initData — 401', async () => {
    const { status, body } = await call('/api/session', { method: 'POST', body: {} });
    expect(status).toBe(401);
    expect(body).toEqual({ ok: false, error: 'empty' });
  });

  it('с подделанным initData — 401', async () => {
    const bad = initDataFor(5).replace(/hash=[0-9a-f]{64}/, `hash=${'b'.repeat(64)}`);
    const { status, body } = await call('/api/session', { method: 'POST', body: { initData: bad } });
    expect(status).toBe(401);
    expect(body.error).toBe('bad_hash');
  });
});

describe('POST /api/score', () => {
  const open = (id) => call('/api/session', { method: 'POST', body: { initData: initDataFor(id) } });

  it('принимает рекорд и считает место', async () => {
    await open(1);
    advance(60_000);
    const { status, body } = await call('/api/score', { method: 'POST', body: { initData: initDataFor(1), score: 12 } });
    expect(status).toBe(200);
    expect(body.improved).toBe(true);
    expect(body.you).toMatchObject({ best: 12, rank: 1 });
  });

  it('второй заход с меньшим счётом рекорд не портит', async () => {
    await open(1);
    advance(60_000);
    await call('/api/score', { method: 'POST', body: { initData: initDataFor(1), score: 12 } });
    advance(60_000);
    const { body } = await call('/api/score', { method: 'POST', body: { initData: initDataFor(1), score: 3 } });
    expect(body.improved).toBe(false);
    expect(body.you.best).toBe(12);
  });

  it('заводит игрока, даже если сессию не открывали', async () => {
    const { status, body } = await call('/api/score', { method: 'POST', body: { initData: initDataFor(42), score: 5 } });
    expect(status).toBe(200);
    expect(body.you.seq).toBe(1);
  });

  it('невозможный счёт отбивается', async () => {
    await open(1);
    // Именно НЕВОЗМОЖНЫЕ значения: не число, не целое, отрицательное, выше потолка.
    // Правдоподобие по времени — отдельная проверка со своим кодом ошибки.
    for (const score of [-1, 1.5, 999_999, '50', null, 15_001]) {
      const { status, body } = await call('/api/score', { method: 'POST', body: { initData: initDataFor(1), score } });
      expect(status).toBe(400);
      expect(body.error).toBe('bad_score');
    }
  });

  it('чужим initData свой счёт не сдать', async () => {
    await open(1);
    advance(60_000);
    const forged = initDataFor(1).replace('score', 'score');
    const tampered = forged.replace(/user=[^&]+/, encodeURIComponent(JSON.stringify({ id: 2, first_name: 'X' })));
    const { status } = await call('/api/score', { method: 'POST', body: { initData: tampered, score: 100 } });
    expect(status).toBe(401);
  });
});

describe('накрутка счёта', () => {
  const open = (id) => call('/api/session', { method: 'POST', body: { initData: initDataFor(id) } });

  it('рекорд, который физически не успеть набрать, отбивается', async () => {
    await open(1);
    advance(2_000);                       // две секунды на 5000 очков — невозможно
    const { status, body } = await call('/api/score', { method: 'POST', body: { initData: initDataFor(1), score: 5000 } });
    expect(status).toBe(400);
    expect(body.error).toBe('implausible_score');
  });

  it('тот же рекорд после правдоподобного времени принимается', async () => {
    await open(1);
    advance(5000 * 20 + 1_000);
    const { body } = await call('/api/score', { method: 'POST', body: { initData: initDataFor(1), score: 5000 } });
    expect(body.ok).toBe(true);
    expect(body.you.best).toBe(5000);
  });

  it('потолок правдоподобия ограничивает даже терпеливого', async () => {
    await open(1);
    advance(10 * 60 * 60 * 1000);
    const { status, body } = await call('/api/score', { method: 'POST', body: { initData: initDataFor(1), score: 15_001 } });
    expect(status).toBe(400);
    expect(body.error).toBe('bad_score');
  });

  it('частая сдача счёта закрывается отдельным лимитом записи', async () => {
    await new Promise((res) => server.close(res));
    server = createApi({
      db, botToken: TOKEN, limiter: createLimiter({ limit: 1000 }),
      ipLimiter: createLimiter({ limit: 100_000 }),
      writeLimiter: createLimiter({ limit: 2 }),
      now: () => clock.t,
    });
    await new Promise((res) => server.listen(0, '127.0.0.1', res));
    base = `http://127.0.0.1:${server.address().port}`;
    await open(9);
    advance(60_000);
    const codes = [];
    for (let i = 0; i < 4; i++) {
      codes.push((await call('/api/score', { method: 'POST', body: { initData: initDataFor(9), score: 1 } })).status);
    }
    expect(codes).toEqual([200, 200, 429, 429]);
  });
});

describe('GET /api/leaderboard', () => {
  beforeEach(async () => {
    for (const [id, name, score] of [[1, 'Алмаз', 10], [2, 'Мария', 30], [3, 'Иван', 20]]) {
      await call('/api/session', { method: 'POST', body: { initData: initDataFor(id, name, 'Тестов') } });
      advance(60_000);
      await call('/api/score', { method: 'POST', body: { initData: initDataFor(id, name, 'Тестов'), score } });
    }
  });

  it('публичный список — только номер, инициалы и рекорд', async () => {
    const { status, body } = await call('/api/leaderboard');
    expect(status).toBe(200);
    expect(body.board.map((e) => e.best)).toEqual([30, 20, 10]);
    expect(body.board[0].handle).toBe('#2 MT');
    for (const e of body.board) expect(Object.keys(e).sort()).toEqual(['best', 'handle', 'initials', 'rank', 'seq']);
    expect(JSON.stringify(body)).not.toContain('Тестов');
  });

  it('удостоверение игрока для чтения рейтинга не нужно и не принимается', async () => {
    // initData содержит имя, фамилию и username; заголовки запросов попадают
    // в access-логи целиком. Рейтинг анонимен — читать его надо анонимно.
    const { status, body } = await call('/api/leaderboard', { headers: { 'x-init-data': initDataFor(3, 'Иван', 'Тестов') } });
    expect(status).toBe(200);
    expect(body.you).toBeUndefined();
    expect(body.board).toHaveLength(3);
  });

  it('limit ограничен сверху', async () => {
    expect((await call('/api/leaderboard?limit=1')).body.board).toHaveLength(1);
    expect((await call('/api/leaderboard?limit=9999')).body.board).toHaveLength(3);
  });
});

describe('поведение под нагрузкой и на мусоре', () => {
  it('несуществующий маршрут — 404', async () => {
    expect((await call('/api/nope')).status).toBe(404);
  });

  it('битый JSON не роняет процесс', async () => {
    const { status, body } = await call('/api/score', { method: 'POST', body: '{ not json' });
    expect(status).toBe(400);
    expect(body.error).toBe('bad_json');
    expect((await call('/api/health')).status).toBe(200);
  });

  it('огромное тело отбивается до разбора', async () => {
    const { status, body } = await call('/api/score', { method: 'POST', body: JSON.stringify({ x: 'y'.repeat(20_000) }) });
    expect(status).toBe(413);
    expect(body.error).toBe('payload_too_large');
  });

  it('preflight отвечает без тела', async () => {
    const r = await fetch(base + '/api/session', { method: 'OPTIONS' });
    expect(r.status).toBe(204);
  });

  it('рейт-лимит закрывает перебор и не трогает остальных', async () => {
    await new Promise((res) => server.close(res));
    server = createApi({
      db, botToken: TOKEN, limiter: createLimiter({ limit: 3 }),
      ipLimiter: createLimiter({ limit: 100_000 }), now: () => clock.t,
    });
    await new Promise((res) => server.listen(0, '127.0.0.1', res));
    base = `http://127.0.0.1:${server.address().port}`;

    const codes = [];
    for (let i = 0; i < 5; i++) {
      codes.push((await call('/api/session', { method: 'POST', body: { initData: initDataFor(55) } })).status);
    }
    expect(codes).toEqual([200, 200, 200, 429, 429]);
    expect((await call('/api/session', { method: 'POST', body: { initData: initDataFor(66) } })).status).toBe(200);
  });

  it('анонимный флуд закрывается ДО проверки подписи', async () => {
    await new Promise((res) => server.close(res));
    server = createApi({ db, botToken: TOKEN, ipLimiter: createLimiter({ limit: 3 }), now: () => clock.t });
    await new Promise((res) => server.listen(0, '127.0.0.1', res));
    base = `http://127.0.0.1:${server.address().port}`;
    const codes = [];
    for (let i = 0; i < 5; i++) codes.push((await call('/api/leaderboard')).status);
    expect(codes).toEqual([200, 200, 200, 429, 429]);
  });

  it('параллельные забеги разных игроков не путают рекорды', async () => {
    const ids = Array.from({ length: 40 }, (_, i) => 1000 + i);
    await Promise.all(ids.map((id) =>
      call('/api/session', { method: 'POST', body: { initData: initDataFor(id) } })));
    advance(60 * 60 * 1000);
    await Promise.all(ids.map((id, i) =>
      call('/api/score', { method: 'POST', body: { initData: initDataFor(id), score: i } })));
    const { body } = await call('/api/leaderboard?limit=100');
    expect(body.board).toHaveLength(39);            // счёт 0 в рейтинг не попадает
    expect(body.board[0].best).toBe(39);
    expect(body.total).toBe(39);
    expect(new Set(body.board.map((e) => e.seq)).size).toBe(39);
  });
});
