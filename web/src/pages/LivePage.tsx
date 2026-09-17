import type { StreamState, StreamStopReason } from '@sylvan/shared';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { IconCamera, IconLive, IconPlugOff, IconRefresh } from '../components/ui/Icons';
import { formatNumber } from '../lib/format';
import { useDeviceStatus } from '../lib/queries';
import { useLiveSocket, useSocketSnapshot } from '../lib/socketContext';
import { VIEWER_CLOSE } from '../lib/socket';

/** No frame for this long while the stream says "live" means something is wrong. */
const FREEZE_AFTER_MS = 5000;
/** How long to wait for the first frame before explaining the delay. */
const FIRST_FRAME_TIMEOUT_MS = 15_000;
const HIDDEN_STOP_MS = 60_000;

interface FrameInfo {
  fps: number;
  bytes: number;
  receivedAt: number;
}

export default function LivePage() {
  const socket = useLiveSocket();
  const { status: socketStatus, blocked, lastCloseCode } = useSocketSnapshot();
  const device = useDeviceStatus();
  const [stream, setStream] = useState<{ state: StreamState; reason: StreamStopReason | null }>({
    state: 'stopped',
    reason: null,
  });
  const [frame, setFrame] = useState<FrameInfo | null>(null);
  const [stale, setStale] = useState(false);
  const [waitedForFirst, setWaitedForFirst] = useState(false);

  const imageRef = useRef<HTMLImageElement | null>(null);
  const objectUrl = useRef<string | null>(null);
  const times = useRef<number[]>([]);
  const lastFrameAt = useRef<number | null>(null);
  const startingSince = useRef<number | null>(null);

  // Ask for frames while this page is open, and stop as soon as it is not.
  useEffect(() => {
    if (!socket) return;
    socket.setWatching(true);
    let hiddenTimer: ReturnType<typeof setTimeout> | null = null;
    const stopWatching = () => {
      socket.setWatching(false);
    };
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') {
        hiddenTimer ??= setTimeout(stopWatching, HIDDEN_STOP_MS);
      } else {
        if (hiddenTimer) clearTimeout(hiddenTimer);
        hiddenTimer = null;
        socket.setWatching(true);
      }
    };
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('pagehide', stopWatching);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pagehide', stopWatching);
      if (hiddenTimer) clearTimeout(hiddenTimer);
      stopWatching();
    };
  }, [socket]);

  useEffect(() => {
    if (!socket) return;
    return socket.subscribe((message) => {
      if (message.type !== 'stream.state') return;
      setStream({ state: message.state, reason: message.reason });
      startingSince.current = message.state === 'starting' ? Date.now() : null;
      setWaitedForFirst(false);
    });
  }, [socket]);

  // Each frame replaces the previous one; the old object URL is revoked immediately, or the
  // browser would hold every frame it has ever decoded.
  useEffect(() => {
    if (!socket) return;
    return socket.subscribeFrames((blob) => {
      const url = URL.createObjectURL(blob);
      const previous = objectUrl.current;
      objectUrl.current = url;
      if (imageRef.current) imageRef.current.src = url;
      if (previous) URL.revokeObjectURL(previous);

      const now = Date.now();
      lastFrameAt.current = now;
      times.current = [...times.current, now].filter((time) => now - time <= 2000);
      const span = (times.current.at(-1) ?? now) - (times.current[0] ?? now);
      setFrame({
        fps: times.current.length > 1 && span > 0 ? ((times.current.length - 1) / span) * 1000 : 0,
        bytes: blob.size,
        receivedAt: now,
      });
      setStale(false);
    });
  }, [socket]);

  // Release the last frame when leaving the page.
  useEffect(
    () => () => {
      if (objectUrl.current) URL.revokeObjectURL(objectUrl.current);
      objectUrl.current = null;
    },
    [],
  );

  // Freeze detection and the "still waiting" message, both driven by one timer.
  useEffect(() => {
    const timer = setInterval(() => {
      const last = lastFrameAt.current;
      setStale(last !== null && Date.now() - last > FREEZE_AFTER_MS);
      const since = startingSince.current;
      if (last === null && since !== null && Date.now() - since > FIRST_FRAME_TIMEOUT_MS) {
        setWaitedForFirst(true);
      }
    }, 1000);
    return () => {
      clearInterval(timer);
    };
  }, []);

  const retry = useCallback(() => {
    socket?.retryNow();
    socket?.setWatching(true);
  }, [socket]);

  const deviceOnline = device.data?.online ?? false;
  const tooSlow = lastCloseCode === VIEWER_CLOSE.tooSlow;
  const unavailable = socketStatus === 'unsupported' || blocked;
  const hasImage = frame !== null;

  let overlay: { title: string; message: string; action?: 'retry' } | null = null;
  if (unavailable) {
    overlay = {
      title: 'Live view needs a WebSocket connection',
      message:
        'This browser or network seems to block WebSockets. Samples, photos and charts still work; they refresh every 15 seconds.',
    };
  } else if (tooSlow && !hasImage) {
    overlay = {
      title: 'Live view stopped',
      message:
        'This device could not keep up with the stream, so the server stopped sending frames.',
      action: 'retry',
    };
  } else if (socketStatus !== 'open') {
    overlay = {
      title: socketStatus === 'connecting' ? 'Connecting…' : 'Reconnecting…',
      message: 'Waiting for the live connection to the server.',
    };
  } else if (!deviceOnline) {
    overlay = {
      title: 'Rover is offline',
      message: 'The live view will start automatically when it reconnects.',
    };
  } else if (!hasImage) {
    overlay = {
      title: 'Starting the camera…',
      message: waitedForFirst
        ? 'The rover is online but no video has arrived yet. It may be busy sampling or on a weak connection.'
        : 'Asking the rover to start streaming.',
    };
  }

  return (
    <>
      <title>Live · Sylvan</title>
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Live camera</h1>
          <p className="mt-1 text-sm text-ink-muted">
            Streamed from the rover while someone is watching this page.
          </p>
        </div>
        <Button
          aria-disabled="true"
          aria-describedby="capture-help"
          onClick={(event) => {
            event.preventDefault();
          }}
        >
          <IconCamera size={16} />
          Capture photo
        </Button>
      </div>

      <Card className="overflow-hidden">
        <div className="relative mx-auto aspect-[4/3] w-full max-w-[calc(70dvh*4/3)] bg-black">
          <img
            ref={imageRef}
            alt={
              hasImage
                ? 'Live view from the rover camera, updating several times a second'
                : 'Live camera view; no picture yet'
            }
            width={320}
            height={240}
            decoding="async"
            className={`absolute inset-0 size-full object-contain ${hasImage ? '' : 'opacity-0'}`}
          />

          {(stale || overlay) && (
            <div
              role="status"
              className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-black/70 p-6 text-center text-canvas"
            >
              {overlay ? (
                <>
                  <span className="text-ink-muted">
                    {unavailable ? <IconPlugOff size={28} /> : <IconLive size={28} />}
                  </span>
                  <p className="text-base font-semibold text-white">{overlay.title}</p>
                  <p className="max-w-md text-sm text-white/80">{overlay.message}</p>
                  {overlay.action === 'retry' && (
                    <Button variant="primary" onClick={retry}>
                      <IconRefresh size={16} />
                      Retry
                    </Button>
                  )}
                </>
              ) : (
                <p className="rounded-md bg-black/60 px-3 py-1.5 text-sm font-medium text-white">
                  Waiting for frames…
                </p>
              )}
            </div>
          )}
        </div>

        <dl className="grid grid-cols-2 gap-x-4 gap-y-2 p-4 text-sm sm:grid-cols-5 sm:p-6">
          <div>
            <dt className="text-xs text-ink-muted">Viewers</dt>
            <dd className="font-semibold tabular">{formatNumber(device.data?.viewers ?? 0)}</dd>
          </div>
          <div>
            <dt className="text-xs text-ink-muted">Frame rate</dt>
            <dd className="font-semibold tabular">
              {hasImage && !stale ? `${frame.fps.toFixed(1)} fps` : '—'}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-ink-muted">Frame size</dt>
            <dd className="font-semibold tabular">
              {hasImage ? `${formatNumber(Math.round(frame.bytes / 1024))} KB` : '—'}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-ink-muted">Stream</dt>
            <dd className="font-semibold">{stream.state}</dd>
          </div>
          <div>
            <dt className="text-xs text-ink-muted">Signal</dt>
            <dd className="font-semibold tabular">
              {device.data?.rssi === null || device.data === undefined
                ? '—'
                : `${formatNumber(device.data.rssi)} dBm`}
            </dd>
          </div>
        </dl>
      </Card>

      <p id="capture-help" className="mt-4 text-sm text-ink-muted">
        Capturing a photo on demand needs admin sign-in, which arrives in a later phase. The rover
        keeps taking samples on its own in the meantime.
      </p>
    </>
  );
}
