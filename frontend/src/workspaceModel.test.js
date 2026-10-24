import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildWorkspaceModel, initialVersion, formatDuration, readProjectUpload } from './workspaceModel.js';
const version = { versionId: 'v2', analysis: { tests: ['test/a.test.js', 'test/b.test.js'], modules: ['src/a.js'], coverage: { 'test/a.test.js': ['src/a.js'] }, changes: { modified: ['src/a.js'] } } };
const run = { planId: 'p1', versionId: 'v2', status: 'COMPLETED', createdAt: '2026-10-24T10:00:00Z', plan: { selectedTests: [{ testId: 'test/a.test.js', executionTime: 1, score: 0.8 }], skippedTests: ['test/b.test.js'], changedFiles: ['src/a.js'], comparisons: { selected: { estimatedMinutes: 1 }, runAll: { testCount: 2, estimatedMinutes: 3 } } }, results: [{ testPath: 'test/a.test.js', status: 'PASSED', actualTime: 0.5 }] };
test('initial upload starts with oldest version until a baseline exists', () => {
  assert.equal(initialVersion([{ versionId: 'v2' }, { versionId: 'v1' }]), 'v1');
  assert.equal(initialVersion([{ versionId: 'v2' }, { versionId: 'v1', baselineReady: true }]), 'v2');
  assert.equal(initialVersion([]), '');
});
test('unknown metrics remain empty before a plan or execution exists', () => {
  const model = buildWorkspaceModel(version, null);
  assert.equal(model.selected, null); assert.equal(model.passRate, null); assert.equal(model.savedEstimate, null);
  assert.ok(model.tests.every(item => item.decision === 'Waiting' && item.score === null));
  assert.equal(formatDuration(null), '—');
});
test('skipped tests have no invented result and estimates use saved plan', () => {
  const model = buildWorkspaceModel(version, run, [run]);
  assert.equal(model.selected, 1); assert.equal(model.skippedPercent, 50);
  assert.equal(model.passRate, 100); assert.equal(model.savedEstimate, 2);
  assert.equal(model.tests[1].decision, 'Skip'); assert.equal(model.tests[1].result, undefined);
  assert.equal(model.history[0].fullEstimate, 3); assert.equal(model.history[0].saved, 2);
});
test('infrastructure errors are excluded from recorded pass/fail ratio', () => {
  const failed = { ...run, results: [...run.results, { testPath: 'test/b.test.js', status: 'FAILED', actualTime: 0.2 }, { testPath: 'test/c.test.js', status: 'ERROR' }] };
  const model = buildWorkspaceModel(version, failed, [failed]);
  assert.equal(model.passRate, 50); assert.equal(model.failureFiles, 1); assert.equal(model.history[0].failedFiles, 1);
});
test('relevant-candidate comparisons are not mistaken for the entire suite', () => {
  const narrowed = { ...run, plan: { ...run.plan, comparisons: { selected: { estimatedMinutes: 1 }, runAll: { testCount: 1, estimatedMinutes: 1 } } } };
  const model = buildWorkspaceModel(version, narrowed, [narrowed]);
  assert.ok(model.fullEstimate > model.selectedEstimate);
  assert.ok(model.history[0].fullEstimate > 1);
});
test('uploads strip folder root and exclude dependencies and secrets', async () => {
  const file = (path, content) => ({ name: path.split('/').at(-1), webkitRelativePath: path, size: content.length, text: async () => content });
  const result = await readProjectUpload([file('project/package.json', '{}'), file('project/src/a.js', 'export const a=1;'), file('project/node_modules/pkg/index.js', ''), file('project/.env', 'SECRET=hidden')]);
  assert.deepEqual(result.files.map(item => item.path), ['package.json', 'src/a.js']); assert.equal(result.excluded, 2);
});
test('oversized uploads are rejected before reading contents', async () => {
  await assert.rejects(() => readProjectUpload([{ name: 'large.js', size: 512 * 1024 + 1 }]), /source folder/);
});
