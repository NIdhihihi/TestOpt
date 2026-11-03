import { useState } from 'react'
import { Kpis } from '../components/Kpis.jsx'
import { TestTable } from '../components/TestTable.jsx'
import { TestDetails } from '../components/TestDetails.jsx'

export function Suite({ model, version, testPath, setTestPath }) {
  const [query, setQuery] = useState('')
  const [module, setModule] = useState('')
  const [decision, setDecision] = useState('All')
  const [sort, setSort] = useState('score')
  const [limit, setLimit] = useState(30)
  const modules = [...new Set(model.tests.flatMap((test) => test.modules))]
  const filtered = model.tests
    .filter(
      (test) =>
        test.path.toLowerCase().includes(query.toLowerCase()) &&
        (!module || test.modules.includes(module)) &&
        (decision === 'All' || test.decision === decision),
    )
    .sort((a, b) =>
      sort === 'name'
        ? a.path.localeCompare(b.path)
        : sort === 'time'
          ? b.estimated - a.estimated
          : (b.score ?? -1) - (a.score ?? -1),
    )
  return (
    <>
      <Kpis
        items={[
          [model.total, 'Discovered test files'],
          [model.selected, 'Selected for this plan'],
          [
            model.passRate == null ? null : `${model.passRate}%`,
            'Recorded pass rate',
          ],
          [model.failureFiles, 'Files with recorded failures'],
        ]}
      />
      <section className="split">
        <div className="card">
          <h2>Test suite</h2>
          <div className="filters">
            <input
              aria-label="Search tests"
              placeholder="Search tests…"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
            <select
              aria-label="Filter by module"
              value={module}
              onChange={(event) => setModule(event.target.value)}
            >
              <option value="">All modules</option>
              {modules.map((path) => (
                <option key={path}>{path}</option>
              ))}
            </select>
            <select
              aria-label="Sort tests"
              value={sort}
              onChange={(event) => setSort(event.target.value)}
            >
              <option value="score">Highest score</option>
              <option value="name">Test name</option>
              <option value="time">Longest estimate</option>
            </select>
          </div>
          <div className="seg" role="group" aria-label="Filter test decision">
            {['All', 'Run', 'Skip'].map((value) => (
              <button
                className={decision === value ? 'on' : ''}
                key={value}
                onClick={() => setDecision(value)}
              >
                {value}
              </button>
            ))}
          </div>
          <TestTable
            tests={filtered.slice(0, limit)}
            selectedPath={testPath}
            onPick={(test) => setTestPath(test.path)}
          />
          {filtered.length > limit && (
            <button className="btn" onClick={() => setLimit(limit + 30)}>
              Show more tests
            </button>
          )}
          <p className="fine-print">
            {filtered.length} matching test files ·{' '}
            {version ? 'Source discovery' : 'Upload a project to begin'}. Scores
            appear after planning; execution outcomes appear after approval.
          </p>
        </div>
        <TestDetails
          test={model.tests.find((test) => test.path === testPath)}
        />
      </section>
    </>
  )
}

