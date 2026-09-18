import type { ExploreCorrelations, ExplorePoint, Histogram } from '@sylvan/shared';
import type { MetricKey } from '../../lib/constants';

/**
 * Share of samples whose reading falls inside `range`, computed from histogram bins (which cover
 * every sample, unlike the possibly-downsampled scatter points). A bin that straddles a range
 * boundary is counted proportionally to how much of its width overlaps the range, assuming values
 * are spread evenly within the bin. Returns null when there is no data at all.
 */
export function percentWithinRange(
  histogram: Histogram,
  range: { min: number; max: number },
): number | null {
  const total = histogram.bins.reduce((sum, bin) => sum + bin.count, 0);
  if (total === 0) return null;

  let inRange = 0;
  for (const bin of histogram.bins) {
    if (bin.from === bin.to) {
      // A single-value ("constant") bin: count it fully or not at all.
      if (bin.from >= range.min && bin.from <= range.max) inRange += bin.count;
      continue;
    }
    const overlapStart = Math.max(bin.from, range.min);
    const overlapEnd = Math.min(bin.to, range.max);
    if (overlapEnd <= overlapStart) continue;
    const fraction = (overlapEnd - overlapStart) / (bin.to - bin.from);
    inRange += bin.count * fraction;
  }
  return inRange / total;
}

const PAIR_KEYS: Record<string, keyof ExploreCorrelations> = {
  'temperature|humidity': 'temperatureHumidity',
  'humidity|temperature': 'temperatureHumidity',
  'temperature|lux': 'temperatureLux',
  'lux|temperature': 'temperatureLux',
  'humidity|lux': 'humidityLux',
  'lux|humidity': 'humidityLux',
};

/** Looks up the correlation for two (order-independent) metrics; null for x === y. */
export function correlationForPair(
  correlations: ExploreCorrelations,
  x: MetricKey,
  y: MetricKey,
): number | null {
  if (x === y) return null;
  const key = PAIR_KEYS[`${x}|${y}`];
  return key ? correlations[key] : null;
}

/** Normalized 0..1 position of `time` between the oldest and newest point, for the time legend. */
export function timePosition(time: number, minTime: number, maxTime: number): number {
  if (maxTime <= minTime) return 1;
  return (time - minTime) / (maxTime - minTime);
}

/**
 * Min/average/max of one metric across the loaded scatter points. Exact whenever `points` is not
 * downsampled (the common case); when it is, this describes the plotted sample rather than every
 * row (the histogram, built server-side from the full set, is the source of truth for counts).
 */
export function metricSummary(
  points: ExplorePoint[],
  metric: MetricKey,
): { min: number; avg: number; max: number } | null {
  if (points.length === 0) return null;
  let min = Infinity;
  let max = -Infinity;
  let sum = 0;
  for (const point of points) {
    const value = point[metric];
    if (value < min) min = value;
    if (value > max) max = value;
    sum += value;
  }
  return { min, avg: sum / points.length, max };
}
