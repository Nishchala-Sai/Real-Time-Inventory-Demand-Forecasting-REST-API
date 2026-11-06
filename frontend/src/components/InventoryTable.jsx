import { useState } from 'react';

export default function InventoryTable({ products, flashing = [] }) {
  const [lowOnly, setLowOnly] = useState(false);
  const rows = lowOnly ? products.filter((product) => product.status === 'low') : products;

  return (
    <div className="card">
      <div className="card-heading">
        <h2 className="card-title">Real-Time Inventory Status</h2>
        <label className="checkbox">
          <input type="checkbox" checked={lowOnly} onChange={(e) => setLowOnly(e.target.checked)} />
          Low stock only
        </label>
      </div>
      <div className="table-wrapper">
        <table className="inventory-table">
          <thead>
            <tr>
              <th>SKU</th>
              <th>Product Name</th>
              <th>Current Stock</th>
              <th>Reorder Point</th>
              <th>Days of Cover</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((product) => {
              const isLow = product.status === 'low';
              return (
                <tr key={product.sku} className={flashing.includes(product.sku) ? 'row-flash' : undefined}>
                  <td className="sku-code">{product.sku}</td>
                  <td className="product-name">{product.name}</td>
                  <td>{product.currentStock} units</td>
                  <td>{product.reorderPoint} units</td>
                  <td>{product.daysOfCover ?? '—'}</td>
                  <td>
                    <span className={`badge ${isLow ? 'badge-reorder' : 'badge-optimal'}`}>
                      {isLow ? 'Reorder Needed' : 'Optimal'}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
