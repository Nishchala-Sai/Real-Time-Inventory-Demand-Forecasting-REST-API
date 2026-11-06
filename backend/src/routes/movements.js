import { Router } from 'express';
import { z } from 'zod';
import { ApiError } from '../lib/errors.js';
import { round } from '../lib/round.js';
import { movementView, stockView } from '../lib/views.js';
import { requireRole } from '../middleware/auth.js';
import { writeLimit } from '../middleware/rateLimits.js';
import { validate } from '../middleware/validate.js';
import { recordMovement } from '../services/inventory.js';
import { sku } from './products.js';

const IDEMPOTENCY_KEY = /^[\w-]{1,64}$/;

const body = z
  .strictObject({
    sku,
    type: z.enum(['sale', 'restock', 'adjustment', 'return']),
    qty: z.number().int().min(1).max(100000),
    direction: z.enum(['in', 'out']).optional(),
    note: z.string().trim().min(1).max(200).optional(),
    unitPriceCents: z.number().int().min(0).optional(),
  })
  .superRefine((value, ctx) => {
    const issue = (path, message) => ctx.addIssue({ code: 'custom', path: [path], message });
    if (value.type === 'adjustment') {
      if (!value.direction) issue('direction', 'is required for an adjustment');
      if (!value.note) issue('note', 'is required for an adjustment');
    } else if (value.direction) {
      issue('direction', 'is only allowed for an adjustment');
    }
    if (value.type !== 'sale' && value.unitPriceCents !== undefined) {
      issue('unitPriceCents', 'is only allowed for a sale');
    }
  });

function idempotencyKeyFrom(req) {
  const key = req.get('idempotency-key');
  if (key !== undefined && !IDEMPOTENCY_KEY.test(key)) {
    throw new ApiError('VALIDATION_ERROR', 'Idempotency-Key must be up to 64 letters, digits, - or _');
  }
  return key;
}

export const movementRoutes = Router();

movementRoutes.post(
  '/stock-movements',
  requireRole('admin', 'manager'),
  writeLimit,
  validate({ body }),
  async (req, res) => {
    const { replayed, movement, product, forecast } = await recordMovement(req.valid.body, {
      userId: req.user.id,
      requestId: req.id,
      idempotencyKey: idempotencyKeyFrom(req),
    });
    res.status(replayed ? 200 : 201).json({
      movement: movementView(movement),
      product: stockView(product),
      forecast: round(forecast),
    });
  },
);
