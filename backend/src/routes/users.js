import { Router } from 'express';
import mongoose from 'mongoose';
import { z } from 'zod';
import { ApiError } from '../lib/errors.js';
import { hashPassword } from '../lib/password.js';
import { page, userView } from '../lib/views.js';
import { requireRole } from '../middleware/auth.js';
import { writeLimit } from '../middleware/rateLimits.js';
import { email, limit, objectId, validate } from '../middleware/validate.js';
import { Supplier } from '../models/Supplier.js';
import { User } from '../models/User.js';

const role = z.enum(['admin', 'manager', 'supplier']);
const listQuery = z.strictObject({ limit, after: objectId.optional() });
const createBody = z.strictObject({
  email,
  password: z.string().min(12).max(128),
  role,
  supplierId: objectId.optional(),
});
const patchBody = z.strictObject({
  role: role.optional(),
  disabled: z.boolean().optional(),
  supplierId: objectId.nullable().optional(),
});
const idParams = z.strictObject({ id: objectId });

async function assertSupplierExists(supplierId) {
  if (supplierId && !(await Supplier.exists({ _id: supplierId }))) {
    throw new ApiError('VALIDATION_ERROR', 'That supplier does not exist');
  }
}

export const userRoutes = Router();

userRoutes.get('/users', requireRole('admin'), validate({ query: listQuery }), async (req, res) => {
  const { limit: size, after } = req.valid.query;
  const rows = await User.find(after ? { _id: mongoose.trusted({ $gt: after }) } : {})
    .sort({ _id: 1 })
    .limit(size + 1)
    .lean();
  res.json(page(rows, size, (user) => String(user._id), userView));
});

userRoutes.post('/users', requireRole('admin'), writeLimit, validate({ body: createBody }), async (req, res) => {
  const { password, ...fields } = req.valid.body;
  await assertSupplierExists(fields.supplierId);
  const user = await User.create({ ...fields, passwordHash: await hashPassword(password) });
  res.status(201).json({ user: userView(user) });
});

userRoutes.patch(
  '/users/:id',
  requireRole('admin'),
  writeLimit,
  validate({ params: idParams, body: patchBody }),
  async (req, res) => {
    const { role: newRole, disabled, supplierId } = req.valid.body;
    const user = await User.findById(req.valid.params.id);
    if (!user) throw new ApiError('NOT_FOUND', 'User not found');
    await assertSupplierExists(supplierId);

    if (newRole !== undefined) user.role = newRole;
    if (supplierId !== undefined) user.supplierId = supplierId;
    if (user.role !== 'supplier') user.supplierId = undefined;
    if (disabled !== undefined) {
      if (disabled && !user.disabled) user.tokenVersion += 1;
      user.disabled = disabled;
    }
    await user.save();
    res.json({ user: userView(user) });
  },
);
