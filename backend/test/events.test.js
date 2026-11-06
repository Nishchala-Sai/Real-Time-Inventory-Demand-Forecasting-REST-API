import http from 'node:http';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { listenerCount } from '../src/lib/events.js';
import { Supplier } from '../src/models/Supplier.js';
import { closeAllStreams } from '../src/routes/events.js';
import { createProductDoc, loginAs, startDb } from './helpers.js';

function openStream(port, cookie) {
  return new Promise((resolve, reject) => {
    const req = http.get({ port, path: '/api/v1/events', headers: { Cookie: cookie } }, (res) => {
      const stream = {
        status: res.statusCode,
        headers: res.headers,
        text: '',
        events: [],
        waiters: [],
        ended: new Promise((done) => res.on('close', done)),
        close: () => req.destroy(),
      };
      res.setEncoding('utf8');
      res.on('data', (chunk) => {
        stream.text += chunk;
        for (const block of chunk.split('\n\n')) {
          const line = block.split('\n').find((part) => part.startsWith('data: '));
          if (line) stream.events.push(JSON.parse(line.slice(6)));
        }
        stream.waiters.forEach((check) => check());
      });
      resolve(stream);
    });
    req.on('error', (error) => {
      if (error.code !== 'ECONNRESET') reject(error);
    });
  });
}

function waitForEvent(stream, type, sku) {
  const find = () => stream.events.find((event) => event.type === type && event.sku === sku);
  return new Promise((resolve) => {
    const check = () => {
      const event = find();
      if (event) resolve(event);
    };
    stream.waiters.push(check);
    check();
  });
}

async function waitUntil(predicate) {
  for (let i = 0; i < 200 && !predicate(); i++) await new Promise((done) => setTimeout(done, 10));
}

describe('SSE', () => {
  let stopDb;
  let server;
  let port;
  let manager;
  let managerCookie;
  let supplierCookie;
  let ownSupplierId;
  const opened = [];
  const app = createApp();

  const open = async (cookie) => {
    const stream = await openStream(port, cookie);
    opened.push(stream);
    return stream;
  };

  beforeAll(async () => {
    stopDb = await startDb();
    server = await new Promise((resolve) => {
      const listening = app.listen(0, () => resolve(listening));
    });
    port = server.address().port;
    const signedIn = await loginAs(app, 'manager');
    manager = signedIn.agent;
    managerCookie = signedIn.cookie;
    const supplier = await Supplier.create({ name: 'Own' });
    ownSupplierId = supplier._id;
    supplierCookie = (await loginAs(app, 'supplier', { supplierId: ownSupplierId })).cookie;
  });
  afterEach(async () => {
    opened.splice(0).forEach((stream) => stream.close());
    await waitUntil(() => listenerCount() === 0);
  });
  afterAll(async () => {
    await new Promise((resolve) => server.close(resolve));
    await stopDb();
  });

  it('sends the stream headers and the retry hint', async () => {
    const stream = await open(managerCookie);
    expect(stream.status).toBe(200);
    expect(stream.headers['content-type']).toContain('text/event-stream');
    expect(stream.headers['cache-control']).toBe('no-cache, no-transform');
    expect(stream.headers['x-accel-buffering']).toBe('no');
    await waitUntil(() => stream.text.includes('retry: 5000'));
    expect(stream.text).toContain('retry: 5000');
  });

  it('requires a cookie', async () => {
    const stream = await open('at=nope');
    expect(stream.status).toBe(401);
  });

  it('delivers stock and forecast events after a sale', async () => {
    const product = await createProductDoc({ sku: 'SSE-1', currentStock: 500 });
    const stream = await open(managerCookie);
    const started = performance.now();
    const res = await manager.post('/api/v1/stock-movements').send({ sku: 'SSE-1', type: 'sale', qty: 2 });
    expect(res.status).toBe(201);

    const stock = await waitForEvent(stream, 'stock.updated', 'SSE-1');
    // A generous bound for slow CI machines. The real number is measured against the budget separately.
    expect(performance.now() - started).toBeLessThan(2000);
    expect(stock.data).toMatchObject({ currentStock: 498, sku: 'SSE-1' });
    expect(stock.id).toEqual(expect.any(String));
    const forecast = await waitForEvent(stream, 'forecast.updated', 'SSE-1');
    expect(forecast.data).toEqual({ next: product.forecast.next + 2, provisional: true });
    expect(stream.text).toMatch(/event: stock\.updated/);
    expect(stream.text).toMatch(/id: [0-9a-f-]{36}/);
  });

  it('delivers alert events when the threshold is crossed', async () => {
    await createProductDoc({ sku: 'SSE-2', currentStock: 11, reorderPointOverride: 10, reorderPoint: 10 });
    const stream = await open(managerCookie);
    await manager.post('/api/v1/stock-movements').send({ sku: 'SSE-2', type: 'sale', qty: 1 });
    const alert = await waitForEvent(stream, 'alert.opened', 'SSE-2');
    expect(alert.data).toMatchObject({ currentStock: 10, reorderPoint: 10, name: 'SSE-2' });
    await manager.post('/api/v1/stock-movements').send({ sku: 'SSE-2', type: 'restock', qty: 5 });
    await waitForEvent(stream, 'alert.resolved', 'SSE-2');
  });

  it('emits nothing when the transaction fails', async () => {
    await createProductDoc({ sku: 'SSE-3', currentStock: 0 });
    const stream = await open(managerCookie);
    const res = await manager.post('/api/v1/stock-movements').send({ sku: 'SSE-3', type: 'sale', qty: 1 });
    expect(res.status).toBe(409);
    await new Promise((done) => setTimeout(done, 100));
    expect(stream.events.filter((event) => event.sku === 'SSE-3')).toEqual([]);
  });

  it('filters events for suppliers', async () => {
    await createProductDoc({ sku: 'SSE-OWN', currentStock: 50, supplierId: ownSupplierId });
    await createProductDoc({ sku: 'SSE-OTHER', currentStock: 50 });
    const stream = await open(supplierCookie);
    await manager.post('/api/v1/stock-movements').send({ sku: 'SSE-OTHER', type: 'sale', qty: 1 });
    await manager.post('/api/v1/stock-movements').send({ sku: 'SSE-OWN', type: 'sale', qty: 1 });
    await waitForEvent(stream, 'stock.updated', 'SSE-OWN');
    expect(stream.events.some((event) => event.sku === 'SSE-OTHER')).toBe(false);
  });

  it('caps streams per user with a 503', async () => {
    for (let i = 0; i < 5; i++) expect((await open(managerCookie)).status).toBe(200);
    expect((await open(managerCookie)).status).toBe(503);
  });

  it('leaks no listeners after 50 streams open and close', async () => {
    const baseline = listenerCount();
    for (let i = 0; i < 50; i++) {
      const stream = await openStream(port, managerCookie);
      stream.close();
      await stream.ended;
      await waitUntil(() => listenerCount() === baseline);
    }
    expect(listenerCount()).toBe(baseline);
  });

  it('ends open streams on shutdown', async () => {
    const stream = await open(managerCookie);
    expect(listenerCount()).toBe(1);
    closeAllStreams();
    await stream.ended;
    await waitUntil(() => listenerCount() === 0);
    expect(listenerCount()).toBe(0);
  });
});
