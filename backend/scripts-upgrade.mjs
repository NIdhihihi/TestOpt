import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { migrateDatabase, openMigratorConnection, seedDatabase } from './src/db/migrator.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
dotenv.config({ path: path.join(root, '.env') });

const args = new Set(process.argv.slice(2));
const conn = await openMigratorConnection({ createDatabase: true });

try {
  const { applied, skipped } = await migrateDatabase(conn);
  console.log(`Schema up to date. Applied: ${applied.length}, skipped: ${skipped.length}. Existing data was retained.`);
  if (args.has('--seed') || args.has('--seed-if-empty')) {
    const result = await seedDatabase(conn, { ifEmpty: args.has('--seed-if-empty') && !args.has('--seed') });
    console.log(result.seeded ? 'Sample data seeded.' : 'Sample data already exists; skipped seeding.');
  }
} finally {
  await conn.end();
}
