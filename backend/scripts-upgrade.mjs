import fs from 'node:fs/promises';
import pool from './src/db/connection.js';

try {
  const [columns] = await pool.query("SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'projects' AND COLUMN_NAME = 'archived_at'");
  if (!columns.length) await pool.query('ALTER TABLE projects ADD COLUMN archived_at DATETIME NULL');
  const sql = await fs.readFile(new URL('../database/migrations/010_source_workflow.sql', import.meta.url), 'utf8');
  for (const statement of sql.split(';').map(item => item.trim()).filter(Boolean)) await pool.query(statement);
  console.log('Archive and source-workflow schema ready. Existing data was retained.');
} finally { await pool.end(); }
