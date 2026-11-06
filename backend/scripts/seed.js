import { fileURLToPath } from 'node:url';
import mongoose from 'mongoose';
import { config } from '../src/config.js';
import { connectDb, disconnectDb } from '../src/db.js';
import { addDays, dayKey } from '../src/lib/days.js';
import { logger } from '../src/lib/logger.js';
import { hashPassword } from '../src/lib/password.js';
import { Product } from '../src/models/Product.js';
import { StockMovement } from '../src/models/StockMovement.js';
import { Supplier } from '../src/models/Supplier.js';
import { User } from '../src/models/User.js';
import { rebuildDailyDemand, rebuildLiveStates } from '../src/services/liveForecast.js';
import { CATALOG, HISTORY_DAYS, mulberry32 } from './catalog.js';

const DEMO_PASSWORD = 'demo-password-123';

async function ensureAdmin() {
  if (await User.exists({ role: 'admin' })) return false;
  if (!config.ADMIN_EMAIL || !config.ADMIN_PASSWORD) {
    throw new Error('ADMIN_EMAIL and ADMIN_PASSWORD are required to create the first admin');
  }
  await User.create({
    email: config.ADMIN_EMAIL,
    passwordHash: await hashPassword(config.ADMIN_PASSWORD),
    role: 'admin',
  });
  return true;
}

function demandFor(item, rand) {
  const length = item.historyDays ?? HISTORY_DAYS;
  return Array.from({ length }, (_, t) => item.shape(t, rand));
}

function ledgerRows(product, item, rand, currentDay) {
  const demand = demandFor(item, rand);
  const sold = demand.reduce((sum, qty) => sum + qty, 0);
  const firstDay = addDays(currentDay, -demand.length);
  const at = (day) => new Date(`${day}T12:00:00Z`);
  const rows = [
    {
      productId: product._id,
      type: 'restock',
      delta: item.stock + sold,
      at: at(addDays(firstDay, -1)),
      day: dayKey(at(addDays(firstDay, -1)), config.STORE_TZ),
      note: 'initial',
    },
  ];
  demand.forEach((qty, i) => {
    if (qty === 0) return;
    const when = at(addDays(firstDay, i));
    rows.push({
      productId: product._id,
      type: 'sale',
      delta: -qty,
      unitPriceCents: item.unitPriceCents,
      at: when,
      day: dayKey(when, config.STORE_TZ),
    });
  });
  return rows;
}

export async function seedDatabase() {
  await mongoose.connection.dropDatabase();
  await Promise.all(Object.values(mongoose.models).map((model) => model.syncIndexes()));

  const suppliers = await Supplier.insertMany([
    { name: 'Northwind Components', contactEmail: 'sales@northwind.example.com' },
    { name: 'Blue Harbor Displays', contactEmail: 'orders@blueharbor.example.com' },
    { name: 'Summit Accessories', contactEmail: 'hello@summit.example.com' },
  ]);

  await ensureAdmin();
  const passwordHash = await hashPassword(DEMO_PASSWORD);
  await User.insertMany([
    { email: 'manager@example.com', passwordHash, role: 'manager' },
    { email: 'supplier@example.com', passwordHash, role: 'supplier', supplierId: suppliers[0]._id },
  ]);

  const currentDay = dayKey(new Date(), config.STORE_TZ);
  const rand = mulberry32(42);
  const rows = [];
  for (const item of CATALOG) {
    const product = await Product.create({
      sku: item.sku,
      name: item.name,
      category: item.category,
      unitPriceCents: item.unitPriceCents,
      currentStock: item.stock,
      supplierId: suppliers[item.supplier]._id,
    });
    rows.push(...ledgerRows(product, item, rand, currentDay));
  }
  await StockMovement.insertMany(rows);
  await rebuildDailyDemand();
  await rebuildLiveStates();
}

async function main() {
  await connectDb(config.MONGODB_URI);
  if (config.NODE_ENV === 'production') {
    // Demo data never reaches production, but a new deployment still needs its first admin.
    const created = await ensureAdmin();
    logger.info(created ? 'Created the first admin. No demo data was added.' : 'An admin already exists. Nothing changed.');
  } else {
    logger.warn('Dropping and recreating the database with demo data');
    await seedDatabase();
    logger.info('Seed complete');
  }
  await disconnectDb();
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main();
