import { METRICS, type MetricKey } from './constants';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

const dateTimeFormat = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
});
const dateFormat = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
});
const dayFormat = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short' });
const timeFormat = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit' });

const toDate = (value: string | number | Date) => (value instanceof Date ? value : new Date(value));

/** "17 Sep 2026, 14:05" in the browser's timezone. */
export function formatDateTime(value: string | number | Date): string {
  return dateTimeFormat.format(toDate(value));
}

export function formatDate(value: string | number | Date): string {
  return dateFormat.format(toDate(value));
}

export function formatTime(value: string | number | Date): string {
  return timeFormat.format(toDate(value));
}

/** "2026-09-17 08:05:12 UTC" */
export function formatUtc(value: string | number | Date): string {
  return `${toDate(value).toISOString().slice(0, 19).replace('T', ' ')} UTC`;
}

/** Formats a `YYYY-MM-DD` calendar day as "17 Sep" without timezone shifts. */
export function formatDay(day: string): string {
  const [y, m, d] = day.split('-').map(Number) as [number, number, number];
  return dayFormat.format(new Date(y, m - 1, d));
}

/** Short relative time: "just now", "12 min ago", "3 h ago", "yesterday", "4 days ago". */
export function formatRelative(
  value: string | number | Date,
  now: number | Date = Date.now(),
): string {
  const diff = toDate(now).getTime() - toDate(value).getTime();
  if (diff < 45_000) return 'just now';
  if (diff < HOUR) return `${Math.max(1, Math.round(diff / MINUTE))} min ago`;
  if (diff < DAY) return `${Math.floor(diff / HOUR)} h ago`;
  if (diff < 2 * DAY) return 'yesterday';
  if (diff < 30 * DAY) return `${Math.floor(diff / DAY)} days ago`;
  return `on ${formatDate(value)}`;
}

const numberFormats = new Map<number, Intl.NumberFormat>();

export function formatNumber(value: number, decimals = 0): string {
  let format = numberFormats.get(decimals);
  if (!format) {
    format = new Intl.NumberFormat('en-GB', {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    });
    numberFormats.set(decimals, format);
  }
  // Use a true minus sign for readability.
  return format.format(value).replace('-', '−');
}

/** "24.5 °C", "66.0 %", "1,234 lx", or "—" when missing. */
export function formatReading(metric: MetricKey, value: number | null | undefined): string {
  if (value === null || value === undefined) return '—';
  const info = METRICS[metric];
  return `${formatNumber(value, info.decimals)} ${info.unit}`;
}

/** 0.8571 → "85.7%" */
export function formatPercent(fraction: number | null | undefined): string {
  if (fraction === null || fraction === undefined) return '—';
  return `${formatNumber(fraction * 100, Number.isInteger(fraction * 100) ? 0 : 1)}%`;
}

export function photoAlt(sample: { id: number; createdAt: string }): string {
  return `Rover photo for sample #${sample.id}, ${formatDateTime(sample.createdAt)}`;
}
