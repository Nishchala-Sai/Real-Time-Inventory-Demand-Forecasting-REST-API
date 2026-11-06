import { Alert } from '../models/Alert.js';

const LOW_STOCK = 'low_stock';

// Opens or resolves at most one alert. Returns which change happened so the caller can
// emit an event after commit, or null when nothing changed.
export async function syncAlert(product, session = null) {
  const open = await Alert.findOne({ productId: product._id, type: LOW_STOCK, status: 'open' }).session(session);
  const low = product.currentStock <= product.reorderPoint;
  if (low && !open) {
    const [alert] = await Alert.create(
      [
        {
          productId: product._id,
          type: LOW_STOCK,
          status: 'open',
          stockAtOpen: product.currentStock,
          reorderPointAtOpen: product.reorderPoint,
        },
      ],
      { session },
    );
    return { change: 'opened', alert };
  }
  if (!low && open) {
    open.status = 'resolved';
    open.resolvedAt = new Date();
    await open.save({ session });
    return { change: 'resolved', alert: open };
  }
  return null;
}
