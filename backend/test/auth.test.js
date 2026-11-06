import jwt from 'jsonwebtoken';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { hashPassword, verifyPassword } from '../src/lib/password.js';
import { User } from '../src/models/User.js';
import { createUser, listRoutes, loginAs, PASSWORD, startDb } from './helpers.js';

const LOGIN = '/api/v1/auth/login';
const REFRESH = '/api/v1/auth/refresh';
const LOGOUT = '/api/v1/auth/logout';
const ME = '/api/v1/auth/me';
const ACCESS_SECRET = 'test-access-secret-that-is-long-enough';

const cookieNamed = (res, name) => res.headers['set-cookie'].find((cookie) => cookie.startsWith(`${name}=`));

describe('auth', () => {
  let stopDb;
  const app = createApp();

  beforeAll(async () => {
    stopDb = await startDb();
  });
  afterAll(() => stopDb());

  describe('passwords', () => {
    it('stores scrypt parameters with a random salt and verifies', async () => {
      const [a, b] = await Promise.all([hashPassword('same-password'), hashPassword('same-password')]);
      expect(a).toMatch(/^scrypt\$16384\$8\$1\$/);
      expect(a).not.toBe(b);
      expect(await verifyPassword('same-password', a)).toBe(true);
      expect(await verifyPassword('other-password', a)).toBe(false);
    });
  });

  describe('login', () => {
    it('sets hardened cookies and never returns the hash', async () => {
      const user = await createUser('manager');
      const res = await request(app).post(LOGIN).send({ email: user.email, password: PASSWORD });
      expect(res.status).toBe(200);
      expect(res.body.user).toMatchObject({ email: user.email, role: 'manager' });
      expect(res.text).not.toContain('scrypt');
      expect(cookieNamed(res, 'at')).toMatch(/HttpOnly/);
      expect(cookieNamed(res, 'at')).toMatch(/SameSite=Strict/);
      expect(cookieNamed(res, 'at')).toMatch(/Path=\/;/);
      expect(cookieNamed(res, 'rt')).toMatch(/Path=\/api\/v1\/auth/);
      expect(cookieNamed(res, 'rt')).toMatch(/HttpOnly/);
    });

    it('answers a wrong password and an unknown email identically', async () => {
      const user = await createUser('manager');
      const wrong = await request(app).post(LOGIN).send({ email: user.email, password: 'wrong-password-1' });
      const unknown = await request(app).post(LOGIN).send({ email: 'nobody@test.example.com', password: 'wrong-password-1' });
      expect(wrong.status).toBe(401);
      expect(unknown.status).toBe(401);
      expect(wrong.body).toEqual(unknown.body);
      expect(wrong.headers['set-cookie']).toBeUndefined();
    });

    it('rejects a disabled user', async () => {
      const user = await createUser('manager', { disabled: true });
      const res = await request(app).post(LOGIN).send({ email: user.email, password: PASSWORD });
      expect(res.status).toBe(401);
    });

    it.each([
      [{ email: 'a@test.example.com' }],
      [{ email: 'not-an-email', password: 'x' }],
      [{ email: 'a@test.example.com', password: 'x', extra: 1 }],
      [{ email: { $gt: '' }, password: 'x' }],
      [{ email: 'a@test.example.com', password: { $ne: null } }],
    ])('rejects a malformed body %j', async (body) => {
      const res = await request(app).post(LOGIN).send(body);
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('limits repeated failures per account', async () => {
      const attempt = () => request(app).post(LOGIN).send({ email: 'target@test.example.com', password: 'wrong-password-1' });
      for (let i = 0; i < 5; i++) expect((await attempt()).status).toBe(401);
      const blocked = await attempt();
      expect(blocked.status).toBe(429);
      expect(blocked.body.error.code).toBe('RATE_LIMITED');
      expect(blocked.headers['ratelimit-limit']).toBeDefined();
    });
  });

  describe('session', () => {
    it('me returns the current user and needs a cookie', async () => {
      const { agent, user } = await loginAs(app, 'admin');
      expect((await agent.get(ME)).body.user.email).toBe(user.email);
      expect((await request(app).get(ME)).status).toBe(401);
    });

    it('refresh rotates both cookies', async () => {
      const { agent } = await loginAs(app, 'manager');
      const res = await agent.post(REFRESH).send({});
      expect(res.status).toBe(200);
      expect(cookieNamed(res, 'at')).toBeDefined();
      expect(cookieNamed(res, 'rt')).toBeDefined();
      expect((await agent.get(ME)).status).toBe(200);
    });

    it('refresh needs a valid refresh cookie', async () => {
      expect((await request(app).post(REFRESH).send({})).status).toBe(401);
      const res = await request(app).post(REFRESH).set('Cookie', 'rt=garbage').send({});
      expect(res.status).toBe(401);
    });

    it('logout clears cookies and revokes the refresh token', async () => {
      const { agent, user } = await loginAs(app, 'manager');
      const stolen = request.agent(app);
      const login = await stolen.post(LOGIN).send({ email: user.email, password: PASSWORD });
      const refreshCookie = cookieNamed(login, 'rt').split(';')[0];

      expect((await agent.post(LOGOUT).send({})).status).toBe(204);
      expect((await agent.get(ME)).status).toBe(401);
      const replay = await request(app).post(REFRESH).set('Cookie', refreshCookie).send({});
      expect(replay.status).toBe(401);
    });

    it('a disabled user cannot refresh or read me', async () => {
      const { agent, user } = await loginAs(app, 'manager');
      await User.updateOne({ _id: user._id }, { disabled: true });
      expect((await agent.post(REFRESH).send({})).status).toBe(401);
      expect((await agent.get(ME)).status).toBe(401);
    });
  });

  describe('token pinning', () => {
    const encode = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');

    it('rejects an unsigned alg=none token', async () => {
      const token = `${encode({ alg: 'none', typ: 'JWT' })}.${encode({ sub: 'x', role: 'admin' })}.`;
      expect((await request(app).get(ME).set('Cookie', `at=${token}`)).status).toBe(401);
    });

    it('rejects an HS512 token signed with the right secret', async () => {
      const token = jwt.sign({ sub: 'x', role: 'admin' }, ACCESS_SECRET, { algorithm: 'HS512' });
      expect((await request(app).get(ME).set('Cookie', `at=${token}`)).status).toBe(401);
    });

    it('rejects an expired token', async () => {
      const token = jwt.sign({ sub: 'x', role: 'admin' }, ACCESS_SECRET, { algorithm: 'HS256', expiresIn: -1 });
      expect((await request(app).get(ME).set('Cookie', `at=${token}`)).status).toBe(401);
    });
  });

  describe('every route needs a cookie', () => {
    const PUBLIC = new Set(['/api/v1/health', '/api/v1/ready', LOGIN]);

    it('walks the router stack', async () => {
      const routes = listRoutes(createApp()).filter(({ path }) => !PUBLIC.has(path));
      expect(routes.length).toBeGreaterThan(3);
      for (const { method, path } of routes) {
        const url = path.replace(':id', '0'.repeat(24)).replace(':sku', 'P101');
        const res = await request(app)[method](url).set('Content-Type', 'application/json');
        expect(res.status, `${method} ${path}`).toBe(401);
      }
    });
  });

  describe('users', () => {
    it('admin creates, lists and pages through users', async () => {
      const { agent } = await loginAs(app, 'admin');
      const created = await agent
        .post('/api/v1/users')
        .send({ email: 'NEW.Person@test.example.com', password: 'a-long-enough-password', role: 'manager' });
      expect(created.status).toBe(201);
      expect(created.body.user.email).toBe('new.person@test.example.com');
      expect(created.text).not.toContain('scrypt');

      const first = await agent.get('/api/v1/users?limit=1');
      expect(first.body.items).toHaveLength(1);
      expect(first.body.next).toEqual(expect.any(String));
      const second = await agent.get(`/api/v1/users?limit=1&after=${first.body.next}`);
      expect(second.body.items[0].id).not.toBe(first.body.items[0].id);
    });

    it('rejects duplicates, short passwords and unknown suppliers', async () => {
      const { agent, user } = await loginAs(app, 'admin');
      const dup = await agent.post('/api/v1/users').send({ email: user.email, password: 'a-long-enough-password', role: 'manager' });
      expect(dup.status).toBe(409);
      const short = await agent.post('/api/v1/users').send({ email: 'x@test.example.com', password: 'short', role: 'manager' });
      expect(short.status).toBe(400);
      const ghost = await agent
        .post('/api/v1/users')
        .send({ email: 'y@test.example.com', password: 'a-long-enough-password', role: 'supplier', supplierId: '0'.repeat(24) });
      expect(ghost.status).toBe(400);
      const orphan = await agent.post('/api/v1/users').send({ email: 'z@test.example.com', password: 'a-long-enough-password', role: 'supplier' });
      expect(orphan.status).toBe(400);
    });

    it('disabling increments tokenVersion and blocks refresh', async () => {
      const { agent: admin } = await loginAs(app, 'admin');
      const { agent: target, user } = await loginAs(app, 'manager');
      const res = await admin.patch(`/api/v1/users/${user._id}`).send({ disabled: true });
      expect(res.body.user.disabled).toBe(true);
      expect((await User.findById(user._id)).tokenVersion).toBe(user.tokenVersion + 1);
      expect((await target.post(REFRESH).send({})).status).toBe(401);
    });

    it('changing role away from supplier clears the supplier link', async () => {
      const { agent: admin } = await loginAs(app, 'admin');
      const supplierUser = await createUser('supplier');
      const res = await admin.patch(`/api/v1/users/${supplierUser._id}`).send({ role: 'manager' });
      expect(res.body.user).toMatchObject({ role: 'manager', supplierId: null });
    });

    it('validates ids, unknown users and roles', async () => {
      const { agent: admin } = await loginAs(app, 'admin');
      expect((await admin.patch('/api/v1/users/not-an-id').send({ disabled: true })).status).toBe(400);
      expect((await admin.patch(`/api/v1/users/${'0'.repeat(24)}`).send({ disabled: true })).status).toBe(404);
      const { agent: manager } = await loginAs(app, 'manager');
      expect((await manager.get('/api/v1/users')).status).toBe(403);
      expect((await manager.post('/api/v1/users').send({})).status).toBe(403);
    });
  });

  describe('suppliers', () => {
    it('admin creates, manager reads, supplier is refused', async () => {
      const { agent: admin } = await loginAs(app, 'admin');
      const created = await admin.post('/api/v1/suppliers').send({ name: 'Acme', contactEmail: 'SALES@acme.example.com' });
      expect(created.status).toBe(201);
      expect(created.body.supplier.contactEmail).toBe('sales@acme.example.com');

      const { agent: manager } = await loginAs(app, 'manager');
      const list = await manager.get('/api/v1/suppliers?limit=100');
      expect(list.body.items.map((supplier) => supplier.name)).toContain('Acme');
      expect((await manager.post('/api/v1/suppliers').send({ name: 'Nope' })).status).toBe(403);

      const { agent: supplier } = await loginAs(app, 'supplier');
      expect((await supplier.get('/api/v1/suppliers')).status).toBe(403);
    });

    it('validates the body', async () => {
      const { agent: admin } = await loginAs(app, 'admin');
      expect((await admin.post('/api/v1/suppliers').send({ name: '' })).status).toBe(400);
      expect((await admin.post('/api/v1/suppliers').send({ name: 'A', admin: true })).status).toBe(400);
    });
  });
});
