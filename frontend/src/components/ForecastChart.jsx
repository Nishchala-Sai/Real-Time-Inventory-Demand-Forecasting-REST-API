import { Line } from 'react-chartjs-2';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend
} from 'chart.js';

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Title, Tooltip, Legend);

export default function ForecastChart({ salesHistory, smaForecast, expForecast, alpha, smaWindow }) {
  const chartData = {
    labels: salesHistory.map(d => d.date),
    datasets: [
      {
        label: 'Actual Sales',
        data: salesHistory.map(d => d.sales),
        borderColor: '#3b82f6',
        backgroundColor: '#3b82f6',
        tension: 0.2
      },
      {
        label: `SMA Forecast (k=${smaWindow})`,
        data: smaForecast,
        borderColor: '#f59e0b',
        borderDash: [5, 5],
        tension: 0.2
      },
      {
        label: `Exp Smoothing (α=${alpha})`,
        data: expForecast,
        borderColor: '#10b981',
        tension: 0.2
      }
    ]
  };

  const options = {
    responsive: true,
    plugins: {
      legend: { labels: { color: '#d1d5db' } },
      title: { display: true, text: 'Demand Forecasting Comparison', color: '#f3f4f6' }
    },
    scales: {
      x: { ticks: { color: '#9ca3af' }, grid: { color: '#374151' } },
      y: { ticks: { color: '#9ca3af' }, grid: { color: '#374151' } }
    }
  };

  return (
    <div className="card">
      <Line data={chartData} options={options} />
    </div>
  );
}