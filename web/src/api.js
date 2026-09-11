import { initData } from './tg.js';

const BASE = '/api';

async function call(path, { method = 'GET', body, headers = {} } = {}) {
  const r = await fetch(BASE + path, {
    method,
    headers: { ...(body ? { 'content-type': 'application/json' } : {}), ...headers },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await r.json().catch(() => ({ ok: false, error: 'bad_json' }));
  if (!r.ok || !data.ok) throw Object.assign(new Error(data.error || `http_${r.status}`), { status: r.status });
  return data;
}

export const session = () => call('/session', { method: 'POST', body: { initData: initData() } });
export const submitScore = (score) => call('/score', { method: 'POST', body: { initData: initData(), score } });

// Рейтинг читается анонимно и БЕЗ initData. Внутри initData лежат имя, фамилия и
// username, а заголовки запросов попадают в access-логи целиком — отдавать туда
// удостоверение ради подсветки своей строки незачем: свой номер клиент уже знает.
export const leaderboard = (limit = 50) => call(`/leaderboard?limit=${limit}`);
