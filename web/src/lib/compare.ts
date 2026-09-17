import { METRICS, type MetricKey } from './constants';
import { formatNumber } from './format';

const round = (value: number, decimals: number) => {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
};

/**
 * Describes how a reading compares with the range average, e.g. "+2.1 °C above average" or
 * "18% below average light". Returns null when either value is missing.
 */
export function compareToAverage(
  metric: MetricKey,
  value: number | null | undefined,
  average: number | null | undefined,
): string | null {
  if (value === null || value === undefined || average === null || average === undefined) {
    return null;
  }

  if (metric === 'lux') {
    if (average === 0) {
      const diff = Math.round(value);
      if (diff === 0) return 'Same as average light';
      return `${formatNumber(Math.abs(diff))} lx ${diff > 0 ? 'above' : 'below'} average light`;
    }
    const percent = Math.round(((value - average) / average) * 100);
    if (percent === 0) return 'Same as average light';
    return `${formatNumber(Math.abs(percent))}% ${percent > 0 ? 'above' : 'below'} average light`;
  }

  const info = METRICS[metric];
  const diff = round(value - average, info.decimals);
  if (diff === 0) return 'Same as average';
  const unit = metric === 'humidity' ? 'pts' : info.unit;
  const sign = diff > 0 ? '+' : '−';
  return `${sign}${formatNumber(Math.abs(diff), info.decimals)} ${unit} ${diff > 0 ? 'above' : 'below'} average`;
}

export type DeltaDirection = 'up' | 'down' | 'flat' | 'none';

export interface Delta {
  direction: DeltaDirection;
  /** Visible text, e.g. "▲ 1.2 °C". */
  text: string;
  /** Screen-reader text, e.g. "up 1.2 °C from the previous period". */
  label: string;
}

/** Change from the previous period for KPI cards. `unit` may be '' (counts) or 'pts'. */
export function periodDelta(
  current: number | null | undefined,
  previous: number | null | undefined,
  options: { decimals: number; unit: string },
): Delta {
  if (current === null || current === undefined || previous === null || previous === undefined) {
    return {
      direction: 'none',
      text: 'No earlier data',
      label: 'No data for the previous period',
    };
  }
  const diff = round(current - previous, options.decimals);
  const unit = options.unit ? ` ${options.unit}` : '';
  if (diff === 0) {
    return { direction: 'flat', text: '● No change', label: 'No change from the previous period' };
  }
  const amount = `${formatNumber(Math.abs(diff), options.decimals)}${unit}`;
  return diff > 0
    ? { direction: 'up', text: `▲ ${amount}`, label: `Up ${amount} from the previous period` }
    : { direction: 'down', text: `▼ ${amount}`, label: `Down ${amount} from the previous period` };
}
