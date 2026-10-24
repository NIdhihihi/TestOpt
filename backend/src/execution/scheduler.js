
const PRIORITY_RANK = { HIGH: 1, MEDIUM: 2, LOW: 3 };
const VALID_STRATEGIES = new Set(["FCFS", "PRIORITY", "GREEDY", "LPT"]);

function round2(value) {
  return Number(value.toFixed(2));
}

function compareWorkers(a, b) {
  return a.load - b.load || a.index - b.index;
}

// Min-heap: get the least-loaded worker in O(log m).
class WorkerMinHeap {
  constructor(items) {
    this.items = [...items];
    for (let i = Math.floor(this.items.length / 2) - 1; i >= 0; i--) {
      this.#down(i);
    }
  }

  pop() {
    if (this.items.length === 0) return undefined;

    const first = this.items[0];
    const last = this.items.pop();

    if (this.items.length > 0) {
      this.items[0] = last;
      this.#down(0);
    }

    return first;
  }

  push(item) {
    this.items.push(item);
    let index = this.items.length - 1;

    while (index > 0) {
      const parent = Math.floor((index - 1) / 2);
      if (compareWorkers(this.items[parent], this.items[index]) <= 0) break;

      [this.items[parent], this.items[index]] =
        [this.items[index], this.items[parent]];

      index = parent;
    }
  }

  #down(index) {
    const length = this.items.length;

    while (true) {
      let smallest = index;
      const left = 2 * index + 1;
      const right = left + 1;

      if (
        left < length &&
        compareWorkers(this.items[left], this.items[smallest]) < 0
      ) {
        smallest = left;
      }

      if (
        right < length &&
        compareWorkers(this.items[right], this.items[smallest]) < 0
      ) {
        smallest = right;
      }

      if (smallest === index) break;

      [this.items[index], this.items[smallest]] =
        [this.items[smallest], this.items[index]];

      index = smallest;
    }
  }
}

export function createSchedule({ selectedTests, strategy, workers }) {
  if (!Array.isArray(selectedTests)) {
    throw new Error("selectedTests must be an array");
  }

  if (selectedTests.length === 0) {
    throw new Error("At least one selected test is required");
  }

  if (!Array.isArray(workers)) {
    throw new Error("workers must be an array");
  }

  const normalizedStrategy = String(strategy ?? "").toUpperCase();

  if (!VALID_STRATEGIES.has(normalizedStrategy)) {
    throw new Error(
      `Unknown strategy: ${strategy}. Use ${[...VALID_STRATEGIES].join(", ")}`
    );
  }

  const availableWorkers = workers.filter(
    (worker) => worker.workerStatus === "AVAILABLE"
  );

  if (availableWorkers.length === 0) {
    throw new Error("No available workers");
  }

  const workerIds = availableWorkers.map((worker) => worker.workerId);

  if (workerIds.some((id) => id == null || String(id).trim() === "")) {
    throw new Error("Every available worker must have a workerId");
  }

  if (new Set(workerIds.map(String)).size !== workerIds.length) {
    throw new Error("Available worker IDs must be unique");
  }

  const tests = selectedTests.map((test, originalIndex) => {
    if (!test || test.testId == null || String(test.testId).trim() === "") {
      throw new Error("Every test must have a testId");
    }

    const executionTime = Number(test.executionTime);

    if (!Number.isFinite(executionTime) || executionTime <= 0) {
      throw new Error(`Invalid executionTime for test ${test.testId}`);
    }

    if (
      normalizedStrategy === "PRIORITY" &&
      !Object.hasOwn(PRIORITY_RANK, test.priority)
    ) {
      throw new Error(`Invalid priority for test ${test.testId}`);
    }

    return {
      ...test,
      executionTime,
      originalIndex,
    };
  });

  if (new Set(tests.map((test) => String(test.testId))).size !== tests.length) {
    throw new Error("Selected test IDs must be unique");
  }

  // Preserve selection order except where the strategy specifies sorting.
  if (normalizedStrategy === "PRIORITY") {
    tests.sort(
      (a, b) =>
        PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority] ||
        b.executionTime - a.executionTime ||
        a.originalIndex - b.originalIndex
    );
  } else if (normalizedStrategy === "LPT") {
    tests.sort(
      (a, b) =>
        b.executionTime - a.executionTime ||
        a.originalIndex - b.originalIndex
    );
  }

  const workerLoads = availableWorkers.map((worker, index) => ({
    workerId: worker.workerId,
    index,
    load: 0,
    tests: [],
  }));

  const heap = new WorkerMinHeap(workerLoads);
  const schedule = [];

  for (let i = 0; i < tests.length; i++) {
    const test = tests[i];
    let worker;

    if (normalizedStrategy === "FCFS") {
      // FCFS: cyclic assignment, deliberately ignoring current load.
      worker = workerLoads[i % workerLoads.length];
    } else {
      // Priority, Greedy and LPT: assign to the least-loaded worker.
      worker = heap.pop();
    }

    const startOffset = worker.load;
    const endOffset = startOffset + test.executionTime;

    const scheduledTest = {
      testId: test.testId,
      workerId: worker.workerId,
      executionTime: test.executionTime,
      startOffset: round2(startOffset),
      endOffset: round2(endOffset),
      priority: test.priority,
      score: test.score,
      reason: test.reason,
      coveredModuleIds: test.coveredModuleIds,
    };

    worker.tests.push(scheduledTest);
    worker.load = endOffset;
    schedule.push(scheduledTest);

    if (normalizedStrategy !== "FCFS") {
      heap.push(worker);
    }
  }

  const workerSummaries = workerLoads.map((worker) => ({
    workerId: worker.workerId,
    estimatedLoad: round2(worker.load),
    tests: worker.tests,
  }));

  // SRS REQ-4.8.3, ADD §7.3: Complete Scheduling Metrics
  const loads = workerSummaries.map((worker) => worker.estimatedLoad);
  const makespan = Math.max(...loads);
  const totalExecutionTime = tests.reduce(
    (total, test) => total + test.executionTime,
    0
  );
  const workerCount = workerSummaries.length;
  const minimumLoad = Math.min(...loads);
  const totalCapacity = workerCount * makespan;
  const maxExecutionTime = tests.reduce(
    (max, test) => Math.max(max, test.executionTime),
    0
  );
  // Theoretical Lower Bound: LB = max(sum(pj) / m, max(pj)) for fractional durations
  const lowerBound = Math.max(
    totalExecutionTime / workerCount,
    maxExecutionTime
  );

  return {
    strategy: normalizedStrategy,
    schedule,
    workers: workerSummaries,
    metrics: {
      totalTests: tests.length,
      workerCount,
      totalExecutionTime: round2(totalExecutionTime),
      makespan: round2(makespan),
      workerUtilization:
        totalCapacity > 0
          ? round2((totalExecutionTime / totalCapacity) * 100)
          : 0,
      imbalance: round2(Math.max(...loads) - minimumLoad),
      lowerBound,
    },
  };
}
