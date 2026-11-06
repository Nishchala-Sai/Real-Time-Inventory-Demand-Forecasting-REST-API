import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { Product } from '../src/models/Product.js';
import { StockMovement } from '../src/models/StockMovement.js';
import { Supplier } from '../src/models/Supplier.js';
import { seedDatabase } from '../scripts/seed.js';
import { loginAs, startDb } from './helpers.js';

const PRODUCTS = '/api/v1/products';

describe('products', () => {
  let stopDb;
  let admin;
  let manager;
  let supplier;
  let ownSku;
  let foreignSku;
  const app = createApp();

  beforeAll(async () => {
    stopDb = await startDb();
    await seedDatabase();
    admin = (await loginAs(app, 'admin')).agent;
    manager = (await loginAs(app, 'manager')).agent;
    const northwind = await Supplier.findOne({ name: 'Northwind Components' }).lean();
    supplier = (await loginAs(app, 'supplier', { supplierId: northwind._id })).agent;
    ownSku = (await Product.findOne({ supplierId: northwind._id }).lean()).sku;
    foreignSku = 'P103';
  });
  afterAll(() => stopDb());

  it('lists with status and days of cover, and pages by SKU', async () => {
    const first = await manager.get(`${PRODUCTS}?limit=4`);
    expect(first.status).toBe(200);
    expect(first.body.items).toHaveLength(4);
    expect(first.body.items[0]).toMatchObject({ sku: 'P101', status: expect.stringMatching(/low|ok/) });
    expect(first.body.items[0].daysOfCover).toEqual(expect.any(Number));
    expect(first.body.next).toBe('P104');
    const second = await manager.get(`${PRODUCTS}?limit=100&after=${first.body.next}`);
    expect(second.body.items[0].sku).toBe('P105');
    expect(second.body.next).toBeNull();
  });

  it('filters by status, category and prefix', async () => {
    const low = await manager.get(`${PRODUCTS}?status=low`);
    expect(low.body.items.length).toBeGreaterThan(0);
    expect(low.body.items.every((item) => item.status === 'low')).toBe(true);
    const ok = await manager.get(`${PRODUCTS}?status=ok`);
    expect(ok.body.items.every((item) => item.status === 'ok')).toBe(true);
    const displays = await manager.get(`${PRODUCTS}?category=displays`);
    expect(displays.body.items.every((item) => item.category === 'displays')).toBe(true);
    expect((await manager.get(`${PRODUCTS}?q=mech`)).body.items.map((item) => item.sku)).toEqual(['P101']);
    expect((await manager.get(`${PRODUCTS}?q=p10`)).body.items.length).toBeGreaterThan(5);
    expect((await manager.get(`${PRODUCTS}?q=${encodeURIComponent('.*')}`)).body.items).toEqual([]);
  });

  it('rejects unknown keys and injection attempts', async () => {
    expect((await manager.get(`${PRODUCTS}?nope=1`)).status).toBe(400);
    expect((await manager.get(`${PRODUCTS}?limit=1000`)).status).toBe(400);
    expect((await manager.get(`${PRODUCTS}?category[$gt]=`)).status).toBe(400);
    expect((await manager.get(`${PRODUCTS}/${encodeURIComponent('{"$gt":""}')}`)).status).toBe(400);
    expect((await manager.get(`${PRODUCTS}/lowercase`)).status).toBe(400);
  });

  it('scopes suppliers to their own products with a 404 otherwise', async () => {
    const list = await supplier.get(PRODUCTS);
    expect(list.body.items.length).toBeGreaterThan(0);
    expect(list.body.items.map((item) => item.sku)).not.toContain(foreignSku);
    expect((await supplier.get(`${PRODUCTS}/${ownSku}`)).status).toBe(200);
    expect((await supplier.get(`${PRODUCTS}/${foreignSku}`)).status).toBe(404);
    expect((await supplier.get(`${PRODUCTS}/${foreignSku}/sales`)).status).toBe(404);
  });

  it('creates a product and records initial stock in the ledger', async () => {
    const res = await admin.post(PRODUCTS).send({
      sku: 'NEW-1',
      name: 'New Thing',
      category: 'accessories',
      unitPriceCents: 1000,
      initialStock: 25,
    });
    expect(res.status).toBe(201);
    expect(res.body.product).toMatchObject({ sku: 'NEW-1', currentStock: 25, status: 'ok' });
    const product = await Product.findOne({ sku: 'NEW-1' }).lean();
    const [movement] = await StockMovement.find({ productId: product._id }).lean();
    expect(movement).toMatchObject({ type: 'restock', delta: 25, note: 'initial' });
  });

  it('refuses a duplicate SKU, a bad body, a ghost supplier and the wrong role', async () => {
    const base = { name: 'X', category: 'c', unitPriceCents: 1 };
    expect((await admin.post(PRODUCTS).send({ ...base, sku: 'P101' })).status).toBe(409);
    expect((await admin.post(PRODUCTS).send({ ...base, sku: 'bad sku' })).status).toBe(400);
    expect((await admin.post(PRODUCTS).send({ ...base, sku: 'P900', currentStock: 5 })).status).toBe(400);
    expect((await admin.post(PRODUCTS).send({ ...base, sku: 'P901', supplierId: '0'.repeat(24) })).status).toBe(400);
    expect((await manager.post(PRODUCTS).send({ ...base, sku: 'P902' })).status).toBe(403);
    expect((await request(app).get(PRODUCTS)).status).toBe(401);
  });

  it('edits metadata but rejects sku and currentStock', async () => {
    const res = await manager.patch(`${PRODUCTS}/P102`).send({ name: 'Renamed Mouse', leadTimeDays: 10 });
    expect(res.status).toBe(200);
    expect(res.body.product).toMatchObject({ name: 'Renamed Mouse', leadTimeDays: 10 });
    const stock = await manager.patch(`${PRODUCTS}/P102`).send({ currentStock: 1 });
    expect(stock.status).toBe(400);
    expect((await manager.patch(`${PRODUCTS}/P102`).send({ sku: 'P999' })).status).toBe(400);
    expect((await supplier.patch(`${PRODUCTS}/${ownSku}`).send({ name: 'Mine' })).status).toBe(403);
    expect((await manager.patch(`${PRODUCTS}/P999`).send({ name: 'Ghost' })).status).toBe(404);
  });

  it('applies a reorder point override and resyncs the alert', async () => {
    const raised = await manager.patch(`${PRODUCTS}/P108`).send({ reorderPointOverride: 100000 });
    expect(raised.body.product).toMatchObject({ reorderPoint: 100000, status: 'low' });
    const alerts = await manager.get('/api/v1/alerts?status=open&limit=100');
    expect(alerts.body.items.map((alert) => alert.sku)).toContain('P108');
    const cleared = await manager.patch(`${PRODUCTS}/P108`).send({ reorderPointOverride: null });
    expect(cleared.body.product.reorderPointOverride).toBeNull();
    expect(cleared.body.product.status).toBe('ok');
    const resolved = await manager.get('/api/v1/alerts?status=resolved&limit=100');
    expect(resolved.body.items.map((alert) => alert.sku)).toContain('P108');
  });

  it('soft deletes', async () => {
    const res = await admin.delete(`${PRODUCTS}/P109`).set('Content-Type', 'application/json');
    expect(res.status).toBe(204);
    expect((await manager.get(`${PRODUCTS}/P109`)).status).toBe(404);
    expect((await Product.findOne({ sku: 'P109' }).lean()).archived).toBe(true);
    expect((await admin.delete(`${PRODUCTS}/P109`).set('Content-Type', 'application/json')).status).toBe(404);
    expect((await manager.delete(`${PRODUCTS}/P110`).set('Content-Type', 'application/json')).status).toBe(403);
  });

  describe('sales', () => {
    it('fills gaps with zero and honours the range', async () => {
      const res = await manager.get(`${PRODUCTS}/P103/sales?from=2020-01-01&to=2020-01-05`);
      expect(res.body.items).toEqual([
        { day: '2020-01-01', qty: 0 },
        { day: '2020-01-02', qty: 0 },
        { day: '2020-01-03', qty: 0 },
        { day: '2020-01-04', qty: 0 },
        { day: '2020-01-05', qty: 0 },
      ]);
      const recent = await manager.get(`${PRODUCTS}/P101/sales`);
      expect(recent.body.items).toHaveLength(90);
      expect(recent.body.items.some((item) => item.qty > 0)).toBe(true);
    });

    it('rejects long or backwards ranges and bad dates', async () => {
      expect((await manager.get(`${PRODUCTS}/P101/sales?from=2020-01-01&to=2026-01-01`)).status).toBe(400);
      expect((await manager.get(`${PRODUCTS}/P101/sales?from=2026-01-02&to=2026-01-01`)).status).toBe(400);
      expect((await manager.get(`${PRODUCTS}/P101/sales?from=not-a-date`)).status).toBe(400);
    });
  });

  describe('movements', () => {
    it('returns the ledger newest first and pages through it', async () => {
      const first = await manager.get(`${PRODUCTS}/P101/movements?limit=2`);
      expect(first.body.items).toHaveLength(2);
      expect(new Date(first.body.items[0].at).getTime()).toBeGreaterThan(new Date(first.body.items[1].at).getTime());
      const second = await manager.get(`${PRODUCTS}/P101/movements?limit=2&after=${first.body.next}`);
      expect(new Date(second.body.items[0].at).getTime()).toBeLessThan(new Date(first.body.items[1].at).getTime());
    });

    it('is closed to suppliers and validates the cursor', async () => {
      expect((await supplier.get(`${PRODUCTS}/${ownSku}/movements`)).status).toBe(403);
      expect((await manager.get(`${PRODUCTS}/P101/movements?after=garbage`)).status).toBe(400);
    });
  });

  describe('alerts', () => {
    it('lists, filters, pages and scopes', async () => {
      const open = await manager.get('/api/v1/alerts?status=open&limit=1');
      expect(open.status).toBe(200);
      expect(open.body.items[0]).toMatchObject({ type: 'low_stock', status: 'open', sku: expect.any(String) });
      if (open.body.next) {
        const next = await manager.get(`/api/v1/alerts?status=open&limit=1&after=${open.body.next}`);
        expect(next.status).toBe(200);
        expect(next.body.items[0].id).not.toBe(open.body.items[0].id);
      }
      const scoped = await supplier.get('/api/v1/alerts?limit=100');
      expect(scoped.body.items.map((alert) => alert.sku)).not.toContain(foreignSku);
      expect((await manager.get('/api/v1/alerts?status=nope')).status).toBe(400);
      expect((await request(app).get('/api/v1/alerts')).status).toBe(401);
    });
  });
});
