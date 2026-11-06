import { createApp } from './app.js';
import { config } from './config.js';
import { connectDb, disconnectDb } from './db.js';
import { logger } from './lib/logger.js';

const FORCED_EXIT_MS = 10_000;

await connectDb(config.MONGODB_URI);

const server = createApp().listen(config.PORT, () => {
  logger.info(`API listening on port ${config.PORT}`);
});

// These bound only how long a client may take to send its request, so long-lived
// SSE responses are not affected.
server.headersTimeout = 15_000;
server.requestTimeout = 30_000;

async function shutdown(signal) {
  logger.info(`${signal} received, shutting down`);
  setTimeout(() => process.exit(1), FORCED_EXIT_MS).unref();
  await new Promise((resolve) => server.close(resolve));
  await disconnectDb();
  process.exit(0);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
