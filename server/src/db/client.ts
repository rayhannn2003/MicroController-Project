import postgres from 'postgres';

export type Sql = postgres.Sql;

export function createSql(databaseUrl: string, options: { max?: number } = {}): Sql {
  return postgres(databaseUrl, {
    // One CPU core on the VPS: a small pool is plenty and keeps Postgres memory low.
    max: options.max ?? 5,
    idle_timeout: 30,
    connect_timeout: 5,
    connection: { TimeZone: 'UTC', application_name: 'sylvan-server' },
    onnotice: () => undefined,
  });
}

/** Resolves true when the database answers `SELECT 1` within the timeout. */
export async function pingDatabase(sql: Sql, timeoutMs = 2000): Promise<boolean> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<false>((resolve) => {
    timer = setTimeout(() => {
      resolve(false);
    }, timeoutMs);
  });
  try {
    const query = sql`SELECT 1`.then(
      () => true,
      () => false,
    );
    return await Promise.race([query, timeout]);
  } finally {
    clearTimeout(timer);
  }
}
