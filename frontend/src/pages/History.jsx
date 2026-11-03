import { Chip, Empty } from '../components/Shared.jsx'
import { Kpis } from '../components/Kpis.jsx'
import { TimeChart } from '../components/TimeChart.jsx'
import { formatDate, formatDuration } from '../workspaceModel.js'

export function History({
  model,
  plans,
  current,
  currentId,
  versionNumber,
  openRun,
  download,
  filter,
  setFilter,
}) {
  const visible = model.history.filter(
    (run) =>
      filter === 'all' ||
      (filter === 'pass' && run.status === 'COMPLETED') ||
      (filter === 'failed' && run.failedFiles > 0) ||
      (filter === 'review' &&
        ['INCOMPLETE', 'ERROR', 'REJECTED'].includes(run.status)),
  )
  return (
    <>
      <Kpis
        items={[
          [plans.length, 'Saved plans and runs'],
          [
            model.history.length
              ? formatDuration(
                  model.history.reduce((sum, run) => sum + run.saved, 0) /
                    model.history.length,
                )
              : null,
            'Average estimated time saved',
          ],
          [
            plans.reduce(
              (sum, run) =>
                sum +
                run.results.filter((result) => result.status === 'FAILED')
                  .length,
              0,
            ),
            'Recorded test-file failures',
          ],
          [
            plans.filter((run) => ['ERROR', 'INCOMPLETE'].includes(run.status))
              .length,
            'Runs needing validation review',
          ],
        ]}
      />
      <section className="card">
        <h2>Suite time per run</h2>
        <TimeChart
          runs={model.history}
          selectedId={currentId}
          onSelect={openRun}
        />
      </section>
      <section className="split">
        <div className="card">
          <h2>All runs</h2>
          <div className="seg" role="group" aria-label="Filter by result">
            {[
              ['all', 'All'],
              ['pass', 'Completed'],
              ['failed', 'Failures caught'],
              ['review', 'Needs review'],
            ].map(([value, label]) => (
              <button
                className={filter === value ? 'on' : ''}
                key={value}
                onClick={() => setFilter(value)}
              >
                {label}
              </button>
            ))}
          </div>
          <div className="tw">
            <table>
              <thead>
                <tr>
                  <th>Run</th>
                  <th>Version</th>
                  <th>When</th>
                  <th>Tests run</th>
                  <th>Time</th>
                  <th>Result</th>
                </tr>
              </thead>
              <tbody>
                {[...visible].reverse().map((run) => (
                  <tr
                    key={run.planId}
                    className={currentId === run.planId ? 'sel' : ''}
                  >
                    <td>
                      <button
                        className="table-link"
                        onClick={() => openRun(run)}
                      >
                        Run #{run.number}
                      </button>
                      <small>{run.plan.algorithm}</small>
                    </td>
                    <td>{versionNumber(run.versionId)}</td>
                    <td>{formatDate(run.createdAt)}</td>
                    <td>
                      {run.results.length} / {run.plan.selectedTests.length}
                    </td>
                    <td>
                      {formatDuration(
                        run.results.length
                          ? run.results.reduce(
                              (sum, result) => sum + (result.actualTime || 0),
                              0,
                            )
                          : null,
                      )}
                      <small>
                        {run.results.length
                          ? 'Measured file time'
                          : 'Not executed'}
                      </small>
                    </td>
                    <td>
                      <Chip status={run.status} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!visible.length && (
              <Empty title="No runs in this view">
                Prepare and approve a plan to record actual execution results.
              </Empty>
            )}
          </div>
        </div>
        <aside className="card det">
          {current ? (
            <>
              <div className="detail-kicker">RUN DETAILS</div>
              <h3>{versionNumber(current.versionId)}</h3>
              <p>
                {formatDate(current.createdAt)} · {current.plan.algorithm}
              </p>
              <Chip status={current.status} />
              <p className="detail-reason">{current.plan.algorithmReason}</p>
              {[
                ['Full suite estimate', model.fullEstimate, '#475569'],
                ['Selected estimate', model.selectedEstimate, '#38bdf8'],
              ].map(([label, value, color]) => (
                <div className="cmp" key={label}>
                  <div>
                    <span>{label}</span>
                    <span>{formatDuration(value)}</span>
                  </div>
                  <div className="track">
                    <i
                      style={{
                        width: `${model.fullEstimate ? Math.min(100, (value / model.fullEstimate) * 100) : 0}%`,
                        background: color,
                      }}
                    />
                  </div>
                </div>
              ))}
              <p>
                {current.results.length} actual results ·{' '}
                {
                  current.results.filter((result) => result.status === 'FAILED')
                    .length
                }{' '}
                failures ·{' '}
                {
                  current.results.filter((result) => result.status === 'ERROR')
                    .length
                }{' '}
                infrastructure errors
              </p>
              {current.message && <p className="caution">{current.message}</p>}
              <button className="btn" onClick={() => openRun(current, 'suite')}>
                Inspect test results
              </button>
              <button className="btn detail-export" onClick={download}>
                Export run
              </button>
              <p className="fine-print">
                Skipped files have no recorded outcome. Missed failures cannot
                be inferred without executing the same full suite.
              </p>
            </>
          ) : (
            <Empty title="Select a run">
              Choose a chart bar or table row to inspect its results.
            </Empty>
          )}
        </aside>
      </section>
    </>
  )
}
