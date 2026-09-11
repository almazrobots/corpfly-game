import { test, expect } from '@playwright/test';
import { signInitData } from '../server/src/initdata.js';

// Настоящего Telegram в браузере нет. Подменяем НЕ window.Telegram через addInitScript,
// а сам файл telegram-web-app.js по его URL: страница грузит SDK с telegram.org, и он
// перезаписывает любой глобал, выставленный до него — заглушка молча пропадала, игрок
// оставался «offline». Подмена на уровне запроса сохраняет прод-порядок загрузки.
const TOKEN = 'e2e:testtoken';

function webAppStub(initData) {
  return `window.Telegram = { WebApp: {
    initData: ${JSON.stringify(initData)},
    ready(){}, expand(){}, disableVerticalSwipes(){},
    setHeaderColor(){}, setBackgroundColor(){},
    HapticFeedback: { impactOccurred(){}, notificationOccurred(){} },
  } };`;
}

async function stubTelegram(page, { id = 900001, first = 'Алмаз', last = 'Салимзянов' } = {}) {
  const initData = signInitData({
    user: JSON.stringify({ id, first_name: first, last_name: last }),
    auth_date: String(Math.floor(Date.now() / 1000)),
  }, TOKEN);
  await page.route('https://telegram.org/js/telegram-web-app.js', (route) =>
    route.fulfill({ status: 200, contentType: 'text/javascript; charset=utf-8', body: webAppStub(initData) }));
}

test.beforeEach(async ({ page }) => {
  await stubTelegram(page);
  await page.goto('/');
});

test('нижняя панель: старт по центру, кубок справа', async ({ page }) => {
  const bar = page.getByTestId('bar');
  await expect(bar).toBeVisible();
  await expect(page.getByTestId('btn-start')).toBeVisible();
  const trophy = page.getByTestId('btn-board');
  await expect(trophy).toBeVisible();
  await expect(trophy).toHaveAttribute('aria-label', 'Ranking');
  await expect(trophy.locator('svg')).toBeVisible();

  // Главная кнопка центрирована в окне, кубок правее неё.
  const vw = page.viewportSize().width;
  const go = await page.getByTestId('btn-start').boundingBox();
  const tr = await trophy.boundingBox();
  expect(Math.abs((go.x + go.width / 2) - vw / 2)).toBeLessThan(4);
  expect(tr.x).toBeGreaterThan(go.x + go.width);

  // Панель прижата к низу экрана.
  const barBox = await bar.boundingBox();
  expect(barBox.y + barBox.height).toBeGreaterThan(page.viewportSize().height - 4);
});

test('звук: кнопка в панели переключается и помнит выбор', async ({ page }) => {
  const btn = page.getByTestId('btn-sound');
  await expect(btn).toBeVisible();
  await expect(btn).toHaveAttribute('aria-pressed', 'true');

  // Кнопка звука слева от главной — левая ячейка панели.
  const snd = await btn.boundingBox();
  const go = await page.getByTestId('btn-start').boundingBox();
  expect(snd.x + snd.width).toBeLessThanOrEqual(go.x + 1);

  await btn.click();
  await expect(btn).toHaveAttribute('aria-pressed', 'false');
  // Перечёркивание видно, волны погашены — состояние читается не только по aria.
  await expect(btn.locator('.slash')).toHaveCSS('opacity', '1');

  await page.reload();
  await expect(page.getByTestId('btn-sound')).toHaveAttribute('aria-pressed', 'false');
});

test('звук выключается на любом экране, а не только между раундами', async ({ page }) => {
  const bar = page.getByTestId('btn-sound');
  const mini = page.getByTestId('btn-sound-mini');

  // На стартовом экране — кнопка в панели, дублёра нет.
  await expect(bar).toBeVisible();
  await expect(mini).toBeHidden();

  // В отсчёте панель уходит, но звук остаётся доступен.
  await page.getByTestId('btn-start').click();
  await expect(bar).toBeHidden();
  await expect(mini).toBeVisible();

  // Выключаем прямо во время отсчёта — состояние общее для обеих кнопок.
  await mini.click();
  await expect(mini).toHaveAttribute('aria-pressed', 'false');

  // После смерти панель возвращается уже с выключенным звуком.
  await expect(page.getByTestId('card-over')).toBeVisible({ timeout: 15_000 });
  await expect(bar).toBeVisible();
  await expect(bar).toHaveAttribute('aria-pressed', 'false');
  await expect(mini).toBeHidden();

  // И обратно: включили в панели — дублёр это знает.
  await bar.click();
  await expect(bar).toHaveAttribute('aria-pressed', 'true');
  await page.getByTestId('btn-start').click();
  await expect(mini).toHaveAttribute('aria-pressed', 'true');
});

test('в рейтинге звук тоже доступен', async ({ page }) => {
  await page.getByTestId('btn-board').click();
  await expect(page.getByTestId('card-board')).toBeVisible();
  await expect(page.getByTestId('btn-sound-mini')).toBeVisible();
});

test('игра не падает и не шумит в консоль при выключенном звуке', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.getByTestId('btn-sound').click();
  await page.getByTestId('btn-start').click();
  await expect(page.getByTestId('card-over')).toBeVisible({ timeout: 15_000 });
  expect(errors).toEqual([]);
});

test('отсчёт 3-2-1 даёт подготовиться: муха не падает сразу', async ({ page }) => {
  await page.getByTestId('btn-start').click();
  const num = page.getByTestId('countdown-num');
  await expect(page.getByTestId('countdown')).toBeVisible();
  await expect(num).toHaveText('3');
  // Панель на время отсчёта убрана, чтобы не мешала.
  await expect(page.getByTestId('bar')).toBeHidden();
  await expect(num).toHaveText('2');
  await expect(num).toHaveText('1');
  await expect(num).toHaveText('GO');
  await expect(page.getByTestId('countdown')).toBeHidden();
  // И только теперь забег действительно идёт.
  await expect(page.getByTestId('card-over')).toBeVisible({ timeout: 15_000 });
});

test('страница загружается, игра рисуется, ошибок в консоли нет', async ({ page }) => {
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(e.message));

  await expect(page.getByTestId('card-start')).toBeVisible();
  await expect(page.locator('canvas')).toBeVisible();
  // Меш мухи действительно собрался — счётчик треугольников заполнен из модуля.
  await expect(page.locator('#polys')).toHaveText(/\d+ tris/);
  expect(errors).toEqual([]);
});

test('сессия открывается: игрок получает анонимный позывной вида «#1 AS»', async ({ page }) => {
  await expect(page.locator('#myHandle')).toHaveText(/^#\d+ [A-Z0-9?]{2}$/, { timeout: 10_000 });
  const handle = await page.locator('#myHandle').textContent();
  expect(handle).not.toContain('Салимзянов');
  expect(handle).not.toContain('900001');
});

test('забег запускается и заканчивается экраном блокировки с причиной', async ({ page }) => {
  await page.getByTestId('btn-start').click();
  await expect(page.getByTestId('card-start')).toBeHidden();
  // Не трогаем экран — муха падает на пол и умирает от выгорания.
  await expect(page.getByTestId('card-over')).toBeVisible({ timeout: 15_000 });
  await expect(page.locator('#cause')).not.toBeEmpty();
  // Слагаемое показывается как умножение; отдельная проверка разбора — ниже.
  await expect(page.locator('#sc')).toHaveText(/^\d+ x \d+ = \d+$/);
  await expect(page.locator('#total')).toHaveText(/^\d+$/);
});

test('экран смерти показывает, из чего собран счёт', async ({ page }) => {
  await page.getByTestId('btn-start').click();
  await expect(page.getByTestId('card-over')).toBeVisible({ timeout: 15_000 });

  // Слагаемые видны как умножение, а не просто как числа.
  await expect(page.locator('#sc')).toHaveText(/^\d+ x 10 = \d+$/);
  await expect(page.locator('#budget')).toHaveText(/^\d+ x 5 = \d+$/);

  // Итог — сумма слагаемых, и именно он уезжает в рейтинг.
  const parse = async (sel) => Number((await page.locator(sel).textContent()).split('=')[1].trim());
  const total = Number(await page.locator('#total').textContent());
  expect(total).toBe(await parse('#sc') + await parse('#budget'));
});

test('стартовый экран объявляет цену очков', async ({ page }) => {
  await expect(page.getByTestId('card-start')).toContainText('blocker 10');
  await expect(page.getByTestId('card-start')).toContainText('budget 5');
});

test('рейтинг открывается и показывает только номер + инициалы', async ({ page }) => {
  await page.getByTestId('btn-board').click();
  await expect(page.getByTestId('card-board')).toBeVisible();
  const list = page.getByTestId('board-list');
  await expect(list).toBeVisible();
  await expect(page.locator('#youLine')).toContainText(/#\d+|Players/, { timeout: 10_000 });

  const text = await list.textContent();
  expect(text).not.toContain('@');            // ни одного юзернейма
  expect(text).not.toContain('Салимзянов');
  await expect(list.locator('a')).toHaveCount(0);   // ни одной ссылки на профиль

  await page.getByTestId('btn-close-board').click();
  await expect(page.getByTestId('card-start')).toBeVisible();
});

test('рекорд доезжает до сервера и попадает в рейтинг', async ({ page, request }) => {
  await page.getByTestId('btn-start').click();
  await expect(page.getByTestId('card-over')).toBeVisible({ timeout: 15_000 });

  await page.getByTestId('btn-board').click();
  await expect(page.getByTestId('card-board')).toBeVisible();
  await expect(page.locator('#youLine')).toContainText('You are #', { timeout: 10_000 });

  // И тот же факт — со стороны API, а не только в DOM.
  const health = await request.get('/api/health');
  expect((await health.json()).players).toBeGreaterThanOrEqual(1);
});

test('интерфейс англоязычный: кириллицы на экране нет', async ({ page }) => {
  await expect(page.getByTestId('card-start')).toBeVisible();
  const ui = await page.locator('#ui').innerText();
  expect(ui).not.toMatch(/[\u0400-\u04FF]/);
  await page.getByTestId('btn-board').click();
  await expect(page.getByTestId('card-board')).toBeVisible();
  await expect(page.locator('#youLine')).not.toBeEmpty({ timeout: 10_000 });
  expect(await page.locator('#ui').innerText()).not.toMatch(/[\u0400-\u04FF]/);
});

test('клавиатура работает: пробел запускает отсчёт', async ({ page }) => {
  await page.locator('body').press('Space');
  await expect(page.getByTestId('card-start')).toBeHidden();
  await expect(page.getByTestId('countdown')).toBeVisible();
});

test('после смерти панель возвращается с надписью перезапуска', async ({ page }) => {
  await page.getByTestId('btn-start').click();
  await expect(page.getByTestId('card-over')).toBeVisible({ timeout: 15_000 });
  const bar = page.getByTestId('bar');
  await expect(bar).toBeVisible();
  await expect(page.getByTestId('btn-start')).toHaveText(/RE-RUN/);
  await expect(page.getByTestId('btn-board')).toBeVisible();
});
