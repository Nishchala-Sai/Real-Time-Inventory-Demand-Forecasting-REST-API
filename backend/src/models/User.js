import mongoose from 'mongoose';

const userSchema = new mongoose.Schema(
  {
    email: { type: String, required: true, lowercase: true, trim: true, unique: true },
    passwordHash: { type: String, required: true, select: false },
    role: { type: String, required: true, enum: ['admin', 'manager', 'supplier'] },
    supplierId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Supplier',
      required() {
        return this.role === 'supplier';
      },
      validate: {
        validator(value) {
          return value === null || this.role === 'supplier';
        },
        message: 'supplierId is only allowed for the supplier role',
      },
    },
    disabled: { type: Boolean, default: false },
    tokenVersion: { type: Number, default: 0 },
  },
  { timestamps: true },
);

export const User = mongoose.model('User', userSchema);
