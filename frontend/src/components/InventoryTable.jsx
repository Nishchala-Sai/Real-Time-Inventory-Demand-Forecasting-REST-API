export default function InventoryTable({ products }) {
  return (
    <div className="card">
      <h2 className="card-title">Real-Time Inventory Status</h2>
      <div className="table-wrapper">
        <table className="inventory-table">
          <thead>
            <tr>
              <th>SKU</th>
              <th>Product Name</th>
              <th>Current Stock</th>
              <th>Reorder Point</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {products.map((item) => {
              const isLowStock = item.currentStock <= item.reorderPoint;
              return (
                <tr key={item.id}>
                  <td className="sku-code">{item.id}</td>
                  <td className="product-name">{item.name}</td>
                  <td>{item.currentStock} units</td>
                  <td>{item.reorderPoint} units</td>
                  <td>
                    <span className={`badge ${isLowStock ? 'badge-reorder' : 'badge-optimal'}`}>
                      {isLowStock ? 'Reorder Needed' : 'Optimal'}
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