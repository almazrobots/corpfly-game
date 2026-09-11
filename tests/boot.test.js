import { describe, it, expect } from 'vitest';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

// L7 · Внутренняя дисциплина.
//
// Проверка окружения на старте. Без BOT_TOKEN подпись initData проверить нечем, и
// «мягкая деградация» здесь означала бы мини-апп, открытый кому угодно. Процесс
// обязан отказаться стартовать ГРОМКО, а не подняться и тихо пускать всех.

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function run(env, { timeoutMs = 8000 } = {}) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, ['server/src/server.js'], {
      cwd: ROOT,
      env: { PATH: process.env.PATH, CORPFLY_DB: ':memory:', PORT: '0', ...env },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let out = '';
    let err = '';
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { err += d; });
    const timer = setTimeout(() => { child.kill('SIGKILL'); resolve({ code: null, out, err, alive: true }); }, timeoutMs);
    child.on('exit', (code) => { clearTimeout(timer); resolve({ code, out, err, alive: false }); });
  });
}

describe('валидация окружения на старте', () => {
  it('без BOT_TOKEN процесс не поднимается и говорит почему', async () => {
    const r = await run({});
    expect(r.alive).toBe(false);
    expect(r.code).not.toBe(0);
    expect(r.err).toMatch(/BOT_TOKEN/);
  }, 15_000);

  it('пустой BOT_TOKEN — то же самое, а не «почти валидный» старт', async () => {
    const r = await run({ BOT_TOKEN: '' });
    expect(r.alive).toBe(false);
    expect(r.code).not.toBe(0);
  }, 15_000);

  it('с токеном процесс живёт и объявляет ревизию', async () => {
    const r = await run({ BOT_TOKEN: 'boot:test', GIT_SHA: 'bootsha' }, { timeoutMs: 3000 });
    expect(r.alive).toBe(true);              // не умер сам — значит слушает
    expect(r.out).toMatch(/corpfly-api/);
    expect(r.out).toMatch(/bootsha/);
  }, 15_000);

  it('в лог старта не попадает сам токен', async () => {
    const r = await run({ BOT_TOKEN: 'secret-token-value:AAA' }, { timeoutMs: 2500 });
    expect(`${r.out}${r.err}`).not.toContain('secret-token-value');
  }, 15_000);
});
