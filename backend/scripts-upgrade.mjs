import fs from 'node:fs/promises';
import pool from './src/db/connection.js';

try {
  const [columns] = await pool.query("SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'projects' AND COLUMN_NAME = 'archived_at'");
  if (!columns.length) await pool.query('ALTER TABLE projects ADD COLUMN archived_at DATETIME NULL');
  const sql = await fs.readFile(new URL('../database/migrations/010_source_workflow.sql', import.meta.url), 'utf8');
  for (const statement of sql.split(';').map(item => item.trim()).filter(Boolean)) await pool.query(statement);

  const [userCols] = await pool.query("SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users' AND COLUMN_NAME = 'email_verified'");
  if (!userCols.length) {
    await pool.query("ALTER TABLE users ADD COLUMN email_verified BOOLEAN NOT NULL DEFAULT FALSE, ADD COLUMN auth_provider ENUM('LOCAL', 'GOOGLE', 'GITHUB') NOT NULL DEFAULT 'LOCAL', ADD COLUMN auth_provider_id VARCHAR(255) NULL, MODIFY COLUMN password_hash VARCHAR(255) NULL");
  }
  await pool.query(`
    CREATE TABLE IF NOT EXISTS email_verification_codes (
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

  console.log('Archive, source-workflow, and email/OAuth authentication schema ready. Existing data was retained.');
} finally { await pool.end(); }
