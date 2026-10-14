import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { db } from '../src/core/database/mysql.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = path.join(__dirname, '../src/core/database/migrations');

async function migrate() {
  await db.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      name VARCHAR(255) PRIMARY KEY,
      applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  const [appliedRows] = await db.query('SELECT name FROM schema_migrations');
  const applied = new Set(appliedRows.map(r => r.name));

  const files = fs.readdirSync(MIGRATIONS_DIR).filter(f => f.endsWith('.sql')).sort();

  for (const file of files) {
    if (applied.has(file)) {
      console.log(`- skip   ${file} (already applied)`);
      continue;
    }

    const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8');
    const statements = sql
      .split(/;\s*(?:\r?\n|$)/)
      .map(s => s.replace(/^\s*--.*$/gm, '').trim())
      .filter(Boolean);

    console.log(`- apply  ${file} (${statements.length} statements)`);
    for (const stmt of statements) {
      await db.query(stmt);
    }
    await db.query('INSERT INTO schema_migrations (name) VALUES (?)', [file]);
  }

  const [tables] = await db.query('SHOW TABLES');
  console.log('\nTables:', tables.map(t => Object.values(t)[0]).join(', '));
}

migrate()
  .catch(err => {
    console.error('Migration failed:', err.code || '', err.message);
    process.exitCode = 1;
  })
  .finally(() => db.end());
