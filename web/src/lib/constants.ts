/** How often stats and the newest sample are polled while the tab is visible. */
export const LIVE_POLL_INTERVAL_MS = 15_000;

/** Consecutive samples further apart than this are not joined by a line in charts. */
export const CHART_GAP_MS = 6 * 60 * 60 * 1000;

/** Above this many samples in range, charts plot daily averages instead of raw points. */
export const RAW_POINTS_LIMIT = 500;

export const RECENT_SAMPLES_COUNT = 8;
export const GALLERY_PAGE_SIZE = 24;
export const DATA_PAGE_SIZE = 50;

export type MetricKey = 'temperature' | 'humidity' | 'lux';

export interface MetricInfo {
  key: MetricKey;
  label: string;
  unit: string;
  decimals: number;
  /** Tailwind text color class and CSS variable for charts. */
  textClass: string;
  cssVar: string;
}

export const METRICS: Record<MetricKey, MetricInfo> = {
  temperature: {
    key: 'temperature',
    label: 'Temperature',
    unit: '°C',
    decimals: 1,
    textClass: 'text-temp',
    cssVar: '--temp',
  },
  humidity: {
    key: 'humidity',
    label: 'Humidity',
    unit: '%',
    decimals: 1,
    textClass: 'text-humidity',
    cssVar: '--humidity',
  },
  lux: {
    key: 'lux',
    label: 'Light',
    unit: 'lx',
    decimals: 0,
    textClass: 'text-light',
    cssVar: '--light',
  },
};

export const METRIC_KEYS: MetricKey[] = ['temperature', 'humidity', 'lux'];

/**
 * General indoor-plant guideline ranges, not measured thresholds — species vary considerably.
 * Source: common consumer plant-care guidance (for example RHS and university extension
 * houseplant care sheets) for typical foliage houseplants at room temperature.
 * Single source of truth: used to shade the Explore histograms and the Overview readings chart.
 */
export const COMFORT_RANGES: Record<MetricKey, { min: number; max: number }> = {
  temperature: { min: 18, max: 30 },
  humidity: { min: 40, max: 70 },
  lux: { min: 200, max: 2000 },
};

/** Default number of histogram bins on the Explore page, and the choices offered in its control. */
export const HISTOGRAM_BIN_OPTIONS = [8, 12, 20] as const;
export const DEFAULT_HISTOGRAM_BINS = 12;

/** Hours with fewer samples than this are visually de-emphasized on the daily-pattern chart. */
export const MIN_RELIABLE_HOURLY_SAMPLES = 3;

/** Explore's scatter plot never renders more points than this (matches the server's cap). */
export const EXPLORE_MAX_POINTS = 2000;
