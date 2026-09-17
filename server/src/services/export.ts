import type { Sql } from '../db/client.js';
import { csvCell, csvRow } from '../lib/csv.js';
import type { ExportQuery } from '../lib/validation.js';
import { sampleFilters } from './samples.js';
import type { TimezoneResolver } from './timezones.js';

export const EXPORT_MAX_ROWS = 50_000;
const BATCH_SIZE = 1_000;

export const EXPORT_COLUMNS = [
  'id',
  'created_at_utc',
  'created_at_local',
  'status',
  'temperature_c',
  'humidity_pct',
  'light_lux',
  'photo_url',
];

interface ExportRow {
  id: string;
  cursor_ts: string;
  utc: string;
  local: string;
  ok: boolean;
  temperature: string | null;
  humidity: string | null;
  lux: number | null;
  photo_key: string | null;
}

export interface ExportService {
  /** Validates the timezone up front so errors become a normal 400 before streaming. */
  prepare(query: ExportQuery): Promise<{ tz: string; rows: () => AsyncGenerator<string> }>;
}

export function createExportService(deps: {
  sql: Sql;
  timezones: TimezoneResolver;
  publicBaseUrl: string;
}): ExportService {
  const { sql, timezones, publicBaseUrl } = deps;

  return {
    async prepare(query) {
      const tz = await timezones.resolve(query.tz);

      async function* rows(): AsyncGenerator<string> {
        yield `\uFEFF${csvRow(EXPORT_COLUMNS)}`;

        let cursor: { ts: string; id: string } | null = null;
        let written = 0;
        // Keyset batches release the pool connection between queries, so a slow download
        // never pins a database connection.
        for (;;) {
          const batch: ExportRow[] = await sql<ExportRow[]>`
            SELECT id,
                   to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS cursor_ts,
                   to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS utc,
                   to_char(created_at AT TIME ZONE ${tz}, 'YYYY-MM-DD HH24:MI:SS') AS local,
                   ok, temperature, humidity, lux, photo_key
            FROM samples
            WHERE TRUE
              ${sampleFilters(sql, query)}
              ${cursor ? sql`AND (created_at, id) < (${cursor.ts}::timestamptz, ${cursor.id}::bigint)` : sql``}
            ORDER BY created_at DESC, id DESC
            LIMIT ${BATCH_SIZE}
          `;

          let chunk = '';
          for (const row of batch) {
            if (written === EXPORT_MAX_ROWS) {
              yield chunk;
              yield `# Export truncated at ${EXPORT_MAX_ROWS} rows. Narrow the date range to export older samples.\r\n`;
              return;
            }
            chunk += csvRow([
              csvCell(row.id, { numeric: true }),
              csvCell(row.utc),
              csvCell(row.local),
              csvCell(row.ok ? 'ok' : 'failed'),
              csvCell(row.temperature, { numeric: true }),
              csvCell(row.humidity, { numeric: true }),
              csvCell(row.lux, { numeric: true }),
              csvCell(row.photo_key === null ? null : `${publicBaseUrl}/photos/${row.photo_key}`),
            ]);
            written++;
          }
          if (chunk) yield chunk;

          const last = batch.at(-1);
          if (!last || batch.length < BATCH_SIZE) return;
          cursor = { ts: last.cursor_ts, id: last.id };
        }
      }

      return { tz, rows };
    },
  };
}
