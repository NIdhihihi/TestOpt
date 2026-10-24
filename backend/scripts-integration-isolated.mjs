import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import mysql from 'mysql2/promise';
import dotenv from 'dotenv';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
dotenv.config({ path: path.join(root, '.env') });
const name = `testopt_check_${Date.now()}`;
const db = await mysql.createConnection({ host: process.env.DB_HOST, port: Number(process.env.DB_PORT || 3306), user: process.env.DB_USER, password: process.env.DB_PASSWORD, multipleStatements: true });
try {
  await db.query(`CREATE DATABASE \`${name}\``);
  await db.changeUser({ database: name });
  const runSql = async file => {
    let sql = await fs.readFile(path.join(root, 'database', file), 'utf8');
    sql = sql.replace(/CREATE DATABASE IF NOT EXISTS testopt;/g, '').replace(/USE testopt;/g, '');
    await db.query(sql);
  };
  await runSql('schema.sql');
  // Reconstruct the pre-007/008 shape, then verify the upgrade migrations.
  await db.query("ALTER TABLE selected_tests DROP COLUMN status");
  await db.query("ALTER TABLE code_changes DROP COLUMN description, DROP COLUMN changed_module_ids, DROP COLUMN submitted_at");
  await db.query("DROP TABLE testing_constraints");
  await runSql('seed.sql');
  for (const file of ['003_add_organizations.sql', '004_add_audit_events.sql', '005_add_execution_jobs.sql', '006_add_runner_configs.sql']) await runSql(`migrations/${file}`);
  await runSql('migrations/007_align_state_lifecycle.sql');
  await runSql('migrations/008_formalize_code_change_and_constraints.sql');
  await runSql('migrations/010_source_workflow.sql');
  console.log('Running integration tests in disposable database:', name);
  const code = await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['--test', 'src/integration/workflow.test.js'], { cwd: path.join(root, 'backend'), env: { ...process.env, DB_NAME: name, REDIS_URL: 'redis://127.0.0.1:1' }, stdio: 'inherit', windowsHide: true });
    child.on('error', reject); child.on('exit', resolve);
  });
  process.exitCode = code ?? 1;
} finally {
  await db.query(`DROP DATABASE IF EXISTS \`${name}\``);
  await db.end();
  console.log('Disposable database removed.');
}
