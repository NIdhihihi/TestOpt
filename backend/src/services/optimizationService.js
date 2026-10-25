import { assertSelectionBudget, budgetMilliseconds, durationMilliseconds, millisecondsToMinutes, selectedDurationMinutes, sumMilliseconds } from './duration.js';

export const DEFAULT_WEIGHTS = {
  w1: 0.35, // Relevance
  w2: 0.25, // Criticality
  w3: 0.15, // Historical Failure
  w4: 0.25, // Marginal Coverage
};

export const DEFAULT_ALPHA = 0.5; // Damping factor for indirectly affected modules
export const DP_SIZE_LIMIT = 1_000_000; // Dense cells or cumulative sparse retained states.

function toNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

export class MaxHeap {
  constructor(comparator) {
    this.heap = [];
    this.comparator = comparator; // returns > 0 if a has higher priority than b
  }

  size() {
    return this.heap.length;
  }

  isEmpty() {
    return this.heap.length === 0;
  }

  push(item) {
    this.heap.push(item);
    this._siftUp(this.heap.length - 1);
  }

  pop() {
    if (this.isEmpty()) return null;
    const top = this.heap[0];
    const bottom = this.heap.pop();
    if (this.heap.length > 0) {
      this.heap[0] = bottom;
      this._siftDown(0);
    }
    return top;
  }

  _siftUp(index) {
    let current = index;
    while (current > 0) {
      const parent = Math.floor((current - 1) / 2);
      if (this.comparator(this.heap[current], this.heap[parent]) > 0) {
        [this.heap[current], this.heap[parent]] = [this.heap[parent], this.heap[current]];
        current = parent;
      } else {
        break;
      }
    }
  }

  _siftDown(index) {
    let current = index;
    const length = this.heap.length;
    while (true) {
      const left = 2 * current + 1;
      const right = 2 * current + 2;
      let largest = current;

      if (left < length && this.comparator(this.heap[left], this.heap[largest]) > 0) {
        largest = left;
      }
      if (right < length && this.comparator(this.heap[right], this.heap[largest]) > 0) {
        largest = right;
      }
      if (largest !== current) {
        [this.heap[current], this.heap[largest]] = [this.heap[largest], this.heap[current]];
        current = largest;
      } else {
        break;
      }
    }
  }
}

export function findAffectedModuleIds(changedModuleIds, dependencies) {
  const dependentsByModule = new Map();

  for (const dependency of dependencies) {
    const dependents = dependentsByModule.get(dependency.target_module_id) ?? [];
    dependents.push(dependency.source_module_id);
    dependentsByModule.set(dependency.target_module_id, dependents);
  }

  const affected = new Set(changedModuleIds);
  const pending = [...changedModuleIds];

  while (pending.length > 0) {
    const moduleId = pending.shift();

    for (const dependentId of dependentsByModule.get(moduleId) ?? []) {
      if (!affected.has(dependentId)) {
        affected.add(dependentId);
        pending.push(dependentId);
      }
    }
  }

  return [...affected];
}

export function computeModuleImportance(relevantModuleIds, changedModuleIds, criticalityByModule, alpha = DEFAULT_ALPHA) {
  const changedSet = new Set(changedModuleIds);
  const omegaMap = new Map();
  let totalOmega = 0;

  for (const moduleId of relevantModuleIds) {
    const d = changedSet.has(moduleId) ? 1.0 : alpha;
    const crit = toNumber(criticalityByModule.get(moduleId), 5);
    const omega = d * (crit / 10);
    omegaMap.set(moduleId, omega);
    totalOmega += omega;
  }

  return { omegaMap, totalOmega };
}

export function calculateMarginalCoverage(coveredModuleIds, selectedCoveredModuleSet, omegaMap, totalOmega) {
  if (!totalOmega || totalOmega <= 0) return 0;
  let uncoveredOmega = 0;
  for (const moduleId of coveredModuleIds) {
    if (!selectedCoveredModuleSet || !selectedCoveredModuleSet.has(moduleId)) {
      uncoveredOmega += omegaMap.get(moduleId) ?? 0;
    }
  }
  return uncoveredOmega / totalOmega;
}

export function calculateTestValue(candidate, selectedCoveredModuleSet, omegaMap, totalOmega, weights = DEFAULT_WEIGHTS) {
  const marginal = calculateMarginalCoverage(
    candidate.coveredModuleIds,
    selectedCoveredModuleSet,
    omegaMap,
    totalOmega,
  );
  const value = candidate.baseScore + (weights.w4 ?? DEFAULT_WEIGHTS.w4) * marginal;
  return Number(value.toFixed(5));
}

export function calculateEfficiency(candidate, selectedCoveredModuleSet, omegaMap, totalOmega, weights = DEFAULT_WEIGHTS) {
  const value = calculateTestValue(candidate, selectedCoveredModuleSet, omegaMap, totalOmega, weights);
  return candidate.executionTime > 0 ? value / millisecondsToMinutes(durationMilliseconds(candidate.executionTime)) : 0;
}

export function generateSelectionReason(candidate, coveredModules, omegaMap, totalOmega, weights = DEFAULT_WEIGHTS, changedSet = new Set()) {
  const marginalFraction = calculateMarginalCoverage(candidate.coveredModuleIds, coveredModules, omegaMap, totalOmega);
  const marginalPct = Math.round(marginalFraction * 100);
  const valueAtSelection = calculateTestValue(candidate, coveredModules, omegaMap, totalOmega, weights);
  const effAtSelection = candidate.executionTime > 0 ? valueAtSelection / millisecondsToMinutes(durationMilliseconds(candidate.executionTime)) : 0;

  const moduleTags = (candidate.coveredModuleIds ?? [])
    .map((modId) => `${modId}${changedSet.has(modId) ? " (changed)" : " (affected)"}`)
    .join(", ");

  return `Covers ${moduleTags}; adds ${marginalPct}% marginal importance; efficiency ${effAtSelection.toFixed(3)} (Rel: ${candidate.factors.relevance.toFixed(2)}, Crit: ${candidate.factors.criticality.toFixed(2)}, Fail: ${candidate.factors.failureRate.toFixed(2)}).`;
}

export function buildCandidates({
  tests,
  coverage,
  history,
  modules,
  affectedModuleIds,
  changedModuleIds = [],
  weights = DEFAULT_WEIGHTS,
  alpha = DEFAULT_ALPHA,
}) {
  const changedSet = new Set(changedModuleIds);
  const relevantSet = new Set(affectedModuleIds);
  const criticalityByModule = new Map(
    modules.map((module) => [module.module_id, toNumber(module.criticality, 5)]),
  );
  const moduleNameById = new Map(
    modules.map((module) => [module.module_id, module.module_name || module.module_id]),
  );
  const historyByTest = new Map(history.map((entry) => [entry.test_id, entry]));
  const coverageByTest = new Map();

  for (const entry of coverage) {
    if (!relevantSet.has(entry.module_id)) continue;

    const entries = coverageByTest.get(entry.test_id) ?? [];
    entries.push(entry);
    coverageByTest.set(entry.test_id, entries);
  }

  // 1. Calculate module importance omega(x) and total Omega
  const { omegaMap, totalOmega } = computeModuleImportance(
    [...relevantSet],
    changedModuleIds,
    criticalityByModule,
    alpha,
  );

  // 2. Active tests that cover at least one relevant module
  const activeCandidates = tests.filter(
    (test) => test.status === "ACTIVE" && coverageByTest.has(test.test_id),
  );

  // 3. Compute raw relevance to find rmax
  const rawRelevanceByTest = new Map();
  let rmax = 0;

  for (const test of activeCandidates) {
    const relevantCoverage = coverageByTest.get(test.test_id) ?? [];
    let raw = 0;
    for (const entry of relevantCoverage) {
      const d = changedSet.has(entry.module_id) ? 1.0 : alpha;
      raw += toNumber(entry.coverage_weight, 1.0) * d;
    }
    rawRelevanceByTest.set(test.test_id, raw);
    if (raw > rmax) rmax = raw;
  }

  // 4. Score each candidate
  const w = { ...DEFAULT_WEIGHTS, ...weights };

  return activeCandidates.map((test) => {
    const relevantCoverage = coverageByTest.get(test.test_id) ?? [];
    const coveredModuleIds = relevantCoverage.map((entry) => entry.module_id);
    const executionTime = millisecondsToMinutes(durationMilliseconds(toNumber(test.execution_time, 1)));

    // Factor 1: Relevance (normalized by rmax)
    const rawRel = rawRelevanceByTest.get(test.test_id) ?? 0;
    const rel = rmax > 0 ? rawRel / rmax : 0;

    // Factor 2: Criticality (average normalized criticality of covered relevant modules)
    const avgCrit = coveredModuleIds.length > 0
      ? coveredModuleIds.reduce((sum, id) => sum + (criticalityByModule.get(id) ?? 5) / 10, 0) / coveredModuleIds.length
      : 0;

    // Factor 3: Failure history (failureCount / totalExecutions, 0 if never executed)
    const testHistory = historyByTest.get(test.test_id);
    const totalExecutions = toNumber(testHistory?.total_executions, 0);
    const failureCount = toNumber(testHistory?.failure_count, 0);
    const failRate = totalExecutions > 0 ? failureCount / totalExecutions : 0;

    // Base score (components independent of already selected set S)
    const baseScore = w.w1 * rel + w.w2 * avgCrit + w.w3 * failRate;

    // Initial marginal coverage (at S = empty)
    const initialMarginal = calculateMarginalCoverage(coveredModuleIds, new Set(), omegaMap, totalOmega);

    // Initial value V0(t) = V(t | empty)
    const initialScore = baseScore + w.w4 * initialMarginal;
    const initialEff = executionTime > 0 ? initialScore / executionTime : 0;

    const coveredNames = coveredModuleIds
      .map((id) => `${moduleNameById.get(id) || id}${changedSet.has(id) ? " (changed)" : " (affected)"}`)
      .join(", ");

    const reason = `Covers ${coveredNames}; score ${initialScore.toFixed(3)} [Rel: ${rel.toFixed(2)}, Crit: ${avgCrit.toFixed(2)}, Fail: ${failRate.toFixed(2)}, Marg: ${initialMarginal.toFixed(2)}].`;

    return {
      testId: test.test_id,
      testName: test.test_name,
      executionTime,
      priority: test.priority,
      score: Number(initialScore.toFixed(5)),
      baseScore: Number(baseScore.toFixed(5)),
      factors: {
        relevance: Number(rel.toFixed(5)),
        criticality: Number(avgCrit.toFixed(5)),
        failureRate: Number(failRate.toFixed(5)),
        marginalCoverage: Number(initialMarginal.toFixed(5)),
      },
      efficiency: Number(initialEff.toFixed(5)),
      coveredModuleIds,
      reason,
      metadata: {
        omegaMap,
        totalOmega,
        weights: w,
        alpha,
        changedSet,
      },
    };
  });
}

/**
 * Greedy Selection with Lazy Heap & Safeguard (ADD §6.2, SRS REQ-4.7.3, REQ-4.7.6)
 * Solves Budgeted Maximum Coverage using submodular lazy re-evaluation.
 */
export function selectGreedy(candidates, timeBudget) {
  if (!candidates || candidates.length === 0 || timeBudget <= 0) return [];

  // REQ-4.7.7: If budget covers all candidates, select all candidates
  const budget = budgetMilliseconds(timeBudget);
  const costs = new Map(candidates.map(candidate => [candidate, durationMilliseconds(candidate.executionTime)]));
  const totalCandidateTime = sumMilliseconds(costs.values());
  if (totalCandidateTime <= budget) {
    return assertSelectionBudget([...candidates].sort((a, b) => {
      if (Math.abs(b.efficiency - a.efficiency) > 1e-9) return b.efficiency - a.efficiency;
      if (a.executionTime !== b.executionTime) return a.executionTime - b.executionTime;
      return a.testId.localeCompare(b.testId);
    }), timeBudget);
  }

  const metadata = candidates[0]?.metadata;
  const omegaMap = metadata?.omegaMap ?? new Map();
  const totalOmega = metadata?.totalOmega ?? 0;
  const weights = metadata?.weights ?? DEFAULT_WEIGHTS;
  const changedSet = metadata?.changedSet ?? new Set();

  const comparator = (a, b) => {
    if (Math.abs(a.efficiency - b.efficiency) > 1e-9) {
      return a.efficiency - b.efficiency;
    }
    if (a.candidate.executionTime !== b.candidate.executionTime) {
      return b.candidate.executionTime - a.candidate.executionTime; // lower time first
    }
    return b.candidate.testId.localeCompare(a.candidate.testId); // lower id first
  };

  const pq = new MaxHeap(comparator);
  const emptyCoverage = new Set();
  for (const cand of candidates) {
    pq.push({ efficiency: calculateEfficiency(cand, emptyCoverage, omegaMap, totalOmega, weights), candidate: cand });
  }

  const selected = [];
  let remainingBudget = budget;
  const coveredModules = new Set();

  while (!pq.isEmpty()) {
    const top = pq.pop();
    const cand = top.candidate;

    if (costs.get(cand) > remainingBudget) {
      continue; // never fits in remaining budget
    }

    // Lazy re-evaluation with currently covered modules
    const currentEff = calculateEfficiency(cand, coveredModules, omegaMap, totalOmega, weights);

    // If key has degraded by more than float tolerance, re-push with updated key
    if (top.efficiency - currentEff > 1e-9) {
      pq.push({ efficiency: currentEff, candidate: cand });
      continue;
    }

    // Update reason with dynamic marginal value at time of selection
    const reasonAtSelection = generateSelectionReason(cand, coveredModules, omegaMap, totalOmega, weights, changedSet);
    const scoreAtSelection = calculateTestValue(cand, coveredModules, omegaMap, totalOmega, weights);
    const marginalAtSelection = calculateMarginalCoverage(cand.coveredModuleIds, coveredModules, omegaMap, totalOmega);

    selected.push({
      ...cand,
      score: scoreAtSelection,
      factors: {
        ...cand.factors,
        marginalCoverage: Number(marginalAtSelection.toFixed(5)),
      },
      reason: reasonAtSelection,
    });

    remainingBudget -= costs.get(cand);
    for (const modId of cand.coveredModuleIds) {
      coveredModules.add(modId);
    }
  }

  // ADD §6.2 Safeguard: Compare with best single candidate that fits the budget
  let bestSingle = null;
  for (const cand of candidates) {
    if (costs.get(cand) <= budget) {
      if (!bestSingle || cand.score > bestSingle.score) {
        bestSingle = cand;
      }
    }
  }

  const totalSelectedScore = selected.reduce((sum, c) => sum + c.score, 0);
  if (bestSingle && bestSingle.score > totalSelectedScore) {
    return assertSelectionBudget([bestSingle], timeBudget);
  }

  return assertSelectionBudget(selected, timeBudget);
}

/**
 * Branch and Bound Exact Selection (Combinatorial State-Space Search with LP Relaxation Bound)
 * Solves the static Formulation F1 with bounded search and early branch pruning.
 * Integer costs/values and rational bounds avoid false decimal-boundary pruning.
 * Linked immutable paths avoid copying partial combinations in the frontier.
 */
function fixedValueItems(candidates) {
  const items = candidates.map(candidate => {
    const scaled = Number(candidate.score) * 100_000;
    const value = Math.round(scaled);
    if (!Number.isSafeInteger(value) || value < 0 || Math.abs(scaled - value) > Number.EPSILON * Math.max(1, Math.abs(scaled)) * 8) throw new RangeError('Fixed-value selection requires finite, non-negative scores with at most five decimal places.');
    return { candidate, cost: durationMilliseconds(candidate.executionTime), value };
  });
  sumMilliseconds(items.map(item => item.cost));
  if (!Number.isSafeInteger(items.reduce((sum, item) => sum + item.value, 0))) throw new RangeError('Combined selection value exceeds safe precision.');
  return items;
}

function compareDensity(a, b) {
  // Do not use the rounded display efficiency for an admissible bound.
  const difference = BigInt(b.value) * BigInt(a.cost) - BigInt(a.value) * BigInt(b.cost);
  return difference === 0n ? a.cost - b.cost || String(a.candidate.testId).localeCompare(String(b.candidate.testId)) : difference > 0n ? 1 : -1;
}

export function selectBranchAndBound(candidates, timeBudget, options = {}) {
  const finish = (selected, provenOptimal, nodesExplored) => {
    options.onComplete?.({ provenOptimal, nodesExplored });
    return assertSelectionBudget(selected, Math.max(0, timeBudget));
  };
  if (!candidates || candidates.length === 0 || timeBudget <= 0) return finish([], true, 0);
  const budget = budgetMilliseconds(timeBudget);
  const items = fixedValueItems(candidates).sort(compareDensity);
  if (sumMilliseconds(items.map(item => item.cost)) <= budget) return finish(items.map(item => item.candidate), true, 0);
  const maxNodes = options.maxNodes ?? 50_000;
  const timeoutMs = options.timeoutMs ?? 2000;
  if (!Number.isSafeInteger(maxNodes) || maxNodes < 0 || !Number.isFinite(timeoutMs) || timeoutMs < 0) throw new RangeError('B&B limits must be finite and non-negative; node limit must be an integer.');
  const startTime = Date.now();
  let bestValue = 0, bestPath = null, nodesExplored = 0, capped = false;

  function canImprove(start, value, remaining) {
    let bound = value;
    for (let i = start; i < items.length; i++) {
      const item = items[i];
      if (item.cost <= remaining) { remaining -= item.cost; bound += item.value; }
      else {
        // Exact rational comparison of the fractional upper bound to incumbent.
        return BigInt(bound - bestValue) * BigInt(item.cost) + BigInt(item.value) * BigInt(remaining) > 0n;
      }
    }
    return bound > bestValue;
  }

  const stack = [{ index: 0, value: 0, cost: 0, path: null }];
  while (stack.length) {
    if (nodesExplored >= maxNodes || Date.now() - startTime >= timeoutMs) { capped = true; break; }
    const state = stack.pop();
    nodesExplored++;
    if (state.value > bestValue) { bestValue = state.value; bestPath = state.path; }
    if (state.index >= items.length || !canImprove(state.index, state.value, budget - state.cost)) continue;
    const item = items[state.index];
    stack.push({ ...state, index: state.index + 1 });
    if (state.cost + item.cost <= budget) stack.push({ index: state.index + 1, value: state.value + item.value, cost: state.cost + item.cost, path: { item, previous: state.path } });
  }
  const selected = [];
  for (let node = bestPath; node; node = node.previous) selected.push(node.item.candidate);
  return finish(selected.reverse(), !capped, nodesExplored);
}

/**
 * 0/1 Knapsack Dynamic Programming Selection (ADD §6.3, SRS REQ-4.7.4, REQ-4.7.5)
 * Exact for Formulation F1 at millisecond costs / five-decimal source scores.
 * GCD-compressed dense tables or bounded Pareto states preserve that precision.
 */
export function selectKnapsack(candidates, timeBudget, sizeLimit = DP_SIZE_LIMIT) {
  if (!candidates || candidates.length === 0 || timeBudget <= 0) return [];
  if (!Number.isSafeInteger(sizeLimit) || sizeLimit < 1) throw new RangeError('DP size limit must be a positive integer.');
  const budget = budgetMilliseconds(timeBudget);
  const original = fixedValueItems(candidates);
  if (sumMilliseconds(original.map(item => item.cost)) <= budget) return assertSelectionBudget([...original].sort(compareDensity).map(item => item.candidate), timeBudget);
  const items = original.filter(item => item.cost <= budget);
  if (!items.length) return [];
  function gcd(a, b) { while (b) [a, b] = [b, a % b]; return a; }
  const divisor = items.reduce((value, item) => gcd(value, item.cost), 0);
  const capacity = Math.floor(budget / divisor);
  const costs = items.map(item => item.cost / divisor);
  const cells = (items.length + 1) * (capacity + 1);
  const limitError = () => Object.assign(new Error(`Knapsack DP retained-state requirement exceeds limit (${sizeLimit}). Use AUTO, GREEDY, or bounded BRANCH_AND_BOUND.`), { code: 'DP_SIZE_LIMIT_EXCEEDED', statusCode: 400 });
  const selected = [];
  if (cells <= sizeLimit) {
    // GCD scaling is exact: no duration is rounded to a coarse table cell.
    const table = Array.from({ length: items.length + 1 }, () => new Float64Array(capacity + 1));
    for (let row = 1; row <= items.length; row++) {
      const item = items[row - 1], weight = costs[row - 1];
      for (let cost = 0; cost <= capacity; cost++) table[row][cost] = Math.max(table[row - 1][cost], weight <= cost ? item.value + table[row - 1][cost - weight] : -Infinity);
    }
    let cost = capacity;
    for (let row = items.length; row > 0; row--) if (table[row][cost] !== table[row - 1][cost]) { selected.push(items[row - 1].candidate); cost -= costs[row - 1]; }
  } else {
    // Sorted Pareto frontier: retain only states improving value as cost rises.
    // Linked backpointers avoid copying combinations. Bound cumulative retained
    // states (and hence work/backpointer storage), not just the final frontier.
    let frontier = [{ cost: 0, value: 0, path: null }], retained = 1;
    for (let index = 0; index < items.length; index++) {
      const item = items[index], weight = costs[index];
      const included = [];
      for (const state of frontier) {
        if (state.cost + weight > capacity) break;
        included.push({ cost: state.cost + weight, value: state.value + item.value, previous: state.path });
      }
      let excludedIndex = 0, includedIndex = 0, best = -1;
      const next = [];
      while (excludedIndex < frontier.length || includedIndex < included.length) {
        const excluded = frontier[excludedIndex], added = included[includedIndex];
        let winner, fromAdded = false;
        if (!added || excluded && excluded.cost < added.cost) { winner = excluded; excludedIndex++; }
        else if (!excluded || added.cost < excluded.cost) { winner = added; includedIndex++; fromAdded = true; }
        else { winner = excluded.value >= added.value ? excluded : added; fromAdded = winner === added; excludedIndex++; includedIndex++; }
        if (winner.value <= best) continue;
        if (retained + next.length + 1 > sizeLimit) throw limitError();
        best = winner.value;
        next.push({ cost: winner.cost, value: winner.value, path: fromAdded ? { item, previous: winner.previous } : winner.path });
      }
      retained += next.length;
      frontier = next;
    }
    for (let node = frontier.at(-1).path; node; node = node.previous) selected.push(node.item.candidate);
  }
  return assertSelectionBudget(selected.reverse(), timeBudget);
}

export function checkChangedModulesCoverage(selectedTests, changedModuleIds) {
  const coveredBySelection = new Set();
  for (const test of selectedTests) {
    for (const modId of test.coveredModuleIds ?? []) {
      coveredBySelection.add(modId);
    }
  }
  const uncoveredChanged = changedModuleIds.filter((id) => !coveredBySelection.has(id));
  return {
    allCovered: uncoveredChanged.length === 0,
    uncoveredChanged,
  };
}

export function summarizeSelection(selectedTests) {
  return {
    totalExecutionTime: selectedDurationMinutes(selectedTests),
    totalScore: Number(selectedTests
      .reduce((total, test) => total + test.score, 0)
      .toFixed(5)),
  };
}
