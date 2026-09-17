import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, renderHook, screen, waitFor } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AppLayout } from '../components/layout/AppLayout';
import { deviceStatusText, signalLabel } from '../components/layout/LastUpload';
import { api } from '../lib/api';
import { LIVE_POLL_INTERVAL_MS } from '../lib/constants';
import { queryKeys, useLatestSample, useStats } from '../lib/queries';
import { resetPushedDeviceStatus } from '../lib/deviceStatusStore';
import { LiveSocket } from '../lib/socket';
import { LiveSocketProvider } from '../lib/socketContext';
import { ThemeProvider } from '../lib/theme';
import { FakeWebSocket, FakeWebSocketImpl } from './fakeSocket';
import { makeSample } from './fixtures';

vi.mock('../lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/api')>();
  return {
    ...actual,
    api: { samples: vi.fn(), sample: vi.fn(), neighbors: vi.fn(), stats: vi.fn(), device: vi.fn() },
  };
});

const samplesMock = vi.mocked(api.samples);
const deviceMock = vi.mocked(api.device);

const offlineDevice = {
  online: false,
  lastSeenAt: null,
  connectedAt: null,
  rssi: null,
  uptimeS: null,
  freeHeap: null,
  streaming: false,
  viewers: 0,
  fw: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  FakeWebSocket.reset();
  resetPushedDeviceStatus();
  samplesMock.mockResolvedValue({ items: [makeSample({ id: 61 })], nextCursor: null });
  deviceMock.mockResolvedValue(offlineDevice);
  vi.mocked(api.stats).mockResolvedValue({} as never);
});

function makeSocket() {
  return new LiveSocket({ url: 'ws://test/ws/live', WebSocketImpl: FakeWebSocketImpl });
}

function renderApp(socket: LiveSocket) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const router = createMemoryRouter(
    [{ path: '/', Component: AppLayout, children: [{ index: true, element: <h1>Home</h1> }] }],
    { initialEntries: ['/'] },
  );
  const result = render(
    <ThemeProvider>
      <QueryClientProvider client={queryClient}>
        <LiveSocketProvider socket={socket}>
          <RouterProvider router={router} />
        </LiveSocketProvider>
      </QueryClientProvider>
    </ThemeProvider>,
  );
  return { ...result, queryClient };
}

describe('polling fallback', () => {
  it('turns polling off while the socket is open and back on when it closes', async () => {
    const socket = makeSocket();
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <QueryClientProvider client={queryClient}>
        <LiveSocketProvider socket={socket}>{children}</LiveSocketProvider>
      </QueryClientProvider>
    );

    renderHook(() => ({ latest: useLatestSample(), stats: useStats({ tz: 'UTC' }) }), { wrapper });

    const intervalOf = (key: readonly unknown[]) =>
      queryClient.getQueryCache().find({ queryKey: key })?.observers[0]?.options.refetchInterval;

    await waitFor(() => {
      expect(intervalOf(queryKeys.latest())).toBe(LIVE_POLL_INTERVAL_MS);
    });

    await act(async () => {
      FakeWebSocket.last.accept();
      await Promise.resolve();
    });
    await waitFor(() => {
      expect(intervalOf(queryKeys.latest())).toBe(false);
    });
    expect(intervalOf(queryKeys.stats({ tz: 'UTC' }))).toBe(false);

    await act(async () => {
      FakeWebSocket.last.drop();
      await Promise.resolve();
    });
    await waitFor(() => {
      expect(intervalOf(queryKeys.latest())).toBe(LIVE_POLL_INTERVAL_MS);
    });
  });
});

describe('live sample events', () => {
  it('updates queries and shows exactly one toast per new sample', async () => {
    const socket = makeSocket();
    const { queryClient } = renderApp(socket);
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
    await screen.findByText('Home');

    await act(async () => {
      FakeWebSocket.last.accept();
      await Promise.resolve();
    });

    const sample = makeSample({ id: 62, createdAt: new Date().toISOString() });
    await act(async () => {
      FakeWebSocket.last.emit({ type: 'sample.created', sample });
      await Promise.resolve();
    });

    expect(await screen.findByText('New sample #62')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'View' })).toHaveAttribute('href', '/samples/62');
    expect(queryClient.getQueryData(queryKeys.sample(62))).toEqual(sample);
    expect(queryClient.getQueryData(queryKeys.latest())).toEqual(sample);
    expect(invalidate).toHaveBeenCalledWith({ queryKey: queryKeys.samples() });

    // A repeat of the same sample (for example after a reconnect) must not toast again.
    await act(async () => {
      FakeWebSocket.last.emit({ type: 'sample.created', sample });
      await Promise.resolve();
    });
    expect(screen.getAllByText('New sample #62')).toHaveLength(1);
  });

  it('shows device status pushed over the socket, without polling', async () => {
    const socket = makeSocket();
    renderApp(socket);
    await screen.findByText('Home');
    await act(async () => {
      FakeWebSocket.last.accept();
      FakeWebSocket.last.emit({
        type: 'hello',
        serverTime: new Date().toISOString(),
        device: { ...offlineDevice, online: true, rssi: -62 },
      });
      await Promise.resolve();
    });

    // The layout renders the status bar twice (mobile row and desktop row).
    expect(await screen.findAllByText('Online · signal −62 dBm')).not.toHaveLength(0);
    expect(screen.getAllByText('Live').length).toBeGreaterThan(0);
    // One fetch happened before the socket opened; after that the push is the only source.
    expect(api.device).toHaveBeenCalledTimes(1);
  });
});

describe('device status wording', () => {
  const now = Date.parse('2026-09-18T12:00:00Z');
  it('describes online and offline states without relying on colour', () => {
    expect(deviceStatusText(undefined, now)).toBe('Checking rover…');
    expect(deviceStatusText({ ...offlineDevice, online: true, rssi: -62 }, now)).toBe(
      'Online · signal −62 dBm',
    );
    // Online but no heartbeat detail yet.
    expect(deviceStatusText({ ...offlineDevice, online: true }, now)).toBe('Online');
    expect(deviceStatusText(offlineDevice, now)).toBe('Offline · never seen');
    expect(deviceStatusText({ ...offlineDevice, lastSeenAt: '2026-09-18T11:52:00Z' }, now)).toBe(
      'Offline · last seen 8 min ago',
    );
    expect(deviceStatusText({ ...offlineDevice, lastSeenAt: '2026-09-18T11:59:30Z' }, now)).toBe(
      'Offline · last seen just now',
    );
  });

  it('adds a plain-language signal strength', () => {
    expect(signalLabel(null)).toBeNull();
    expect(signalLabel(-45)).toBe('strong');
    expect(signalLabel(-60)).toBe('strong');
    expect(signalLabel(-61)).toBe('good');
    expect(signalLabel(-75)).toBe('weak');
    expect(signalLabel(-90)).toBe('very weak');
  });
});
