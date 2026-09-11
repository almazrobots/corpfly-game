import crypto from 'node:crypto';

export const MAX_AUTH_AGE_SEC = 24 * 60 * 60; // сутки — рекомендация Telegram

/**
 * Секрет для проверки initData: HMAC-SHA256, где КЛЮЧ — литерал "WebAppData",
 * а ДАННЫЕ — токен бота. Перепутать местами — классическая ошибка.
 */
export function webAppSecret(botToken) {
  return crypto.createHmac('sha256', 'WebAppData').update(botToken).digest();
}

function dataCheckString(params, { dropSignature }) {
  const pairs = [];
  for (const [k, v] of params.entries()) {
    if (k === 'hash') continue;
    if (dropSignature && k === 'signature') continue;
    pairs.push(`${k}=${v}`);
  }
  return pairs.sort().join('\n');
}

const timingSafeEq = (a, b) => {
  const x = Buffer.from(a, 'utf8');
  const y = Buffer.from(b, 'utf8');
  return x.length === y.length && crypto.timingSafeEqual(x, y);
};

/**
 * Проверяет initData из Telegram Mini App.
 * @returns {{ok:true, user:object, authDate:number} | {ok:false, reason:string}}
 *
 * По документации Telegram при проверке ботовым токеном из data-check-string убирается ТОЛЬКО
 * `hash`; поле `signature` (Ed25519, для сторонней проверки) остаётся. Основной путь именно такой.
 * Вторым заходом считаем вариант без `signature` — страховка от клиентов, которые его не кладут
 * в подпись. Безопасность не страдает: обе строки всё равно подписаны HMAC на токене бота.
 */
export function verifyInitData(initData, botToken, { now = Date.now(), maxAgeSec = MAX_AUTH_AGE_SEC } = {}) {
  if (typeof initData !== 'string' || initData.length === 0) return { ok: false, reason: 'empty' };
  if (initData.length > 8192) return { ok: false, reason: 'too_large' };
  if (!botToken) return { ok: false, reason: 'no_bot_token' };

  let params;
  try {
    params = new URLSearchParams(initData);
  } catch {
    return { ok: false, reason: 'malformed' };
  }

  const hash = params.get('hash');
  if (!hash || !/^[0-9a-f]{64}$/i.test(hash)) return { ok: false, reason: 'no_hash' };

  // Значения приходят уже percent-декодированными, а data-check-string склеивается через
  // \n. Сырой перевод строки внутри значения делает ДВЕ разные раскладки полей байт-
  // идентичными строками — одна подпись начинает валидировать два разных разбора.
  // Дубликат ключа ломает второй инвариант: get() вернёт первое значение, а в подпись
  // уйдут оба. Запрещаем обе формы до всякой криптографии.
  const seen = new Set();
  for (const [k, v] of params.entries()) {
    if (k.includes('\n') || v.includes('\n')) return { ok: false, reason: 'malformed' };
    if (seen.has(k)) return { ok: false, reason: 'duplicate_field' };
    seen.add(k);
  }

  const secret = webAppSecret(botToken);
  const matched = [false, true].some((dropSignature) => {
    const expected = crypto.createHmac('sha256', secret)
      .update(dataCheckString(params, { dropSignature }))
      .digest('hex');
    return timingSafeEq(expected, hash.toLowerCase());
  });
  if (!matched) return { ok: false, reason: 'bad_hash' };

  const authDate = Number(params.get('auth_date'));
  if (!Number.isFinite(authDate) || authDate <= 0) return { ok: false, reason: 'no_auth_date' };
  const ageSec = Math.floor(now / 1000) - authDate;
  if (ageSec > maxAgeSec) return { ok: false, reason: 'expired' };
  if (ageSec < -300) return { ok: false, reason: 'future_auth_date' };

  let user;
  try {
    user = JSON.parse(params.get('user') ?? 'null');
  } catch {
    return { ok: false, reason: 'bad_user_json' };
  }
  if (!user || typeof user.id !== 'number' || !Number.isInteger(user.id) || user.id <= 0) {
    return { ok: false, reason: 'no_user' };
  }
  return { ok: true, user, authDate };
}

/** Тестовый помощник: собирает валидный initData под заданный токен. */
export function signInitData(fields, botToken) {
  const params = new URLSearchParams(fields);
  params.delete('hash');
  const hash = crypto.createHmac('sha256', webAppSecret(botToken))
    .update(dataCheckString(params, { dropSignature: false }))
    .digest('hex');
  params.set('hash', hash);
  return params.toString();
}
