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

// Fetch `limit + 1` rows and pass them here, so "is there another page" needs no count query.
export function page(rows, limit, cursorOf, view) {
  const items = rows.slice(0, limit);
  return {
    items: items.map(view),
    next: rows.length > limit ? cursorOf(items.at(-1)) : null,
  };
}
