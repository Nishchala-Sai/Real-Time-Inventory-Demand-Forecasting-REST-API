// The only place numbers are rounded. Everything else keeps full precision (see FORECASTING.md).
export function round(value) {
  if (typeof value === 'number') return Math.round(value * 100) / 100;
  if (Array.isArray(value)) return value.map(round);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, inner]) => [key, round(inner)]));
  }
  return value;
}
