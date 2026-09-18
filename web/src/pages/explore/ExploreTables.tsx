import type { ExploreHourlyBucket, ExplorePoint, Histogram } from '@sylvan/shared';
import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { METRICS, MIN_RELIABLE_HOURLY_SAMPLES, type MetricKey } from '../../lib/constants';
import { formatDateTime, formatNumber, formatReading } from '../../lib/format';

const tableClass = 'w-full text-left text-sm tabular';
const thClass = 'border-b border-border px-2 py-2 font-semibold text-ink-muted';
const tdClass = 'border-b border-border px-2 py-2';

function TableScroller({ children, label }: { children: ReactNode; label: string }) {
  return (
    <div
      className="max-h-96 overflow-auto rounded-md border border-border"
      tabIndex={0}
      role="region"
      aria-label={label}
    >
      {children}
    </div>
  );
}

export function ScatterTable({
  points,
  x,
  y,
}: {
  points: ExplorePoint[];
  x: MetricKey;
  y: MetricKey;
}) {
  return (
    <TableScroller label="Scatter data table">
      <table className={tableClass}>
        <caption className="sr-only">
          {METRICS[x].label} versus {METRICS[y].label} for each sample
        </caption>
        <thead className="sticky top-0 bg-surface">
          <tr>
            <th scope="col" className={thClass}>
              Sample
            </th>
            <th scope="col" className={thClass}>
              Time
            </th>
            <th scope="col" className={thClass}>
              {METRICS[x].label}
            </th>
            <th scope="col" className={thClass}>
              {METRICS[y].label}
            </th>
          </tr>
        </thead>
        <tbody>
          {points.map((point) => (
            <tr key={point.id}>
              <td className={tdClass}>
                <Link
                  to={`/samples/${point.id}`}
                  className="inline-flex min-h-11 items-center rounded-sm font-semibold text-brand hover:underline"
                >
                  #{point.id}
                </Link>
              </td>
              <td className={tdClass}>{formatDateTime(point.at)}</td>
              <td className={tdClass}>{formatReading(x, point[x])}</td>
              <td className={tdClass}>{formatReading(y, point[y])}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </TableScroller>
  );
}

export function HistogramTable({ metric, histogram }: { metric: MetricKey; histogram: Histogram }) {
  return (
    <TableScroller label={`${METRICS[metric].label} distribution table`}>
      <table className={tableClass}>
        <caption className="sr-only">{METRICS[metric].label} distribution</caption>
        <thead className="sticky top-0 bg-surface">
          <tr>
            <th scope="col" className={thClass}>
              Range
            </th>
            <th scope="col" className={thClass}>
              Samples
            </th>
          </tr>
        </thead>
        <tbody>
          {histogram.bins.map((bin, index) => (
            <tr key={index}>
              <td className={tdClass}>
                {bin.from === bin.to
                  ? formatReading(metric, bin.from)
                  : `${formatReading(metric, bin.from)} – ${formatReading(metric, bin.to)}`}
              </td>
              <td className={tdClass}>{formatNumber(bin.count)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </TableScroller>
  );
}

export function HourlyTable({ hourly }: { hourly: ExploreHourlyBucket[] }) {
  return (
    <TableScroller label="Daily pattern table">
      <table className={tableClass}>
        <caption className="sr-only">Average readings by hour of day</caption>
        <thead className="sticky top-0 bg-surface">
          <tr>
            <th scope="col" className={thClass}>
              Hour
            </th>
            <th scope="col" className={thClass}>
              Samples
            </th>
            <th scope="col" className={thClass}>
              Temperature
            </th>
            <th scope="col" className={thClass}>
              Humidity
            </th>
            <th scope="col" className={thClass}>
              Light
            </th>
          </tr>
        </thead>
        <tbody>
          {hourly.map((row) => (
            <tr
              key={row.hour}
              className={row.count < MIN_RELIABLE_HOURLY_SAMPLES ? 'text-ink-muted' : undefined}
            >
              <td className={tdClass}>{row.hour.toString().padStart(2, '0')}:00</td>
              <td className={tdClass}>
                {formatNumber(row.count)}
                {row.count > 0 && row.count < MIN_RELIABLE_HOURLY_SAMPLES ? ' (few)' : ''}
              </td>
              <td className={tdClass}>{formatReading('temperature', row.avgTemperature)}</td>
              <td className={tdClass}>{formatReading('humidity', row.avgHumidity)}</td>
              <td className={tdClass}>{formatReading('lux', row.avgLux)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </TableScroller>
  );
}
