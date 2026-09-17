import type { StatsResponse } from '@sylvan/shared';
import type { ReactNode } from 'react';
import { periodDelta, type Delta } from '../../lib/compare';
import { METRICS, type MetricKey } from '../../lib/constants';
import { formatNumber, formatPercent, formatReading } from '../../lib/format';
import { METRIC_ICONS } from '../../components/ui/Readings';

function DeltaText({ delta, comparison }: { delta: Delta; comparison: string | null }) {
  if (comparison === null) {
    return <p className="mt-1 text-xs text-ink-muted">No comparison for all time</p>;
  }
  return (
    <p
      className={`mt-1 text-xs tabular ${delta.direction === 'none' ? 'text-ink-muted' : 'text-ink'}`}
    >
      <span aria-hidden="true">{delta.text}</span>
      <span className="sr-only">{delta.label}</span>
      {delta.direction !== 'none' && <span className="text-ink-muted"> {comparison}</span>}
    </p>
  );
}

function Kpi({
  label,
  value,
  icon,
  delta,
  comparison,
}: {
  label: string;
  value: string;
  icon?: ReactNode;
  delta: Delta;
  comparison: string | null;
}) {
  return (
    <div className="rounded-lg border border-border bg-surface p-4 shadow-card">
      <dt className="flex items-center gap-1.5 text-xs font-medium text-ink-muted sm:text-sm">
        {icon}
        {label}
      </dt>
      <dd className="mt-1 text-2xl font-semibold tracking-tight text-ink tabular">{value}</dd>
      <dd>
        <DeltaText delta={delta} comparison={comparison} />
      </dd>
    </div>
  );
}

export function KpiCards({ stats }: { stats: StatsResponse }) {
  const previous = stats.previousPeriod;
  const comparison = previous ? 'vs previous period' : null;
  const rate = (value: number | null | undefined) =>
    value === null || value === undefined ? null : value * 100;

  const metricKpi = (key: MetricKey, label: string) => {
    const Icon = METRIC_ICONS[key];
    const info = METRICS[key];
    return (
      <Kpi
        key={key}
        label={label}
        value={formatReading(key, stats.metrics[key].avg)}
        icon={<Icon size={16} className={info.textClass} />}
        delta={periodDelta(stats.metrics[key].avg, previous?.metrics[key].avg, {
          decimals: info.decimals,
          unit: key === 'humidity' ? 'pts' : info.unit,
        })}
        comparison={comparison}
      />
    );
  };

  return (
    <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 lg:grid-cols-5 [&>div:last-child]:col-span-2 sm:[&>div:last-child]:col-span-1">
      <Kpi
        label="Samples"
        value={formatNumber(stats.totals.samples)}
        delta={periodDelta(stats.totals.samples, previous?.totals.samples, {
          decimals: 0,
          unit: '',
        })}
        comparison={comparison}
      />
      <Kpi
        label="Success rate"
        value={formatPercent(stats.totals.successRate)}
        delta={periodDelta(rate(stats.totals.successRate), rate(previous?.totals.successRate), {
          decimals: 1,
          unit: 'pts',
        })}
        comparison={comparison}
      />
      {metricKpi('temperature', 'Avg temperature')}
      {metricKpi('humidity', 'Avg humidity')}
      {metricKpi('lux', 'Avg light')}
    </dl>
  );
}
