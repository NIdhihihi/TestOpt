import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import mysql from 'mysql2/promise';
import dotenv from 'dotenv';
import { migrateDatabase, seedDatabase, splitSqlStatements } from './src/db/migrator.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
dotenv.config({ path: path.join(root, '.env') });

const stamp = Date.now();
const freshDb = `testopt_fresh_${stamp}`;
const legacyDb = `testopt_legacy_${stamp}`;
const db = await mysql.createConnection({
  host: process.env.DB_HOST || '127.0.0.1',
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
});

try {
  // 1. Verify legacy pre-ledger upgrade path (old pre-003/007/008/011 shape)
  await db.query(`CREATE DATABASE \`${legacyDb}\``);
  await db.changeUser({ database: legacyDb });
  const schemaSql = await fs.readFile(path.join(root, 'database', 'schema.sql'), 'utf8');
  for (const stmt of splitSqlStatements(schemaSql)) {
    await db.query(stmt);
  }
  await db.query('DROP TABLE schema_migrations');
  await db.query('DROP TABLE email_verification_codes');
  await db.query('ALTER TABLE users DROP COLUMN email_verified, DROP COLUMN auth_provider, DROP COLUMN auth_provider_id');
  await db.query('ALTER TABLE projects DROP FOREIGN KEY fk_projects_organization, DROP COLUMN organization_id, DROP COLUMN archived_at');
  await db.query('DROP TABLE audit_events, organization_members, organizations, execution_jobs, project_runner_configs, testing_constraints, source_plans, source_versions, source_test_history');
  await db.query('ALTER TABLE selected_tests DROP COLUMN status');
  await db.query('ALTER TABLE code_changes DROP COLUMN description, DROP COLUMN changed_module_ids, DROP COLUMN submitted_at');

  const upgradePass1 = await migrateDatabase(db);
  assert.ok(upgradePass1.applied.length >= 11, 'Expected legacy upgrade to reconcile all baseline migrations');
  const upgradePass2 = await migrateDatabase(db);
  assert.equal(upgradePass2.applied.length, 0, 'Repeated migration run must be a no-op');
  console.log('Legacy pre-tracker upgrade path verified cleanly.');

  // 2. Verify fresh install + seeding order + integration suite
  await db.query(`CREATE DATABASE \`${freshDb}\``);
  await db.changeUser({ database: freshDb });
  const freshPass1 = await migrateDatabase(db);
  assert.ok(freshPass1.applied.length >= 11, 'Expected fresh bootstrap to apply schema and record baseline');
  const freshPass2 = await migrateDatabase(db);
  assert.equal(freshPass2.applied.length, 0, 'Repeated fresh migration run must be a no-op');

  const seeded = await seedDatabase(db);
  assert.equal(seeded.seeded, true);

  console.log('Running integration tests in disposable fresh database:', freshDb);
  const code = await new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      ['--test', 'src/integration/workflow.test.js'],
      {
        cwd: path.join(root, 'backend'),
        env: { ...process.env, DB_NAME: freshDb, REDIS_URL: 'redis://127.0.0.1:1' },
        stdio: 'inherit',
        windowsHide: true,
      },
    );
    child.on('error', reject);
    child.on('exit', resolve);
  });
  process.exitCode = code ?? 1;
} finally {
  await db.query(`DROP DATABASE IF EXISTS \`${freshDb}\``);
  await db.query(`DROP DATABASE IF EXISTS \`${legacyDb}\``);
  await db.end();
  console.log('Disposable databases removed.');
}
