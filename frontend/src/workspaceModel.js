export const PAGES = [['dashboard', 'Dashboard'], ['pipeline', 'Pipeline'], ['suite', 'Test suite'], ['history', 'Run history'], ['settings', 'Settings']];
export const STAGES = [
  { name: 'Code change', color: '#8b5cf6' }, { name: 'Impact analysis', color: '#38bdf8' },
  { name: 'Test valuation', color: '#fbbf24' }, { name: 'Test selection', color: '#f97316' },
  { name: 'Execution', color: '#34d399' }, { name: 'Report', color: '#e879f9' },
];
export const TERMINAL = new Set(['COMPLETED', 'FAILED', 'ERROR', 'INCOMPLETE', 'REJECTED']);
export const formatDate = value => value ? new Date(value).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : 'Just prepared';
export const formatDuration = minutes => minutes == null || !Number.isFinite(Number(minutes)) ? '—' : Number(minutes) < 1 ? `${(Number(minutes) * 60).toFixed(1)}s` : `${Number(minutes).toFixed(1)} min`;
export const shortPath = value => value?.split('/').at(-1) || value || '—';
export function initialVersion(versions) {
  if (!versions.length) return '';
  return versions.some(version => version.baselineReady) ? versions[0].versionId : versions.at(-1).versionId;
}
export function buildWorkspaceModel(version, current, plans = []) {
  const analysis = version?.analysis;
  const plan = current?.plan;
  const testPaths = analysis?.tests || [...new Set([...(plan?.selectedTests || []).map(test => test.testId), ...(plan?.skippedTests || [])])];
  const results = plans.flatMap(run => (run.results || []).map(result => ({ ...result, recordedAt: run.createdAt })));
  const selected = new Map((plan?.selectedTests || []).map(test => [test.testId, test]));
  const currentResults = new Map((current?.results || []).map(result => [result.testPath, result]));
  const tests = testPaths.map(testPath => {
    const observed = results.filter(result => result.testPath === testPath);
    const failed = observed.filter(result => result.status === 'FAILED');
    const selectedTest = selected.get(testPath);
    const estimated = selectedTest?.executionTime ?? plans.flatMap(run => run.plan?.selectedTests || []).find(test => test.testId === testPath)?.executionTime ?? Math.max(0.01, observed.find(result => result.actualTime > 0)?.actualTime || 0.02);
    return { path: testPath, module: analysis?.coverage?.[testPath]?.[0] || 'No source mapping', modules: analysis?.coverage?.[testPath] || [],
      score: selectedTest?.score ?? null, factors: selectedTest?.factors, reason: selectedTest?.reason,
      decision: !plan ? 'Waiting' : selected.has(testPath) ? 'Run' : 'Skip', result: currentResults.get(testPath), estimated,
      observed, failures: failed.length, lastFailed: failed[0]?.completedAt || failed[0]?.recordedAt || null };
  });
  // Backend runAll compares the relevant candidate set, which may be smaller than
  // the uploaded suite. Only reuse that estimate when it includes every file.
  const fullEstimate = plan?.comparisons?.runAll?.testCount === tests.length ? plan.comparisons.runAll.estimatedMinutes : tests.reduce((sum, test) => sum + test.estimated, 0);
  const selectedEstimate = plan?.comparisons?.selected?.estimatedMinutes ?? (plan?.selectedTests || []).reduce((sum, test) => sum + test.executionTime, 0);
  const executed = results.filter(result => ['PASSED', 'FAILED'].includes(result.status));
  const passRate = executed.length ? Math.round(executed.filter(result => result.status === 'PASSED').length / executed.length * 100) : null;
  const activeStage = !version ? -1 : !current ? 1 : current.status === 'PLANNED' || current.status === 'REJECTED' ? 3 : ['QUEUED', 'EXECUTING'].includes(current.status) ? 4 : 5;
  const history = [...plans].reverse().map((run, index) => {
    const runVersion = run.versionId === version?.versionId ? version : null;
    const count = runVersion?.analysis?.tests?.length || (run.plan?.selectedTests?.length || 0) + (run.plan?.skippedTests?.length || 0);
    const suitePaths = [...new Set([...(run.plan?.selectedTests || []).map(test => test.testId), ...(run.plan?.skippedTests || [])])];
    const savedCandidates = run.plan?.comparisons?.runAll;
    const estimatedFull = savedCandidates?.testCount === count ? savedCandidates.estimatedMinutes : suitePaths.reduce((sum, path) => {
      const estimate = (run.plan?.selectedTests || []).find(test => test.testId === path)?.executionTime ?? plans.filter(item => item.createdAt <= run.createdAt).flatMap(item => item.plan?.selectedTests || []).find(test => test.testId === path)?.executionTime ?? 0.02;
      return sum + estimate;
    }, 0);
    const estimatedSelected = run.plan?.comparisons?.selected?.estimatedMinutes || 0;
    return { ...run, number: index + 1, totalTests: count, fullEstimate: estimatedFull, selectedEstimate: estimatedSelected,
      saved: Math.max(0, estimatedFull - estimatedSelected), failedFiles: (run.results || []).filter(result => result.status === 'FAILED').length };
  });
  return { tests, analysis, plan, total: tests.length, selected: plan?.selectedTests?.length ?? null,
    skippedPercent: plan && tests.length ? Math.round((tests.length - plan.selectedTests.length) / tests.length * 100) : null,
    fullEstimate, selectedEstimate, savedEstimate: plan ? Math.max(0, fullEstimate - selectedEstimate) : null,
    passRate, activeStage, history, failureFiles: new Set(results.filter(result => result.status === 'FAILED').map(result => result.testPath)).size,
    averageDuration: executed.length ? executed.reduce((sum, result) => sum + result.actualTime, 0) / executed.length : null,
    changedFiles: plan?.changedFiles || [...(analysis?.changes?.added || []), ...(analysis?.changes?.modified || []), ...(analysis?.changes?.deleted || [])] };
}

export async function readProjectUpload(fileList) {
  const files = [...fileList];
  const accepted = files.filter(file => !((file.webkitRelativePath || file.name).split('/').some(part => /^(node_modules|\.git|\.env(?:\..*)?|dist|build|coverage|\.ssh|\.aws)$/i.test(part))) && /\.(js|mjs|cjs|json|md|txt|ts|tsx|jsx)$/.test(file.name));
  if (!accepted.length || accepted.length > 300 || accepted.some(file => file.size > 512 * 1024) || accepted.reduce((sum, file) => sum + file.size, 0) > 5 * 1024 * 1024) throw new Error('Choose a source folder with 1–300 text files, at most 512 KB per file and 5 MB total.');
  return { name: accepted[0].webkitRelativePath?.split('/')[0] || 'Uploaded project', excluded: files.length - accepted.length,
    files: await Promise.all(accepted.map(async file => ({ path: file.webkitRelativePath ? file.webkitRelativePath.split('/').slice(1).join('/') : file.name, content: await file.text() }))) };
}
