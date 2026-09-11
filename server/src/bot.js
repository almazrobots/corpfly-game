// Бот на длинных опросах: без вебхука, без входящего порта, без секрета в Caddy.
// Его работа — привести человека в мини-приложение и показать рейтинг. Данные он
// не трогает: за ними ходит в тот же HTTP API, что и сама игра (один писатель в БД).
const TOKEN = process.env.BOT_TOKEN || '';
const APP_URL = process.env.APP_URL || '';
const API_ORIGIN = process.env.API_ORIGIN || 'http://api:8261';
const API = `https://api.telegram.org/bot${TOKEN}`;

if (!TOKEN || !APP_URL) {
  console.error('нужны BOT_TOKEN и APP_URL');
  process.exit(1);
}

async function tg(method, payload) {
  const r = await fetch(`${API}/${method}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload ?? {}),
  });
  const data = await r.json().catch(() => ({ ok: false, description: 'bad json' }));
  if (!data.ok) console.error(`tg ${method} → ${data.description}`);
  return data;
}

const START_TEXT = [
  'CORPFLY — 166,700 neurons vs. the enterprise.',
  '',
  'You are the connectome of a male fruit fly, loaded into an enterprise.',
  'Your task: carry the agent past the blockers. The floor is burnout.',
  '',
  'Hit the button to fly. /top for the ranking.',
].join('\n');

const playButton = { text: '🪰 Play', web_app: { url: APP_URL } };

/** Первичная настройка профиля бота — идемпотентна, гоняется на каждом старте. */
async function configure() {
  await tg('setChatMenuButton', { menu_button: { type: 'web_app', text: 'Play', web_app: { url: APP_URL } } });
  await tg('setMyDescription', { description: `${START_TEXT.split('\n\n')[0]}\nTap to flap. Do not touch the buzzwords. The floor is burnout.` });
  await tg('setMyShortDescription', { short_description: '166,700 neurons vs. the enterprise. Tap to fly.' });
  await tg('setMyCommands', {
    commands: [
      { command: 'start', description: 'Launch the game' },
      { command: 'top', description: 'Player ranking' },
    ],
  });
}

async function leaderboardText() {
  const r = await fetch(`${API_ORIGIN}/api/leaderboard?limit=20`).then((x) => x.json()).catch(() => null);
  if (!r?.ok) return 'Ranking is temporarily unavailable.';
  if (!r.board.length) return 'Ranking is empty — no records yet. Be the first.';
  const rows = r.board.map((e) => `${String(e.rank).padStart(2, ' ')}. ${e.handle} — ${e.best}`);
  return ['CORPFLY ranking', '', ...rows, '', `Players with a record: ${r.total}`].join('\n');
}

async function handle(update) {
  const msg = update.message;
  const text = msg?.text ?? '';
  if (!msg?.chat?.id || !text.startsWith('/')) return;
  const cmd = text.split(/[\s@]/)[0];

  if (cmd === '/start') {
    await tg('sendMessage', {
      chat_id: msg.chat.id,
      text: START_TEXT,
      reply_markup: { inline_keyboard: [[playButton]] },
    });
  } else if (cmd === '/top') {
    await tg('sendMessage', {
      chat_id: msg.chat.id,
      text: await leaderboardText(),
      reply_markup: { inline_keyboard: [[playButton]] },
    });
  }
}

async function main() {
  await configure();
  console.log(`corpfly-bot: polling, app=${APP_URL}`);
  let offset = 0;
  let backoff = 1000;
  for (;;) {
    try {
      const r = await fetch(`${API}/getUpdates?timeout=50&offset=${offset}&allowed_updates=["message"]`, {
        signal: AbortSignal.timeout(60_000),
      }).then((x) => x.json());
      backoff = 1000;
      for (const u of r.result ?? []) {
        offset = u.update_id + 1;
        await handle(u).catch((e) => console.error('handle failed', e?.message));
      }
    } catch (e) {
      console.error('polling error, retry', backoff, 'ms:', e?.message);
      await new Promise((r) => setTimeout(r, backoff));
      backoff = Math.min(backoff * 2, 60_000);
    }
  }
}

for (const sig of ['SIGTERM', 'SIGINT']) process.on(sig, () => process.exit(0));
main();
