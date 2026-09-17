import type { DailyStats, Sample } from '@sylvan/shared';
import type { ReactNode } from 'react';
import { METRICS, METRIC_KEYS } from '../../lib/constants';
import { formatDateTime, formatDay, formatNumber, formatReading } from '../../lib/format';

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

export function RawReadingsTable({ samples }: { samples: Sample[] }) {
  return (
    <TableScroller label="Readings table">
      <table className={tableClass}>
        <caption className="sr-only">Readings for each sample in the selected range</caption>
        <thead className="sticky top-0 bg-surface">
          <tr>
            <th scope="col" className={thClass}>
              Time
            </th>
            <th scope="col" className={thClass}>
              Sample
            </th>
            {METRIC_KEYS.map((key) => (
              <th key={key} scope="col" className={thClass}>
                {METRICS[key].label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {samples.map((sample) => (
            <tr key={sample.id}>
              <td className={tdClass}>{formatDateTime(sample.createdAt)}</td>
              <td className={tdClass}>
                #{sample.id}
                {sample.ok ? '' : ' (failed)'}
              </td>
              {METRIC_KEYS.map((key) => (
                <td key={key} className={tdClass}>
                  {formatReading(key, sample[key])}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </TableScroller>
  );
}

export function DailyAveragesTable({ data }: { data: DailyStats[] }) {
  return (
    <TableScroller label="Daily averages table">
      <table className={tableClass}>
        <caption className="sr-only">Daily average readings</caption>
        <thead className="sticky top-0 bg-surface">
          <tr>
            <th scope="col" className={thClass}>
              Day
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
          {data.map((day) => (
            <tr key={day.date}>
              <td className={tdClass}>{formatDay(day.date)}</td>
              <td className={tdClass}>{formatNumber(day.samples)}</td>
              <td className={tdClass}>{formatReading('temperature', day.avgTemperature)}</td>
              <td className={tdClass}>{formatReading('humidity', day.avgHumidity)}</td>
              <td className={tdClass}>{formatReading('lux', day.avgLux)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </TableScroller>
  );
}

export function DailyCountsTable({ data }: { data: DailyStats[] }) {
  return (
    <TableScroller label="Samples per day table">
      <table className={tableClass}>
        <caption className="sr-only">Number of OK and failed samples per day</caption>
        <thead className="sticky top-0 bg-surface">
          <tr>
            <th scope="col" className={thClass}>
              Day
            </th>
            <th scope="col" className={thClass}>
              OK
            </th>
            <th scope="col" className={thClass}>
              Failed
            </th>
            <th scope="col" className={thClass}>
              Total
            </th>
          </tr>
        </thead>
        <tbody>
          {data.map((day) => (
            <tr key={day.date}>
              <td className={tdClass}>{formatDay(day.date)}</td>
              <td className={tdClass}>{formatNumber(day.ok)}</td>
              <td className={tdClass}>{formatNumber(day.failed)}</td>
              <td className={tdClass}>{formatNumber(day.samples)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </TableScroller>
  );
}
