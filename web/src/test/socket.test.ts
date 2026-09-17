import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LiveSocket } from '../lib/socket';
import { FakeWebSocket, FakeWebSocketImpl } from './fakeSocket';

function makeSocket(random = () => 0.5) {
  return new LiveSocket({
    url: 'ws://test/ws/live',
    WebSocketImpl: FakeWebSocketImpl,
    random,
    hiddenPauseMs: 60_000,
  });
}

beforeEach(() => {
  FakeWebSocket.reset();
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('LiveSocket', () => {
  it('connects, reports status and re-sends the watch flag after reconnecting', () => {
    const socket = makeSocket();
    socket.start();
    expect(socket.getSnapshot().status).toBe('connecting');

    FakeWebSocket.last.accept();
    expect(socket.getSnapshot()).toMatchObject({
      status: 'open',
      everConnected: true,
      failures: 0,
    });

    socket.setWatching(true);
    expect(FakeWebSocket.last.watchMessages).toEqual([{ type: 'watch', on: true }]);

    FakeWebSocket.last.drop();
    expect(socket.getSnapshot().status).toBe('closed');
    vi.advanceTimersByTime(1000);
    FakeWebSocket.last.accept();
    // The new connection is told what this viewer wants without any page involvement.
    expect(FakeWebSocket.last.watchMessages).toEqual([{ type: 'watch', on: true }]);
    socket.stop();
  });

  it('backs off exponentially with jitter, and resets after a success', () => {
    const socket = makeSocket(() => 1); // upper end of the jitter window
    socket.start();

    const delays: number[] = [];
    for (let attempt = 0; attempt < 6; attempt++) {
      const before = FakeWebSocket.instances.length;
      FakeWebSocket.last.drop();
      // Nothing reconnects before the delay elapses.
      let waited = 0;
      while (FakeWebSocket.instances.length === before && waited <= 40_000) {
        vi.advanceTimersByTime(50);
        waited += 50;
      }
      delays.push(waited);
    }
    // 1 s, 2 s, 4 s, 8 s, 16 s, then capped at 30 s.
    expect(delays).toEqual([1000, 2000, 4000, 8000, 16_000, 30_000]);

    FakeWebSocket.last.accept();
    expect(socket.getSnapshot().failures).toBe(0);
    FakeWebSocket.last.drop();
    const before = FakeWebSocket.instances.length;
    vi.advanceTimersByTime(1000);
    expect(FakeWebSocket.instances.length).toBe(before + 1);
    socket.stop();
  });

  it('uses half the window as the minimum delay', () => {
    const socket = makeSocket(() => 0);
    socket.start();
    FakeWebSocket.last.drop();
    const before = FakeWebSocket.instances.length;
    vi.advanceTimersByTime(499);
    expect(FakeWebSocket.instances.length).toBe(before);
    vi.advanceTimersByTime(1);
    expect(FakeWebSocket.instances.length).toBe(before + 1);
    socket.stop();
  });

  it('reports blocked after repeated failures without ever connecting', () => {
    const socket = makeSocket();
    socket.start();
    for (let i = 0; i < 3; i++) {
      FakeWebSocket.last.drop();
      vi.advanceTimersByTime(30_000);
    }
    expect(socket.getSnapshot()).toMatchObject({ blocked: true, everConnected: false });
    socket.stop();
  });

  it('stops watching after a "too slow" close so it does not immediately restart the stream', () => {
    const socket = makeSocket();
    socket.start();
    FakeWebSocket.last.accept();
    socket.setWatching(true);

    FakeWebSocket.last.drop(4008);
    expect(socket.getSnapshot()).toMatchObject({ watching: false, lastCloseCode: 4008 });

    vi.advanceTimersByTime(30_000);
    FakeWebSocket.last.accept();
    expect(FakeWebSocket.last.watchMessages).toEqual([]);
    socket.stop();
  });

  it('pauses only after the tab has been hidden for a minute, and reconnects when visible', () => {
    const socket = makeSocket();
    socket.start();
    FakeWebSocket.last.accept();
    const opened = FakeWebSocket.instances.length;

    const visibility = vi.spyOn(document, 'visibilityState', 'get');
    visibility.mockReturnValue('hidden');
    document.dispatchEvent(new Event('visibilitychange'));
    vi.advanceTimersByTime(59_000);
    expect(socket.getSnapshot().status).toBe('open');

    vi.advanceTimersByTime(2000);
    expect(socket.getSnapshot().status).toBe('closed');
    expect(FakeWebSocket.instances.length).toBe(opened);

    visibility.mockReturnValue('visible');
    document.dispatchEvent(new Event('visibilitychange'));
    expect(FakeWebSocket.instances.length).toBe(opened + 1);
    visibility.mockRestore();
    socket.stop();
  });

  it('delivers JSON messages and binary frames to their handlers', () => {
    const socket = makeSocket();
    const messages: unknown[] = [];
    const frames: Blob[] = [];
    socket.subscribe((message) => messages.push(message));
    socket.subscribeFrames((frame) => frames.push(frame));
    socket.start();
    FakeWebSocket.last.accept();

    FakeWebSocket.last.emit({ type: 'device.status', device: { online: true } });
    FakeWebSocket.last.onmessage?.({ data: 'not json' });
    FakeWebSocket.last.emitFrame(new Blob([new Uint8Array([0xff, 0xd8])]));

    expect(messages).toEqual([{ type: 'device.status', device: { online: true } }]);
    expect(frames).toHaveLength(1);
    socket.stop();
  });

  it('reports unsupported when the browser has no WebSocket', () => {
    const socket = new LiveSocket({ url: 'ws://test', WebSocketImpl: null });
    expect(socket.getSnapshot().status).toBe('unsupported');
    socket.start();
    expect(FakeWebSocket.instances).toHaveLength(0);
  });
});
