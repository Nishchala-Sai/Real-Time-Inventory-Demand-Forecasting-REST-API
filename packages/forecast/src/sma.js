import { ewmSigma } from './metrics.js';

const mean = (values) => values.reduce((sum, v) => sum + v, 0) / values.length;

/**
 * Simple moving average. With fewer than `window` points it averages what exists.
 * @param {number[]} y daily quantities, oldest first
 * @param {{window?: number, horizon?: number}} [options]
 * @returns {{fitted: (number|null)[], forecast: number[], sigma: number, params: {window: number}}}
 */
export function sma(y, { window = 3, horizon = 7 } = {}) {
  const fitted = y.map((_, i) => (i < window ? null : mean(y.slice(i - window, i))));
  const value = y.length === 0 ? 0 : mean(y.slice(-window));
  return {
    fitted,
    forecast: Array(horizon).fill(value),
    sigma: ewmSigma(y, fitted),
    params: { window },
  };
}
