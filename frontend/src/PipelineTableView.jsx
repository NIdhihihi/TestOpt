import { useState, useMemo } from 'react'
import { formatDuration } from './workspaceModel.js'

export default function PipelineTableView({
  tests = [],
  changedFiles = [],
  changedModules = [],
  timeBudget,
  algorithm = 'GREEDY',
  weights,
  onSelectTest,
}) {
  const [query, setQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState('all') // 'all' | 'selected' | 'skipped' | 'failed'
  const [sortField, setSortField] = useState('score')
  const [sortAsc, setSortAsc] = useState(false)

  const counts = useMemo(() => {
    let sel = 0
    let skip = 0
    let fail = 0
    tests.forEach((t) => {
      if (t.decision === 'Run') sel++
      if (t.decision === 'Skip') skip++
      if (t.status === 'FAILED' || t.result?.status === 'FAILED') fail++
    })
    return { all: tests.length, selected: sel, skipped: skip, failed: fail }
  }, [tests])

  const filteredTests = useMemo(() => {
    const q = query.trim().toLowerCase()
    return tests
      .filter((t) => {
        if (statusFilter === 'selected' && t.decision !== 'Run') return false
        if (statusFilter === 'skipped' && t.decision !== 'Skip') return false
        if (
          statusFilter === 'failed' &&
          t.status !== 'FAILED' &&
          t.result?.status !== 'FAILED'
        )
          return false

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
        maxWidth: '1360px',
        padding: '24px',
        minHeight: '70vh',
        background: '#0a0f1e',
        border: '1px solid #1e293b',
        borderRadius: '16px',
        position: 'relative',
        zIndex: 2,
      }}
    >
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'baseline',
          flexWrap: 'wrap',
          gap: '12px',
          marginBottom: '20px',
        }}
      >
        <div>
          <h2 style={{ margin: 0, fontSize: '20px', fontWeight: 600 }}>
            Test Optimization Suite Table
          </h2>
          <p style={{ margin: '4px 0 0', fontSize: '13px', color: '#94a3b8' }}>
            Full catalog of candidate tests under <strong>{algorithm}</strong> selection (Time Budget: {timeBudget ? `${timeBudget} min` : 'Unconstrained'}).
          </p>
        </div>
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          <input
            type="search"
            placeholder="Search tests or modules..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            style={{
              padding: '7px 12px',
              fontSize: '13px',
              width: '240px',
              background: '#0f172a',
              border: '1px solid #1e293b',
              borderRadius: '8px',
            }}
          />
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
          Failed ({counts.failed})
        </button>
      </div>

      {/* Semantic Accessible Table */}
      <div className="tw" style={{ overflowX: 'auto', maxHeight: '60vh' }}>
        <table aria-label="Test selection table">
          <thead style={{ position: 'sticky', top: 0, background: '#0a0f1e', zIndex: 1 }}>
            <tr>
              <th scope="col" onClick={() => handleSort('path')} style={{ cursor: 'pointer' }}>
                Test Name {sortIndicator('path')}
              </th>
              <th scope="col" onClick={() => handleSort('module')} style={{ cursor: 'pointer' }}>
                Primary Module {sortIndicator('module')}
              </th>
              <th scope="col" onClick={() => handleSort('score')} style={{ cursor: 'pointer' }}>
                Value Score {sortIndicator('score')}
              </th>
              <th scope="col" onClick={() => handleSort('duration')} style={{ cursor: 'pointer' }}>
                Duration {sortIndicator('duration')}
              </th>
              <th scope="col">Decision</th>
              <th scope="col">Execution</th>
              <th scope="col">Selection Reason</th>
            </tr>
          </thead>
          <tbody>
            {filteredTests.length === 0 ? (
              <tr>
                <td colSpan="7" style={{ textAlign: 'center', padding: '36px', color: '#64748b' }}>
                  No test cases match the active filter or search query.
                </td>
              </tr>
            ) : (
              filteredTests.map((test) => {
                const isSel = test.decision === 'Run'
                const isFail = test.status === 'FAILED' || test.result?.status === 'FAILED'
                const isPass = test.status === 'PASSED' || test.result?.status === 'PASSED'
                const duration = test.executionTime || test.estimated || 0.02

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
                      {formatDuration(duration)}
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
                      {isFail ? (
                        <span className="chip failed">FAILED</span>
                      ) : isPass ? (
                        <span className="chip go">PASSED</span>
                      ) : (
                        <span className="chip muted">{test.status || 'PENDING'}</span>
                      )}
                    </td>
                    <td style={{ maxWidth: '340px', fontSize: '12px', color: '#94a3b8' }}>
                      {test.reason || 'Pending optimization evaluation'}
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

