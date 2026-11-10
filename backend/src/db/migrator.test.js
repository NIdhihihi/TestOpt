import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  DEFAULT_DATABASE_DIR,
  computeSqlChecksum,
  migrateDatabase,
  seedDatabase,
  splitSqlStatements,
} from "./migrator.js";

test("splitSqlStatements respects quoted strings and SQL comments", () => {
  const sql = `
    -- ignore ; in comment
    CREATE TABLE a (id INT PRIMARY KEY);
    # ignore ; in hash comment
    INSERT INTO a VALUES ('hello; world'); /* block; comment */
    UPDATE a SET id = 2 WHERE id = 1;
  `;
  const statements = splitSqlStatements(sql);
  assert.equal(statements.length, 3);
  assert.match(statements[0], /^CREATE TABLE a/);
  assert.match(statements[1], /'hello; world'/);
  assert.match(statements[2], /^UPDATE a/);
});

test("computeSqlChecksum normalizes CRLF and LF identically", () => {
  assert.equal(
    computeSqlChecksum("CREATE TABLE a (x INT);\r\nCREATE TABLE b (y INT);\r\n"),
    computeSqlChecksum("CREATE TABLE a (x INT);\nCREATE TABLE b (y INT);\n"),
  );
});

test("repository SQL files stay DB-name agnostic and MySQL 8.4 compatible", async () => {
  const files = [
    path.join(DEFAULT_DATABASE_DIR, "schema.sql"),
    path.join(DEFAULT_DATABASE_DIR, "seed.sql"),
  ];
  const migrationsDir = path.join(DEFAULT_DATABASE_DIR, "migrations");
  for (const name of await fs.readdir(migrationsDir)) {
    if (name.endsWith(".sql")) files.push(path.join(migrationsDir, name));
  }

  for (const filePath of files) {
    const sql = await fs.readFile(filePath, "utf8");
    assert.doesNotMatch(sql, /\bUSE\s+testopt\b/i, `${filePath} must not hardcode USE testopt`);
    assert.doesNotMatch(sql, /\bCREATE\s+DATABASE\b/i, `${filePath} must not hardcode CREATE DATABASE`);
    assert.doesNotMatch(sql, /\bADD\s+COLUMN\s+IF\s+NOT\s+EXISTS\b/i, `${filePath} uses MariaDB-only IF NOT EXISTS syntax`);
  }
});

test("migrateDatabase records baseline, skips applied migrations, and enforces checksums", async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "testopt-migrator-"));
  const migrationsDir = path.join(tmpDir, "migrations");
  await fs.mkdir(migrationsDir, { recursive: true });
  await fs.writeFile(path.join(tmpDir, "schema.sql"), "CREATE TABLE projects (id INT PRIMARY KEY);");
  await fs.writeFile(path.join(tmpDir, "seed.sql"), "INSERT INTO projects VALUES (1);");
  await fs.writeFile(path.join(migrationsDir, "001_add_worker_count.sql"), "ALTER TABLE projects ADD COLUMN w INT;");
  await fs.writeFile(path.join(migrationsDir, "012_extra.sql"), "CREATE TABLE extra (id INT PRIMARY KEY);");

  const executed = [];
  let tables = [];
  const recorded = new Map();
  let projectCount = 0;

  const fakeConn = {
    async query(sql, params = []) {
      const normalized = sql.trim();
      if (normalized.startsWith("SELECT TABLE_NAME")) {
        return [tables.map((tableName) => ({ tableName }))];
      }
      if (normalized.startsWith("SELECT filename, checksum FROM schema_migrations")) {
        return [[...recorded.entries()].map(([filename, checksum]) => ({ filename, checksum }))];
      }
      if (normalized.startsWith("INSERT INTO schema_migrations")) {
        recorded.set(params[0], params[1]);
        return [{}];
      }
      if (normalized.startsWith("SELECT COUNT(*) AS count FROM projects")) {
        return [[{ count: projectCount }]];
      }
      executed.push(normalized);
      if (normalized.includes("CREATE TABLE projects")) tables.push("projects");
      if (normalized.includes("CREATE TABLE IF NOT EXISTS schema_migrations")) tables.push("schema_migrations");
      if (normalized.includes("INSERT INTO projects")) projectCount += 1;
      return [{}];
    },
  };

  try {
    const first = await migrateDatabase(fakeConn, { databaseDir: tmpDir });
    assert.deepEqual(first.applied, ["001_add_worker_count.sql", "012_extra.sql"]);
    assert.ok(executed.some((stmt) => stmt.includes("CREATE TABLE projects")));
    assert.ok(executed.some((stmt) => stmt.includes("CREATE TABLE extra")));

    const countAfterFirst = executed.length;
    const second = await migrateDatabase(fakeConn, { databaseDir: tmpDir });
    assert.equal(second.applied.length, 0);
    assert.deepEqual(second.skipped, ["001_add_worker_count.sql", "012_extra.sql"]);
    assert.equal(executed.length, countAfterFirst);

    const seed1 = await seedDatabase(fakeConn, { databaseDir: tmpDir, ifEmpty: true });
    assert.equal(seed1.seeded, true);
    const seed2 = await seedDatabase(fakeConn, { databaseDir: tmpDir, ifEmpty: true });
    assert.equal(seed2.seeded, false);

    await fs.writeFile(path.join(migrationsDir, "012_extra.sql"), "CREATE TABLE extra_tampered (id INT);");
    await assert.rejects(
      migrateDatabase(fakeConn, { databaseDir: tmpDir }),
      /Migration checksum mismatch for 012_extra\.sql/,
    );
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

