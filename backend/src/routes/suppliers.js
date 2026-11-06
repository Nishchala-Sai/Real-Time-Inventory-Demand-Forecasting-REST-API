import { Router } from 'express';
import mongoose from 'mongoose';
import { z } from 'zod';
import { page, supplierView } from '../lib/views.js';
import { requireRole } from '../middleware/auth.js';
import { writeLimit } from '../middleware/rateLimits.js';
import { email, limit, objectId, validate } from '../middleware/validate.js';
import { Supplier } from '../models/Supplier.js';

const listQuery = z.strictObject({ limit, after: objectId.optional() });
const createBody = z.strictObject({
  name: z.string().trim().min(1).max(120),
  contactEmail: email.optional(),
});

export const supplierRoutes = Router();

supplierRoutes.get('/suppliers', requireRole('admin', 'manager'), validate({ query: listQuery }), async (req, res) => {
  const { limit: size, after } = req.valid.query;
  const rows = await Supplier.find(after ? { _id: mongoose.trusted({ $gt: after }) } : {})
    .sort({ _id: 1 })
    .limit(size + 1)
    .lean();
  res.json(page(rows, size, (supplier) => String(supplier._id), supplierView));
});

supplierRoutes.post('/suppliers', requireRole('admin'), writeLimit, validate({ body: createBody }), async (req, res) => {
  const supplier = await Supplier.create(req.valid.body);
  res.status(201).json({ supplier: supplierView(supplier) });
});
