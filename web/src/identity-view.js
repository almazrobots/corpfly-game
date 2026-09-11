// Публичный ярлык игрока: «#43 AS». Ни юзернейма, ни ссылки, ни полного имени —
// только порядковый номер активации бота и две буквы инициалов.
export function formatHandle(seq, initials) {
  const n = Number.isFinite(seq) && seq > 0 ? Math.floor(seq) : 0;
  const ii = String(initials ?? '').slice(0, 2) || '??';
  return `#${n} ${ii}`;
}

/** Медаль для первых трёх мест, иначе позиция числом. */
export function rankBadge(rank) {
  return ({ 1: '1', 2: '2', 3: '3' })[rank] ?? String(rank);
}
