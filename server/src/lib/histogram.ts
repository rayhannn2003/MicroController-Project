import type { Histogram } from '@sylvan/shared';

/**
 * Rounds a min/max pair outward to a metric's decimal precision, so histogram edges read like
 * "20.0–30.0" instead of "20.347–29.812". Never narrows the range: `min` only moves down and
 * `max` only moves up.
 */
export function niceBounds(
  min: number,
  max: number,
  decimals: number,
): { min: number; max: number } {
  const factor = 10 ** decimals;
  return {
    min: Math.floor(min * factor) / factor,
    max: Math.ceil(max * factor) / factor,
  };
}

/**
 * Builds a `Histogram` from per-bucket counts (1-indexed, as returned by SQL `width_bucket`).
 * `bucketCounts` maps a bucket index to its row count; missing indexes are treated as zero so
 * empty bins still appear (a chart should not silently skip a bin with no samples in it).
 */
export function buildHistogram(
  bounds: { min: number; max: number },
  bins: number,
  bucketCounts: Map<number, number>,
): Histogram {
  const { min, max } = bounds;
  const binWidth = (max - min) / bins;
  return {
    min,
    max,
    binWidth,
    bins: Array.from({ length: bins }, (_, index) => ({
      from: min + index * binWidth,
      to: min + (index + 1) * binWidth,
      count: bucketCounts.get(index + 1) ?? 0,
    })),
  };
}

/** A histogram with no data at all: no range to show, so there is nothing to shade or bucket. */
export function emptyHistogram(): Histogram {
  return { min: 0, max: 0, binWidth: 0, bins: [] };
}

/** Every value in range is identical: one bin containing everything, width zero by definition. */
export function constantHistogram(value: number, count: number): Histogram {
  return { min: value, max: value, binWidth: 0, bins: [{ from: value, to: value, count }] };
}
