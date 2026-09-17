import type { SampleStatusFilter } from '@sylvan/shared';

export type RangePreset = '24h' | '7d' | '30d' | 'all' | 'custom';

export interface RangeState {
  preset: RangePreset;
  /** Local calendar dates (YYYY-MM-DD), only for `custom`. */
  from?: string;
  to?: string;
}

export const DEFAULT_RANGE: RangeState = { preset: '7d' };

export const RANGE_PRESETS: {
  preset: Exclude<RangePreset, 'custom'>;
  label: string;
  short: string;
}[] = [
  { preset: '24h', label: 'Last 24 hours', short: '24 h' },
  { preset: '7d', label: 'Last 7 days', short: '7 days' },
  { preset: '30d', label: 'Last 30 days', short: '30 days' },
  { preset: 'all', label: 'All time', short: 'All time' },
];

const DATE = /^\d{4}-\d{2}-\d{2}$/;

function isValidDate(value: string | null): value is string {
  if (!value || !DATE.test(value)) return false;
  const [y, m, d] = value.split('-').map(Number) as [number, number, number];
  const date = new Date(y, m - 1, d);
  return date.getFullYear() === y && date.getMonth() === m - 1 && date.getDate() === d;
}

/** Reads the range from URL parameters. `from`/`to` imply a custom range. */
export function parseRange(search: URLSearchParams): RangeState {
  const from = search.get('from');
  const to = search.get('to');
  const validFrom = isValidDate(from) ? from : undefined;
  const validTo = isValidDate(to) ? to : undefined;
  if (validFrom || validTo) {
    if (validFrom && validTo && validFrom > validTo) {
      return { preset: 'custom', from: validTo, to: validFrom };
    }
    return { preset: 'custom', from: validFrom, to: validTo };
  }
  const preset = search.get('range');
  const match = RANGE_PRESETS.find((option) => option.preset === preset);
  return match ? { preset: match.preset } : DEFAULT_RANGE;
}

/** Returns a copy of `search` with the range written in; the default range is omitted. */
export function writeRange(search: URLSearchParams, range: RangeState): URLSearchParams {
  const next = new URLSearchParams(search);
  next.delete('range');
  next.delete('from');
  next.delete('to');
  if (range.preset === 'custom') {
    if (range.from) next.set('from', range.from);
    if (range.to) next.set('to', range.to);
  } else if (range.preset !== DEFAULT_RANGE.preset) {
    next.set('range', range.preset);
  }
  return next;
}

export function parseStatus(search: URLSearchParams): SampleStatusFilter {
  const status = search.get('status');
  return status === 'ok' || status === 'failed' ? status : 'all';
}

export function writeStatus(search: URLSearchParams, status: SampleStatusFilter) {
  const next = new URLSearchParams(search);
  if (status === 'all') next.delete('status');
  else next.set('status', status);
  return next;
}

function localDay(value: string, endOfDay: boolean): Date {
  const [y, m, d] = value.split('-').map(Number) as [number, number, number];
  return endOfDay ? new Date(y, m - 1, d, 23, 59, 59, 999) : new Date(y, m - 1, d);
}

function startOfDay(date: Date, daysBack: number): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() - daysBack);
}

/**
 * Converts a range into API `from`/`to` instants (ISO strings, UTC). Day-based presets start at
 * local midnight so they cover whole calendar days; 24 h is rolled to the minute so query keys
 * stay stable between polls.
 */
export function rangeToApi(range: RangeState, now = new Date()): { from?: string; to?: string } {
  switch (range.preset) {
    case '24h': {
      const from = new Date(now.getTime() - 24 * 60 * 60 * 1000);
      from.setSeconds(0, 0);
      return { from: from.toISOString() };
    }
    case '7d':
      return { from: startOfDay(now, 6).toISOString() };
    case '30d':
      return { from: startOfDay(now, 29).toISOString() };
    case 'all':
      return {};
    case 'custom':
      return {
        from: range.from ? localDay(range.from, false).toISOString() : undefined,
        to: range.to ? localDay(range.to, true).toISOString() : undefined,
      };
  }
}

const shortDate = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short' });
const longDate = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
});

export function rangeLabel(range: RangeState): string {
  if (range.preset !== 'custom') {
    return RANGE_PRESETS.find((option) => option.preset === range.preset)?.label ?? '';
  }
  const from = range.from ? localDay(range.from, false) : null;
  const to = range.to ? localDay(range.to, false) : null;
  if (from && to) {
    const sameYear = from.getFullYear() === to.getFullYear();
    return `${(sameYear ? shortDate : longDate).format(from)} – ${longDate.format(to)}`;
  }
  if (from) return `From ${longDate.format(from)}`;
  if (to) return `Until ${longDate.format(to)}`;
  return 'Custom range';
}

export function browserTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}
