import mongoose from 'mongoose';

mongoose.set('strictQuery', true);
mongoose.set('sanitizeFilter', true);

export function connectDb(uri) {
  return mongoose.connect(uri, { serverSelectionTimeoutMS: 5000 });
}

export function disconnectDb() {
  return mongoose.disconnect();
}

export async function pingDb() {
  if (mongoose.connection.readyState !== 1) return false;
  try {
    await mongoose.connection.db.command({ ping: 1 });
    return true;
  } catch {
    return false;
  }
}
