import mongoose from 'mongoose';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { round } from '../src/lib/round.js';
import { Alert } from '../src/models/Alert.js';
import { DailyDemand } from '../src/models/DailyDemand.js';
import { Product } from '../src/models/Product.js';
import { StockMovement } from '../src/models/StockMovement.js';
import { today } from '../src/services/liveForecast.js';
import { createProductDoc, loginAs, startDb } from './helpers.js';

const MOVEMENTS = '/api/v1/stock-movements';
let skuCount = 0;

describe('stock movements', () => {
  let stopDb;
  let manager;
  const app = createApp();

  const newProduct = (fields = {}) => {
    skuCount += 1;
    return createProductDoc({ sku: `T-${skuCount}`, currentStock: 100, ...fields });
  };
  const sell = (sku, qty = 1) => manager.post(MOVEMENTS).send({ sku, type: 'sale', qty });

  beforeAll(async () => {
    stopDb = await startDb();
    manager = (await loginAs(app, 'manager')).agent;
  });
  afterAll(() => stopDb());

  it('a sale decrements stock and writes ledger, demand and forecast together', async () => {
    const product = await newProduct();
    const res = await sell(product.sku, 3);
    expect(res.status).toBe(201);
    expect(res.body.movement).toMatchObject({ type: 'sale', delta: -3, unitPriceCents: 500, day: today() });
    expect(res.body.product).toMatchObject({ sku: product.sku, currentStock: 97 });
    expect(res.body.forecast).toEqual({ next: 3, provisional: true });

    const stored = await Product.findById(product._id).lean();
    expect(stored.currentStock).toBe(97);
    expect(stored.forecast).toMatchObject({ openDay: today(), openQty: 3, next: 3 });
    expect(await DailyDemand.findOne({ productId: product._id, day: today() }).lean()).toMatchObject({ qty: 3 });
    const ledger = await StockMovement.findOne({ productId: product._id }).lean();
    expect(ledger).toMatchObject({ delta: -3, requestId: expect.any(String) });
  });

  it('snapshots a supplied sale price', async () => {
    const product = await newProduct();
    const res = await manager.post(MOVEMENTS).send({ sku: product.sku, type: 'sale', qty: 1, unitPriceCents: 1 });
    expect(res.body.movement.unitPriceCents).toBe(1);
  });

  it('restock, return and adjustment take the right sign and leave demand alone', async () => {
    const product = await newProduct();
    const { sku } = product;
    const restock = await manager.post(MOVEMENTS).send({ sku, type: 'restock', qty: 10 });
    expect(restock.body.product.currentStock).toBe(110);
    const back = await manager.post(MOVEMENTS).send({ sku, type: 'return', qty: 5 });
    expect(back.body.product.currentStock).toBe(115);
    const out = await manager.post(MOVEMENTS).send({ sku, type: 'adjustment', direction: 'out', qty: 15, note: 'damaged' });
    expect(out.body.movement.delta).toBe(-15);
    expect(out.body.product.currentStock).toBe(100);
    const up = await manager.post(MOVEMENTS).send({ sku, type: 'adjustment', direction: 'in', qty: 1, note: 'found' });
    expect(up.body.product.currentStock).toBe(101);
    expect(await DailyDemand.countDocuments({ productId: product._id })).toBe(0);
  });

  it.each([
    [{ type: 'sale', qty: 0 }],
    [{ type: 'sale', qty: 1.5 }],
    [{ type: 'sale', qty: 100001 }],
    [{ type: 'nope', qty: 1 }],
    [{ type: 'adjustment', qty: 1, direction: 'in' }],
    [{ type: 'adjustment', qty: 1, note: 'x' }],
    [{ type: 'restock', qty: 1, direction: 'in' }],
    [{ type: 'restock', qty: 1, unitPriceCents: 5 }],
    [{ type: 'sale', qty: 1, at: '2020-01-01' }],
    [{ type: 'sale', qty: { $gt: 0 } }],
  ])('rejects %j', async (fields) => {
    const res = await manager.post(MOVEMENTS).send({ sku: 'ANY', ...fields });
    expect(res.status).toBe(400);
  });

  it('refuses the wrong role, no cookie, unknown SKUs and archived products', async () => {
    const product = await newProduct();
    const { agent: supplier } = await loginAs(app, 'supplier');
    expect((await supplier.post(MOVEMENTS).send({ sku: product.sku, type: 'sale', qty: 1 })).status).toBe(403);
    expect((await request(app).post(MOVEMENTS).send({ sku: product.sku, type: 'sale', qty: 1 })).status).toBe(401);
    expect((await sell('NO-SUCH')).status).toBe(404);
    const archived = await newProduct({ archived: true });
    expect((await sell(archived.sku)).status).toBe(404);
  });

  it('rejects a foreign origin and a non-JSON content type', async () => {
    const product = await newProduct();
    const foreign = await manager.post(MOVEMENTS).set('Origin', 'https://evil.test').send({ sku: product.sku, type: 'sale', qty: 1 });
    expect(foreign.status).toBe(403);
    const text = await manager.post(MOVEMENTS).set('Content-Type', 'text/plain').send('sku=x');
    expect(text.status).toBe(415);
  });

  it('insufficient stock gives 409 and changes nothing', async () => {
    const product = await newProduct({ currentStock: 2 });
    const res = await sell(product.sku, 3);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('INSUFFICIENT_STOCK');
    expect((await Product.findById(product._id).lean()).currentStock).toBe(2);
    expect(await StockMovement.countDocuments({ productId: product._id })).toBe(0);
    expect(await DailyDemand.countDocuments({ productId: product._id })).toBe(0);
  });

  it('concurrent last-unit sales give exactly one success', async () => {
    const product = await newProduct({ currentStock: 1 });
    const results = await Promise.all(Array.from({ length: 8 }, () => sell(product.sku)));
    const statuses = results.map((res) => res.status).sort();
    expect(statuses.filter((status) => status === 201)).toHaveLength(1);
    expect(statuses.filter((status) => status === 409)).toHaveLength(7);
    expect((await Product.findById(product._id).lean()).currentStock).toBe(0);
    expect(await StockMovement.countDocuments({ productId: product._id })).toBe(1);
  });

  it('concurrent sales all count when stock is enough', async () => {
    const product = await newProduct({ currentStock: 100 });
    const results = await Promise.all(Array.from({ length: 10 }, () => sell(product.sku, 2)));
    expect(results.every((res) => res.status === 201)).toBe(true);
    const stored = await Product.findById(product._id).lean();
    expect(stored.currentStock).toBe(80);
    expect(stored.forecast.openQty).toBe(20);
    expect((await DailyDemand.findOne({ productId: product._id }).lean()).qty).toBe(20);
  });

  describe('idempotency', () => {
    const keyed = (sku, key) => manager.post(MOVEMENTS).set('Idempotency-Key', key).send({ sku, type: 'sale', qty: 1 });

    it('replays the first result with a 200', async () => {
      const product = await newProduct();
      const first = await keyed(product.sku, 'key-replay');
      const second = await keyed(product.sku, 'key-replay');
      expect(first.status).toBe(201);
      expect(second.status).toBe(200);
      expect(second.body.movement.id).toBe(first.body.movement.id);
      expect((await Product.findById(product._id).lean()).currentStock).toBe(99);
      expect(await StockMovement.countDocuments({ productId: product._id })).toBe(1);
    });

    it('applies once when raced', async () => {
      const product = await newProduct();
      const results = await Promise.all(Array.from({ length: 5 }, () => keyed(product.sku, 'key-race')));
      expect(results.filter((res) => res.status === 201)).toHaveLength(1);
      expect(results.every((res) => res.status === 201 || res.status === 200)).toBe(true);
      expect((await Product.findById(product._id).lean()).currentStock).toBe(99);
    });

    it('rejects a malformed key', async () => {
      const product = await newProduct();
      expect((await keyed(product.sku, 'bad key!')).status).toBe(400);
    });
  });

  describe('alerts', () => {
    it('opens once when stock crosses the reorder point and resolves once on restock', async () => {
      const product = await newProduct({ currentStock: 12, reorderPointOverride: 10, reorderPoint: 10 });
      const { sku } = product;
      const productAlerts = () => Alert.find({ productId: product._id }).lean();

      await sell(sku, 1);
      expect(await productAlerts()).toHaveLength(0);
      await sell(sku, 1);
      await sell(sku, 1);
      await sell(sku, 1);
      const open = await productAlerts();
      expect(open).toHaveLength(1);
      expect(open[0]).toMatchObject({ status: 'open', stockAtOpen: 10, reorderPointAtOpen: 10 });

      await manager.post(MOVEMENTS).send({ sku, type: 'restock', qty: 50 });
      await manager.post(MOVEMENTS).send({ sku, type: 'restock', qty: 50 });
      const resolved = await productAlerts();
      expect(resolved).toHaveLength(1);
      expect(resolved[0].status).toBe('resolved');
      expect(resolved[0].resolvedAt).toBeInstanceOf(Date);
    });

    it('stays at one open alert under concurrency', async () => {
      const product = await newProduct({ currentStock: 20, reorderPointOverride: 15, reorderPoint: 15 });
      await Promise.all(Array.from({ length: 10 }, () => sell(product.sku)));
      expect(await Alert.countDocuments({ productId: product._id, status: 'open' })).toBe(1);
    });
  });

  describe('live forecast', () => {
    it('does not read daily demand on the write path', async () => {
      const product = await newProduct();
      const operations = [];
      mongoose.set('debug', (collection, method) => operations.push(`${collection}.${method}`));
      await sell(product.sku, 2);
      mongoose.set('debug', false);
      const demandOps = operations.filter((op) => op.startsWith('dailydemands'));
      expect(demandOps).toEqual(['dailydemands.updateOne']);
    });

    it('the next GET /forecast agrees with the live state', async () => {
      const product = await newProduct();
      await sell(product.sku, 4);
      await sell(product.sku, 6);
      const stored = await Product.findById(product._id).lean();
      const { body } = await manager.get(`/api/v1/forecast/${product.sku}`);
      expect(body.provisional).toBe(true);
      expect(body.live).toEqual({ alpha: 0.3, next: round(stored.forecast.next), provisional: true });
      const after = await Product.findById(product._id).lean();
      expect(after.forecast.next).toBe(stored.forecast.next);
      expect(after.forecast.updatedAt).toEqual(stored.forecast.updatedAt);
    });
  });
});
