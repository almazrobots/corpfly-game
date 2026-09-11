// Статика для локальной разработки и e2e: отдаёт web/ и проксирует /api/* на API.
// В проде эту роль играют nginx (статика) и Caddy (маршрутизация).
//
// Лежит в tools/, а НЕ в server/src/: образ api копирует server/src целиком, и пока
// файл лежал там, он ехал в прод вопреки этому же комментарию. Комментарий и
// реальность обязаны совпадать, иначе кто-нибудь однажды запустит его на бою.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../web');
const PORT = Number(process.env.PORT || 41731);
const API_ORIGIN = process.env.API_ORIGIN || 'http://127.0.0.1:8261';

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json',
};

http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname.startsWith('/api/')) {
    // Тело читаем в буфер сами. `new Response(req)` здесь не работает: IncomingMessage —
    // нодовский поток, а не web-ReadableStream, и fetch отправлял наверх пустое тело.
    // Итог был тихий: сессия не открывалась, игрок оставался «offline», ошибок никто не видел.
    let body;
    if (!['GET', 'HEAD'].includes(req.method)) {
      const chunks = [];
      for await (const c of req) chunks.push(c);
      body = Buffer.concat(chunks);
    }
    const upstream = await fetch(API_ORIGIN + url.pathname + url.search, {
      method: req.method,
      headers: {
        'content-type': req.headers['content-type'] ?? 'application/json',
        ...(req.headers['x-init-data'] ? { 'x-init-data': req.headers['x-init-data'] } : {}),
      },
      body,
    }).catch((e) => { console.error('proxy failed:', e.message); return null; });
    if (!upstream) { res.writeHead(502, { 'content-type': 'application/json' }).end('{"ok":false,"error":"upstream_down"}'); return; }
    res.writeHead(upstream.status, { 'content-type': 'application/json; charset=utf-8' });
    res.end(Buffer.from(await upstream.arrayBuffer()));
    return;
  }
  const rel = url.pathname === '/' ? '/index.html' : url.pathname;
  const file = path.join(ROOT, path.normalize(rel).replace(/^(\.\.[/\\])+/, ''));
  if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.writeHead(404).end('not found');
    return;
  }
  res.writeHead(200, { 'content-type': TYPES[path.extname(file)] ?? 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
}).listen(PORT, '127.0.0.1', () => console.log(`corpfly static :${PORT} → api ${API_ORIGIN}`));
