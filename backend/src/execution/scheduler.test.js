
import test from "node:test";
import assert from "node:assert/strict";
import { createSchedule } from "./scheduler.js";

const workers = [
  { workerId: "W1", workerStatus: "AVAILABLE" },
  { workerId: "W2", workerStatus: "AVAILABLE" },
];

const selectedTests = [
  { testId: "T1", executionTime: 8, priority: "MEDIUM" },
  { testId: "T2", executionTime: 3, priority: "HIGH" },
  { testId: "T3", executionTime: 5, priority: "HIGH" },
  { testId: "T4", executionTime: 2, priority: "LOW" },
];

test("FCFS preserves input order and assigns workers cyclically", () => {
  const result = createSchedule({
    selectedTests,
    workers,
    strategy: "FCFS",
  });

  assert.deepEqual(
    result.schedule.map((item) => item.testId),
    ["T1", "T2", "T3", "T4"]
  );

  assert.deepEqual(
    result.schedule.map((item) => item.workerId),
    ["W1", "W2", "W1", "W2"]
  );

  assert.equal(result.workers[0].estimatedLoad, 13);
  assert.equal(result.workers[1].estimatedLoad, 5);
  assert.equal(result.metrics.makespan, 13);
});

test("Priority sorts high priority first, breaking ties by longer duration", () => {
  const result = createSchedule({
    selectedTests,
    workers,
    strategy: "PRIORITY",
  });

  assert.deepEqual(
    result.schedule.map((item) => item.testId),
    ["T3", "T2", "T1", "T4"]
  );
});

test("Greedy assigns each next test to the least-loaded worker", () => {
  const result = createSchedule({
    selectedTests,
    workers,
    strategy: "GREEDY",
  });

assert.deepEqual(
  result.schedule.map((item) => item.workerId),
  ["W1", "W2", "W2", "W1"]
);

assert.equal(result.workers[0].estimatedLoad, 10);
assert.equal(result.workers[1].estimatedLoad, 8);
assert.equal(result.metrics.makespan, 10);
assert.equal(result.metrics.totalExecutionTime, 18);
assert.equal(result.metrics.workerUtilization, 90);
});

test("LPT sorts by descending duration and balances worker loads", () => {
  const result = createSchedule({
    selectedTests,
    workers,
    strategy: "LPT",
  });

  assert.deepEqual(
    result.schedule.map((item) => item.testId),
    ["T1", "T3", "T2", "T4"]
  );

  assert.equal(result.metrics.makespan, 10);
  assert.equal(result.metrics.totalExecutionTime, 18);
});

test("each test is assigned exactly once", () => {
  for (const strategy of ["FCFS", "PRIORITY", "GREEDY", "LPT"]) {
    const result = createSchedule({ selectedTests, workers, strategy });
    const assignedIds = result.schedule.map((item) => item.testId);

    assert.equal(assignedIds.length, selectedTests.length);
    assert.equal(new Set(assignedIds).size, selectedTests.length);
    assert.deepEqual(
      [...assignedIds].sort(),
      selectedTests.map((item) => item.testId).sort()
    );
  }
});

test("returns start and end offsets for each scheduled test", () => {
  const result = createSchedule({
    selectedTests,
    workers,
    strategy: "GREEDY",
  });

  for (const worker of result.workers) {
    for (const item of worker.tests) {
      assert.equal(
        item.endOffset - item.startOffset,
        item.executionTime
      );
    }
  }
});

test("ignores unavailable workers", () => {
  const result = createSchedule({
    selectedTests: [{ testId: "T1", executionTime: 4, priority: "HIGH" }],
    workers: [
      ...workers,
      { workerId: "W3", workerStatus: "OFFLINE" },
    ],
    strategy: "GREEDY",
  });

  assert.equal(result.workers.length, 2);
  assert.ok(result.workers.every((worker) => worker.workerId !== "W3"));
});

test("rejects empty tests, invalid duration, duplicate IDs and unknown strategy", () => {
  assert.throws(
    () => createSchedule({ selectedTests: [], workers, strategy: "FCFS" }),
    /At least one selected test/
  );

  assert.throws(
    () =>
      createSchedule({
        selectedTests: [{ testId: "T1", executionTime: 0 }],
        workers,
        strategy: "FCFS",
      }),
    /Invalid executionTime/
  );

  assert.throws(
    () =>
      createSchedule({
        selectedTests: [
          { testId: "T1", executionTime: 1 },
          { testId: "T1", executionTime: 2 },
        ],
        workers,
        strategy: "FCFS",
      }),
    /unique/
  );

  assert.throws(
    () => createSchedule({ selectedTests, workers, strategy: "MAGIC" }),
    /Unknown strategy/
  );
});

test("rejects invalid priority and no available workers", () => {
  assert.throws(
    () =>
      createSchedule({
        selectedTests: [{ testId: "T1", executionTime: 4, priority: "URGENT" }],
        workers,
        strategy: "PRIORITY",
      }),
    /Invalid priority/
  );

  assert.throws(
    () =>
      createSchedule({
        selectedTests,
        workers: [{ workerId: "W1", workerStatus: "BUSY" }],
        strategy: "FCFS",
      }),
    /No available workers/
  );
});

test("computes complete scheduling metrics (Cmax, LB, utilization, imbalance) for all schedulers", () => {
  // Tests: T1=8, T2=3, T3=5, T4=2 -> total = 18, max_pj = 8.
  // 2 workers -> ceil(18/2) = 9. LB = max(9, 8) = 9.
  for (const strategy of ["FCFS", "PRIORITY", "GREEDY", "LPT"]) {
    const res = createSchedule({ selectedTests, workers, strategy });
    const { metrics, workers: wSummaries } = res;

    assert.equal(metrics.totalExecutionTime, 18);
    assert.equal(metrics.totalTests, 4);
    assert.equal(metrics.workerCount, 2);
    assert.equal(metrics.lowerBound, 9); // max(ceil(18/2), 8) = 9

    const maxLoad = Math.max(...wSummaries.map((w) => w.estimatedLoad));
    const minLoad = Math.min(...wSummaries.map((w) => w.estimatedLoad));
    assert.equal(metrics.makespan, maxLoad);
    assert.equal(metrics.imbalance, Number((maxLoad - minLoad).toFixed(2)));

    const expectedUtil = Number(((18 / (2 * maxLoad)) * 100).toFixed(2));
    assert.equal(metrics.workerUtilization, expectedUtil);
    assert.ok(metrics.makespan >= metrics.lowerBound, "Makespan must be >= theoretical Lower Bound");
  }
});



test("fractional durations never produce a lower bound above makespan", () => {
  const result = createSchedule({
    selectedTests: [0.1, 0.2, 0.3].map((executionTime, i) => ({ testId: `F${i}`, executionTime, priority: "HIGH", score: 1 })),
    workers, strategy: "LPT",
  });
  assert.ok(Math.abs(result.metrics.lowerBound - 0.3) < 1e-9);
  assert.ok(result.metrics.lowerBound <= result.metrics.makespan + 1e-9);
});

test('short fractional jobs retain precise loads and physically possible metrics', () => {
  const result = createSchedule({ selectedTests: [{ testId: 'A', executionTime: 0.014, priority: 'MEDIUM' }], workers: [workers[0]], strategy: 'LPT' });
  assert.equal(result.metrics.makespan, 0.014);
  assert.equal(result.metrics.totalExecutionTime, 0.014);
  assert.equal(result.metrics.lowerBound, 0.014);
  assert.equal(result.metrics.workerUtilization, 100);
  assert.equal(result.schedule[0].endOffset, 0.014);
});
