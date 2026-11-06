import { Line } from 'react-chartjs-2';
import {
  Chart as ChartJS,
  CategoryScale,
  Filler,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend,
} from 'chart.js';

ChartJS.register(CategoryScale, Filler, LinearScale, PointElement, LineElement, Title, Tooltip, Legend);

const LOWER_LABEL = 'Lower bound';

function modelLabel(method, { alpha, beta, window } = {}) {
  if (method === 'sma') return `SMA (k=${window})`;
  if (method === 'ses') return `SES (α=${alpha.toFixed(2)})`;
  if (method === 'holt') return `Holt (α=${alpha.toFixed(2)}, β=${beta.toFixed(2)})`;
  if (method === 'croston') return `Croston (α=${alpha.toFixed(2)})`;
  return `New product (k=${window})`;
}

const chartOptions = {
  responsive: true,
  animation: false,
  elements: { point: { radius: 0, hitRadius: 8 } },
  interaction: { mode: 'index', intersect: false },
  plugins: {
    legend: {
      labels: { color: '#d1d5db', filter: (item) => item.text !== LOWER_LABEL },
    },
    title: { display: true, text: 'Demand: actual, fitted and forecast', color: '#f3f4f6' },
  },
  scales: {
    x: { ticks: { color: '#9ca3af', maxTicksLimit: 12 }, grid: { color: '#374151' } },
    y: { beginAtZero: true, ticks: { color: '#9ca3af' }, grid: { color: '#374151' } },
  },
};

export default function ForecastChart({ history, forecast, method, params }) {
  const label = modelLabel(method, params);
  const padHistory = history.map(() => null);
  const padForecast = forecast.map(() => null);

  const data = {
    labels: [...history.map((point) => point.day), ...forecast.map((point) => point.day)],
    datasets: [
      {
        label: 'Actual sales',
        data: [...history.map((point) => point.actual), ...padForecast],
        borderColor: '#3b82f6',
        backgroundColor: '#3b82f6',
        borderWidth: 2,
      },
      {
        label: `${label} fitted`,
        data: [...history.map((point) => point.fitted), ...padForecast],
        borderColor: '#10b981',
        backgroundColor: '#10b981',
        borderWidth: 1.5,
      },
      {
        label: `${label} forecast`,
        data: [...padHistory, ...forecast.map((point) => point.value)],
        borderColor: '#f59e0b',
        backgroundColor: '#f59e0b',
        borderDash: [6, 4],
        borderWidth: 2,
        pointRadius: 2,
      },
      {
        label: LOWER_LABEL,
        data: [...padHistory, ...forecast.map((point) => point.lower)],
        borderColor: 'transparent',
        pointRadius: 0,
      },
      {
        label: '80% range',
        data: [...padHistory, ...forecast.map((point) => point.upper)],
        borderColor: 'transparent',
        backgroundColor: 'rgba(245, 158, 11, 0.18)',
        pointRadius: 0,
        fill: '-1',
      },
    ],
  };

  return <Line data={data} options={chartOptions} />;
}
