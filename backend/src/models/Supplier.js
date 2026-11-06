import mongoose from 'mongoose';

const supplierSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, minlength: 1, maxlength: 120 },
    contactEmail: { type: String, lowercase: true, trim: true },
  },
  { timestamps: true },
);

export const Supplier = mongoose.model('Supplier', supplierSchema);
