import { Router } from 'express';
import { config } from '../config.js';
import { ApiError } from '../lib/errors.js';
import { subscribe } from '../lib/events.js';
import { requireRole } from '../middleware/auth.js';

const MAX_STREAMS_PER_USER = 5;
const PING_MS = 25_000;

const streams = new Set();
const perUser = new Map();

// No replay: a reconnecting client refetches its lists, which keeps the server stateless.
function openStream(req, res) {
  const { id: userId, role, supplierId } = req.user;
  const userStreams = perUser.get(userId) ?? 0;
  if (streams.size >= config.SSE_MAX_CLIENTS || userStreams >= MAX_STREAMS_PER_USER) {
    throw new ApiError('SERVICE_UNAVAILABLE', 'Too many live connections');
  }

  res.set({
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.flushHeaders();
  res.write('retry: 5000\n\n');

  const unsubscribe = subscribe((event) => {
    if (role === 'supplier' && event.supplierId !== supplierId) return;
    res.write(`id: ${event.id}\nevent: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
  });
  const ping = setInterval(() => res.write(': ping\n\n'), PING_MS);

  streams.add(res);
  perUser.set(userId, userStreams + 1);

  // res, not req: since Node 16 the request's close event fires once its body is read.
  res.on('close', () => {
    unsubscribe();
    clearInterval(ping);
    streams.delete(res);
    const remaining = perUser.get(userId) - 1;
    if (remaining > 0) perUser.set(userId, remaining);
    else perUser.delete(userId);
  });
}

export function closeAllStreams() {
  for (const res of streams) res.end();
}

export const eventRoutes = Router();

eventRoutes.get('/events', requireRole('admin', 'manager', 'supplier'), openStream);
