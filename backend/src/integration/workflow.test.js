import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import app from "../app.js";
import { example } from "./fixtures/demoProject.js";
import pool from "../db/connection.js";
import { executionQueue } from "../queue/executionQueue.js";
import { setVerificationEmailSink } from "../services/emailService.js";
import { handleOAuthUser } from "../routes/auth.js";

let server;
let apiBaseUrl;
let accessToken;
let authenticatedProjectId;
let importedAuthModuleId;
const capturedOtps = new Map();
const createdRunIds = [];
const createdUserIds = [];
const createdOrganizationIds = [];
const createdProjectIds = [];
const createdJobIds = [];
const createdWorkerIds = [];
let originalWorkerStatuses = [];
let originalHistory = [];
const originalSimulation = {
  failure: process.env.SIMULATED_FAILURE_PERCENT,
  error: process.env.SIMULATED_ERROR_PERCENT,
  workerFailure: process.env.SIMULATED_WORKER_FAILURE_PERCENT,
};

function extractRefreshCookie(headers) {
  const cookies = headers.getSetCookie?.() || [];
  for (const cookie of cookies) {
    const match = cookie.match(/testopt_refresh=([^;]+)/);
    if (match && match[1]) return `testopt_refresh=${match[1]}`;
  }
  return null;
}

async function post(path, body, token = accessToken, extraHeaders = {}) {
  const response = await fetch(`${apiBaseUrl}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...extraHeaders,
    },
    body: JSON.stringify(body),
  });

  return { status: response.status, headers: response.headers, body: await response.json() };
}

async function registerViaOtp({ name, email, password, organizationName }) {
  const sendRes = await post("/auth/send-otp", { email, name }, null);
  assert.equal(sendRes.status, 200, sendRes.body.message);
  assert.equal("otp" in sendRes.body, false, "OTP must never be leaked in HTTP JSON");

  const otp = capturedOtps.get(email.toLowerCase());
  assert.match(String(otp), /^\d{6}$/, "Expected 6-digit OTP in mail sink");

  const verifyRes = await post("/auth/verify-otp-and-register", {
    name,
    email,
    password,
    organizationName,
    otp,
  }, null);
  assert.equal(verifyRes.status, 201, verifyRes.body.message);
  return verifyRes;
}

async function put(path, body, token = accessToken) {
  const response = await fetch(`${apiBaseUrl}${path}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  });

  return { status: response.status, body: await response.json() };
}

async function del(path, token = accessToken) {
  const response = await fetch(`${apiBaseUrl}${path}`, {
    method: "DELETE",
    headers: token ? { authorization: `Bearer ${token}` } : {},
  });

  return { status: response.status, body: await response.json() };
}

async function get(path, token = accessToken) {
  const response = await fetch(`${apiBaseUrl}${path}`, {
    headers: token ? { authorization: `Bearer ${token}` } : {},
  });

  return { status: response.status, body: await response.json() };
}

async function getRaw(path, token = accessToken) {
  const response = await fetch(`${apiBaseUrl}${path}`, {
    headers: token ? { authorization: `Bearer ${token}` } : {},
  });

  return {
    status: response.status,
    headers: response.headers,
    text: await response.text(),
  };
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

  await pool.query("DELETE FROM execution_jobs WHERE run_id = ?", [runId]);
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
  setVerificationEmailSink(({ email, otp }) => {
    capturedOtps.set(email.toLowerCase(), otp);
  });
  const [workers] = await pool.query("SELECT worker_id, worker_status FROM workers");
  originalWorkerStatuses = workers;
  server = await new Promise((resolve) => {
    const instance = app.listen(0, "127.0.0.1", () => resolve(instance));
  });
  apiBaseUrl = `http://127.0.0.1:${server.address().port}/api`;
});

after(async () => {
  setVerificationEmailSink(null);
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
    await pool.query("DELETE FROM source_plans WHERE project_id = ?", [projectId]);
    await pool.query("DELETE FROM source_versions WHERE project_id = ?", [projectId]);
    await pool.query("DELETE FROM source_test_history WHERE project_id = ?", [projectId]);
    await pool.query("DELETE tc FROM test_coverage tc JOIN test_cases t ON t.test_id = tc.test_id WHERE t.project_id = ?", [projectId]);
    await pool.query("DELETE md FROM module_dependencies md WHERE md.project_id = ?", [projectId]);
    await pool.query("DELETE th FROM test_history th JOIN test_cases t ON t.test_id = th.test_id WHERE t.project_id = ?", [projectId]);
    await pool.query("DELETE FROM test_cases WHERE project_id = ?", [projectId]);
    await pool.query("DELETE FROM modules WHERE project_id = ?", [projectId]);
    await pool.query("DELETE FROM projects WHERE project_id = ?", [projectId]);
  }
  for (const workerId of createdWorkerIds) await pool.query("DELETE FROM workers WHERE worker_id = ?", [workerId]);
  for (const organizationId of createdOrganizationIds) {
    await pool.query("DELETE FROM organization_members WHERE organization_id = ?", [organizationId]);
    await pool.query("DELETE FROM organizations WHERE organization_id = ?", [organizationId]);
  }
  for (const userId of createdUserIds) await pool.query("DELETE FROM users WHERE user_id = ?", [userId]);
  process.env.SIMULATED_FAILURE_PERCENT = originalSimulation.failure;
  process.env.SIMULATED_ERROR_PERCENT = originalSimulation.error;
  process.env.SIMULATED_WORKER_FAILURE_PERCENT = originalSimulation.workerFailure;
  try { await executionQueue?.close(); } catch {}
  try { await pool.end(); } catch {}
  if (server) await new Promise((resolve) => server.close(resolve));
});

test("registers via verified OTP, blocks unverified /register, signs in, and isolates org access", { concurrency: false }, async () => {
  const email = `integration-${Date.now()}@testopt.local`;
  const retired = await post("/auth/register", {
    name: "Retired Caller",
    email,
    password: "A-long-integration-password-123",
    organizationName: "Retired Org",
  }, null);
  assert.equal(retired.status, 410);

  const registration = await registerViaOtp({
    name: "Integration User",
    email,
    password: "A-long-integration-password-123",
    organizationName: "Integration Organization",
  });
  assert.ok(registration.body.accessToken);
  assert.ok(extractRefreshCookie(registration.headers), "Registration must issue HttpOnly refresh cookie");
  accessToken = registration.body.accessToken;
  createdUserIds.push(registration.body.user.userId);
  createdOrganizationIds.push(registration.body.organization.organizationId);

  // New users must not automatically have access to unshared ORG_DEFAULT seeded project
  const isolatedCheck = await get("/catalog/projects/P_TESTOPT", accessToken);
  assert.equal(isolatedCheck.status, 403);

  await pool.query("INSERT INTO organization_members (organization_id, user_id, role) VALUES ('ORG_DEFAULT', ?, 'OWNER')", [registration.body.user.userId]);

  const project = await post("/catalog/projects", {
    projectName: "Authenticated integration project",
    organizationId: registration.body.organization.organizationId,
  }, registration.body.accessToken);
  assert.equal(project.status, 201, project.body.message);
  createdProjectIds.push(project.body.project.projectId);
  authenticatedProjectId = project.body.project.projectId;

  const login = await post("/auth/login", { email, password: "A-long-integration-password-123" }, null);
  assert.equal(login.status, 200, login.body.message);
  assert.ok(extractRefreshCookie(login.headers));
  assert.equal(login.body.organizations[0].role, "OWNER");
});

test("imports a complete project catalog from CSV", { concurrency: false }, async () => {
  const suffix = Date.now();
  importedAuthModuleId = `M_IMPORT_AUTH_${suffix}`;
  const csvText = [
    "type,id,name,criticality,executionTime,priority,sourceModuleId,targetModuleId,testId,moduleId,coverageWeight",
    `MODULE,${importedAuthModuleId},Authentication,9,,,,,,,`,
    `MODULE,M_IMPORT_ORDER_${suffix},Orders,7,,,,,,,`,
    `TEST,T_IMPORT_LOGIN_${suffix},Login test,,1.5,HIGH,,,,`,
    `DEPENDENCY,,,,,,M_IMPORT_ORDER_${suffix},${importedAuthModuleId},,,`,
    `COVERAGE,,,,,,,,T_IMPORT_LOGIN_${suffix},${importedAuthModuleId},0.9`,
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

  // Multi-strategy comparator API (SRS REQ-4.8.5, REQ-4.10.3)
  const comparison = await post(`/execution/${run.runId}/compare`);
  assert.equal(comparison.status, 200);
  assert.equal(comparison.body.comparisons.length, 4);
  assert.ok(comparison.body.bestMakespanStrategies.length > 0);
  assert.ok(comparison.body.bestUtilizationStrategies.length > 0);
  assert.ok(comparison.body.bestImbalanceStrategies.length > 0);
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

test("manual catalog refuses to attribute suite outcomes to individual tests", { concurrency: false }, async () => {
  const run = await createRun({ workerCount: 1 });
  const response = await post(`/execution/${run.runId}/queue`, { strategy: "GREEDY" });
  assert.equal(response.status, 422);
  assert.match(response.body.message, /independently attributed/);
});

test("returns project execution analytics", { concurrency: false }, async () => {
  const analytics = await get("/execution/projects/P_TESTOPT/analytics");
  assert.equal(analytics.status, 200, analytics.body.message);
  assert.ok(analytics.body.summary.executionCount > 0);
  assert.equal(typeof analytics.body.summary.passRate, "number");
  assert.equal(typeof analytics.body.summary.minutesSaved, "number");
  assert.ok(Array.isArray(analytics.body.trend));
  assert.ok(analytics.body.trend.every(point => /^\d{4}-\d{2}-\d{2}$/.test(point.day)));
});

test("enforces role governance: organization member roles and worker registration", { concurrency: false }, async () => {
  const membersRes = await get(`/auth/organizations/${createdOrganizationIds[0]}/members`);
  assert.equal(membersRes.status, 200);
  assert.ok(Array.isArray(membersRes.body.members));
  assert.ok(membersRes.body.members.length >= 1);

  const devEmail = `dev-${Date.now()}@testopt.local`;
  const devReg = await registerViaOtp({
    name: "Developer User",
    email: devEmail,
    password: "A-long-dev-password-123",
    organizationName: "Dev Org",
  });
  assert.equal(devReg.status, 201);
  createdUserIds.push(devReg.body.user.userId);
  createdOrganizationIds.push(devReg.body.organization.organizationId);
  const devToken = devReg.body.accessToken;

  await pool.query(
    "INSERT INTO organization_members (organization_id, user_id, role) VALUES (?, ?, 'DEVELOPER')",
    [createdOrganizationIds[0], devReg.body.user.userId]
  );

  const updateRole = await put(
    `/auth/organizations/${createdOrganizationIds[0]}/members/${devReg.body.user.userId}`,
    { role: "TEST_MANAGER" }
  );
  assert.equal(updateRole.status, 200);
  assert.equal(updateRole.body.member.role, "TEST_MANAGER");

  const ownerWorker = await post("/catalog/workers", { workerStatus: "AVAILABLE" });
  assert.equal(ownerWorker.status, 403, "Organization ownership must not grant shared-worker administration");
  await pool.query("UPDATE users SET role = 'ADMIN' WHERE user_id = ?", [createdUserIds[0]]);
  const regWorker = await post("/catalog/workers", { workerStatus: "AVAILABLE" });
  assert.equal(regWorker.status, 201);
  createdWorkerIds.push(regWorker.body.worker.workerId);

  await pool.query("UPDATE users SET role = 'DEVELOPER' WHERE user_id = ?", [devReg.body.user.userId]);
  await pool.query("UPDATE organization_members SET role = 'DEVELOPER' WHERE user_id = ?", [devReg.body.user.userId]);

  const failWorker = await post("/catalog/workers", { workerStatus: "AVAILABLE" }, devToken);
  assert.equal(failWorker.status, 403);
});

test("configures and applies testing constraints and formal code changes", { concurrency: false }, async () => {
  const defaults = await get(`/catalog/projects/${authenticatedProjectId}/constraints`);
  assert.equal(defaults.body.constraints.defaultBudget, 15);
  assert.equal(defaults.body.constraints.maxWorkers, 2);
  assert.equal(defaults.body.constraints.w3, 0.15);
  const invalidWeights = await put(`/catalog/projects/${authenticatedProjectId}/constraints`, { w1: 0.5, w2: 0.5, w3: 0.5, w4: 0.5 });
  assert.equal(invalidWeights.status, 400);
  const putConstraints = await put(`/catalog/projects/${authenticatedProjectId}/constraints`, {
    w1: 0.40,
    w2: 0.25,
    w3: 0.20,
    w4: 0.15,
    defaultBudget: 25.0,
    maxWorkers: 2,
  });
  assert.equal(putConstraints.status, 200);
  assert.equal(putConstraints.body.constraints.w1, 0.4);
  assert.equal(putConstraints.body.constraints.defaultBudget, 25.0);

  const getConstraints = await get(`/catalog/projects/${authenticatedProjectId}/constraints`);
  assert.equal(getConstraints.status, 200);
  assert.equal(getConstraints.body.constraints.w1, 0.4);
  assert.equal(getConstraints.body.constraints.defaultBudget, 25.0);
  assert.equal(getConstraints.body.constraints.maxWorkers, 2);
  const overLimit = await post("/optimization/optimize", { projectId: authenticatedProjectId, changedModuleIds: [importedAuthModuleId], workerCount: 3 });
  assert.equal(overLimit.status, 400);
  assert.match(overLimit.body.message, /at most 2 workers/);

  const optRes = await post("/optimization/optimize", {
    projectId: authenticatedProjectId,
    changedModuleIds: [importedAuthModuleId],
    description: "Phase 3 formal code change submission",
  });
  assert.equal(optRes.status, 201, optRes.body.message);
  createdRunIds.push(optRes.body.runId);
  assert.equal(optRes.body.timeBudget, 25.0);
  assert.equal(optRes.body.workerCount, 2);

  const [codeChangeRows] = await pool.query(
    "SELECT description, changed_module_ids FROM code_changes WHERE project_id = ? ORDER BY created_at DESC LIMIT 1",
    [authenticatedProjectId]
  );
  assert.equal(codeChangeRows[0].description, "Phase 3 formal code change submission");
  assert.ok(codeChangeRows[0].changed_module_ids.includes(importedAuthModuleId));
});

test("allows developer to explicitly reject a plan", { concurrency: false }, async () => {
  const run = await createRun();
  const plan = await post(`/execution/${run.runId}/plan`, { strategy: "GREEDY" });
  assert.equal(plan.status, 200);
  assert.ok(plan.body.approvalToken);

  const reject = await post(`/execution/${run.runId}/reject`, { reason: "Budget needs revision" });
  assert.equal(reject.status, 200);
  assert.equal(reject.body.status, "PLAN_REJECTED");

  const execution = await post(`/execution/${run.runId}`, {
    strategy: "GREEDY",
    approved: true,
    approvalToken: plan.body.approvalToken,
  });
  assert.equal(execution.status, 400);
  const revised = await post(`/execution/${run.runId}/plan`, { strategy: "GREEDY" });
  assert.equal(revised.status, 200, revised.body.message);
  const [rows] = await pool.query("SELECT status FROM optimization_runs WHERE run_id = ?", [run.runId]);
  assert.equal(rows[0].status, "PLAN_READY");
  const executed = await post(`/execution/${run.runId}`, { strategy: "GREEDY", approved: true, approvalToken: revised.body.approvalToken });
  assert.equal(executed.status, 200, executed.body.message);
  const [recorded] = await pool.query("SELECT status FROM selected_tests WHERE run_id = ?", [run.runId]);
  assert.ok(recorded.every(test => test.status === "RECORDED"));
  const terminalPreview = await post(`/execution/${run.runId}/plan`, { strategy: "GREEDY" });
  assert.equal(terminalPreview.status, 409);
});

test("exports optimization run report and distribution schedule as RFC 4180 CSV", { concurrency: false }, async () => {
  const run = await createRun();
  const exportRes = await getRaw(`/execution/${run.runId}/export`);
  assert.equal(exportRes.status, 200);
  assert.match(exportRes.headers.get("content-type"), /text\/csv/);
  assert.match(exportRes.headers.get("content-disposition"), /attachment; filename="optimization-report-.*\.csv"/);
  assert.ok(exportRes.text.includes("=== TESTOPT OPTIMIZATION RUN REPORT ==="));
  assert.ok(exportRes.text.includes("=== TEST DISTRIBUTION & EXECUTION SCHEDULE ==="));
  assert.ok(exportRes.text.includes(run.runId));
  assert.ok(exportRes.text.includes("Actual Duration (min)"));
});

test("archives a project while retaining recorded executions", { concurrency: false }, async () => {
  const newProject = await post("/catalog/projects", {
    projectName: "Project to delete",
    organizationId: createdOrganizationIds[0],
  });
  assert.equal(newProject.status, 201);
  const tempProjectId = newProject.body.project.projectId;

  const mod = await post(`/catalog/projects/${tempProjectId}/modules`, {
    moduleName: "Temp Module",
    criticality: 5,
  });
  assert.equal(mod.status, 201);

  const testId = `T_DELETE_${Date.now()}`;
  const runId = `RUN_DELETE_${Date.now()}`;
  await pool.query("INSERT INTO test_cases (test_id, project_id, test_name, execution_time, priority) VALUES (?, ?, 'Deletion test', 1, 'HIGH')", [testId, tempProjectId]);
  await pool.query("INSERT INTO optimization_runs (run_id, project_id, selection_algorithm, time_budget, worker_count, status) VALUES (?, ?, 'GREEDY', 15, 1, 'EXECUTING')", [runId, tempProjectId]);
  await pool.query("INSERT INTO selected_tests (run_id, test_id, selection_rank) VALUES (?, ?, 1)", [runId, testId]);
  const blocked = await del(`/catalog/projects/${tempProjectId}`);
  assert.equal(blocked.status, 409);
  await pool.query("UPDATE optimization_runs SET status = 'COMPLETED' WHERE run_id = ?", [runId]);
  await pool.query("INSERT INTO test_executions (execution_id, run_id, test_id, execution_status) VALUES (?, ?, ?, 'PASSED')", [`EX_DELETE_${Date.now()}`, runId, testId]);
  const delRes = await del(`/catalog/projects/${tempProjectId}`);
  assert.equal(delRes.status, 200);
  assert.equal(delRes.body.success, true);

  const getGone = await get(`/catalog/projects/${tempProjectId}`);
  assert.equal(getGone.status, 404);
  const [preserved] = await pool.query("SELECT execution_id FROM test_executions WHERE run_id = ?", [runId]);
  assert.equal(preserved.length, 1);
  assert.equal((await get(`/execution/projects/${tempProjectId}/runs`)).status, 200);
  assert.equal((await post('/optimization/optimize', { projectId: tempProjectId, changedModuleIds: [mod.body.module.moduleId], timeBudget: 15, workerCount: 1 })).status, 409);
  await pool.query("DELETE FROM test_executions WHERE run_id = ?", [runId]);
  await pool.query("DELETE FROM selected_tests WHERE run_id = ?", [runId]);
  await pool.query("DELETE FROM optimization_runs WHERE run_id = ?", [runId]);
  await pool.query("DELETE FROM test_history WHERE test_id = ?", [testId]);
  await pool.query("DELETE FROM test_cases WHERE test_id = ?", [testId]);
  await pool.query("DELETE FROM modules WHERE project_id = ?", [tempProjectId]);
  await pool.query("DELETE FROM projects WHERE project_id = ?", [tempProjectId]);
});


test("uploaded project discovery, bounded plans, permissions and offline execution", { concurrency: false }, async () => {
  const base = `/source/projects/${authenticatedProjectId}`;
  const denied = await get(`${base}/versions`, "");
  assert.equal(denied.status, 401);
  const unsafe = await post(`${base}/versions`, { files: [{ path: '../unsafe.js', content: '' }] });
  assert.equal(unsafe.status, 400);
  const uploaded = await post(`${base}/versions`, { files: example });
  assert.equal(uploaded.status, 201, uploaded.body.message);
  assert.equal(uploaded.body.analysis.supported, true);
  assert.equal(uploaded.body.analysis.tests.length, 2);
  const versionId = uploaded.body.versionId;
  const tiny = await post(`${base}/versions/${versionId}/plan`, { timeBudget: 0.001 });
  assert.equal(tiny.status, 201);
  assert.equal(tiny.body.plan.budgetConflict, true);
  assert.equal((await post(`${base}/plans/${tiny.body.planId}/approve`, { approved: true })).status, 400);
  const rejected = await post(`${base}/versions/${versionId}/plan`, {});
  assert.equal((await post(`${base}/plans/${rejected.body.planId}/reject`, {})).status, 200);
  assert.equal((await post(`${base}/plans/${rejected.body.planId}/approve`, { approved: true })).status, 409);
  const prepared = await post(`${base}/versions/${versionId}/plan`, { algorithm: 'BRANCH_AND_BOUND' });
  assert.equal(prepared.status, 201, prepared.body.message);
  assert.equal(prepared.body.plan.selectedTests.length, 2);
  assert.equal(prepared.body.plan.search.provenOptimal, true);
  assert.equal((await post(`${base}/plans/${prepared.body.planId}/approve`, {})).status, 400);
  assert.equal((await post(`${base}/plans/${prepared.body.planId}/approve`, { approved: true })).status, 503);
  const updated = await post(`${base}/versions`, { files: example.map(file => file.path === 'src/add.js' ? { ...file, content: 'export const add=(a,b)=>a+b+1;' } : file) });
  assert.deepEqual(updated.body.analysis.changes.modified, ['src/add.js']);
  const broad = await post(`${base}/versions/${updated.body.versionId}/plan`, {});
  assert.equal(broad.body.plan.fullValidation, true);
  const unsupported = await post(`${base}/versions`, { files: example.map(file => file.path === 'package.json' ? { ...file, content: '{"dependencies":{"other":"*"}}' } : file) });
  assert.equal(unsupported.body.analysis.supported, false);
  assert.equal((await post(`${base}/versions/${unsupported.body.versionId}/plan`, {})).status, 400);
  const history = await get(`${base}/plans`);
  assert.ok(history.body.plans.length >= 3);
  assert.ok(history.body.plans.every(plan => plan.results.length === 0));
});

test("enforces OTP attempt lockouts, refresh rotation/reuse revocation, OAuth CSRF state, rate limits, and isolated demo loading", { concurrency: false }, async () => {
  const email = `security-${Date.now()}@testopt.local`;
  const password = "Strong-security-test-password-123";

  // 1. OTP failure tracking & lockout after 5 bad attempts
  const sendRes = await post("/auth/send-otp", { email, name: "Security Tester" }, null);
  assert.equal(sendRes.status, 200);
  for (let i = 0; i < 5; i += 1) {
    const wrong = await post("/auth/verify-otp-and-register", {
      name: "Security Tester",
      email,
      password,
      organizationName: "Security Org",
      otp: "000000",
    }, null);
    assert.equal(wrong.status, 400);
  }
  const locked = await post("/auth/verify-otp-and-register", {
    name: "Security Tester",
    email,
    password,
    organizationName: "Security Org",
    otp: capturedOtps.get(email),
  }, null);
  assert.equal(locked.status, 400);
  assert.match(locked.body.message, /Too many failed attempts/);

  // Fresh OTP succeeds cleanly after old exhausted code is cleared cleanly by email cleanup
  await pool.query("DELETE FROM email_verification_codes WHERE email = ?", [email]);
  const reg = await registerViaOtp({ name: "Security Tester", email, password, organizationName: "Security Org" });
  createdUserIds.push(reg.body.user.userId);
  createdOrganizationIds.push(reg.body.organization.organizationId);
  const cookie1 = extractRefreshCookie(reg.headers);
  assert.ok(cookie1);

  // 2. Refresh origin validation, rotation, and reuse family revocation
  const badOrigin = await post("/auth/refresh", {}, null, {
    cookie: cookie1,
    origin: "https://evil.example",
  });
  assert.equal(badOrigin.status, 403);

  const refreshed = await post("/auth/refresh", {}, null, { cookie: cookie1 });
  assert.equal(refreshed.status, 200, refreshed.body.message);
  assert.ok(refreshed.body.accessToken);
  const cookie2 = extractRefreshCookie(refreshed.headers);
  assert.ok(cookie2 && cookie2 !== cookie1);

  // Concurrent replay of cookie1 within grace returns non-destructive 409 without revoking cookie2
  const concurrentRetry = await post("/auth/refresh", {}, null, { cookie: cookie1 });
  assert.equal(concurrentRetry.status, 409);

  // Outside grace window, replaying cookie1 revokes the entire family (blocking cookie2 too)
  const prevGrace = process.env.REFRESH_ROTATION_GRACE_MS;
  try {
    process.env.REFRESH_ROTATION_GRACE_MS = "0";
    const reuse = await post("/auth/refresh", {}, null, { cookie: cookie1 });
    assert.equal(reuse.status, 401);
    const victimAttempt = await post("/auth/refresh", {}, null, { cookie: cookie2 });
    assert.equal(victimAttempt.status, 401);
  } finally {
    if (prevGrace === undefined) delete process.env.REFRESH_ROTATION_GRACE_MS;
    else process.env.REFRESH_ROTATION_GRACE_MS = prevGrace;
  }

  // Re-login and logout cleanly
  const relogin = await post("/auth/login", { email, password }, null);
  assert.equal(relogin.status, 200);
  const cookie3 = extractRefreshCookie(relogin.headers);
  const logoutRes = await post("/auth/logout", {}, null, { cookie: cookie3 });
  assert.equal(logoutRes.status, 200);
  assert.equal((await post("/auth/refresh", {}, null, { cookie: cookie3 })).status, 401);

  // 3. OAuth state cookie verification rejects missing or mismatched state
  const prevGithubId = process.env.GITHUB_CLIENT_ID;
  const prevGoogleId = process.env.GOOGLE_CLIENT_ID;
  try {
    process.env.GITHUB_CLIENT_ID = "test_github_client_id";
    process.env.GOOGLE_CLIENT_ID = "test_google_client_id";
    const ghInit = await fetch(`${apiBaseUrl}/auth/github`, { redirect: "manual" });
    assert.equal(ghInit.status, 302);
    const ghLocation = new URL(ghInit.headers.get("location"));
    const ghState = ghLocation.searchParams.get("state");
    assert.ok(ghState);
    const ghStateCookie = (ghInit.headers.getSetCookie?.() || []).find((c) => c.startsWith("testopt_oauth_state="))?.split(";")[0];
    assert.ok(ghStateCookie);

    // Mismatched state or cross-provider state must fail cleanly without issuing session
    const ghBadState = await fetch(`${apiBaseUrl}/auth/github/callback?code=fake&state=tampered`, {
      redirect: "manual",
      headers: { cookie: ghStateCookie },
    });
    assert.equal(ghBadState.status, 302);
    assert.match(ghBadState.headers.get("location"), /#oauth_error=/);

    const googleCrossProvider = await fetch(`${apiBaseUrl}/auth/google/callback?code=fake&state=${encodeURIComponent(ghState)}`, {
      redirect: "manual",
      headers: { cookie: ghStateCookie },
    });
    assert.equal(googleCrossProvider.status, 302);
    assert.match(googleCrossProvider.headers.get("location"), /#oauth_error=/);

    // Block OAuth silent linking over existing LOCAL account or across providers
    await assert.rejects(
      handleOAuthUser({
        email,
        name: "Attacker",
        provider: "GOOGLE",
        providerId: `g-hijack-${Date.now()}`,
      }),
      (err) => err.statusCode === 409,
    );

    const oauthEmail = `oauth-only-${Date.now()}@testopt.local`;
    const ghCreated = await handleOAuthUser({
      email: oauthEmail,
      name: "OAuth User",
      provider: "GITHUB",
      providerId: `gh-${Date.now()}`,
    });
    createdUserIds.push(ghCreated.user.userId);
    createdOrganizationIds.push(ghCreated.organizations[0].organizationId);
    assert.equal(ghCreated.isNew, true);

    await assert.rejects(
      handleOAuthUser({
        email: oauthEmail,
        name: "Cross Provider",
        provider: "GOOGLE",
        providerId: `g-cross-${Date.now()}`,
      }),
      (err) => err.statusCode === 409,
    );
  } finally {
    if (prevGithubId === undefined) delete process.env.GITHUB_CLIENT_ID;
    else process.env.GITHUB_CLIENT_ID = prevGithubId;
    if (prevGoogleId === undefined) delete process.env.GOOGLE_CLIENT_ID;
    else process.env.GOOGLE_CLIENT_ID = prevGoogleId;
  }

  // 4. Rate limit on repeated failed logins
  const prevLimit = process.env.AUTH_RATE_LIMIT_LOGIN;
  try {
    process.env.AUTH_RATE_LIMIT_LOGIN = "2";
    await post("/auth/login", { email, password: "wrong-password-1" }, null);
    await post("/auth/login", { email, password: "wrong-password-2" }, null);
    const limited = await post("/auth/login", { email, password: "wrong-password-3" }, null);
    assert.equal(limited.status, 429);
  } finally {
    if (prevLimit === undefined) delete process.env.AUTH_RATE_LIMIT_LOGIN;
    else process.env.AUTH_RATE_LIMIT_LOGIN = prevLimit;
  }

  // 5. Isolated ShopCart demo project loads into caller's own org and remains inaccessible to other orgs
  assert.equal((await get("/catalog/projects/P_TESTOPT", reg.body.accessToken)).status, 403);
  const demo = await post("/source/projects/demo", {}, reg.body.accessToken);
  assert.equal(demo.status, 201, demo.body.message);
  createdProjectIds.push(demo.body.project.projectId);
  assert.equal(demo.body.project.organizationId, reg.body.organization.organizationId);
  assert.equal(demo.body.analysis.supported, true);
  assert.equal(demo.body.analysis.tests.length, 6);

  const crossTenantPlan = await post(
    `/source/projects/${demo.body.project.projectId}/versions/${demo.body.versionId}/plan`,
    {},
    accessToken,
  );
  assert.equal(crossTenantPlan.status, 403);
});
