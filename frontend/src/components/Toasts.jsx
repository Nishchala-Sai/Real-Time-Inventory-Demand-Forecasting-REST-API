export default function Toasts({ toasts }) {
  return (
    <div className="toasts" aria-live="polite">
      {toasts.map((toast) => <div key={toast.id} className="toast">{toast.text}</div>)}
    </div>
  );
}
