import mongoose from 'mongoose';

const alertSchema = new mongoose.Schema(
  {
    productId: { type: mongoose.Schema.Types.ObjectId, ref: 'Product', required: true },
    type: { type: String, required: true, enum: ['low_stock'] },
    status: { type: String, required: true, enum: ['open', 'resolved'], default: 'open' },
    stockAtOpen: Number,
    reorderPointAtOpen: Number,
    resolvedAt: Date,
  },
  { timestamps: true },
);

alertSchema.index(
  { productId: 1, type: 1 },
  { unique: true, partialFilterExpression: { status: 'open' } },
);
alertSchema.index({ status: 1, createdAt: -1 });

export const Alert = mongoose.model('Alert', alertSchema);
