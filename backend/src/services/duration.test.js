import test from 'node:test';
import assert from 'node:assert/strict';
import { budgetMilliseconds, durationMilliseconds, selectedDurationMinutes, sumMilliseconds } from './duration.js';
import { buildCandidates, calculateEfficiency, selectBranchAndBound, selectKnapsack } from './optimizationService.js';

const item = (testId, milliseconds, score) => ({ testId, executionTime: milliseconds / 60000, score });

test('millisecond accounting repairs representation noise without rounding genuine finer costs down', () => {
  for (const ms of [1, 2, 7, 61, 840, 18000, 86400000]) {
    assert.equal(durationMilliseconds(ms / 60000), ms);
    assert.equal(budgetMilliseconds(ms / 60000), ms);
  }
  assert.equal(durationMilliseconds(0.000001), 1); // 0.06 ms is not free.
  assert.equal(budgetMilliseconds(0.000001), 0);
  assert.equal(durationMilliseconds(1.2 / 60000), 2);
  assert.equal(budgetMilliseconds(1.2 / 60000), 1);
  assert.equal(selectedDurationMinutes([{ executionTime: 0.1 }, { executionTime: 0.2 }]), 0.3);
});

test('duration validation prevents invalid values and unsafe sums', () => {
  for (const value of [0, -1, NaN, Infinity]) assert.throws(() => durationMilliseconds(value));
  assert.throws(() => budgetMilliseconds(-1));
  assert.throws(() => sumMilliseconds([Number.MAX_SAFE_INTEGER, 1]));
});

test('candidate estimates and Greedy density use the same conservative millisecond cost', () => {
  const candidates = buildCandidates({ tests: [{ test_id: 'A', test_name: 'A', status: 'ACTIVE', execution_time: 0.000001 }], coverage: [{ test_id: 'A', module_id: 'M', coverage_weight: 1 }], history: [], modules: [{ module_id: 'M', criticality: 5 }], affectedModuleIds: ['M'], changedModuleIds: ['M'] });
  assert.equal(candidates[0].executionTime, 1 / 60000);
  assert.equal(calculateEfficiency({ executionTime: 0.000001, baseScore: 0.5, coveredModuleIds: [] }, new Set(), new Map(), 1), 30000);
});

test('GCD-scaled dense DP and sparse frontier return the same exact optimum', () => {
  const candidates = [item('A', 1200, 0.5), item('B', 800, 0.3), item('C', 800, 0.3), item('D', 1600, 0.55)];
  const dense = selectKnapsack(candidates, 1600 / 60000);
  const sparse = selectKnapsack(candidates, 1600 / 60000, 15); // Dense: 25 cells; sparse: <=15 retained states.
  assert.deepEqual(dense.map(value => value.testId), ['B', 'C']);
  assert.deepEqual(sparse.map(value => value.testId), ['B', 'C']);
  assert.throws(() => selectKnapsack(candidates, 1600 / 60000, 1), error => error.code === 'DP_SIZE_LIMIT_EXCEEDED');
});

test('sparse DP bounds backpointer storage across rows and never reuses an item', () => {
  const candidates = [item('A', 101, 0.3), item('B', 103, 0.4), item('C', 107, 0.5), item('D', 109, 0.6)];
  const result = selectKnapsack(candidates, 212 / 60000, 100);
  assert.deepEqual(result.map(value => value.testId), ['B', 'D']);
  assert.equal(new Set(result.map(value => value.testId)).size, result.length);
  assert.ok(result.reduce((sum, value) => sum + Math.round(value.executionTime * 60000), 0) <= 212);
  assert.throws(() => selectKnapsack(candidates, 212 / 60000, 5), /exceeds limit/);
});

test('sparse frontier aborts at cumulative retained-state growth instead of exhausting memory', () => {
  const candidates = Array.from({ length: 8 }, (_, index) => item(String(index), 2 ** index, 2 ** index));
  assert.throws(() => selectKnapsack(candidates, 254 / 60000, 100), error => error.code === 'DP_SIZE_LIMIT_EXCEEDED');
});

test('exact static selectors do not trust rounded display efficiency', () => {
  const candidates = [item('A', 3000, 0.5), item('B', 2000, 0.3), item('C', 2000, 0.3), item('D', 4000, 0.55)].map((value, index) => ({ ...value, efficiency: 100 - index }));
  let metadata;
  assert.deepEqual(selectBranchAndBound(candidates, 4000 / 60000, { onComplete: value => { metadata = value; } }).map(value => value.testId).sort(), ['B', 'C']);
  assert.equal(metadata.provenOptimal, true);
});

test('B&B completion metadata is accurate for empty and zero-node searches', () => {
  let metadata;
  const options = { maxNodes: 0, onComplete: value => { metadata = value; } };
  assert.deepEqual(selectBranchAndBound([], 1, options), []);
  assert.deepEqual(metadata, { provenOptimal: true, nodesExplored: 0 });
  assert.deepEqual(selectBranchAndBound([item('A', 1000, 0.5), item('B', 1000, 0.6)], 1000 / 60000, options), []);
  assert.deepEqual(metadata, { provenOptimal: false, nodesExplored: 0 });
});

test('dense DP, sparse DP and B&B match independent exhaustive millisecond subsets', () => {
  for (let sample = 0; sample < 24; sample++) {
    const count = 6 + sample % 3;
    const costs = Array.from({ length: count }, (_, index) => index === 0 ? 397 : index === 1 ? 400 : 401 + (sample + 11) * (index + 17) * 29 % 900);
    const values = Array.from({ length: count }, (_, index) => 1 + (sample + 3) * (index + 7) * 13 % 50);
    const budget = Math.floor(costs.reduce((sum, cost) => sum + cost, 0) / 2);
    let optimum = 0;
    // Reference sums original integer fixture data; no production timing/scoring helpers.
    for (let subset = 0; subset < 2 ** count; subset++) {
      let cost = 0, value = 0;
      for (let index = 0; index < count; index++) if (subset & (1 << index)) { cost += costs[index]; value += values[index]; }
      if (cost <= budget) optimum = Math.max(optimum, value);
    }
    const candidates = costs.map((cost, index) => item(String(index), cost, values[index]));
    const results = [selectKnapsack(candidates, budget / 60000), selectKnapsack(candidates, budget / 60000, 600), selectBranchAndBound(candidates, budget / 60000)];
    for (const result of results) {
      assert.equal(new Set(result.map(value => value.testId)).size, result.length);
      assert.ok(result.reduce((sum, value) => sum + costs[Number(value.testId)], 0) <= budget);
      assert.equal(result.reduce((sum, value) => sum + values[Number(value.testId)], 0), optimum);
    }
  }
});
