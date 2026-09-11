// Тонкая обёртка над Telegram.WebApp: игра должна одинаково работать и в браузере,
// где никакого Telegram нет (там это просто заглушки).
const tg = typeof window !== 'undefined' ? window.Telegram?.WebApp : undefined;

export const isTelegram = Boolean(tg?.initData);

export function boot({ bg = '#0e1424' } = {}) {
  if (!tg) return;
  try {
    tg.ready();
    tg.expand();
    tg.disableVerticalSwipes?.();
    tg.setHeaderColor?.(bg);
    tg.setBackgroundColor?.(bg);
  } catch { /* старый клиент — живём без этого */ }
}

export const initData = () => tg?.initData ?? '';

export function haptic(kind) {
  try {
    const h = tg?.HapticFeedback;
    if (!h) return;
    if (kind === 'hit') h.notificationOccurred('error');
    else if (kind === 'record') h.notificationOccurred('success');
    else h.impactOccurred('light');
  } catch { /* необязательная функция */ }
}
