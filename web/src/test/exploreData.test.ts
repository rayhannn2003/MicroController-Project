import type { ExploreCorrelations, ExplorePoint, Histogram } from '@sylvan/shared';
import { describe, expect, it } from 'vitest';
import {
  correlationForPair,
  metricSummary,
  percentWithinRange,
  timePosition,
} from '../pages/explore/exploreData';

const histogram = (bins: Histogram['bins']): Histogram => ({
  min: bins[0]?.from ?? 0,
  max: bins.at(-1)?.to ?? 0,
  binWidth: (bins[0]?.to ?? 0) - (bins[0]?.from ?? 0),
  bins,
});

describe('percentWithinRange', () => {
  it('returns null for an empty histogram', () => {
    expect(percentWithinRange(histogram([]), { min: 0, max: 100 })).toBeNull();
  });

  it('counts a bin fully in range, fully out of range, and split proportionally', () => {
    // Bins: [10-20)=5, [20-30)=5. Range [15,25] overlaps half of each bin.
    const h = histogram([
      { from: 10, to: 20, count: 5 },
      { from: 20, to: 30, count: 5 },
    ]);
    expect(percentWithinRange(h, { min: 15, max: 25 })).toBeCloseTo(0.5, 10);
  });

  it('returns 1 when the range covers every bin, and 0 when it covers none', () => {
    const h = histogram([
      { from: 0, to: 10, count: 4 },
      { from: 10, to: 20, count: 6 },
    ]);
    expect(percentWithinRange(h, { min: 0, max: 20 })).toBe(1);
    expect(percentWithinRange(h, { min: 100, max: 200 })).toBe(0);
  });

  it('handles a constant (single-value, zero-width) histogram', () => {
    const inRange = histogram([{ from: 24, to: 24, count: 10 }]);
    expect(percentWithinRange(inRange, { min: 18, max: 30 })).toBe(1);

    const outOfRange = histogram([{ from: 5, to: 5, count: 10 }]);
    expect(percentWithinRange(outOfRange, { min: 18, max: 30 })).toBe(0);
  });
});

describe('correlationForPair', () => {
  const correlations: ExploreCorrelations = {
    temperatureHumidity: 0.5,
    temperatureLux: -0.3,
    humidityLux: null,
  };

  it('looks up the correlation regardless of argument order', () => {
    expect(correlationForPair(correlations, 'temperature', 'humidity')).toBe(0.5);
    expect(correlationForPair(correlations, 'humidity', 'temperature')).toBe(0.5);
    expect(correlationForPair(correlations, 'lux', 'temperature')).toBe(-0.3);
  });

  it('returns null for a metric compared with itself', () => {
    expect(correlationForPair(correlations, 'temperature', 'temperature')).toBeNull();
  });

  it('passes through a null correlation', () => {
    expect(correlationForPair(correlations, 'humidity', 'lux')).toBeNull();
  });
});

describe('timePosition', () => {
  it('maps the range linearly onto 0..1', () => {
    expect(timePosition(0, 0, 100)).toBe(0);
    expect(timePosition(100, 0, 100)).toBe(1);
    expect(timePosition(50, 0, 100)).toBe(0.5);
  });

  it('returns 1 when every point shares the same time (no range to position within)', () => {
    expect(timePosition(10, 10, 10)).toBe(1);
  });
});

describe('metricSummary', () => {
  const point = (id: number, temperature: number): ExplorePoint => ({
    id,
    at: '2026-09-10T00:00:00Z',
    temperature,
    humidity: 50,
    lux: 100,
  });

  it('returns null for no points', () => {
    expect(metricSummary([], 'temperature')).toBeNull();
  });

  it('computes min, average and max', () => {
    const points = [point(1, 10), point(2, 30), point(3, 20)];
    expect(metricSummary(points, 'temperature')).toEqual({ min: 10, avg: 20, max: 30 });
  });
});
