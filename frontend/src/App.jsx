import { useState } from 'react';
import InventoryTable from './components/InventoryTable';
import ForecastChart from './components/ForecastChart';
import { mockProducts, mockSalesHistory } from './data/mockData';
import { calculateSMA, calculateExponentialSmoothing } from './utils/themath';

const SMA_WINDOW = 3;

export default function App() {
  const [alpha, setAlpha] = useState(0.3);

  const rawSales = mockSalesHistory.map(item => item.sales);
  const smaForecast = calculateSMA(rawSales, SMA_WINDOW);
  const expForecast = calculateExponentialSmoothing(rawSales, alpha);

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
        </label>
        <input
          type="range"
          min="0.1"
          max="0.9"
          step="0.1"
          value={alpha}
          onChange={(e) => setAlpha(parseFloat(e.target.value))}
          className="slider-input"
        />
      </div>

      <ForecastChart
        salesHistory={mockSalesHistory}
        smaForecast={smaForecast}
        expForecast={expForecast}
        alpha={alpha}
        smaWindow={SMA_WINDOW}
      />
    </div>
  );
}