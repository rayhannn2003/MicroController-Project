import { describe, expect, it } from 'vitest';
import { correlationStrength, correlationText } from '../lib/correlation';

describe('correlationStrength', () => {
  it.each([
    [0, 'very weak'],
    [0.1, 'very weak'],
    [0.19, 'very weak'],
    [0.2, 'weak'],
    [0.39, 'weak'],
    [0.4, 'moderate'],
    [0.59, 'moderate'],
    [0.6, 'strong'],
    [0.79, 'strong'],
    [0.8, 'very strong'],
    [1, 'very strong'],
  ] as const)('|r|=%s -> %s', (value, expected) => {
    expect(correlationStrength(value)).toBe(expected);
  });

  it('is symmetric for negative values', () => {
    expect(correlationStrength(-0.48)).toBe('moderate');
    expect(correlationStrength(-0.9)).toBe('very strong');
    expect(correlationStrength(-0.05)).toBe('very weak');
  });
});

describe('correlationText', () => {
  it('describes a moderate negative relationship, matching the worked example', () => {
    // Always shown to 3 decimals for consistency, unlike the brief's shorthand "r = -0.48".
    expect(correlationText(-0.48)).toBe('Moderate negative relationship (r = −0.480)');
  });

  it('describes strengths and directions at each boundary', () => {
    expect(correlationText(0.85)).toBe('Very strong positive relationship (r = 0.850)');
    expect(correlationText(-0.2)).toBe('Weak negative relationship (r = −0.200)');
    expect(correlationText(0.19)).toBe('Very weak positive relationship (r = 0.190)');
  });

  it('has a distinct message for exactly zero', () => {
    expect(correlationText(0)).toBe('No linear relationship (r = 0.000)');
  });

  it('explains why there is no reading when r is null', () => {
    expect(correlationText(null)).toBe(
      'Not enough data for a correlation (need at least 3 samples with varying readings).',
    );
  });
});
