import { MongoMemoryReplSet } from 'mongodb-memory-server';
import request from 'supertest';
import { connectDb, disconnectDb } from '../src/db.js';
import { hashPassword } from '../src/lib/password.js';
import { Supplier } from '../src/models/Supplier.js';
import { User } from '../src/models/User.js';

export const PASSWORD = 'correct-horse-battery';
const passwordHash = await hashPassword(PASSWORD);
let userCount = 0;

export async function startDb() {
  const replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  await connectDb(replSet.getUri('inventory'));
  return async () => {
    await disconnectDb();
    await replSet.stop();
  };
}

export async function createUser(role, fields = {}) {
  userCount += 1;
  const supplierId =
    role === 'supplier' && !fields.supplierId ? (await Supplier.create({ name: `Supplier ${userCount}` }))._id : fields.supplierId;
  return User.create({ email: `${role}${userCount}@test.example.com`, passwordHash, role, ...fields, supplierId });
}

export async function loginAs(app, role, fields) {
  const user = await createUser(role, fields);
  const agent = request.agent(app);
  const res = await agent.post('/api/v1/auth/login').send({ email: user.email, password: PASSWORD });
  if (res.status !== 200) throw new Error(`Login failed: ${res.status} ${res.text}`);
  return { agent, user };
}

// Every route is mounted directly under /api/v1, so walking the stack gives the whole API surface.
export function listRoutes(app) {
  const routes = [];
  const walk = (stack) => {
    for (const layer of stack) {
      if (layer.route) {
        for (const method of Object.keys(layer.route.methods)) {
          routes.push({ method, path: `/api/v1${layer.route.path}` });
        }
      } else if (layer.handle?.stack) {
        walk(layer.handle.stack);
      }
    }
  };
  walk(app.router.stack);
  return routes;
}
