import { useState } from 'react';
import { addDays, ses, sma } from '@inventory/forecast';
import InventoryTable from './components/InventoryTable';
import ForecastChart from './components/ForecastChart';
import { mockProducts, mockSalesHistory } from './data/mockData';

const SMA_WINDOW = 3;
const HORIZON = 7;

export default function App() {
  const [alpha, setAlpha] = useState(0.3);

  const rawSales = mockSalesHistory.map(item => item.sales);
  const lastDay = mockSalesHistory.at(-1).date;
  const labels = [
    ...mockSalesHistory.map(item => item.date),
    ...Array.from({ length: HORIZON }, (_, i) => addDays(lastDay, i + 1)),
  ];
  const smaModel = sma(rawSales, { window: SMA_WINDOW, horizon: HORIZON });
  const sesModel = ses(rawSales, { alpha, horizon: HORIZON });

  return (
    <div className="dashboard-container">
      <header className="dashboard-header">
        <h1 className="dashboard-title">
          Inventory & Demand Forecasting Engine
        </h1>
        <p className="dashboard-subtitle">
          Real-time stock analytics and mathematical demand predictions.
        </p>
      </header>

      <InventoryTable products={mockProducts} />

      <div className="card">
        <label className="slider-label">
          Adjust Smoothing Factor (α = {alpha})
          <input
            type="range"
            min="0.1"
            max="0.9"
            step="0.1"
            value={alpha}
            onChange={(e) => setAlpha(parseFloat(e.target.value))}
            className="slider-input"
          />
        </label>
      </div>

      <ForecastChart
        labels={labels}
        actual={rawSales}
        smaSeries={[...smaModel.fitted, ...smaModel.forecast]}
        sesSeries={[...sesModel.fitted, ...sesModel.forecast]}
        alpha={alpha}
        smaWindow={SMA_WINDOW}
      />
    </div>
  );
}
