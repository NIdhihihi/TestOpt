import { useState, useMemo } from 'react'
import { formatDuration } from './workspaceModel.js'

export default function PipelineTableView({
  tests = [],
  timeBudget,
  workerCount = 2,
  algorithm = 'GREEDY',
  algorithmDetails,
  coverageGap = [],
  isValidationComplete = false,
  measuredSelectedDuration = null,
  realizedSavings = null,
  selectedEstimate = null,
  savedEstimate = null,
  onSelectTest,
}) {
  const [query, setQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState('all') // 'all' | 'selected' | 'skipped' | 'failed' | 'infra'
  const [sortField, setSortField] = useState('score')
  const [sortAsc, setSortAsc] = useState(false)
  const [expandedOutputId, setExpandedOutputId] = useState(null)

  const counts = useMemo(() => {
    let sel = 0
    let skip = 0
    let fail = 0
    let infra = 0
    tests.forEach((t) => {
      if (t.decision === 'Run') sel++
      if (t.decision === 'Skip') skip++
      if (t.isInfraError || t.status === 'ERROR') infra++
      else if (t.isCodeFailure || t.status === 'FAILED' || t.result?.status === 'FAILED') fail++
    })
    return { all: tests.length, selected: sel, skipped: skip, failed: fail, infra }
  }, [tests])

  const filteredTests = useMemo(() => {
    const q = query.trim().toLowerCase()
    return tests
      .filter((t) => {
        if (statusFilter === 'selected' && t.decision !== 'Run') return false
        if (statusFilter === 'skipped' && t.decision !== 'Skip') return false
        if (statusFilter === 'failed' && !t.isCodeFailure && t.status !== 'FAILED' && t.result?.status !== 'FAILED') return false
        if (statusFilter === 'infra' && !t.isInfraError && t.status !== 'ERROR') return false

        if (!q) return true
        return (
          t.path.toLowerCase().includes(q) ||
          (t.module && t.module.toLowerCase().includes(q)) ||
          (t.reason && t.reason.toLowerCase().includes(q))
        )
      })
      .sort((a, b) => {
        let va = a[sortField] ?? ''
        let vb = b[sortField] ?? ''
        if (sortField === 'score') {
          va = a.score ?? -1
          vb = b.score ?? -1
        } else if (sortField === 'duration') {
          va = a.executionTime ?? a.estimated ?? 0
          vb = b.executionTime ?? b.estimated ?? 0
        } else if (sortField === 'measured') {
          va = a.measuredTime ?? -1
          vb = b.measuredTime ?? -1
        }
        if (va < vb) return sortAsc ? -1 : 1
        if (va > vb) return sortAsc ? 1 : -1
        return a.path.localeCompare(b.path)
      })
  }, [tests, query, statusFilter, sortField, sortAsc])

  const handleSort = (field) => {
    if (sortField === field) {
      setSortAsc(!sortAsc)
    } else {
      setSortField(field)
      setSortAsc(false)
    }
  }

  const sortIndicator = (field) => {
    if (sortField !== field) return '↕'
    return sortAsc ? '↑' : '↓'
  }

  return (
    <div
      className="card"
      style={{
        margin: '100px auto 30px',
        maxWidth: '1380px',
        padding: '24px',
        minHeight: '70vh',
        background: '#0a0f1e',
        border: '1px solid #1e293b',
        borderRadius: '16px',
        position: 'relative',
        zIndex: 2,
      }}
    >
      {/* Top Header & Search */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'baseline',
          flexWrap: 'wrap',
          gap: '12px',
          marginBottom: '16px',
        }}
      >
        <div>
          <h2 style={{ margin: 0, fontSize: '20px', fontWeight: 600 }}>
            Regression Test Selection Table
          </h2>
          <p style={{ margin: '4px 0 0', fontSize: '13px', color: '#94a3b8' }}>
            Full catalog of candidate tests under <strong>{algorithmDetails?.name || algorithm}</strong> selection (Budget: {timeBudget ? `${timeBudget} min` : 'Unconstrained'}, {workerCount} workers).
          </p>
        </div>
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          <input
            type="search"
            placeholder="Search tests, modules, or reasons..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            style={{
              padding: '7px 12px',
              fontSize: '13px',
              width: '280px',
              background: '#0f172a',
              border: '1px solid #1e293b',
              borderRadius: '8px',
            }}
          />
        </div>
      </div>

      {/* Validation Safety & Timing Summary Banner */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
          gap: '12px',
          marginBottom: '20px',
        }}
      >
        <div
          style={{
            background: isValidationComplete ? 'rgba(16, 185, 129, 0.08)' : 'rgba(245, 158, 11, 0.08)',
            border: `1px solid ${isValidationComplete ? 'rgba(16, 185, 129, 0.25)' : 'rgba(245, 158, 11, 0.25)'}`,
            borderRadius: '10px',
            padding: '10px 14px',
            fontSize: '12px',
          }}
        >
          <strong style={{ color: isValidationComplete ? '#34d399' : '#fbbf24', display: 'block', marginBottom: '2px' }}>
            {isValidationComplete ? '✓ Validation Complete' : '⚠ Partial Validation Warning'}
          </strong>
          <span style={{ color: '#94a3b8' }}>
            {coverageGap.length > 0
              ? `Changed modules (${coverageGap.map(m => m.split('/').pop()).join(', ')}) lack test coverage evidence.`
              : 'All required test candidates selected under available execution budget.'}
          </span>
        </div>

        <div
          style={{
            background: 'rgba(255, 255, 255, 0.03)',
            border: '1px solid #1e293b',
            borderRadius: '10px',
            padding: '10px 14px',
            fontSize: '12px',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
          }}
        >
          <div>
            <span style={{ color: '#64748b', display: 'block' }}>Estimated Planned Time</span>
            <strong style={{ fontVariantNumeric: 'tabular-nums', color: '#f8fafc' }}>
              {formatDuration(selectedEstimate)}
            </strong>
          </div>
          <div>
            <span style={{ color: '#64748b', display: 'block' }}>Realized Wall-Clock</span>
            <strong style={{ fontVariantNumeric: 'tabular-nums', color: measuredSelectedDuration ? '#34d399' : '#64748b' }}>
              {measuredSelectedDuration ? formatDuration(measuredSelectedDuration) : 'Pending Execution'}
            </strong>
          </div>
          <div>
            <span style={{ color: '#64748b', display: 'block' }}>Est. Suite Savings</span>
            <strong style={{ fontVariantNumeric: 'tabular-nums', color: '#38bdf8' }}>
              {realizedSavings ? formatDuration(realizedSavings) : (savedEstimate ? `~${formatDuration(savedEstimate)} (est.)` : '—')}
            </strong>
          </div>
        </div>
      </div>

      {/* Filter Tabs */}
      <div className="seg" style={{ marginBottom: '16px' }}>
        <button
          className={statusFilter === 'all' ? 'on' : ''}
          onClick={() => setStatusFilter('all')}
        >
          All ({counts.all})
        </button>
        <button
          className={statusFilter === 'selected' ? 'on' : ''}
          onClick={() => setStatusFilter('selected')}
        >
          Selected ({counts.selected})
        </button>
        <button
          className={statusFilter === 'skipped' ? 'on' : ''}
          onClick={() => setStatusFilter('skipped')}
        >
          Skipped ({counts.skipped})
        </button>
        <button
          className={statusFilter === 'failed' ? 'on' : ''}
          onClick={() => setStatusFilter('failed')}
        >
          Regressions Caught ({counts.failed})
        </button>
        {counts.infra > 0 && (
          <button
            className={statusFilter === 'infra' ? 'on' : ''}
            onClick={() => setStatusFilter('infra')}
            style={{ color: '#fbbf24' }}
          >
            Infra Errors ({counts.infra})
          </button>
        )}
      </div>

      {/* Semantic Accessible Table */}
      <div className="tw" style={{ overflowX: 'auto', maxHeight: '60vh' }}>
        <table aria-label="Regression test selection table">
          <thead style={{ position: 'sticky', top: 0, background: '#0a0f1e', zIndex: 1 }}>
            <tr>
              <th scope="col" onClick={() => handleSort('path')} style={{ cursor: 'pointer' }}>
                Test Name {sortIndicator('path')}
              </th>
              <th scope="col" onClick={() => handleSort('module')} style={{ cursor: 'pointer' }}>
                Covered Module {sortIndicator('module')}
              </th>
              <th scope="col" onClick={() => handleSort('score')} style={{ cursor: 'pointer' }}>
                Rank Score {sortIndicator('score')}
              </th>
              <th scope="col" onClick={() => handleSort('duration')} style={{ cursor: 'pointer' }}>
                Est. Duration {sortIndicator('duration')}
              </th>
              <th scope="col" onClick={() => handleSort('measured')} style={{ cursor: 'pointer' }}>
                Measured Clock {sortIndicator('measured')}
              </th>
              <th scope="col">Decision</th>
              <th scope="col">Execution State</th>
              <th scope="col">Selection Reason & Evidence</th>
            </tr>
          </thead>
          <tbody>
            {filteredTests.length === 0 ? (
              <tr>
                <td colSpan="8" style={{ textAlign: 'center', padding: '36px', color: '#64748b' }}>
                  No test cases match the active filter or search query.
                </td>
              </tr>
            ) : (
              filteredTests.map((test) => {
                const isSel = test.decision === 'Run'
                const isSkip = test.decision === 'Skip'
                const isInfra = test.isInfraError || test.status === 'ERROR'
                const isFail = test.isCodeFailure || test.status === 'FAILED' || test.result?.status === 'FAILED'
                const isPass = test.isPass || test.status === 'PASSED' || test.result?.status === 'PASSED'
                const isExpanded = expandedOutputId === test.path

                return (
                  <tr
                    key={test.path}
                    className={isSel ? 'sel' : 'skip'}
                    style={{ cursor: onSelectTest ? 'pointer' : 'default' }}
                    onClick={() => onSelectTest && onSelectTest(test.path)}
                  >
                    <td className="n">
                      <strong style={{ fontSize: '13px' }}>{test.path.split('/').pop()}</strong>
                      <small style={{ color: '#64748b' }}>{test.path}</small>
                      {test.historicalPassRate != null && (
                        <small style={{ color: '#94a3b8' }}>
                          History: {test.historicalPassRate}% pass ({test.historicalRunsCount} runs)
                        </small>
                      )}
                    </td>
                    <td>
                      <span className="chip" style={{ fontSize: '11px' }}>
                        {(test.module || '—').split('/').pop()}
                      </span>
                    </td>
                    <td>
                      {test.score != null ? (
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                          <span className="score-bar" style={{ width: '50px' }}>
                            <i style={{ width: `${Math.min(100, Math.round(test.score * 100))}%` }} />
                          </span>
                          <span style={{ fontVariantNumeric: 'tabular-nums', fontSize: '13px' }}>
                            {test.score.toFixed(3)}
                          </span>
                        </div>
                      ) : (
                        <span style={{ color: '#64748b' }}>—</span>
                      )}
                    </td>
                    <td style={{ fontVariantNumeric: 'tabular-nums', fontSize: '13px' }}>
                      {formatDuration(test.executionTime || test.estimated)}
                    </td>
                    <td style={{ fontVariantNumeric: 'tabular-nums', fontSize: '13px', color: test.measuredTime != null ? '#34d399' : '#64748b' }}>
                      {test.measuredTime != null ? formatDuration(test.measuredTime) : '—'}
                    </td>
                    <td>
                      <span
                        className={`chip ${isSel ? 'go' : ''}`}
                        style={{
                          fontWeight: 600,
                          color: isSel ? '#34d399' : '#64748b',
                          borderColor: isSel ? '#34d39944' : '#334155',
                          background: isSel ? '#34d3990e' : 'transparent',
                        }}
                      >
                        {test.decision || 'Waiting'}
                      </span>
                    </td>
                    <td>
                      {isInfra ? (
                        <span className="chip" style={{ color: '#f59e0b', borderColor: '#f59e0b55', background: '#f59e0b11' }}>
                          INFRA ERROR
                        </span>
                      ) : isFail ? (
                        <span className="chip failed">REGRESSION</span>
                      ) : isPass ? (
                        <span className="chip go">PASSED</span>
                      ) : isSkip ? (
                        <span className="chip" style={{ color: '#64748b', borderColor: '#334155' }}>
                          NO RESULT (SKIPPED)
                        </span>
                      ) : (
                        <span className="chip pending">PENDING</span>
                      )}
                    </td>
                    <td style={{ maxWidth: '360px', fontSize: '12px', color: '#94a3b8' }}>
                      <div>{test.reason || 'Pending optimization evaluation'}</div>
                      {test.output && (
                        <div style={{ marginTop: '4px' }}>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation()
                              setExpandedOutputId(isExpanded ? null : test.path)
                            }}
                            style={{
                              background: 'none',
                              border: 0,
                              padding: 0,
                              color: '#38bdf8',
                              fontSize: '11px',
                              cursor: 'pointer',
                            }}
                          >
                            {isExpanded ? 'Hide output' : 'Show log output'}
                          </button>
                          {isExpanded && (
                            <pre
                              style={{
                                margin: '4px 0 0',
                                padding: '6px 8px',
                                background: '#050914',
                                borderRadius: '4px',
                                fontSize: '10px',
                                maxHeight: '90px',
                                overflowY: 'auto',
                                whiteSpace: 'pre-wrap',
                              }}
                            >
                              {test.output}
                            </pre>
                          )}
                        </div>
                      )}
                    </td>
                  </tr>
                )
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
