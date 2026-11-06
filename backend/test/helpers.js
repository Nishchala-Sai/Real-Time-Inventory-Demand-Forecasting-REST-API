import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { connectDb, disconnectDb } from '../src/db.js';

export async function startDb() {
  const replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  await connectDb(replSet.getUri('inventory'));
  return async () => {
    await disconnectDb();
    await replSet.stop();
  };
}
