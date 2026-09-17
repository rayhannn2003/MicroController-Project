import type { Sample, SampleListResponse, UploadResponse } from '@sylvan/shared';
import type { Sql } from '../db/client.js';
import { encodeCursor, type ListQuery, type Readings } from '../lib/validation.js';
import type { PhotoStorage, StoredPhoto } from './photoStorage.js';

interface SampleRow {
  id: string;
  created_at: Date;
  cursor_ts: string;
  ok: boolean;
  temperature: string | null;
  humidity: string | null;
  lux: number | null;
  photo_key: string | null;
  photo_bytes: number | null;
}

export interface CreateSampleInput {
  readings: Readings | null;
  uploadId: string | null;
  photo: Buffer | null;
}

export interface CreateSampleResult {
  /** False when a sample with the same upload id already existed. */
  created: boolean;
  response: UploadResponse;
}

export interface SamplesService {
  findUpload(uploadId: string): Promise<UploadResponse | null>;
  create(input: CreateSampleInput): Promise<CreateSampleResult>;
  list(query: ListQuery): Promise<SampleListResponse>;
  get(id: string): Promise<Sample | null>;
}

const toNumber = (value: string | null) => (value === null ? null : Number(value));

function toSample(row: SampleRow): Sample {
  return {
    id: Number(row.id),
    createdAt: row.created_at.toISOString(),
    ok: row.ok,
    temperature: toNumber(row.temperature),
    humidity: toNumber(row.humidity),
    lux: row.lux,
    photoUrl: row.photo_key === null ? null : `/photos/${row.photo_key}`,
    photoBytes: row.photo_bytes,
  };
}

export function createSamplesService(deps: {
  sql: Sql;
  storage: PhotoStorage;
  onCleanupError?: (error: unknown, key: string) => void;
}): SamplesService {
  const { sql, storage } = deps;

  const selectColumns = () => sql`
    id, created_at, ok, temperature, humidity, lux, photo_key, photo_bytes,
    to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS cursor_ts
  `;

  async function findUpload(uploadId: string): Promise<UploadResponse | null> {
    const [row] = await sql<{ id: string; photo_key: string | null }[]>`
      SELECT id, photo_key FROM samples WHERE upload_id = ${uploadId}
    `;
    return row ? { id: Number(row.id), photo: row.photo_key !== null } : null;
  }

  async function discardPhoto(photo: StoredPhoto | null) {
    if (!photo) return;
    try {
      await storage.remove(photo.key);
    } catch (error) {
      deps.onCleanupError?.(error, photo.key);
    }
  }

  return {
    findUpload,

    async create({ readings, uploadId, photo }) {
      const stored = photo ? await storage.save(photo) : null;

      let inserted: { id: string }[];
      try {
        inserted = await sql<{ id: string }[]>`
          INSERT INTO samples (upload_id, ok, temperature, humidity, lux, photo_key, photo_bytes)
          VALUES (
            ${uploadId}, ${readings !== null},
            ${readings?.temperature ?? null}, ${readings?.humidity ?? null}, ${readings?.lux ?? null},
            ${stored?.key ?? null}, ${stored?.bytes ?? null}
          )
          ON CONFLICT (upload_id) DO NOTHING
          RETURNING id
        `;
      } catch (error) {
        await discardPhoto(stored);
        throw error;
      }

      const [row] = inserted;
      if (row) {
        return { created: true, response: { id: Number(row.id), photo: stored !== null } };
      }

      // Lost a race with a concurrent request carrying the same upload id.
      await discardPhoto(stored);
      const existing = uploadId === null ? null : await findUpload(uploadId);
      if (!existing) throw new Error('Upload id conflicted but no existing sample was found');
      return { created: false, response: existing };
    },

    async list({ limit, cursor, status, from, to }) {
      const rows = await sql<SampleRow[]>`
        SELECT ${selectColumns()}
        FROM samples
        WHERE TRUE
          ${status === 'ok' ? sql`AND ok` : status === 'failed' ? sql`AND NOT ok` : sql``}
          ${from ? sql`AND created_at >= ${from}` : sql``}
          ${to ? (to.exclusive ? sql`AND created_at < ${to.date}` : sql`AND created_at <= ${to.date}`) : sql``}
          ${cursor ? sql`AND (created_at, id) < (${cursor.createdAt}::timestamptz, ${cursor.id}::bigint)` : sql``}
        ORDER BY created_at DESC, id DESC
        LIMIT ${limit + 1}
      `;

      const page = rows.slice(0, limit);
      const last = page.at(-1);
      return {
        items: page.map(toSample),
        nextCursor:
          rows.length > limit && last
            ? encodeCursor({ createdAt: last.cursor_ts, id: last.id })
            : null,
      };
    },

    async get(id) {
      const [row] = await sql<
        SampleRow[]
      >`SELECT ${selectColumns()} FROM samples WHERE id = ${id}::bigint`;
      return row ? toSample(row) : null;
    },
  };
}
