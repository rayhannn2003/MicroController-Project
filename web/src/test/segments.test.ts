import { describe, expect, it } from 'vitest';
import { CHART_GAP_MS } from '../lib/constants';
import { segmentsToRows, splitIntoSegments, timeTicks } from '../lib/segments';
import { makeSample } from './fixtures';

const HOUR = 60 * 60 * 1000;
const base = Date.parse('2026-09-17T00:00:00Z');
const at = (id: number, hours: number, ok = true) =>
  makeSample({ id, ok, createdAt: new Date(base + hours * HOUR).toISOString() });
const ids = (segments: { id: number }[][]) => segments.map((segment) => segment.map((p) => p.id));

describe('splitIntoSegments', () => {
  it('keeps close samples together and splits on gaps over 6 hours', () => {
    const segments = splitIntoSegments([at(1, 0), at(2, 1), at(3, 8), at(4, 9), at(5, 30)]);
    expect(ids(segments)).toEqual([[1, 2], [3, 4], [5]]);
  });

  it('sorts unsorted input by time (and id for ties)', () => {
    const segments = splitIntoSegments([at(4, 9), at(1, 0), at(3, 8), at(2, 1), at(6, 1)]);
    expect(ids(segments)).toEqual([
      [1, 2, 6],
      [3, 4],
    ]);
  });

  it('returns a single segment for a single point, and nothing for no points', () => {
    expect(ids(splitIntoSegments([at(1, 0)]))).toEqual([[1]]);
    expect(splitIntoSegments([])).toEqual([]);
  });

  it('keeps samples exactly 6 hours apart connected, and splits 1 ms later', () => {
    expect(CHART_GAP_MS).toBe(6 * HOUR);
    expect(ids(splitIntoSegments([at(1, 0), at(2, 6)]))).toEqual([[1, 2]]);
    const later = makeSample({ id: 3, createdAt: new Date(base + 6 * HOUR + 1).toISOString() });
    expect(ids(splitIntoSegments([at(1, 0), later]))).toEqual([[1], [3]]);
  });

  it('ignores failed samples, so they neither join nor split lines', () => {
    const failed = { ...at(2, 4, false), temperature: null, humidity: null, lux: null };
    expect(ids(splitIntoSegments([at(1, 0), failed, at(3, 8)]))).toEqual([[1], [3]]);
    expect(ids(splitIntoSegments([at(1, 0), failed, at(3, 5)]))).toEqual([[1, 3]]);
  });

  it('inserts a null row between segments to break chart lines', () => {
    const rows = segmentsToRows(splitIntoSegments([at(1, 0), at(2, 10)]));
    expect(rows.map((row) => row.id)).toEqual([1, null, 2]);
    expect(rows[1]).toMatchObject({ temperature: null, humidity: null, lux: null });
  });
});

describe('timeTicks', () => {
  it('uses local midnights for multi-day spans', () => {
    const start = new Date(2026, 8, 10, 14).getTime();
    const end = new Date(2026, 8, 17, 9).getTime();
    const ticks = timeTicks([start, end]);
    expect(ticks.map((t) => new Date(t).getDate())).toEqual([11, 12, 13, 14, 15, 16, 17]);
    expect(ticks.every((t) => new Date(t).getHours() === 0)).toBe(true);
  });

  it('uses hourly steps for spans up to 36 hours', () => {
    const start = new Date(2026, 8, 17, 1, 20).getTime();
    const end = new Date(2026, 8, 17, 13).getTime();
    expect(timeTicks([start, end]).map((t) => new Date(t).getHours())).toEqual([
      2, 4, 6, 8, 10, 12,
    ]);
  });
});
