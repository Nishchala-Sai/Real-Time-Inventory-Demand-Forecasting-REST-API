export default function ProductPicker({ products, value, onChange }) {
  return (
    <label className="field">
      Product
      <select value={value ?? ''} onChange={(e) => onChange(e.target.value)}>
        {products.map((product) => (
          <option key={product.sku} value={product.sku}>
            {product.sku} · {product.name}
          </option>
        ))}
      </select>
    </label>
  );
}
