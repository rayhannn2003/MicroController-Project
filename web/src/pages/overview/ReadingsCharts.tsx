import {
  CartesianGrid,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Scatter,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { METRICS, type MetricKey } from '../../lib/constants';
import { formatDateTime, formatDay, formatReading, formatTime } from '../../lib/format';
import { useThemeColors } from '../../lib/theme';
import { timeTicks, type ChartRow } from '../../lib/segments';
import type { ReadingsChartData } from './chartData';

const HEIGHT = 220;

interface TooltipProps {
  active?: boolean;
  payload?: readonly { payload?: unknown }[];
}

interface Props {
  data: ReadingsChartData;
  visible: Record<MetricKey, boolean>;
}

function tickFormatter(domain: [number, number]) {
  const span = domain[1] - domain[0];
  return (value: number) =>
    span <= 36 * 60 * 60 * 1000
      ? formatTime(value)
      : formatDay(new Date(value).toLocaleDateString('en-CA'));
}

function ChartTooltip({
  active,
  payload,
  mode,
  metrics,
}: TooltipProps & { mode: 'raw' | 'daily'; metrics: MetricKey[] }) {
  if (!active || !payload?.length) return null;
  const row = payload[0]?.payload as Partial<ChartRow> & { marker?: 0; id?: number | null };
  if (row.time === undefined) return null;
  const isFailed = row.marker === 0;
  return (
    <div className="rounded-md border border-border bg-surface px-3 py-2 text-xs text-ink shadow-lg">
      <p className="font-semibold">
        {mode === 'daily'
          ? `${formatDay(new Date(row.time).toLocaleDateString('en-CA'))} (daily average)`
          : formatDateTime(row.time)}
      </p>
      {isFailed ? (
        <p className="text-failed">Sample #{row.id} failed: no readings</p>
      ) : (
        <>
          {row.id !== null && row.id !== undefined && (
            <p className="text-ink-muted">Sample #{row.id}</p>
          )}
          {metrics.map((key) =>
            row[key] === null || row[key] === undefined ? null : (
              <p key={key} className="tabular">
                {METRICS[key].label}: {formatReading(key, row[key])}
              </p>
            ),
          )}
        </>
      )}
    </div>
  );
}

function FailedMarkerShape(props: { cx?: number; cy?: number; fill?: string }) {
  const { cx = 0, cy = 0, fill } = props;
  return <path d={`M${cx - 5},${cy + 4} L${cx + 5},${cy + 4} L${cx},${cy - 5} Z`} fill={fill} />;
}

export default function ReadingsCharts({ data, visible }: Props) {
  const colors = useThemeColors();
  const times = [...data.rows.map((row) => row.time), ...data.failed.map((marker) => marker.time)];
  const min = Math.min(...times);
  const max = Math.max(...times);
  const pad = Math.max((max - min) * 0.03, 30 * 60 * 1000);
  const domain: [number, number] = [min - pad, max + pad];
  const formatTick = tickFormatter(domain);
  const ticks = timeTicks(domain);
  const dot = data.mode === 'raw' ? { r: 3, strokeWidth: 0 } : { r: 2, strokeWidth: 0 };
  const axisProps = {
    stroke: colors.inkMuted,
    tick: { fill: colors.inkMuted, fontSize: 12 },
    tickLine: false,
  };
  const tooltipCursor = { stroke: colors.border };

  const xAxis = (
    <XAxis
      dataKey="time"
      type="number"
      scale="time"
      domain={domain}
      ticks={ticks}
      tickFormatter={formatTick}
      interval="preserveStartEnd"
      minTickGap={16}
      {...axisProps}
    />
  );
  const failedMarkers = data.failed.length > 0 && (
    <Scatter
      yAxisId="marker"
      data={data.failed}
      dataKey="marker"
      fill={colors.failed}
      shape={<FailedMarkerShape />}
      isAnimationActive={false}
      name="Failed sample"
    />
  );
  // Hidden axis that pins failed-sample markers to the bottom; zero width so it takes no space.
  const markerAxis = <YAxis yAxisId="marker" hide width={0} orientation="right" domain={[0, 1]} />;
  const showTop = visible.temperature || visible.humidity;

  return (
    <div className="space-y-4">
      {showTop && (
        <div style={{ height: HEIGHT }}>
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart
              accessibilityLayer={false}
              data={data.rows}
              syncId="readings"
              syncMethod="value"
              margin={{ top: 8, right: 4, bottom: 0, left: -8 }}
            >
              <CartesianGrid stroke={colors.grid} vertical={false} />
              {xAxis}
              <YAxis
                yAxisId="temperature"
                hide={!visible.temperature}
                domain={['auto', 'auto']}
                width={44}
                unit="°"
                {...axisProps}
              />
              <YAxis
                yAxisId="humidity"
                orientation="right"
                hide={!visible.humidity}
                domain={[0, 100]}
                width={40}
                unit="%"
                {...axisProps}
              />
              {markerAxis}
              <Tooltip
                cursor={tooltipCursor}
                content={(props) => (
                  <ChartTooltip
                    active={props.active}
                    payload={props.payload}
                    mode={data.mode}
                    metrics={['temperature', 'humidity']}
                  />
                )}
              />
              {visible.temperature && (
                <Line
                  yAxisId="temperature"
                  dataKey="temperature"
                  stroke={colors.temperature}
                  fill={colors.temperature}
                  strokeWidth={2}
                  dot={{ ...dot, fill: colors.temperature }}
                  activeDot={{ r: 5 }}
                  connectNulls={false}
                  isAnimationActive={false}
                  name="Temperature"
                />
              )}
              {visible.humidity && (
                <Line
                  yAxisId="humidity"
                  dataKey="humidity"
                  stroke={colors.humidity}
                  fill={colors.humidity}
                  strokeWidth={2}
                  strokeDasharray="6 3"
                  dot={{ ...dot, fill: colors.humidity }}
                  activeDot={{ r: 5 }}
                  connectNulls={false}
                  isAnimationActive={false}
                  name="Humidity"
                />
              )}
              {failedMarkers}
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      )}
      {visible.lux && (
        <div style={{ height: HEIGHT - 40 }}>
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart
              accessibilityLayer={false}
              data={data.rows}
              syncId="readings"
              syncMethod="value"
              margin={{ top: 8, right: 4, bottom: 0, left: -8 }}
            >
              <CartesianGrid stroke={colors.grid} vertical={false} />
              {xAxis}
              <YAxis
                yAxisId="lux"
                domain={[0, 'auto']}
                width={52}
                tickFormatter={(value: number) =>
                  value >= 1000 ? `${Math.round(value / 100) / 10}k` : String(value)
                }
                {...axisProps}
              />
              {markerAxis}
              <Tooltip
                cursor={tooltipCursor}
                content={(props) => (
                  <ChartTooltip
                    active={props.active}
                    payload={props.payload}
                    mode={data.mode}
                    metrics={['lux']}
                  />
                )}
              />
              <Line
                yAxisId="lux"
                dataKey="lux"
                stroke={colors.lux}
                fill={colors.lux}
                strokeWidth={2}
                dot={{ ...dot, fill: colors.lux }}
                activeDot={{ r: 5 }}
                connectNulls={false}
                isAnimationActive={false}
                name="Light"
              />
              {failedMarkers}
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}
