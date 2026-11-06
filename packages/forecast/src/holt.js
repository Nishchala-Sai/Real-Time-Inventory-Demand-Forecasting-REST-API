import { assertUnit } from './ses.js';
import { ewmSigma } from './metrics.js';

// The mean of the first m differences telescopes to this.
function initialTrend(y) {
  const m = Math.min(4, y.length - 1);
  return m < 1 ? 0 : (y[m] - y[0]) / m;
}

/**
 * Holt's linear trend method. Fixes the systematic under-forecast of SES and SMA on trending items.
 * @param {number[]} y daily quantities, oldest first
 * @param {{alpha?: number, beta?: number, horizon?: number}} [options]
 * @returns {{fitted: (number|null)[], forecast: number[], sigma: number, params: {alpha: number, beta: number}}}
 */
export function holt(y, { alpha = 0.3, beta = 0.1, horizon = 7 } = {}) {
  assertUnit('alpha', alpha);
  assertUnit('beta', beta);
  const fitted = y.length ? [null] : [];
  let level = y.length ? y[0] : 0;
  let trend = initialTrend(y);
  for (let i = 1; i < y.length; i++) {
    fitted.push(level + trend);
    const nextLevel = alpha * y[i] + (1 - alpha) * (level + trend);
    trend = beta * (nextLevel - level) + (1 - beta) * trend;
    level = nextLevel;
  }
  const forecast = Array.from({ length: horizon }, (_, h) => Math.max(0, level + (h + 1) * trend));
  return { fitted, forecast, sigma: ewmSigma(y, fitted), params: { alpha, beta } };
}
