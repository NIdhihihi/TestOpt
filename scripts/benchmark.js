#!/usr/bin/env node

/**
 * ============================================================================
 * TestOpt Academic Evaluation & Benchmark Suite
 * Reference: ADD §10–§11, SRS §6.2
 *
 * 1. Synthetic Benchmark Generator:
 *    - Generates 100 to 500 modules and 1,000 to 10,000 test cases with realistic
 *      DAG dependencies, criticalities, bipartite coverage, and defect histories.
 * 2. Comparative Evaluation Matrix (The DAA Trifecta vs. Baselines):
 *    - Exp 1: Wall-clock runtime vs. problem size n and budget B
 *    - Exp 2: Memory footprint vs. budget B (B&B low memory vs. DP matrix)
 *    - Exp 3: Solution quality (% of optimum achieved and optimality gap)
 *    - Exp 4: Scheduling efficiency vs. theoretical Lower Bound (Graham's 1969 LPT bound)
 *    - Exp 5: Failure feedback efficacy (defect detection rate with w3=0.15 vs. w3=0.00)
 * ============================================================================
 */

import { performance } from "perf_hooks";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

import {
  buildCandidates,
  selectGreedy,
  selectBranchAndBound,
  selectKnapsack,
  DEFAULT_WEIGHTS,
  DEFAULT_ALPHA,
  findAffectedModuleIds,
  summarizeSelection,
  DP_SIZE_LIMIT,
} from "../backend/src/services/optimizationService.js";

import { createSchedule } from "../backend/src/execution/scheduler.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, "..");
const DOCS_DIR = path.resolve(ROOT_DIR, "docs");

// ============================================================================
// 1. DETERMINISTIC PSEUDO-RANDOM NUMBER GENERATOR (Mulberry32)
// ============================================================================

function createRNG(seed = 42) {
  let s = seed >>> 0;
  return function next() {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ============================================================================
// 2. SYNTHETIC BENCHMARK GENERATOR
// ============================================================================

/**
 * Generates a realistic synthetic test engineering project.
 * - Modules: 100 to 500 with DAG dependencies and criticality [1..10]
 * - Tests: 1,000 to 10,000 with realistic log-skewed durations [0.1..10.0 min]
 * - Bipartite Coverage: Tests cover 1..5 modules
 * - Defect Distribution: Pareto-distributed historical failure rates
 */
export function generateSyntheticProject({
  moduleCount = 100,
  testCount = 1000,
  changedModuleCount = 8,
  defectProbability = 0.15,
  seed = 42,
} = {}) {
  const rng = createRNG(seed);

  // 1. Generate Modules
  const modules = [];
  for (let i = 1; i <= moduleCount; i++) {
    const id = `MOD_${String(i).padStart(4, "0")}`;
    // Criticality 1..10 with mean ~5.5
    const crit = Math.min(10, Math.max(1, Math.round(rng() * 4 + rng() * 5 + 1)));
    modules.push({
      module_id: id,
      module_name: `Module ${i}`,
      criticality: crit,
    });
  }

  // 2. Generate DAG Dependencies (edge i -> j only if j < i to guarantee acyclicity)
  const dependencies = [];
  for (let i = 2; i <= moduleCount; i++) {
    const sourceId = `MOD_${String(i).padStart(4, "0")}`;
    // Each module depends on 1 to 3 prior modules with 40% probability
    const depCount = Math.floor(rng() * 3) + 1;
    const targets = new Set();
    for (let d = 0; d < depCount; d++) {
      if (rng() < 0.45) {
        const targetIndex = Math.floor(rng() * (i - 1)) + 1;
        const targetId = `MOD_${String(targetIndex).padStart(4, "0")}`;
        if (!targets.has(targetId)) {
          targets.add(targetId);
          dependencies.push({
            source_module_id: sourceId,
            target_module_id: targetId,
          });
        }
      }
    }
  }

  // 3. Select Changed Modules (Simulating a PR / Code Change)
  const changedModuleIds = [];
  const chosenIndices = new Set();
  while (chosenIndices.size < Math.min(changedModuleCount, moduleCount)) {
    const idx = Math.floor(rng() * moduleCount) + 1;
    if (!chosenIndices.has(idx)) {
      chosenIndices.add(idx);
      changedModuleIds.push(`MOD_${String(idx).padStart(4, "0")}`);
    }
  }

  // Compute transitive impact via BFS
  const affectedModuleIds = findAffectedModuleIds(changedModuleIds, dependencies);
  const affectedSet = new Set(affectedModuleIds);

  // 4. Generate Test Cases and Coverage
  const tests = [];
  const coverage = [];
  const history = [];
  const latentDefectiveTestIds = new Set();

  for (let i = 1; i <= testCount; i++) {
    const testId = `TEST_${String(i).padStart(5, "0")}`;

    // Execution time: 65% short (0.1..1.5m), 25% medium (1.5..4.0m), 10% long (4.0..9.5m)
    const timeRoll = rng();
    let execTime;
    if (timeRoll < 0.65) {
      execTime = Number((0.2 + rng() * 1.3).toFixed(2));
    } else if (timeRoll < 0.90) {
      execTime = Number((1.5 + rng() * 2.5).toFixed(2));
    } else {
      execTime = Number((4.0 + rng() * 5.5).toFixed(2));
    }

    // Priority: HIGH (20%), MEDIUM (50%), LOW (30%)
    const pRoll = rng();
    const priority = pRoll < 0.2 ? "HIGH" : pRoll < 0.7 ? "MEDIUM" : "LOW";

    tests.push({
      test_id: testId,
      test_name: `Test Suite ${i}`,
      execution_time: execTime,
      priority,
      status: "ACTIVE",
    });

    // Bipartite Coverage: 1 to 4 modules
    // Bias: 50% chance to target affected modules to ensure rich candidate pool
    const coveredMods = new Set();
    const coverCount = Math.floor(rng() * 4) + 1;

    for (let c = 0; c < coverCount; c++) {
      if (rng() < 0.5 && affectedModuleIds.length > 0) {
        const affIdx = Math.floor(rng() * affectedModuleIds.length);
        coveredMods.add(affectedModuleIds[affIdx]);
      } else {
        const anyIdx = Math.floor(rng() * moduleCount) + 1;
        coveredMods.add(`MOD_${String(anyIdx).padStart(4, "0")}`);
      }
    }

    for (const modId of coveredMods) {
      coverage.push({
        test_id: testId,
        module_id: modId,
        coverage_weight: 1.0,
      });
    }

    // Historical failure data & Latent defect injection
    const totalExecutions = Math.floor(rng() * 80) + 20;
    const coversAffected = [...coveredMods].some((id) => affectedSet.has(id));

    let failureCount = 0;
    // Latent defect injection: if test covers affected modules, it has defectProbability of catching a regression bug
    if (coversAffected && rng() < defectProbability) {
      latentDefectiveTestIds.add(testId);
      // Historically prone to failing (30% to 75% failure rate)
      const failRate = 0.3 + rng() * 0.45;
      failureCount = Math.round(totalExecutions * failRate);
    } else {
      // Normal test: low historical failure rate (0% to 5%)
      const failRate = rng() * 0.05;
      failureCount = Math.round(totalExecutions * failRate);
    }

    history.push({
      test_id: testId,
      total_executions: totalExecutions,
      failure_count: failureCount,
    });
  }

  return {
    modules,
    dependencies,
    changedModuleIds,
    affectedModuleIds,
    tests,
    coverage,
    history,
    latentDefectiveTestIds,
  };
}

// ============================================================================
// 3. BASELINE SELECTION ALGORITHMS
// ============================================================================

/**
 * Baseline 1: Run All Candidates (Constrained by Budget)
 * Selects candidate tests in FIFO / arrival order until the time budget is exhausted.
 */
export function selectRunAll(candidates, timeBudget) {
  if (!candidates || candidates.length === 0 || timeBudget <= 0) return [];
  const selected = [];
  let remainingBudget = timeBudget;

  for (const cand of candidates) {
    if (cand.executionTime <= remainingBudget) {
      selected.push(cand);
      remainingBudget = Number((remainingBudget - cand.executionTime).toFixed(2));
    }
  }
  return selected;
}

/**
 * Baseline 2: Static Priority Selection
 * Sorts strictly by static test priority (HIGH > MEDIUM > LOW), breaking ties
 * by shorter duration, until the time budget is exhausted.
 * Ignores marginal coverage, dynamic relevance, and failure history.
 */
export function selectStaticPriority(candidates, timeBudget) {
  if (!candidates || candidates.length === 0 || timeBudget <= 0) return [];
  const priorityRank = { HIGH: 1, MEDIUM: 2, LOW: 3 };

  const sorted = [...candidates].sort((a, b) => {
    const rankDiff = (priorityRank[a.priority] || 4) - (priorityRank[b.priority] || 4);
    if (rankDiff !== 0) return rankDiff;
    if (a.executionTime !== b.executionTime) return a.executionTime - b.executionTime;
    return a.testId.localeCompare(b.testId);
  });

  const selected = [];
  let remainingBudget = timeBudget;

  for (const cand of sorted) {
    if (cand.executionTime <= remainingBudget) {
      selected.push(cand);
      remainingBudget = Number((remainingBudget - cand.executionTime).toFixed(2));
    }
  }
  return selected;
}

// ============================================================================
// 4. EXPERIMENTAL EVALUATION SUITE
// ============================================================================

/**
 * EXPERIMENT 1: Wall-Clock Runtime vs. Problem Size n and Budget B
 */
export function runExperiment1_Runtime({ sizes = [100, 500, 1000, 2500, 5000], budget = 30 } = {}) {
  const results = [];

  for (const n of sizes) {
    const project = generateSyntheticProject({
      moduleCount: Math.max(100, Math.round(n / 10)),
      testCount: n,
      changedModuleCount: 10,
      seed: 100 + n,
    });

    const candidates = buildCandidates({
      tests: project.tests,
      coverage: project.coverage,
      history: project.history,
      modules: project.modules,
      affectedModuleIds: project.affectedModuleIds,
      changedModuleIds: project.changedModuleIds,
    });

    const candCount = candidates.length;

    // 1. Greedy (Lazy Heap)
    const t0 = performance.now();
    const greedySelected = selectGreedy(candidates, budget);
    const greedyTime = performance.now() - t0;

    // 2. Static Priority Baseline
    const t1 = performance.now();
    const prioritySelected = selectStaticPriority(candidates, budget);
    const priorityTime = performance.now() - t1;

    // 3. Run All Baseline
    const t2 = performance.now();
    const runAllSelected = selectRunAll(candidates, budget);
    const runAllTime = performance.now() - t2;

    // 4. Branch & Bound (with 2s safeguard)
    const t3 = performance.now();
    const bbSelected = selectBranchAndBound(candidates, budget, { timeoutMs: 2000, maxNodes: 50000 });
    const bbTime = performance.now() - t3;

    // 5. 0/1 Knapsack DP (Capacity Guarded)
    let dpTime = null;
    let dpStatus = "OK";
    try {
      const t4 = performance.now();
      selectKnapsack(candidates, budget);
      dpTime = performance.now() - t4;
    } catch (err) {
      if (err.code === "DP_SIZE_LIMIT_EXCEEDED") {
        dpStatus = "GUARD_TRIGGERED";
      } else {
        dpStatus = "ERROR";
      }
    }

    results.push({
      n,
      candidateCount: candCount,
      budget,
      greedy: { timeMs: Number(greedyTime.toFixed(2)), count: greedySelected.length },
      branchAndBound: { timeMs: Number(bbTime.toFixed(2)), count: bbSelected.length },
      knapsackDP: { timeMs: dpTime !== null ? Number(dpTime.toFixed(2)) : null, status: dpStatus },
      staticPriority: { timeMs: Number(priorityTime.toFixed(2)), count: prioritySelected.length },
      runAll: { timeMs: Number(runAllTime.toFixed(2)), count: runAllSelected.length },
    });
  }

  return results;
}

/**
 * EXPERIMENT 2: Memory Footprint vs. Budget B (B&B vs. Knapsack DP)
 * Analytical Matrix Size & Empirical Heap Consumption
 */
export function runExperiment2_Memory({ n = 500, budgets = [10, 25, 50, 100, 200] } = {}) {
  const project = generateSyntheticProject({
    moduleCount: 150,
    testCount: n,
    changedModuleCount: 10,
    seed: 2024,
  });

  const candidates = buildCandidates({
    tests: project.tests,
    coverage: project.coverage,
    history: project.history,
    modules: project.modules,
    affectedModuleIds: project.affectedModuleIds,
    changedModuleIds: project.changedModuleIds,
  });

  const scale = 100;
  const results = [];

  for (const B of budgets) {
    const capacity = Math.round(B * scale);
    const dpCells = (candidates.length + 1) * (capacity + 1);
    // 8 bytes per Float64 number + 8 bytes JS array pointer overhead ≈ 16 bytes/cell
    const dpEstimatedMemoryMB = Number(((dpCells * 16) / (1024 * 1024)).toFixed(2));

    // Branch & Bound recursion stack space is bounded by depth n:
    // O(n) references = 500 items * 64 bytes ≈ 32 KB
    const bbEstimatedMemoryMB = Number(((candidates.length * candidates.length * 8 + candidates.length * 64) / (1024 * 1024)).toFixed(4));

    // Greedy MaxHeap space is bounded by n elements:
    // O(n) heap array = 500 items * 64 bytes ≈ 32 KB
    const greedyEstimatedMemoryMB = Number(((candidates.length * 64) / (1024 * 1024)).toFixed(4));

    const exceedsGuard = dpCells > DP_SIZE_LIMIT;
    const memorySavingFactor = Math.round(dpEstimatedMemoryMB / Math.max(0.01, bbEstimatedMemoryMB));

    results.push({
      budget: B,
      candidateCount: candidates.length,
      dpCells,
      dpEstimatedMemoryMB,
      bbEstimatedMemoryMB,
      greedyEstimatedMemoryMB,
      exceedsGuard,
      memorySavingFactor,
    });
  }

  return results;
}

/**
 * EXPERIMENT 3: Solution Quality & Optimality Gap (% of Optimum Achieved)
 */
export function runExperiment3_SolutionQuality({ sizes = [50, 100, 200, 300, 500], budget = 20 } = {}) {
  const results = [];

  for (const n of sizes) {
    const project = generateSyntheticProject({
      moduleCount: Math.max(50, Math.round(n / 5)),
      testCount: n,
      changedModuleCount: 6,
      seed: 3000 + n,
    });

    const candidates = buildCandidates({
      tests: project.tests,
      coverage: project.coverage,
      history: project.history,
      modules: project.modules,
      affectedModuleIds: project.affectedModuleIds,
      changedModuleIds: project.changedModuleIds,
    });

    // 1. Exact Optimum (Branch & Bound with LP bound)
    let search;
    const optSelected = selectBranchAndBound(candidates, budget, { timeoutMs: 3000, maxNodes: 100000, onComplete: info => { search = info; } });
    const staticScores = new Map(candidates.map(test => [test.testId, test.score]));
    const score = selection => Number(selection.reduce((sum, test) => sum + staticScores.get(test.testId), 0).toFixed(4));
    const optScore = score(optSelected);

    // 2. Greedy (Lazy Heap with safeguard)
    const greedySelected = selectGreedy(candidates, budget);
    const greedyScore = score(greedySelected);

    // 3. Static Priority Baseline
    const prioritySelected = selectStaticPriority(candidates, budget);
    const priorityScore = score(prioritySelected);

    // 4. Run All Baseline
    const runAllSelected = selectRunAll(candidates, budget);
    const runAllScore = score(runAllSelected);

    const greedyRatio = optScore > 0 ? Number(((greedyScore / optScore) * 100).toFixed(2)) : 100;
    const priorityRatio = optScore > 0 ? Number(((priorityScore / optScore) * 100).toFixed(2)) : 0;
    const runAllRatio = optScore > 0 ? Number(((runAllScore / optScore) * 100).toFixed(2)) : 0;
    const greedyGap = Number((100 - greedyRatio).toFixed(2));

    results.push({
      n,
      candidateCount: candidates.length,
      budget,
      optimumScore: optScore,
      provenOptimal: search?.provenOptimal ?? false,
      greedyScore,
      greedyRatio,
      greedyGap,
      priorityScore,
      priorityRatio,
      runAllScore,
      runAllRatio,
    });
  }

  return results;
}

/**
 * EXPERIMENT 4: Scheduling Efficiency vs. Theoretical Lower Bound
 * Schedulers: FCFS, Priority, Greedy Load Balancing, LPT across m in [2, 4, 8, 16]
 */
export function runExperiment4_Scheduling({ testCount = 50, workerCounts = [2, 4, 8, 16] } = {}) {
  const project = generateSyntheticProject({
    moduleCount: 100,
    testCount: 500,
    changedModuleCount: 8,
    seed: 4000,
  });

  const candidates = buildCandidates({
    tests: project.tests,
    coverage: project.coverage,
    history: project.history,
    modules: project.modules,
    affectedModuleIds: project.affectedModuleIds,
    changedModuleIds: project.changedModuleIds,
  });

  // Select 50 tests via Greedy
  const selectedTests = selectGreedy(candidates, 100).slice(0, testCount);
  const strategies = ["FCFS", "PRIORITY", "GREEDY", "LPT"];
  const results = [];

  for (const m of workerCounts) {
    const workers = Array.from({ length: m }, (_, i) => ({
      workerId: `worker-${i + 1}`,
      workerName: `Worker ${i + 1}`,
      workerStatus: "AVAILABLE",
    }));

    const strategyResults = {};
    for (const strat of strategies) {
      const schedule = createSchedule({
        selectedTests,
        strategy: strat,
        workers,
      });

      strategyResults[strat] = {
        makespan: schedule.metrics.makespan,
        ratioToLB: Number((schedule.metrics.makespan / schedule.metrics.lowerBound).toFixed(3)),
        utilization: schedule.metrics.workerUtilization,
        imbalance: schedule.metrics.imbalance,
      };
    }

    const lowerBound = strategyResults["LPT"] ? Math.max(
      selectedTests.reduce((s, t) => s + t.executionTime, 0) / m,
      Math.max(...selectedTests.map((t) => t.executionTime))
    ) : 0;

    results.push({
      workers: m,
      testCount: selectedTests.length,
      lowerBound,
      strategies: strategyResults,
    });
  }

  return results;
}

/**
 * EXPERIMENT 5: Failure Feedback Efficacy (Ablation: w3 = 0.15 vs. w3 = 0.00)
 * Evaluates defect detection rate and early fault discovery.
 */
export function runExperiment5_FailureFeedback({ budgets = [15, 30, 45, 60] } = {}) {
  const project = generateSyntheticProject({
    moduleCount: 150,
    testCount: 1200,
    changedModuleCount: 12,
    defectProbability: 0.20,
    seed: 5000,
  });

  const totalDefects = project.latentDefectiveTestIds.size;
  const results = [];

  for (const budget of budgets) {
    // Model A: Full 4-factor valuation with Historical Failure Weight w3 = 0.15
    const candidatesA = buildCandidates({
      tests: project.tests,
      coverage: project.coverage,
      history: project.history,
      modules: project.modules,
      affectedModuleIds: project.affectedModuleIds,
      changedModuleIds: project.changedModuleIds,
      weights: { w1: 0.35, w2: 0.25, w3: 0.15, w4: 0.25 },
    });
    const selectedA = selectGreedy(candidatesA, budget);
    const defectsCaughtA = selectedA.filter((t) => project.latentDefectiveTestIds.has(t.testId)).length;
    const detectionRateA = totalDefects > 0 ? Number(((defectsCaughtA / totalDefects) * 100).toFixed(2)) : 0;

    // Model B: Ablation with w3 = 0.00 (Failure History disabled, weights renormalized)
    const candidatesB = buildCandidates({
      tests: project.tests,
      coverage: project.coverage,
      history: project.history,
      modules: project.modules,
      affectedModuleIds: project.affectedModuleIds,
      changedModuleIds: project.changedModuleIds,
      weights: { w1: 0.425, w2: 0.325, w3: 0.00, w4: 0.25 },
    });
    const selectedB = selectGreedy(candidatesB, budget);
    const defectsCaughtB = selectedB.filter((t) => project.latentDefectiveTestIds.has(t.testId)).length;
    const detectionRateB = totalDefects > 0 ? Number(((defectsCaughtB / totalDefects) * 100).toFixed(2)) : 0;

    const defectImprovementPct = Number((detectionRateA - detectionRateB).toFixed(2));
    const relativeGainPct = detectionRateB > 0
      ? Number((((detectionRateA - detectionRateB) / detectionRateB) * 100).toFixed(1))
      : 0;

    results.push({
      budget,
      totalLatentDefects: totalDefects,
      withHistory: {
        testsSelected: selectedA.length,
        defectsCaught: defectsCaughtA,
        detectionRatePct: detectionRateA,
      },
      withoutHistory: {
        testsSelected: selectedB.length,
        defectsCaught: defectsCaughtB,
        detectionRatePct: detectionRateB,
      },
      improvementPct: defectImprovementPct,
      relativeGainPct,
    });
  }

  return results;
}

// ============================================================================
// 5. REPORT GENERATION & ASCII FORMATTING
// ============================================================================

export function generateMarkdownReport({ exp1, exp2, exp3, exp4, exp5 }) {
  const table = (headers, rows) => [headers.join(" | "), headers.map(() => "---").join(" | "), ...rows.map(row => row.join(" | "))].join("\n");
  return `# TestOpt Benchmark Report

Generated: ${new Date().toISOString()} / ${process.version} / ${process.platform} ${process.arch}

## Method

Deterministic synthetic inputs; single-run timings are observations, not performance guarantees. Budget FIFO selects tests within budget rather than running the entire suite. Quality uses the same static F1 coefficients for all algorithms, including greedy; it does not certify the dynamic marginal-coverage objective. Branch-and-bound is proven optimal only when search finishes without a cap.

## Runtime (milliseconds)

${table(["Tests", "Candidates", "Greedy", "B&B", "DP", "Priority", "Budget FIFO"], exp1.map(r => [r.n, r.candidateCount, r.greedy.timeMs, r.branchAndBound.timeMs, r.knapsackDP.timeMs ?? r.knapsackDP.status, r.staticPriority.timeMs, r.runAll.timeMs]))}

## Memory storage models (MB)

Estimates, not measured heap usage. DP assumes 16 bytes/cell; greedy 64 bytes/candidate. B&B includes a conservative quadratic allowance for copied partial combinations. Object overhead and garbage collection vary. Guarded DP instances are not allocated.

${table(["Budget", "DP model", "B&B model", "Greedy model", "DP guarded"], exp2.map(r => [r.budget, r.dpEstimatedMemoryMB, r.bbEstimatedMemoryMB, r.greedyEstimatedMemoryMB, r.exceedsGuard]))}

## Static F1 quality

${table(["Tests", "Budget", "B&B reference", "Proven optimal", "Greedy", "Priority", "Budget FIFO", "Greedy/reference"], exp3.map(r => [r.n, r.budget, r.optimumScore, r.provenOptimal, r.greedyScore, r.priorityScore, r.runAllScore, r.greedyRatio + "%"]))}

Observed greedy/reference range: ${Math.min(...exp3.map(r => r.greedyRatio))}% to ${Math.max(...exp3.map(r => r.greedyRatio))}%. Capped references are incumbents, not certified optima.

## Scheduling

For fractional minutes, LB = max(sum(durations) / workers, longest duration). Ratios to LB do not prove a theorem against the unknown optimal makespan. Imbalance is maximum minus minimum load in minutes.

${table(["Workers", "LB (min)", "FCFS", "Priority", "Greedy", "LPT", "LPT utilization"], exp4.map(r => [r.workers, Number(r.lowerBound.toFixed(5)), r.strategies.FCFS.makespan, r.strategies.PRIORITY.makespan, r.strategies.GREEDY.makespan, r.strategies.LPT.makespan, r.strategies.LPT.utilization + "%"]))}

## Synthetic failure-history ablation

Latent defects are simulated, not measured production bugs. Results apply to these inputs only.

${table(["Budget", "Latent defects", "Caught with history", "Caught without history", "Relative gain"], exp5.map(r => [r.budget, r.totalLatentDefects, r.withHistory.defectsCaught, r.withoutHistory.defectsCaught, r.relativeGainPct + "%"]))}
`;
}

// ============================================================================
// 6. MAIN EXECUTION ROUTINE
// ============================================================================

export async function runBenchmarks({ isFull = false, isJson = false } = {}) {
  const runtimeSizes = isFull ? [100, 500, 1000, 2500, 5000, 10000] : [100, 500, 1000, 2500, 5000];

  console.log("===============================================================================");
  console.log("          TESTOPT ACADEMIC EVALUATION & BENCHMARK SUITE");
  console.log("          Reference: ADD §10–§11, SRS §6.2 (The DAA Trifecta)");
  console.log("===============================================================================\n");

  console.log("🔬 [1/5] Running Experiment 1: Wall-Clock Runtime vs. Problem Size (n)...");
  const exp1 = runExperiment1_Runtime({ sizes: runtimeSizes, budget: 30 });
  console.log("    ✓ Evaluated sizes:", runtimeSizes.join(", "));

  console.log("💾 [2/5] Running Experiment 2: Memory Footprint vs. Budget (B)...");
  const exp2 = runExperiment2_Memory({ n: 500, budgets: [10, 25, 50, 100, 200] });
  console.log("    ✓ Evaluated budgets:", [10, 25, 50, 100, 200].join(", "), "min");

  console.log("🎯 [3/5] Running Experiment 3: Static F1 quality vs. B&B reference...");
  const exp3 = runExperiment3_SolutionQuality({ sizes: [50, 100, 200, 300, 500], budget: 20 });
  console.log("    ✓ Evaluated static F1 scores across n in [50..500]");

  console.log("⚡ [4/5] Running Experiment 4: Scheduling Efficiency vs. Theoretical Lower Bound...");
  const exp4 = runExperiment4_Scheduling({ testCount: 50, workerCounts: [2, 4, 8, 16] });
  console.log("    ✓ Evaluated 4 schedulers across 2, 4, 8, 16 workers");

  console.log("📈 [5/5] Running Experiment 5: Failure Feedback Efficacy (Ablation w3=0.15 vs w3=0)...");
  const exp5 = runExperiment5_FailureFeedback({ budgets: [15, 30, 45, 60] });
  console.log("    ✓ Evaluated defect detection across budgets 15..60 min\n");

  const results = { exp1, exp2, exp3, exp4, exp5 };

  if (isJson) {
    console.log(JSON.stringify(results, null, 2));
    return results;
  }

  // Print Terminal Tables
  console.log("┌─────────────────────────────────────────────────────────────────────────────────────────────┐");
  console.log("│ EXPERIMENT 1: WALL-CLOCK RUNTIME VS. PROBLEM SIZE (Budget = 30 min)                        │");
  console.log("├──────────────┬────────────┬──────────────┬──────────────────┬─────────────────┬─────────────┤");
  console.log("│ Tests (n)    │ Candidates │ Greedy (ms)  │ Knapsack DP (ms) │ Branch & Bound  │ Priority    │");
  console.log("├──────────────┼────────────┼──────────────┼──────────────────┼─────────────────┼─────────────┤");
  for (const r of exp1) {
    const dpStr = r.knapsackDP.timeMs !== null ? `${r.knapsackDP.timeMs} ms` : `⚠️ ${r.knapsackDP.status}`;
    console.log(
      `│ ${String(r.n).padEnd(12)} │ ${String(r.candidateCount).padEnd(10)} │ ${String(r.greedy.timeMs + " ms").padEnd(12)} │ ${dpStr.padEnd(16)} │ ${String(r.branchAndBound.timeMs + " ms").padEnd(15)} │ ${String(r.staticPriority.timeMs + " ms").padEnd(11)} │`
    );
  }
  console.log("└──────────────┴────────────┴──────────────┴──────────────────┴─────────────────┴─────────────┘\n");

  console.log("┌─────────────────────────────────────────────────────────────────────────────────────────────┐");
  console.log("│ EXPERIMENT 2: MEMORY STORAGE ESTIMATES (n = 500 Tests)                                              │");
  console.log("├──────────────┬──────────────────┬──────────────────┬──────────────────┬─────────────────────┤");
  console.log("│ Budget B     │ DP Matrix RAM    │ Branch & Bound   │ Greedy Heap      │ RAM Reduction       │");
  console.log("├──────────────┼──────────────────┼──────────────────┼──────────────────┼─────────────────────┤");
  for (const r of exp2) {
    console.log(
      `│ ${String(r.budget + " min").padEnd(12)} │ ${String(r.dpEstimatedMemoryMB + " MB").padEnd(16)} │ ${String(r.bbEstimatedMemoryMB + " MB").padEnd(16)} │ ${String(r.greedyEstimatedMemoryMB + " MB").padEnd(16)} │ ${String(r.memorySavingFactor + "× less RAM").padEnd(19)} │`
    );
  }
  console.log("└──────────────┴──────────────────┴──────────────────┴──────────────────┴─────────────────────┘\n");

  console.log("┌─────────────────────────────────────────────────────────────────────────────────────────────┐");
  console.log("│ EXPERIMENT 3: SOLUTION QUALITY & OPTIMALITY GAP                                             │");
  console.log("├───────────┬──────────────┬──────────────────────┬──────────────────────┬────────────────────┤");
  console.log("│ Tests (n) │ B&B reference │ Greedy (% ref) │ Priority Score       │ Reference gap     │");
  console.log("├───────────┼──────────────┼──────────────────────┼──────────────────────┼────────────────────┤");
  for (const r of exp3) {
    console.log(
      `│ ${String(r.n).padEnd(9)} │ ${String(r.optimumScore).padEnd(12)} │ ${String(r.greedyScore + " (" + r.greedyRatio + "%)").padEnd(20)} │ ${String(r.priorityScore + " (" + r.priorityRatio + "%)").padEnd(20)} │ ${String(r.greedyGap + "%").padEnd(18)} │`
    );
  }
  console.log("└───────────┴──────────────┴──────────────────────┴──────────────────────┴────────────────────┘\n");

  console.log("┌─────────────────────────────────────────────────────────────────────────────────────────────┐");
  console.log("│ EXPERIMENT 4: SCHEDULING EFFICIENCY VS. LOWER BOUND (LB)                                    │");
  console.log("├─────────┬────────────┬────────────────────┬────────────────────┬────────────────────────────┤");
  console.log("│ Workers │ LB (min)   │ FCFS Makespan (LB) │ Greedy Makespan    │ LPT Makespan (Util %)      │");
  console.log("├─────────┼────────────┼────────────────────┼────────────────────┼────────────────────────────┤");
  for (const r of exp4) {
    console.log(
      `│ ${String(r.workers).padEnd(7)} │ ${String(r.lowerBound + "m").padEnd(10)} │ ${String(r.strategies.FCFS.makespan + "m (" + r.strategies.FCFS.ratioToLB + "×)").padEnd(18)} │ ${String(r.strategies.GREEDY.makespan + "m (" + r.strategies.GREEDY.ratioToLB + "×)").padEnd(18)} │ ${String(r.strategies.LPT.makespan + "m (" + r.strategies.LPT.utilization + "%)").padEnd(26)} │`
    );
  }
  console.log("└─────────┴────────────┴────────────────────┴────────────────────┴────────────────────────────┘\n");

  console.log("┌─────────────────────────────────────────────────────────────────────────────────────────────┐");
  console.log("│ EXPERIMENT 5: FAILURE FEEDBACK EFFICACY (w3 = 0.15 vs. w3 = 0.00)                           │");
  console.log("├──────────────┬──────────────────┬──────────────────┬──────────────────┬─────────────────────┤");
  console.log("│ Budget B     │ Total Defects    │ With w3 = 0.15   │ Without w3 = 0   │ Relative Gain       │");
  console.log("├──────────────┼──────────────────┼──────────────────┼──────────────────┼─────────────────────┤");
  for (const r of exp5) {
    console.log(
      `│ ${String(r.budget + " min").padEnd(12)} │ ${String(r.totalLatentDefects).padEnd(16)} │ ${String(r.withHistory.defectsCaught + " (" + r.withHistory.detectionRatePct + "%)").padEnd(16)} │ ${String(r.withoutHistory.defectsCaught + " (" + r.withoutHistory.detectionRatePct + "%)").padEnd(16)} │ ${String("+" + r.relativeGainPct + "% more bugs").padEnd(19)} │`
    );
  }
  console.log("└──────────────┴──────────────────┴──────────────────┴──────────────────┴─────────────────────┘\n");

  // Write Markdown Report to docs/BENCHMARK_REPORT.md
  if (!fs.existsSync(DOCS_DIR)) {
    fs.mkdirSync(DOCS_DIR, { recursive: true });
  }
  const reportPath = path.join(DOCS_DIR, "BENCHMARK_REPORT.md");
  const markdown = generateMarkdownReport(results);
  fs.writeFileSync(reportPath, markdown, "utf-8");

  console.log(`📄 Comprehensive Markdown Report saved to: ${reportPath}`);
  console.log("✅ Academic Evaluation & Benchmark Suite complete!\n");

  return results;
}

// Auto-run when executed directly via CLI
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const isFull = process.argv.includes("--full");
  const isJson = process.argv.includes("--json");
  runBenchmarks({ isFull, isJson }).catch((err) => {
    console.error("Benchmark execution failed:", err);
    process.exit(1);
  });
}
