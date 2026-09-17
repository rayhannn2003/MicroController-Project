import { loadEnvFiles } from '../src/config.js';

/**
 * The test database URL: TEST_DATABASE_URL, or DATABASE_URL with the database renamed to
 * `sylvan_test`. Refuses anything not ending in `_test` because the suite drops it.
 */
export function testDatabaseUrl(): string {
  loadEnvFiles();
  const explicit = process.env.TEST_DATABASE_URL;
  const base = explicit ?? process.env.DATABASE_URL;
  if (!base) {
    throw new Error('Set TEST_DATABASE_URL or DATABASE_URL (see .env.example) to run the tests');
  }
  const url = new URL(base);
  if (!explicit) url.pathname = '/sylvan_test';
  if (!url.pathname.endsWith('_test')) {
    throw new Error('Refusing to run tests against a database whose name does not end in _test');
  }
  return url.toString();
}

export function adminDatabaseUrl(testUrl: string): string {
  const url = new URL(testUrl);
  url.pathname = '/postgres';
  return url.toString();
}
