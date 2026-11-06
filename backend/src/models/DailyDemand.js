import mongoose from 'mongoose';

// Rows exist only for days with sales. Gaps mean zero and are filled in code.
const dailyDemandSchema = new mongoose.Schema({
  productId: { type: mongoose.Schema.Types.ObjectId, ref: 'Product', required: true },
  day: { type: String, required: true },
  qty: { type: Number, required: true, min: 0 },
});

dailyDemandSchema.index({ productId: 1, day: 1 }, { unique: true });

export const DailyDemand = mongoose.model('DailyDemand', dailyDemandSchema);
