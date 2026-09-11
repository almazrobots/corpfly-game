import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { initialsFrom, publicHandle, sanitizeScore, MAX_PLAUSIBLE_SCORE } from '../server/src/identity.js';
import { formatHandle, rankBadge } from '../web/src/identity-view.js';

describe('инициалы — ровно два знака и ничего опознавательного', () => {
  const cases = [
    [{ first_name: 'Алмаз', last_name: 'Салимзянов' }, 'AS'],   // кириллица → латиница
    [{ first_name: 'Ada', last_name: 'Lovelace' }, 'AL'],
    [{ first_name: 'Алмаз' }, 'AL'],
    [{ first_name: 'A' }, 'A?'],
    [{ first_name: '', last_name: '' }, '??'],
    [{}, '??'],
    [{ first_name: '🪰🐝' }, '??'],                              // эмодзи буквами не считаются
    [{ first_name: '🪰 Марк', last_name: 'Цукерберг' }, 'MC'],
    [{ first_name: '  ivan', last_name: '  petrov' }, 'IP'],
    [{ first_name: '第一', last_name: '二' }, '??'],              // другая письменность → заглушка
    [{ first_name: '7up' }, '7U'],
    [{ first_name: 'Юрий', last_name: 'Жуков' }, 'UJ'],
    [{ first_name: 'Ольга', last_name: 'Щербакова' }, 'OS'],
  ];
  for (const [user, want] of cases) {
    it(`${JSON.stringify(user)} → ${want}`, () => {
      expect(initialsFrom(user)).toBe(want);
    });
  }

  it('всегда ровно два знака, каким бы ни было имя', () => {
    fc.assert(fc.property(fc.string(), fc.string(), (a, b) => {
      const ii = initialsFrom({ first_name: a, last_name: b });
      expect([...ii]).toHaveLength(2);
      expect(ii).toMatch(/^[A-Z0-9?]{2}$/);      // проект англоязычный: только латиница
    }));
  });

  it('username и полное имя наружу не просачиваются', () => {
    const ii = initialsFrom({ first_name: 'Алмаз', last_name: 'Салимзянов', username: 'almazrobots' });
    expect(ii).toBe('AS');
    expect(ii.toLowerCase()).not.toContain('almaz');
    expect(publicHandle(43, ii)).toBe('#43 AS');
  });
});

describe('публичный ярлык', () => {
  it('формат «#номер инициалы»', () => {
    expect(publicHandle(1, 'AS')).toBe('#1 AS');
    expect(publicHandle(43, 'ML')).toBe('#43 ML');
  });

  it('клиент и сервер рисуют один и тот же ярлык', () => {
    fc.assert(fc.property(fc.integer({ min: 1, max: 10_000 }), (seq) => {
      expect(formatHandle(seq, 'AS')).toBe(publicHandle(seq, 'AS'));
    }));
  });

  it('клиент не падает на мусорных данных', () => {
    expect(formatHandle(null, null)).toBe('#0 ??');
    expect(formatHandle(-5, 'ABCDEF')).toBe('#0 AB');
    expect(formatHandle(7.9, 'XY')).toBe('#7 XY');
  });

  it('позиция в списке подписана числом', () => {
    expect(rankBadge(1)).toBe('1');
    expect(rankBadge(57)).toBe('57');
  });
});

describe('счёт с клиента — данные, а не истина', () => {
  it('нормальные значения проходят', () => {
    expect(sanitizeScore(0)).toBe(0);
    expect(sanitizeScore(42)).toBe(42);
    expect(sanitizeScore(MAX_PLAUSIBLE_SCORE)).toBe(MAX_PLAUSIBLE_SCORE);
  });

  it('мусор и накрутка отбиваются', () => {
    for (const bad of [-1, 1.5, NaN, Infinity, '42', null, undefined, {}, [], MAX_PLAUSIBLE_SCORE + 1, 1e9]) {
      expect(sanitizeScore(bad)).toBeNull();
    }
  });

  // Согласованность порога правдоподобия с физикой движка проверяется отдельно
  // и выводом из констант — tests/plausibility.test.js. Дублировать числа здесь
  // значило бы завести второй источник правды, который разъедется первым же.


  it('результат либо null, либо целое в границах', () => {
    fc.assert(fc.property(fc.anything(), (v) => {
      const r = sanitizeScore(v);
      if (r !== null) {
        expect(Number.isInteger(r)).toBe(true);
        expect(r).toBeGreaterThanOrEqual(0);
        expect(r).toBeLessThanOrEqual(MAX_PLAUSIBLE_SCORE);
      }
    }));
  });
});
