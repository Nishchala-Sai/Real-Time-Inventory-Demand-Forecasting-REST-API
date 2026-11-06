import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import express from 'express';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { parseConfig } from '../src/config.js';
import { disconnectDb } from '../src/db.js';
import { errorHandler } from '../src/middleware/error.js';
import { originCheck } from '../src/middleware/origin.js';
import { startDb } from './helpers.js';

const VALID_ENV = {
  MONGODB_URI: 'mongodb://localhost/x',
  JWT_ACCESS_SECRET: 'a'.repeat(32),
  JWT_REFRESH_SECRET: 'b'.repeat(32),
  APP_ORIGIN: 'http://localhost:5173',
};

describe('config', () => {
  it('names the variable that is wrong', () => {
    expect(() => parseConfig({ ...VALID_ENV, JWT_ACCESS_SECRET: 'short' })).toThrow(/JWT_ACCESS_SECRET/);
    expect(() => parseConfig({ ...VALID_ENV, JWT_REFRESH_SECRET: undefined })).toThrow(/JWT_REFRESH_SECRET/);
    expect(() => parseConfig({ ...VALID_ENV, STORE_TZ: 'Mars/Base' })).toThrow(/STORE_TZ/);
  });

  it('requires distinct JWT secrets', () => {
    expect(() => parseConfig({ ...VALID_ENV, JWT_REFRESH_SECRET: 'a'.repeat(32) })).toThrow(/must differ/);
  });

  it('requires https in production, except on loopback', () => {
    const production = { ...VALID_ENV, NODE_ENV: 'production' };
    expect(() => parseConfig({ ...production, APP_ORIGIN: 'http://shop.example.com' })).toThrow(/APP_ORIGIN/);
    expect(parseConfig({ ...production, APP_ORIGIN: 'https://shop.example.com' }).NODE_ENV).toBe('production');
    expect(parseConfig({ ...production, APP_ORIGIN: 'http://localhost:4000' }).NODE_ENV).toBe('production');
  });

  it('splits CORS origins and defaults the rest', () => {
    const parsed = parseConfig({ ...VALID_ENV, CORS_ORIGINS: 'https://a.test, https://b.test' });
    expect(parsed.CORS_ORIGINS).toEqual(['https://a.test', 'https://b.test']);
    expect(parsed.STORE_TZ).toBe('UTC');
  });

  it('stops the server at startup with a clear message', () => {
    const server = fileURLToPath(new URL('../src/server.js', import.meta.url));
    const { status, stderr } = spawnSync(process.execPath, [server], {
      env: { ...VALID_ENV, JWT_ACCESS_SECRET: 'short', SystemRoot: process.env.SystemRoot },
      encoding: 'utf8',
    });
    expect(status).toBe(1);
    expect(stderr).toContain('JWT_ACCESS_SECRET');
  });
});

describe('error handler', () => {
  const failing = (error) => {
    const app = express();
    app.get('/', () => {
      throw error;
    });
    app.use(errorHandler);
    return request(app).get('/');
  };

  it('hides the stack and the message of unknown errors', async () => {
    const res = await failing(new Error('secret mongo detail'));
    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: { code: 'INTERNAL', message: 'Something went wrong' } });
    expect(res.text).not.toContain('secret mongo detail');
  });

  it('maps duplicate keys and Mongoose validation errors', async () => {
    expect((await failing(Object.assign(new Error('E11000'), { code: 11000 }))).body.error.code).toBe('CONFLICT');
    const invalid = Object.assign(new Error('bad'), { name: 'ValidationError' });
    expect((await failing(invalid)).status).toBe(400);
  });
});

describe('origin check', () => {
  const app = express();
  app.use(originCheck({ appOrigin: 'https://app.test', corsOrigins: ['https://partner.test'] }));
  app.all('/', (req, res) => res.json({ ok: true }));

  it('allows a listed cross origin with credentials and answers preflight', async () => {
    const res = await request(app).options('/').set('Origin', 'https://partner.test');
    expect(res.status).toBe(204);
    expect(res.headers['access-control-allow-origin']).toBe('https://partner.test');
    expect(res.headers['access-control-allow-credentials']).toBe('true');
  });

  it('never reflects an unlisted origin', async () => {
    const res = await request(app).get('/').set('Origin', 'https://evil.test');
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });
});

describe('app', () => {
  let stopDb;
  const app = createApp();

  beforeAll(async () => {
    stopDb = await startDb();
  });
  afterAll(() => stopDb());

  it('reports liveness and readiness', async () => {
    expect((await request(app).get('/api/v1/health')).body).toEqual({ status: 'ok' });
    expect((await request(app).get('/api/v1/ready')).status).toBe(200);
  });

  it('returns the standard 404 shape for unknown routes', async () => {
    const res = await request(app).get('/api/v1/nope');
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });

  it('sets security headers', async () => {
    const { headers } = await request(app).get('/api/v1/health');
    expect(headers['content-security-policy']).toContain("default-src 'self'");
    expect(headers['content-security-policy']).toContain("frame-ancestors 'none'");
    expect(headers['x-content-type-options']).toBe('nosniff');
    expect(headers['x-powered-by']).toBeUndefined();
  });

  it('echoes a valid request ID and replaces an invalid one', async () => {
    const echoed = await request(app).get('/api/v1/health').set('X-Request-Id', 'abc-123');
    expect(echoed.headers['x-request-id']).toBe('abc-123');
    const replaced = await request(app).get('/api/v1/health').set('X-Request-Id', 'bad id!');
    expect(replaced.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('rejects a foreign origin, a non-JSON body and malformed JSON', async () => {
    const foreign = await request(app).post('/api/v1/x').set('Origin', 'https://evil.test').send({});
    expect(foreign.status).toBe(403);
    const text = await request(app).post('/api/v1/x').set('Content-Type', 'text/plain').send('hi');
    expect(text.status).toBe(415);
    const broken = await request(app).post('/api/v1/x').set('Content-Type', 'application/json').send('{nope');
    expect(broken.status).toBe(400);
  });

  it('rejects an oversized body', async () => {
    const res = await request(app).post('/api/v1/x').send({ pad: 'x'.repeat(11 * 1024) });
    expect(res.status).toBe(400);
    expect(res.body.error.message).toMatch(/too large/);
  });

  it('reports 503 from /ready once Mongo is gone', async () => {
    await disconnectDb();
    expect((await request(app).get('/api/v1/ready')).status).toBe(503);
  });
});
