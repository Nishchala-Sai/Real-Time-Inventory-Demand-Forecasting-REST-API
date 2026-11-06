import { describe, expect, it } from 'vitest';
import { croston, crostonEligible, fitModel, holt, metrics, select, ses, sma } from '../src/index.js';
import { mulberry32 } from './prng.js';

const GOLDEN = [12, 18, 15, 22, 20, 28, 24, 31, 29, 35];

describe('golden values', () => {
  it.each([
    ['SMA k=3', () => sma(GOLDEN, { window: 3 }), 4.809524, 31.666667],
    ['SES α=0.3', () => ses(GOLDEN, { alpha: 0.3 }), 6.1424, 28.58448],
    ['SES α=0.8', () => ses(GOLDEN, { alpha: 0.8 }), 4.275196, 33.827883],
  ])('%s', (_, fit, mae, next) => {
    const model = fit();
    expect(metrics(GOLDEN, model.fitted).mae).toBeCloseTo(mae, 6);
    expect(model.forecast[0]).toBeCloseTo(next, 6);
  });
});

describe('models', () => {
  it.each([[sma], [ses], [holt], [croston]])('honours horizon and handles empty input', (model) => {
    expect(model(GOLDEN, { horizon: 30 }).forecast).toHaveLength(30);
    const empty = model([], { horizon: 3 });
    expect(empty.forecast).toEqual([0, 0, 0]);
    expect(empty.fitted).toEqual([]);
    expect(empty.sigma).toBe(0);
  });

  it('SMA with a window larger than the series averages what exists', () => {
    const model = sma([2, 4], { window: 5 });
    expect(model.fitted).toEqual([null, null]);
    expect(model.forecast[0]).toBe(3);
  });

  it.each([[0], [1], [-0.5], [1.5]])('rejects alpha %d', (alpha) => {
    expect(() => ses(GOLDEN, { alpha })).toThrow(RangeError);
    expect(() => holt(GOLDEN, { alpha })).toThrow(RangeError);
    expect(() => croston(GOLDEN, { alpha })).toThrow(RangeError);
    expect(() => holt(GOLDEN, { beta: alpha })).toThrow(RangeError);
  });

  it('SES of a constant series is that constant', () => {
    const model = ses(Array(50).fill(7), { alpha: 0.4 });
    expect(model.forecast[0]).toBe(7);
    expect(model.sigma).toBe(0);
  });

  it('Holt on a linear series forecasts the line exactly', () => {
    const y = Array.from({ length: 30 }, (_, t) => 10 + 2 * t);
    const { forecast } = holt(y, { alpha: 0.5, beta: 0.3, horizon: 5 });
    forecast.forEach((value, i) => expect(value).toBeCloseTo(10 + 2 * (y.length - 1 + i + 1), 9));
  });

  it('Holt clamps a falling forecast at zero and handles a single point', () => {
    const y = Array.from({ length: 20 }, (_, t) => 40 - 2 * t);
    expect(holt(y, { alpha: 0.5, beta: 0.5, horizon: 30 }).forecast.at(-1)).toBe(0);
    expect(holt([5], { horizon: 2 }).forecast).toEqual([5, 5]);
  });

  it('Croston forecasts the demand rate on intermittent data', () => {
    const y = [0, 0, 6, 0, 0, 6, 0, 0, 6];
    const model = croston(y, { alpha: 0.2, horizon: 2 });
    expect(model.forecast[0]).toBeCloseTo(2, 9);
    expect(model.fitted[0]).toBeNull();
    expect(croston([0, 0]).forecast[0]).toBe(0);
  });

  it('Croston is only eligible with at least 30% zero days', () => {
    expect(crostonEligible([0, 0, 0, 1, 1, 1, 1, 1, 1, 1])).toBe(true);
    expect(crostonEligible([0, 1, 1, 1, 1, 1, 1, 1, 1, 1])).toBe(false);
    expect(crostonEligible([])).toBe(false);
  });
});

describe('metrics', () => {
  it('skips null pairs', () => {
    expect(metrics([1, 2], [null, 3])).toEqual({ mae: 1, rmse: 1, wape: 0.5, bias: 1, n: 1 });
    expect(metrics([1], [null]).mae).toBeNull();
  });

  it('wape is null when actuals are all zero', () => {
    expect(metrics([0, 0], [1, 1]).wape).toBeNull();
  });

  it('negative bias means under-forecasting', () => {
    expect(metrics([10], [8]).bias).toBe(-2);
  });
});

describe('select', () => {
  it('picks Holt on a strong trend', () => {
    const rand = mulberry32(1);
    const y = Array.from({ length: 120 }, (_, t) => 5 + 1.5 * t + (rand() - 0.5) * 4);
    const result = select(y, { holdout: 14, horizon: 7 });
    expect(result.method).toBe('holt');
    expect(result.forecast).toHaveLength(7);
    expect(result.metrics.holdout.n).toBe(14);
    const byMethod = Object.fromEntries(result.leaderboard.map((r) => [r.method, r]));
    expect(Math.abs(byMethod.holt.bias)).toBeLessThan(Math.abs(byMethod.ses.bias));
  });

  it('picks SES on noise around a flat mean', () => {
    const rand = mulberry32(7);
    const y = Array.from({ length: 120 }, () => 50 + (rand() - 0.5) * 20);
    expect(select(y, { holdout: 30 }).method).toBe('ses');
  });

  it('adds Croston only for intermittent demand and scores in-sample with no holdout', () => {
    const rand = mulberry32(3);
    const y = Array.from({ length: 80 }, () => (rand() < 0.7 ? 0 : 1 + Math.floor(rand() * 5)));
    const result = select(y, { holdout: 0 });
    expect(result.leaderboard.map((r) => r.method)).toContain('croston');
    expect(result.metrics.holdout.n).toBeGreaterThan(60);
  });

  it('keeps the simplest model when every model ties', () => {
    const result = select(Array(40).fill(9), { holdout: 7 });
    expect(result.method).toBe('sma');
    expect(result.runnerUp).toBeNull();
  });

  it('fitModel dispatches by name', () => {
    expect(fitModel('sma', GOLDEN, { window: 3 }).forecast[0]).toBeCloseTo(31.666667, 6);
  });
});
