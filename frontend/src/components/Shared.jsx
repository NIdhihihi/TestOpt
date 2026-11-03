import { PAGES, STAGES } from '../workspaceModel.js'

export function Logo() {
  return (
    <span className="logo">
      <i />
      TestOpt
    </span>
  )
}

export function Navigation({ page, compact = false }) {
  return (
    <nav className={compact ? 'nav' : 'side-links'} aria-label="Main">
      {PAGES.map(([key, label]) => (
        <a
          key={key}
          href={`#${key}`}
          className={page === key ? 'on' : ''}
          aria-current={page === key ? 'page' : undefined}
        >
          {label}
        </a>
      ))}
    </nav>
  )
}

export function Chip({ status }) {
  return (
    <span
      className={`chip ${['Run', 'PASSED', 'COMPLETED'].includes(status) ? 'go' : ['FAILED', 'ERROR'].includes(status) ? 'failed' : ['INCOMPLETE', 'QUEUED', 'EXECUTING', 'PLANNED', 'Waiting'].includes(status) ? 'pending' : ''}`}
    >
      {{
        COMPLETED: 'Completed',
        FAILED: 'Tests failed',
        ERROR: 'Execution error',
        INCOMPLETE: 'Incomplete',
        PLANNED: 'Ready for approval',
        QUEUED: 'Queued',
        EXECUTING: 'Running',
        REJECTED: 'Rejected',
      }[status] || status}
    </span>
  )
}

export function Empty({ title, children, action }) {
  return (
    <div className="empty">
      <div className="empty-symbol">◇</div>
      <h2>{title}</h2>
      <p>{children}</p>
      {action}
    </div>
  )
}

export function Score({ value }) {
  return value == null ? (
    <span className="muted">Not scored</span>
  ) : (
    <>
      <span className="score-bar">
        <i style={{ width: `${Math.min(100, value * 100)}%` }} />
      </span>
      {Number(value).toFixed(2)}
    </>
  )
}

export function PipelineStrip({ model, current }) {
  const note = !model.analysis
    ? 'Upload your source project to start.'
    : !current
      ? 'Source and dependencies inspected. Run the optimizer to prepare a test plan.'
      : current.status === 'PLANNED'
        ? 'Plan ready. Review the selected tests and approve execution.'
        : current.status === 'EXECUTING'
          ? 'Assigned test files are running in isolated containers.'
          : current.status === 'QUEUED'
            ? 'Waiting for an execution worker.'
            : `${current.status === 'COMPLETED' ? 'Run completed' : 'Run needs review'}. ${current.results?.length || 0} actual file results recorded.`
  return (
    <>
      <div className="pipe">
        {STAGES.map((stage, index) => (
          <div
            key={stage.name}
            className={`stg ${index < model.activeStage || (index === 5 && model.activeStage === 5) ? 'done' : index === model.activeStage ? 'act' : ''}`}
            style={{ '--c': stage.color }}
          >
            <i />
            {stage.name}
          </div>
        ))}
      </div>
      <p className="note">{note}</p>
    </>
  )
}
