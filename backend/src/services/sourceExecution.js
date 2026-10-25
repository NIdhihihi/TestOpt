import pool from '../db/connection.js';
import { withSourceDirectory, runSourceFile, sourceResultStatus } from '../execution/sourceRunner.js';

export const jsonValue = value => typeof value === 'string' ? JSON.parse(value) : value;

export async function executeSourcePlan(planId) {
  const db = await pool.getConnection();
  let row;
  try {
    await db.beginTransaction();
    const [rows] = await db.query('SELECT * FROM source_plans WHERE plan_id = ? FOR UPDATE', [planId]);
    row = rows[0];
    if (row?.status === 'EXECUTING') { await db.query("UPDATE source_plans SET status = 'ERROR', error_message = 'Execution worker was interrupted. Create a new plan to retry.' WHERE plan_id = ?", [planId]); await db.commit(); return; }
    if (!row || row.status !== 'QUEUED') { await db.rollback(); return; }
    await db.query("UPDATE source_plans SET status = 'EXECUTING' WHERE plan_id = ?", [planId]);
    await db.commit();
  } finally { await db.rollback(); db.release(); }
  const plan = jsonValue(row.plan);
  const [versions] = await pool.query('SELECT * FROM source_versions WHERE version_id = ?', [row.version_id]);
  const version = versions[0];
  const results = [];
  // Serialize persistence across workers so concurrent arrivals cannot overwrite each other.
  let persistence = Promise.resolve();
  try {
    await withSourceDirectory(jsonValue(version.files), async directory => {
      await Promise.all((plan.schedule?.workers || []).map(async worker => {
        for (const test of worker.tests) {
          const result = { ...await runSourceFile(directory, test.testId), workerId: worker.workerId };
          results.push(result);
          persistence = persistence.then(async () => {
            const connection = await pool.getConnection();
            try {
              await connection.beginTransaction();
              await connection.query('UPDATE source_plans SET results = ? WHERE plan_id = ?', [JSON.stringify(results), planId]);
              if (['PASSED', 'FAILED'].includes(result.status)) await connection.query(`INSERT INTO source_test_history (project_id, test_path, total_executions, failure_count, estimated_time, last_execution)
                VALUES (?, ?, 1, ?, ?, NOW()) ON DUPLICATE KEY UPDATE total_executions = total_executions + 1, failure_count = failure_count + VALUES(failure_count), estimated_time = VALUES(estimated_time), last_execution = NOW()`, [row.project_id, result.testPath, result.status === 'FAILED' ? 1 : 0, Math.max(0.01, result.actualTime)]);
              await connection.commit();
            } catch (error) { await connection.rollback(); throw error; } finally { connection.release(); }
          });
          await persistence;
        }
      }));
    });
    await persistence;
    const status = sourceResultStatus(plan, results);
    await pool.query('UPDATE source_plans SET status = ?, completed_at = NOW() WHERE plan_id = ?', [status, planId]);
    if (status === 'COMPLETED') {
      let prior = [];
      if (version.previous_version_id) {
        const [rows] = await pool.query('SELECT evidence FROM source_versions WHERE version_id = ?', [version.previous_version_id]);
        prior = jsonValue(rows[0]?.evidence)?.results || [];
      }
      const analysis = jsonValue(version.analysis);
      const merged = new Map(prior.filter(result => analysis.tests.includes(result.testPath)).map(result => [result.testPath, result]));
      for (const result of results) merged.set(result.testPath, result);
      const complete = analysis.tests.every(name => merged.get(name)?.status === 'PASSED' && merged.get(name)?.coverageAvailable);
      await pool.query('UPDATE source_versions SET evidence = ? WHERE version_id = ?', [JSON.stringify({ complete, results: [...merged.values()], analysis }), version.version_id]);
    }
  } catch (error) {
    await pool.query("UPDATE source_plans SET status = 'ERROR', error_message = ?, completed_at = NOW() WHERE plan_id = ?", [error.message, planId]);
    throw error;
  }
}
