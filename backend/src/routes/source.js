import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import pool from '../db/connection.js';
import { requireAuth } from '../middleware/auth.js';
import { requireProjectRole } from '../middleware/authorization.js';
import { validateSourceFiles, analyzeSource } from '../services/sourceAnalysis.js';
import { planSource } from '../services/sourcePlanner.js';
import { jsonValue } from '../services/sourceExecution.js';
import { enqueueExecution } from '../queue/executionQueue.js';

const router = Router();
router.use(requireAuth);
const fail = (res, error) => res.status(error.statusCode || 400).json({ success: false, message: error.message });
async function access(req, active = false) {
  const projectId = req.params.projectId;
  await requireProjectRole(req.auth.sub, projectId);
  const [projects] = await pool.query('SELECT archived_at FROM projects WHERE project_id = ?', [projectId]);
  if (active && projects[0]?.archived_at) throw Object.assign(new Error('Project is archived; its history remains readable.'), { statusCode: 409 });
  return projectId;
}

router.post('/projects/:projectId/versions', async (req, res) => {
  const db = await pool.getConnection();
  try {
    const projectId = await access(req, true);
    const files = validateSourceFiles(req.body.files);
    await db.beginTransaction();
    const [project] = await db.query('SELECT archived_at FROM projects WHERE project_id = ? FOR UPDATE', [projectId]);
    if (project[0]?.archived_at) throw new Error('Project is archived.');
    const [versions] = await db.query('SELECT version_id, files FROM source_versions WHERE project_id = ? ORDER BY created_at DESC LIMIT 1', [projectId]);
    const analysis = analyzeSource(files, jsonValue(versions[0]?.files) || []);
    const versionId = `SRC_${randomUUID()}`;
    await db.query('INSERT INTO source_versions (version_id, project_id, previous_version_id, files, analysis) VALUES (?, ?, ?, ?, ?)', [versionId, projectId, versions[0]?.version_id || null, JSON.stringify(files), JSON.stringify(analysis)]);
    await db.commit();
    return res.status(201).json({ success: true, versionId, analysis });
  } catch (error) { await db.rollback(); return fail(res, error); } finally { db.release(); }
});

router.get('/projects/:projectId/versions', async (req, res) => {
  try {
    const id = await access(req);
    const [rows] = await pool.query('SELECT version_id AS versionId, analysis, evidence, created_at AS createdAt FROM source_versions WHERE project_id = ? ORDER BY created_at DESC LIMIT 20', [id]);
    return res.json({ success: true, versions: rows.map(row => ({ versionId: row.versionId, analysis: jsonValue(row.analysis), baselineReady: Boolean(jsonValue(row.evidence)?.complete), createdAt: row.createdAt })) });
  } catch (error) { return fail(res, error); }
});

router.post('/projects/:projectId/versions/:versionId/plan', async (req, res) => {
  try {
    const projectId = await access(req, true);
    const [rows] = await pool.query('SELECT * FROM source_versions WHERE version_id = ? AND project_id = ?', [req.params.versionId, projectId]);
    const version = rows[0];
    if (!version) return res.status(404).json({ success: false, message: 'Version was not found.' });
    let previous = null;
    if (version.previous_version_id) {
      const [prior] = await pool.query('SELECT analysis, evidence FROM source_versions WHERE version_id = ?', [version.previous_version_id]);
      previous = { analysis: jsonValue(prior[0]?.analysis), ...(jsonValue(prior[0]?.evidence) || {}) };
    }
    const [history] = await pool.query('SELECT * FROM source_test_history WHERE project_id = ?', [projectId]);
    const plan = planSource({ analysis: jsonValue(version.analysis), previous, history, ...Object.fromEntries(['timeBudget', 'workerCount', 'algorithm'].filter(key => req.body[key] !== undefined).map(key => [key, req.body[key]])) });
    const planId = `SP_${randomUUID()}`;
    await pool.query("INSERT INTO source_plans (plan_id, version_id, project_id, plan, status, results) VALUES (?, ?, ?, ?, 'PLANNED', '[]')", [planId, version.version_id, projectId, JSON.stringify(plan)]);
    return res.status(201).json({ success: true, planId, plan });
  } catch (error) { return fail(res, error); }
});

router.post('/projects/:projectId/plans/:planId/reject', async (req, res) => {
  try {
    const id = await access(req, true);
    const [result] = await pool.query("UPDATE source_plans SET status = 'REJECTED' WHERE plan_id = ? AND project_id = ? AND status = 'PLANNED'", [req.params.planId, id]);
    if (!result.affectedRows) return res.status(409).json({ success: false, message: 'Only an unsubmitted plan can be rejected.' });
    return res.json({ success: true, status: 'REJECTED' });
  } catch (error) { return fail(res, error); }
});

router.post('/projects/:projectId/plans/:planId/approve', async (req, res) => {
  const db = await pool.getConnection();
  try {
    const id = await access(req, true);
    if (req.body.approved !== true) throw new Error('Explicit approval is required.');
    await db.beginTransaction();
    const [project] = await db.query('SELECT archived_at FROM projects WHERE project_id = ? FOR UPDATE', [id]);
    if (project[0]?.archived_at) throw new Error('Project is archived.');
    const [rows] = await db.query('SELECT * FROM source_plans WHERE plan_id = ? AND project_id = ? FOR UPDATE', [req.params.planId, id]);
    const row = rows[0];
    if (!row) return res.status(404).json({ success: false, message: 'Plan was not found.' });
    if (row.status !== 'PLANNED') throw Object.assign(new Error('Plan was already submitted.'), { statusCode: 409 });
    const plan = jsonValue(row.plan);
    if (!plan.selectedTests.length) throw new Error(plan.noChanges ? 'No source changes to execute.' : 'No tests fit the budget. Increase it before approving.');
    const [busy] = await db.query("SELECT plan_id FROM source_plans WHERE project_id = ? AND status IN ('QUEUED','EXECUTING')", [id]);
    if (busy.length) throw Object.assign(new Error('A project execution is already active.'), { statusCode: 409 });
    await db.query("UPDATE source_plans SET status = 'QUEUED' WHERE plan_id = ?", [row.plan_id]);
    await db.commit();
    try { await enqueueExecution({ jobId: row.plan_id, sourcePlanId: row.plan_id }); }
    catch { await db.query("UPDATE source_plans SET status = 'ERROR', error_message = 'Redis unavailable; create a new plan to retry.' WHERE plan_id = ?", [row.plan_id]); throw Object.assign(new Error('Execution queue unavailable. Start Redis and the worker.'), { statusCode: 503 }); }
    return res.status(202).json({ success: true, planId: row.plan_id, status: 'QUEUED' });
  } catch (error) { await db.rollback(); return fail(res, error); } finally { await db.rollback(); db.release(); }
});

router.get('/projects/:projectId/plans', async (req, res) => {
  try {
    const id = await access(req);
    const [rows] = await pool.query('SELECT plan_id AS planId, version_id AS versionId, plan, status, results, error_message AS message, created_at AS createdAt FROM source_plans WHERE project_id = ? ORDER BY created_at DESC LIMIT 30', [id]);
    return res.json({ success: true, plans: rows.map(row => ({ ...row, plan: jsonValue(row.plan), results: jsonValue(row.results) })) });
  } catch (error) { return fail(res, error); }
});

router.get('/projects/:projectId/plans/:planId/export', async (req, res) => {
  try {
    const id = await access(req);
    const [rows] = await pool.query('SELECT * FROM source_plans WHERE plan_id = ? AND project_id = ?', [req.params.planId, id]);
    if (!rows[0]) return res.status(404).json({ success: false, message: 'Plan was not found.' });
    return res.json({ ...rows[0], plan: jsonValue(rows[0].plan), results: jsonValue(rows[0].results) });
  } catch (error) { return fail(res, error); }
});
export default router;
