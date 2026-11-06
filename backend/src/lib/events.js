import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';

const CHANNEL = 'event';
const bus = new EventEmitter();
bus.setMaxListeners(0);

export function publish(type, product, data) {
  bus.emit(CHANNEL, {
    id: randomUUID(),
    type,
    at: new Date().toISOString(),
    sku: product.sku,
    supplierId: product.supplierId ? String(product.supplierId) : null,
    data,
  });
}

export function subscribe(listener) {
  bus.on(CHANNEL, listener);
  return () => bus.off(CHANNEL, listener);
}

export function listenerCount() {
  return bus.listenerCount(CHANNEL);
}
