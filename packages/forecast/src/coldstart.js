import { sma } from './sma.js';

const FULL_WEIGHT_DAYS = 14;

/**
 * Median daily mean across established products in the same category.
 * @param {number[]} means
 * @returns {number|null} null when there are none
 */
export function categoryPrior(means) {
  if (means.length === 0) return null;
  const sorted = [...means].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * Blend a young product's own forecast with its category prior, trusting it more each day.
 * @param {number} own
 * @param {number} n days since the first sale
 * @param {number} prior
 * @returns {number}
 */
export function blend(own, n, prior) {
  if (n >= FULL_WEIGHT_DAYS) return own;
  const w = n / FULL_WEIGHT_DAYS;
  return w * own + (1 - w) * prior;
}

/**
 * Forecast for a product without enough history for model selection.
 * The prior falls back to the product's own mean, then to 0.
 * @param {number[]} y daily quantities since the first sale
 * @param {{prior?: number|null, horizon?: number}} [options]
 * @returns {{method: 'coldstart', fitted: (number|null)[], forecast: number[], sigma: number, params: object}}
 */
export function coldStart(y, { prior = null, horizon = 7 } = {}) {
  const n = y.length;
  const fit = sma(y, { window: Math.max(1, Math.min(3, n)), horizon });
  const ownMean = n === 0 ? 0 : y.reduce((sum, v) => sum + v, 0) / n;
  const effectivePrior = prior ?? ownMean;
  return {
    ...fit,
    method: 'coldstart',
    forecast: fit.forecast.map((value) => blend(value, n, effectivePrior)),
  };
}

/**
 * Confidence grows with history and drops one level on a poor holdout (WAPE above 0.5).
 * @param {number} n days since the first sale
 * @param {number|null} [wape]
 * @returns {'low'|'medium'|'high'}
 */
export function confidence(n, wape = null) {
  const levels = ['low', 'medium', 'high'];
  const level = n < 14 ? 0 : n < 56 ? 1 : 2;
  return levels[wape !== null && wape > 0.5 ? Math.max(0, level - 1) : level];
}
