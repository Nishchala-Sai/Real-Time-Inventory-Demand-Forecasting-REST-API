import { useState } from 'react';
import { request } from '../api';

const MAX_QTY = 5;

export default function SimulateSale({ products }) {
  const [message, setMessage] = useState(null);
  const [busy, setBusy] = useState(false);

  async function simulate() {
    const inStock = products.filter((product) => product.currentStock > 0);
    if (inStock.length === 0) {
      setMessage('Nothing is in stock to sell.');
      return;
    }
    const product = inStock[Math.floor(Math.random() * inStock.length)];
    const qty = Math.min(product.currentStock, 1 + Math.floor(Math.random() * MAX_QTY));
    setBusy(true);
    try {
      await request('POST', '/stock-movements', { sku: product.sku, type: 'sale', qty });
      setMessage(`Sold ${qty} × ${product.name}.`);
    } catch (failure) {
      setMessage(failure.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card simulate">
      <button type="button" className="button" disabled={busy || products.length === 0} onClick={simulate}>
        Simulate sale
      </button>
      {message && <span className="muted" role="status">{message}</span>}
    </div>
  );
}
