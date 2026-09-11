import { openDb } from './db.js';
import { createApi, createLimiter } from './api.js';

const PORT = Number(process.env.PORT || 8261);
const HOST = process.env.HOST || '0.0.0.0';
const BOT_TOKEN = process.env.BOT_TOKEN || '';

if (!BOT_TOKEN) {
  console.error('BOT_TOKEN не задан — без него initData проверить нечем. Выходим.');
  process.exit(1);
}

const db = openDb();
const limiter = createLimiter();
const ipLimiter = createLimiter({ limit: 120, windowMs: 60_000 });
const writeLimiter = createLimiter({ limit: 10, windowMs: 60_000 });
setInterval(() => { limiter.sweep(); ipLimiter.sweep(); writeLimiter.sweep(); }, 60_000).unref();

const server = createApi({
  db,
  botToken: BOT_TOKEN,
  revision: process.env.GIT_SHA || 'dev',
  allowOrigin: process.env.ALLOW_ORIGIN || '',
  limiter,
  ipLimiter,
  writeLimiter,
});

// Дефолты Node — 300 с на запрос: это 300 секунд удержания сокета ценой в тридцать байт.
server.headersTimeout = 10_000;
server.requestTimeout = 15_000;
server.keepAliveTimeout = 5_000;
server.maxConnections = 512;

server.listen(PORT, HOST, () => console.log(`corpfly-api :${PORT} rev=${process.env.GIT_SHA || 'dev'}`));
for (const sig of ['SIGTERM', 'SIGINT']) {
  process.on(sig, () => server.close(() => { db.close(); process.exit(0); }));
}
