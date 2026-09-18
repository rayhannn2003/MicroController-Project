import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../lib/api';
import { resetPushedDeviceStatus, setPushedDeviceStatus } from '../lib/deviceStatusStore';
import { LiveSocket } from '../lib/socket';
import { LiveSocketProvider } from '../lib/socketContext';
import LivePage from '../pages/LivePage';
import { FakeWebSocket, FakeWebSocketImpl, stubObjectUrls } from './fakeSocket';

vi.mock('../lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/api')>();
  return {
    ...actual,
    api: { samples: vi.fn(), sample: vi.fn(), neighbors: vi.fn(), stats: vi.fn(), device: vi.fn() },
  };
});

const onlineDevice = {
  online: true,
  lastSeenAt: new Date().toISOString(),
  connectedAt: new Date().toISOString(),
  rssi: -62,
  uptimeS: 120,
  freeHeap: 140_000,
  streaming: true,
  viewers: 1,
  fw: 'fake 1.0.0',
};

let urls: ReturnType<typeof stubObjectUrls>;

beforeEach(() => {
  vi.clearAllMocks();
  FakeWebSocket.reset();
  resetPushedDeviceStatus();
  urls = stubObjectUrls();
  vi.mocked(api.device).mockResolvedValue(onlineDevice);
});

function renderLive() {
  const socket = new LiveSocket({ url: 'ws://test/ws/live', WebSocketImpl: FakeWebSocketImpl });
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const tree = (showPage: boolean) => (
    <QueryClientProvider client={queryClient}>
      <LiveSocketProvider socket={socket}>
        {showPage ? <LivePage /> : <p>Elsewhere</p>}
      </LiveSocketProvider>
    </QueryClientProvider>
  );
  const view = render(tree(true));
  return {
    ...view,
    socket,
    /** Navigates away from the Live page while the shared socket stays connected. */
    leavePage: () => {
      view.rerender(tree(false));
    },
  };
}

const sendFrame = async (bytes = 1200) => {
  await act(async () => {
    FakeWebSocket.last.emitFrame(new Blob([new Uint8Array(bytes)]));
    await Promise.resolve();
  });
};

const open = async () => {
  await act(async () => {
    FakeWebSocket.last.accept();
    await Promise.resolve();
  });
};

const goLive = async () => {
  await act(async () => {
    setPushedDeviceStatus(onlineDevice);
    FakeWebSocket.last.emit({ type: 'stream.state', state: 'live', reason: null });
    await Promise.resolve();
  });
};

describe('LivePage', () => {
  it('asks to watch on mount and stops when the page is left', async () => {
    const { leavePage } = renderLive();
    await open();
    expect(FakeWebSocket.last.watchMessages).toEqual([{ type: 'watch', on: true }]);

    act(() => {
      leavePage();
    });
    expect(FakeWebSocket.last.watchMessages).toEqual([
      { type: 'watch', on: true },
      { type: 'watch', on: false },
    ]);
  });

  it('revokes the previous object URL for every frame, and the last one on unmount', async () => {
    const { leavePage } = renderLive();
    await open();
    await goLive();

    await sendFrame();
    expect(urls.create).toHaveBeenCalledTimes(1);
    expect(urls.revoke).not.toHaveBeenCalled();

    await sendFrame();
    await sendFrame();
    expect(urls.create).toHaveBeenCalledTimes(3);
    // Each new frame releases the one before it, so at most one URL is held at a time.
    expect(urls.revoke).toHaveBeenCalledTimes(2);
    expect(urls.revoke).toHaveBeenNthCalledWith(1, 'blob:fake/1');
    expect(urls.revoke).toHaveBeenNthCalledWith(2, 'blob:fake/2');

    const image = screen.getByRole('img');
    expect(image.getAttribute('src')).toBe('blob:fake/3');

    act(() => {
      leavePage();
    });
    expect(urls.revoke).toHaveBeenCalledTimes(3);
    expect(urls.revoke).toHaveBeenLastCalledWith('blob:fake/3');
  });

  it('reports frame rate and size, then warns when frames stop arriving', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      renderLive();
      await open();
      await goLive();
      await sendFrame(20_480);
      await sendFrame(20_480);

      expect(screen.getByText('20 KB')).toBeInTheDocument();
      expect(screen.queryByText('Waiting for frames…')).not.toBeInTheDocument();

      await act(async () => {
        await vi.advanceTimersByTimeAsync(6000);
      });
      expect(screen.getByText('Waiting for frames…')).toBeInTheDocument();

      // A new frame clears the warning again.
      await sendFrame();
      expect(screen.queryByText('Waiting for frames…')).not.toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it('explains each state: connecting, rover offline, and a too-slow disconnect', async () => {
    const { socket } = renderLive();
    expect(screen.getByText('Connecting…')).toBeInTheDocument();

    await open();
    await act(async () => {
      setPushedDeviceStatus({ ...onlineDevice, online: false, viewers: 0 });
      await Promise.resolve();
    });
    expect(await screen.findByText('Rover is offline')).toBeInTheDocument();
    expect(
      screen.getByText('The live view will start automatically when it reconnects.'),
    ).toBeInTheDocument();

    await act(async () => {
      setPushedDeviceStatus(onlineDevice);
      await Promise.resolve();
    });
    expect(await screen.findByText('Starting the camera…')).toBeInTheDocument();

    await act(async () => {
      FakeWebSocket.last.drop(4008);
      await Promise.resolve();
    });
    expect(await screen.findByText('Live view stopped')).toBeInTheDocument();

    // Retry reconnects and asks to watch again.
    const retry = vi.spyOn(socket, 'retryNow');
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(retry).toHaveBeenCalled();
  });

  it('says so when WebSockets are unavailable, and explains photos still work', () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const socket = new LiveSocket({ url: 'ws://test', WebSocketImpl: null });
    render(
      <QueryClientProvider client={queryClient}>
        <LiveSocketProvider socket={socket}>
          <LivePage />
        </LiveSocketProvider>
      </QueryClientProvider>,
    );

    expect(screen.getByText('Live view needs a WebSocket connection')).toBeInTheDocument();
    expect(screen.getByText(/Samples, photos and charts still work/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Capture photo' })).not.toBeInTheDocument();
    expect(
      screen.getByText('Photos are captured automatically each time the rover samples.'),
    ).toBeInTheDocument();
  });
});
