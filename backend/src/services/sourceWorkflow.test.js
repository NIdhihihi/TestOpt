import test from 'node:test';
import assert from 'node:assert/strict';
import { validateSourceFiles, analyzeSource } from './sourceAnalysis.js';
import { planSource } from './sourcePlanner.js';
import { sourceResultStatus } from '../execution/sourceRunner.js';
import { selectKnapsack } from './optimizationService.js';

import { example } from '../integration/fixtures/demoProject.js';

test('upload rejects traversal, secrets, duplicate paths, and oversized content', () => {
  for (const name of ['../a.js', '/a.js', 'a\\b.js', '.env', 'node_modules/a.js', 'CON.js']) assert.throws(() => validateSourceFiles([{ path: name, content: '' }]));
  assert.throws(() => validateSourceFiles([{ path: 'a.js', content: '' }, { path: 'A.js', content: '' }]));
  assert.throws(() => validateSourceFiles([{ path: 'a.js', content: 'a'.repeat(513 * 1024) }]));
});
test('discovers directed imports and test files, ignores commented fake imports', () => {
  const files = validateSourceFiles(example);
  const analysis = analyzeSource(files);
  assert.equal(analysis.supported, true);
  assert.equal(analysis.tests.length, 2);
  assert.deepEqual(analysis.coverage['test/add.test.js'], ['src/add.js']);
  assert.equal(analyzeSource(validateSourceFiles([...example, { path: 'unused.js', content: "// import x from 'not-real';" }])).supported, true);
});

test('recognizes prefix-only built-ins and built-in subpaths in imports and require', () => {
  for (const ref of ['node:test', 'node:test/reporters', 'node:assert/strict', 'assert/strict', 'node:fs', 'fs/promises']) {
    for (const content of [`import '${ref}';`, `require('${ref}');`]) {
      const analysis = analyzeSource(validateSourceFiles([...example, { path: 'src/builtin.js', content }]));
      assert.equal(analysis.supported, true, `${content}: ${analysis.unsupported.join(' ')}`);
      assert.equal(analysis.dependencies.some(edge => edge.source === 'src/builtin.js'), false);
      if (ref === 'node:fs' || ref === 'fs/promises') assert.ok(analysis.warnings.some(message => message.includes('Runtime file/process access in src/builtin.js')));
    }
  }
});

test('rejects bare prefix-only names and unknown node-prefixed imports', () => {
  for (const ref of ['test', 'test/reporters', 'node:not-a-real-module', 'not-a-real-package']) {
    for (const content of [`import '${ref}';`, `require('${ref}');`]) {
      const analysis = analyzeSource(validateSourceFiles([...example, { path: 'src/external.js', content }]));
      assert.equal(analysis.supported, false, content);
      assert.ok(analysis.unsupported.includes(`External dependency ${ref} in src/external.js.`), content);
    }
  }
});
test('detects versions and narrows only with a complete passing coverage baseline', () => {
  const files = validateSourceFiles(example);
  const oldAnalysis = analyzeSource(files);
  const changed = validateSourceFiles(example.map(file => file.path === 'src/add.js' ? { ...file, content: 'export function add(a,b) { return a+b; }' } : file));
  const analysis = analyzeSource(changed, files);
  assert.deepEqual(analysis.changes.modified, ['src/add.js']);
  const baseline = { complete: true, analysis: oldAnalysis, results: oldAnalysis.tests.map(testPath => ({ testPath, status: 'PASSED', coverageAvailable: true, covered: oldAnalysis.coverage[testPath], actualTime: 0.01 })) };
  const plan = planSource({ analysis, previous: baseline });
  assert.deepEqual(plan.requiredTests, ['test/add.test.js']);
  assert.equal(plan.complete, true);
  assert.equal(plan.algorithm, 'KNAPSACK');
  assert.equal(planSource({ analysis, previous: { ...baseline, complete: false } }).requiredTests.length, 2);
});
test('dynamic imports and insufficient budgets trigger explicit safety outcomes', () => {
  const files = validateSourceFiles(example);
  const analysis = analyzeSource(validateSourceFiles(example.map(file => file.path === 'src/add.js' ? { ...file, content: "export const add = async(a,b) => { await import('./text.js'); return a+b; };" } : file)), files);
  assert.ok(analysis.warnings.length);
  const plan = planSource({ analysis, timeBudget: 0.001 });
  assert.equal(plan.fullValidation, true);
  assert.equal(plan.complete, false);
  assert.equal(plan.budgetConflict, true);
  assert.equal(plan.selectedTests.length, 0);
});
test('package dependencies are disclosed as unsupported; import cycles terminate', () => {
  const external = example.map(file => file.path === 'package.json' ? { ...file, content: '{"dependencies":{"express":"*"}}' } : file);
  assert.equal(analyzeSource(validateSourceFiles(external)).supported, false);
  const cyclical = [...example, { path: 'src/cycle.js', content: "import './add.js';" }].map(file => file.path === 'src/add.js' ? { ...file, content: "import './cycle.js'; export const add=(a,b)=>a+b;" } : file);
  assert.equal(analyzeSource(validateSourceFiles(cyclical)).coverage['test/add.test.js'].length, 2);
});
test('DP discretization never permits a positive test to have zero cost', () => {
  const candidates = Array.from({ length: 10 }, (_, index) => ({ testId: String(index), executionTime: 0.004, score: 1, efficiency: 250 }));
  const selected = selectKnapsack(candidates, 0.01);
  assert.ok(selected.reduce((sum, item) => sum + item.executionTime, 0) <= 0.01 + 1e-9);
});

test('unchanged files still need a baseline; uncovered code remains incomplete', () => {
  const files = validateSourceFiles(example);
  const analysis = analyzeSource(files, files);
  const unvalidated = planSource({ analysis, previous: { complete: false, analysis } });
  assert.equal(unvalidated.requiredTests.length, 2);
  assert.equal(unvalidated.noChanges, false);
  const orphan = analyzeSource(validateSourceFiles([...example, { path: 'src/orphan.js', content: 'export const x = 1;' }]));
  const plan = planSource({ analysis: orphan });
  assert.deepEqual(plan.coverageGap, ['src/orphan.js']);
  assert.equal(plan.complete, false);
  assert.equal(plan.budgetConflict, false);
  assert.ok(plan.comparisons.runAll.testCount === 2);
  assert.ok(Number.isFinite(plan.selectionRunningTimeMs));
});

test('passing outputs cannot claim complete validation without coverage and all required files', () => {
  const plan = { complete: true, selectedTests: [{}] };
  assert.equal(sourceResultStatus(plan, [{ status: 'PASSED', coverageAvailable: true }]), 'COMPLETED');
  assert.equal(sourceResultStatus(plan, [{ status: 'PASSED', coverageAvailable: false }]), 'INCOMPLETE');
  assert.equal(sourceResultStatus({ ...plan, complete: false }, [{ status: 'PASSED', coverageAvailable: true }]), 'INCOMPLETE');
  assert.equal(sourceResultStatus(plan, [{ status: 'ERROR' }]), 'ERROR');
  assert.equal(sourceResultStatus(plan, [{ status: 'FAILED' }]), 'FAILED');
});

test('an unusable baseline retains coverage gaps until the code is covered or removed', () => {
  const files = validateSourceFiles([...example, { path: 'src/orphan.js', content: 'export const x = 1;' }]);
  const analysis = analyzeSource(files);
  const previous = { analysis, complete: false };
  const passingResults = plan => plan.selectedTests.map(test => ({ testPath: test.testId, status: 'PASSED', coverageAvailable: true }));
  const changed = validateSourceFiles(files.map(file => file.path === 'src/add.js' ? { ...file, content: 'export function add(a,b) { return a+b; }' } : file));
  for (const current of [files, changed]) {
    const plan = planSource({ analysis: analyzeSource(current, files), previous });
    assert.deepEqual(plan.coverageGap, ['src/orphan.js']);
    assert.equal(plan.complete, false);
    assert.equal(plan.noChanges, false);
    assert.equal(sourceResultStatus(plan, passingResults(plan)), 'INCOMPLETE');
  }
  const covered = validateSourceFiles([...files, { path: 'test/orphan.test.js', content: "import test from 'node:test'; import assert from 'node:assert/strict'; import {x} from '../src/orphan.js'; test('x',()=>assert.equal(x,1));" }]);
  for (const current of [covered, validateSourceFiles(example)]) {
    const plan = planSource({ analysis: analyzeSource(current, files), previous });
    assert.deepEqual(plan.coverageGap, []);
    assert.equal(plan.complete, true);
    assert.equal(sourceResultStatus(plan, passingResults(plan)), 'COMPLETED');
  }
});

test('AUTO falls back only on an actual bounded DP resource failure; explicit DP reports it', () => {
  const analysis = analyzeSource(validateSourceFiles(example));
  const settings = { analysis, timeBudget: 0.03, dpSizeLimit: 1 };
  const automatic = planSource({ ...settings, algorithm: 'AUTO' });
  assert.equal(automatic.algorithm, 'GREEDY');
  assert.match(automatic.algorithmReason, /DP size limit/);
  assert.equal(automatic.complete, false);
  assert.ok(automatic.comparisons.selected.estimatedMinutes <= settings.timeBudget);
  assert.throws(() => planSource({ ...settings, algorithm: 'KNAPSACK' }), error => error.code === 'DP_SIZE_LIMIT_EXCEEDED');
  // No search/table allocation is necessary when every candidate fits.
  assert.equal(planSource({ analysis, timeBudget: 1440, dpSizeLimit: 1, algorithm: 'AUTO' }).algorithm, 'KNAPSACK');
});
