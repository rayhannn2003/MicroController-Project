import type { MetricKey } from './constants';
import { METRICS } from './constants';

export type CorrelationStrength = 'very weak' | 'weak' | 'moderate' | 'strong' | 'very strong';

/** Named strength band for |r|, using the common social-science rule-of-thumb cutoffs. */
export function correlationStrength(r: number): CorrelationStrength {
  const abs = Math.abs(r);
  if (abs < 0.2) return 'very weak';
  if (abs < 0.4) return 'weak';
  if (abs < 0.6) return 'moderate';
  if (abs < 0.8) return 'strong';
  return 'very strong';
}

/**
 * Plain-language sentence for a Pearson r, e.g. "Moderate negative relationship (r = −0.48)".
 * Returns a message explaining why there is no reading when `r` is null (too few samples, or one
 * of the variables never changed).
 */
export function correlationText(r: number | null): string {
  if (r === null) {
    return 'Not enough data for a correlation (need at least 3 samples with varying readings).';
  }
  if (r === 0) return 'No linear relationship (r = 0.000)';
  const strength = correlationStrength(r);
  const direction = r > 0 ? 'positive' : 'negative';
  const formatted = r.toFixed(3).replace('-', '−');
  return `${strength[0]?.toUpperCase()}${strength.slice(1)} ${direction} relationship (r = ${formatted})`;
}

const pairLabel = (a: MetricKey, b: MetricKey) => `${METRICS[a].label} vs ${METRICS[b].label}`;

export function axisPairLabel(x: MetricKey, y: MetricKey): string {
  return pairLabel(x, y);
}
