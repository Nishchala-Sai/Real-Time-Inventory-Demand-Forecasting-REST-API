const Z_80 = 1.2816;

function spread(method, sigma, h, { alpha, beta }) {
  if (method === 'ses') return sigma * Math.sqrt(1 + (h - 1) * alpha ** 2);
  if (method === 'holt') {
    let sum = 1;
    for (let j = 1; j < h; j++) sum += alpha ** 2 * (1 + j * beta) ** 2;
    return sigma * Math.sqrt(sum);
  }
  return sigma * Math.sqrt(h);
}

/**
 * 80% prediction interval for each forecast step, with the lower bound clamped at 0.
 * @param {{method: string, forecast: number[], sigma: number, params?: object}} model
 * @returns {{points: {value: number, lower: number, upper: number}[], intervalMethod: 'exact'|'approx'}}
 */
export function intervals({ method, forecast, sigma, params = {} }) {
  const points = forecast.map((value, i) => {
    const width = Z_80 * spread(method, sigma, i + 1, params);
    return { value, lower: Math.max(0, value - width), upper: value + width };
  });
  return { points, intervalMethod: method === 'ses' || method === 'holt' ? 'exact' : 'approx' };
}
