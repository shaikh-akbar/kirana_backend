/**
 * Minimal forward-only migration runner.
 *
 *   node scripts/migrate.js            # apply every pending migration
 *   node scripts/migrate.js --status   # list applied / pending, apply nothing
 *
 * Each *.sql file in ../migrations is applied once, in filename order, and
 * recorded in `schema_migrations`. Statements inside a file run on a single
 * connection with multipleStatements enabled — MySQL DDL is not
 * transactional, so a file that fails half-way leaves the earlier statements
 * applied and is NOT recorded; fix the SQL and make the file re-runnable
 * before retrying.
 */
require('dotenv').config();

const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');

const MIGRATIONS_DIR = path.join(__dirname, '..', 'migrations');

async function main() {
  const statusOnly = process.argv.includes('--status');

  const connection = await mysql.createConnection({
    host: process.env.DB_HOST || '127.0.0.1',
    port: Number(process.env.DB_PORT) || 3306,
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'kirana_erp',
    multipleStatements: true,
  });

  await connection.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      filename    VARCHAR(255) NOT NULL,
      applied_at  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (filename)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  const [appliedRows] = await connection.query('SELECT filename FROM schema_migrations');
  const applied = new Set(appliedRows.map((r) => r.filename));

  const files = fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort();

  const pending = files.filter((f) => !applied.has(f));

  if (statusOnly) {
    for (const f of files) console.log(`${applied.has(f) ? '[applied]' : '[pending]'} ${f}`);
    await connection.end();
    return;
  }

  if (pending.length === 0) {
    console.log('Nothing to apply — database is up to date.');
    await connection.end();
    return;
  }

  for (const file of pending) {
    const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8');
    process.stdout.write(`Applying ${file} ... `);
    try {
      await connection.query(sql);
      await connection.query('INSERT INTO schema_migrations (filename) VALUES (?)', [file]);
      console.log('ok');
    } catch (err) {
      console.log('FAILED');
      console.error(`  ${err.code}: ${err.sqlMessage || err.message}`);
      await connection.end();
      process.exit(1);
    }
  }

  await connection.end();
  console.log(`Applied ${pending.length} migration(s).`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
