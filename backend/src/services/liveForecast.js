import mongoose from 'mongoose';
import { reorder, sesState } from '@inventory/forecast';
import { config } from '../config.js';
import { addDays, dayKey, range } from '../lib/days.js';
import { DailyDemand } from '../models/DailyDemand.js';
import { Product } from '../models/Product.js';
import { StockMovement } from '../models/StockMovement.js';
import { syncAlert } from './alerts.js';

export const LIVE_LOOKBACK_DAYS = 180;

export const today = () => dayKey(new Date(), config.STORE_TZ);

// Zero-filled from the first sale, so the days before a product existed never count as no demand.
export function closedSeries(rows, from, to) {
  const byDay = new Map(rows.map((row) => [row.day, row.qty]));
  const closed = rows.filter((row) => row.day >= from && row.day <= to).map((row) => row.day);
  if (closed.length === 0) return { days: [], y: [] };
  const days = range(closed.reduce((a, b) => (a < b ? a : b)), to);
  return { days, y: days.map((day) => byDay.get(day) ?? 0) };
}

export function stateFromRows(alpha, rows, currentDay) {
  const yesterday = addDays(currentDay, -1);
  const { y } = closedSeries(rows, addDays(currentDay, -LIVE_LOOKBACK_DAYS), yesterday);
  const openQty = rows.find((row) => row.day === currentDay)?.qty ?? 0;
  const hasHistory = y.length > 0;
  return sesState({
    alpha,
    y,
    lastClosedDay: hasHistory ? yesterday : null,
    openDay: hasHistory || openQty > 0 ? currentDay : null,
    openQty,
  });
}

export function liveReorder(product, state) {
  return reorder({
    forecast: [state.next],
    sigma: Math.sqrt(state.mse),
    leadTimeDays: product.leadTimeDays,
    reviewPeriodDays: product.reviewPeriodDays,
    serviceLevel: product.serviceLevel,
    currentStock: product.currentStock,
  });
}

export function effectiveReorderPoint(product, state) {
  return product.reorderPointOverride ?? liveReorder(product, state).reorderPoint;
}

// The deck's aggregation pipeline. Safe to re-run: $merge replaces each product/day row.
export async function rebuildDailyDemand() {
  await StockMovement.aggregate([
    { $match: { type: 'sale' } },
    {
      $group: {
        _id: {
          productId: '$productId',
          day: { $dateToString: { format: '%Y-%m-%d', date: '$at', timezone: config.STORE_TZ } },
        },
        qty: { $sum: { $multiply: ['$delta', -1] } },
      },
    },
    { $project: { _id: 0, productId: '$_id.productId', day: '$_id.day', qty: 1 } },
    { $merge: { into: 'dailydemands', on: ['productId', 'day'], whenMatched: 'replace', whenNotMatched: 'insert' } },
  ]);
}

export async function rebuildLiveStates() {
  const currentDay = today();
  const products = await Product.find({ archived: false }).lean();
  const rows = await DailyDemand.find({
    productId: mongoose.trusted({ $in: products.map((product) => product._id) }),
    day: mongoose.trusted({ $gte: addDays(currentDay, -LIVE_LOOKBACK_DAYS) }),
  })
    .select('productId day qty')
    .lean();
  const rowsByProduct = Map.groupBy(rows, (row) => String(row.productId));
  const updatedAt = new Date();

  await Product.bulkWrite(
    products.map((product) => {
      const state = stateFromRows(product.forecast.alpha, rowsByProduct.get(String(product._id)) ?? [], currentDay);
      product.reorderPoint = effectiveReorderPoint(product, state);
      return {
        updateOne: {
          filter: { _id: product._id },
          update: { $set: { forecast: { ...state, updatedAt }, reorderPoint: product.reorderPoint } },
        },
      };
    }),
  );
  await Promise.all(products.map((product) => syncAlert(product)));
  return products.length;
}
