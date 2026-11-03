import { formatDuration } from '../workspaceModel.js'

export function TimeChart({ runs, selectedId, onSelect }) {
  const items = runs.slice(-8)
  if (!items.length)
    return (
      <div className="chart-empty">Your run comparisons will appear here.</div>
    )
  const max = Math.max(
    0.01,
    ...items.map((run) => Math.max(run.fullEstimate, run.selectedEstimate)),
  )
  const slot = 600 / items.length
  return (
    <>
      <svg
        viewBox="0 0 640 200"
        role="group"
        aria-label="Estimated full-suite time compared with selected test time"
      >
        {[0, 1, 2].map((index) => (
          <line
            key={index}
            x1="20"
            x2="620"
            y1={24 + index * 67}
            y2={24 + index * 67}
            stroke="rgba(255,255,255,.06)"
          />
        ))}
        {items.map((run, index) => (
          <g
            key={run.planId}
            role="button"
            tabIndex="0"
            aria-label={`Open run ${run.number}`}
            className={`chart-group ${selectedId === run.planId ? 'on' : ''}`}
            onClick={() => onSelect?.(run)}
            onKeyDown={(event) => {
              if (['Enter', ' '].includes(event.key)) {
                event.preventDefault()
                onSelect?.(run)
              }
            }}
          >
            <rect
              className="hit"
              x={20 + index * slot}
              y="10"
              width={slot - 4}
              height="180"
              rx="8"
            />
            <rect
              x={20 + index * slot + slot * 0.18}
              y={166 - (run.fullEstimate / max) * 140}
              width={Math.min(22, slot * 0.25)}
              height={Math.max(2, (run.fullEstimate / max) * 140)}
              rx="3"
              fill="#475569"
            />
            <rect
              x={20 + index * slot + slot * 0.5}
              y={166 - (run.selectedEstimate / max) * 140}
              width={Math.min(22, slot * 0.25)}
              height={Math.max(2, (run.selectedEstimate / max) * 140)}
              rx="3"
              fill="#38bdf8"
            />
            <text
              x={20 + index * slot + slot * 0.45}
              y="188"
              fill="#8b9ab3"
              textAnchor="middle"
              fontSize="11"
            >
              #{run.number}
            </text>
            <title>{`Run ${run.number}: ${formatDuration(run.fullEstimate)} full-suite estimate; ${formatDuration(run.selectedEstimate)} selected estimate`}</title>
          </g>
        ))}
      </svg>
      <div className="leg">
        <span>
          <i style={{ background: '#475569' }} />
          Full suite estimate
        </span>
        <span>
          <i style={{ background: '#38bdf8' }} />
          Selected estimate
        </span>
      </div>
    </>
  )
}
