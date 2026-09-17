import type { DeviceEvent, DeviceEventType } from '@sylvan/shared';
import type { Sql } from '../db/client.js';

export type DeviceEventDetail = NonNullable<DeviceEvent['detail']> & { lastSeenAt?: string };

interface EventRow {
  id: string;
  created_at: Date;
  type: DeviceEventType;
  detail: DeviceEventDetail | null;
}

export interface DeviceEventStore {
  /** Records an event without blocking the caller; failures are logged, never thrown. */
  record(type: DeviceEventType, detail?: DeviceEventDetail): void;
  recent(limit: number): Promise<DeviceEvent[]>;
  /** Last known contact time and boot id, rebuilt from events and samples after a restart. */
  restore(): Promise<{ lastSeenAt: Date | null; bootId: string | null }>;
  /** Waits for in-flight writes (used during shutdown before the pool closes). */
  flush(): Promise<void>;
}

export function createDeviceEventStore(deps: {
  sql: Sql;
  onError: (error: unknown) => void;
  onDropped: (type: DeviceEventType) => void;
  maxPerMinute?: number;
  now?: () => number;
}): DeviceEventStore {
  const { sql } = deps;
  const maxPerMinute = deps.maxPerMinute ?? 60;
  const now = deps.now ?? Date.now;
  const recentWrites: number[] = [];
  const pending = new Set<Promise<unknown>>();

  return {
    record(type, detail) {
      // A flapping connection must not flood the table.
      const cutoff = now() - 60_000;
      while (recentWrites.length > 0 && (recentWrites[0] ?? 0) <= cutoff) recentWrites.shift();
      if (recentWrites.length >= maxPerMinute) {
        deps.onDropped(type);
        return;
      }
      recentWrites.push(now());

      const write = sql`
        INSERT INTO device_events (type, detail)
        VALUES (${type}, ${detail ? sql.json(detail) : null})
      `.then(
        () => undefined,
        (error: unknown) => {
          deps.onError(error);
        },
      );
      pending.add(write);
      void write.finally(() => pending.delete(write));
    },

    async recent(limit) {
      const rows = await sql<EventRow[]>`
        SELECT id, created_at, type, detail
        FROM device_events
        ORDER BY created_at DESC, id DESC
        LIMIT ${limit}
      `;
      return rows.map((row) => {
        // lastSeenAt is internal bookkeeping for restarts; the public detail omits it.
        const { lastSeenAt: _lastSeenAt, ...detail } = row.detail ?? {};
        return {
          id: Number(row.id),
          createdAt: row.created_at.toISOString(),
          type: row.type,
          detail: row.detail ? detail : null,
        };
      });
    },

    async restore() {
      const [row] = await sql<{ last_seen_at: Date | null; boot_id: string | null }[]>`
        SELECT
          GREATEST(
            (SELECT COALESCE((detail->>'lastSeenAt')::timestamptz, created_at)
               FROM device_events ORDER BY created_at DESC, id DESC LIMIT 1),
            (SELECT max(created_at) FROM samples)
          ) AS last_seen_at,
          (SELECT detail->>'bootId' FROM device_events
            WHERE type = 'boot' ORDER BY created_at DESC, id DESC LIMIT 1) AS boot_id
      `;
      return { lastSeenAt: row?.last_seen_at ?? null, bootId: row?.boot_id ?? null };
    },

    async flush() {
      await Promise.all([...pending]);
    },
  };
}
