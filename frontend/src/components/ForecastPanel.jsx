import { useState } from 'react';
import { request } from '../api';
import { useFetch } from '../hooks/useFetch';
import Explanation from './Explanation';
import ForecastChart from './ForecastChart';
import { previewForecast } from './forecastPreview';

const METHODS = ['auto', 'sma', 'ses', 'holt', 'croston'];
const HORIZONS = [7, 14, 30];

const fixed = (value, digits = 2) => (value === null || value === undefined ? '—' : value.toFixed(digits));

export default function ForecastPanel({ sku, canEdit, refreshKey }) {
  const [method, setMethod] = useState('auto');
  const [horizon, setHorizon] = useState(7);
  const [previewAlpha, setPreviewAlpha] = useState(null);
  const [tuneVersion, setTuneVersion] = useState(0);
  const [message, setMessage] = useState(null);
  const { data, error } = useFetch(
    `/forecast/${sku}?method=${method}&horizon=${horizon}`,
    `${refreshKey}-${tuneVersion}`,
  );

  if (error && !data) return <div className="card"><p className="error-text" role="alert">{error.message}</p></div>;
  if (!data) return <div className="card">Loading forecast…</div>;

  const shown = previewAlpha === null ? data : { ...data, ...previewForecast(data, previewAlpha, horizon) };
  const holdout = shown.metrics.holdout;
  const alpha = previewAlpha ?? shown.params.alpha ?? data.live.alpha;

  async function tune(body) {
    try {
      const result = await request('POST', `/forecast/${sku}/tune`, body);
      setPreviewAlpha(null);
      setTuneVersion((version) => version + 1);
      setMessage(`Saved α = ${result.alpha.toFixed(2)}.`);
    } catch (failure) {
      setMessage(failure.message);
    }
  }

  return (
    <div className="card">
      <div className="controls">
        <label className="field">
          Method
          <select
            value={method}
            onChange={(e) => {
              setMethod(e.target.value);
              setPreviewAlpha(null);
            }}
          >
            {METHODS.map((name) => <option key={name} value={name}>{name}</option>)}
          </select>
        </label>
        <label className="field">
          Horizon (days)
          <select value={horizon} onChange={(e) => setHorizon(Number(e.target.value))}>
            {HORIZONS.map((days) => <option key={days} value={days}>{days}</option>)}
          </select>
        </label>
        <label className="field field-grow">
          Preview SES with α = {alpha.toFixed(2)}
          <input
            type="range"
            min="0.01"
            max="0.99"
            step="0.01"
            value={alpha}
            onChange={(e) => setPreviewAlpha(Number(e.target.value))}
            className="slider-input"
          />
        </label>
        {canEdit && (
          <div className="button-row">
            <button type="button" className="button" disabled={previewAlpha === null} onClick={() => tune({ alpha: previewAlpha })}>
              Apply α
            </button>
            <button type="button" className="button button-quiet" onClick={() => tune({})}>Auto-tune α</button>
          </div>
        )}
      </div>
      {message && <p className="muted" role="status">{message}</p>}

      <ForecastChart history={shown.history} forecast={shown.forecast} method={shown.method} params={shown.params} />

      <dl className="stats">
        <div><dt>Holdout MAE</dt><dd>{fixed(holdout?.mae)}</dd></div>
        <div><dt>Holdout WAPE</dt><dd>{holdout?.wape === null || holdout?.wape === undefined ? '—' : `${(holdout.wape * 100).toFixed(0)}%`}</dd></div>
        <div><dt>Holdout bias</dt><dd>{fixed(holdout?.bias)}</dd></div>
        <div><dt>Confidence</dt><dd><span className={`badge badge-${data.confidence}`}>{data.confidence}</span></dd></div>
        <div><dt>Reorder point</dt><dd>{data.reorder.reorderPoint}</dd></div>
        <div><dt>Suggested order</dt><dd>{data.reorder.suggestedOrderQty} units</dd></div>
      </dl>
      {data.provisional && <p className="muted">Today is still open, so this forecast is provisional.</p>}

      <Explanation explanation={shown.explanation} />
    </div>
  );
}
