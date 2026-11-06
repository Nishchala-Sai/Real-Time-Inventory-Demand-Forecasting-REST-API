import mongoose from 'mongoose';
import { sesAdvance } from '@inventory/forecast';
import { config } from '../config.js';
import { dayKey } from '../lib/days.js';
import { ApiError } from '../lib/errors.js';
import { publish } from '../lib/events.js';
import { stockView } from '../lib/views.js';
import { DailyDemand } from '../models/DailyDemand.js';
import { Product } from '../models/Product.js';
import { StockMovement } from '../models/StockMovement.js';
import { publishAlertChange, syncAlert } from './alerts.js';
import { effectiveReorderPoint } from './liveForecast.js';

const MONGO_DUPLICATE_KEY = 11000;

function deltaFor({ type, qty, direction }) {
  if (type === 'sale') return -qty;
  if (type === 'adjustment') return direction === 'out' ? -qty : qty;
  return qty;
}

const liveView = (forecast) => ({ next: forecast.next, provisional: forecast.openQty > 0 });

async function replay(key) {
  const movement = await StockMovement.findOne({ idempotencyKey: key }).lean();
  const product = await Product.findById(movement.productId).lean();
  return { replayed: true, movement, product, forecast: liveView(product.forecast) };
}

async function applyMovement(input, context, session) {
  const { sku, type, qty, note, unitPriceCents } = input;
  const delta = deltaFor(input);
  const product = await Product.findOneAndUpdate(
    { sku, archived: false, ...(delta < 0 ? { currentStock: mongoose.trusted({ $gte: -delta }) } : {}) },
    { $inc: { currentStock: delta } },
    { returnDocument: 'after', session },
  ).lean();
  if (!product) {
    const exists = await Product.exists({ sku, archived: false }).session(session);
    if (!exists) throw new ApiError('NOT_FOUND', 'Product not found');
    throw new ApiError('INSUFFICIENT_STOCK', 'Not enough stock for this movement');
  }

  const at = new Date();
  const day = dayKey(at, config.STORE_TZ);
  const [movement] = await StockMovement.create(
    [
      {
        productId: product._id,
        type,
        delta,
        unitPriceCents: type === 'sale' ? (unitPriceCents ?? product.unitPriceCents) : undefined,
        at,
        day,
        userId: context.userId,
        note,
        idempotencyKey: context.idempotencyKey,
        requestId: context.requestId,
      },
    ],
    { session },
  );

  if (type === 'sale') {
    await DailyDemand.updateOne({ productId: product._id, day }, { $inc: { qty } }, { upsert: true, session });
    product.forecast = { ...sesAdvance(product.forecast, day, qty), updatedAt: at };
  }
  product.reorderPoint = effectiveReorderPoint(product, product.forecast);
  await Product.updateOne(
    { _id: product._id },
    { $set: { forecast: product.forecast, reorderPoint: product.reorderPoint } },
    { session },
  );
  const alert = await syncAlert(product, session);
  return { movement, product, alert };
}

export async function recordMovement(input, context) {
  const { idempotencyKey } = context;
  let outcome;
  try {
    await mongoose.connection.transaction(async (session) => {
      outcome = null;
      if (idempotencyKey && (await StockMovement.exists({ idempotencyKey }).session(session))) return;
      outcome = await applyMovement(input, context, session);
    });
  } catch (error) {
    // Two requests racing with one key: the loser reports what the winner recorded.
    if (error.code === MONGO_DUPLICATE_KEY && idempotencyKey) return replay(idempotencyKey);
    throw error;
  }
  if (!outcome) return replay(idempotencyKey);

  // Only after commit: the transaction callback can run more than once.
  const { movement, product, alert } = outcome;
  publish('stock.updated', product, stockView(product));
  if (input.type === 'sale') publish('forecast.updated', product, liveView(product.forecast));
  publishAlertChange(alert, product);
  return { replayed: false, movement, product, forecast: liveView(product.forecast) };
}

export async function createProduct(fields, initialStock, context) {
  let product;
  let alert;
  await mongoose.connection.transaction(async (session) => {
    const [created] = await Product.create(
      [{ ...fields, currentStock: initialStock, reorderPoint: fields.reorderPointOverride ?? 0 }],
      { session },
    );
    if (initialStock > 0) {
      const at = new Date();
      await StockMovement.create(
        [
          {
            productId: created._id,
            type: 'restock',
            delta: initialStock,
            at,
            day: dayKey(at, config.STORE_TZ),
            userId: context.userId,
            note: 'initial',
            requestId: context.requestId,
          },
        ],
        { session },
      );
    }
    product = created;
    alert = await syncAlert(created, session);
  });
  publish('stock.updated', product, stockView(product));
  publishAlertChange(alert, product);
  return product;
}
