import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import app from "../app.js";
import pool from "../db/connection.js";
import { executionQueue } from "../queue/executionQueue.js";

let server;
let apiBaseUrl;
let accessToken;
let authenticatedProjectId;
const createdRunIds = [];
const createdUserIds = [];
const createdOrganizationIds = [];
const createdProjectIds = [];
const createdJobIds = [];
let originalWorkerStatuses = [];
let originalHistory = [];
const originalSimulation = {
  failure: process.env.SIMULATED_FAILURE_PERCENT,
  error: process.env.SIMULATED_ERROR_PERCENT,
  workerFailure: process.env.SIMULATED_WORKER_FAILURE_PERCENT,
};

async function post(path, body, token = accessToken) {
  const response = await fetch(`${apiBaseUrl}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  });

  return { status: response.status, body: await response.json() };
}

async function get(path, token = accessToken) {
  const response = await fetch(`${apiBaseUrl}${path}`, {
    headers: token ? { authorization: `Bearer ${token}` } : {},
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
  process.env.JWT_SECRET = "integration-test-secret-at-least-thirty-two-characters";
  const [workers] = await pool.query("SELECT worker_id, worker_status FROM workers");
  originalWorkerStatuses = workers;
  server = await new Promise((resolve) => {
    const instance = app.listen(0, "127.0.0.1", () => resolve(instance));
  });
  apiBaseUrl = `http://127.0.0.1:${server.address().port}/api`;
});

after(async () => {
  for (const jobId of createdJobIds) await pool.query("DELETE FROM execution_jobs WHERE job_id = ?", [jobId]);
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
  for (const userId of createdUserIds) await pool.query("DELETE FROM audit_events WHERE user_id = ?", [userId]);
  for (const projectId of createdProjectIds) {
    await pool.query("DELETE tc FROM test_coverage tc JOIN test_cases t ON t.test_id = tc.test_id WHERE t.project_id = ?", [projectId]);
    await pool.query("DELETE md FROM module_dependencies md WHERE md.project_id = ?", [projectId]);
    await pool.query("DELETE th FROM test_history th JOIN test_cases t ON t.test_id = th.test_id WHERE t.project_id = ?", [projectId]);
    await pool.query("DELETE FROM test_cases WHERE project_id = ?", [projectId]);
    await pool.query("DELETE FROM modules WHERE project_id = ?", [projectId]);
    await pool.query("DELETE FROM projects WHERE project_id = ?", [projectId]);
  }
  for (const organizationId of createdOrganizationIds) {
    await pool.query("DELETE FROM organization_members WHERE organization_id = ?", [organizationId]);
    await pool.query("DELETE FROM organizations WHERE organization_id = ?", [organizationId]);
  }
  for (const userId of createdUserIds) await pool.query("DELETE FROM users WHERE user_id = ?", [userId]);
  process.env.SIMULATED_FAILURE_PERCENT = originalSimulation.failure;
  process.env.SIMULATED_ERROR_PERCENT = originalSimulation.error;
  process.env.SIMULATED_WORKER_FAILURE_PERCENT = originalSimulation.workerFailure;
  await executionQueue.close();
  await pool.end();
  if (server) await new Promise((resolve) => server.close(resolve));
});

test("registers, signs in, and returns the authenticated organization", { concurrency: false }, async () => {
  const email = `integration-${Date.now()}@testopt.local`;
  const registration = await post("/auth/register", {
    name: "Integration User",
    email,
    password: "A-long-integration-password-123",
    organizationName: "Integration Organization",
  });
  assert.equal(registration.status, 201, registration.body.message);
  assert.ok(registration.body.accessToken);
  accessToken = registration.body.accessToken;
  createdUserIds.push(registration.body.user.userId);
  createdOrganizationIds.push(registration.body.organization.organizationId);
  await pool.query("INSERT INTO organization_members (organization_id, user_id, role) VALUES ('ORG_DEFAULT', ?, 'OWNER')", [registration.body.user.userId]);

  const project = await post("/catalog/projects", {
    projectName: "Authenticated integration project",
    organizationId: registration.body.organization.organizationId,
  }, registration.body.accessToken);
  assert.equal(project.status, 201, project.body.message);
  createdProjectIds.push(project.body.project.projectId);
  authenticatedProjectId = project.body.project.projectId;

  const login = await post("/auth/login", { email, password: "A-long-integration-password-123" });
  assert.equal(login.status, 200, login.body.message);
  assert.equal(login.body.organizations[0].role, "OWNER");
});

test("imports a complete project catalog from CSV", { concurrency: false }, async () => {
  const suffix = Date.now();
  const csvText = [
    "type,id,name,criticality,executionTime,priority,sourceModuleId,targetModuleId,testId,moduleId,coverageWeight",
    `MODULE,M_IMPORT_AUTH_${suffix},Authentication,9,,,,,,,`,
    `MODULE,M_IMPORT_ORDER_${suffix},Orders,7,,,,,,,`,
    `TEST,T_IMPORT_LOGIN_${suffix},Login test,,1.5,HIGH,,,,`,
    `DEPENDENCY,,,,,,M_IMPORT_ORDER_${suffix},M_IMPORT_AUTH_${suffix},,,`,
    `COVERAGE,,,,,,,,T_IMPORT_LOGIN_${suffix},M_IMPORT_AUTH_${suffix},0.9`,
  ].join("\n");
  const result = await post(`/catalog/projects/${authenticatedProjectId}/import`, { csvText });
  assert.equal(result.status, 201, result.body.message);
  assert.deepEqual(result.body.imported, { modules: 2, tests: 1, dependencies: 1, coverage: 1 });
  const catalog = await get(`/catalog/projects/${authenticatedProjectId}`);
  assert.equal(catalog.status, 200);
  assert.equal(catalog.body.modules.length, 2);
  assert.equal(catalog.body.tests.length, 1);
  assert.equal(catalog.body.dependencies.length, 1);
  assert.equal(catalog.body.coverage.length, 1);
});

test("optimizes tests within the budget and compares scheduling strategies", { concurrency: false }, async () => {
  const run = await createRun();

  assert.deepEqual(run.affectedModuleIds.sort(), ["M_AUTH", "M_ORDER", "M_PAYMENT"]);
  assert.ok(run.totalExecutionTime <= 15);
  assert.deepEqual(run.selectedTests.map((testCase) => testCase.testId), ["T_LOGIN", "T_PAYFAIL", "T_HISTORY"]);

  for (const strategy of ["FCFS", "PRIORITY", "GREEDY", "LPT"]) {
    const plan = await post(`/execution/${run.runId}/plan`, { strategy });
    assert.equal(plan.status, 200);
    assert.equal(plan.body.plan.metrics.workerCount, 2);
    assert.equal(plan.body.plan.metrics.totalTests, 3);
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

test("queues an execution job for the background worker", { concurrency: false }, async () => {
  const run = await createRun({ workerCount: 1 });
  const queued = await post(`/execution/${run.runId}/queue`, { strategy: "GREEDY" });
  assert.equal(queued.status, 202, queued.body.message);
  createdJobIds.push(queued.body.jobId);

  let status;
  let jobError;
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const [jobs] = await pool.query("SELECT queue_status, error_message FROM execution_jobs WHERE job_id = ?", [queued.body.jobId]);
    status = jobs[0]?.queue_status;
    jobError = jobs[0]?.error_message;
    if (["SUCCEEDED", "FAILED"].includes(status)) break;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert.equal(status, "SUCCEEDED", jobError);
});

test("returns project execution analytics", { concurrency: false }, async () => {
  const analytics = await get("/execution/projects/P_TESTOPT/analytics");
  assert.equal(analytics.status, 200, analytics.body.message);
  assert.ok(analytics.body.summary.executionCount > 0);
  assert.equal(typeof analytics.body.summary.passRate, "number");
  assert.equal(typeof analytics.body.summary.minutesSaved, "number");
  assert.ok(Array.isArray(analytics.body.trend));
});
