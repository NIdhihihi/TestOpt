import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import assert from 'node:assert/strict';
import mysql from 'mysql2/promise';
import dotenv from 'dotenv';
import { example } from './src/integration/fixtures/demoProject.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
dotenv.config({ path: path.join(root, '.env') });
const directory = path.join(root, '.testopt-smoke');
await fs.mkdir(directory, { recursive: true });
const database = `testopt_smoke_${Date.now()}`;
process.env.DB_NAME = database;
process.env.REDIS_URL = process.env.SMOKE_REDIS_URL || 'redis://127.0.0.1:6385';
process.env.EXECUTION_QUEUE_NAME = database;
process.env.JWT_SECRET = 'disposable-smoke-test-secret-not-for-production';
process.env.CORS_ORIGINS = 'http://localhost:5174,http://127.0.0.1:5174';
process.env.TEST_WORKSPACE_ROOT = root;
process.env.TEST_RUNNER_TIMEOUT_MS = '10000';
const db = await mysql.createConnection({ host: process.env.DB_HOST, port: Number(process.env.DB_PORT || 3306), user: process.env.DB_USER, password: process.env.DB_PASSWORD, multipleStatements: true });
let server, worker, queue, pool;
try {
  await db.query(`CREATE DATABASE \`${database}\``);
  await db.changeUser({ database });
  for (const file of ['schema.sql', 'seed.sql', 'migrations/003_add_organizations.sql', 'migrations/004_add_audit_events.sql', 'migrations/005_add_execution_jobs.sql', 'migrations/006_add_runner_configs.sql', 'migrations/010_source_workflow.sql']) {
    const sql = (await fs.readFile(path.join(root, 'database', file), 'utf8')).replace(/CREATE DATABASE IF NOT EXISTS testopt;/g, '').replace(/USE testopt;/g, '');
    await db.query(sql);
  }
  const { default: app } = await import('./src/app.js');
  ({ default: pool } = await import('./src/db/connection.js'));
  server = app.listen(5001, '127.0.0.1');
  await new Promise((resolve, reject) => { server.once('listening', resolve); server.once('error', reject); });
  worker = spawn(process.execPath, ['src/worker.js'], { cwd: path.join(root, 'backend'), env: process.env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  worker.stdout.on('data', data => process.stdout.write(data));
  worker.stderr.on('data', data => process.stderr.write(data));
  let token;
  const request = async (route, method = 'GET', body, auth = token) => {
    const response = await fetch(`http://127.0.0.1:5001/api${route}`, { method, headers: { 'Content-Type': 'application/json', ...(auth ? { Authorization: `Bearer ${auth}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
    const text = await response.text();
    const data = response.headers.get('content-type')?.includes('application/json') ? JSON.parse(text) : text;
    return { status: response.status, data };
  };
  const account = { name: 'Smoke Tester', email: 'smoke@testopt.local', password: 'Disposable-smoke-password-123', organizationName: 'Disposable smoke organization' };
  const registration = await request('/auth/register', 'POST', account);
  assert.equal(registration.status, 201);
  token = registration.data.accessToken;
  await db.query("INSERT INTO organization_members (organization_id, user_id, role) VALUES ('ORG_DEFAULT', ?, 'OWNER')", [registration.data.user.userId]);
  const login = await request('/auth/login', 'POST', { email: account.email, password: account.password });
  assert.equal(login.status, 200);
  const unauthorized = await request('/catalog/workers', 'POST', { workerStatus: 'AVAILABLE' });
  assert.equal(unauthorized.status, 403);
  const base = '/source/projects/P_TESTOPT';
  const checks = [];
  const upload = async files => {
    const response = await request(`${base}/versions`, 'POST', { files });
    assert.equal(response.status, 201, JSON.stringify(response.data));
    return response.data.versionId;
  };
  const prepare = async (version, settings = {}) => {
    const response = await request(`${base}/versions/${version}/plan`, 'POST', settings);
    assert.equal(response.status, 201, JSON.stringify(response.data));
    return response.data;
  };
  const execute = async prepared => {
    assert.equal((await request(`${base}/plans/${prepared.planId}/approve`, 'POST', {})).status, 400);
    assert.equal((await request(`${base}/plans/${prepared.planId}/approve`, 'POST', { approved: true })).status, 202);
    assert.equal((await request('/catalog/projects/P_TESTOPT', 'DELETE')).status, 409);
    for (let attempt = 0; attempt < 100; attempt++) {
      const response = await request(`${base}/plans`);
      const result = response.data.plans.find(item => item.planId === prepared.planId);
      if (!['QUEUED', 'EXECUTING'].includes(result.status)) return result;
      await new Promise(resolve => setTimeout(resolve, 500));
    }
    throw new Error('Source plan exceeded its smoke-test deadline.');
  };
  const baseline = await execute(await prepare(await upload(example)));
  assert.equal(baseline.status, 'COMPLETED', JSON.stringify(baseline));
  assert.equal(baseline.results.length, 2);
  assert.ok(baseline.results.every(item => item.status === 'PASSED' && item.coverageAvailable));
  checks.push({ mode: 'baseline', status: baseline.status, tests: 2 });
  console.log('Source baseline passed with independent coverage.');
  let changed = example.map(file => file.path === 'src/add.js' ? { ...file, content: 'export function add(a,b) { return a+b; }' } : file);
  const changedVersion = await upload(changed);
  const partial = await prepare(changedVersion, { timeBudget: 0.001 });
  assert.equal(partial.plan.complete, false);
  assert.equal(partial.plan.budgetConflict, true);
  const selective = await prepare(changedVersion);
  assert.equal(selective.plan.selectedTests.length, 1);
  assert.deepEqual(selective.plan.skippedTests, ['test/text.test.js']);
  const narrowed = await execute(selective);
  assert.equal(narrowed.status, 'COMPLETED');
  checks.push({ mode: 'changed-subset', status: narrowed.status, tests: 1 });
  console.log('Changed source selected one of two real test files.');
  changed = changed.map(file => file.path === 'src/add.js' ? { ...file, content: 'export const add=(a,b)=>a+b+1;' } : file);
  const failing = await execute(await prepare(await upload(changed)));
  assert.equal(failing.status, 'FAILED');
  assert.equal(failing.results[0].status, 'FAILED');
  checks.push({ mode: 'failure', status: failing.status, tests: failing.results.length });
  const hanging = example.map(file => file.path === 'test/add.test.js' ? { ...file, content: "import test from 'node:test'; test('hang',()=>new Promise(()=>setInterval(()=>{},1000)));" } : file);
  const timeout = await execute(await prepare(await upload(hanging)));
  assert.equal(timeout.status, 'ERROR');
  assert.ok(timeout.results.some(item => item.status === 'ERROR'));
  assert.ok(timeout.results.some(item => item.testPath === 'test/text.test.js' && item.status === 'PASSED'));
  checks.push({ mode: 'independent-timeout', status: timeout.status, tests: timeout.results.length });
  const [stats] = await db.query("SELECT total_executions, failure_count FROM source_test_history WHERE project_id = 'P_TESTOPT' AND test_path = 'test/add.test.js'");
  assert.equal(stats[0].total_executions, 3);
  assert.equal(stats[0].failure_count, 1);
  const exported = await request(`${base}/plans/${narrowed.planId}/export`);
  assert.equal(exported.status, 200);
  assert.equal(exported.data.results.length, 1);
  console.log('Independent failure/timeout and unchanged ERROR counters verified.');
  const deletion = await request('/catalog/projects', 'POST', { projectName: 'Disposable deletion check', organizationId: registration.data.organization.organizationId });
  assert.equal(deletion.status, 201);
  assert.equal((await request(`/catalog/projects/${deletion.data.project.projectId}`, 'DELETE')).status, 200);
  if (!process.argv.includes('--serve')) {
    assert.equal((await request('/catalog/projects/P_TESTOPT', 'DELETE')).status, 200);
    assert.equal((await request(`${base}/plans`)).data.plans.length > 0, true);
    assert.equal((await request(`${base}/versions`, 'POST', { files: example })).status, 409);
    assert.equal((await request(`${base}/plans/${narrowed.planId}/export`)).status, 200);
    console.log('Archived source versions and results remain readable; new uploads are blocked.');
  }


  await fs.writeFile(path.join(directory, 'checks.json'), JSON.stringify(checks, null, 2));
  console.log('LIVE_SMOKE_READY: frontend API http://127.0.0.1:5001/api; account smoke@testopt.local; disposable database only');
  if (process.argv.includes('--serve')) {
    for (const [label, source] of [['upload-v1', example], ['upload-v2', example.map(file => file.path === 'src/add.js' ? { ...file, content: 'export function add(a,b) { return a+b; }' } : file)]]) {
      for (const file of source) { const destination = path.join(directory, label, file.path); await fs.mkdir(path.dirname(destination), { recursive: true }); await fs.writeFile(destination, file.content); }
    }
    await fs.rm(path.join(directory, 'stop'), { force: true });
    await fs.writeFile(path.join(directory, 'ready'), database);
    await new Promise(resolve => { const timer = setInterval(async () => { try { await fs.access(path.join(directory, 'stop')); clearInterval(timer); resolve(); } catch {} }, 1000); });
  }
} finally {
  if (worker?.pid) {
    if (process.platform === 'win32') await new Promise(resolve => { const killer = spawn('taskkill', ['/PID', String(worker.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' }); killer.once('exit', resolve); killer.once('error', resolve); });
    else worker.kill('SIGTERM');
  }
  ({ executionQueue: queue } = await import('./src/queue/executionQueue.js'));
  if (queue) { await queue.obliterate({ force: true }); await queue.close(); }
  if (server) await new Promise(resolve => server.close(resolve));
  await pool?.end();
  await db.query(`DROP DATABASE IF EXISTS \`${database}\``);
  await db.end();
  console.log('Disposable smoke database and queue removed.');
}
