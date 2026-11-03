import { Chip, Score } from './Shared.jsx'
import { formatDate, formatDuration, shortPath } from '../workspaceModel.js'

export function TestTable({ tests, selectedPath, onPick, compact = false }) {
  return (
    <div className="tw">
      <table className={compact ? 'compact-table' : ''}>
        <thead>
          <tr>
            <th>Test</th>
            <th>Selection score</th>
            <th>Last recorded failure</th>
            {!compact && <th>Time</th>}
            <th>Decision</th>
          </tr>
        </thead>
        <tbody>
          {tests.map((test) => (
            <tr
              key={test.path}
              className={`${test.decision === 'Skip' ? 'skip' : ''} ${selectedPath === test.path ? 'sel' : ''}`}
            >
              <td className="n">
                <button onClick={() => onPick(test)}>
                  {shortPath(test.path)}
                </button>
                <small>
                  {test.path === shortPath(test.path) ? test.module : test.path}
                </small>
              </td>
              <td>
                <Score value={test.score} />
              </td>
              <td>
                {test.lastFailed
                  ? formatDate(test.lastFailed)
                  : test.observed.length
                    ? 'None recorded'
                    : 'No history'}
              </td>
              {!compact && (
                <td>
                  {formatDuration(test.result?.actualTime ?? test.estimated)}
                  <small>{test.result ? 'Measured' : 'Estimated'}</small>
                </td>
              )}
              <td>
                <Chip status={test.result?.status || test.decision} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {!tests.length && (
        <p className="table-empty">No test files match this view.</p>
      )}
    </div>
  )
}
