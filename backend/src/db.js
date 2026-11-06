import mongoose from 'mongoose';

mongoose.set('strictQuery', true);
mongoose.set('sanitizeFilter', true);

export async function connectDb(uri) {
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 5000 });
  // Transactions cannot rely on indexes or collections that are still being created.
  await Promise.all(Object.values(mongoose.models).map((model) => model.init()));
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
