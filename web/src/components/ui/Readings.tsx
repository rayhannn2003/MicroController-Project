import type { Sample } from '@sylvan/shared';
import { METRICS, METRIC_KEYS, type MetricKey } from '../../lib/constants';
import { formatReading } from '../../lib/format';
import { IconDroplet, IconLight, IconThermometer } from './Icons';

export const METRIC_ICONS: Record<MetricKey, typeof IconThermometer> = {
  temperature: IconThermometer,
  humidity: IconDroplet,
  lux: IconLight,
};

type ReadingValues = Pick<Sample, 'ok' | 'temperature' | 'humidity' | 'lux'>;

/** Compact one-line readings for cards: "24.5 °C · 61.0 % · 820 lx". */
export function CompactReadings({
  sample,
  className = '',
}: {
  sample: ReadingValues;
  className?: string;
}) {
  if (!sample.ok) {
    return <p className={`text-xs text-ink-muted ${className}`}>Sensor read failed</p>;
  }
  return (
    <dl className={`flex flex-wrap gap-x-3 gap-y-1 text-xs tabular ${className}`}>
      {METRIC_KEYS.map((key) => {
        const Icon = METRIC_ICONS[key];
        return (
          <div key={key} className="flex items-center gap-1">
            <dt>
              <Icon size={14} className={METRICS[key].textClass} />
              <span className="sr-only">{METRICS[key].label}</span>
            </dt>
            <dd className="text-ink">{formatReading(key, sample[key])}</dd>
          </div>
        );
      })}
    </dl>
  );
}

/** Large readings with labels, used by the latest sample, lightbox and detail page. */
const LIST_LAYOUTS = {
  /** Always one tile per row. */
  stack: 'grid-cols-1',
  /** Three tiles side by side once there is room. */
  row: 'grid-cols-1 min-[400px]:grid-cols-3',
  /** Side by side on phones, stacked in a narrow sidebar on wider screens. */
  sidebar: 'grid-cols-1 min-[400px]:grid-cols-3 md:grid-cols-1',
};

export function ReadingList({
  sample,
  notes,
  layout = 'row',
  className = '',
}: {
  sample: ReadingValues;
  notes?: Partial<Record<MetricKey, string | null>>;
  layout?: keyof typeof LIST_LAYOUTS;
  className?: string;
}) {
  if (!sample.ok) {
    return (
      <p className={`rounded-md bg-failed-soft p-4 text-sm text-ink ${className}`}>
        The rover's sensor read failed for this sample, so there are no readings.
      </p>
    );
  }
  return (
    <dl className={`grid gap-2 ${LIST_LAYOUTS[layout]} ${className}`}>
      {METRIC_KEYS.map((key) => {
        const Icon = METRIC_ICONS[key];
        const note = notes?.[key];
        return (
          <div key={key} className="rounded-md bg-surface-muted px-3 py-2">
            <dt className="flex items-center gap-1.5 text-xs font-medium text-ink-muted">
              <Icon size={16} className={METRICS[key].textClass} />
              {METRICS[key].label}
            </dt>
            <dd className="mt-0.5 text-xl font-semibold text-ink tabular">
              {formatReading(key, sample[key])}
            </dd>
            {note && <dd className="text-xs text-ink-muted">{note}</dd>}
          </div>
        );
      })}
    </dl>
  );
}
