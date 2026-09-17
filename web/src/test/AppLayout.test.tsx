import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AppLayout } from '../components/layout/AppLayout';
import { api } from '../lib/api';
import { queryKeys } from '../lib/queries';
import { ThemeProvider } from '../lib/theme';
import { makeSample } from './fixtures';

vi.mock('../lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/api')>();
  return {
    ...actual,
    api: { samples: vi.fn(), sample: vi.fn(), neighbors: vi.fn(), stats: vi.fn() },
  };
});

beforeEach(() => {
  vi.clearAllMocks();
});

describe('AppLayout live updates', () => {
  it('shows "Last upload", then a toast with a working link when a newer sample appears', async () => {
    const samplesMock = vi.mocked(api.samples);
    samplesMock.mockResolvedValueOnce({
      items: [makeSample({ id: 61, createdAt: new Date(Date.now() - 12 * 60_000).toISOString() })],
      nextCursor: null,
    });
    samplesMock.mockResolvedValue({
      items: [makeSample({ id: 62, createdAt: new Date().toISOString() })],
      nextCursor: null,
    });

    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
    const router = createMemoryRouter(
      [{ path: '/', Component: AppLayout, children: [{ index: true, element: <h1>Home</h1> }] }],
      { initialEntries: ['/?range=30d'] },
    );
    render(
      <ThemeProvider>
        <QueryClientProvider client={queryClient}>
          <RouterProvider router={router} />
        </QueryClientProvider>
      </ThemeProvider>,
    );

    expect((await screen.findAllByText('Last upload 12 min ago'))[0]).toBeInTheDocument();
    expect(screen.queryByText(/New sample/)).not.toBeInTheDocument();

    // Simulate the next poll (Phase 3 would deliver the same event over a WebSocket).
    await queryClient.refetchQueries({ queryKey: queryKeys.latest() });

    expect(await screen.findByText('New sample #62')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'View' })).toHaveAttribute(
      'href',
      '/samples/62?range=30d',
    );
    expect(invalidate).toHaveBeenCalledWith({ queryKey: queryKeys.samples() });
  });
});
