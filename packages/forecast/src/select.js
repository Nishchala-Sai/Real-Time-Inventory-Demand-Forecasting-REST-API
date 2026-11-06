import { sma } from './sma.js';
import { ses } from './ses.js';
import { holt } from './holt.js';
import { croston, crostonEligible } from './croston.js';
import { metrics } from './metrics.js';

const MODELS = { sma, ses, holt, croston };
const SIMPLICITY = ['sma', 'ses', 'croston', 'holt'];
const TIE_MARGIN = 1.01;

const range = (from, to, step) => {
  const steps = Math.round((to - from) / step);
  return Array.from({ length: steps + 1 }, (_, i) => Number((from + i * step).toFixed(2)));
};
const TENTHS = range(0.1, 0.9, 0.1);

function candidates(y) {
  const families = {
    sma: [3, 7, 14].map((window) => ({ window })),
    ses: range(0.05, 0.95, 0.05).map((alpha) => ({ alpha })),
    holt: TENTHS.flatMap((alpha) => TENTHS.map((beta) => ({ alpha, beta }))),
  };
  if (crostonEligible(y)) families.croston = [{ alpha: 0.1 }, { alpha: 0.2 }];
  return families;
}

/**
 * Fit one model by name.
 * @param {'sma'|'ses'|'holt'|'croston'} method
 * @param {number[]} y daily quantities, oldest first
 * @param {object} [params] model parameters
 * @param {number} [horizon]
 * @returns {{fitted: (number|null)[], forecast: number[], sigma: number, params: object}}
 */
export function fitModel(method, y, params = {}, horizon = 7) {
  return MODELS[method](y, { ...params, horizon });
}

function bestOnTraining(method, paramGrid, train) {
  let best = null;
  for (const params of paramGrid) {
    const { mae } = metrics(train, fitModel(method, train, params).fitted);
    if (mae !== null && (best === null || mae < best.mae)) best = { params, mae };
  }
  return best.params;
}

// Score only the holdout tail of a fit over the full series. Each fitted value still
// uses data strictly before its day, so these are genuine one-step-ahead predictions.
function scoreTail(y, fitted, holdout) {
  if (holdout === 0) return metrics(y, fitted);
  return metrics(y.slice(-holdout), fitted.slice(-holdout));
}

/**
 * Tune each model family on the training part, then pick the lowest holdout MAE.
 * Ties within 1% go to the simpler model (SMA, then SES, Croston, Holt).
 * Needs at least `holdout + 7` points.
 * @param {number[]} y daily quantities, oldest first
 * @param {{holdout?: number, horizon?: number}} [options]
 * @returns {{method: string, fitted: (number|null)[], forecast: number[], sigma: number, params: object,
 *   metrics: {holdout: object, inSample: object}, leaderboard: object[], runnerUp: object|null}}
 *   `runnerUp` is a more complex model that scored better but within the tie margin.
 */
export function select(y, { holdout = 14, horizon = 7 } = {}) {
  const train = holdout === 0 ? y : y.slice(0, -holdout);
  const results = Object.entries(candidates(train)).map(([method, paramGrid]) => {
    const params = bestOnTraining(method, paramGrid, train);
    const fit = fitModel(method, y, params, horizon);
    return { method, fit, score: scoreTail(y, fit.fitted, holdout) };
  });
  const lowest = Math.min(...results.map((r) => r.score.mae));
  const winner = results
    .filter((r) => r.score.mae <= lowest * TIE_MARGIN)
    .sort((a, b) => SIMPLICITY.indexOf(a.method) - SIMPLICITY.indexOf(b.method))[0];
  const leaderboard = results
    .map(({ method, fit, score }) => ({ method, params: fit.params, ...score }))
    .sort((a, b) => a.mae - b.mae);
  return {
    method: winner.method,
    ...winner.fit,
    metrics: { holdout: winner.score, inSample: metrics(y, winner.fit.fitted) },
    leaderboard,
    runnerUp: leaderboard.find((r) => r.mae < winner.score.mae) ?? null,
  };
}
