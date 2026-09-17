import type { DailyStats } from '@sylvan/shared';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { formatDay, formatNumber } from '../../lib/format';
import { useThemeColors } from '../../lib/theme';

function DailyTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: readonly { payload?: unknown }[];
}) {
  if (!active || !payload?.length) return null;
  const day = payload[0]?.payload as DailyStats;
  return (
    <div className="rounded-md border border-border bg-surface px-3 py-2 text-xs text-ink shadow-lg">
      <p className="font-semibold">{formatDay(day.date)}</p>
      <p className="tabular">OK: {formatNumber(day.ok)}</p>
      <p className="tabular">Failed: {formatNumber(day.failed)}</p>
    </div>
  );
}

export default function DailyChart({ daily }: { daily: DailyStats[] }) {
  const colors = useThemeColors();
  const axis = {
    stroke: colors.inkMuted,
    tick: { fill: colors.inkMuted, fontSize: 12 },
    tickLine: false,
  };
  return (
    <div style={{ height: 200 }}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart
          accessibilityLayer={false}
          data={daily}
          margin={{ top: 8, right: 4, bottom: 0, left: -20 }}
        >
          <CartesianGrid stroke={colors.grid} vertical={false} />
          <XAxis dataKey="date" tickFormatter={formatDay} minTickGap={16} {...axis} />
          <YAxis allowDecimals={false} width={40} {...axis} />
          <Tooltip
            cursor={{ fill: colors.grid }}
            content={(props) => <DailyTooltip active={props.active} payload={props.payload} />}
          />
          <Bar
            dataKey="ok"
            stackId="samples"
            fill={colors.ok}
            name="OK"
            isAnimationActive={false}
            maxBarSize={40}
          />
          <Bar
            dataKey="failed"
            stackId="samples"
            fill={colors.failed}
            name="Failed"
            radius={[3, 3, 0, 0]}
            isAnimationActive={false}
            maxBarSize={40}
          />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
