import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import mysql from "mysql2/promise";
import dotenv from "dotenv";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, "../../..");
export const DEFAULT_DATABASE_DIR = path.join(ROOT_DIR, "database");

export const BASELINE_MIGRATION_NAMES = new Set([
  "001_add_worker_count.sql",
  "002_separate_selection_and_scheduling_algorithms.sql",
  "003_add_organizations.sql",
  "004_add_audit_events.sql",
  "005_add_execution_jobs.sql",
  "006_add_runner_configs.sql",
  "007_align_state_lifecycle.sql",
  "008_formalize_code_change_and_constraints.sql",
  "009_archive_projects.sql",
  "010_source_workflow.sql",
  "011_add_auth_oauth_and_email_verification.sql",
  "012_auth_hardening_and_refresh_tokens.sql",
]);

/**
 * Computes normalized SHA-256 checksum for a SQL script (normalizes CRLF/LF).
 */
export function computeSqlChecksum(sql) {
  return crypto.createHash("sha256").update(sql.replace(/\r\n/g, "\n")).digest("hex");
}

/**
 * Splits a SQL script into individual statements, respecting quotes and comments.
 */
export function splitSqlStatements(sql) {
  const statements = [];
  let current = "";
  let quote = null;
  let inLineComment = false;
  let inBlockComment = false;

  for (let i = 0; i < sql.length; i += 1) {
    const ch = sql[i];
    const next = sql[i + 1];

    if (inLineComment) {
      if (ch === "\n") {
        inLineComment = false;
        current += ch;
      }
      continue;
    }

    if (inBlockComment) {
      if (ch === "*" && next === "/") {
        inBlockComment = false;
        i += 1;
      }
      continue;
    }

    if (quote) {
      current += ch;
      if (ch === "\\" && quote !== "`") {
        if (next !== undefined) {
          current += next;
          i += 1;
        }
        continue;
      }
      if (ch === quote) {
        if (next === quote) {
          current += next;
          i += 1;
        } else {
          quote = null;
        }
      }
      continue;
    }

    if (
      (ch === "-" && next === "-" && (i + 2 >= sql.length || /\s/.test(sql[i + 2]))) ||
      ch === "#"
    ) {
      inLineComment = true;
      if (ch === "-") i += 1;
      continue;
    }

    if (ch === "/" && next === "*") {
      inBlockComment = true;
      i += 1;
      continue;
    }

    if (ch === "'" || ch === '"' || ch === "`") {
      quote = ch;
      current += ch;
      continue;
    }

    if (ch === ";") {
      const trimmed = current.trim();
      if (trimmed) statements.push(trimmed);
      current = "";
      continue;
    }

    current += ch;
  }

  const tail = current.trim();
  if (tail) statements.push(tail);
  return statements;
}

async function executeStatements(conn, sql) {
  for (const statement of splitSqlStatements(sql)) {
    await conn.query(statement);
  }
}

async function listTables(conn) {
  const [rows] = await conn.query(
    "SELECT TABLE_NAME AS tableName FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE()",
  );
  return new Set(rows.map((r) => String(r.tableName).toLowerCase()));
}

async function hasTable(conn, tableName) {
  const tables = await listTables(conn);
  return tables.has(tableName.toLowerCase());
}

async function listColumns(conn, tableName) {
  const [rows] = await conn.query(
    "SELECT COLUMN_NAME AS colName FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?",
    [tableName],
  );
  return new Set(rows.map((r) => String(r.colName).toLowerCase()));
}

async function hasConstraint(conn, tableName, constraintName) {
  const [rows] = await conn.query(
    "SELECT CONSTRAINT_NAME FROM information_schema.TABLE_CONSTRAINTS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND CONSTRAINT_NAME = ?",
    [tableName, constraintName],
  );
  return rows.length > 0;
}

async function hasIndex(conn, tableName, indexName) {
  const [rows] = await conn.query(
    "SELECT INDEX_NAME FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND INDEX_NAME = ?",
    [tableName, indexName],
  );
  return rows.length > 0;
}

async function ensureSchemaMigrationsTable(conn) {
  await conn.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      filename VARCHAR(255) PRIMARY KEY,
      checksum CHAR(64) NOT NULL,
      applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);
}

async function readMigrationFiles(migrationsDir) {
  const entries = await fs.readdir(migrationsDir, { withFileTypes: true });
  const filenames = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".sql"))
    .map((entry) => entry.name)
    .sort((a, b) => a.localeCompare(b, "en", { numeric: true }));

  return Promise.all(
    filenames.map(async (filename) => {
      const sql = await fs.readFile(path.join(migrationsDir, filename), "utf8");
      return { filename, sql, checksum: computeSqlChecksum(sql) };
    }),
  );
}

/**
 * Reconciles legacy pre-tracker databases for migrations 001..011 cleanly in MySQL 8.4,
 * inspecting information_schema so partially upgraded databases never error on duplicate columns.
 */
async function applyLegacyMigration(conn, { filename, sql }) {
  switch (filename) {
    case "001_add_worker_count.sql": {
      const cols = await listColumns(conn, "optimization_runs");
      if (!cols.has("worker_count")) await executeStatements(conn, sql);
      return;
    }
    case "002_separate_selection_and_scheduling_algorithms.sql": {
      const runCols = await listColumns(conn, "optimization_runs");
      if (runCols.has("algorithm")) {
        await executeStatements(conn, sql);
        return;
      }
      if (!runCols.has("selection_algorithm")) {
        await conn.query("ALTER TABLE optimization_runs ADD COLUMN selection_algorithm VARCHAR(50) NOT NULL DEFAULT 'GREEDY' AFTER change_id");
      }
      if (!runCols.has("scheduling_strategy")) {
        await conn.query("ALTER TABLE optimization_runs ADD COLUMN scheduling_strategy VARCHAR(50) NULL AFTER selection_algorithm");
      }
      const selectedCols = await listColumns(conn, "selected_tests");
      if (!selectedCols.has("selection_rank")) {
        await conn.query("ALTER TABLE selected_tests ADD COLUMN selection_rank INT NOT NULL DEFAULT 1 AFTER score");
      }
      return;
    }
    case "003_add_organizations.sql": {
      if (!(await hasTable(conn, "organizations"))) {
        await conn.query(`
          CREATE TABLE organizations (
            organization_id VARCHAR(50) PRIMARY KEY,
            organization_name VARCHAR(150) NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
          )
        `);
      }
      if (!(await hasTable(conn, "organization_members"))) {
        await conn.query(`
          CREATE TABLE organization_members (
            organization_id VARCHAR(50) NOT NULL,
            user_id VARCHAR(50) NOT NULL,
            role ENUM('OWNER', 'ADMIN', 'TEST_MANAGER', 'DEVELOPER', 'VIEWER') NOT NULL DEFAULT 'DEVELOPER',
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY (organization_id, user_id),
            FOREIGN KEY (organization_id) REFERENCES organizations(organization_id) ON DELETE CASCADE,
            FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
          )
        `);
      }
      await conn.query(
        "INSERT IGNORE INTO organizations (organization_id, organization_name) VALUES ('ORG_DEFAULT', 'Default organization')",
      );
      const projCols = await listColumns(conn, "projects");
      if (!projCols.has("organization_id")) {
        await conn.query("ALTER TABLE projects ADD COLUMN organization_id VARCHAR(50) NULL");
      }
      await conn.query("UPDATE projects SET organization_id = 'ORG_DEFAULT' WHERE organization_id IS NULL");
      await conn.query("ALTER TABLE projects MODIFY organization_id VARCHAR(50) NOT NULL");
      if (!(await hasConstraint(conn, "projects", "fk_projects_organization"))) {
        await conn.query(
          "ALTER TABLE projects ADD CONSTRAINT fk_projects_organization FOREIGN KEY (organization_id) REFERENCES organizations(organization_id)",
        );
      }
      return;
    }
    case "004_add_audit_events.sql": {
      if (!(await hasTable(conn, "audit_events"))) await executeStatements(conn, sql);
      return;
    }
    case "005_add_execution_jobs.sql": {
      if (!(await hasTable(conn, "execution_jobs"))) await executeStatements(conn, sql);
      return;
    }
    case "006_add_runner_configs.sql": {
      if (!(await hasTable(conn, "project_runner_configs"))) {
        await executeStatements(conn, sql);
      } else {
        await conn.query(
          "INSERT IGNORE INTO project_runner_configs (project_id, runner_type, workspace_path, command_name, command_args) SELECT 'P_TESTOPT', 'NPM', 'backend', 'npm', JSON_ARRAY('test') FROM projects WHERE project_id = 'P_TESTOPT'",
        );
      }
      return;
    }
    case "007_align_state_lifecycle.sql": {
      const cols = await listColumns(conn, "selected_tests");
      if (!cols.has("status")) await executeStatements(conn, sql);
      return;
    }
    case "008_formalize_code_change_and_constraints.sql": {
      const changeCols = await listColumns(conn, "code_changes");
      if (!changeCols.has("description")) {
        await conn.query("ALTER TABLE code_changes ADD COLUMN description TEXT NULL AFTER project_id");
      }
      if (!changeCols.has("changed_module_ids")) {
        await conn.query("ALTER TABLE code_changes ADD COLUMN changed_module_ids JSON NULL AFTER description");
      }
      if (!changeCols.has("submitted_at")) {
        await conn.query("ALTER TABLE code_changes ADD COLUMN submitted_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP AFTER time_budget");
      }
      if (!(await hasTable(conn, "testing_constraints"))) {
        await conn.query(`
          CREATE TABLE testing_constraints (
            project_id VARCHAR(50) PRIMARY KEY,
            w1 DECIMAL(4,3) NOT NULL DEFAULT 0.350,
            w2 DECIMAL(4,3) NOT NULL DEFAULT 0.250,
            w3 DECIMAL(4,3) NOT NULL DEFAULT 0.150,
            w4 DECIMAL(4,3) NOT NULL DEFAULT 0.250,
            default_budget DECIMAL(8,2) NOT NULL DEFAULT 15.00,
            max_workers INT NOT NULL DEFAULT 2,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            FOREIGN KEY (project_id) REFERENCES projects(project_id) ON DELETE CASCADE
          )
        `);
      }
      await conn.query(
        "INSERT IGNORE INTO testing_constraints (project_id, w1, w2, w3, w4, default_budget, max_workers) SELECT 'P_TESTOPT', 0.350, 0.250, 0.150, 0.250, 15.00, 2 FROM projects WHERE project_id = 'P_TESTOPT'",
      );
      return;
    }
    case "009_archive_projects.sql": {
      const cols = await listColumns(conn, "projects");
      if (!cols.has("archived_at")) await executeStatements(conn, sql);
      return;
    }
    case "010_source_workflow.sql": {
      await executeStatements(conn, sql);
      return;
    }
    case "011_add_auth_oauth_and_email_verification.sql": {
      const userCols = await listColumns(conn, "users");
      if (!userCols.has("email_verified")) {
        await conn.query("ALTER TABLE users ADD COLUMN email_verified BOOLEAN NOT NULL DEFAULT FALSE");
      }
      if (!userCols.has("auth_provider")) {
        await conn.query("ALTER TABLE users ADD COLUMN auth_provider ENUM('LOCAL', 'GOOGLE', 'GITHUB') NOT NULL DEFAULT 'LOCAL'");
      }
      if (!userCols.has("auth_provider_id")) {
        await conn.query("ALTER TABLE users ADD COLUMN auth_provider_id VARCHAR(255) NULL");
      }
      const [pwCol] = await conn.query(
        "SELECT IS_NULLABLE AS isNullable FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users' AND COLUMN_NAME = 'password_hash'",
      );
      if (pwCol[0]?.isNullable === "NO") {
        await conn.query("ALTER TABLE users MODIFY COLUMN password_hash VARCHAR(255) NULL");
      }
      if (!(await hasTable(conn, "email_verification_codes"))) {
        await conn.query(`
          CREATE TABLE email_verification_codes (
            id INT AUTO_INCREMENT PRIMARY KEY,
            email VARCHAR(150) NOT NULL,
            otp_hash VARCHAR(255) NOT NULL,
            purpose VARCHAR(30) NOT NULL DEFAULT 'REGISTRATION',
            expires_at DATETIME NOT NULL,
            attempts_remaining INT NOT NULL DEFAULT 5,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            INDEX idx_email_verification (email, expires_at)
          )
        `);
      }
      return;
    }
    case "012_auth_hardening_and_refresh_tokens.sql": {
      if (!(await hasTable(conn, "refresh_tokens"))) {
        await conn.query(`
          CREATE TABLE refresh_tokens (
            token_id VARCHAR(64) PRIMARY KEY,
            user_id VARCHAR(50) NOT NULL,
            family_id VARCHAR(64) NOT NULL,
            token_hash CHAR(64) NOT NULL UNIQUE,
            expires_at DATETIME(3) NOT NULL,
            max_expires_at DATETIME(3) NOT NULL,
            revoked_at DATETIME(3) NULL,
            replaced_by_id VARCHAR(64) NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE,
            INDEX idx_refresh_user (user_id),
            INDEX idx_refresh_family (family_id),
            INDEX idx_refresh_expires (expires_at)
          )
        `);
      }
      if (!(await hasIndex(conn, "users", "idx_users_oauth_provider"))) {
        await conn.query("UPDATE users SET auth_provider_id = NULL WHERE auth_provider = 'LOCAL' AND auth_provider_id = ''");
        await conn.query(
          "UPDATE users SET email_verified = TRUE WHERE auth_provider = 'LOCAL' AND password_hash IS NOT NULL AND email_verified = FALSE",
        );
        await conn.query("ALTER TABLE users ADD UNIQUE INDEX idx_users_oauth_provider (auth_provider, auth_provider_id)");
      }
      return;
    }
    default:
      await executeStatements(conn, sql);
  }
}

/**
 * Applies either the authoritative fresh schema (empty DB) or pending migrations,
 * tracking every applied migration filename and SHA-256 checksum in schema_migrations.
 */
export async function migrateDatabase(conn, { databaseDir = DEFAULT_DATABASE_DIR } = {}) {
  const migrationsDir = path.join(databaseDir, "migrations");
  const migrations = await readMigrationFiles(migrationsDir);
  const existingTables = await listTables(conn);
  const applied = [];
  const skipped = [];

  if (existingTables.size === 0) {
    const schemaSql = await fs.readFile(path.join(databaseDir, "schema.sql"), "utf8");
    await executeStatements(conn, schemaSql);
    await ensureSchemaMigrationsTable(conn);

    for (const migration of migrations) {
      if (BASELINE_MIGRATION_NAMES.has(migration.filename)) {
        await conn.query(
          "INSERT INTO schema_migrations (filename, checksum) VALUES (?, ?)",
          [migration.filename, migration.checksum],
        );
        applied.push(migration.filename);
      }
    }
  } else if (!existingTables.has("schema_migrations")) {
    await ensureSchemaMigrationsTable(conn);
  }

  const [recordedRows] = await conn.query("SELECT filename, checksum FROM schema_migrations");
  const recorded = new Map(recordedRows.map((row) => [row.filename, row.checksum]));

  for (const migration of migrations) {
    if (recorded.has(migration.filename)) {
      const storedChecksum = recorded.get(migration.filename);
      if (storedChecksum !== migration.checksum && !BASELINE_MIGRATION_NAMES.has(migration.filename)) {
        throw new Error(
          `Migration checksum mismatch for ${migration.filename}: recorded ${storedChecksum}, found ${migration.checksum}`,
        );
      }
      if (!applied.includes(migration.filename)) {
        skipped.push(migration.filename);
      }
      continue;
    }

    if (BASELINE_MIGRATION_NAMES.has(migration.filename)) {
      await applyLegacyMigration(conn, migration);
    } else {
      await executeStatements(conn, migration.sql);
    }

    await conn.query(
      "INSERT INTO schema_migrations (filename, checksum) VALUES (?, ?)",
      [migration.filename, migration.checksum],
    );
    applied.push(migration.filename);
  }

  return { applied, skipped };
}

/**
 * Runs sample seed SQL strictly after schema/migrations are present.
 */
export async function seedDatabase(conn, { databaseDir = DEFAULT_DATABASE_DIR, ifEmpty = false } = {}) {
  if (ifEmpty) {
    const [rows] = await conn.query("SELECT COUNT(*) AS count FROM projects");
    if (Number(rows[0]?.count ?? 0) > 0) {
      return { seeded: false, reason: "projects_not_empty" };
    }
  }

  const seedSql = await fs.readFile(path.join(databaseDir, "seed.sql"), "utf8");
  await executeStatements(conn, seedSql);
  return { seeded: true };
}

/**
 * Ensures the target MySQL database exists and connects to it.
 */
export async function openMigratorConnection({
  host = process.env.DB_HOST || "127.0.0.1",
  port = Number(process.env.DB_PORT || 3306),
  user = process.env.DB_USER,
  password = process.env.DB_PASSWORD,
  database = process.env.DB_NAME,
  createDatabase = false,
} = {}) {
  if (!database || !/^[a-zA-Z0-9_]+$/.test(database)) {
    throw new Error("DB_NAME must be a valid alphanumeric/underscore identifier.");
  }

  const conn = await mysql.createConnection({ host, port, user, password });
  if (createDatabase) {
    await conn.query(`CREATE DATABASE IF NOT EXISTS \`${database}\``);
  }
  await conn.changeUser({ database });
  return conn;
}

async function runCli() {
  dotenv.config({ path: path.join(ROOT_DIR, ".env") });
  const args = new Set(process.argv.slice(2));
  const createDatabase = args.has("--create-db");
  const seedOnly = args.has("--seed-only");
  const shouldSeed = args.has("--seed") || seedOnly;
  const shouldSeedIfEmpty = args.has("--seed-if-empty");

  const conn = await openMigratorConnection({ createDatabase });
  try {
    if (!seedOnly) {
      const result = await migrateDatabase(conn);
      console.log(
        `Migrations complete. Applied: ${result.applied.length}, skipped: ${result.skipped.length}.`,
      );
    }

    if (shouldSeed || shouldSeedIfEmpty) {
      const seedResult = await seedDatabase(conn, { ifEmpty: shouldSeedIfEmpty && !shouldSeed });
      console.log(seedResult.seeded ? "Sample data seeded." : "Database already populated; skipped seeding.");
    }
  } finally {
    await conn.end();
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  runCli().catch((err) => {
    console.error("Database migration failed:", err.message);
    process.exit(1);
  });
}
