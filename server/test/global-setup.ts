import postgres from 'postgres';
import { runMigrations } from '../src/db/migrate.js';
import { adminDatabaseUrl, testDatabaseUrl } from './database.js';

/** Recreates the test database from scratch once per test run. */
export default async function setup() {
  const url = testDatabaseUrl();
  const name = new URL(url).pathname.slice(1);

  const admin = postgres(adminDatabaseUrl(url), { max: 1, onnotice: () => undefined });
  try {
    await admin`DROP DATABASE IF EXISTS ${admin(name)} WITH (FORCE)`;
    await admin`CREATE DATABASE ${admin(name)}`;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Could not prepare the test database (${message}). Is it running? Try \`npm run db:up\`.`,
      { cause: error },
    );
  } finally {
    await admin.end();
  }

  const sql = postgres(url, { max: 1, onnotice: () => undefined });
  try {
    await runMigrations(sql);
  } finally {
    await sql.end();
  }
}
