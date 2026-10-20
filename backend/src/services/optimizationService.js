const PRIORITY_MULTIPLIERS = {
  HIGH: 1.2,
  MEDIUM: 1.1,
  LOW: 1,
};

function toNumber(value) {
  return Number(value);
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

export function buildCandidates({ tests, coverage, history, modules, affectedModuleIds }) {
  const affected = new Set(affectedModuleIds);
  const criticalityByModule = new Map(
    modules.map((module) => [module.module_id, toNumber(module.criticality)]),
  );
  const historyByTest = new Map(history.map((entry) => [entry.test_id, entry]));
  const coverageByTest = new Map();

  for (const entry of coverage) {
    if (!affected.has(entry.module_id)) continue;

    const entries = coverageByTest.get(entry.test_id) ?? [];
    entries.push(entry);
    coverageByTest.set(entry.test_id, entries);
  }

  return tests
    .filter((test) => test.status === "ACTIVE" && coverageByTest.has(test.test_id))
    .map((test) => {
      const relevantCoverage = coverageByTest.get(test.test_id);
      const impactScore = relevantCoverage.reduce(
        (total, entry) => total + toNumber(entry.coverage_weight) * criticalityByModule.get(entry.module_id),
        0,
      );
      const testHistory = historyByTest.get(test.test_id);
      const totalExecutions = toNumber(testHistory?.total_executions ?? 0);
      const failureRate = totalExecutions === 0
        ? 0
        : toNumber(testHistory.failure_count) / totalExecutions;
      const score = impactScore
        * (PRIORITY_MULTIPLIERS[test.priority] ?? 1)
        * (1 + failureRate);

      return {
        testId: test.test_id,
        testName: test.test_name,
        executionTime: toNumber(test.execution_time),
        priority: test.priority,
        score: Number(score.toFixed(5)),
        coveredModuleIds: relevantCoverage.map((entry) => entry.module_id),
        reason: `Covers affected modules (${relevantCoverage.map((entry) => entry.module_id).join(", ")}); score uses coverage, module criticality, priority, and failure history.`,
      };
    });
}

export function selectGreedy(candidates, timeBudget) {
  let remainingTime = timeBudget;

  return [...candidates]
    .sort((left, right) => (right.score / right.executionTime) - (left.score / left.executionTime))
    .filter((candidate) => {
      if (candidate.executionTime > remainingTime) return false;

      remainingTime = Number((remainingTime - candidate.executionTime).toFixed(2));
      return true;
    });
}

export function selectKnapsack(candidates, timeBudget) {
  const scale = 100;
  const capacity = Math.round(timeBudget * scale);
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
