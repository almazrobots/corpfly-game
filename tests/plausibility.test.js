import { describe, it, expect } from 'vitest';
import { MIN_MS_PER_POINT, MAX_PLAUSIBLE_SCORE, sanitizeScore } from '../server/src/identity.js';
import {
  SPEED0, SPEED_MAX_BONUS, BLOCK_W, MULT_FACTOR, PICKUPS, PICKUP_CHANCE,
  BLOCKER_POINTS, COIN_POINTS,
} from '../web/src/engine.js';

// L2 · Сверка сервера с физикой движка.
//
// Порог правдоподобия живёт на сервере, а физика — в игре. Это два разных файла,
// которые едут в два разных образа, и разъехаться они могут молча: игра станет
// щедрее, а сервер начнёт отбивать честные рекорды словом implausible_score.
// Здесь предел выводится из констант движка заново и сверяется с тем, что стоит
// на сервере.

const MIN_GAP_PX = 250;                       // минимальный интервал между парами
const MAX_SPEED = SPEED0 + SPEED_MAX_BONUS;   // предельная скорость мира

describe('порог правдоподобия согласован с движком', () => {
  const secondsPerPair = MIN_GAP_PX / MAX_SPEED;
  // За пару: очки за блокер + очки за монету, всё под множителем.
  const maxPointsPerPair = (BLOCKER_POINTS + PICKUPS.coin.score) * MULT_FACTOR;
  const physicalMinMs = (secondsPerPair / maxPointsPerPair) * 1000;

  it('сервер не строже физики — честный забег не должен отбиваться', () => {
    expect(MIN_MS_PER_POINT).toBeLessThanOrEqual(physicalMinMs);
  });

  it('и не бесполезно мягок — накрутка всё ещё стоит времени', () => {
    expect(MIN_MS_PER_POINT).toBeGreaterThan(physicalMinMs * 0.5);
  });

  it('потолок достижим за разумный сеанс, но не за минуту', () => {
    const minutes = (MAX_PLAUSIBLE_SCORE * MIN_MS_PER_POINT) / 60_000;
    expect(minutes).toBeGreaterThan(3);
    expect(minutes).toBeLessThan(20);
  });

  it('блокер шире нуля, а бонус выпадает не всегда — иначе расчёт выше неверен', () => {
    expect(BLOCK_W).toBeGreaterThan(0);
    expect(PICKUP_CHANCE).toBeGreaterThan(0);
    expect(PICKUP_CHANCE).toBeLessThan(1);
  });

  it('цена монеты в таблице бонусов совпадает с объявленной константой', () => {
    // Иначе HUD покажет одно, а начислится другое.
    expect(PICKUPS.coin.score).toBe(COIN_POINTS);
  });

  it('блокер стоит дороже монеты — иначе бонусы обесценивают мастерство', () => {
    expect(BLOCKER_POINTS).toBeGreaterThan(COIN_POINTS);
  });

  it('границы sanitizeScore совпадают с объявленным потолком', () => {
    expect(sanitizeScore(MAX_PLAUSIBLE_SCORE)).toBe(MAX_PLAUSIBLE_SCORE);
    expect(sanitizeScore(MAX_PLAUSIBLE_SCORE + 1)).toBeNull();
  });
});
