import { describe, expect, it } from 'vitest';
import { addDays, ses, sesAdvance, sesState, sesStep } from '../src/index.js';
import { mulberry32 } from './prng.js';

const fresh = (alpha) => sesState({ alpha, y: [] });

describe('sesStep and addDays', () => {
  it('starts the level at the first value', () => {
    expect(sesStep({ alpha: 0.5, level: 0, mse: 0, n: 0 }, 8)).toMatchObject({ level: 8, mse: 0, n: 1 });
  });

  it('crosses month ends', () => {
    expect(addDays('2026-10-31', 1)).toBe('2026-11-01');
    expect(addDays('2026-01-01', -1)).toBe('2025-12-31');
  });
});

describe('sesAdvance', () => {
  it('property: folding over random days with gaps equals batch SES', () => {
    const rand = mulberry32(42);
    for (let run = 0; run < 200; run++) {
      const alpha = 0.01 + rand() * 0.98;
      const y = [];
      let state = fresh(alpha);
      let day = '2026-01-01';
      const length = 1 + Math.floor(rand() * 60);
      for (let i = 0; i < length; i++) {
        const gap = rand() < 0.3 ? Math.floor(rand() * 6) : 0;
        for (let g = 0; g < gap && y.length > 0; g++) {
          y.push(0);
          day = addDays(day, 1);
        }
        const sales = 1 + Math.floor(rand() * 4);
        let total = 0;
        for (let s = 0; s < sales; s++) {
          const qty = 1 + Math.floor(rand() * 20);
          state = sesAdvance(state, day, qty);
          total += qty;
        }
        y.push(total);
        day = addDays(day, 1);
      }
      const closed = sesAdvance(state, day, 0);
      const batch = ses(y, { alpha });
      expect(Math.abs(closed.level - batch.forecast[0])).toBeLessThan(1e-9);
      expect(Math.abs(Math.sqrt(closed.mse) - batch.sigma)).toBeLessThan(1e-9);
      expect(closed.n).toBe(y.length);
      expect(closed.lastClosedDay).toBe(addDays(day, -1));
    }
  });

  it('moves the provisional forecast on a surge but not on a slow morning', () => {
    const base = sesState({ alpha: 0.5, y: [10, 10, 10], lastClosedDay: '2026-01-03' });
    const slow = sesAdvance(base, '2026-01-04', 2);
    expect(slow.next).toBe(10);
    const surge = sesAdvance(slow, '2026-01-04', 28);
    expect(surge.next).toBe(0.5 * 30 + 0.5 * 10);
    expect(surge.level).toBe(10);
  });

  it('first sale ever sets next to the quantity sold', () => {
    expect(sesAdvance(fresh(0.3), '2026-01-01', 4).next).toBe(4);
  });

  it('caps the rollover loop on very long gaps', () => {
    const state = sesAdvance(fresh(0.3), '2010-01-01', 5);
    const later = sesAdvance(state, '2026-01-01', 1);
    expect(later.n).toBe(1 + 730);
    expect(later.openDay).toBe('2026-01-01');
  });

  it('counts a same-day sale without closing the day', () => {
    const state = sesAdvance(sesAdvance(fresh(0.3), '2026-01-01', 1), '2026-01-01', 2);
    expect(state).toMatchObject({ n: 0, openQty: 3 });
  });
});
