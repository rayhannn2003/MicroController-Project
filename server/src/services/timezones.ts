import type { Sql } from '../db/client.js';
import { AppError } from '../lib/errors.js';

export interface TimezoneResolver {
  /** Returns `requested` when Postgres knows it, the default when null, or throws 400. */
  resolve(requested: string | null): Promise<string>;
}

export function createTimezoneResolver(sql: Sql, defaultTimezone: string): TimezoneResolver {
  // pg_timezone_names reads the tz database from disk, so load it once per process.
  let names: Promise<Set<string>> | null = null;

  const load = () => {
    names ??= sql<{ name: string }[]>`SELECT name FROM pg_timezone_names`.then(
      (rows) => new Set(rows.map((row) => row.name)),
      (error: unknown) => {
        names = null;
        throw error;
      },
    );
    return names;
  };

  return {
    async resolve(requested) {
      if (requested === null) return defaultTimezone;
      if ((await load()).has(requested)) return requested;
      throw new AppError(400, 'INVALID_TIMEZONE', `Unknown timezone: ${requested}`);
    },
  };
}
