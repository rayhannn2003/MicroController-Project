import { describe, expect, it } from 'vitest';
import { compareToAverage, periodDelta } from '../lib/compare';

describe('compareToAverage', () => {
  it('describes temperature and humidity as signed differences', () => {
    expect(compareToAverage('temperature', 26.4, 24.3)).toBe('+2.1 °C above average');
    expect(compareToAverage('temperature', 22, 24.3)).toBe('−2.3 °C below average');
    expect(compareToAverage('humidity', 70, 62.5)).toBe('+7.5 pts above average');
  });

  it('describes light as a percentage', () => {
    expect(compareToAverage('lux', 820, 1000)).toBe('18% below average light');
    expect(compareToAverage('lux', 1500, 1000)).toBe('50% above average light');
  });

  it('reports equal values, including differences that round to zero', () => {
    expect(compareToAverage('temperature', 24.3, 24.3)).toBe('Same as average');
    expect(compareToAverage('temperature', 24.34, 24.3)).toBe('Same as average');
    expect(compareToAverage('lux', 1002, 1000)).toBe('Same as average light');
  });

  it('handles zero values and a zero light average without dividing by zero', () => {
    expect(compareToAverage('temperature', 0, 2)).toBe('−2.0 °C below average');
    expect(compareToAverage('lux', 0, 0)).toBe('Same as average light');
    expect(compareToAverage('lux', 120, 0)).toBe('120 lx above average light');
  });

  it('returns null when the reading or the average is missing', () => {
    expect(compareToAverage('temperature', null, 24)).toBeNull();
    expect(compareToAverage('humidity', 60, null)).toBeNull();
    expect(compareToAverage('lux', undefined, undefined)).toBeNull();
  });
});

describe('periodDelta', () => {
  it('shows direction with arrows and words, not colour alone', () => {
    expect(periodDelta(23.8, 22.6, { decimals: 1, unit: '°C' })).toEqual({
      direction: 'up',
      text: '▲ 1.2 °C',
      label: 'Up 1.2 °C from the previous period',
    });
    expect(periodDelta(8, 10, { decimals: 0, unit: '' })).toMatchObject({
      direction: 'down',
      text: '▼ 2',
    });
    expect(periodDelta(5, 5, { decimals: 0, unit: '' }).direction).toBe('flat');
  });

  it('is neutral when the previous period has no data', () => {
    expect(periodDelta(24, null, { decimals: 1, unit: '°C' })).toMatchObject({
      direction: 'none',
      text: 'No earlier data',
    });
  });
});
