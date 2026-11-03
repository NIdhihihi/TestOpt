import { useState } from 'react'
import { Chip, Empty } from './Shared.jsx'
import { formatDate, shortPath } from '../workspaceModel.js'

function ExecutionOutput({ result }) {
  const [copy, setCopy] = useState(null)
  const output = result.output || result.message

  async function copyOutput() {
    try {
      await navigator.clipboard.writeText(output)
      setCopy({ result, message: 'Copied!' })
    } catch {
      setCopy({ result, message: 'Could not copy.' })
    }
  }

  return (
    <details open>
      <summary>Execution output</summary>
      <div className="terminal-box">
        <div className="terminal-header">
          <span className="terminal-dot red" />
          <span className="terminal-dot yellow" />
          <span className="terminal-dot green" />
          <span className="terminal-title">Console Output</span>
          {Number.isInteger(result.exitCode) && (
            <span
              className={`terminal-badge ${result.exitCode === 0 ? 'success' : 'fail'}`}
            >
              exit {result.exitCode}
            </span>
          )}
          {output && (
            <button
              className="btn terminal-copy"
              onClick={copyOutput}
              aria-label="Copy output"
            >
              {copy?.result === result ? copy.message : 'Copy output'}
            </button>
          )}
        </div>
        <pre className="terminal-content">{output || 'No output.'}</pre>
      </div>
      <p className="terminal-meta">
        {result.assertionCount ?? 0} assertions ·{' '}
        {result.coverageAvailable
          ? 'Coverage collected'
          : 'Coverage unavailable'}
      </p>
    </details>
  )
}

// The upload workflow uses the optimizer's default weights.
const SCORE_FACTORS = [
  ['Change relevance', 'relevance', '#38bdf8', 0.35],
  ['Module criticality', 'criticality', '#8b5cf6', 0.25],
  ['Historical failure rate', 'failureRate', '#fb7185', 0.15],
  ['Marginal coverage', 'marginalCoverage', '#fbbf24', 0.25],
]

export function TestDetails({ test }) {
  if (!test) {
    return (
      <aside className="card det">
        <Empty title="Explore a test">
          Select a test to see its valuation, selection reason, and actual
          results.
        </Empty>
      </aside>
    )
  }

  const hasFactors = SCORE_FACTORS.every(([, key]) =>
    Number.isFinite(test.factors?.[key]),
  )
  const weightedTotal = hasFactors
    ? SCORE_FACTORS.reduce(
        (total, [, key, , weight]) => total + test.factors[key] * weight,
        0,
      )
    : null
  // Saved factor values and scores are rounded independently.
  const showContributions =
    weightedTotal !== null &&
    Number.isFinite(test.score) &&
    Math.abs(weightedTotal - test.score) < 0.00002

  return (
    <aside className="card det" aria-live="polite">
      <div className="detail-kicker">TEST DETAILS</div>
      <h3>{shortPath(test.path)}</h3>
      <p>{test.path}</p>
      <Chip status={test.result?.status || test.decision} />
      <p className="detail-reason">
        {test.reason ||
          (test.decision === 'Skip'
            ? 'This file is outside the selected plan. Passing selected files does not prove a skipped file would pass.'
            : 'Run the optimizer to compute a change-specific valuation.')}
      </p>
      <div className="valuation-formula" title="Four-factor valuation formula">
        <span className="formula-label">Valuation Model</span>
        <code>V(t | S) = 0.35·R(t) + 0.25·C(t) + 0.15·F(t) + 0.25·M(t | S)</code>
      </div>
      {showContributions && <h4>Plan score {test.score.toFixed(4)}</h4>}
      {SCORE_FACTORS.map(([label, key, color, weight]) => {
        const value = test.factors?.[key]
        return (
          <div className="sig" key={key}>
            <div>
              <span>{label}</span>
              <span>
                {Number.isFinite(value) ? `${(value * 100).toFixed(2)}%` : '—'}
              </span>
            </div>
            <span className="score-bar">
              <i
                style={{ width: `${(value || 0) * 100}%`, background: color }}
              />
            </span>
            {showContributions && (
              <small className="muted">
                {(value * weight).toFixed(4)} ({Math.round(weight * 100)}%
                weight)
              </small>
            )}
          </div>
        )
      })}
      {Number.isFinite(test.factors?.marginalCoverage) && (
        <p className="muted">
          Marginal coverage uses the saved plan's scoring context. Greedy can
          recalculate it as tests are selected.
        </p>
      )}
      <h4>Recorded outcomes</h4>
      <div className="dots">
        {test.observed
          .slice(0, 12)
          .reverse()
          .map((result, index) => (
            <i
              key={index}
              className={
                result.status === 'FAILED'
                  ? 'f'
                  : result.status === 'PASSED'
                    ? ''
                    : 'u'
              }
              title={`${result.status} · ${formatDate(result.completedAt || result.recordedAt)}`}
            />
          ))}
        {!test.observed.length && (
          <span className="muted">No executions recorded.</span>
        )}
      </div>
      <p>
        {test.modules.length
          ? `Mapped to ${test.modules.join(', ')}`
          : 'No source-module mapping available.'}
      </p>
      {test.result && <ExecutionOutput result={test.result} />}
    </aside>
  )
}
