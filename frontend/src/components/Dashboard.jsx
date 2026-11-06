import { useEffect, useRef, useState } from 'react';
import { useFetch } from '../hooks/useFetch';
import { useLiveEvents } from '../hooks/useLiveEvents';
import ForecastPanel from './ForecastPanel';
import InventoryTable from './InventoryTable';
import ProductPicker from './ProductPicker';
import SimulateSale from './SimulateSale';
import Toasts from './Toasts';

const FLASH_MS = 1200;
const TOAST_MS = 6000;
const FORECAST_DEBOUNCE_MS = 1000;

export default function Dashboard({ user, onLogout }) {
  const [listVersion, setListVersion] = useState(0);
  const [liveStock, setLiveStock] = useState({});
  const [flashing, setFlashing] = useState([]);
  const [toasts, setToasts] = useState([]);
  const [chosenSku, setChosenSku] = useState(null);
  const [forecastVersion, setForecastVersion] = useState(0);
  const forecastTimer = useRef(null);
  const { data, error } = useFetch('/products?limit=100', listVersion);

  const products = (data?.items ?? []).map((product) => ({ ...product, ...liveStock[product.sku] }));
  const selectedSku = chosenSku ?? products[0]?.sku ?? null;
  const canEdit = user.role === 'admin' || user.role === 'manager';

  useEffect(() => () => clearTimeout(forecastTimer.current), []);

  function handleEvent(event) {
    if (event.type === 'stock.updated') {
      setLiveStock((current) => ({ ...current, [event.sku]: event.data }));
      setFlashing((current) => [...current, event.sku]);
      setTimeout(() => {
        setFlashing((current) => {
          const index = current.indexOf(event.sku);
          return current.filter((_, i) => i !== index);
        });
      }, FLASH_MS);
    }
    if (event.type === 'forecast.updated' && event.sku === selectedSku) {
      clearTimeout(forecastTimer.current);
      forecastTimer.current = setTimeout(() => setForecastVersion((version) => version + 1), FORECAST_DEBOUNCE_MS);
    }
    if (event.type === 'alert.opened') {
      const { name, currentStock, reorderPoint } = event.data;
      const toast = { id: event.id, text: `Low stock: ${name} has ${currentStock} left (reorder point ${reorderPoint}).` };
      setToasts((current) => [...current, toast]);
      setTimeout(() => setToasts((current) => current.filter((item) => item.id !== toast.id)), TOAST_MS);
    }
  }

  useLiveEvents({
    onEvent: handleEvent,
    onReconnect: () => {
      setLiveStock({});
      setListVersion((version) => version + 1);
      setForecastVersion((version) => version + 1);
    },
  });

  return (
    <div className="dashboard-container">
      <header className="dashboard-header">
        <div>
          <h1 className="dashboard-title">Inventory & Demand Forecasting Engine</h1>
          <p className="dashboard-subtitle">Real-time stock analytics and explainable demand forecasts.</p>
        </div>
        <div className="user-box">
          <span>{user.email} ({user.role})</span>
          <button type="button" className="button button-quiet" onClick={onLogout}>Sign out</button>
        </div>
      </header>

      <Toasts toasts={toasts} />
      {error && <p className="error-text" role="alert">{error.message}</p>}
      {canEdit && <SimulateSale products={products} />}

      <InventoryTable products={products} flashing={flashing} />

      <div className="card">
        <ProductPicker products={products} value={selectedSku} onChange={setChosenSku} />
      </div>
      {selectedSku && <ForecastPanel key={selectedSku} sku={selectedSku} canEdit={canEdit} refreshKey={forecastVersion} />}
    </div>
  );
}
