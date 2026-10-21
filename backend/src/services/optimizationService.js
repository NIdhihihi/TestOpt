export const DEFAULT_WEIGHTS = {
  w1: 0.35, // Relevance
  w2: 0.25, // Criticality
  w3: 0.15, // Historical Failure
  w4: 0.25, // Marginal Coverage
};

export const DEFAULT_ALPHA = 0.5; // Damping factor for indirectly affected modules
export const DP_SIZE_LIMIT = 1_000_000; // Default capacity limit (n * budget_scale)

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
  return candidate.executionTime > 0 ? value / candidate.executionTime : 0;
}

export function generateSelectionReason(candidate, coveredModules, omegaMap, totalOmega, weights = DEFAULT_WEIGHTS, changedSet = new Set()) {
  const marginalFraction = calculateMarginalCoverage(candidate.coveredModuleIds, coveredModules, omegaMap, totalOmega);
  const marginalPct = Math.round(marginalFraction * 100);
  const valueAtSelection = calculateTestValue(candidate, coveredModules, omegaMap, totalOmega, weights);
  const effAtSelection = candidate.executionTime > 0 ? valueAtSelection / candidate.executionTime : 0;

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
    const executionTime = toNumber(test.execution_time, 1);

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
  const totalCandidateTime = candidates.reduce((sum, c) => sum + c.executionTime, 0);
  if (totalCandidateTime <= timeBudget) {
    return [...candidates].sort((a, b) => {
      if (Math.abs(b.efficiency - a.efficiency) > 1e-9) return b.efficiency - a.efficiency;
      if (a.executionTime !== b.executionTime) return a.executionTime - b.executionTime;
      return a.testId.localeCompare(b.testId);
    });
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
  for (const cand of candidates) {
    pq.push({ efficiency: cand.efficiency, candidate: cand });
  }

  const selected = [];
  let remainingBudget = timeBudget;
  const coveredModules = new Set();

  while (!pq.isEmpty()) {
    const top = pq.pop();
    const cand = top.candidate;

    if (cand.executionTime > remainingBudget) {
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

    selected.push({
      ...cand,
      score: scoreAtSelection,
      reason: reasonAtSelection,
    });

    remainingBudget = Number((remainingBudget - cand.executionTime).toFixed(2));
    for (const modId of cand.coveredModuleIds) {
      coveredModules.add(modId);
    }
  }

  // ADD §6.2 Safeguard: Compare with best single candidate that fits the budget
  let bestSingle = null;
  for (const cand of candidates) {
    if (cand.executionTime <= timeBudget) {
      if (!bestSingle || cand.score > bestSingle.score) {
        bestSingle = cand;
      }
    }
  }

  const totalSelectedScore = selected.reduce((sum, c) => sum + c.score, 0);
  if (bestSingle && bestSingle.score > totalSelectedScore) {
    return [bestSingle];
  }

  return selected;
}

/**
 * Branch and Bound Exact Selection (Combinatorial State-Space Search with LP Relaxation Bound)
 * Solves Formulation F1 with O(n) memory and early branch pruning.
 */
export function selectBranchAndBound(candidates, timeBudget, options = {}) {
  if (!candidates || candidates.length === 0 || timeBudget <= 0) return [];

  // REQ-4.7.7: If budget covers all candidates, select all
  const totalCandidateTime = candidates.reduce((sum, c) => sum + c.executionTime, 0);
  if (totalCandidateTime <= timeBudget) {
    return [...candidates].sort((a, b) => {
      if (Math.abs(b.efficiency - a.efficiency) > 1e-9) return b.efficiency - a.efficiency;
      if (a.executionTime !== b.executionTime) return a.executionTime - b.executionTime;
      return a.testId.localeCompare(b.testId);
    });
  }

  const maxNodes = options.maxNodes ?? 50000;
  const timeoutMs = options.timeoutMs ?? 2000;
  const startTime = Date.now();

  // Sort descending by initial efficiency ratio
  const items = [...candidates].sort((a, b) => {
    if (Math.abs(b.efficiency - a.efficiency) > 1e-9) return b.efficiency - a.efficiency;
    if (a.executionTime !== b.executionTime) return a.executionTime - b.executionTime;
    return a.testId.localeCompare(b.testId);
  });

  // Fractional Knapsack Upper Bound calculation
  function computeUpperBound(startIndex, currentVal, remBudget) {
    let bound = currentVal;
    let b = remBudget;
    for (let i = startIndex; i < items.length; i++) {
      if (items[i].executionTime <= b) {
        b -= items[i].executionTime;
        bound += items[i].score;
      } else {
        bound += items[i].score * (b / items[i].executionTime);
        break;
      }
    }
    return bound;
  }

  let bestVal = 0;
  let bestCombination = [];
  let nodesExplored = 0;

  function branch(index, currentVal, currentWeight, currentCombination) {
    nodesExplored++;
    if (nodesExplored > maxNodes || Date.now() - startTime > timeoutMs) {
      return;
    }

    if (currentVal > bestVal) {
      bestVal = currentVal;
      bestCombination = [...currentCombination];
    }

    if (index >= items.length) return;

    const remBudget = timeBudget - currentWeight;
    const upperBound = computeUpperBound(index, currentVal, remBudget);

    // Prune subtree if upper bound cannot exceed best known value
    if (upperBound <= bestVal + 1e-9) {
      return;
    }

    // Branch 1: Include item[index]
    const nextItem = items[index];
    if (currentWeight + nextItem.executionTime <= timeBudget) {
      currentCombination.push(nextItem);
      branch(index + 1, currentVal + nextItem.score, currentWeight + nextItem.executionTime, currentCombination);
      currentCombination.pop();
    }

    // Branch 2: Exclude item[index]
    branch(index + 1, currentVal, currentWeight, currentCombination);
  }

  branch(0, 0, 0, []);

  return bestCombination;
}

/**
 * 0/1 Knapsack Dynamic Programming Selection (ADD §6.3, SRS REQ-4.7.4, REQ-4.7.5)
 * Exact for Formulation F1, with instance size guard.
 */
export function selectKnapsack(candidates, timeBudget, sizeLimit = DP_SIZE_LIMIT) {
  if (!candidates || candidates.length === 0 || timeBudget <= 0) return [];

  // REQ-4.7.7: If budget covers all candidates, select all
  const totalCandidateTime = candidates.reduce((sum, c) => sum + c.executionTime, 0);
  if (totalCandidateTime <= timeBudget) {
    return [...candidates].sort((a, b) => b.efficiency - a.efficiency);
  }

  const scale = 100;
  const capacity = Math.round(timeBudget * scale);
  const instanceSize = candidates.length * capacity;

  // REQ-4.7.5: Size limit guard
  if (instanceSize > sizeLimit) {
    const error = new Error(`Knapsack DP capacity (${candidates.length} tests x ${timeBudget} min = ${instanceSize} cells) exceeds limit (${sizeLimit}). Use GREEDY or BRANCH_AND_BOUND instead.`);
    error.code = "DP_SIZE_LIMIT_EXCEEDED";
    error.statusCode = 400;
    throw error;
  }

  const weights = candidates.map((candidate) => Math.round(candidate.executionTime * scale));
  const table = Array.from({ length: candidates.length + 1 }, () => Array(capacity + 1).fill(0));

  for (let candidateIndex = 1; candidateIndex <= candidates.length; candidateIndex += 1) {
    const candidate = candidates[candidateIndex - 1];
    const weight = weights[candidateIndex - 1];

    for (let currentCapacity = 0; currentCapacity <= capacity; currentCapacity += 1) {
      const withoutCandidate = table[candidateIndex - 1][currentCapacity];
      const withCandidate = weight <= currentCapacity
        ? candidate.score + table[candidateIndex - 1][currentCapacity - weight]
        : Number.NEGATIVE_INFINITY;
      table[candidateIndex][currentCapacity] = Math.max(withoutCandidate, withCandidate);
    }
  }

  const selected = [];
  let currentCapacity = capacity;

  for (let candidateIndex = candidates.length; candidateIndex > 0; candidateIndex -= 1) {
    if (table[candidateIndex][currentCapacity] !== table[candidateIndex - 1][currentCapacity]) {
      selected.push(candidates[candidateIndex - 1]);
      currentCapacity -= weights[candidateIndex - 1];
    }
  }

  return selected.reverse();
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
    totalExecutionTime: Number(selectedTests
      .reduce((total, test) => total + test.executionTime, 0)
      .toFixed(2)),
    totalScore: Number(selectedTests
      .reduce((total, test) => total + test.score, 0)
      .toFixed(5)),
  };
}
