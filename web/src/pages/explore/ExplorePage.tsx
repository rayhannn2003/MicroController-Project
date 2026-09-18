import { lazy, Suspense, useState } from 'react';
import { useNavigate } from 'react-router';
import { IconExplore } from '../../components/ui/Icons';
import { LoadingRegion, Skeleton } from '../../components/ui/Skeleton';
import { EmptyState, ErrorState } from '../../components/ui/States';
import {
  COMFORT_RANGES,
  DEFAULT_HISTOGRAM_BINS,
  HISTOGRAM_BIN_OPTIONS,
  METRICS,
  METRIC_KEYS,
  type MetricKey,
} from '../../lib/constants';
import { correlationText } from '../../lib/correlation';
import { formatNumber, formatPercent, formatReading } from '../../lib/format';
import { useExplore } from '../../lib/queries';
import { rangeLabel } from '../../lib/range';
import { useFilters } from '../../lib/useFilters';
import { ChartPlaceholder, ChartSection } from '../overview/ChartSection';
import { correlationForPair, metricSummary, percentWithinRange } from './exploreData';
import { HistogramTable, HourlyTable, ScatterTable } from './ExploreTables';

// Recharts is only downloaded once a chart actually renders.
const ScatterPlot = lazy(() => import('./ScatterChart'));
const HistogramChart = lazy(() => import('./HistogramChart'));
const HourlyChart = lazy(() => import('./HourlyChart'));

function ExploreSkeleton() {
  return (
    <LoadingRegion label="Loading explore analytics" className="space-y-6">
      <Skeleton className="h-96" />
      <div className="grid gap-6 lg:grid-cols-3">
        <Skeleton className="h-56" />
        <Skeleton className="h-56" />
        <Skeleton className="h-56" />
      </div>
      <Skeleton className="h-72" />
    </LoadingRegion>
  );
}

function MetricSelect({
  id,
  label,
  value,
  onChange,
}: {
  id: string;
  label: string;
  value: MetricKey;
  onChange: (value: MetricKey) => void;
}) {
  return (
    <label htmlFor={id} className="flex items-center gap-2 text-sm text-ink-muted">
      {label}
      <select
        id={id}
        value={value}
        onChange={(event) => {
          onChange(event.target.value as MetricKey);
        }}
        className="min-h-11 rounded-md border border-border-strong bg-surface px-2 text-sm text-ink"
      >
        {METRIC_KEYS.map((key) => (
          <option key={key} value={key}>
            {METRICS[key].label}
          </option>
        ))}
      </select>
    </label>
  );
}

export default function ExplorePage() {
  const navigate = useNavigate();
  const { range, apiRange, timezone } = useFilters();
  const [bins, setBins] = useState(DEFAULT_HISTOGRAM_BINS);
  const [xMetric, setXMetric] = useState<MetricKey>('lux');
  const [yMetric, setYMetric] = useState<MetricKey>('humidity');
  const [hourlyMetric, setHourlyMetric] = useState<MetricKey>('temperature');

  const explore = useExplore({ ...apiRange, tz: timezone, bins });
  const data = explore.data;

  const header = (
    <div className="mb-6">
      <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Explore</h1>
      <p className="mt-1 text-sm text-ink-muted">{rangeLabel(range)}</p>
    </div>
  );

  if (explore.isPending) {
    return (
      <>
        <title>Explore · Sylvan</title>
        {header}
        <ExploreSkeleton />
      </>
    );
  }

  if (explore.isError && !data) {
    return (
      <>
        <title>Explore · Sylvan</title>
        {header}
        <ErrorState
          error={explore.error}
          onRetry={() => {
            void explore.refetch();
          }}
          title="Could not load explore analytics"
        />
      </>
    );
  }

  if (!data) return null;

  if (data.count === 0) {
    return (
      <>
        <title>Explore · Sylvan</title>
        {header}
        <EmptyState
          icon={<IconExplore size={32} />}
          title="No successful readings in this range yet"
          message="Explore needs samples with readings to chart. Try a longer range, such as All time."
        />
      </>
    );
  }

  const correlation = correlationForPair(data.correlations, xMetric, yMetric);

  return (
    <>
      <title>Explore · Sylvan</title>
      {header}
      <div className="space-y-6">
        <ChartSection
          id="scatter"
          title="Compare two readings"
          summary={`${formatNumber(data.count)} samples with readings. ${correlationText(correlation)}`}
          controls={
            <div className="space-y-3">
              <div className="flex flex-wrap items-center gap-3">
                <MetricSelect id="scatter-x" label="X axis" value={xMetric} onChange={setXMetric} />
                <MetricSelect id="scatter-y" label="Y axis" value={yMetric} onChange={setYMetric} />
              </div>
              <p className="flex items-center gap-2 text-xs text-ink-muted">
                <span
                  aria-hidden="true"
                  className="h-2 w-16 rounded-full"
                  style={{
                    background:
                      'linear-gradient(to right, color-mix(in srgb, var(--brand) 28%, transparent), var(--brand))',
                  }}
                />
                Point color: older → newer sample
              </p>
              <p className="text-xs text-ink-muted">
                Correlation does not imply causation. Samples are collected wherever the rover
                stops, so they are not a random sample of the area.
              </p>
              {data.pointsTruncated && (
                <p className="text-xs text-ink-muted">
                  Showing {formatNumber(data.points.length)} of {formatNumber(data.count)} samples,
                  evenly spread across the range.
                </p>
              )}
            </div>
          }
          chart={
            <Suspense fallback={<ChartPlaceholder height={340} />}>
              <ScatterPlot
                points={data.points}
                x={xMetric}
                y={yMetric}
                onSelect={(id) => {
                  void navigate(`/samples/${id}`);
                }}
              />
            </Suspense>
          }
          table={<ScatterTable points={data.points} x={xMetric} y={yMetric} />}
        />

        <section aria-labelledby="histograms-heading">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <h2 id="histograms-heading" className="text-lg font-semibold text-ink">
              Distributions
            </h2>
            <div
              role="group"
              aria-label="Number of bins"
              className="inline-flex rounded-md border border-border bg-surface-muted p-0.5"
            >
              {HISTOGRAM_BIN_OPTIONS.map((option) => (
                <button
                  key={option}
                  type="button"
                  aria-pressed={bins === option}
                  onClick={() => {
                    setBins(option);
                  }}
                  className={`min-h-10 rounded-sm px-3 text-sm font-medium transition-colors ${
                    bins === option
                      ? 'bg-surface text-ink shadow-card'
                      : 'text-ink-muted hover:text-ink'
                  }`}
                >
                  {option}
                </button>
              ))}
            </div>
          </div>
          <div className="grid gap-4 lg:grid-cols-3">
            {METRIC_KEYS.map((key) => {
              const histogram = data.histograms[key];
              const percent = percentWithinRange(histogram, COMFORT_RANGES[key]);
              const summary = metricSummary(data.points, key);
              const summaryText =
                summary === null
                  ? 'No data.'
                  : `Min ${formatReading(key, summary.min)}, average ${formatReading(key, summary.avg)}, max ${formatReading(key, summary.max)}. ${
                      percent === null
                        ? ''
                        : `${formatPercent(percent)} within the general guideline range.`
                    }`;
              return (
                <ChartSection
                  key={key}
                  id={`hist-${key}`}
                  title={METRICS[key].label}
                  summary={summaryText}
                  chart={
                    <Suspense fallback={<ChartPlaceholder height={180} />}>
                      <HistogramChart metric={key} histogram={histogram} />
                    </Suspense>
                  }
                  table={<HistogramTable metric={key} histogram={histogram} />}
                />
              );
            })}
          </div>
          <p className="mt-2 text-xs text-ink-muted">
            Shaded bands are general indoor-plant guideline ranges, not measured thresholds — plant
            species vary. Bin edges are rounded for readability.
          </p>
        </section>

        <ChartSection
          id="hourly"
          title="Daily pattern"
          description="Average reading by hour of day, in your local timezone"
          summary={`Bars show how many samples fall in each hour; hours with fewer than ${formatNumber(3)} samples are shown lighter and are less reliable.`}
          controls={
            <MetricSelect
              id="hourly-metric"
              label="Metric"
              value={hourlyMetric}
              onChange={setHourlyMetric}
            />
          }
          chart={
            <Suspense fallback={<ChartPlaceholder height={260} />}>
              <HourlyChart hourly={data.hourly} metric={hourlyMetric} />
            </Suspense>
          }
          table={<HourlyTable hourly={data.hourly} />}
        />
      </div>
    </>
  );
}
