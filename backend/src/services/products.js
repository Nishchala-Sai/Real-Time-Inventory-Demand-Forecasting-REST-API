import mongoose from 'mongoose';
import { ApiError } from '../lib/errors.js';
import { Product } from '../models/Product.js';

const LIST_FIELDS =
  'sku name category unitPriceCents currentStock reorderPoint reorderPointOverride leadTimeDays reviewPeriodDays serviceLevel supplierId forecast.next forecast.alpha';

const escapeRegex = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// The only source of supplier scoping: it comes from the signed token, never from request input.
export function scopeFor(user) {
  return user.role === 'supplier' ? { supplierId: user.supplierId } : {};
}

export async function findProduct(sku, user) {
  const product = await Product.findOne({ sku, archived: false, ...scopeFor(user) }).lean();
  // A supplier gets the same 404 for another supplier's product, so its existence does not leak.
  if (!product) throw new ApiError('NOT_FOUND', 'Product not found');
  return product;
}

export function listProducts(user, { status, category, q, after, limit }) {
  const filter = { archived: false, ...scopeFor(user) };
  if (category) filter.category = category;
  if (after) filter.sku = mongoose.trusted({ $gt: after });
  if (status) {
    const operator = status === 'low' ? '$lte' : '$gt';
    filter.$expr = mongoose.trusted({ [operator]: ['$currentStock', '$reorderPoint'] });
  }
  if (q) {
    const prefix = escapeRegex(q);
    filter.$or = [
      { sku: mongoose.trusted({ $regex: `^${prefix.toUpperCase()}` }) },
      { name: mongoose.trusted({ $regex: `^${prefix}`, $options: 'i' }) },
    ];
  }
  return Product.find(filter).select(LIST_FIELDS).sort({ sku: 1 }).limit(limit + 1).lean();
}
