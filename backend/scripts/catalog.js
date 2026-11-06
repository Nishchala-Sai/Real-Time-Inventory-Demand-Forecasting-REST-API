export const HISTORY_DAYS = 120;

export function mulberry32(seed) {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const whole = (value) => Math.max(0, Math.round(value));
const noise = (rand, spread) => (rand() - 0.5) * 2 * spread;

const steady = (mean, spread) => (t, rand) => whole(mean + noise(rand, spread));
const trending = (start, slope, spread) => (t, rand) => whole(start + slope * t + noise(rand, spread));
const seasonal = (mean, swing, spread) => (t, rand) =>
  whole(mean + swing * Math.sin((2 * Math.PI * t) / 7) + noise(rand, spread));
const intermittent = (chance, maxQty) => (t, rand) => (rand() < chance ? 1 + Math.floor(rand() * maxQty) : 0);

export const CATALOG = [
  { sku: 'P101', name: 'Mechanical Keyboard', category: 'peripherals', unitPriceCents: 8999, supplier: 0, stock: 900, shape: trending(10, 0.5, 2) },
  { sku: 'P102', name: 'Wireless Gaming Mouse', category: 'peripherals', unitPriceCents: 4999, supplier: 0, stock: 420, shape: steady(22, 5) },
  { sku: 'P103', name: 'UltraWide Monitor 34"', category: 'displays', unitPriceCents: 49999, supplier: 1, stock: 3, shape: intermittent(0.25, 3) },
  { sku: 'P104', name: 'USB-C Docking Station', category: 'accessories', unitPriceCents: 12999, supplier: 2, stock: 300, shape: seasonal(18, 8, 2) },
  { sku: 'P105', name: 'Webcam 4K', category: 'peripherals', unitPriceCents: 11999, supplier: 0, stock: 260, shape: seasonal(14, 6, 2) },
  { sku: 'P106', name: '27-inch 4K Monitor', category: 'displays', unitPriceCents: 39999, supplier: 1, stock: 60, shape: steady(5, 2) },
  { sku: 'P107', name: 'Monitor Arm', category: 'displays', unitPriceCents: 7999, supplier: 1, stock: 40, shape: intermittent(0.35, 4) },
  { sku: 'P108', name: 'Laptop Stand', category: 'accessories', unitPriceCents: 3999, supplier: 2, stock: 240, shape: steady(12, 3) },
  { sku: 'P109', name: 'USB-C Cable 2m', category: 'accessories', unitPriceCents: 1499, supplier: 2, stock: 45, shape: steady(30, 6) },
  { sku: 'P110', name: 'Smart Desk Lamp', category: 'accessories', unitPriceCents: 5999, supplier: 2, stock: 80, historyDays: 5, shape: steady(4, 2) },
];
