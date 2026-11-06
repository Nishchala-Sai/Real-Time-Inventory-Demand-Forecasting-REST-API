import { Router } from 'express';
import mongoose from 'mongoose';
import { z } from 'zod';
import { ApiError } from '../lib/errors.js';
import { publish } from '../lib/events.js';
import { round } from '../lib/round.js';
import { addDays } from '../lib/days.js';
import { requireRole } from '../middleware/auth.js';
import { writeLimit } from '../middleware/rateLimits.js';
import { validate } from '../middleware/validate.js';
import { Product } from '../models/Product.js';
import { buildForecast, loadRows, tuneAlpha } from '../services/forecast.js';
import { closedSeries, LIVE_LOOKBACK_DAYS, resyncLiveState, today } from '../services/liveForecast.js';
import { findProduct, scopeFor } from '../services/products.js';
import { sku } from './products.js';

const MAX_BATCH = 50;
const MIN_TUNE_EXTRA_DAYS = 7;
const unit = z.coerce.number().min(0.01).max(0.99);

const whatIf = {
  method: z.enum(['auto', 'sma', 'ses', 'holt', 'croston']).optional(),
  alpha: unit.optional(),
  beta: unit.optional(),
  window: z.coerce.number().int().min(1).max(60).optional(),
  horizon: z.coerce.number().int().min(1).max(90).optional(),
  holdout: z.coerce.number().int().min(0).max(60).optional(),
  lookback: z.coerce.number().int().min(14).max(730).optional(),
};
const skuParams = z.strictObject({ sku });
const singleQuery = z.strictObject(whatIf);
const batchQuery = z.strictObject({
  ...whatIf,
  skus: z
    .string()
    .transform((list) => list.split(','))
    .pipe(z.array(sku).min(1).max(MAX_BATCH)),
});
const tuneBody = z.strictObject({
  alpha: z.number().min(0.01).max(0.99).optional(),
  holdout: z.number().int().min(0).max(60).default(14),
});

export const forecastRoutes = Router();
const anyRole = requireRole('admin', 'manager', 'supplier');

forecastRoutes.get('/forecast', anyRole, validate({ query: batchQuery }), async (req, res) => {
  const { skus, ...query } = req.valid.query;
  const products = await Product.find({
    sku: mongoose.trusted({ $in: skus }),
    archived: false,
    ...scopeFor(req.user),
  }).lean();
  const currentDay = today();
  const rows = await loadRows(products.map((product) => product._id), currentDay, query.lookback);
  const byProduct = Map.groupBy(rows, (row) => String(row.productId));
  const items = await Promise.all(
    products.map((product) =>
      buildForecast(product, byProduct.get(String(product._id)) ?? [], query, { includeHistory: false }),
    ),
  );
  res.json({ items: round(items) });
});

forecastRoutes.get('/forecast/:sku', anyRole, validate({ params: skuParams, query: singleQuery }), async (req, res) => {
  const product = await findProduct(req.valid.params.sku, req.user);
  const rows = await loadRows([product._id], today(), req.valid.query.lookback);
  await resyncLiveState(product, rows);
  res.json(round(await buildForecast(product, rows, req.valid.query)));
});

forecastRoutes.post(
  '/forecast/:sku/tune',
  requireRole('admin', 'manager'),
  writeLimit,
  validate({ params: skuParams, body: tuneBody }),
  async (req, res) => {
    const product = await findProduct(req.valid.params.sku, req.user);
    const currentDay = today();
    const rows = await loadRows([product._id], currentDay);
    const { y } = closedSeries(rows, addDays(currentDay, -LIVE_LOOKBACK_DAYS), addDays(currentDay, -1));
    const { alpha: chosen, holdout } = req.valid.body;
    if (chosen === undefined && (y.length < holdout + MIN_TUNE_EXTRA_DAYS || holdout >= y.length / 2)) {
      throw new ApiError('CONFLICT', 'Not enough sales history to tune this product yet');
    }
    const alpha = chosen ?? tuneAlpha(y, holdout);
    product.forecast = { ...product.forecast, alpha };
    const state = await resyncLiveState(product, rows, { force: true });
    publish('forecast.updated', product, { next: state.next, provisional: state.openQty > 0 });
    res.json(round({ sku: product.sku, alpha, next: state.next, reorderPoint: product.reorderPoint }));
  },
);
