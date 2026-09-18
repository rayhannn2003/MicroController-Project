import type { ExploreHourlyBucket, ExploreResponse, Histogram } from '@sylvan/shared';
import type { Sql } from '../db/client.js';
import { buildHistogram, constantHistogram, emptyHistogram, niceBounds } from '../lib/histogram.js';
import type { ExploreQuery } from '../lib/validation.js';
import { sampleFilters } from './samples.js';
import type { TimezoneResolver } from './timezones.js';

/** Decimal precision used to round histogram edges; matches the dashboard's display precision. */
const DECIMALS = { temperature: 1, humidity: 1, lux: 0 } as const;
const MAX_POINTS = 2000;
const round3 = (value: string | number | null) =>
  value === null ? null : Math.round(Number(value) * 1000) / 1000;
const round = (value: string | number | null, decimals: number) =>
  value === null ? null : Math.round(Number(value) * 10 ** decimals) / 10 ** decimals;
// NUMERIC(5,1) columns (temperature, humidity) come back from postgres.js as strings, to avoid
// float precision loss; lux is a plain INTEGER and already arrives as a number.
const num = (value: string | number | null) => (value === null ? null : Number(value));

interface SummaryRow {
  n: number;
  t_min: string | null;
  t_max: string | null;
  h_min: string | null;
  h_max: string | null;
  l_min: number | null;
  l_max: number | null;
  r_th: string | null;
  r_tl: string | null;
  r_hl: string | null;
}

interface HourlyRow {
  hour: number;
  count: number;
  avg_t: string | null;
  avg_h: string | null;
  avg_l: string | null;
}

interface PointRow {
  id: string;
  at: Date;
  temperature: string;
  humidity: string;
  lux: number;
}

interface BucketRow {
  bucket: number;
  count: number;
}

export interface ExploreService {
  get(query: ExploreQuery): Promise<ExploreResponse>;
}

export function createExploreService(deps: {
  sql: Sql;
  timezones: TimezoneResolver;
  /** Override for tests; the real server always uses the default MAX_POINTS. */
  maxPoints?: number;
}): ExploreService {
  const { sql, timezones } = deps;
  const maxPoints = deps.maxPoints ?? MAX_POINTS;

  /** One metric's histogram: constant/empty short-circuit, otherwise a `width_bucket` query. */
  async function histogramFor(
    metric: 'temperature' | 'humidity' | 'lux',
    min: number | null,
    max: number | null,
    n: number,
    bins: number,
    filters: ReturnType<typeof sampleFilters>,
  ): Promise<Histogram> {
    if (min === null || max === null || n === 0) return emptyHistogram();
    if (min === max) return constantHistogram(min, n);

    const bounds = niceBounds(min, max, DECIMALS[metric]);
    // width_bucket's upper edge is exclusive, so nudge it past the rounded max to include it.
    const upperForBucketing = bounds.max + 10 ** -(DECIMALS[metric] + 6);
    const column = sql(metric);
    const rows = await sql<BucketRow[]>`
      SELECT width_bucket(${column}, ${bounds.min}, ${upperForBucketing}, ${bins})::int AS bucket,
             count(*)::int AS count
      FROM samples
      WHERE TRUE ${filters}
      GROUP BY bucket
    `;
    const counts = new Map(rows.map((row) => [row.bucket, row.count]));
    return buildHistogram(bounds, bins, counts);
  }

  return {
    async get({ from, to, tz: requestedTz, bins }) {
      const tz = await timezones.resolve(requestedTz);
      const filters = sampleFilters(sql, { status: 'ok', from, to });

      const [summaryRows, hourlyRows, pointRows] = await Promise.all([
        sql<SummaryRow[]>`
          WITH ok_samples AS MATERIALIZED (
            SELECT temperature, humidity, lux FROM samples WHERE TRUE ${filters}
          )
          SELECT
            count(*)::int AS n,
            min(temperature) AS t_min, max(temperature) AS t_max,
            min(humidity) AS h_min, max(humidity) AS h_max,
            min(lux) AS l_min, max(lux) AS l_max,
            round(corr(temperature, humidity)::numeric, 3) AS r_th,
            round(corr(temperature, lux)::numeric, 3) AS r_tl,
            round(corr(humidity, lux)::numeric, 3) AS r_hl
          FROM ok_samples
        `,
        sql<HourlyRow[]>`
          SELECT extract(hour FROM created_at AT TIME ZONE ${tz})::int AS hour,
                 count(*)::int AS count,
                 round(avg(temperature), 1) AS avg_t,
                 round(avg(humidity), 1) AS avg_h,
                 round(avg(lux)) AS avg_l
          FROM samples
          WHERE TRUE ${filters}
          GROUP BY hour
        `,
        sql<PointRow[]>`
          WITH numbered AS MATERIALIZED (
            SELECT id, created_at AS at, temperature, humidity, lux,
                   row_number() OVER (ORDER BY created_at, id) AS rn,
                   count(*) OVER () AS total
            FROM samples
            WHERE TRUE ${filters}
          )
          SELECT id, at, temperature, humidity, lux
          FROM numbered
          WHERE total <= ${maxPoints}
             OR mod(rn - 1, GREATEST(1, ceil(total::numeric / ${maxPoints})::int)) = 0
             OR rn = total
          ORDER BY at, id
          -- +1: the stride above always lands on the first row (rn=1); the extra slot here
          -- guarantees the very last row is also kept, so the plotted range never falls short
          -- of the true range even when it does not fall on the stride.
          LIMIT ${maxPoints + 1}
        `,
      ]);

      const summary = summaryRows[0] ?? {
        n: 0,
        t_min: null,
        t_max: null,
        h_min: null,
        h_max: null,
        l_min: null,
        l_max: null,
        r_th: null,
        r_tl: null,
        r_hl: null,
      };
      const n = summary.n;

      const [temperature, humidity, lux] = await Promise.all([
        histogramFor('temperature', num(summary.t_min), num(summary.t_max), n, bins, filters),
        histogramFor('humidity', num(summary.h_min), num(summary.h_max), n, bins, filters),
        histogramFor('lux', summary.l_min, summary.l_max, n, bins, filters),
      ]);

      const hourByIndex = new Map(hourlyRows.map((row) => [row.hour, row]));
      const hourly: ExploreHourlyBucket[] = Array.from({ length: 24 }, (_, hour) => {
        const row = hourByIndex.get(hour);
        return {
          hour,
          count: row?.count ?? 0,
          avgTemperature: round(row?.avg_t ?? null, 1),
          avgHumidity: round(row?.avg_h ?? null, 1),
          avgLux: round(row?.avg_l ?? null, 0),
        };
      });

      return {
        range: { from: from?.toISOString() ?? null, to: to?.date.toISOString() ?? null, tz },
        count: n,
        points: pointRows.map((row) => ({
          id: Number(row.id),
          at: row.at.toISOString(),
          temperature: Number(row.temperature),
          humidity: Number(row.humidity),
          lux: row.lux,
        })),
        pointsTruncated: n > maxPoints,
        histograms: { temperature, humidity, lux },
        correlations: {
          temperatureHumidity: n >= 3 ? round3(summary.r_th) : null,
          temperatureLux: n >= 3 ? round3(summary.r_tl) : null,
          humidityLux: n >= 3 ? round3(summary.r_hl) : null,
        },
        hourly,
      };
    },
  };
}
