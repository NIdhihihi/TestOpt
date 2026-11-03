export function Kpis({ items }) {
  return (
    <section className="kpis" aria-label="Key numbers">
      {items.map(([value, label, hint]) => (
        <div className="card kpi" key={label} title={hint}>
          <b>{value ?? '—'}</b>
          <span>{label}</span>
        </div>
      ))}
    </section>
  )
}

