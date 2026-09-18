import type { ExplorePoint } from '@sylvan/shared';
import {
  CartesianGrid,
  ReferenceArea,
  ResponsiveContainer,
  Scatter,
  ScatterChart as RechartsScatterChart,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { withAlpha } from '../../lib/color';
import { COMFORT_RANGES, METRICS, type MetricKey } from '../../lib/constants';
import { formatDateTime, formatReading } from '../../lib/format';
import { useThemeColors } from '../../lib/theme';
import { timePosition } from './exploreData';

const HEIGHT = 340;
const MIN_ALPHA = 0.28;

interface ScatterRow {
  id: number;
  at: string;
  x: number;
  y: number;
  fill: string;
}

interface TooltipProps {
  active?: boolean;
  payload?: readonly { payload?: unknown }[];
}

function ScatterTooltip({ active, payload, x, y }: TooltipProps & { x: MetricKey; y: MetricKey }) {
  if (!active || !payload?.length) return null;
  const row = payload[0]?.payload as Partial<ScatterRow> | undefined;
  if (!row?.at) return null;
  return (
    <div className="rounded-md border border-border bg-surface px-3 py-2 text-xs text-ink shadow-lg">
      <p className="font-semibold">Sample #{row.id}</p>
      <p className="text-ink-muted">{formatDateTime(row.at)}</p>
      <p className="tabular">
        {METRICS[x].label}: {formatReading(x, row.x)}
      </p>
      <p className="tabular">
        {METRICS[y].label}: {formatReading(y, row.y)}
      </p>
    </div>
  );
}

export default function ScatterPlot({
  points,
  x,
  y,
  onSelect,
}: {
  points: ExplorePoint[];
  x: MetricKey;
  y: MetricKey;
  onSelect: (id: number) => void;
}) {
  const colors = useThemeColors();
  const times = points.map((point) => new Date(point.at).getTime());
  const minTime = Math.min(...times);
  const maxTime = Math.max(...times);

  const rows: ScatterRow[] = points.map((point, index) => {
    const position = timePosition(times[index] ?? minTime, minTime, maxTime);
    return {
      id: point.id,
      at: point.at,
      x: point[x],
      y: point[y],
      fill: withAlpha(colors.brand, MIN_ALPHA + position * (1 - MIN_ALPHA)),
    };
  });

  const axisProps = {
    stroke: colors.inkMuted,
    tick: { fill: colors.inkMuted, fontSize: 12 },
    tickLine: false,
  };
  const xRange = COMFORT_RANGES[x];
  const yRange = COMFORT_RANGES[y];

  return (
    <div style={{ height: HEIGHT }}>
      <ResponsiveContainer width="100%" height="100%">
        <RechartsScatterChart
          accessibilityLayer={false}
          margin={{ top: 8, right: 12, bottom: 8, left: -8 }}
        >
          <CartesianGrid stroke={colors.grid} />
          <XAxis
            type="number"
            dataKey="x"
            name={METRICS[x].label}
            domain={['auto', 'auto']}
            unit={METRICS[x].unit}
            {...axisProps}
          />
          <YAxis
            type="number"
            dataKey="y"
            name={METRICS[y].label}
            domain={['auto', 'auto']}
            unit={METRICS[y].unit}
            width={56}
            {...axisProps}
          />
          <ReferenceArea
            x1={xRange.min}
            x2={xRange.max}
            y1={yRange.min}
            y2={yRange.max}
            fill={colors.brandSoft}
            fillOpacity={0.35}
            stroke="none"
            ifOverflow="hidden"
          />
          <Tooltip
            cursor={{ stroke: colors.border }}
            content={(props) => (
              <ScatterTooltip active={props.active} payload={props.payload} x={x} y={y} />
            )}
          />
          <Scatter
            data={rows}
            isAnimationActive={false}
            shape={(props: unknown) => {
              const point = props as { cx?: number; cy?: number; payload?: ScatterRow };
              return (
                <circle
                  cx={point.cx}
                  cy={point.cy}
                  r={4}
                  fill={point.payload?.fill ?? colors.brand}
                  stroke="none"
                  style={{ cursor: 'pointer' }}
                  onClick={() => {
                    if (point.payload) onSelect(point.payload.id);
                  }}
                />
              );
            }}
          />
        </RechartsScatterChart>
      </ResponsiveContainer>
    </div>
  );
}
