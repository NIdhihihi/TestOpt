import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import app from "../app.js";
import pool from "../db/connection.js";

let server;
let apiBaseUrl;
const createdRunIds = [];
let originalWorkerStatuses = [];
let originalHistory = [];
const originalSimulation = {
  failure: process.env.SIMULATED_FAILURE_PERCENT,
  error: process.env.SIMULATED_ERROR_PERCENT,
  workerFailure: process.env.SIMULATED_WORKER_FAILURE_PERCENT,
};

async function post(path, body) {
  const response = await fetch(`${apiBaseUrl}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  return { status: response.status, body: await response.json() };
}

async function createRun({ changedModuleIds = ["M_AUTH"], timeBudget = 15, workerCount = 2, algorithm = "GREEDY" } = {}) {
  const result = await post("/optimization/optimize", {
    projectId: "P_TESTOPT",
    changedModuleIds,
    timeBudget,
    workerCount,
    algorithm,
  });

  assert.equal(result.status, 201, result.body.message);
  createdRunIds.push(result.body.runId);
  return result.body;
}

async function removeRun(runId) {
  const [runs] = await pool.query(
    "SELECT change_id FROM optimization_runs WHERE run_id = ?",
    [runId],
  );

  await pool.query("DELETE FROM test_executions WHERE run_id = ?", [runId]);
  await pool.query("DELETE FROM selected_tests WHERE run_id = ?", [runId]);
  await pool.query("DELETE FROM optimization_runs WHERE run_id = ?", [runId]);

  if (runs[0]?.change_id) {
    await pool.query("DELETE FROM code_change_modules WHERE change_id = ?", [runs[0].change_id]);
    await pool.query("DELETE FROM code_changes WHERE change_id = ?", [runs[0].change_id]);
  }
}

async function saveHistory(testIds) {
  const [history] = await pool.query(
    "SELECT test_id, total_executions, failure_count, last_execution FROM test_history WHERE test_id IN (?)",
    [testIds],
  );
  originalHistory = history;
}

before(async () => {
  const [workers] = await pool.query("SELECT worker_id, worker_status FROM workers");
  originalWorkerStatuses = workers;
  server = await new Promise((resolve) => {
    const instance = app.listen(0, "127.0.0.1", () => resolve(instance));
  });
  apiBaseUrl = `http://127.0.0.1:${server.address().port}/api`;
});

after(async () => {
  for (const runId of createdRunIds) await removeRun(runId);
  for (const worker of originalWorkerStatuses) {
    await pool.query("UPDATE workers SET worker_status = ? WHERE worker_id = ?", [worker.worker_status, worker.worker_id]);
  }
  for (const entry of originalHistory) {
    await pool.query(
      "UPDATE test_history SET total_executions = ?, failure_count = ?, last_execution = ? WHERE test_id = ?",
      [entry.total_executions, entry.failure_count, entry.last_execution, entry.test_id],
    );
  }
  process.env.SIMULATED_FAILURE_PERCENT = originalSimulation.failure;
  process.env.SIMULATED_ERROR_PERCENT = originalSimulation.error;
  process.env.SIMULATED_WORKER_FAILURE_PERCENT = originalSimulation.workerFailure;
  await pool.end();
  if (server) await new Promise((resolve) => server.close(resolve));
});

test("optimizes tests within the budget and compares scheduling strategies", { concurrency: false }, async () => {
  const run = await createRun();

  assert.deepEqual(run.affectedModuleIds.sort(), ["M_AUTH", "M_ORDER", "M_PAYMENT"]);
  assert.ok(run.totalExecutionTime <= 15);
  assert.deepEqual(run.selectedTests.map((testCase) => testCase.testId), ["T_PAYFAIL", "T_CHECKOUT"]);

  for (const strategy of ["FCFS", "PRIORITY", "GREEDY", "LPT"]) {
    const plan = await post(`/execution/${run.runId}/plan`, { strategy });
    assert.equal(plan.status, 200);
    assert.equal(plan.body.plan.metrics.workerCount, 2);
    assert.equal(plan.body.plan.metrics.totalTests, 2);
  }
});

test("rejects invalid optimization requests", { concurrency: false }, async () => {
  const requests = [
    { changedModuleIds: [], timeBudget: 15, workerCount: 1 },
    { changedModuleIds: ["M_AUTH"], timeBudget: 0, workerCount: 1 },
    { changedModuleIds: ["M_UNKNOWN"], timeBudget: 15, workerCount: 1 },
    { changedModuleIds: ["M_AUTH"], timeBudget: 15, workerCount: 3 },
  ];

  for (const request of requests) {
    const result = await post("/optimization/optimize", {
      projectId: "P_TESTOPT",
      algorithm: "GREEDY",
      ...request,
    });
    assert.equal(result.status, 400);
  }
});

test("reports unavailable workers and does not count worker errors as failures", { concurrency: false }, async () => {
  const run = await createRun({ workerCount: 1 });
  await pool.query("UPDATE workers SET worker_status = 'BUSY'");
  const unavailable = await post(`/execution/${run.runId}/plan`, { strategy: "GREEDY" });
  assert.equal(unavailable.status, 409);

  await pool.query("UPDATE workers SET worker_status = 'AVAILABLE'");
  await saveHistory(run.selectedTests.map((testCase) => testCase.testId));
  process.env.SIMULATED_WORKER_FAILURE_PERCENT = "100";
  const plan = await post(`/execution/${run.runId}/plan`, { strategy: "GREEDY" });
  const execution = await post(`/execution/${run.runId}`, {
    strategy: "GREEDY",
    approved: true,
    approvalToken: plan.body.approvalToken,
  });

  assert.equal(execution.status, 200);
  assert.ok(execution.body.results.every((result) => result.executionStatus === "ERROR"));
  const [historyAfter] = await pool.query(
    "SELECT test_id, failure_count FROM test_history WHERE test_id IN (?)",
    [run.selectedTests.map((testCase) => testCase.testId)],
  );
  const originalFailures = new Map(originalHistory.map((entry) => [entry.test_id, entry.failure_count]));
  assert.ok(historyAfter.every((entry) => entry.failure_count === originalFailures.get(entry.test_id)));
});
