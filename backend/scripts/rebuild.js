import { config } from '../src/config.js';
import { connectDb, disconnectDb } from '../src/db.js';
import { logger } from '../src/lib/logger.js';
import { rebuildDailyDemand, rebuildLiveStates } from '../src/services/liveForecast.js';

await connectDb(config.MONGODB_URI);
await rebuildDailyDemand();
const count = await rebuildLiveStates();
logger.info(`Rebuilt daily demand and forecast state for ${count} products`);
await disconnectDb();
