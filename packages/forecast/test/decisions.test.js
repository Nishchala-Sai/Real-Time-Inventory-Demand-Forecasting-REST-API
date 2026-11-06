import { describe, expect, it } from 'vitest';
import { blend, categoryPrior, coldStart, confidence, explain, intervals, reorder } from '../src/index.js';

const days = (n) => Array.from({ length: n }, (_, i) => `2026-10-${String(i + 15).padStart(2, '0')}`);
const GOLDEN = [12, 18, 15, 22, 20, 28, 24, 31, 29, 35];

describe('intervals', () => {
  it.each([
    ['ses', { alpha: 0.5 }, 'exact'],
    ['holt', { alpha: 0.5, beta: 0.2 }, 'exact'],
    ['sma', { window: 3 }, 'approx'],
    ['croston', { alpha: 0.1 }, 'approx'],
    ['coldstart', { window: 1 }, 'approx'],
  ])('%s width grows with h and the lower bound stays at or above 0', (method, params, kind) => {
    const { points, intervalMethod } = intervals({ method, forecast: Array(10).fill(3), sigma: 4, params });
    expect(intervalMethod).toBe(kind);
    for (let i = 1; i < points.length; i++) {
      expect(points[i].upper - points[i].value).toBeGreaterThan(points[i - 1].upper - points[i - 1].value);
      expect(points[i].lower).toBeGreaterThanOrEqual(0);
    }
  });

  it('uses the SES formula with z = 1.2816', () => {
    const { points } = intervals({ method: 'ses', forecast: [100, 100], sigma: 10, params: { alpha: 0.5 } });
    expect(points[0].upper).toBeCloseTo(112.816, 6);
    expect(points[1].upper).toBeCloseTo(100 + 12.816 * Math.sqrt(1.25), 6);
  });
});

describe('reorder', () => {
  const base = { forecast: [10, 10], sigma: 4, leadTimeDays: 4, reviewPeriodDays: 3, serviceLevel: 0.95 };

  it('follows the formula and extends the forecast flat', () => {
    const result = reorder({ ...base, currentStock: 20 });
    const safety = 1.6449 * 4 * 2;
    expect(result.demandLT).toBe(40);
    expect(result.safetyStock).toBeCloseTo(safety, 9);
    expect(result.reorderPoint).toBe(Math.ceil(40 + safety));
    expect(result.orderUpTo).toBeCloseTo(70 + safety, 9);
    expect(result.suggestedOrderQty).toBe(Math.ceil(50 + safety));
    expect(result.daysOfCover).toBe(2);
  });

  it('never suggests a negative order and has no cover on a zero forecast', () => {
    expect(reorder({ ...base, currentStock: 10000 }).suggestedOrderQty).toBe(0);
    expect(reorder({ ...base, forecast: [0], sigma: 0, currentStock: 5 }).daysOfCover).toBeNull();
    expect(reorder({ ...base, forecast: [], sigma: 0, currentStock: 5 }).reorderPoint).toBe(0);
  });
});

describe('cold start', () => {
  it.each([[0, 20], [7, 15], [14, 10]])('blends at n = %d', (n, expected) => {
    expect(blend(10, n, 20)).toBe(expected);
  });

  it('takes the median of category means', () => {
    expect(categoryPrior([])).toBeNull();
    expect(categoryPrior([9, 1, 5])).toBe(5);
    expect(categoryPrior([1, 2, 3, 4])).toBe(2.5);
  });

  it('uses the prior with no history, then its own mean, then 0', () => {
    expect(coldStart([], { prior: 12, horizon: 2 }).forecast).toEqual([12, 12]);
    expect(coldStart([], { horizon: 1 }).forecast).toEqual([0]);
    const own = coldStart([4, 4, 4, 4, 4], { horizon: 1 });
    expect(own.method).toBe('coldstart');
    expect(own.forecast[0]).toBe(4);
  });

  it('grades confidence and drops a level on poor accuracy', () => {
    expect(confidence(5)).toBe('low');
    expect(confidence(20)).toBe('medium');
    expect(confidence(100)).toBe('high');
    expect(confidence(100, 0.6)).toBe('medium');
    expect(confidence(20, 0.6)).toBe('low');
    expect(confidence(5, 0.9)).toBe('low');
    expect(confidence(100, 0.5)).toBe('high');
  });
});

describe('explain', () => {
  it('matches the spec example for SES', () => {
    const result = explain({ method: 'ses', params: { alpha: 0.8 }, y: GOLDEN, days: days(10), current: 33.827883 });
    expect(result.summary).toBe(
      'Expect about 33.8 units/day (SES, α=0.80). Up from 29.1 because 24 Oct sold 35, above the 29.1 expected.',
    );
    expect(result.weights).toHaveLength(7);
    expect(result.weights[0]).toEqual({ day: '2026-10-24', weight: 0.8 });
    expect(result.weights[1].weight).toBeCloseTo(0.16, 9);
    expect(result.change.driverQty).toBe(35);
  });

  it('gives SMA equal weights and Holt none', () => {
    const smaResult = explain({ method: 'sma', params: { window: 3 }, y: GOLDEN, days: days(10), current: 31.67 });
    expect(smaResult.weights.map((w) => w.day)).toEqual(['2026-10-24', '2026-10-23', '2026-10-22']);
    expect(smaResult.weights[0].weight).toBeCloseTo(1 / 3, 9);
    expect(smaResult.summary).toContain('SMA, k=3');
    const holtResult = explain({ method: 'holt', params: { alpha: 0.5, beta: 0.2 }, y: GOLDEN, days: days(10), current: 36 });
    expect(holtResult.weights).toEqual([]);
    expect(holtResult.summary).toContain('Holt, α=0.50, β=0.20');
  });

  it('words a fall, a flat day and a matching day', () => {
    const fall = explain({ method: 'ses', params: { alpha: 0.5 }, y: [10, 10, 2], days: days(3), current: 6 });
    expect(fall.summary).toContain('Down from 10.0 because 17 Oct sold 2, below the 10.0 expected.');
    const flat = explain({ method: 'ses', params: { alpha: 0.5 }, y: [5, 5, 5], days: days(3), current: 5 });
    expect(flat.summary).toContain('Unchanged from 5.0.');
    const match = explain({ method: 'ses', params: { alpha: 0.5 }, y: [5, 5, 5], days: days(3), current: 6 });
    expect(match.summary).toContain('matching');
  });

  it('explains a young product and notes a narrowly beaten model', () => {
    const young = explain({ method: 'coldstart', y: [3, 4], days: days(2), current: 3.5, prior: 4 });
    expect(young.notes[0]).toContain('Only 2 days');
    expect(young.summary).toContain('(new product)');
    const narrow = explain({ method: 'ses', params: { alpha: 0.5 }, y: GOLDEN, days: days(10), current: 30, runnerUp: { method: 'holt' } });
    expect(narrow.notes[0]).toBe('Holt beat SES on the holdout, but by under 1%, so the simpler model was kept.');
    expect(explain({ method: 'coldstart', y: [], days: [], current: 0 }).change).toBeNull();
  });
});
