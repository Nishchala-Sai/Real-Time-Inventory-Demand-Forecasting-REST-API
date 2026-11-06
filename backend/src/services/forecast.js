import mongoose from 'mongoose';
import {
  blend,
  categoryPrior,
  coldStart,
  confidence,
  explain,
  fitModel,
  intervals,
  metrics,
  reorder,
  select,
  sesState,
} from '@inventory/forecast';
import { addDays, range } from '../lib/days.js';
import { ApiError } from '../lib/errors.js';
import { DailyDemand } from '../models/DailyDemand.js';
import { Product } from '../models/Product.js';
import { closedSeries, LIVE_LOOKBACK_DAYS, stateFromRows, today } from './liveForecast.js';

const DEFAULT_HOLDOUT = 14;
const DEFAULT_LOOKBACK = 180;
const PRIOR_MIN_HISTORY_DAYS = 28;

export function loadRows(productIds, currentDay, lookback = DEFAULT_LOOKBACK) {
  const days = Math.max(lookback, LIVE_LOOKBACK_DAYS);
  return DailyDemand.find({
    productId: mongoose.trusted({ $in: productIds }),
    day: mongoose.trusted({ $gte: addDays(currentDay, -days), $lte: currentDay }),
  })
    .select('productId day qty')
    .lean();
}

async function loadPrior(product, yesterday) {
  const peers = await Product.find({
    category: product.category,
    archived: false,
    _id: mongoose.trusted({ $ne: product._id }),
  }).distinct('_id');
  const stats = await DailyDemand.aggregate([
    { $match: { productId: { $in: peers }, day: { $lte: yesterday } } },
    { $group: { _id: '$productId', first: { $min: '$day' }, total: { $sum: '$qty' } } },
  ]);
  const means = stats
    .map(({ first, total }) => ({ total, days: range(first, yesterday).length }))
    .filter(({ days }) => days >= PRIOR_MIN_HISTORY_DAYS)
    .map(({ total, days }) => total / days);
  return categoryPrior(means);
}

function chooseMethod({ method, alpha, beta, window }) {
  if (method) return method;
  if (beta !== undefined) return 'holt';
  if (window !== undefined) return 'sma';
  if (alpha !== undefined) return 'ses';
  return 'auto';
}

function paramsFor(method, { alpha, beta, window }, storedAlpha) {
  if (method === 'sma') return { window: window ?? 3 };
  if (method === 'ses') return { alpha: alpha ?? storedAlpha };
  if (method === 'holt') return { alpha: alpha ?? 0.3, beta: beta ?? 0.1 };
  return { alpha: alpha ?? 0.1 };
}

function resolveHoldout(requested, n) {
  if (requested === undefined) return Math.min(DEFAULT_HOLDOUT, Math.max(0, Math.ceil(n / 2) - 1));
  if (n > 0 && requested >= n / 2) {
    throw new ApiError('VALIDATION_ERROR', 'holdout must be less than half of the history');
  }
  return requested;
}

function holdoutScore(y, fitted, holdout) {
  return holdout > 0 && y.length > holdout ? metrics(y.slice(-holdout), fitted.slice(-holdout)) : null;
}

async function fit(product, y, query, holdout, horizon, yesterday) {
  const method = chooseMethod(query);
  const n = y.length;
  if (method !== 'auto') {
    const model = fitModel(method, y, paramsFor(method, query, product.forecast.alpha), horizon);
    return {
      ...model,
      method,
      metrics: { holdout: holdoutScore(y, model.fitted, holdout), inSample: metrics(y, model.fitted) },
      leaderboard: [],
    };
  }
  if (n < holdout + 7) {
    const prior = await loadPrior(product, yesterday);
    const model = coldStart(y, { prior, horizon });
    return { ...model, prior, metrics: { holdout: null, inSample: metrics(y, model.fitted) }, leaderboard: [] };
  }
  const selected = select(y, { holdout, horizon });
  if (n >= 14) return selected;
  const prior = await loadPrior(product, yesterday);
  return { ...selected, prior, forecast: selected.forecast.map((value) => blend(value, n, prior ?? value)) };
}

export async function buildForecast(product, rows, query, { includeHistory = true } = {}) {
  const { horizon = 7, lookback = DEFAULT_LOOKBACK, holdout: requestedHoldout } = query;
  const currentDay = today();
  const yesterday = addDays(currentDay, -1);
  const { days, y } = closedSeries(rows, addDays(currentDay, -lookback), yesterday);
  const holdout = resolveHoldout(requestedHoldout, y.length);
  const model = await fit(product, y, query, holdout, horizon, yesterday);

  const openQty = rows.find((row) => row.day === currentDay)?.qty ?? 0;
  const provisional = openQty > 0;
  const live = stateFromRows(product.forecast.alpha, rows, currentDay);
  const forecast =
    model.method === 'ses' && provisional
      ? Array(horizon).fill(sesState({ alpha: model.params.alpha, y, openQty }).next)
      : model.forecast;

  const { points, intervalMethod } = intervals({ ...model, forecast });
  const plan = reorder({
    forecast,
    sigma: model.sigma,
    leadTimeDays: product.leadTimeDays,
    reviewPeriodDays: product.reviewPeriodDays,
    serviceLevel: product.serviceLevel,
    currentStock: product.currentStock,
  });

  return {
    sku: product.sku,
    method: model.method,
    params: model.params,
    asOf: yesterday,
    provisional,
    confidence: confidence(y.length, model.metrics.holdout?.wape ?? null),
    ...(includeHistory
      ? { history: days.map((day, i) => ({ day, actual: y[i], fitted: model.fitted[i] })) }
      : {}),
    forecast: points.map((point, i) => ({ day: addDays(currentDay, i), ...point })),
    intervalMethod,
    metrics: model.metrics,
    leaderboard: model.leaderboard,
    reorder: {
      reorderPoint: product.reorderPointOverride ?? plan.reorderPoint,
      safetyStock: plan.safetyStock,
      suggestedOrderQty: plan.suggestedOrderQty,
      daysOfCover: plan.daysOfCover,
    },
    live: { alpha: live.alpha, next: live.next, provisional: live.openQty > 0 },
    explanation: explain({
      method: model.method,
      params: model.params,
      y,
      days,
      current: forecast[0],
      prior: model.prior ?? null,
      runnerUp: model.runnerUp ?? null,
    }),
  };
}

export function tuneAlpha(y, holdout) {
  const { leaderboard } = select(y, { holdout });
  return leaderboard.find((row) => row.method === 'ses').params.alpha;
}
