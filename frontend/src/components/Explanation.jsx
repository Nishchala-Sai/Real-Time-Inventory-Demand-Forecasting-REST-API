export default function Explanation({ explanation }) {
  const { summary, weights, notes } = explanation;
  return (
    <section className="explanation" aria-label="Why this forecast">
      <h3 className="section-title">Why this forecast</h3>
      <p>{summary}</p>
      {notes.length > 0 && (
        <ul>
          {notes.map((note) => <li key={note}>{note}</li>)}
        </ul>
      )}
      {weights.length > 0 && (
        <p className="muted">
          Recent day weights:{' '}
          {weights.map(({ day, weight }) => `${day.slice(5)} ${(weight * 100).toFixed(0)}%`).join(' · ')}
        </p>
      )}
    </section>
  );
}
