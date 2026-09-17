import type { Sample } from '@sylvan/shared';
import { CHART_GAP_MS } from './constants';

export interface ReadingPoint {
  id: number;
  time: number;
  temperature: number;
  humidity: number;
  lux: number;
}

/**
 * Splits successful samples into line segments: sorted by time, a new segment starts whenever
 * two consecutive samples are more than `maxGapMs` apart (exactly `maxGapMs` stays connected).
 * Failed samples have no readings and are ignored.
 */
export function splitIntoSegments(samples: Sample[], maxGapMs = CHART_GAP_MS): ReadingPoint[][] {
  const points: ReadingPoint[] = [];
  for (const sample of samples) {
    if (
      !sample.ok ||
      sample.temperature === null ||
      sample.humidity === null ||
      sample.lux === null
    ) {
      continue;
    }
    points.push({
      id: sample.id,
      time: new Date(sample.createdAt).getTime(),
      temperature: sample.temperature,
      humidity: sample.humidity,
      lux: sample.lux,
    });
  }
  points.sort((a, b) => a.time - b.time || a.id - b.id);

  const segments: ReadingPoint[][] = [];
  let current: ReadingPoint[] = [];
  for (const point of points) {
    const previous = current.at(-1);
    if (previous && point.time - previous.time > maxGapMs) {
      segments.push(current);
      current = [];
    }
    current.push(point);
  }
  if (current.length > 0) segments.push(current);
  return segments;
}

export interface ChartRow {
  time: number;
  id: number | null;
  temperature: number | null;
  humidity: number | null;
  lux: number | null;
}

/** Flattens segments into chart rows with an all-null row between segments to break the line. */
export function segmentsToRows(segments: ReadingPoint[][]): ChartRow[] {
  const rows: ChartRow[] = [];
  segments.forEach((segment, index) => {
    const previous = rows.at(-1);
    const first = segment[0];
    if (index > 0 && previous && first) {
      rows.push({
        time: Math.round((previous.time + first.time) / 2),
        id: null,
        temperature: null,
        humidity: null,
        lux: null,
      });
    }
    for (const point of segment) rows.push({ ...point });
  });
  return rows;
}

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

/**
 * Evenly spaced local-time ticks for a time axis: hourly steps for spans up to ~1.5 days,
 * otherwise whole local days (every 1, 2, 7 or 30 days), aiming for at most `maxTicks`.
 */
export function timeTicks([start, end]: [number, number], maxTicks = 7): number[] {
  const span = end - start;
  if (!(span > 0)) return [];

  if (span <= 36 * HOUR_MS) {
    const stepHours = [1, 2, 3, 6, 12].find((hours) => span / (hours * HOUR_MS) <= maxTicks) ?? 12;
    const first = new Date(start);
    first.setMinutes(0, 0, 0);
    first.setHours(Math.ceil(first.getHours() / stepHours) * stepHours);
    const ticks: number[] = [];
    for (let t = first.getTime(); t <= end; t += stepHours * HOUR_MS) {
      if (t >= start) ticks.push(t);
    }
    return ticks;
  }

  const stepDays =
    [1, 2, 7, 14, 30, 60, 90].find((days) => span / (days * DAY_MS) <= maxTicks) ?? 180;
  const cursor = new Date(start);
  cursor.setHours(0, 0, 0, 0);
  if (cursor.getTime() < start) cursor.setDate(cursor.getDate() + 1);
  const ticks: number[] = [];
  // Step with setDate so ticks stay on local midnight across DST changes.
  while (cursor.getTime() <= end) {
    ticks.push(cursor.getTime());
    cursor.setDate(cursor.getDate() + stepDays);
  }
  return ticks;
}
