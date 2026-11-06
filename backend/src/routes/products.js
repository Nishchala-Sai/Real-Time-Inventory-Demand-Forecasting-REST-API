import { Router } from 'express';
import mongoose from 'mongoose';
import { z } from 'zod';
import { addDays, range } from '../lib/days.js';
import { ApiError } from '../lib/errors.js';
import { publish } from '../lib/events.js';
import { movementView, page, productView, stockView } from '../lib/views.js';
import { requireRole } from '../middleware/auth.js';
import { writeLimit } from '../middleware/rateLimits.js';
import { limit, objectId, validate } from '../middleware/validate.js';
import { DailyDemand } from '../models/DailyDemand.js';
import { Product } from '../models/Product.js';
import { StockMovement } from '../models/StockMovement.js';
import { Supplier } from '../models/Supplier.js';
import { publishAlertChange, syncAlert } from '../services/alerts.js';
import { createProduct } from '../services/inventory.js';
import { effectiveReorderPoint, today } from '../services/liveForecast.js';
import { findProduct, listProducts } from '../services/products.js';

const MAX_SALES_DAYS = 730;
const DEFAULT_SALES_DAYS = 90;
const CURSOR = /^\d+_[0-9a-fA-F]{24}$/;

export const sku = z.string().regex(/^[A-Z0-9-]{2,32}$/, 'must be 2-32 characters of A-Z, 0-9 or -');
const skuParams = z.strictObject({ sku });
const dayString = z.iso.date();

const editable = {
  name: z.string().trim().min(1).max(120),
  category: z.string().trim().min(1).max(60),
  unitPriceCents: z.number().int().min(0),
  leadTimeDays: z.number().int().min(1).max(365),
  reviewPeriodDays: z.number().int().min(1).max(90),
  serviceLevel: z.union([z.literal(0.9), z.literal(0.95), z.literal(0.975), z.literal(0.99)]),
  reorderPointOverride: z.number().int().min(0).nullable(),
  supplierId: objectId.nullable(),
};

const createBody = z.strictObject({
  ...editable,
  sku,
  leadTimeDays: editable.leadTimeDays.optional(),
  reviewPeriodDays: editable.reviewPeriodDays.optional(),
  serviceLevel: editable.serviceLevel.optional(),
  reorderPointOverride: editable.reorderPointOverride.optional(),
  supplierId: objectId.optional(),
  initialStock: z.number().int().min(0).max(100000).default(0),
});
const patchBody = z.strictObject(editable).partial();

const listQuery = z.strictObject({
  status: z.enum(['low', 'ok']).optional(),
  category: z.string().min(1).max(60).optional(),
  q: z.string().min(1).max(60).optional(),
  limit,
  after: sku.optional(),
});
const salesQuery = z
  .strictObject({ from: dayString.optional(), to: dayString.optional() })
  .refine(({ from, to }) => !from || !to || from <= to, 'from must not be after to');
const movementsQuery = z.strictObject({ limit, after: z.string().regex(CURSOR).optional() });

async function assertSupplierExists(supplierId) {
  if (supplierId && !(await Supplier.exists({ _id: supplierId }))) {
    throw new ApiError('VALIDATION_ERROR', 'That supplier does not exist');
  }
}

export const productRoutes = Router();
const anyRole = requireRole('admin', 'manager', 'supplier');

productRoutes.get('/products', anyRole, validate({ query: listQuery }), async (req, res) => {
  const rows = await listProducts(req.user, req.valid.query);
  res.json(page(rows, req.valid.query.limit, (product) => product.sku, productView));
});

productRoutes.get('/products/:sku', anyRole, validate({ params: skuParams }), async (req, res) => {
  res.json({ product: productView(await findProduct(req.valid.params.sku, req.user)) });
});

productRoutes.post('/products', requireRole('admin'), writeLimit, validate({ body: createBody }), async (req, res) => {
  const { initialStock, ...fields } = req.valid.body;
  await assertSupplierExists(fields.supplierId);
  const product = await createProduct(fields, initialStock, { userId: req.user.id, requestId: req.id });
  res.status(201).json({ product: productView(product) });
});

productRoutes.patch(
  '/products/:sku',
  requireRole('admin', 'manager'),
  writeLimit,
  validate({ params: skuParams, body: patchBody }),
  async (req, res) => {
    await assertSupplierExists(req.valid.body.supplierId);
    const product = await Product.findOne({ sku: req.valid.params.sku, archived: false });
    if (!product) throw new ApiError('NOT_FOUND', 'Product not found');
    product.set(req.valid.body);
    product.reorderPoint = effectiveReorderPoint(product, product.forecast);
    await product.save();
    const alert = await syncAlert(product);
    publish('stock.updated', product, stockView(product));
    publishAlertChange(alert, product);
    res.json({ product: productView(product) });
  },
);

productRoutes.delete('/products/:sku', requireRole('admin'), writeLimit, validate({ params: skuParams }), async (req, res) => {
  const { matchedCount } = await Product.updateOne({ sku: req.valid.params.sku, archived: false }, { archived: true });
  if (matchedCount === 0) throw new ApiError('NOT_FOUND', 'Product not found');
  res.status(204).end();
});

productRoutes.get('/products/:sku/sales', anyRole, validate({ params: skuParams, query: salesQuery }), async (req, res) => {
  const product = await findProduct(req.valid.params.sku, req.user);
  const to = req.valid.query.to ?? today();
  const from = req.valid.query.from ?? addDays(to, 1 - DEFAULT_SALES_DAYS);
  if (from < addDays(to, 1 - MAX_SALES_DAYS)) {
    throw new ApiError('VALIDATION_ERROR', `The range cannot exceed ${MAX_SALES_DAYS} days`);
  }
  const rows = await DailyDemand.find({
    productId: product._id,
    day: mongoose.trusted({ $gte: from, $lte: to }),
  })
    .select('day qty')
    .lean();
  const byDay = new Map(rows.map((row) => [row.day, row.qty]));
  res.json({ sku: product.sku, items: range(from, to).map((day) => ({ day, qty: byDay.get(day) ?? 0 })) });
});

productRoutes.get(
  '/products/:sku/movements',
  requireRole('admin', 'manager'),
  validate({ params: skuParams, query: movementsQuery }),
  async (req, res) => {
    const product = await findProduct(req.valid.params.sku, req.user);
    const { limit: size, after } = req.valid.query;
    const filter = { productId: product._id };
    if (after) {
      const [ms, id] = after.split('_');
      const at = new Date(Number(ms));
      filter.$or = [
        { at: mongoose.trusted({ $lt: at }) },
        { at, _id: mongoose.trusted({ $lt: id }) },
      ];
    }
    const rows = await StockMovement.find(filter).sort({ at: -1, _id: -1 }).limit(size + 1).lean();
    res.json(page(rows, size, (row) => `${row.at.getTime()}_${row._id}`, movementView));
  },
);
