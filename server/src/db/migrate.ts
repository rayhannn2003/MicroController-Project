import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type { Sql } from './client.js';

const MIGRATIONS_DIR = fileURLToPath(new URL('./migrations/', import.meta.url));
const MIGRATION_FILE = /^(\d{3})_[a-z0-9_]+\.sql$/;
// Arbitrary constant shared by every migration runner so only one applies migrations at a time.
const LOCK_ID = 51_774_140;

type Log = (message: string) => void;

/** Applies pending numbered SQL migrations in order, each in its own transaction. */
export async function runMigrations(sql: Sql, log: Log = () => undefined, dir = MIGRATIONS_DIR) {
  await sql`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version    TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `;

  const files = (await readdir(dir)).filter((name) => MIGRATION_FILE.test(name)).sort();
  const applied: string[] = [];

  for (const file of files) {
    const content = await readFile(path.join(dir, file), 'utf8');
    const didApply = await sql.begin(async (tx) => {
      await tx`SELECT pg_advisory_xact_lock(${LOCK_ID})`;
      // Checked after taking the lock so a concurrent runner cannot apply the same file twice.
      const [existing] = await tx`SELECT 1 FROM schema_migrations WHERE version = ${file}`;
      if (existing) return false;
      await tx.unsafe(content);
      await tx`INSERT INTO schema_migrations (version) VALUES (${file})`;
      return true;
    });
    if (didApply) {
      applied.push(file);
      log(`applied ${file}`);
    }
  }

  if (applied.length === 0) log('database is up to date');
  return applied;
}

async function main() {
  const { loadConfig, loadEnvFiles } = await import('../config.js');
  const { createSql } = await import('./client.js');
  loadEnvFiles();
  const config = loadConfig();
  const sql = createSql(config.databaseUrl, { max: 1 });
  try {
    await runMigrations(sql, (message) => {
      console.log(`[migrate] ${message}`);
    });
  } finally {
    await sql.end({ timeout: 5 });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[migrate] failed: ${message}`);
    process.exit(1);
  });
}
