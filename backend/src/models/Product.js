import mongoose from 'mongoose';

const int = {
  validator: (value) => value === null || Number.isInteger(value),
  message: '{PATH} must be an integer',
};

const forecastSchema = new mongoose.Schema(
  {
    alpha: { type: Number, default: 0.3 },
    level: { type: Number, default: 0 },
    mse: { type: Number, default: 0 },
    n: { type: Number, default: 0 },
    lastClosedDay: { type: String, default: null },
    openDay: { type: String, default: null },
    openQty: { type: Number, default: 0 },
    next: { type: Number, default: 0 },
    updatedAt: Date,
  },
  { _id: false },
);

const productSchema = new mongoose.Schema(
  {
    sku: { type: String, required: true, unique: true, match: /^[A-Z0-9-]{2,32}$/ },
    name: { type: String, required: true, minlength: 1, maxlength: 120 },
    category: { type: String, required: true, minlength: 1, maxlength: 60, index: true },
    unitPriceCents: { type: Number, required: true, min: 0, validate: int },
    currentStock: { type: Number, default: 0, min: 0, validate: int },
    leadTimeDays: { type: Number, default: 7, min: 1, max: 365, validate: int },
    reviewPeriodDays: { type: Number, default: 7, min: 1, max: 90, validate: int },
    serviceLevel: { type: Number, default: 0.95, enum: [0.9, 0.95, 0.975, 0.99] },
    reorderPointOverride: { type: Number, default: null, min: 0, validate: int },
    reorderPoint: { type: Number, default: 0 },
    supplierId: { type: mongoose.Schema.Types.ObjectId, ref: 'Supplier', index: true },
    archived: { type: Boolean, default: false },
    forecast: { type: forecastSchema, default: () => ({}) },
  },
  { timestamps: true },
);

productSchema.index({ archived: 1, sku: 1 });

export const Product = mongoose.model('Product', productSchema);
