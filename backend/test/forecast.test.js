import request from 'supertest';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app.js';
import { addDays } from '../src/lib/days.js';
import { DailyDemand } from '../src/models/DailyDemand.js';
import { Product } from '../src/models/Product.js';
import { Supplier } from '../src/models/Supplier.js';
import { today } from '../src/services/liveForecast.js';
import { seedDatabase } from '../scripts/seed.js';
import { loginAs, startDb } from './helpers.js';

const FORECAST = '/api/v1/forecast';

describe('forecast', () => {
  let stopDb;
  let manager;
  let supplier;
  const app = createApp();

  beforeAll(async () => {
    stopDb = await startDb();
    await seedDatabase();
    manager = (await loginAs(app, 'manager')).agent;
    const northwind = await Supplier.findOne({ name: 'Northwind Components' }).lean();
    supplier = (await loginAs(app, 'supplier', { supplierId: northwind._id })).agent;
  });
  afterAll(() => stopDb());
  afterEach(() => vi.useRealTimers());

  it('matches the documented response shape', async () => {
    const { status, body } = await manager.get(`${FORECAST}/P102`);
    expect(status).toBe(200);
    expect(body).toMatchObject({
      sku: 'P102',
      method: expect.any(String),
      params: expect.any(Object),
      asOf: addDays(today(), -1),
      provisional: false,
      confidence: expect.stringMatching(/low|medium|high/),
      metrics: { holdout: { mae: expect.any(Number), rmse: expect.any(Number), bias: expect.any(Number), n: 14 } },
      reorder: {
        reorderPoint: expect.any(Number),
        safetyStock: expect.any(Number),
        suggestedOrderQty: expect.any(Number),
        daysOfCover: expect.any(Number),
      },
      explanation: { summary: expect.stringContaining('Expect about'), notes: expect.any(Array) },
    });
    expect(body.history).toHaveLength(120);
    expect(body.history.at(-1)).toEqual({ day: expect.any(String), actual: expect.any(Number), fitted: expect.any(Number) });
    expect(body.forecast).toHaveLength(7);
    expect(body.forecast[0]).toEqual({ day: today(), value: expect.any(Number), lower: expect.any(Number), upper: expect.any(Number) });
    expect(body.leaderboard[0]).toMatchObject({ method: expect.any(String), params: expect.any(Object), mae: expect.any(Number) });
    expect(String(body.forecast[0].value).split('.')[1]?.length ?? 0).toBeLessThanOrEqual(2);
  });

  it('auto-selects Holt on the trending product, with less bias than SES', async () => {
    const { body } = await manager.get(`${FORECAST}/P101`);
    expect(body.method).toBe('holt');
    const byMethod = Object.fromEntries(body.leaderboard.map((row) => [row.method, row]));
    expect(Math.abs(byMethod.holt.bias)).toBeLessThan(Math.abs(byMethod.ses.bias));
    expect(byMethod.ses.bias).toBeLessThan(0);
  });

  it('offers Croston for intermittent demand', async () => {
    const { body } = await manager.get(`${FORECAST}/P103`);
    expect(body.leaderboard.map((row) => row.method)).toContain('croston');
  });

  it('gives the cold-start product low confidence and a non-zero prior-based forecast', async () => {
    const { body } = await manager.get(`${FORECAST}/P110`);
    expect(body.method).toBe('coldstart');
    expect(body.confidence).toBe('low');
    expect(body.history).toHaveLength(5);
    expect(body.forecast[0].value).toBeGreaterThan(0);
    expect(body.metrics.holdout).toBeNull();
    expect(body.explanation.notes.join(' ')).toContain('category average');

    const own = await manager.get(`${FORECAST}/P110?method=sma&window=3`);
    expect(body.forecast[0].value).toBeGreaterThan(own.body.forecast[0].value);
  });

  it('overrides for what-if exploration without persisting', async () => {
    const before = await Product.findOne({ sku: 'P102' }).lean();
    const ses = await manager.get(`${FORECAST}/P102?method=ses&alpha=0.8&horizon=30`);
    expect(ses.body).toMatchObject({ method: 'ses', params: { alpha: 0.8 } });
    expect(ses.body.forecast).toHaveLength(30);
    expect(ses.body.leaderboard).toEqual([]);
    expect((await manager.get(`${FORECAST}/P102?alpha=0.5`)).body.method).toBe('ses');
    expect((await manager.get(`${FORECAST}/P102?window=7`)).body).toMatchObject({ method: 'sma', params: { window: 7 } });
    expect((await manager.get(`${FORECAST}/P102?beta=0.2`)).body).toMatchObject({ method: 'holt', params: { alpha: 0.3, beta: 0.2 } });
    expect((await manager.get(`${FORECAST}/P103?method=croston`)).body.method).toBe('croston');
    expect((await manager.get(`${FORECAST}/P102?lookback=30`)).body.history).toHaveLength(30);
    expect((await Product.findOne({ sku: 'P102' }).lean()).forecast.alpha).toBe(before.forecast.alpha);
  });

  it.each([
    ['alpha=2'],
    ['beta=0'],
    ['window=61'],
    ['horizon=91'],
    ['holdout=61'],
    ['lookback=13'],
    ['method=magic'],
    ['extra=1'],
    ['holdout=60'],
    ['alpha[$gt]=0'],
  ])('rejects %s', async (query) => {
    expect((await manager.get(`${FORECAST}/P102?${query}`)).status).toBe(400);
  });

  it('scopes suppliers and handles unknown products', async () => {
    expect((await supplier.get(`${FORECAST}/P101`)).status).toBe(200);
    expect((await supplier.get(`${FORECAST}/P103`)).status).toBe(404);
    expect((await manager.get(`${FORECAST}/ZZZ`)).status).toBe(404);
    expect((await request(app).get(`${FORECAST}/P101`)).status).toBe(401);
  });

  describe('batch', () => {
    it('returns the same item shape without history', async () => {
      const { body } = await manager.get(`${FORECAST}?skus=P101,P102,P110&method=ses`);
      expect(body.items.map((item) => item.sku).sort()).toEqual(['P101', 'P102', 'P110']);
      expect(body.items[0].history).toBeUndefined();
      expect(body.items[0].forecast).toHaveLength(7);
      expect(body.items[0].explanation.summary).toContain('Expect about');
    });

    it('agrees with the single endpoint', async () => {
      const single = await manager.get(`${FORECAST}/P102?method=ses&alpha=0.4`);
      const { body } = await manager.get(`${FORECAST}?skus=P102&method=ses&alpha=0.4`);
      expect(body.items[0].forecast).toEqual(single.body.forecast);
    });

    it('filters out-of-scope products and enforces limits', async () => {
      const { body } = await supplier.get(`${FORECAST}?skus=P101,P103`);
      expect(body.items.map((item) => item.sku)).toEqual(['P101']);
      const tooMany = Array.from({ length: 51 }, (_, i) => `S${i}`).join(',');
      expect((await manager.get(`${FORECAST}?skus=${tooMany}`)).status).toBe(400);
      expect((await manager.get(FORECAST)).status).toBe(400);
    });
  });

  describe('tune', () => {
    it('persists alpha and rebuilds the live state', async () => {
      const res = await manager.post(`${FORECAST}/P104/tune`).send({});
      expect(res.status).toBe(200);
      const stored = await Product.findOne({ sku: 'P104' }).lean();
      expect(stored.forecast.alpha).toBe(res.body.alpha);
      expect(res.body.reorderPoint).toBe(stored.reorderPoint);
      expect((await manager.get(`${FORECAST}/P104`)).body.live.alpha).toBe(res.body.alpha);
    });

    it('saves a chosen alpha', async () => {
      const res = await manager.post(`${FORECAST}/P105/tune`).send({ alpha: 0.65 });
      expect(res.body.alpha).toBe(0.65);
      expect((await Product.findOne({ sku: 'P105' }).lean()).forecast.alpha).toBe(0.65);
    });

    it('refuses thin history, the wrong role and bad input', async () => {
      expect((await manager.post(`${FORECAST}/P110/tune`).send({})).status).toBe(409);
      expect((await supplier.post(`${FORECAST}/P101/tune`).send({})).status).toBe(403);
      expect((await manager.post(`${FORECAST}/P101/tune`).send({ alpha: 5 })).status).toBe(400);
    });
  });

  describe('self-healing and day boundaries', () => {
    it('overwrites a corrupted stored state on read', async () => {
      await Product.updateOne({ sku: 'P106' }, { 'forecast.level': 99999, 'forecast.next': 99999 });
      await manager.get(`${FORECAST}/P106`);
      const healed = await Product.findOne({ sku: 'P106' }).lean();
      expect(healed.forecast.level).toBeLessThan(100);
      expect(healed.reorderPoint).toBeLessThan(10000);
    });

    it('toggles provisional across a day boundary', async () => {
      vi.useFakeTimers({ toFake: ['Date'] });
      const currentDay = today();
      vi.setSystemTime(new Date(`${currentDay}T23:55:00Z`));
      const { agent } = await loginAs(app, 'manager');
      const product = await Product.findOne({ sku: 'P108' }).lean();
      await DailyDemand.create({ productId: product._id, day: currentDay, qty: 50 });

      const during = await agent.get(`${FORECAST}/P108?method=ses`);
      expect(during.body.provisional).toBe(true);
      expect(during.body.live.provisional).toBe(true);
      expect(during.body.forecast[0].day).toBe(currentDay);
      const level = during.body.history.at(-1).fitted;
      expect(during.body.forecast[0].value).toBeGreaterThan(level);

      vi.setSystemTime(new Date(`${addDays(currentDay, 1)}T00:05:00Z`));
      const after = await agent.get(`${FORECAST}/P108?method=ses`);
      expect(after.body.provisional).toBe(false);
      expect(after.body.asOf).toBe(currentDay);
      expect(after.body.history.at(-1)).toMatchObject({ day: currentDay, actual: 50 });
      const stored = await Product.findOne({ sku: 'P108' }).lean();
      expect(stored.forecast).toMatchObject({ lastClosedDay: currentDay, openDay: addDays(currentDay, 1), openQty: 0 });
    });
  });
});
