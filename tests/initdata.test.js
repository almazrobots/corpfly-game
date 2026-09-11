import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import crypto from 'node:crypto';
import { verifyInitData, signInitData, webAppSecret, MAX_AUTH_AGE_SEC } from '../server/src/initdata.js';

const TOKEN = '8865521817:TEST_ONLY_NOT_A_REAL_TOKEN';
const OTHER = '1111111111:ANOTHER_TEST_TOKEN';
const NOW = 1_780_000_000_000;              // фиксированное «сейчас», секунды ниже
const nowSec = Math.floor(NOW / 1000);

const user = { id: 4242, first_name: 'Алмаз', last_name: 'Салимзянов', language_code: 'ru' };
const fresh = (over = {}) => signInitData({
  query_id: 'AAH1', user: JSON.stringify(user), auth_date: String(nowSec), ...over,
}, TOKEN);

describe('секрет', () => {
  it('ключ HMAC — литерал WebAppData, данные — токен (не наоборот)', () => {
    const right = webAppSecret(TOKEN);
    const swapped = crypto.createHmac('sha256', TOKEN).update('WebAppData').digest();
    expect(right.equals(swapped)).toBe(false);
    expect(right).toHaveLength(32);
  });
});

describe('валидный initData', () => {
  it('принимается и отдаёт пользователя', () => {
    const r = verifyInitData(fresh(), TOKEN, { now: NOW });
    expect(r.ok).toBe(true);
    expect(r.user.id).toBe(4242);
    expect(r.user.first_name).toBe('Алмаз');
    expect(r.authDate).toBe(nowSec);
  });

  it('поле signature входит в подпись и не мешает проверке', () => {
    const withSig = fresh({ signature: 'abcDEF123_-' });
    expect(verifyInitData(withSig, TOKEN, { now: NOW }).ok).toBe(true);
  });

  it('порядок полей в строке не важен — data-check-string сортируется', () => {
    const p = new URLSearchParams(fresh());
    const hash = p.get('hash');
    p.delete('hash');
    const reversed = new URLSearchParams([...p.entries()].reverse());
    reversed.set('hash', hash);
    expect(verifyInitData(reversed.toString(), TOKEN, { now: NOW }).ok).toBe(true);
  });
});

describe('подделка отбивается', () => {
  const cases = [
    ['пустая строка', '', 'empty'],
    ['не строка', null, 'empty'],
    ['нет хеша', 'user=%7B%7D&auth_date=1', 'no_hash'],
    ['хеш не hex', 'auth_date=1&hash=zzz', 'no_hash'],
  ];
  for (const [name, input, reason] of cases) {
    it(name, () => {
      const r = verifyInitData(input, TOKEN, { now: NOW });
      expect(r).toEqual({ ok: false, reason });
    });
  }

  it('чужой токен не подходит', () => {
    expect(verifyInitData(fresh(), OTHER, { now: NOW })).toEqual({ ok: false, reason: 'bad_hash' });
  });

  it('без токена проверять нечем', () => {
    expect(verifyInitData(fresh(), '', { now: NOW })).toEqual({ ok: false, reason: 'no_bot_token' });
  });

  it('подмена id пользователя ломает хеш — чужой рекорд не сдать', () => {
    const raw = fresh();
    const tampered = raw.replace('4242', '9999');
    expect(tampered).not.toBe(raw);
    expect(verifyInitData(tampered, TOKEN, { now: NOW }).ok).toBe(false);
  });

  it('подмена любого поля ломает хеш', () => {
    fc.assert(fc.property(fc.integer({ min: 1, max: 999_999 }), (id) => {
      const data = signInitData({
        user: JSON.stringify({ ...user, id }), auth_date: String(nowSec),
      }, TOKEN);
      const broken = data.replace(/auth_date=\d+/, `auth_date=${nowSec - 1}`);
      expect(verifyInitData(broken, TOKEN, { now: NOW }).ok).toBe(false);
    }), { numRuns: 30 });
  });

  it('чужой хеш той же длины не проходит', () => {
    const data = fresh().replace(/hash=[0-9a-f]{64}/, `hash=${'a'.repeat(64)}`);
    expect(verifyInitData(data, TOKEN, { now: NOW })).toEqual({ ok: false, reason: 'bad_hash' });
  });

  it('перевод строки в значении не даёт собрать эквивалентную data-check-string', () => {
    // Значения приходят percent-декодированными, а строка проверки склеивается через \n.
    // Сырой \n внутри значения позволял бы одной подписи валидировать два разных разбора.
    const legit = signInitData({ auth_date: String(nowSec), signature: 'SIG', user: JSON.stringify(user) }, TOKEN);
    const hash = new URLSearchParams(legit).get('hash');
    const shifted = `auth_date=${nowSec}%0Asignature%3DSIG&user=${encodeURIComponent(JSON.stringify(user))}&hash=${hash}`;
    const r = verifyInitData(shifted, TOKEN, { now: NOW });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('malformed');
  });

  it('дубликат ключа отвергается: get() и подпись видели бы разное', () => {
    const legit = fresh();
    const dup = `${legit}&user=${encodeURIComponent(JSON.stringify({ ...user, id: 1 }))}`;
    expect(verifyInitData(dup, TOKEN, { now: NOW })).toEqual({ ok: false, reason: 'duplicate_field' });
  });

  it('гигантская строка отбивается до всякой криптографии', () => {
    expect(verifyInitData('x'.repeat(9000), TOKEN, { now: NOW })).toEqual({ ok: false, reason: 'too_large' });
  });
});

describe('свежесть', () => {
  it('вчерашний initData ещё жив, позавчерашний — нет', () => {
    const day = signInitData({ user: JSON.stringify(user), auth_date: String(nowSec - MAX_AUTH_AGE_SEC + 60) }, TOKEN);
    expect(verifyInitData(day, TOKEN, { now: NOW }).ok).toBe(true);

    const stale = signInitData({ user: JSON.stringify(user), auth_date: String(nowSec - MAX_AUTH_AGE_SEC - 60) }, TOKEN);
    expect(verifyInitData(stale, TOKEN, { now: NOW })).toEqual({ ok: false, reason: 'expired' });
  });

  it('дата из будущего отвергается (часы клиента не аргумент)', () => {
    const future = signInitData({ user: JSON.stringify(user), auth_date: String(nowSec + 3600) }, TOKEN);
    expect(verifyInitData(future, TOKEN, { now: NOW })).toEqual({ ok: false, reason: 'future_auth_date' });
  });

  it('небольшой перекос часов прощается', () => {
    const skew = signInitData({ user: JSON.stringify(user), auth_date: String(nowSec + 120) }, TOKEN);
    expect(verifyInitData(skew, TOKEN, { now: NOW }).ok).toBe(true);
  });

  it('без auth_date не принимается', () => {
    const noDate = signInitData({ user: JSON.stringify(user) }, TOKEN);
    expect(verifyInitData(noDate, TOKEN, { now: NOW })).toEqual({ ok: false, reason: 'no_auth_date' });
  });
});

describe('пользователь', () => {
  it('битый JSON в user', () => {
    const bad = signInitData({ user: '{not json', auth_date: String(nowSec) }, TOKEN);
    expect(verifyInitData(bad, TOKEN, { now: NOW })).toEqual({ ok: false, reason: 'bad_user_json' });
  });

  it('без user — это не игрок', () => {
    const none = signInitData({ auth_date: String(nowSec), query_id: 'x' }, TOKEN);
    expect(verifyInitData(none, TOKEN, { now: NOW })).toEqual({ ok: false, reason: 'no_user' });
  });

  it('нечисловой или отрицательный id отвергается', () => {
    for (const id of ['77', -1, 0, 1.5, null]) {
      const d = signInitData({ user: JSON.stringify({ ...user, id }), auth_date: String(nowSec) }, TOKEN);
      expect(verifyInitData(d, TOKEN, { now: NOW }).ok).toBe(false);
    }
  });
});
