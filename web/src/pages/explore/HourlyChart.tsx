import type { ExploreHourlyBucket } from '@sylvan/shared';
import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { METRICS, MIN_RELIABLE_HOURLY_SAMPLES, type MetricKey } from '../../lib/constants';
import { formatNumber, formatReading } from '../../lib/format';
import { useThemeColors } from '../../lib/theme';

const HEIGHT = 260;

interface Row extends ExploreHourlyBucket {
  barOpacity: number;
}

function hourLabel(hour: number): string {
  if (hour === 0) return '12am';
  if (hour === 12) return '12pm';
  return hour < 12 ? `${String(hour)}am` : `${String(hour - 12)}pm`;
}

function HourlyTooltip({
  active,
  payload,
  metric,
}: {
  active?: boolean;
  payload?: readonly { payload?: unknown }[];
  metric: MetricKey;
}) {
  if (!active || !payload?.length) return null;
  const row = payload[0]?.payload as ExploreHourlyBucket | undefined;
  if (!row) return null;
  const reliable = row.count >= MIN_RELIABLE_HOURLY_SAMPLES;
  const avg =
    metric === 'temperature'
      ? row.avgTemperature
      : metric === 'humidity'
        ? row.avgHumidity
        : row.avgLux;
  return (
    <div className="rounded-md border border-border bg-surface px-3 py-2 text-xs text-ink shadow-lg">
      <p className="font-semibold">{hourLabel(row.hour)}</p>
      <p className="tabular">
        {formatNumber(row.count)} sample{row.count === 1 ? '' : 's'}
        {!reliable && row.count > 0 && ' (few samples)'}
      </p>
      {row.count > 0 && (
        <p className="tabular">
          Average {METRICS[metric].label.toLowerCase()}: {formatReading(metric, avg)}
        </p>
      )}
    </div>
  );
}

export default function HourlyChart({
  hourly,
  metric,
}: {
  hourly: ExploreHourlyBucket[];
  metric: MetricKey;
}) {
  const colors = useThemeColors();
  const axisProps = {
    stroke: colors.inkMuted,
    tick: { fill: colors.inkMuted, fontSize: 11 },
    tickLine: false,
  };
  const avgKey =
    metric === 'temperature' ? 'avgTemperature' : metric === 'humidity' ? 'avgHumidity' : 'avgLux';
  const rows = hourly.map((bucket) => ({
    ...bucket,
    // Thin bars for hours with too few samples to trust, so the eye is drawn to the reliable ones.
    barOpacity: bucket.count >= MIN_RELIABLE_HOURLY_SAMPLES ? 1 : 0.35,
  }));

  return (
    <div style={{ height: HEIGHT }}>
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart
          accessibilityLayer={false}
          data={rows}
          margin={{ top: 8, right: 24, bottom: 0, left: -8 }}
        >
          <CartesianGrid stroke={colors.grid} vertical={false} />
          <XAxis dataKey="hour" tickFormatter={hourLabel} interval={1} {...axisProps} />
          <YAxis yAxisId="count" allowDecimals={false} width={32} {...axisProps} />
          <YAxis
            yAxisId="avg"
            orientation="right"
            width={48}
            {...axisProps}
            domain={['auto', 'auto']}
          />
          <Tooltip
            content={(props) => (
              <HourlyTooltip active={props.active} payload={props.payload} metric={metric} />
            )}
          />
          <Bar
            yAxisId="count"
            dataKey="count"
            isAnimationActive={false}
            maxBarSize={18}
            fill={colors.grid}
            shape={(props: unknown) => {
              const bar = props as {
                x?: number;
                y?: number;
                width?: number;
                height?: number;
                payload?: Row;
              };
              return (
                <rect
                  x={bar.x}
                  y={bar.y}
                  width={bar.width}
                  height={bar.height}
                  fill={colors.grid}
                  fillOpacity={bar.payload?.barOpacity ?? 1}
                />
              );
            }}
          />
          <Line
            yAxisId="avg"
            type="monotone"
            dataKey={avgKey}
            stroke={`var(${METRICS[metric].cssVar})`}
            strokeWidth={2}
            dot={{ r: 3 }}
            connectNulls
            isAnimationActive={false}
          />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
