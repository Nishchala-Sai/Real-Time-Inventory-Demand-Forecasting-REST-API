import { Router } from 'express';
import mongoose from 'mongoose';
import { z } from 'zod';
import { alertView, page } from '../lib/views.js';
import { requireRole } from '../middleware/auth.js';
import { limit, validate } from '../middleware/validate.js';
import { Alert } from '../models/Alert.js';
import { Product } from '../models/Product.js';
import { scopeFor } from '../services/products.js';

const CURSOR = /^\d+_[0-9a-fA-F]{24}$/;
const listQuery = z.strictObject({
  status: z.enum(['open', 'resolved']).optional(),
  limit,
  after: z.string().regex(CURSOR).optional(),
});

export const alertRoutes = Router();

alertRoutes.get('/alerts', requireRole('admin', 'manager', 'supplier'), validate({ query: listQuery }), async (req, res) => {
  const { status, limit: size, after } = req.valid.query;
  const filter = {};
  if (status) filter.status = status;
  if (req.user.role === 'supplier') {
    const ids = await Product.find(scopeFor(req.user)).distinct('_id');
    filter.productId = mongoose.trusted({ $in: ids });
  }
  if (after) {
    const [ms, id] = after.split('_');
    const createdAt = new Date(Number(ms));
    filter.$or = [
      { createdAt: mongoose.trusted({ $lt: createdAt }) },
      { createdAt, _id: mongoose.trusted({ $lt: id }) },
    ];
  }
  const rows = await Alert.find(filter)
    .sort({ createdAt: -1, _id: -1 })
    .limit(size + 1)
    .populate('productId', 'sku name')
    .lean();
  res.json(page(rows, size, (row) => `${row.createdAt.getTime()}_${row._id}`, alertView));
});
