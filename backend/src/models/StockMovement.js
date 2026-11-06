import mongoose from 'mongoose';

const stockMovementSchema = new mongoose.Schema(
  {
    productId: { type: mongoose.Schema.Types.ObjectId, ref: 'Product', required: true },
    type: { type: String, required: true, enum: ['sale', 'restock', 'adjustment', 'return'] },
    delta: {
      type: Number,
      required: true,
      validate: {
        validator: (value) => Number.isInteger(value) && value !== 0,
        message: 'delta must be a non-zero integer',
      },
    },
    unitPriceCents: { type: Number, min: 0 },
    at: { type: Date, required: true },
    day: { type: String, required: true },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    note: { type: String, maxlength: 200 },
    idempotencyKey: { type: String, maxlength: 64 },
    requestId: String,
  },
  { timestamps: true },
);

stockMovementSchema.index({ productId: 1, at: -1 });
stockMovementSchema.index(
  { idempotencyKey: 1 },
  { unique: true, partialFilterExpression: { idempotencyKey: { $type: 'string' } } },
);

export const StockMovement = mongoose.model('StockMovement', stockMovementSchema);
