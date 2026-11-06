export const forecastResponse = {
  sku: 'P101',
  method: 'ses',
  params: { alpha: 0.8 },
  asOf: '2026-10-24',
  provisional: false,
  confidence: 'medium',
  history: [
    { day: '2026-10-22', actual: 31, fitted: null },
    { day: '2026-10-23', actual: 29, fitted: 31 },
    { day: '2026-10-24', actual: 35, fitted: 29.4 },
  ],
  forecast: [
    { day: '2026-10-25', value: 33.83, lower: 27.1, upper: 40.56 },
    { day: '2026-10-26', value: 33.83, lower: 26, upper: 41 },
  ],
  intervalMethod: 'exact',
  metrics: { holdout: { mae: 4.28, rmse: 5.01, wape: 0.15, bias: -3.9, n: 14 } },
  leaderboard: [],
  reorder: { reorderPoint: 245, safetyStock: 12, suggestedOrderQty: 300, daysOfCover: 0.41 },
  live: { alpha: 0.3, next: 33.83, provisional: false },
  explanation: {
    summary: 'Expect about 33.8 units/day (SES, α=0.80). Up from 29.1 because 24 Oct sold 35, above the 29.1 expected.',
    weights: [{ day: '2026-10-24', weight: 0.8 }],
    change: {},
    notes: ['Holt beat SES on the holdout, but by under 1%, so the simpler model was kept.'],
  },
};

export const products = [
  { sku: 'P101', name: 'Mechanical Keyboard', currentStock: 14, reorderPoint: 20, status: 'low', daysOfCover: 0.5 },
  { sku: 'P102', name: 'Wireless Mouse', currentStock: 42, reorderPoint: 15, status: 'ok', daysOfCover: null },
];

export function jsonResponse(body, status = 200) {
  return new Response(body === null ? null : JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
