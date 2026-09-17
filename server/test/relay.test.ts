import { describe, expect, it, vi } from 'vitest';
import { parseTextMessage, isJpegFrame } from '../src/realtime/protocol.js';
import { StreamRelay, ViewerCountNotifier, type RelayTarget } from '../src/realtime/relay.js';

function fakeViewer(bufferedAmount = 0) {
  const target = {
    bufferedAmount,
    frames: [] as Buffer[],
    closed: null as { code: number; reason: string } | null,
    sendFrame(frame: Buffer) {
      target.frames.push(frame);
    },
    close(code: number, reason: string) {
      target.closed = { code, reason };
    },
  };
  return target as RelayTarget & typeof target;
}

const frame = (byte = 1) => Buffer.from([0xff, 0xd8, byte]);

describe('StreamRelay', () => {
  it('sends each frame to every watcher and counts nothing when there are none', () => {
    let clock = 0;
    const relay = new StreamRelay({
      slowViewerBytes: 1000,
      slowCloseMs: 1000,
      maxFps: 10,
      now: () => clock,
    });
    expect(relay.handleFrame(frame())).toBe(false);

    const a = fakeViewer();
    const b = fakeViewer();
    relay.add(a);
    relay.add(b);
    clock += 200;
    expect(relay.handleFrame(frame(2))).toBe(true);
    expect(a.frames).toHaveLength(1);
    expect(b.frames).toHaveLength(1);

    relay.remove(b);
    clock += 200;
    relay.handleFrame(frame(3));
    expect(a.frames).toHaveLength(2);
    expect(b.frames).toHaveLength(1);
    expect(relay.takeStats()).toMatchObject({ framesIn: 3, framesSent: 3, droppedNoViewers: 1 });
  });

  it('drops frames above the incoming rate cap', () => {
    let clock = 0;
    const relay = new StreamRelay({
      slowViewerBytes: 1000,
      slowCloseMs: 1000,
      maxFps: 10,
      now: () => clock,
    });
    const viewer = fakeViewer();
    relay.add(viewer);

    // The bucket starts full (10), so 11 frames in the same instant deliver 10.
    for (let i = 0; i < 11; i++) relay.handleFrame(frame(i));
    expect(viewer.frames).toHaveLength(10);

    clock += 100; // one token refills every 100 ms at 10 fps
    relay.handleFrame(frame());
    expect(viewer.frames).toHaveLength(11);
    expect(relay.takeStats()).toMatchObject({ framesIn: 12, framesSent: 11, droppedRate: 1 });
  });

  it('skips a backed-up viewer, keeps serving the others, and closes it after the grace period', () => {
    let clock = 0;
    const onSlowClose = vi.fn();
    const relay = new StreamRelay({
      slowViewerBytes: 2000,
      slowCloseMs: 500,
      maxFps: 100,
      now: () => clock,
      onSlowClose,
    });
    const slow = fakeViewer(5000);
    const fast = fakeViewer(0);
    relay.add(slow);
    relay.add(fast);

    clock = 1000;
    relay.handleFrame(frame(1));
    expect(slow.frames).toHaveLength(0);
    expect(fast.frames).toHaveLength(1);
    expect(slow.closed).toBeNull();

    clock = 1400; // still within the grace period
    relay.handleFrame(frame(2));
    expect(slow.closed).toBeNull();

    clock = 1600; // over 500 ms slow
    relay.handleFrame(frame(3));
    expect(slow.closed).toEqual({ code: 4008, reason: 'too slow' });
    expect(onSlowClose).toHaveBeenCalledTimes(1);
    expect(relay.watcherCount).toBe(1);
    expect(fast.frames).toHaveLength(3);
    expect(relay.takeStats().droppedSlow).toBe(3);
  });

  it('forgives a viewer that catches up, and closes a stuck one on the timer', () => {
    let clock = 0;
    const relay = new StreamRelay({
      slowViewerBytes: 2000,
      slowCloseMs: 500,
      maxFps: 100,
      now: () => clock,
    });
    const viewer = fakeViewer(5000);
    relay.add(viewer);

    clock = 100;
    relay.handleFrame(frame());
    viewer.bufferedAmount = 0;
    clock = 900;
    relay.handleFrame(frame());
    expect(viewer.frames).toHaveLength(1);
    expect(viewer.closed).toBeNull();

    // Frames stop arriving while the viewer is stuck again: the shared timer still closes it.
    viewer.bufferedAmount = 5000;
    clock = 1000;
    relay.handleFrame(frame());
    clock = 2000;
    relay.tick();
    expect(viewer.closed).toEqual({ code: 4008, reason: 'too slow' });
  });
});

describe('ViewerCountNotifier', () => {
  it('debounces starts and stops so quick toggles send nothing', async () => {
    const send = vi.fn();
    const notifier = new ViewerCountNotifier({
      startDelayMs: 30,
      stopDelayMs: 60,
      throttleMs: 10,
      now: () => Date.now(),
      send,
    });

    notifier.deviceConnected();
    expect(send).toHaveBeenCalledWith(0);

    notifier.update(1);
    notifier.update(0); // viewer left again before the start delay elapsed
    await new Promise((resolve) => setTimeout(resolve, 120));
    expect(send).toHaveBeenCalledTimes(1);

    notifier.update(1);
    await new Promise((resolve) => setTimeout(resolve, 120));
    expect(send).toHaveBeenLastCalledWith(1);

    notifier.update(0);
    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(send).toHaveBeenLastCalledWith(0);
    expect(send).toHaveBeenCalledTimes(3);
    notifier.cancel();
  });
});

describe('protocol parsing', () => {
  it('accepts JSON objects with a type and rejects anything else', () => {
    expect(parseTextMessage(Buffer.from('{"type":"heartbeat","rssi":-60}'))).toEqual({
      kind: 'message',
      type: 'heartbeat',
      value: { type: 'heartbeat', rssi: -60 },
    });
    for (const bad of ['not json', '[]', '"text"', '{"no":"type"}', '{"type":5}']) {
      expect(parseTextMessage(Buffer.from(bad)).kind).toBe('invalid');
    }
    expect(parseTextMessage(Buffer.alloc(2000, 0x20)).kind).toBe('invalid');
  });

  it('recognises JPEG frames by their magic bytes', () => {
    expect(isJpegFrame(Buffer.from([0xff, 0xd8, 0x00]))).toBe(true);
    expect(isJpegFrame(Buffer.from([0x89, 0x50]))).toBe(false);
    expect(isJpegFrame(Buffer.alloc(0))).toBe(false);
  });
});
