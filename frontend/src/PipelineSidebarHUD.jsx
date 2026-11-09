import { useState, useMemo } from 'react'
import { formatDuration, STAGES } from './workspaceModel.js'

export default function PipelineSidebarHUD({
  layout,
  phase = 0,
  selectedItem = null,
  onSelectItem,
  onFocusItem,
  timeBudget,
  algorithm = 'GREEDY',
  weights,
}) {
  const [searchQuery, setSearchQuery] = useState('')

  const activeStage = STAGES[phase] || STAGES[0]

  // Filter tests and modules based on search input
  const searchResults = useMemo(() => {
    const q = searchQuery.trim().toLowerCase()
    if (!q || !layout) return null

    const matchedModules = layout.hubList.filter(
      (h) => h.name.toLowerCase().includes(q) || h.fullPath.toLowerCase().includes(q)
    )
    const matchedTests = layout.nodes.filter(
      (n) => n.name.toLowerCase().includes(q) || n.fullPath.toLowerCase().includes(q)
    )

    return { modules: matchedModules, tests: matchedTests }
  }, [searchQuery, layout])

  const stageDescriptions = [
    'Direct code diff identified in source modules. Blast radius analysis starts at these change origins.',
    'Impact propagates along AST call-graph dependencies to all caller modules and linked tests.',
    'Multi-factor test valuation: relevance, criticality, failure history, and marginal coverage.',
    'Knapsack / Greedy selection under the time budget. Selected tests glow; skipped tests dim in place.',
    'Parallel worker execution. Passing tests remain emerald green; caught regressions turn bright red.',
    'Optimization summary: execution time saved, suite reduction ratio, and regression safety.',
  ]

  const stats = layout?.stats || {
    affectedModulesCount: 0,
    linkedTestsCount: 0,
    selectedTestsCount: 0,
    skippedTestsCount: 0,
    failedTestsCount: 0,
    skippedPercent: 0,
  }

  const w = weights || { relevance: 0.35, criticality: 0.25, failureRate: 0.15, marginalCoverage: 0.25 }

  return (
    <aside
      style={{
        position: 'relative',
        width: '330px',
        height: 'clamp(560px, calc(100vh - 180px), 860px)',
        background: 'rgba(12, 18, 36, 0.88)',
        border: '1px solid rgba(255, 255, 255, 0.12)',
        borderRadius: '16px',
        backdropFilter: 'blur(12px)',
        padding: '18px',
        display: 'flex',
        flexDirection: 'column',
        gap: '14px',
        overflowY: 'auto',
        color: '#f8fafc',
        zIndex: 4,
        boxShadow: '0 8px 32px rgba(0, 0, 0, 0.4)',
      }}
    >
      {/* Search Input for Test & Module Navigation */}
      <div>
        <div style={{ position: 'relative' }}>
          <input
            type="search"
            placeholder="Search module or test..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            style={{
              width: '100%',
              padding: '8px 12px',
              fontSize: '12px',
              background: '#090d1a',
              border: '1px solid #1e293b',
              borderRadius: '8px',
              color: '#f8fafc',
            }}
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery('')}
              style={{
                position: 'absolute',
                right: '8px',
                top: '50%',
                transform: 'translateY(-50%)',
                background: 'none',
                border: 0,
                color: '#64748b',
                fontSize: '14px',
                cursor: 'pointer',
              }}
            >
              ×
            </button>
          )}
        </div>
      </div>

      {/* SEARCH RESULTS VIEW (When query active) */}
      {searchResults ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          <div style={{ fontSize: '11px', color: '#64748b', textTransform: 'uppercase', letterSpacing: '1px' }}>
            Search Results ({searchResults.modules.length + searchResults.tests.length})
          </div>

          {searchResults.modules.length > 0 && (
            <div>
              <strong style={{ fontSize: '12px', color: '#8b5cf6' }}>Modules:</strong>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', marginTop: '4px' }}>
                {searchResults.modules.map((m) => (
                  <button
                    key={m.id}
                    onClick={() => onSelectItem(m)}
                    style={{
                      textAlign: 'left',
                      background: 'rgba(255, 255, 255, 0.04)',
                      border: '1px solid #1e293b',
                      borderRadius: '6px',
                      padding: '6px 8px',
                      color: '#f8fafc',
                      fontSize: '12px',
                      cursor: 'pointer',
                    }}
                  >
                    📦 {m.name} <small style={{ color: '#64748b' }}>({m.testCount} tests)</small>
                  </button>
                ))}
              </div>
            </div>
          )}

          {searchResults.tests.length > 0 && (
            <div>
              <strong style={{ fontSize: '12px', color: '#38bdf8' }}>Tests:</strong>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', marginTop: '4px' }}>
                {searchResults.tests.map((t) => (
                  <button
                    key={t.id}
                    onClick={() => onSelectItem(t)}
                    style={{
                      textAlign: 'left',
                      background: 'rgba(255, 255, 255, 0.04)',
                      border: '1px solid #1e293b',
                      borderRadius: '6px',
                      padding: '6px 8px',
                      color: '#f8fafc',
                      fontSize: '12px',
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      cursor: 'pointer',
                    }}
                  >
                    <span>🧪 {t.name}</span>
                    <span
                      style={{
                        fontSize: '10px',
                        color: t.isSelected ? '#34d399' : '#64748b',
                        fontWeight: 600,
                      }}
                    >
                      {t.decision}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      ) : selectedItem ? (
        /* SELECTED ELEMENT INSPECTOR VIEW */
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          <button
            onClick={() => onSelectItem(null)}
            style={{
              background: 'none',
              border: 0,
              padding: 0,
              color: '#38bdf8',
              fontSize: '12px',
              textAlign: 'left',
              cursor: 'pointer',
              marginBottom: '4px',
            }}
          >
            ← Back to Stage Overview
          </button>

          {/* Module Hub Inspection */}
          {selectedItem.testCount !== undefined ? (
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px' }}>
                <span
                  style={{
                    width: '12px',
                    height: '12px',
                    borderRadius: '50%',
                    background: selectedItem.isChanged ? '#8b5cf6' : '#38bdf8',
                  }}
                />
                <strong style={{ fontSize: '15px', wordBreak: 'break-all' }}>{selectedItem.name}</strong>
              </div>
              <span
                className="chip"
                style={{
                  fontSize: '11px',
                  marginBottom: '12px',
                  color: selectedItem.isChanged ? '#8b5cf6' : '#38bdf8',
                  borderColor: selectedItem.isChanged ? '#8b5cf666' : '#38bdf866',
                }}
              >
                {selectedItem.isChanged
                  ? 'Changed in this commit'
                  : selectedItem.isAffected
                    ? 'Impacted dependent'
                    : 'Unaffected baseline'}
              </span>

              <dl
                style={{
                  display: 'grid',
                  gridTemplateColumns: '1fr auto',
                  gap: '8px',
                  fontSize: '12px',
                  margin: '12px 0',
                }}
              >
                <dt style={{ color: '#94a3b8' }}>Dependency Depth</dt>
                <dd style={{ margin: 0, fontVariantNumeric: 'tabular-nums' }}>
                  {selectedItem.depth !== undefined ? `Layer ${selectedItem.depth}` : 'None'}
                </dd>
                <dt style={{ color: '#94a3b8' }}>Total Module Tests</dt>
                <dd style={{ margin: 0, fontVariantNumeric: 'tabular-nums' }}>{selectedItem.testCount}</dd>
                <dt style={{ color: '#94a3b8' }}>Selected to Run</dt>
                <dd style={{ margin: 0, color: '#34d399', fontWeight: 600 }}>
                  {selectedItem.tests.filter((t) => t.decision === 'Run').length}
                </dd>
                <dt style={{ color: '#94a3b8' }}>Skipped (Below Budget)</dt>
                <dd style={{ margin: 0, color: '#64748b' }}>
                  {selectedItem.tests.filter((t) => t.decision === 'Skip').length}
                </dd>
                <dt style={{ color: '#94a3b8' }}>Depends On (Imports)</dt>
                <dd style={{ margin: 0, maxWidth: '140px', textAlign: 'right', wordBreak: 'break-all' }}>
                  {selectedItem.dependsOn.map((p) => p.split('/').pop()).join(', ') || 'None'}
                </dd>
                <dt style={{ color: '#94a3b8' }}>Direct Callers</dt>
                <dd style={{ margin: 0, maxWidth: '140px', textAlign: 'right', wordBreak: 'break-all' }}>
                  {selectedItem.affectedBy.map((p) => p.split('/').pop()).join(', ') || 'None'}
                </dd>
              </dl>

              <button
                className="btn"
                style={{ width: '100%', fontSize: '12px', marginTop: '6px' }}
                onClick={() => onFocusItem && onFocusItem(selectedItem.id)}
              >
                Focus on Module in 3D
              </button>
            </div>
          ) : (
            /* Test Node Inspection with Real 4-Factor Math */
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
                <span
                  style={{
                    width: '10px',
                    height: '10px',
                    borderRadius: '50%',
                    background: selectedItem.isSelected ? '#34d399' : '#64748b',
                  }}
                />
                <strong style={{ fontSize: '14px', wordBreak: 'break-all' }}>{selectedItem.name}</strong>
              </div>

              <span
                className="chip"
                style={{
                  fontSize: '11px',
                  marginBottom: '10px',
                  color: selectedItem.isSelected ? '#34d399' : '#64748b',
                  borderColor: selectedItem.isSelected ? '#34d39955' : '#334155',
                }}
              >
                {selectedItem.isSelected
                  ? 'Selected (Within Budget)'
                  : selectedItem.isSkipped
                    ? 'Skipped (Exceeds Budget)'
                    : 'Pending Decision'}
              </span>

              {/* Big Value Score */}
              <div style={{ marginTop: '10px' }}>
                <div style={{ fontSize: '26px', fontWeight: 600, fontVariantNumeric: 'tabular-nums', color: '#38bdf8' }}>
                  {selectedItem.score != null ? selectedItem.score.toFixed(3) : '—'}
                </div>
                <div style={{ fontSize: '11px', color: '#94a3b8' }}>
                  Optimization Value Score ({algorithm})
                </div>
              </div>

              {/* Real 4 Factors Breakdown */}
              <div style={{ margin: '14px 0', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                <div style={{ fontSize: '11px', color: '#64748b', textTransform: 'uppercase', letterSpacing: '1px' }}>
                  Scoring Factor Components
                </div>

                <div className="sg" style={{ margin: 0 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', color: '#94a3b8', marginBottom: '3px' }}>
                    <span>Relevance (w₁: {w.relevance})</span>
                    <span>{(selectedItem.factors?.relevance ?? 0.5).toFixed(2)}</span>
                  </div>
                  <div className="track" style={{ height: '5px' }}>
                    <i style={{ width: `${Math.min(100, Math.round((selectedItem.factors?.relevance ?? 0.5) * 100))}%`, background: '#8b5cf6' }} />
                  </div>
                </div>

                <div className="sg" style={{ margin: 0 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', color: '#94a3b8', marginBottom: '3px' }}>
                    <span>Criticality (w₂: {w.criticality})</span>
                    <span>{(selectedItem.factors?.criticality ?? 0.5).toFixed(2)}</span>
                  </div>
                  <div className="track" style={{ height: '5px' }}>
                    <i style={{ width: `${Math.min(100, Math.round((selectedItem.factors?.criticality ?? 0.5) * 100))}%`, background: '#fbbf24' }} />
                  </div>
                </div>

                <div className="sg" style={{ margin: 0 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', color: '#94a3b8', marginBottom: '3px' }}>
                    <span>Failure History (w₃: {w.failureRate})</span>
                    <span>{(selectedItem.factors?.failureRate ?? 0).toFixed(2)}</span>
                  </div>
                  <div className="track" style={{ height: '5px' }}>
                    <i style={{ width: `${Math.min(100, Math.round((selectedItem.factors?.failureRate ?? 0) * 100))}%`, background: '#f43f5e' }} />
                  </div>
                </div>

                <div className="sg" style={{ margin: 0 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', color: '#94a3b8', marginBottom: '3px' }}>
                    <span>Marginal Coverage (w₄: {w.marginalCoverage})</span>
                    <span>{(selectedItem.factors?.marginalCoverage ?? 0).toFixed(2)}</span>
                  </div>
                  <div className="track" style={{ height: '5px' }}>
                    <i style={{ width: `${Math.min(100, Math.round((selectedItem.factors?.marginalCoverage ?? 0) * 100))}%`, background: '#38bdf8' }} />
                  </div>
                </div>
              </div>

              {/* Meta details */}
              <dl
                style={{
                  display: 'grid',
                  gridTemplateColumns: '1fr auto',
                  gap: '6px',
                  fontSize: '11px',
                  margin: '10px 0',
                }}
              >
                <dt style={{ color: '#94a3b8' }}>Duration</dt>
                <dd style={{ margin: 0, fontVariantNumeric: 'tabular-nums' }}>
                  {formatDuration(selectedItem.executionTime)}
                </dd>
                <dt style={{ color: '#94a3b8' }}>Parent Module</dt>
                <dd style={{ margin: 0 }}>{selectedItem.hubName}</dd>
              </dl>

              {/* Selection reason explanation string */}
              <div
                style={{
                  background: 'rgba(255, 255, 255, 0.04)',
                  border: '1px solid #1e293b',
                  borderRadius: '8px',
                  padding: '8px 10px',
                  fontSize: '11px',
                  color: '#94a3b8',
                  lineHeight: 1.45,
                  margin: '8px 0',
                }}
              >
                <strong style={{ color: '#cbd5e1', display: 'block', marginBottom: '2px' }}>
                  Selection Reason:
                </strong>
                {selectedItem.reason || 'Evaluated against regression impact and available time budget.'}
              </div>

              <button
                className="btn"
                style={{ width: '100%', fontSize: '12px', marginTop: '6px' }}
                onClick={() => onFocusItem && onFocusItem(selectedItem.id)}
              >
                Focus on Test in 3D
              </button>
            </div>
          )}
        </div>
      ) : (
        /* STAGE OVERVIEW DEFAULT VIEW */
        <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span
                style={{
                  width: '8px',
                  height: '8px',
                  borderRadius: '50%',
                  background: activeStage.color,
                }}
              />
              <h2 style={{ margin: 0, fontSize: '16px', fontWeight: 600 }}>
                {activeStage.name}
              </h2>
            </div>
            <p style={{ margin: '6px 0 0', fontSize: '12px', color: '#94a3b8', lineHeight: 1.5 }}>
              {stageDescriptions[phase]}
            </p>
          </div>

          {/* Stats Grid */}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(2, 1fr)',
              gap: '8px',
            }}
          >
            <div
              style={{
                background: 'rgba(255, 255, 255, 0.04)',
                border: '1px solid #1e293b',
                borderRadius: '8px',
                padding: '8px 10px',
              }}
            >
              <b style={{ display: 'block', fontSize: '18px', fontVariantNumeric: 'tabular-nums' }}>
                {stats.affectedModulesCount}
              </b>
              <span style={{ fontSize: '10px', color: '#94a3b8' }}>Modules affected</span>
            </div>
            <div
              style={{
                background: 'rgba(255, 255, 255, 0.04)',
                border: '1px solid #1e293b',
                borderRadius: '8px',
                padding: '8px 10px',
              }}
            >
              <b style={{ display: 'block', fontSize: '18px', fontVariantNumeric: 'tabular-nums' }}>
                {stats.linkedTestsCount}
              </b>
              <span style={{ fontSize: '10px', color: '#94a3b8' }}>Tests linked</span>
            </div>
            <div
              style={{
                background: 'rgba(255, 255, 255, 0.04)',
                border: '1px solid #1e293b',
                borderRadius: '8px',
                padding: '8px 10px',
              }}
            >
              <b style={{ display: 'block', fontSize: '18px', color: '#34d399', fontVariantNumeric: 'tabular-nums' }}>
                {stats.selectedTestsCount}
              </b>
              <span style={{ fontSize: '10px', color: '#94a3b8' }}>Tests selected</span>
            </div>
            <div
              style={{
                background: 'rgba(255, 255, 255, 0.04)',
                border: '1px solid #1e293b',
                borderRadius: '8px',
                padding: '8px 10px',
              }}
            >
              <b style={{ display: 'block', fontSize: '18px', color: '#64748b', fontVariantNumeric: 'tabular-nums' }}>
                {stats.skippedTestsCount}
              </b>
              <span style={{ fontSize: '10px', color: '#94a3b8' }}>Tests skipped</span>
            </div>
            <div
              style={{
                background: 'rgba(255, 255, 255, 0.04)',
                border: '1px solid #1e293b',
                borderRadius: '8px',
                padding: '8px 10px',
              }}
            >
              <b style={{ display: 'block', fontSize: '18px', color: '#f43f5e', fontVariantNumeric: 'tabular-nums' }}>
                {stats.failedTestsCount}
              </b>
              <span style={{ fontSize: '10px', color: '#94a3b8' }}>Failures caught</span>
            </div>
            <div
              style={{
                background: 'rgba(255, 255, 255, 0.04)',
                border: '1px solid #1e293b',
                borderRadius: '8px',
                padding: '8px 10px',
              }}
            >
              <b style={{ display: 'block', fontSize: '18px', color: '#38bdf8', fontVariantNumeric: 'tabular-nums' }}>
                {stats.skippedPercent}%
              </b>
              <span style={{ fontSize: '10px', color: '#94a3b8' }}>Suite skipped</span>
            </div>
          </div>

          {/* Legend */}
          <div
            style={{
              borderTop: '1px solid #1e293b',
              paddingTop: '12px',
              fontSize: '11px',
              display: 'flex',
              flexDirection: 'column',
              gap: '6px',
            }}
          >
            <strong style={{ color: '#cbd5e1', fontSize: '11px' }}>Pipeline Visual Legend</strong>
            <span style={{ display: 'flex', alignItems: 'center', gap: '8px', color: '#94a3b8' }}>
              <i style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#8b5cf6', display: 'inline-block' }} />
              Changed in this commit
            </span>
            <span style={{ display: 'flex', alignItems: 'center', gap: '8px', color: '#94a3b8' }}>
              <i style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#38bdf8', display: 'inline-block' }} />
              Impacted dependency / linked test
            </span>
            <span style={{ display: 'flex', alignItems: 'center', gap: '8px', color: '#94a3b8' }}>
              <i style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#34d399', display: 'inline-block' }} />
              Selected (within time budget)
            </span>
            <span style={{ display: 'flex', alignItems: 'center', gap: '8px', color: '#94a3b8' }}>
              <i style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#1e293b', display: 'inline-block' }} />
              Skipped (dimmed in place)
            </span>
            <span style={{ display: 'flex', alignItems: 'center', gap: '8px', color: '#94a3b8' }}>
              <i style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#f43f5e', display: 'inline-block' }} />
              Caught regression failure
            </span>
          </div>

          {/* Candidate Tests List */}
          <div style={{ borderTop: '1px solid #1e293b', paddingTop: '12px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
              <strong style={{ color: '#cbd5e1', fontSize: '11px' }}>
                Candidate Tests ({layout?.nodes.length || 0})
              </strong>
              <small style={{ color: '#64748b' }}>Click to inspect</small>
            </div>
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: '4px',
                maxHeight: '160px',
                overflowY: 'auto',
              }}
            >
              {layout?.nodes.map((n) => (
                <button
                  key={n.id}
                  onClick={() => onSelectItem(n)}
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    background: 'rgba(255, 255, 255, 0.03)',
                    border: '1px solid rgba(255, 255, 255, 0.05)',
                    borderRadius: '6px',
                    padding: '5px 8px',
                    fontSize: '11px',
                    color: '#f8fafc',
                    textAlign: 'left',
                    cursor: 'pointer',
                  }}
                >
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '190px' }}>
                    {n.name}
                  </span>
                  <span
                    style={{
                      fontSize: '10px',
                      fontWeight: 600,
                      color: n.isSelected ? '#34d399' : '#64748b',
                    }}
                  >
                    {n.decision}
                  </span>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </aside>
  )
}

