import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api, ApiError } from '../lib/api';
import OverviewPage from '../pages/overview/OverviewPage';
import { emptyStats, makeSample, makeStats } from './fixtures';
import { renderRoute } from './render';

vi.mock('../lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/api')>();
  return {
    ...actual,
    api: { samples: vi.fn(), sample: vi.fn(), neighbors: vi.fn(), stats: vi.fn() },
  };
});

// Recharts needs real layout; the chart modules are covered by the summary and table views.
vi.mock('../pages/overview/ReadingsCharts', () => ({
  default: () => <div data-testid="readings-chart" />,
}));
vi.mock('../pages/overview/DailyChart', () => ({
  default: () => <div data-testid="daily-chart" />,
}));

const statsMock = vi.mocked(api.stats);
const samplesMock = vi.mocked(api.samples);

beforeEach(() => {
  vi.clearAllMocks();
  samplesMock.mockResolvedValue({
    items: [
      makeSample({ id: 42 }),
      makeSample({
        id: 41,
        ok: false,
        temperature: null,
        humidity: null,
        lux: null,
        photoUrl: null,
      }),
    ],
    nextCursor: null,
  });
});

describe('OverviewPage', () => {
  it('shows skeletons while loading', () => {
    statsMock.mockReturnValue(new Promise(() => undefined));
    renderRoute(<OverviewPage />);
    expect(screen.getByRole('heading', { level: 1, name: 'Overview' })).toBeInTheDocument();
    expect(screen.getByText('Loading overview').closest('[role="status"]')).toBeInTheDocument();
  });

  it('shows the empty state and switches to all time', async () => {
    statsMock.mockResolvedValue(emptyStats());
    const { router } = renderRoute(<OverviewPage />);

    expect(
      await screen.findByRole('heading', { name: 'No samples in this range yet' }),
    ).toBeInTheDocument();
    expect(screen.getByText(/uploads one each time it finds an object/)).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Show all time' }));
    expect(router.state.location.search).toBe('?range=all');
    await waitFor(() => {
      expect(statsMock).toHaveBeenLastCalledWith({ tz: 'Asia/Dhaka' }, expect.anything());
    });
    expect(await screen.findByRole('heading', { name: 'No samples yet' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Show all time' })).not.toBeInTheDocument();
  });

  it('shows an error with a working Retry button', async () => {
    statsMock.mockRejectedValueOnce(new ApiError(500, 'INTERNAL_ERROR', 'Internal server error'));
    statsMock.mockResolvedValueOnce(makeStats());
    renderRoute(<OverviewPage />);

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Could not load the overview');
    expect(alert).toHaveTextContent('The server had a problem loading this data.');

    await userEvent.click(within(alert).getByRole('button', { name: 'Retry' }));
    expect(await screen.findByText('Latest sample')).toBeInTheDocument();
    expect(statsMock).toHaveBeenCalledTimes(2);
  });

  it('renders KPIs, the latest sample, charts and recent samples', async () => {
    statsMock.mockResolvedValue(makeStats());
    renderRoute(<OverviewPage />, { url: '/?range=30d' });

    const kpis = await screen.findByRole('region', { name: 'Key figures' });
    expect(within(kpis).getByText('Samples').parentElement).toHaveTextContent('12');
    expect(kpis).toHaveTextContent('Up 2 from the previous period');
    expect(kpis).toHaveTextContent('83.3%');
    expect(kpis).toHaveTextContent('24.3 °C');
    expect(kpis).toHaveTextContent('Up 1.2 °C from the previous period');
    // Previous light average is missing, so that card stays neutral.
    expect(kpis).toHaveTextContent('No data for the previous period');

    const latest = screen.getByRole('region', { name: 'Latest sample' });
    expect(within(latest).getByText('#42')).toBeInTheDocument();
    expect(
      within(latest).getByRole('img', { name: 'Rover photo for sample #42, 17 Sept 2026, 14:05' }),
    ).toBeInTheDocument();
    expect(within(latest).getByRole('link', { name: /Details for sample #42/ })).toHaveAttribute(
      'href',
      '/samples/42?range=30d',
    );

    expect(await screen.findByTestId('readings-chart')).toBeInTheDocument();
    expect(screen.getByTestId('daily-chart')).toBeInTheDocument();
    expect(
      screen.getByText(/10 successful readings\. Temperature 21\.0 °C to 28\.1 °C/),
    ).toBeInTheDocument();

    const recent = screen.getByRole('region', { name: 'Recent samples' });
    expect(await within(recent).findAllByRole('link', { name: /^Sample #/ })).toHaveLength(2);

    // Raw points are requested for ranges with at most 500 samples.
    expect(samplesMock).toHaveBeenCalledWith(
      expect.objectContaining({ limit: 500 }),
      expect.anything(),
    );
  });

  it('offers a table instead of the chart', async () => {
    statsMock.mockResolvedValue(makeStats());
    renderRoute(<OverviewPage />);
    const section = await screen.findByRole('region', { name: 'Samples per day' });
    await userEvent.click(within(section).getByRole('button', { name: 'View as table' }));
    const table = within(section).getByRole('table');
    expect(within(table).getAllByRole('row')).toHaveLength(3);
    expect(within(section).queryByTestId('daily-chart')).not.toBeInTheDocument();
  });

  it('uses daily averages instead of raw points above 500 samples', async () => {
    statsMock.mockResolvedValue(
      makeStats({ totals: { samples: 501, ok: 500, failed: 1, successRate: 0.998, withPhoto: 0 } }),
    );
    renderRoute(<OverviewPage />);
    expect(await screen.findByText(/Daily averages/)).toBeInTheDocument();
    await screen.findByTestId('readings-chart');
    expect(samplesMock).not.toHaveBeenCalledWith(
      expect.objectContaining({ limit: 500 }),
      expect.anything(),
    );
  });
});
