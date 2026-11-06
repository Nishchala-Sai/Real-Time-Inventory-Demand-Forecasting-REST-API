import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Alert } from '../src/models/Alert.js';
import { DailyDemand } from '../src/models/DailyDemand.js';
import { Product } from '../src/models/Product.js';
import { StockMovement } from '../src/models/StockMovement.js';
import { Supplier } from '../src/models/Supplier.js';
import { User } from '../src/models/User.js';
import { rebuildDailyDemand, rebuildLiveStates } from '../src/services/liveForecast.js';
import { seedDatabase } from '../scripts/seed.js';
import { startDb } from './helpers.js';

const snapshot = async () => ({
  products: await Product.find().sort('sku').select('-_id sku currentStock reorderPoint forecast.level forecast.n').lean(),
  demand: await DailyDemand.find().sort('productId day').select('day qty -_id').lean(),
  counts: [
    await User.countDocuments(),
    await Supplier.countDocuments(),
    await StockMovement.countDocuments(),
    await Alert.countDocuments(),
  ],
});

describe('seed', () => {
  let stopDb;

  beforeAll(async () => {
    stopDb = await startDb();
    await seedDatabase();
  });
  afterAll(() => stopDb());

  it('creates suppliers, one user per role and a mixed catalog', async () => {
    expect(await Supplier.countDocuments()).toBe(3);
    expect((await User.find().lean()).map((user) => user.role).sort()).toEqual(['admin', 'manager', 'supplier']);
    expect(await Product.countDocuments()).toBe(10);
    expect(new Set((await Product.find().lean()).map((product) => product.category)).size).toBe(3);
  });

  it('daily demand equals the sum of sale movements per product and day', async () => {
    const sales = await StockMovement.find({ type: 'sale' }).lean();
    const expected = new Map();
    for (const sale of sales) {
      const key = `${sale.productId}|${sale.day}`;
      expected.set(key, (expected.get(key) ?? 0) - sale.delta);
    }
    const rows = await DailyDemand.find().lean();
    expect(rows.length).toBe(expected.size);
    for (const row of rows) expect(row.qty).toBe(expected.get(`${row.productId}|${row.day}`));
  });

  it('keeps the ledger consistent with current stock', async () => {
    const product = await Product.findOne({ sku: 'P101' }).lean();
    const movements = await StockMovement.find({ productId: product._id }).lean();
    expect(movements.reduce((sum, movement) => sum + movement.delta, 0)).toBe(product.currentStock);
  });

  it('computes forecast state and opens alerts for low products', async () => {
    const products = await Product.find().lean();
    for (const product of products) {
      expect(product.forecast.n).toBeGreaterThan(0);
      expect(product.reorderPoint).toBeGreaterThanOrEqual(0);
    }
    const low = products.filter((product) => product.currentStock <= product.reorderPoint);
    expect(low.length).toBeGreaterThan(0);
    expect(await Alert.countDocuments({ status: 'open' })).toBe(low.length);
  });

  it('declares the unique indexes', async () => {
    const unique = async (model) =>
      (await model.listIndexes()).filter((index) => index.unique).map((index) => JSON.stringify(index.key));
    expect(await unique(Product)).toContain('{"sku":1}');
    expect(await unique(User)).toContain('{"email":1}');
    expect(await unique(DailyDemand)).toContain('{"productId":1,"day":1}');
    expect(await unique(StockMovement)).toContain('{"idempotencyKey":1}');
    expect(await unique(Alert)).toContain('{"productId":1,"type":1}');
  });

  it('rebuild changes nothing', async () => {
    const before = await snapshot();
    await rebuildDailyDemand();
    await rebuildLiveStates();
    expect(await snapshot()).toEqual(before);
  });

  it('seeding twice gives the same data', async () => {
    const before = await snapshot();
    await seedDatabase();
    expect(await snapshot()).toEqual(before);
  });
});
