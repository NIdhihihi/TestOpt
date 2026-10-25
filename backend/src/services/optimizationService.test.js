import test from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_ALPHA,
  DEFAULT_WEIGHTS,
  DP_SIZE_LIMIT,
  buildCandidates,
  calculateEfficiency,
  calculateMarginalCoverage,
  calculateTestValue,
  checkChangedModulesCoverage,
  computeModuleImportance,
  findAffectedModuleIds,
  selectBranchAndBound,
  selectGreedy,
  selectKnapsack,
  summarizeSelection,
} from "./optimizationService.js";

const sampleModules = [
  { module_id: "M_AUTH", module_name: "Authentication", criticality: 8 },
  { module_id: "M_PAYMENT", module_name: "Payment", criticality: 10 },
  { module_id: "M_ORDER", module_name: "Order Management", criticality: 9 },
  { module_id: "M_CATALOG", module_name: "Catalog", criticality: 5 },
];

const sampleDependencies = [
  { source_module_id: "M_PAYMENT", target_module_id: "M_AUTH" },
  { source_module_id: "M_ORDER", target_module_id: "M_PAYMENT" },
];

test("findAffectedModuleIds traverses reversed graph and handles cycles", () => {
  // Direct change to M_AUTH affects M_PAYMENT and M_ORDER
  const affected = findAffectedModuleIds(["M_AUTH"], sampleDependencies);
  assert.deepEqual(affected.sort(), ["M_AUTH", "M_ORDER", "M_PAYMENT"]);

  // Handles cyclic dependencies without infinite loop
  const cyclicDeps = [
    { source_module_id: "M1", target_module_id: "M2" },
    { source_module_id: "M2", target_module_id: "M1" },
    { source_module_id: "M3", target_module_id: "M2" },
  ];
  const cyclicAffected = findAffectedModuleIds(["M1"], cyclicDeps);
  assert.deepEqual(cyclicAffected.sort(), ["M1", "M2", "M3"]);
});

test("computeModuleImportance applies indirect damping factor alpha", () => {
  const criticalityMap = new Map([
    ["M_AUTH", 8],
    ["M_PAYMENT", 10],
    ["M_ORDER", 9],
  ]);
  const changed = ["M_AUTH"];
  const relevant = ["M_AUTH", "M_PAYMENT", "M_ORDER"];

  const { omegaMap, totalOmega } = computeModuleImportance(relevant, changed, criticalityMap, DEFAULT_ALPHA);

  // Directly changed M_AUTH: 1.0 * (8 / 10) = 0.8
  assert.equal(omegaMap.get("M_AUTH"), 0.8);

  // Indirectly affected M_PAYMENT: 0.5 * (10 / 10) = 0.5
  assert.equal(omegaMap.get("M_PAYMENT"), 0.5);

  // Indirectly affected M_ORDER: 0.5 * (9 / 10) = 0.45
  assert.equal(omegaMap.get("M_ORDER"), 0.45);

  // Total Omega = 0.8 + 0.5 + 0.45 = 1.75
  assert.equal(totalOmega, 1.75);
});

test("calculateMarginalCoverage decreases monotonically as modules are covered", () => {
  const omegaMap = new Map([
    ["M_AUTH", 0.8],
    ["M_PAYMENT", 0.5],
    ["M_ORDER", 0.45],
  ]);
  const totalOmega = 1.75;
  const testCovered = ["M_AUTH", "M_PAYMENT"];

  // When no modules are covered yet
  const initialMarginal = calculateMarginalCoverage(testCovered, new Set(), omegaMap, totalOmega);
  assert.equal(Number(initialMarginal.toFixed(4)), Number(((0.8 + 0.5) / 1.75).toFixed(4)));

  // After M_AUTH has been covered by an earlier selected test
  const reducedMarginal = calculateMarginalCoverage(testCovered, new Set(["M_AUTH"]), omegaMap, totalOmega);
  assert.equal(Number(reducedMarginal.toFixed(4)), Number((0.5 / 1.75).toFixed(4)));
  assert.ok(reducedMarginal < initialMarginal);

  // After both M_AUTH and M_PAYMENT are covered
  const zeroMarginal = calculateMarginalCoverage(testCovered, new Set(["M_AUTH", "M_PAYMENT"]), omegaMap, totalOmega);
  assert.equal(zeroMarginal, 0);
});

test("buildCandidates correctly normalizes 4 factors and computes initial V0 and efficiency", () => {
  const tests = [
    { test_id: "T_LOGIN", test_name: "Login", execution_time: 4, priority: "HIGH", status: "ACTIVE" },
    { test_id: "T_CHECKOUT", test_name: "Checkout", execution_time: 8, priority: "HIGH", status: "ACTIVE" },
    { test_id: "T_INACTIVE", test_name: "Inactive Test", execution_time: 2, priority: "LOW", status: "INACTIVE" },
  ];

  const coverage = [
    { test_id: "T_LOGIN", module_id: "M_AUTH", coverage_weight: 1.0 },
    { test_id: "T_CHECKOUT", module_id: "M_AUTH", coverage_weight: 0.5 },
    { test_id: "T_CHECKOUT", module_id: "M_PAYMENT", coverage_weight: 1.0 },
    { test_id: "T_CHECKOUT", module_id: "M_ORDER", coverage_weight: 1.0 },
  ];

  const history = [
    { test_id: "T_LOGIN", total_executions: 10, failure_count: 2 },
    { test_id: "T_CHECKOUT", total_executions: 0, failure_count: 0 },
  ];

  const changedModuleIds = ["M_AUTH"];
  const affectedModuleIds = ["M_AUTH", "M_PAYMENT", "M_ORDER"];

  const candidates = buildCandidates({
    tests,
    coverage,
    history,
    modules: sampleModules,
    affectedModuleIds,
    changedModuleIds,
    weights: DEFAULT_WEIGHTS,
    alpha: DEFAULT_ALPHA,
  });

  assert.equal(candidates.length, 2);
  const loginTest = candidates.find((t) => t.testId === "T_LOGIN");
  const checkoutTest = candidates.find((t) => t.testId === "T_CHECKOUT");

  assert.ok(loginTest);
  assert.ok(checkoutTest);
  assert.equal(checkoutTest.factors.failureRate, 0);
  assert.equal(loginTest.factors.failureRate, 0.2);

  for (const candidate of candidates) {
    assert.ok(candidate.factors.relevance >= 0 && candidate.factors.relevance <= 1);
    assert.ok(candidate.factors.criticality >= 0 && candidate.factors.criticality <= 1);
    assert.ok(candidate.factors.failureRate >= 0 && candidate.factors.failureRate <= 1);
    assert.ok(candidate.factors.marginalCoverage >= 0 && candidate.factors.marginalCoverage <= 1);
    assert.ok(candidate.score > 0);
    assert.ok(candidate.efficiency > 0);
    assert.ok(candidate.reason.length > 0);
  }
});

test("selectGreedy fits budget and re-evaluates marginal coverage lazily", () => {
  const candidates = [
    { testId: "T1", executionTime: 3, score: 0.8, baseScore: 0.4, efficiency: 0.175, coveredModuleIds: ["M1"], factors: { relevance: 1, criticality: 1, failureRate: 0, marginalCoverage: 1 }, metadata: { omegaMap: new Map([["M1", 0.5], ["M2", 0.5]]), totalOmega: 1.0, weights: DEFAULT_WEIGHTS } },
    { testId: "T2", executionTime: 6, score: 0.8, baseScore: 0.4, efficiency: 0.108, coveredModuleIds: ["M1", "M2"], factors: { relevance: 1, criticality: 1, failureRate: 0, marginalCoverage: 1 }, metadata: { omegaMap: new Map([["M1", 0.5], ["M2", 0.5]]), totalOmega: 1.0, weights: DEFAULT_WEIGHTS } },
    { testId: "T3", executionTime: 4, score: 0.5, baseScore: 0.25, efficiency: 0.093, coveredModuleIds: ["M2"], factors: { relevance: 0.8, criticality: 0.8, failureRate: 0, marginalCoverage: 0.5 }, metadata: { omegaMap: new Map([["M1", 0.5], ["M2", 0.5]]), totalOmega: 1.0, weights: DEFAULT_WEIGHTS } },
  ];

  const selected = selectGreedy(candidates, 10);
  const totalTime = selected.reduce((sum, t) => sum + t.executionTime, 0);

  assert.ok(totalTime <= 10);
  assert.ok(selected.length >= 1);
  assert.equal(selected[0].testId, "T1");
});

test("selectGreedy applies safeguard when a single test beats the greedy combination", () => {
  const candidates = [
    { testId: "T_HUGE", executionTime: 10, score: 0.95, baseScore: 0.5, efficiency: 0.095, coveredModuleIds: ["M1"], factors: { relevance: 1, criticality: 1, failureRate: 0, marginalCoverage: 1 } },
    { testId: "T_SMALL1", executionTime: 5, score: 0.45, baseScore: 0.2, efficiency: 0.090, coveredModuleIds: ["M2"], factors: { relevance: 0.5, criticality: 0.5, failureRate: 0, marginalCoverage: 0.5 } },
    { testId: "T_SMALL2", executionTime: 5, score: 0.45, baseScore: 0.2, efficiency: 0.090, coveredModuleIds: ["M3"], factors: { relevance: 0.5, criticality: 0.5, failureRate: 0, marginalCoverage: 0.5 } },
  ];

  // If greedy picks small1 (0.45) + small2 (0.45) = 0.90, but huge test alone has 0.95:
  const selected = selectGreedy(candidates, 10);
  assert.equal(selected.length, 1);
  assert.equal(selected[0].testId, "T_HUGE");
});

test("selectBranchAndBound finds optimal subset within budget using fractional bounding", () => {
  const candidates = [
    { testId: "T1", executionTime: 6, score: 30, efficiency: 5.0 },
    { testId: "T2", executionTime: 5, score: 20, efficiency: 4.0 },
    { testId: "T3", executionTime: 4, score: 18, efficiency: 4.5 },
  ];

  // With budget = 9:
  // Option T1(6) + T2(5) = 11 (exceeds budget)
  // Option T1(6) + T3(4) = 10 (exceeds budget)
  // Option T2(5) + T3(4) = 9 (score 38)
  // Option T1(6) alone = score 30
  // Optimal: T2 + T3 = 38
  const selected = selectBranchAndBound(candidates, 9);
  const selectedIds = selected.map((t) => t.testId).sort();

  assert.deepEqual(selectedIds, ["T2", "T3"]);
  const summary = summarizeSelection(selected);
  assert.equal(summary.totalExecutionTime, 9);
  assert.equal(summary.totalScore, 38);
});

test("selectKnapsack respects budget and enforces DP capacity limit", () => {
  const candidates = [
    { testId: "T1", executionTime: 4, score: 20 },
    { testId: "T2", executionTime: 5, score: 25 },
    { testId: "T3", executionTime: 7, score: 40 },
  ];

  // Budget 9: T1(4, 20) + T2(5, 25) = 45 vs T3(7, 40) -> Optimal is T1 + T2 (score 45)
  const selected = selectKnapsack(candidates, 9);
  assert.deepEqual(selected.map((t) => t.testId).sort(), ["T1", "T2"]);

  // Test size limit guard with total candidate time (16) > budget (10)
  assert.throws(() => {
    selectKnapsack(candidates, 10, 1); // Insufficient retained-state allowance.
  }, /exceeds limit/);
});

test("checkChangedModulesCoverage identifies uncovered directly changed modules", () => {
  const selectedTests = [
    { testId: "T1", coveredModuleIds: ["M_AUTH"] },
  ];

  // If changed is M_AUTH and M_CHECKOUT
  const result = checkChangedModulesCoverage(selectedTests, ["M_AUTH", "M_CHECKOUT"]);
  assert.equal(result.allCovered, false);
  assert.deepEqual(result.uncoveredChanged, ["M_CHECKOUT"]);

  // If changed is only M_AUTH
  const completeResult = checkChangedModulesCoverage(selectedTests, ["M_AUTH"]);
  assert.equal(completeResult.allCovered, true);
  assert.deepEqual(completeResult.uncoveredChanged, []);
});


test("branch-and-bound reports capped search rather than claiming optimality", () => {
  let search;
  const candidates = [1, 2, 3].map(i => ({ testId: `C${i}`, score: i, executionTime: 2, efficiency: i / 2 }));
  selectBranchAndBound(candidates, 3, { maxNodes: 0, onComplete: info => { search = info; } });
  assert.equal(search.provenOptimal, false);
  selectBranchAndBound(candidates, 3, { onComplete: info => { search = info; } });
  assert.equal(search.provenOptimal, true);
});

test('Greedy does not create spare fractional budget through rounding', () => {
  const candidates = buildCandidates({ tests: ['A', 'B', 'C'].map(test_id => ({ test_id, test_name: test_id, status: 'ACTIVE', execution_time: 0.014 })), coverage: ['A', 'B', 'C'].map(test_id => ({ test_id, module_id: 'M', coverage_weight: 1 })), history: [], modules: [{ module_id: 'M', criticality: 5 }], changedModuleIds: ['M'], affectedModuleIds: ['M'] });
  const selected = selectGreedy(candidates, 0.04);
  assert.equal(selected.length, 2);
  assert.ok(selected.reduce((sum, item) => sum + item.executionTime, 0) <= 0.04);
});

test('completed B&B includes a decimal-boundary combination and reports exact processed nodes', () => {
  const candidates = [{ testId: 'A', executionTime: 0.1, score: 0.4, efficiency: 4 }, { testId: 'B', executionTime: 0.2, score: 0.5, efficiency: 2.5 }];
  let search;
  const selected = selectBranchAndBound(candidates, 0.3, { onComplete: value => { search = value; } });
  assert.deepEqual(selected.map(item => item.testId).sort(), ['A', 'B']);
  assert.equal(search.provenOptimal, true);
  const constrained = [...candidates, { testId: 'C', executionTime: 0.25, score: 0.8, efficiency: 3.2 }];
  selectBranchAndBound(constrained, 0.3, { maxNodes: 2, onComplete: value => { search = value; } });
  assert.equal(search.provenOptimal, false);
  assert.equal(search.nodesExplored, 2);
});

test('DP preserves millisecond fractional costs instead of rounding to 0.01 minute', () => {
  const candidates = [{ testId: 'A', executionTime: 0.014, score: 0.6 }, { testId: 'B', executionTime: 0.014, score: 0.6 }, { testId: 'C', executionTime: 0.1, score: 0.9 }];
  assert.deepEqual(selectKnapsack(candidates, 0.03).map(item => item.testId), ['A', 'B']);
});
