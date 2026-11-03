import { Chip, Empty, PipelineStrip } from '../components/Shared.jsx'
import { Kpis } from '../components/Kpis.jsx'
import { TimeChart } from '../components/TimeChart.jsx'
import { TestTable } from '../components/TestTable.jsx'
import { formatDuration } from '../workspaceModel.js'

export function Dashboard({
  model,
  current,
  version,
  versions,
  versionId,
  busy,
  executing,
  archived,
  goUpload,
  chooseVersion,
  approve,
  reject,
  download,
  onPick,
  openRun,
}) {
  const items = [
    [model.selected, `Tests selected of ${model.total}`],
    [
      model.skippedPercent == null ? null : `${model.skippedPercent}%`,
      'Suite skipped',
    ],
    [
      model.savedEstimate == null ? null : formatDuration(model.savedEstimate),
      'Estimated test time saved',
    ],
    [
      model.passRate == null ? null : `${model.passRate}%`,
      'Recorded pass rate',
      'Only observed pass/fail results. Skipped tests are not counted as passing.',
    ],
  ]
  return (
    <>
      <Kpis items={items} />
      {!version && (
        <section className="card onboarding">
          <div>
            <h2>Upload your project</h2>
            <p>
              Choose the source folder containing package.json. TestOpt
              discovers its tests and dependencies, then guides you through the
              first baseline.
            </p>
          </div>
          <button className="run" onClick={goUpload}>
            Upload project
          </button>
        </section>
      )}
      {version && !version.analysis.supported && (
        <section className="card">
          <h2>This project needs another test adapter</h2>
          {version.analysis.unsupported.map((message) => (
            <p className="note" key={message}>
              {message}
            </p>
          ))}
          <a href="#settings">Supported-project guidance and manual tools →</a>
        </section>
      )}
      {version?.analysis.supported &&
        !versions.some((item) => item.baselineReady) && (
          <section className="card baseline-banner">
            <div>
              <strong>Run a full baseline</strong>
              <p>
                Run the full suite once so TestOpt can use the results to select
                tests for later changes.
              </p>
            </div>
            {versionId !== versions.at(-1)?.versionId && (
              <button
                className="btn"
                onClick={() => chooseVersion(versions.at(-1).versionId)}
              >
                Start with Version 1
              </button>
            )}
          </section>
        )}
      <section className="two">
        <div className="card">
          <h2>Live pipeline</h2>
          <PipelineStrip model={model} current={current} />
          <a className="inline-link" href="#pipeline">
            Explore pipeline execution ↗
          </a>
        </div>
        <div className="card">
          <h2>Suite time per run</h2>
          <TimeChart
            runs={model.history}
            selectedId={current?.planId}
            onSelect={openRun}
          />
        </div>
      </section>
      {current && (
        <section className="card plan-summary">
          <div className="plan-title">
            <div>
              <h2>
                {current.status === 'PLANNED'
                  ? 'Your plan is ready for review'
                  : 'Current run'}
              </h2>
              <p>
                {model.plan.selectedTests.length} selected files ·{' '}
                {model.plan.algorithm} ·{' '}
                {formatDuration(model.selectedEstimate)} estimated ·{' '}
                {model.plan.workerCount} workers
              </p>
            </div>
            <Chip status={current.status} />
          </div>
          <p className="note">{model.plan.algorithmReason}</p>
          {model.plan.fallbackReasons.map((message) => (
            <p className="caution" key={message}>
              {message}
            </p>
          ))}
          {model.plan.budgetConflict && (
            <p className="caution">
              Budget excludes relevant checks. This plan will remain incomplete
              even if its executed tests pass.
            </p>
          )}
          {model.plan.coverageGap?.length > 0 && (
            <p className="caution">
              No coverage evidence for {model.plan.coverageGap.join(', ')}.
              Validation remains incomplete.
            </p>
          )}
          {model.plan.search && (
            <p className="note">
              Branch and Bound:{' '}
              {model.plan.search.provenOptimal
                ? 'search completed for fixed additive values'
                : 'search capped; best-found result'}
              .
            </p>
          )}
          {current.message && <p className="caution">{current.message}</p>}
          <div className="plan-actions">
            {current.status === 'PLANNED' && (
              <>
                <button
                  className="run"
                  onClick={approve}
                  disabled={busy || executing || !model.selected || archived}
                >
                  Approve & run {model.selected} test files
                </button>
                <button className="btn" onClick={reject} disabled={busy}>
                  Reject & retune
                </button>
              </>
            )}
            <a className="btn" href="#suite">
              Review test files
            </a>
            <a className="btn" href="#settings">
              Adjust preferences
            </a>
            {current.results.length > 0 && (
              <button className="btn" onClick={download}>
                Download results
              </button>
            )}
          </div>
          <p className="fine-print">{model.plan.notice}</p>
        </section>
      )}
      <section className="card">
        <div className="card-heading">
          <h2>Tests ranked by selection score</h2>
          <a href="#suite">View test suite →</a>
        </div>
        {model.tests.length ? (
          <TestTable
            tests={[...model.tests]
              .sort((a, b) => (b.score ?? -1) - (a.score ?? -1))
              .slice(0, 12)}
            compact
            onPick={onPick}
          />
        ) : (
          <Empty title="Your test suite will appear here">
            Upload a supported project folder. No dependencies or test cases
            need to be entered manually.
          </Empty>
        )}
      </section>
    </>
  )
}
