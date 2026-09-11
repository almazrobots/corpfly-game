import { describe, it, expect } from 'vitest';
import crypto from 'node:crypto';
import { verifyInitData, signInitData, webAppSecret } from '../server/src/initdata.js';

// L2 · Независимый оракул.
//
// Остальные тесты подписи пользуются тем же signInitData, что и продовый код, — то есть
// доказывают согласованность реализации с самой собой. Здесь ожидаемое значение считается
// ДРУГИМ путём: WebCrypto (crypto.subtle) вместо crypto.createHmac. Если алгоритм однажды
// поедет — например, местами поменяют ключ и данные, — сходиться перестанет.

const TOKEN = '123456:GOLDEN_VECTOR_TOKEN';
const FIELDS = {
  auth_date: '1780000000',
  query_id: 'AAH1',
  user: JSON.stringify({ id: 4242, first_name: 'Ada', last_name: 'Lovelace' }),
};

/** Ровно та же математика, но на другом API и без единой строки из продового модуля. */
async function hashViaWebCrypto(fields, token) {
  const enc = new TextEncoder();
  const hmac = async (keyBytes, msg) => {
    const key = await crypto.subtle.importKey('raw', keyBytes, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    return new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(msg)));
  };
  const secret = await hmac(enc.encode('WebAppData'), token);
  const dcs = Object.keys(fields).sort().map((k) => `${k}=${fields[k]}`).join('\n');
  const sig = await hmac(secret, dcs);
  return [...sig].map((b) => b.toString(16).padStart(2, '0')).join('');
}

describe('L2 · независимая перепроверка подписи', () => {
  it('WebCrypto приходит к тому же хешу, что и продовый node:crypto', async () => {
    const independent = await hashViaWebCrypto(FIELDS, TOKEN);
    const produced = new URLSearchParams(signInitData(FIELDS, TOKEN)).get('hash');
    expect(produced).toBe(independent);
  });

  it('замороженный золотой вектор: алгоритм не должен меняться незаметно', () => {
    // Значение посчитано один раз и прибито гвоздём. Любая правка схемы подписи
    // обязана сломать этот тест и потребовать осознанного решения.
    expect(new URLSearchParams(signInitData(FIELDS, TOKEN)).get('hash'))
      .toBe('a75b352969d112eb45d1c1e99134daeae5e327066361e10ace05540da2266829');
  });

  it('секрет выводится именно как HMAC(ключ="WebAppData", данные=токен)', async () => {
    const enc = new TextEncoder();
    const key = await crypto.subtle.importKey('raw', enc.encode('WebAppData'), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    const independent = Buffer.from(await crypto.subtle.sign('HMAC', key, enc.encode(TOKEN)));
    expect(webAppSecret(TOKEN).equals(independent)).toBe(true);
  });

  it('подпись, собранная независимым путём, принимается продовой проверкой', async () => {
    const hash = await hashViaWebCrypto(FIELDS, TOKEN);
    const p = new URLSearchParams(FIELDS);
    p.set('hash', hash);
    const r = verifyInitData(p.toString(), TOKEN, { now: 1_780_000_000_000, maxAgeSec: 10 ** 9 });
    expect(r.ok).toBe(true);
    expect(r.user.id).toBe(4242);
  });
});

describe('L3 · границы окна свежести', () => {
  const NOW_SEC = 1_780_000_000;
  const NOW = NOW_SEC * 1000;
  const at = (authDate) => signInitData({ ...FIELDS, auth_date: String(authDate) }, TOKEN);
  const check = (authDate, maxAgeSec = 3600) =>
    verifyInitData(at(authDate), TOKEN, { now: NOW, maxAgeSec });

  const cases = [
    ['ровно на границе окна — принимается', NOW_SEC - 3600, true],
    ['на секунду старше границы — отвергается', NOW_SEC - 3601, false],
    ['на секунду свежее границы — принимается', NOW_SEC - 3599, true],
    ['ровно сейчас — принимается', NOW_SEC, true],
    ['ровно на границе допуска часов вперёд', NOW_SEC + 300, true],
    ['на секунду дальше допуска часов — отвергается', NOW_SEC + 301, false],
    ['ноль — не дата', 0, false],
    ['отрицательная дата', -1, false],
  ];
  for (const [name, authDate, ok] of cases) {
    it(name, () => { expect(check(authDate).ok).toBe(ok); });
  }
});
