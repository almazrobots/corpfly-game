import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fc from 'fast-check';
import { openDb } from '../server/src/db.js';

let db;
beforeEach(() => { db = openDb(':memory:'); });
afterEach(() => db.close());

describe('порядковый номер = идентичность игрока', () => {
  it('выдаётся по порядку активации, начиная с единицы', () => {
    expect(db.upsertPlayer(100, 'AA').seq).toBe(1);
    expect(db.upsertPlayer(200, 'BB').seq).toBe(2);
    expect(db.upsertPlayer(300, 'VV').seq).toBe(3);
  });

  it('повторный вход не выдаёт новый номер', () => {
    const first = db.upsertPlayer(100, 'AA');
    expect(first.created).toBe(true);
    db.upsertPlayer(200, 'BB');
    const again = db.upsertPlayer(100, 'AA');
    expect(again.created).toBe(false);
    expect(again.seq).toBe(first.seq);
    expect(db.counts().players).toBe(2);
  });

  it('смена имени в Telegram обновляет инициалы, но не номер', () => {
    const before = db.upsertPlayer(100, 'AS');
    const after = db.upsertPlayer(100, 'AP');
    expect(after.seq).toBe(before.seq);
    expect(after.initials).toBe('AP');
  });

  it('номера уникальны и монотонны при любом порядке прихода', () => {
    fc.assert(fc.property(fc.uniqueArray(fc.integer({ min: 1, max: 10 ** 9 }), { minLength: 2, maxLength: 25 }), (ids) => {
      const fresh = openDb(':memory:');
      try {
        const seqs = ids.map((id) => fresh.upsertPlayer(id, 'XX').seq);
        expect(seqs).toEqual([...Array(ids.length)].map((_, i) => i + 1));
        expect(new Set(seqs).size).toBe(ids.length);
      } finally { fresh.close(); }
    }), { numRuns: 25 });
  });
});

describe('рекорд', () => {
  beforeEach(() => { db.upsertPlayer(100, 'AA'); });

  it('стартует с нуля', () => {
    expect(db.getPlayer(100).best).toBe(0);
  });

  it('растёт только вверх', () => {
    expect(db.submitScore(100, 10).best).toBe(10);
    expect(db.submitScore(100, 3).best).toBe(10);
    expect(db.submitScore(100, 25).best).toBe(25);
  });

  it('сообщает, был ли это личный рекорд', () => {
    expect(db.submitScore(100, 10).improved).toBe(true);
    expect(db.submitScore(100, 10).improved).toBe(false);
    expect(db.submitScore(100, 11).improved).toBe(true);
  });

  it('считает забеги, даже когда рекорд не побит', () => {
    db.submitScore(100, 5);
    db.submitScore(100, 1);
    db.submitScore(100, 2);
    expect(db.getPlayer(100).plays).toBe(3);
  });

  it('рекорд равен максимуму всех сданных значений', () => {
    fc.assert(fc.property(fc.array(fc.nat({ max: 500 }), { minLength: 1, maxLength: 30 }), (scores) => {
      const fresh = openDb(':memory:');
      try {
        fresh.upsertPlayer(1, 'XX');
        for (const s of scores) fresh.submitScore(1, s);
        expect(fresh.getPlayer(1).best).toBe(Math.max(...scores));
        expect(fresh.getPlayer(1).plays).toBe(scores.length);
      } finally { fresh.close(); }
    }), { numRuns: 30 });
  });

  it('счёт незнакомого игрока не принимается', () => {
    expect(db.submitScore(999, 10)).toBeNull();
  });
});

describe('рейтинг', () => {
  beforeEach(() => {
    db.upsertPlayer(1, 'AA'); db.upsertPlayer(2, 'BB'); db.upsertPlayer(3, 'VV'); db.upsertPlayer(4, 'GG');
    db.submitScore(1, 10); db.submitScore(2, 30); db.submitScore(3, 20);
  });

  it('сортируется по рекорду убыванием', () => {
    expect(db.top(10).map((r) => r.best)).toEqual([30, 20, 10]);
  });

  it('игроки без рекорда в списке не показываются', () => {
    expect(db.top(10).map((r) => r.seq)).not.toContain(4);
    expect(db.counts()).toEqual({ players: 4, ranked: 3 });
  });

  it('место считается от числа обошедших', () => {
    expect(db.rankOf(2)).toBe(1);
    expect(db.rankOf(3)).toBe(2);
    expect(db.rankOf(1)).toBe(3);
  });

  it('при равных рекордах первым стоит тот, кто поставил его раньше', () => {
    db.submitScore(4, 30);
    const board = db.top(10);
    expect(board[0].seq).toBe(2);      // рекорд 30 поставлен раньше
    expect(board[1].seq).toBe(4);
    expect(db.rankOf(2)).toBe(1);
    expect(db.rankOf(4)).toBe(1);      // одинаковый рекорд — одинаковое место
  });

  it('limit зажимается в [1, 200] — бессмысленные значения не доходят до SQL', () => {
    expect(db.top(0)).toHaveLength(1);        // 0 бессмыслен → минимум 1
    expect(db.top(-5)).toHaveLength(1);
    expect(db.top(1)).toHaveLength(1);
    expect(db.top(10_000)).toHaveLength(3);   // больше, чем есть, — отдаём всё
  });

  it('наружу отдаются только номер, инициалы и рекорд — никаких tg_id', () => {
    for (const row of db.top(10)) {
      expect(Object.keys(row).sort()).toEqual(['best', 'initials', 'seq']);
    }
  });
});
