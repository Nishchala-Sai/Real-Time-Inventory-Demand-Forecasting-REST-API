import { Router } from 'express';
import { pingDb } from '../db.js';

export const healthRoutes = Router();

healthRoutes.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

healthRoutes.get('/ready', async (req, res) => {
  const ready = await pingDb();
  res.status(ready ? 200 : 503).json({ status: ready ? 'ok' : 'unavailable' });
});
