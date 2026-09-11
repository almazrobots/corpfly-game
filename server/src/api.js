import http from 'node:http';
import { verifyInitData } from './initdata.js';
import { initialsFrom, publicHandle, sanitizeScore, MIN_MS_PER_POINT } from './identity.js';

const TOP_LIMIT = 100;
// Часы клиента и сервера расходятся; не наказываем за секунды.
const CLOCK_SLACK_MS = 5_000;

/**
 * Элементарный рейт-лимит в памяти: N запросов в окно на ключ.
 *
 * `maxKeys` обязателен, когда ключ подконтролен вызывающему (IP): с IPv6 адресов
 * бесконечно много, и защита от перегрузки сама стала бы утечкой памяти.
 */
export function createLimiter({ limit = 30, windowMs = 60_000, maxKeys = 20_000 } = {}) {
  const buckets = new Map();
  return {
    allow(key, now = Date.now()) {
      const b = buckets.get(key);
      if (!b || now - b.start > windowMs) {
        if (buckets.size >= maxKeys) buckets.clear();
        buckets.set(key, { start: now, n: 1 });
        return true;
      }
      b.n += 1;
      return b.n <= limit;
    },
    sweep(now = Date.now()) {
      for (const [k, b] of buckets) if (b.start < now - windowMs * 2) buckets.delete(k);
    },
    get size() { return buckets.size; },
  };
}

/**
 * Ключ анонимного лимита. X-Real-IP проставляет host-Caddy через header_up, то есть
 * клиентское значение перезаписывается и подделать его снаружи нельзя. IPv6 режем
 * до /64: иначе у одного клиента бесконечный запас «разных» адресов.
 */
export function clientKey(req) {
  const ip = String(req.headers['x-real-ip'] || req.socket?.remoteAddress || 'unknown');
  return ip.includes(':') ? ip.split(':').slice(0, 4).join(':') : ip;
}

/**
 * Собирает HTTP-обработчик API. Всё внешнее приходит аргументами, поэтому тест
 * поднимает настоящий сервер на памяти, без переменных окружения и без сети.
 */
export function createApi({
  db,
  botToken,
  revision = 'dev',
  allowOrigin = '',
  limiter = createLimiter(),
  // Лимит ДО проверки подписи: разбор initData стоит двух HMAC, а запросы в SQLite —
  // синхронные. Платить за анонимный флуд не должен сервер.
  ipLimiter = createLimiter({ limit: 120, windowMs: 60_000 }),
  // Сдача рекорда — не чтение: забег длится секунды, десяти попыток в минуту хватает с запасом.
  writeLimiter = createLimiter({ limit: 10, windowMs: 60_000 }),
  // Часы инжектируются, чтобы проверку правдоподобия можно было проверить тестом,
  // а не ожиданием реальных секунд.
  now = Date.now,
} = {}) {
  const json = (res, code, body) => {
    const payload = JSON.stringify(body);
    res.writeHead(code, {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'content-length': Buffer.byteLength(payload),
      ...(allowOrigin ? { 'access-control-allow-origin': allowOrigin } : {}),
    });
    res.end(payload);
  };

  async function readJson(req, limit = 16_384) {
    const chunks = [];
    let size = 0;
    for await (const c of req) {
      size += c.length;
      if (size > limit) throw new Error('payload_too_large');
      chunks.push(c);
    }
    if (!chunks.length) return {};
    const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    // `null` и массивы — валидный JSON, но не объект: без этой проверки обращение
    // к body.initData бросало TypeError, то есть 500 и строка в лог на каждый запрос.
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new SyntaxError('not_an_object');
    return parsed;
  }

  /** Проверить initData и получить (или завести) игрока. */
  function authenticate(initData) {
    const v = verifyInitData(initData, botToken);
    if (!v.ok) return { error: v.reason };
    if (!limiter.allow(`u:${v.user.id}`)) return { error: 'rate_limited' };
    return { player: db.upsertPlayer(v.user.id, initialsFrom(v.user)) };
  }

  /** Публичная проекция игрока: allowlist, а не удаление полей. tg_id не покидает процесс. */
  const playerView = (p) => ({
    seq: p.seq,
    initials: p.initials,
    handle: publicHandle(p.seq, p.initials),
    best: p.best,
    plays: p.plays,
    rank: p.best > 0 ? db.rankOf(p.tg_id) : null,
  });

  const boardView = (limit) => db.top(limit).map((row, i) => ({
    rank: i + 1,
    seq: row.seq,
    initials: row.initials,
    handle: publicHandle(row.seq, row.initials),
    best: row.best,
  }));

  // Прототипа нет намеренно: ключ маршрута склеен из данных запроса.
  const routes = Object.assign(Object.create(null), {
    'GET /api/health': (_req, res) => {
      const c = db.counts();
      json(res, 200, { ok: true, revision, players: c.players, ranked: c.ranked, ts: now() });
    },

    'POST /api/session': async (req, res) => {
      const body = await readJson(req);
      const { error, player } = authenticate(body.initData);
      if (error) return json(res, error === 'rate_limited' ? 429 : 401, { ok: false, error });
      json(res, 200, { ok: true, you: playerView(player), total: db.counts().ranked });
    },

    'POST /api/score': async (req, res) => {
      const body = await readJson(req);
      const { error, player } = authenticate(body.initData);
      if (error) return json(res, error === 'rate_limited' ? 429 : 401, { ok: false, error });
      if (!writeLimiter.allow(`w:${player.tg_id}`)) return json(res, 429, { ok: false, error: 'rate_limited' });

      const score = sanitizeScore(body.score);
      if (score === null) return json(res, 400, { ok: false, error: 'bad_score' });

      // Забег физически не может идти быстрее 0.8 с на очко. Меряем от предыдущей
      // активности игрока: чтобы сдать N очков, надо было провести за игрой хотя бы
      // N * 0.8 с. Серверную симуляцию это не заменяет, но превращает накрутку
      // из одной curl-команды в «сиди и жди» — а рекорд всё равно растёт только вверх.
      const elapsed = now() - (player.updated_at ?? 0);
      if (score * MIN_MS_PER_POINT > elapsed + CLOCK_SLACK_MS) {
        return json(res, 400, { ok: false, error: 'implausible_score' });
      }

      const updated = db.submitScore(player.tg_id, score);
      json(res, 200, { ok: true, improved: updated.improved, you: playerView(updated), total: db.counts().ranked });
    },

    // Рейтинг анонимен по устройству, поэтому и читается анонимно: никакого initData.
    // Раньше он ездил сюда заголовком x-init-data — а внутри него имя, фамилия и
    // username игрока, и в access-log заголовки попадают целиком. Свою строку клиент
    // подсвечивает сам: собственный seq он уже знает из /api/session.
    'GET /api/leaderboard': async (_req, res, url) => {
      const limit = Math.min(TOP_LIMIT, Math.max(1, Number(url.searchParams.get('limit')) || 50));
      json(res, 200, { ok: true, board: boardView(limit), total: db.counts().ranked });
    },
  });

  return http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    if (req.method === 'OPTIONS') {
      res.writeHead(204, {
        // Пусто — значит одинаковый origin и CORS не нужен. Отвечать '*' в preflight,
        // когда реальные ответы идут без ACAO, — заявить политику, которой нет.
        ...(allowOrigin ? { 'access-control-allow-origin': allowOrigin } : {}),
        'access-control-allow-headers': 'content-type',
        'access-control-allow-methods': 'GET, POST, OPTIONS',
        'access-control-max-age': '600',
      });
      return res.end();
    }

    if (!ipLimiter.allow(clientKey(req), now())) return json(res, 429, { ok: false, error: 'rate_limited' });

    const handler = routes[`${req.method} ${url.pathname}`];
    if (!handler) return json(res, 404, { ok: false, error: 'not_found' });
    try {
      await handler(req, res, url);
    } catch (err) {
      const tooBig = err?.message === 'payload_too_large';
      const badJson = err instanceof SyntaxError;
      if (!tooBig && !badJson) console.error('request failed', url.pathname, err?.message);
      const code = tooBig ? 413 : badJson ? 400 : 500;
      json(res, code, { ok: false, error: tooBig ? 'payload_too_large' : badJson ? 'bad_json' : 'internal' });
    }
  });
}
