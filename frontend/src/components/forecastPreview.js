import { addDays, explain, intervals, metrics, ses } from '@inventory/forecast';

const PREVIEW_HOLDOUT = 14;

// Same shape as the fields of the API response that the panel draws, computed in the browser
// so dragging the slider needs no request and cannot disagree with the server's maths.
export function previewForecast(data, alpha, horizon) {
  const days = data.history.map((point) => point.day);
  const y = data.history.map((point) => point.actual);
  const params = { alpha };
  const model = ses(y, { alpha, horizon });
  const { points } = intervals({ ...model, method: 'ses' });
  const holdout = Math.min(PREVIEW_HOLDOUT, Math.floor(y.length / 2));
  return {
    method: 'ses',
    params,
    history: data.history.map((point, i) => ({ ...point, fitted: model.fitted[i] })),
    forecast: points.map((point, i) => ({ day: addDays(data.asOf, i + 1), ...point })),
    metrics: {
      holdout: holdout > 0 ? metrics(y.slice(-holdout), model.fitted.slice(-holdout)) : null,
    },
    explanation: explain({ method: 'ses', params, y, days, current: model.forecast[0] }),
  };
}
