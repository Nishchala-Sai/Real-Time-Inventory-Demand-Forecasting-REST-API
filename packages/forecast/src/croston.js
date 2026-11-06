import { assertUnit } from './ses.js';
import { ewmSigma } from './metrics.js';

/**
 * Croston only suits intermittent demand: at least 30% of days with no sales.
 * @param {number[]} y
 * @returns {boolean}
 */
export function crostonEligible(y) {
  if (y.length === 0) return false;
  return y.filter((v) => v === 0).length / y.length >= 0.3;
}

/**
 * Croston's method: smooths non-zero demand size and the interval between demands separately.
 * @param {number[]} y daily quantities, oldest first
 * @param {{alpha?: number, horizon?: number}} [options]
 * @returns {{fitted: (number|null)[], forecast: number[], sigma: number, params: {alpha: number}}}
 */
export function croston(y, { alpha = 0.1, horizon = 7 } = {}) {
  assertUnit('alpha', alpha);
  const fitted = [];
  let size = null;
  let interval = null;
  let sinceDemand = 1;
  for (const value of y) {
    fitted.push(size === null ? null : size / interval);
    if (value > 0) {
      size = size === null ? value : alpha * value + (1 - alpha) * size;
      interval = interval === null ? sinceDemand : alpha * sinceDemand + (1 - alpha) * interval;
      sinceDemand = 1;
    } else {
      sinceDemand++;
    }
  }
  const rate = size === null ? 0 : size / interval;
  return { fitted, forecast: Array(horizon).fill(rate), sigma: ewmSigma(y, fitted), params: { alpha } };
}
