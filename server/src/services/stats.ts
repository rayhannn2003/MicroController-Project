import type { DailyStats, MetricSummary, StatsResponse } from '@sylvan/shared';
import type { Sql } from '../db/client.js';
import type { StatsQuery } from '../lib/validation.js';
import { sampleFilters, type SamplesService } from './samples.js';
import type { TimezoneResolver } from './timezones.js';

const MAX_DAILY_BUCKETS = 366;

type Numeric = string | null;

interface TotalsRow {
  samples: number;
  ok: number;
  with_photo: number;
  t_min: Numeric;
  t_avg: Numeric;
  t_max: Numeric;
  t_count: number;
  h_min: Numeric;
  h_avg: Numeric;
  h_max: Numeric;
  h_count: number;
  l_min: number | null;
  l_avg: Numeric;
  l_max: number | null;
  l_count: number;
  prev_samples: number;
  prev_ok: number;
  prev_t_avg: Numeric;
  prev_h_avg: Numeric;
  prev_l_avg: Numeric;
}

interface DailyRow {
  date: string;
  samples: number;
  ok: number;
  avg_t: Numeric;
  avg_h: Numeric;
  avg_l: Numeric;
  truncated: boolean;
}

const num = (value: string | number | null) => (value === null ? null : Number(value));

const successRate = (ok: number, samples: number) =>
  samples === 0 ? null : Math.round((ok / samples) * 10_000) / 10_000;

function summary(min: Numeric | number, avg: Numeric, max: Numeric | number, count: number) {
  return { min: num(min), avg: num(avg), max: num(max), count } satisfies MetricSummary;
}

export interface StatsService {
  get(query: StatsQuery): Promise<StatsResponse>;
}

export function createStatsService(deps: {
  sql: Sql;
  samples: SamplesService;
  timezones: TimezoneResolver;
  now?: () => Date;
}): StatsService {
  const { sql, samples, timezones } = deps;
  const now = deps.now ?? (() => new Date());

  return {
    async get({ from, to, tz: requestedTz }) {
      const tz = await timezones.resolve(requestedTz);
      const range = { from, to };

      // The previous period has the same length and ends where this range starts.
      let previousFrom: Date | null = null;
      if (from) {
        const end = to?.date ?? now();
        previousFrom = new Date(from.getTime() - Math.max(0, end.getTime() - from.getTime()));
      }

      // One index range scan covers both periods; FILTER splits the aggregates.
      const current = from ? sql`created_at >= ${from}` : sql`TRUE`;
      const previous = previousFrom ? sql`created_at < ${from}` : sql`FALSE`;
      const lowerBound = previousFrom ?? from;
      const totalsQuery = sql<TotalsRow[]>`
        WITH s AS (
          SELECT ok, temperature, humidity, lux, photo_key,
                 ${current} AS cur, ${previous} AS prev
          FROM samples
          WHERE TRUE
            ${sampleFilters(sql, { from: lowerBound, to })}
        )
        SELECT
          count(*) FILTER (WHERE cur)::int AS samples,
          count(*) FILTER (WHERE cur AND ok)::int AS ok,
          count(*) FILTER (WHERE cur AND photo_key IS NOT NULL)::int AS with_photo,
          min(temperature) FILTER (WHERE cur) AS t_min,
          round(avg(temperature) FILTER (WHERE cur), 1) AS t_avg,
          max(temperature) FILTER (WHERE cur) AS t_max,
          count(temperature) FILTER (WHERE cur)::int AS t_count,
          min(humidity) FILTER (WHERE cur) AS h_min,
          round(avg(humidity) FILTER (WHERE cur), 1) AS h_avg,
          max(humidity) FILTER (WHERE cur) AS h_max,
          count(humidity) FILTER (WHERE cur)::int AS h_count,
          min(lux) FILTER (WHERE cur) AS l_min,
          round(avg(lux) FILTER (WHERE cur)) AS l_avg,
          max(lux) FILTER (WHERE cur) AS l_max,
          count(lux) FILTER (WHERE cur)::int AS l_count,
          count(*) FILTER (WHERE prev)::int AS prev_samples,
          count(*) FILTER (WHERE prev AND ok)::int AS prev_ok,
          round(avg(temperature) FILTER (WHERE prev), 1) AS prev_t_avg,
          round(avg(humidity) FILTER (WHERE prev), 1) AS prev_h_avg,
          round(avg(lux) FILTER (WHERE prev)) AS prev_l_avg
        FROM s
      `;

      // For an exclusive `to` (a plain date), the last day in range is the one before it.
      const lastInstant = to ? new Date(to.date.getTime() - (to.exclusive ? 1 : 0)) : null;
      const dailyQuery = sql<DailyRow[]>`
        WITH bounds AS (
          SELECT
            COALESCE(
              (${from}::timestamptz AT TIME ZONE ${tz})::date,
              (SELECT (min(created_at) AT TIME ZONE ${tz})::date
                 FROM samples WHERE TRUE ${sampleFilters(sql, range)})
            ) AS first_day,
            (COALESCE(${lastInstant}::timestamptz, ${now()}::timestamptz) AT TIME ZONE ${tz})::date
              AS last_day
        ),
        capped AS (
          -- GREATEST ignores NULL, so keep "no first day" (no samples) as NULL explicitly.
          SELECT CASE WHEN first_day IS NULL THEN NULL
                      ELSE GREATEST(first_day, last_day - ${MAX_DAILY_BUCKETS - 1}::int) END AS first_day,
                 last_day,
                 COALESCE(last_day - first_day + 1 > ${MAX_DAILY_BUCKETS}, FALSE) AS truncated
          FROM bounds
        ),
        days AS (
          SELECT day::date AS day
          FROM capped, generate_series(capped.first_day, capped.last_day, interval '1 day') AS day
        ),
        agg AS (
          SELECT (created_at AT TIME ZONE ${tz})::date AS day,
                 count(*)::int AS samples,
                 count(*) FILTER (WHERE ok)::int AS ok,
                 round(avg(temperature), 1) AS avg_t,
                 round(avg(humidity), 1) AS avg_h,
                 round(avg(lux)) AS avg_l
          FROM samples, capped
          WHERE created_at >= (capped.first_day::timestamp AT TIME ZONE ${tz})
            ${sampleFilters(sql, range)}
          GROUP BY 1
        )
        SELECT to_char(days.day, 'YYYY-MM-DD') AS date,
               COALESCE(agg.samples, 0) AS samples,
               COALESCE(agg.ok, 0) AS ok,
               agg.avg_t, agg.avg_h, agg.avg_l,
               (SELECT truncated FROM capped) AS truncated
        FROM days LEFT JOIN agg USING (day)
        ORDER BY days.day
      `;

      const [[totals], latestPage, [last], dailyRows] = await Promise.all([
        totalsQuery,
        samples.list({
          limit: 1,
          cursor: null,
          status: 'all',
          hasPhoto: null,
          order: 'desc',
          ...range,
        }),
        sql<{ last_upload_at: Date | null }[]>`
          SELECT max(created_at) AS last_upload_at FROM samples
        `,
        dailyQuery,
      ]);
      if (!totals) throw new Error('Stats query returned no row');

      const daily: DailyStats[] = dailyRows.map((row) => ({
        date: row.date,
        samples: row.samples,
        ok: row.ok,
        failed: row.samples - row.ok,
        avgTemperature: num(row.avg_t),
        avgHumidity: num(row.avg_h),
        avgLux: num(row.avg_l),
      }));

      return {
        range: {
          from: from?.toISOString() ?? null,
          to: to?.date.toISOString() ?? null,
          tz,
        },
        totals: {
          samples: totals.samples,
          ok: totals.ok,
          failed: totals.samples - totals.ok,
          successRate: successRate(totals.ok, totals.samples),
          withPhoto: totals.with_photo,
        },
        metrics: {
          temperature: summary(totals.t_min, totals.t_avg, totals.t_max, totals.t_count),
          humidity: summary(totals.h_min, totals.h_avg, totals.h_max, totals.h_count),
          lux: summary(totals.l_min, totals.l_avg, totals.l_max, totals.l_count),
        },
        previousPeriod: previousFrom
          ? {
              totals: {
                samples: totals.prev_samples,
                ok: totals.prev_ok,
                failed: totals.prev_samples - totals.prev_ok,
                successRate: successRate(totals.prev_ok, totals.prev_samples),
              },
              metrics: {
                temperature: { avg: num(totals.prev_t_avg) },
                humidity: { avg: num(totals.prev_h_avg) },
                lux: { avg: num(totals.prev_l_avg) },
              },
            }
          : null,
        latest: latestPage.items[0] ?? null,
        lastUploadAt: last?.last_upload_at?.toISOString() ?? null,
        daily,
        dailyTruncated: dailyRows[0]?.truncated ?? false,
      };
    },
  };
}
