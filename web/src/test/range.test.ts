import { describe, expect, it } from 'vitest';
import {
  browserTimezone,
  parseRange,
  parseStatus,
  rangeLabel,
  rangeToApi,
  writeRange,
  writeStatus,
} from '../lib/range';

// Tests run with TZ=Asia/Dhaka (UTC+6), see vite.config.ts.
const NOW = new Date('2026-09-17T08:30:45.123Z'); // 14:30 in Dhaka
const params = (text: string) => new URLSearchParams(text);

describe('range presets → URL → API query', () => {
  it('defaults to the last 7 days and keeps the default out of the URL', () => {
    expect(parseRange(params(''))).toEqual({ preset: '7d' });
    expect(parseRange(params('range=nonsense'))).toEqual({ preset: '7d' });
    expect(writeRange(params('status=ok&range=30d'), { preset: '7d' }).toString()).toBe(
      'status=ok',
    );
  });

  it.each([
    ['24h', 'range=24h', { from: '2026-09-16T08:30:00.000Z' }],
    // Local midnight six days ago: 11 Sep 00:00 in Dhaka = 10 Sep 18:00 UTC.
    ['7d', '', { from: '2026-09-10T18:00:00.000Z' }],
    ['30d', 'range=30d', { from: '2026-08-18T18:00:00.000Z' }],
    ['all', 'range=all', {}],
  ] as const)('%s preset', (preset, url, api) => {
    const written = writeRange(params(''), { preset });
    expect(written.toString()).toBe(url);
    const parsed = parseRange(written);
    expect(parsed).toEqual({ preset });
    expect(rangeToApi(parsed, NOW)).toEqual(api);
  });

  it('round-trips a custom range as whole local days', () => {
    const written = writeRange(params('range=30d&status=failed'), {
      preset: 'custom',
      from: '2026-09-01',
      to: '2026-09-10',
    });
    expect(written.toString()).toBe('status=failed&from=2026-09-01&to=2026-09-10');
    const parsed = parseRange(written);
    expect(parsed).toEqual({ preset: 'custom', from: '2026-09-01', to: '2026-09-10' });
    expect(rangeToApi(parsed, NOW)).toEqual({
      from: '2026-08-31T18:00:00.000Z',
      to: '2026-09-10T17:59:59.999Z',
    });
    expect(rangeLabel(parsed)).toBe('1 Sept – 10 Sept 2026');
  });

  it('accepts open-ended custom ranges, swaps reversed dates and ignores invalid dates', () => {
    expect(rangeToApi(parseRange(params('from=2026-09-01')), NOW)).toEqual({
      from: '2026-08-31T18:00:00.000Z',
      to: undefined,
    });
    expect(parseRange(params('from=2026-09-10&to=2026-09-01'))).toEqual({
      preset: 'custom',
      from: '2026-09-01',
      to: '2026-09-10',
    });
    expect(parseRange(params('from=2026-02-30&range=30d'))).toEqual({ preset: '30d' });
  });

  it('reads and writes the status filter', () => {
    expect(parseStatus(params('status=ok'))).toBe('ok');
    expect(parseStatus(params('status=weird'))).toBe('all');
    expect(writeStatus(params('status=ok&range=all'), 'all').toString()).toBe('range=all');
  });

  it('reports the browser timezone', () => {
    expect(browserTimezone()).toBe('Asia/Dhaka');
  });
});
