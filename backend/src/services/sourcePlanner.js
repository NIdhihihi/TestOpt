import { buildCandidates, selectGreedy, selectKnapsack, selectBranchAndBound, DP_SIZE_LIMIT } from './optimizationService.js';
import { isCodeFile, isTestFile } from './sourceAnalysis.js';
import { performance } from 'node:perf_hooks';
import { createSchedule } from '../execution/scheduler.js';

export function planSource({ analysis, previous, history = [], timeBudget = 15, workerCount = 2, algorithm = 'AUTO' }) {
  if (!analysis.supported) throw new Error(analysis.unsupported.join(' '));
  if (!Number.isFinite(timeBudget) || timeBudget <= 0 || timeBudget > 1440) throw new Error('Budget must be greater than zero and at most 1440 minutes.');
  if (!Number.isInteger(workerCount) || workerCount < 1 || workerCount > 4) throw new Error('Choose between 1 and 4 isolated workers.');
  if (!['AUTO', 'GREEDY', 'KNAPSACK', 'BRANCH_AND_BOUND'].includes(algorithm)) throw new Error('Unsupported selection algorithm.');
  const changedFiles = [...analysis.changes.added, ...analysis.changes.modified, ...analysis.changes.deleted];
  const priorResults = previous?.results || [];
  const priorByTest = new Map(priorResults.map(result => [result.testPath, result]));
  const baselineUsable = Boolean(previous?.complete && previous.analysis?.tests?.every(name => priorByTest.get(name)?.status === 'PASSED' && priorByTest.get(name)?.coverageAvailable));
  const reasons = [];
  if (!previous) reasons.push('First version: establish a full baseline.');
  else if (!baselineUsable) reasons.push('A complete passing coverage baseline is unavailable.');
  reasons.push(...analysis.warnings);
  if (changedFiles.some(name => !isCodeFile(name) || isTestFile(name))) reasons.push('Configuration, assets, or test files changed: broaden validation.');
  if (analysis.changes.deleted.length) reasons.push('Files were deleted: validate the full current suite.');
  const coverage = {};
  for (const test of analysis.tests) coverage[test] = [...new Set([...(analysis.coverage[test] || []), ...(priorByTest.get(test)?.covered || [])])].filter(name => analysis.modules.includes(name));
  const changedModules = changedFiles.filter(name => analysis.modules.includes(name));
  const coverageGap = changedModules.filter(name => !Object.values(coverage).some(paths => paths.includes(name)));
  if (coverageGap.length) reasons.push('Some changed code has no test-coverage evidence.');
  const fullValidation = reasons.length > 0;
  const requiredTests = baselineUsable && changedFiles.length === 0 ? [] : fullValidation ? analysis.tests : analysis.tests.filter(test => coverage[test].some(name => changedModules.includes(name)));
  const byHistory = new Map(history.map(entry => [entry.test_path, entry]));
  const modules = analysis.modules.map(module_id => ({ module_id, module_name: module_id, criticality: 5 }));
  // Tests covering no source module still participate in full-baseline validation.
  for (const test of requiredTests) if (!coverage[test].length) { modules.push({ module_id: test, module_name: test, criticality: 5 }); coverage[test] = [test]; }
  const relevant = new Set(requiredTests.flatMap(test => coverage[test]));
  const candidates = buildCandidates({
    tests: requiredTests.map(test_id => ({ test_id, test_name: test_id, execution_time: Math.max(0.01, Number(byHistory.get(test_id)?.estimated_time || priorByTest.get(test_id)?.actualTime || 0.02)), priority: 'MEDIUM', status: 'ACTIVE' })),
    coverage: requiredTests.flatMap(test_id => coverage[test_id].map(module_id => ({ test_id, module_id, coverage_weight: 1 }))),
    history: requiredTests.map(test_id => ({ test_id, total_executions: Number(byHistory.get(test_id)?.total_executions || 0), failure_count: Number(byHistory.get(test_id)?.failure_count || 0) })),
    modules, affectedModuleIds: [...relevant], changedModuleIds: changedModules,
  });
  const visits = new Map();
  for (const test of candidates) for (const name of test.coveredModuleIds) visits.set(name, (visits.get(name) || 0) + 1);
  const overlap = [...visits.values()].some(count => count > 1);
  const dpFits = (candidates.length + 1) * (Math.floor(timeBudget * 100) + 1) <= DP_SIZE_LIMIT;
  let chosen = algorithm;
  let algorithmReason = 'Advanced algorithm override.';
  if (chosen === 'AUTO') {
    chosen = !overlap && dpFits ? 'KNAPSACK' : 'GREEDY';
    algorithmReason = overlap ? 'Coverage overlaps; Greedy recomputes marginal value.' : dpFits ? 'Independent coverage and a bounded DP instance permit exact fixed-value selection.' : 'DP size limit exceeded; use bounded-cost Greedy selection.';
  }
  if (chosen === 'KNAPSACK' && !dpFits) throw new Error('DP instance exceeds its size limit. Choose AUTO or GREEDY.');
  let search = null;
  const selectionStarted = performance.now();
  const selected = chosen === 'KNAPSACK' ? selectKnapsack(candidates, timeBudget) : chosen === 'BRANCH_AND_BOUND' ? selectBranchAndBound(candidates, timeBudget, { onComplete: result => { search = result; } }) : selectGreedy(candidates, timeBudget);
  const selectionRunningTimeMs = Number((performance.now() - selectionStarted).toFixed(3));
  const schedule = selected.length ? createSchedule({ selectedTests: selected, strategy: 'LPT', workers: Array.from({ length: workerCount }, (_, index) => ({ workerId: `SOURCE_W${index + 1}`, workerStatus: 'AVAILABLE' })) }) : null;
  const staticScore = tests => Number(tests.reduce((sum, test) => sum + (candidates.find(candidate => candidate.testId === test.testId)?.score || 0), 0).toFixed(5));
  const priority = [];
  let used = 0;
  for (const test of [...candidates].sort((a, b) => a.executionTime - b.executionTime || a.testId.localeCompare(b.testId))) if (used + test.executionTime <= timeBudget + 1e-9) { priority.push(test); used += test.executionTime; }
  const comparison = tests => {
    const metrics = tests.length ? createSchedule({ selectedTests: tests, strategy: 'LPT', workers: Array.from({ length: workerCount }, (_, index) => ({ workerId: `SOURCE_W${index + 1}`, workerStatus: 'AVAILABLE' })) }).metrics : { makespan: 0, workerUtilization: 0, imbalance: 0 };
    return { testCount: tests.length, estimatedMinutes: Number(tests.reduce((sum, test) => sum + test.executionTime, 0).toFixed(5)), staticValue: staticScore(tests), coveredModuleCount: new Set(tests.flatMap(test => test.coveredModuleIds)).size, makespan: metrics.makespan, workerUtilization: metrics.workerUtilization, imbalance: metrics.imbalance };
  };
  return { selectionRunningTimeMs, algorithm: chosen, algorithmReason, formulation: chosen === 'GREEDY' ? 'OVERLAP_AWARE' : 'FIXED_ADDITIVE', search,
    timeBudget, workerCount, changedFiles, changedModules, fullValidation, fallbackReasons: [...new Set(reasons)], requiredTests,
    selectedTests: selected.map(({ metadata, ...test }) => test), skippedTests: analysis.tests.filter(test => !selected.some(item => item.testId === test)),
    coverageGap, complete: selected.length === requiredTests.length && !coverageGap.length, budgetConflict: selected.length < requiredTests.length,
    baseline: !previous, noChanges: Boolean(baselineUsable && changedFiles.length === 0), schedule,
    comparisons: { selected: comparison(selected), runAll: { ...comparison(candidates), withinBudget: candidates.reduce((sum, test) => sum + test.executionTime, 0) <= timeBudget }, staticPriority: comparison(priority) },
    notice: 'Coverage and dependency evidence guide regression selection; passing selected tests does not guarantee every skipped test would pass. Budget limits apply to estimated selected durations.' };
}
