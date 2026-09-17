import type { StatsResponse } from '@sylvan/shared';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestContext, insertSample, resetDatabase, type TestContext } from './helpers.js';

let ctx: TestContext;

beforeAll(async () => {
  ctx = await createTestContext();
});
afterAll(() => ctx.close());
beforeEach(() => resetDatabase(ctx.sql));

async function stats(query = ''): Promise<StatsResponse> {
  const res = await ctx.app.inject({ method: 'GET', url: `/api/stats${query}` });
  expect(res.statusCode, res.body).toBe(200);
  return res.json<StatsResponse>();
}

const SEPT_RANGE = '?from=2026-09-01T00:00:00Z&to=2026-09-03T23:59:59.999Z&tz=UTC';

describe('GET /api/stats', () => {
  it('handles an empty database without dividing by zero', async () => {
    const body = await stats(SEPT_RANGE);
    expect(body.totals).toEqual({ samples: 0, ok: 0, failed: 0, successRate: null, withPhoto: 0 });
    expect(body.metrics.temperature).toEqual({ min: null, avg: null, max: null, count: 0 });
    expect(body.latest).toBeNull();
    expect(body.lastUploadAt).toBeNull();
    expect(body.previousPeriod?.totals.successRate).toBeNull();
    expect(body.daily.map((day) => day.date)).toEqual(['2026-09-01', '2026-09-02', '2026-09-03']);
    expect(body.daily.every((day) => day.samples === 0 && day.avgTemperature === null)).toBe(true);
    expect(body.dailyTruncated).toBe(false);
  });

  it('returns no daily buckets for all time with no samples', async () => {
    const body = await stats();
    expect(body.daily).toEqual([]);
    expect(body.previousPeriod).toBeNull();
    expect(body.range).toEqual({ from: null, to: null, tz: 'Asia/Dhaka' });
  });

  it('handles a range where every sample failed', async () => {
    await insertSample(ctx.sql, { createdAt: '2026-09-01T10:00:00Z', ok: false });
    await insertSample(ctx.sql, { createdAt: '2026-09-02T10:00:00Z', ok: false });
    const body = await stats(SEPT_RANGE);
    expect(body.totals).toMatchObject({ samples: 2, ok: 0, failed: 2, successRate: 0 });
    expect(body.metrics.humidity).toEqual({ min: null, avg: null, max: null, count: 0 });
    expect(body.daily[0]).toMatchObject({ samples: 1, ok: 0, failed: 1, avgHumidity: null });
  });

  it('computes totals, min/avg/max and rounding for mixed samples', async () => {
    await insertSample(ctx.sql, {
      createdAt: '2026-09-01T08:00:00Z',
      temperature: 20.1,
      humidity: 50,
      lux: 100,
      photoKey: '2026/09/a.jpg',
    });
    await insertSample(ctx.sql, {
      createdAt: '2026-09-01T09:00:00Z',
      temperature: 25.3,
      humidity: 61.5,
      lux: 201,
    });
    await insertSample(ctx.sql, {
      createdAt: '2026-09-02T09:00:00Z',
      temperature: -3.4,
      humidity: 70.2,
      lux: 1000,
    });
    const latestId = await insertSample(ctx.sql, {
      createdAt: '2026-09-03T12:00:00Z',
      ok: false,
      photoKey: '2026/09/b.jpg',
    });
    // Outside the range: must not affect the numbers, but does count as the last upload.
    await insertSample(ctx.sql, { createdAt: '2026-09-10T00:00:00Z', temperature: 79 });

    const body = await stats(SEPT_RANGE);
    expect(body.totals).toEqual({
      samples: 4,
      ok: 3,
      failed: 1,
      successRate: 0.75,
      withPhoto: 2,
    });
    // avg(20.1, 25.3, -3.4) = 14.0; avg lux (100 + 201 + 1000) / 3 = 433.67 -> 434
    expect(body.metrics).toEqual({
      temperature: { min: -3.4, avg: 14, max: 25.3, count: 3 },
      humidity: { min: 50, avg: 60.6, max: 70.2, count: 3 },
      lux: { min: 100, avg: 434, max: 1000, count: 3 },
    });
    expect(body.latest).toMatchObject({ id: latestId, ok: false });
    expect(body.lastUploadAt).toBe('2026-09-10T00:00:00.000Z');
    expect(body.daily).toEqual([
      {
        date: '2026-09-01',
        samples: 2,
        ok: 2,
        failed: 0,
        avgTemperature: 22.7,
        avgHumidity: 55.8,
        avgLux: 151,
      },
      {
        date: '2026-09-02',
        samples: 1,
        ok: 1,
        failed: 0,
        avgTemperature: -3.4,
        avgHumidity: 70.2,
        avgLux: 1000,
      },
      {
        date: '2026-09-03',
        samples: 1,
        ok: 0,
        failed: 1,
        avgTemperature: null,
        avgHumidity: null,
        avgLux: null,
      },
    ]);
  });

  it('compares with the same-length period immediately before from', async () => {
    await insertSample(ctx.sql, { createdAt: '2026-09-05T12:00:00Z', temperature: 10 }); // too old
    await insertSample(ctx.sql, { createdAt: '2026-09-06T00:00:00Z', temperature: 20 }); // previous
    await insertSample(ctx.sql, { createdAt: '2026-09-07T12:00:00Z', ok: false }); // previous
    await insertSample(ctx.sql, { createdAt: '2026-09-08T00:00:00Z', temperature: 30 }); // current
    await insertSample(ctx.sql, { createdAt: '2026-09-09T12:00:00Z', temperature: 32 }); // current

    const body = await stats('?from=2026-09-08T00:00:00Z&to=2026-09-10T00:00:00Z&tz=UTC');
    expect(body.totals.samples).toBe(2);
    expect(body.metrics.temperature.avg).toBe(31);
    expect(body.previousPeriod).toEqual({
      totals: { samples: 2, ok: 1, failed: 1, successRate: 0.5 },
      metrics: { temperature: { avg: 20 }, humidity: { avg: 60 }, lux: { avg: 500 } },
    });
  });

  it('zero-fills days without samples between sparse samples', async () => {
    await insertSample(ctx.sql, { createdAt: '2026-09-01T12:00:00Z' });
    await insertSample(ctx.sql, { createdAt: '2026-09-05T12:00:00Z' });
    const body = await stats('?from=2026-09-01&to=2026-09-05&tz=UTC');
    expect(body.daily.map((day) => [day.date, day.samples])).toEqual([
      ['2026-09-01', 1],
      ['2026-09-02', 0],
      ['2026-09-03', 0],
      ['2026-09-04', 0],
      ['2026-09-05', 1],
    ]);
  });

  it('starts all-time daily buckets at the first sample', async () => {
    const recent = new Date(Date.now() - 2 * 86_400_000).toISOString();
    await insertSample(ctx.sql, { createdAt: recent });
    const body = await stats('?tz=UTC');
    expect(body.daily).toHaveLength(3);
    expect(body.daily[0]?.samples).toBe(1);
    expect(body.previousPeriod).toBeNull();
  });

  it('buckets days in the requested timezone', async () => {
    // 20:00 UTC is 02:00 the next day in Asia/Dhaka (UTC+6).
    await insertSample(ctx.sql, { createdAt: '2026-09-10T20:00:00Z' });
    const range = 'from=2026-09-10T00:00:00%2B06:00&to=2026-09-11T23:59:59.999%2B06:00';

    const dhaka = await stats(`?${range}&tz=Asia/Dhaka`);
    expect(dhaka.range.tz).toBe('Asia/Dhaka');
    expect(dhaka.daily.map((day) => [day.date, day.samples])).toEqual([
      ['2026-09-10', 0],
      ['2026-09-11', 1],
    ]);

    const utc = await stats(`?${range}&tz=UTC`);
    expect(utc.daily.map((day) => [day.date, day.samples])).toEqual([
      ['2026-09-09', 0],
      ['2026-09-10', 1],
      ['2026-09-11', 0],
    ]);
  });

  it('uses DISPLAY_TIMEZONE when tz is omitted', async () => {
    await insertSample(ctx.sql, { createdAt: '2026-09-10T20:00:00Z' });
    const body = await stats('?from=2026-09-11T00:00:00%2B06:00&to=2026-09-11T23:59:59%2B06:00');
    expect(body.range.tz).toBe('Asia/Dhaka');
    expect(body.daily).toEqual([expect.objectContaining({ date: '2026-09-11', samples: 1 })]);
  });

  it('returns only the most recent 366 days for longer ranges', async () => {
    await insertSample(ctx.sql, { createdAt: '2024-06-01T12:00:00Z' });
    await insertSample(ctx.sql, { createdAt: '2025-12-31T12:00:00Z' });
    const body = await stats('?from=2024-01-01&to=2026-01-01&tz=UTC');
    expect(body.dailyTruncated).toBe(true);
    expect(body.daily).toHaveLength(366);
    expect(body.daily[0]?.date).toBe('2025-01-01');
    expect(body.daily.at(-1)?.date).toBe('2026-01-01');
    expect(body.totals.samples).toBe(2);
    expect(body.daily.reduce((sum, day) => sum + day.samples, 0)).toBe(1);
  });

  it.each([
    ['?tz=Mars/Olympus_Mons', 'INVALID_TIMEZONE'],
    ['?tz=not%20a%20zone', 'INVALID_TIMEZONE'],
    ['?tz=../../etc', 'INVALID_TIMEZONE'],
    ['?from=soon', 'INVALID_DATE'],
    ['?from=2026-09-10&to=2026-09-01', 'INVALID_DATE'],
  ])('rejects %s with %s', async (query, code) => {
    const res = await ctx.app.inject({ method: 'GET', url: `/api/stats${query}` });
    expect(res.statusCode).toBe(400);
    expect(res.json<{ error: { code: string } }>().error.code).toBe(code);
  });
});
