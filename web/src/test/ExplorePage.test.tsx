import type { ExploreResponse } from '@sylvan/shared';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api, ApiError } from '../lib/api';
import ExplorePage from '../pages/explore/ExplorePage';
import { renderRoute } from './render';

vi.mock('../lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/api')>();
  return {
    ...actual,
    api: { ...actual.api, explore: vi.fn() },
  };
});

// The lazy chart chunks need real layout (ResponsiveContainer measures a DOM node), which jsdom
// cannot provide; stand in with something that still exposes the props under test.
vi.mock('../pages/explore/ScatterChart', () => ({
  default: ({
    points,
    x,
    y,
    onSelect,
  }: {
    points: { id: number }[];
    x: string;
    y: string;
    onSelect: (id: number) => void;
  }) => (
    <div data-testid="scatter-chart">
      <span data-testid="scatter-axes">
        {x} vs {y}
      </span>
      <span data-testid="scatter-count">{points.length} points</span>
      <button
        type="button"
        onClick={() => {
          onSelect(points[0]?.id ?? 0);
        }}
      >
        select first point
      </button>
    </div>
  ),
}));
vi.mock('../pages/explore/HistogramChart', () => ({
  default: ({ metric }: { metric: string }) => <div data-testid={`histogram-${metric}`} />,
}));
vi.mock('../pages/explore/HourlyChart', () => ({
  default: () => <div data-testid="hourly-chart" />,
}));

const exploreMock = vi.mocked(api.explore);

function makeExplore(overrides: Partial<ExploreResponse> = {}): ExploreResponse {
  return {
    range: { from: null, to: null, tz: 'Asia/Dhaka' },
    count: 3,
    points: [
      { id: 1, at: '2026-09-10T00:00:00Z', temperature: 20, humidity: 50, lux: 100 },
      { id: 2, at: '2026-09-11T00:00:00Z', temperature: 22, humidity: 55, lux: 200 },
      { id: 3, at: '2026-09-12T00:00:00Z', temperature: 24, humidity: 60, lux: 300 },
    ],
    pointsTruncated: false,
    histograms: {
      temperature: { min: 20, max: 24, binWidth: 1, bins: [{ from: 20, to: 24, count: 3 }] },
      humidity: { min: 50, max: 60, binWidth: 5, bins: [{ from: 50, to: 60, count: 3 }] },
      lux: { min: 100, max: 300, binWidth: 100, bins: [{ from: 100, to: 300, count: 3 }] },
    },
    correlations: { temperatureHumidity: 0.9, temperatureLux: 0.85, humidityLux: 0.8 },
    hourly: Array.from({ length: 24 }, (_, hour) => ({
      hour,
      count: hour === 0 ? 3 : 0,
      avgTemperature: hour === 0 ? 22 : null,
      avgHumidity: hour === 0 ? 55 : null,
      avgLux: hour === 0 ? 200 : null,
    })),
    ...overrides,
  };
}

const emptyExplore = (): ExploreResponse =>
  makeExplore({
    count: 0,
    points: [],
    correlations: { temperatureHumidity: null, temperatureLux: null, humidityLux: null },
  });

beforeEach(() => {
  vi.clearAllMocks();
});

describe('ExplorePage', () => {
  it('shows a loading state', () => {
    exploreMock.mockReturnValue(new Promise(() => undefined));
    renderRoute(<ExplorePage />);
    expect(screen.getByRole('heading', { level: 1, name: 'Explore' })).toBeInTheDocument();
    expect(
      screen.getByText('Loading explore analytics').closest('[role="status"]'),
    ).toBeInTheDocument();
  });

  it('shows an empty state when there are no successful readings', async () => {
    exploreMock.mockResolvedValue(emptyExplore());
    renderRoute(<ExplorePage />);
    expect(
      await screen.findByRole('heading', { name: 'No successful readings in this range yet' }),
    ).toBeInTheDocument();
  });

  it('shows an error state with a working Retry button, and a clear message for 429', async () => {
    exploreMock.mockRejectedValueOnce(
      new ApiError(429, 'RATE_LIMITED', 'Too many requests. Please try again shortly.'),
    );
    exploreMock.mockResolvedValueOnce(makeExplore());
    renderRoute(<ExplorePage />);

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Could not load explore analytics');
    expect(alert).toHaveTextContent('Too many requests right now. Please try again shortly.');

    await userEvent.click(within(alert).getByRole('button', { name: 'Retry' }));
    expect(await screen.findByTestId('scatter-chart')).toBeInTheDocument();
    expect(exploreMock).toHaveBeenCalledTimes(2);
  });

  it('renders the scatter, correlation text, histograms and hourly pattern', async () => {
    exploreMock.mockResolvedValue(makeExplore());
    renderRoute(<ExplorePage />);

    expect(await screen.findByTestId('scatter-chart')).toBeInTheDocument();
    // Default axes are light vs humidity.
    expect(screen.getByTestId('scatter-axes')).toHaveTextContent('lux vs humidity');
    expect(screen.getByText(/Very strong positive relationship/)).toBeInTheDocument();
    expect(screen.getByText(/Correlation does not imply causation/)).toBeInTheDocument();
    expect(screen.queryByText(/evenly spread across the range/)).not.toBeInTheDocument();

    expect(screen.getByTestId('histogram-temperature')).toBeInTheDocument();
    expect(screen.getByTestId('histogram-humidity')).toBeInTheDocument();
    expect(screen.getByTestId('histogram-lux')).toBeInTheDocument();
    expect(screen.getByTestId('hourly-chart')).toBeInTheDocument();
  });

  it('updates the chart and the reported correlation when an axis selection changes', async () => {
    exploreMock.mockResolvedValue(makeExplore());
    renderRoute(<ExplorePage />);
    await screen.findByTestId('scatter-chart');

    expect(screen.getByTestId('scatter-axes')).toHaveTextContent('lux vs humidity');
    expect(
      screen.getByText(/Very strong positive relationship \(r = 0\.800\)/),
    ).toBeInTheDocument();

    await userEvent.selectOptions(screen.getByLabelText('X axis'), 'temperature');
    await waitFor(() => {
      expect(screen.getByTestId('scatter-axes')).toHaveTextContent('temperature vs humidity');
    });
    // temperatureHumidity correlation (0.9) is now shown instead of humidityLux (0.8).
    expect(
      screen.getByText(/Very strong positive relationship \(r = 0\.900\)/),
    ).toBeInTheDocument();
  });

  it('shows the truncation notice only when pointsTruncated is true', async () => {
    exploreMock.mockResolvedValue(makeExplore({ pointsTruncated: true, count: 5000 }));
    renderRoute(<ExplorePage />);
    expect(
      await screen.findByText(/Showing 3 of 5,000 samples, evenly spread/),
    ).toBeInTheDocument();
  });

  it('navigates to the sample detail page when a scatter point is clicked', async () => {
    exploreMock.mockResolvedValue(makeExplore());
    const { router } = renderRoute(<ExplorePage />);
    await screen.findByTestId('scatter-chart');
    // The chart itself is decorative (aria-hidden, like every chart in this app — see
    // ChartSection) with the table below as the accessible equivalent, so this queries by text
    // rather than role. The click-through is still real: verified by the resulting navigation.
    await userEvent.click(screen.getByText('select first point'));
    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/samples/1');
    });
  });

  it('offers the same navigation from the accessible table view', async () => {
    exploreMock.mockResolvedValue(makeExplore());
    const { router } = renderRoute(<ExplorePage />);
    const section = (await screen.findByText('Compare two readings')).closest('section');
    if (!section) throw new Error('scatter section not found');
    await userEvent.click(within(section).getByRole('button', { name: 'View as table' }));
    await userEvent.click(within(section).getByRole('link', { name: '#2' }));
    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/samples/2');
    });
  });
});
