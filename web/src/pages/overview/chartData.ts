import type { DailyStats, Sample, StatsResponse } from '@sylvan/shared';
import { formatDay, formatNumber, formatReading } from '../../lib/format';
import { splitIntoSegments, segmentsToRows, type ChartRow } from '../../lib/segments';

export interface FailedMarker {
  time: number;
  id: number;
  marker: 0;
}

export interface ReadingsChartData {
  mode: 'raw' | 'daily';
  rows: ChartRow[];
  failed: FailedMarker[];
}

export function rawChartData(samples: Sample[]): ReadingsChartData {
  return {
    mode: 'raw',
    rows: segmentsToRows(splitIntoSegments(samples)),
    failed: samples
      .filter((sample) => !sample.ok)
      .map((sample) => ({ time: new Date(sample.createdAt).getTime(), id: sample.id, marker: 0 })),
  };
}

/** Daily averages placed at local noon; days without samples are null so the line breaks. */
export function dailyChartData(daily: DailyStats[]): ReadingsChartData {
  return {
    mode: 'daily',
    rows: daily.map((day) => {
      const [y, m, d] = day.date.split('-').map(Number) as [number, number, number];
      return {
        time: new Date(y, m - 1, d, 12).getTime(),
        id: null,
        temperature: day.avgTemperature,
        humidity: day.avgHumidity,
        lux: day.avgLux,
      };
    }),
    failed: [],
  };
}

const plural = (count: number, word: string) =>
  `${formatNumber(count)} ${word}${count === 1 ? '' : 's'}`;

/** Plain-language summary of the readings chart for screen readers and quick scanning. */
export function readingsSummary(stats: StatsResponse): string {
  const { totals, metrics } = stats;
  if (totals.ok === 0) {
    return totals.failed > 0
      ? `No successful readings in this range; ${plural(totals.failed, 'failed sample')}.`
      : 'No readings in this range.';
  }
  const describe = (label: string, key: 'temperature' | 'humidity' | 'lux') => {
    const metric = metrics[key];
    if (metric.min === metric.max) return `${label} ${formatReading(key, metric.min)}`;
    return `${label} ${formatReading(key, metric.min)} to ${formatReading(key, metric.max)} (average ${formatReading(key, metric.avg)})`;
  };
  const parts = [
    `${plural(totals.ok, 'successful reading')}.`,
    `${describe('Temperature', 'temperature')};`,
    `${describe('humidity', 'humidity')};`,
    `${describe('light', 'lux')}.`,
  ];
  if (totals.failed > 0) {
    parts.push(`${plural(totals.failed, 'failed sample')} marked on the time axis.`);
  }
  return parts.join(' ');
}

export function dailySummary(daily: DailyStats[]): string {
  if (daily.length === 0) return 'No days to show.';
  const active = daily.filter((day) => day.samples > 0);
  if (active.length === 0) return `No samples on any of the ${plural(daily.length, 'day')}.`;
  const busiest = active.reduce((best, day) => (day.samples > best.samples ? day : best));
  const failed = daily.reduce((sum, day) => sum + day.failed, 0);
  return (
    `Samples on ${formatNumber(active.length)} of ${plural(daily.length, 'day')}. ` +
    `Busiest day: ${formatDay(busiest.date)} with ${plural(busiest.samples, 'sample')}` +
    (failed > 0 ? `; ${plural(failed, 'failed sample')} in total.` : '.')
  );
}
