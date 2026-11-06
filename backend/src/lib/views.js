import { round } from './round.js';

export function userView(user) {
  return {
    id: String(user._id),
    email: user.email,
    role: user.role,
    supplierId: user.supplierId ? String(user.supplierId) : null,
    disabled: user.disabled,
  };
}

export function supplierView(supplier) {
  return {
    id: String(supplier._id),
    name: supplier.name,
    contactEmail: supplier.contactEmail ?? null,
  };
}

export function stockView(product) {
  const next = product.forecast?.next ?? 0;
  return {
    sku: product.sku,
    currentStock: product.currentStock,
    reorderPoint: product.reorderPoint,
    status: product.currentStock <= product.reorderPoint ? 'low' : 'ok',
    daysOfCover: next > 0 ? round(product.currentStock / next) : null,
  };
}

export function productView(product) {
  return {
    ...stockView(product),
    name: product.name,
    category: product.category,
    unitPriceCents: product.unitPriceCents,
    leadTimeDays: product.leadTimeDays,
    reviewPeriodDays: product.reviewPeriodDays,
    serviceLevel: product.serviceLevel,
    reorderPointOverride: product.reorderPointOverride,
    supplierId: product.supplierId ? String(product.supplierId) : null,
    alpha: product.forecast?.alpha,
  };
}

export function movementView(movement) {
  return {
    id: String(movement._id),
    type: movement.type,
    delta: movement.delta,
    unitPriceCents: movement.unitPriceCents ?? null,
    at: movement.at,
    day: movement.day,
    note: movement.note ?? null,
  };
}

export function alertView(alert) {
  return {
    id: String(alert._id),
    sku: alert.productId?.sku ?? null,
    name: alert.productId?.name ?? null,
    type: alert.type,
    status: alert.status,
    stockAtOpen: alert.stockAtOpen,
    reorderPointAtOpen: alert.reorderPointAtOpen,
    createdAt: alert.createdAt,
    resolvedAt: alert.resolvedAt ?? null,
  };
}

// Fetch `limit + 1` rows and pass them here, so "is there another page" needs no count query.
export function page(rows, limit, cursorOf, view) {
  const items = rows.slice(0, limit);
  return {
    items: items.map(view),
    next: rows.length > limit ? cursorOf(items.at(-1)) : null,
  };
}
