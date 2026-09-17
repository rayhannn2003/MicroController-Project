import { describe, expect, it } from 'vitest';
import {
  formatDateTime,
  formatPercent,
  formatReading,
  formatRelative,
  formatUtc,
  photoAlt,
} from '../lib/format';

const NOW = Date.parse('2026-09-17T12:00:00Z');
const ago = (ms: number) => new Date(NOW - ms).toISOString();
const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

describe('formatRelative', () => {
  it.each([
    [0, 'just now'],
    [44_000, 'just now'],
    [-5 * MIN, 'just now'],
    [45_000, '1 min ago'],
    [12 * MIN, '12 min ago'],
    [59 * MIN, '59 min ago'],
    [HOUR, '1 h ago'],
    [23 * HOUR + 59 * MIN, '23 h ago'],
    [DAY, 'yesterday'],
    [2 * DAY, '2 days ago'],
    [29 * DAY, '29 days ago'],
  ])('%i ms ago → %s', (ms, expected) => {
    expect(formatRelative(ago(ms), NOW)).toBe(expected);
  });

  it('falls back to a date after 30 days', () => {
    expect(formatRelative('2026-07-01T10:00:00Z', NOW)).toBe('on 1 Jul 2026');
  });
});

describe('formatting helpers', () => {
  it('formats local and UTC times (TZ=Asia/Dhaka)', () => {
    expect(formatDateTime('2026-09-17T08:05:00Z')).toBe('17 Sept 2026, 14:05');
    expect(formatUtc('2026-09-17T08:05:09.500Z')).toBe('2026-09-17 08:05:09 UTC');
  });

  it('formats readings with units and a true minus sign', () => {
    expect(formatReading('temperature', -3.25)).toBe('−3.3 °C');
    expect(formatReading('humidity', 66)).toBe('66.0 %');
    expect(formatReading('lux', 12345)).toBe('12,345 lx');
    expect(formatReading('lux', null)).toBe('—');
    expect(formatPercent(0.8571)).toBe('85.7%');
    expect(formatPercent(1)).toBe('100%');
  });

  it('builds descriptive alt text', () => {
    expect(photoAlt({ id: 42, createdAt: '2026-09-17T08:05:00Z' })).toBe(
      'Rover photo for sample #42, 17 Sept 2026, 14:05',
    );
  });
});
