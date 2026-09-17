import { lazy, Suspense, useState } from 'react';
import { Button } from '../../components/ui/Button';
import { IconLeaf } from '../../components/ui/Icons';
import { LoadingRegion, Skeleton } from '../../components/ui/Skeleton';
import { EmptyState, ErrorState } from '../../components/ui/States';
import {
  METRICS,
  METRIC_KEYS,
  RAW_POINTS_LIMIT,
  RECENT_SAMPLES_COUNT,
  type MetricKey,
} from '../../lib/constants';
import { formatDateTime, formatNumber } from '../../lib/format';
import { useSamples, useStats } from '../../lib/queries';
import { rangeLabel } from '../../lib/range';
import { useFilters } from '../../lib/useFilters';
import { ChartPlaceholder, ChartSection } from './ChartSection';
import { DailyAveragesTable, DailyCountsTable, RawReadingsTable } from './ChartTables';
import { dailyChartData, dailySummary, rawChartData, readingsSummary } from './chartData';
import { KpiCards } from './KpiCards';
import { LatestSample } from './LatestSample';
import { RecentStrip } from './RecentStrip';

// Recharts is only downloaded once a chart is actually shown.
const ReadingsCharts = lazy(() => import('./ReadingsCharts'));
const DailyChart = lazy(() => import('./DailyChart'));

function OverviewSkeleton() {
  return (
    <LoadingRegion label="Loading overview" className="space-y-6">
      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-5">
        {Array.from({ length: 5 }, (_, index) => (
          <Skeleton key={index} className="h-[6.5rem]" />
        ))}
      </div>
      <div className="grid gap-6 lg:grid-cols-2">
        <Skeleton className="h-80" />
        <Skeleton className="h-80" />
      </div>
      <Skeleton className="h-56" />
    </LoadingRegion>
  );
}

function MetricToggles({
  visible,
  onToggle,
}: {
  visible: Record<MetricKey, boolean>;
  onToggle: (key: MetricKey) => void;
}) {
  return (
    <div role="group" aria-label="Metrics shown in the chart" className="flex flex-wrap gap-2">
      {METRIC_KEYS.map((key) => (
        <button
          key={key}
          type="button"
          aria-pressed={visible[key]}
          onClick={() => {
            onToggle(key);
          }}
          className={`inline-flex min-h-11 items-center gap-2 rounded-full border px-3 text-sm font-medium transition-colors ${
            visible[key]
              ? 'border-border-strong bg-surface-muted text-ink'
              : 'border-border bg-surface text-ink-muted line-through'
          }`}
        >
          <span
            aria-hidden="true"
            className={`block h-0.5 w-4 rounded ${visible[key] ? '' : 'opacity-40'}`}
            style={{ backgroundColor: `var(${METRICS[key].cssVar})` }}
          />
          {METRICS[key].label}
        </button>
      ))}
    </div>
  );
}

export default function OverviewPage() {
  const { range, apiRange, timezone, setRange, linkSearch } = useFilters();
  const stats = useStats({ ...apiRange, tz: timezone });
  const data = stats.data;

  const useDaily = (data?.totals.samples ?? 0) > RAW_POINTS_LIMIT;
  const chartSamples = useSamples(
    { ...apiRange, limit: RAW_POINTS_LIMIT },
    { enabled: data !== undefined && data.totals.samples > 0 && !useDaily },
  );
  const recent = useSamples(
    { ...apiRange, limit: RECENT_SAMPLES_COUNT },
    { enabled: data !== undefined && data.totals.samples > 0 },
  );
  const [visible, setVisible] = useState<Record<MetricKey, boolean>>({
    temperature: true,
    humidity: true,
    lux: true,
  });

  const label = rangeLabel(range);
  const header = (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-2">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Overview</h1>
        <p className="mt-1 text-sm text-ink-muted">{label}</p>
      </div>
    </div>
  );

  if (stats.isPending) {
    return (
      <>
        <title>Overview · Sylvan</title>
        {header}
        <OverviewSkeleton />
      </>
    );
  }

  if (stats.isError && !data) {
    return (
      <>
        <title>Overview · Sylvan</title>
        {header}
        <ErrorState
          error={stats.error}
          onRetry={() => {
            void stats.refetch();
          }}
          title="Could not load the overview"
        />
      </>
    );
  }

  if (!data) return null;

  if (data.totals.samples === 0) {
    return (
      <>
        <title>Overview · Sylvan</title>
        {header}
        <EmptyState
          icon={<IconLeaf size={32} />}
          title={range.preset === 'all' ? 'No samples yet' : 'No samples in this range yet'}
          message={
            <>
              The rover uploads one each time it finds an object.
              {data.lastUploadAt && range.preset !== 'all' && (
                <> The last upload was on {formatDateTime(data.lastUploadAt)}.</>
              )}
            </>
          }
          action={
            range.preset !== 'all' && (
              <Button
                variant="primary"
                onClick={() => {
                  setRange({ preset: 'all' });
                }}
              >
                Show all time
              </Button>
            )
          }
        />
      </>
    );
  }

  const readingsData = useDaily
    ? dailyChartData(data.daily)
    : chartSamples.data
      ? rawChartData(chartSamples.data.items)
      : null;
  const hasReadings = data.totals.ok > 0;

  return (
    <>
      <title>Overview · Sylvan</title>
      {header}
      <div className="space-y-6">
        <section aria-label="Key figures">
          <KpiCards stats={data} />
        </section>

        <div className="grid gap-6 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
          {data.latest && <LatestSample sample={data.latest} linkSearch={linkSearch} />}

          <ChartSection
            id="readings"
            title="Readings over time"
            description={
              useDaily
                ? `Daily averages (more than ${formatNumber(RAW_POINTS_LIMIT)} samples in range)`
                : 'Each point is one sample; lines break across gaps of more than 6 hours'
            }
            summary={readingsSummary(data)}
            controls={
              hasReadings && (
                <MetricToggles
                  visible={visible}
                  onToggle={(key) => {
                    setVisible((current) => ({ ...current, [key]: !current[key] }));
                  }}
                />
              )
            }
            chart={
              !hasReadings ? (
                <p className="rounded-md bg-surface-muted p-6 text-center text-sm text-ink-muted">
                  Every sample in this range failed, so there are no readings to plot.
                </p>
              ) : chartSamples.isError && !readingsData ? (
                <ErrorState
                  error={chartSamples.error}
                  onRetry={() => {
                    void chartSamples.refetch();
                  }}
                  title="Could not load chart data"
                />
              ) : readingsData ? (
                <Suspense fallback={<ChartPlaceholder height={400} />}>
                  <ReadingsCharts data={readingsData} visible={visible} />
                </Suspense>
              ) : (
                <ChartPlaceholder height={400} />
              )
            }
            table={
              useDaily ? (
                <DailyAveragesTable data={data.daily} />
              ) : (
                <RawReadingsTable samples={chartSamples.data?.items ?? []} />
              )
            }
          />
        </div>

        <ChartSection
          id="daily"
          title="Samples per day"
          description={data.dailyTruncated ? 'Showing the most recent 366 days' : undefined}
          summary={dailySummary(data.daily)}
          controls={
            <p className="flex gap-4 text-xs text-ink-muted" aria-hidden="true">
              <span className="flex items-center gap-1.5">
                <span className="size-3 rounded-sm bg-ok" /> OK
              </span>
              <span className="flex items-center gap-1.5">
                <span className="size-3 rounded-sm bg-failed" /> Failed
              </span>
            </p>
          }
          chart={
            <Suspense fallback={<ChartPlaceholder height={200} />}>
              <DailyChart daily={data.daily} />
            </Suspense>
          }
          table={<DailyCountsTable data={data.daily} />}
        />

        <RecentStrip
          samples={recent.data?.items}
          isPending={recent.isPending}
          error={recent.error}
          onRetry={() => {
            void recent.refetch();
          }}
          linkSearch={linkSearch}
        />
      </div>
    </>
  );
}
