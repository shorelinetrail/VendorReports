// Creates the database if it doesn't exist, then applies any migrations/*.sql
// not yet recorded in schema_migrations, each inside a transaction.
// Usage: npm run db:migrate  (connection via DATABASE_URL, see src/env.ts)
import { Client } from 'pg';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { DATABASE_URL } from '../src/env';

const MIGRATIONS_DIR = join(import.meta.dirname, '..', 'migrations');

async function ensureDatabase() {
  const url = new URL(DATABASE_URL);
  const dbName = decodeURIComponent(url.pathname.slice(1));
  const admin = new URL(DATABASE_URL);
  admin.pathname = '/postgres';
  const client = new Client({ connectionString: admin.toString() });
  await client.connect();
  try {
    const { rows } = await client.query('SELECT 1 FROM pg_database WHERE datname = $1', [dbName]);
    if (rows.length === 0) {
      await client.query(`CREATE DATABASE "${dbName.replace(/"/g, '""')}"`);
      console.log(`Created database ${dbName}`);
    }
  } finally {
    await client.end();
  }
}

async function migrate() {
  const client = new Client({ connectionString: DATABASE_URL });
  await client.connect();
  try {
    await client.query(
      'CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY, applied_at TEXT NOT NULL)');
    const applied = new Set(
      (await client.query('SELECT name FROM schema_migrations')).rows.map((r) => r.name));
    const files = (await readdir(MIGRATIONS_DIR)).filter((f) => f.endsWith('.sql')).sort();
    let ran = 0;
    for (const file of files) {
      if (applied.has(file)) continue;
      const sql = await readFile(join(MIGRATIONS_DIR, file), 'utf8');
      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query('INSERT INTO schema_migrations (name, applied_at) VALUES ($1, $2)',
          [file, new Date().toISOString()]);
        await client.query('COMMIT');
      } catch (err) {
        await client.query('ROLLBACK');
        throw new Error(`Migration ${file} failed: ${err instanceof Error ? err.message : err}`);
      }
      console.log(`Applied ${file}`);
      ran++;
    }
    console.log(ran ? `${ran} migration(s) applied.` : 'Database is up to date.');
  } finally {
    await client.end();
  }
}

await ensureDatabase();
await migrate();
