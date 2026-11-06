import { MongoMemoryServer } from 'mongodb-memory-server';

// On a machine with no cached binary, parallel test files would all wait on one download
// and hit their hook timeouts. Fetch it once before any file starts.
export default async function setup() {
  const server = await MongoMemoryServer.create();
  await server.stop();
}
