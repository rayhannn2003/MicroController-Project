import type { ExploreResponse } from '@sylvan/shared';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestContext, insertSample, resetDatabase, type TestContext } from './helpers.js';

let ctx: TestContext;

beforeAll(async () => {
  ctx = await createTestContext();
});
afterAll(() => ctx.close());
beforeEach(() => resetDatabase(ctx.sql));

async function explore(query = ''): Promise<ExploreResponse> {
  const res = await ctx.app.inject({ method: 'GET', url: `/api/explore${query}` });
  expect(res.statusCode, res.body).toBe(200);
  return res.json<ExploreResponse>();
}

const sumBins = (bins: { count: number }[]) => bins.reduce((sum, bin) => sum + bin.count, 0);

describe('GET /api/explore', () => {
  it('returns count 0 with empty arrays for an empty range, never an error', async () => {
    const body = await explore('?from=2026-09-01&to=2026-09-02&tz=UTC');
    expect(body.count).toBe(0);
    expect(body.points).toEqual([]);
    expect(body.pointsTruncated).toBe(false);
    expect(body.correlations).toEqual({
      temperatureHumidity: null,
      temperatureLux: null,
      humidityLux: null,
    });
    expect(body.histograms.temperature).toEqual({ min: 0, max: 0, binWidth: 0, bins: [] });
    expect(body.hourly).toHaveLength(24);
    expect(body.hourly.every((hour) => hour.count === 0 && hour.avgTemperature === null)).toBe(
      true,
    );
  });

  it('handles a single sample without dividing by zero, and reports no correlation', async () => {
    await insertSample(ctx.sql, {
      createdAt: '2026-09-10T12:00:00Z',
      temperature: 22.5,
      humidity: 55,
      lux: 400,
    });
    const body = await explore('?tz=UTC');
    expect(body.count).toBe(1);
    expect(body.points).toHaveLength(1);
    expect(body.correlations).toEqual({
      temperatureHumidity: null,
      temperatureLux: null,
      humidityLux: null,
    });
    // A single sample is a "constant" histogram: one bin containing it, width zero.
    expect(body.histograms.temperature).toEqual({
      min: 22.5,
      max: 22.5,
      binWidth: 0,
      bins: [{ from: 22.5, to: 22.5, count: 1 }],
    });
  });

  it('handles every value being identical (constant) without dividing by zero', async () => {
    for (let i = 0; i < 4; i++) {
      await insertSample(ctx.sql, {
        createdAt: `2026-09-1${String(i)}T12:00:00Z`,
        temperature: 24,
        humidity: 60,
        lux: 500,
      });
    }
    const body = await explore('?tz=UTC&bins=8');
    expect(body.count).toBe(4);
    expect(body.histograms.temperature).toEqual({
      min: 24,
      max: 24,
      binWidth: 0,
      bins: [{ from: 24, to: 24, count: 4 }],
    });
    // Constant values still count as "not enough variation": correlation is null.
    expect(body.correlations.temperatureHumidity).toBeNull();
  });

  it('excludes failed samples (they have no readings)', async () => {
    await insertSample(ctx.sql, { createdAt: '2026-09-10T12:00:00Z', ok: false });
    await insertSample(ctx.sql, {
      createdAt: '2026-09-10T13:00:00Z',
      temperature: 20,
      humidity: 50,
      lux: 100,
    });
    const body = await explore('?tz=UTC');
    expect(body.count).toBe(1);
    expect(body.points).toHaveLength(1);
  });

  it('produces the requested number of evenly-spaced bins, each summing to the total count', async () => {
    const values = [20.1, 21.4, 22.9, 24.2, 25.8, 27.1, 28.6, 29.9, 23.3, 26.5];
    for (const [index, temperature] of values.entries()) {
      await insertSample(ctx.sql, {
        createdAt: `2026-09-10T${String(index).padStart(2, '0')}:00:00Z`,
        temperature,
        humidity: 55,
        lux: 500,
      });
    }
    const body = await explore('?tz=UTC&bins=10');
    const histogram = body.histograms.temperature;
    expect(histogram.bins).toHaveLength(10);
    expect(sumBins(histogram.bins)).toBe(10);
    // Bounds are rounded outward to one decimal (temperature's display precision).
    expect(histogram.min).toBeLessThanOrEqual(Math.min(...values));
    expect(histogram.max).toBeGreaterThanOrEqual(Math.max(...values));
    // Every bin is the same width and edges are contiguous.
    for (let i = 1; i < histogram.bins.length; i++) {
      expect(histogram.bins[i]?.from).toBeCloseTo(histogram.bins[i - 1]?.to ?? 0, 10);
    }
  });

  it('computes correlations that match a hand-computed fixture', async () => {
    // temp: 1,2,3,4,5; humidity: 2,4,5,4,5; lux copies temp.
    // r(temp,humidity) = 6/sqrt(60) = 0.7746 -> rounds to 0.775.
    // r(temp,lux) = 1 (identical series); r(humidity,lux) = same as r(temp,humidity).
    const rows: [number, number][] = [
      [1, 2],
      [2, 4],
      [3, 5],
      [4, 4],
      [5, 5],
    ];
    for (const [index, [temperature, humidity]] of rows.entries()) {
      await insertSample(ctx.sql, {
        createdAt: `2026-09-10T${String(index).padStart(2, '0')}:00:00Z`,
        temperature,
        humidity,
        lux: temperature,
      });
    }
    const body = await explore('?tz=UTC');
    expect(body.correlations.temperatureHumidity).toBeCloseTo(0.775, 3);
    expect(body.correlations.temperatureLux).toBe(1);
    expect(body.correlations.humidityLux).toBeCloseTo(0.775, 3);
  });

  it('requires at least 3 samples for a correlation, even when 2 vary', async () => {
    await insertSample(ctx.sql, {
      createdAt: '2026-09-10T00:00:00Z',
      temperature: 20,
      humidity: 50,
      lux: 100,
    });
    await insertSample(ctx.sql, {
      createdAt: '2026-09-10T01:00:00Z',
      temperature: 25,
      humidity: 60,
      lux: 200,
    });
    const body = await explore('?tz=UTC');
    expect(body.count).toBe(2);
    expect(body.correlations.temperatureHumidity).toBeNull();
  });

  it('buckets hourly averages in the requested timezone across a UTC day boundary', async () => {
    // 20:00 UTC is 02:00 the next day in Asia/Dhaka (UTC+6).
    await insertSample(ctx.sql, {
      createdAt: '2026-09-10T20:00:00Z',
      temperature: 22,
      humidity: 60,
      lux: 50,
    });

    const dhaka = await explore('?tz=Asia/Dhaka');
    const dhakaHour2 = dhaka.hourly.find((hour) => hour.hour === 2);
    const dhakaHour20 = dhaka.hourly.find((hour) => hour.hour === 20);
    expect(dhakaHour2?.count).toBe(1);
    expect(dhakaHour2?.avgTemperature).toBe(22);
    expect(dhakaHour20?.count).toBe(0);

    const utc = await explore('?tz=UTC');
    expect(utc.hourly.find((hour) => hour.hour === 20)?.count).toBe(1);
    expect(utc.hourly.find((hour) => hour.hour === 2)?.count).toBe(0);
  });

  it('sums hourly counts to the total, and zero-fills every hour', async () => {
    for (let i = 0; i < 5; i++) {
      await insertSample(ctx.sql, {
        createdAt: `2026-09-10T0${String(i)}:30:00Z`,
        temperature: 20 + i,
        humidity: 50,
        lux: 100,
      });
    }
    const body = await explore('?tz=UTC');
    expect(body.hourly).toHaveLength(24);
    expect(body.hourly.reduce((sum, hour) => sum + hour.count, 0)).toBe(5);
  });

  it.each([
    ['?bins=0', 'INVALID_BINS'],
    ['?bins=31', 'INVALID_BINS'],
    ['?bins=abc', 'INVALID_BINS'],
    ['?tz=Not/AZone', 'INVALID_TIMEZONE'],
    ['?from=nope', 'INVALID_DATE'],
  ])('rejects %s with %s', async (query, code) => {
    const res = await ctx.app.inject({ method: 'GET', url: `/api/explore${query}` });
    expect(res.statusCode).toBe(400);
    expect(res.json<{ error: { code: string } }>().error.code).toBe(code);
  });

  it('accepts bins at the boundaries (1 and 30)', async () => {
    await insertSample(ctx.sql, {
      createdAt: '2026-09-10T00:00:00Z',
      temperature: 20,
      humidity: 50,
      lux: 100,
    });
    await insertSample(ctx.sql, {
      createdAt: '2026-09-10T01:00:00Z',
      temperature: 25,
      humidity: 55,
      lux: 200,
    });
    expect((await explore('?bins=1')).histograms.temperature.bins).toHaveLength(1);
    expect((await explore('?bins=30')).histograms.temperature.bins).toHaveLength(30);
  });

  it('defaults to 12 bins when omitted', async () => {
    await insertSample(ctx.sql, {
      createdAt: '2026-09-10T00:00:00Z',
      temperature: 20,
      humidity: 50,
      lux: 100,
    });
    await insertSample(ctx.sql, {
      createdAt: '2026-09-10T01:00:00Z',
      temperature: 25,
      humidity: 55,
      lux: 200,
    });
    expect((await explore()).histograms.temperature.bins).toHaveLength(12);
  });
});

describe('GET /api/explore — downsampling', () => {
  it('caps points at the configured maximum and sets pointsTruncated', async () => {
    const small = await createTestContext({ exploreMaxPoints: 5 });
    try {
      for (let i = 0; i < 12; i++) {
        await insertSample(small.sql, {
          createdAt: `2026-09-10T${String(i).padStart(2, '0')}:00:00Z`,
          temperature: 20 + i,
          humidity: 50,
          lux: 100,
        });
      }
      const res = await small.app.inject({ method: 'GET', url: '/api/explore?tz=UTC' });
      const body = res.json<ExploreResponse>();
      expect(body.count).toBe(12);
      // The cap allows one extra slot so the very last sample is never dropped (see below).
      expect(body.points.length).toBeLessThanOrEqual(6);
      expect(body.pointsTruncated).toBe(true);
      // Downsampling is evenly spread: the first and last samples are always included.
      const ids = body.points.map((point) => point.id);
      expect(ids).toContain(1);
      expect(ids).toContain(12);
      // Histograms still cover every row, unaffected by point downsampling.
      expect(sumBins(body.histograms.temperature.bins)).toBe(12);
    } finally {
      await small.close();
    }
  });

  it('does not truncate when the count is at or below the maximum', async () => {
    const small = await createTestContext({ exploreMaxPoints: 5 });
    try {
      for (let i = 0; i < 5; i++) {
        await insertSample(small.sql, {
          createdAt: `2026-09-10T0${String(i)}:00:00Z`,
          temperature: 20,
          humidity: 50,
          lux: 100,
        });
      }
      const res = await small.app.inject({ method: 'GET', url: '/api/explore?tz=UTC' });
      const body = res.json<ExploreResponse>();
      expect(body.points).toHaveLength(5);
      expect(body.pointsTruncated).toBe(false);
    } finally {
      await small.close();
    }
  });
});
