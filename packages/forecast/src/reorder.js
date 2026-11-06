const SERVICE_Z = { 0.9: 1.2816, 0.95: 1.6449, 0.975: 1.96, 0.99: 2.3263 };

function demandOver(days, forecast) {
  let total = 0;
  for (let i = 0; i < days; i++) total += forecast[Math.min(i, forecast.length - 1)] ?? 0;
  return total;
}

/**
 * Reorder point and order quantity for a periodic-review policy. The forecast is
 * extended flat when the horizon is shorter than the period needed.
 * @param {{forecast: number[], sigma: number, leadTimeDays: number, reviewPeriodDays: number,
 *   serviceLevel: number, currentStock: number}} input
 * @returns {{demandLT: number, safetyStock: number, reorderPoint: number, orderUpTo: number,
 *   suggestedOrderQty: number, daysOfCover: number|null}}
 */
export function reorder({ forecast, sigma, leadTimeDays, reviewPeriodDays, serviceLevel, currentStock }) {
  const demandLT = demandOver(leadTimeDays, forecast);
  const safetyStock = SERVICE_Z[serviceLevel] * sigma * Math.sqrt(leadTimeDays);
  const orderUpTo = demandOver(leadTimeDays + reviewPeriodDays, forecast) + safetyStock;
  const daily = forecast[0] ?? 0;
  return {
    demandLT,
    safetyStock,
    reorderPoint: Math.ceil(demandLT + safetyStock),
    orderUpTo,
    suggestedOrderQty: Math.max(0, Math.ceil(orderUpTo - currentStock)),
    daysOfCover: daily > 0 ? currentStock / daily : null,
  };
}
