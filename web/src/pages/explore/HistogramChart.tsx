import type { Histogram } from '@sylvan/shared';
import {
  Bar,
  BarChart,
  CartesianGrid,
  ReferenceArea,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { COMFORT_RANGES, METRICS, type MetricKey } from '../../lib/constants';
import { formatNumber, formatReading } from '../../lib/format';
import { useThemeColors } from '../../lib/theme';

const HEIGHT = 180;

interface Row {
  label: string;
  from: number;
  to: number;
  count: number;
}

function toRows(histogram: Histogram): Row[] {
  return histogram.bins.map((bin) => ({
    label: bin.from.toString(),
    from: bin.from,
    to: bin.to,
    count: bin.count,
  }));
}

function HistogramTooltip({
  active,
  payload,
  metric,
}: {
  active?: boolean;
  payload?: readonly { payload?: unknown }[];
  metric: MetricKey;
}) {
  if (!active || !payload?.length) return null;
  const row = payload[0]?.payload as Row | undefined;
  if (!row) return null;
  const range =
    row.from === row.to
      ? formatReading(metric, row.from)
      : `${formatReading(metric, row.from)} – ${formatReading(metric, row.to)}`;
  return (
    <div className="rounded-md border border-border bg-surface px-3 py-2 text-xs text-ink shadow-lg">
      <p className="font-semibold">{range}</p>
      <p className="tabular">{formatNumber(row.count)} samples</p>
    </div>
  );
}

export default function HistogramChart({
  metric,
  histogram,
}: {
  metric: MetricKey;
  histogram: Histogram;
}) {
  const colors = useThemeColors();
  const axisProps = {
    stroke: colors.inkMuted,
    tick: { fill: colors.inkMuted, fontSize: 11 },
    tickLine: false,
  };
  const rows = toRows(histogram);
  const range = COMFORT_RANGES[metric];
  const fill = `var(${METRICS[metric].cssVar})`;

  return (
    <div style={{ height: HEIGHT }}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart
          accessibilityLayer={false}
          data={rows}
          margin={{ top: 4, right: 4, bottom: 0, left: -20 }}
        >
          <CartesianGrid stroke={colors.grid} vertical={false} />
          <XAxis
            dataKey="from"
            type="number"
            domain={[histogram.min, histogram.max]}
            tickFormatter={(value: number) => formatNumber(value, METRICS[metric].decimals)}
            {...axisProps}
          />
          <YAxis allowDecimals={false} width={36} {...axisProps} />
          <ReferenceArea
            x1={Math.max(range.min, histogram.min)}
            x2={Math.min(range.max, histogram.max)}
            fill={colors.brandSoft}
            fillOpacity={0.4}
            stroke="none"
            ifOverflow="hidden"
          />
          <Tooltip
            cursor={{ fill: colors.grid }}
            content={(props) => (
              <HistogramTooltip active={props.active} payload={props.payload} metric={metric} />
            )}
          />
          <Bar dataKey="count" fill={fill} isAnimationActive={false} maxBarSize={36} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
