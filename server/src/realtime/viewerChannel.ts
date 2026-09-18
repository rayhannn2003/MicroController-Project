import type {
  DeviceStatus,
  ServerToViewerMessage,
  StreamState,
  StreamStopReason,
} from '@sylvan/shared';
import type { FastifyBaseLogger } from 'fastify';
import type { WebSocket } from 'ws';
import type { RelayTarget, StreamRelay } from './relay.js';
import { CLOSE, MAX_BAD_MESSAGES, parseTextMessage, viewerWatchSchema } from './protocol.js';

// Status and sample messages are tiny; only skip them for a viewer that is badly backed up.
const TEXT_BACKLOG_LIMIT = 1_000_000;

class Viewer implements RelayTarget {
  badMessages = 0;
  missedPongs = 0;

  constructor(readonly socket: WebSocket) {}

  get bufferedAmount() {
    return this.socket.bufferedAmount;
  }

  sendFrame(frame: Buffer) {
    this.socket.send(frame, { binary: true });
  }

  sendJson(message: ServerToViewerMessage) {
    if (this.socket.readyState !== 1 || this.socket.bufferedAmount > TEXT_BACKLOG_LIMIT) return;
    this.socket.send(JSON.stringify(message));
  }

  close(code: number, reason: string) {
    this.socket.close(code, reason);
  }
}

export interface ViewerChannelOptions {
  relay: StreamRelay;
  log: FastifyBaseLogger;
  getStatus: () => DeviceStatus;
  /** Current stream state to report to a viewer that starts watching. */
  getStreamState: () => { state: StreamState; reason: StreamStopReason | null };
  onWatchersChanged: (count: number) => void;
}

/** Public, read-only `/ws/live` connections from dashboards. */
export class ViewerChannel {
  private readonly viewers = new Set<Viewer>();

  constructor(private readonly options: ViewerChannelOptions) {}

  get count() {
    return this.viewers.size;
  }

  handleConnection(socket: WebSocket) {
    const viewer = new Viewer(socket);
    this.viewers.add(viewer);
    viewer.sendJson({
      type: 'hello',
      serverTime: new Date().toISOString(),
      device: this.options.getStatus(),
    });

    socket.on('message', (data, isBinary) => {
      // See deviceChannel.ts: one connection's bug must never crash the shared server.
      try {
        const buffer = Buffer.isBuffer(data) ? data : Buffer.from(data as ArrayBuffer);
        const parsed = isBinary ? { kind: 'invalid' as const } : parseTextMessage(buffer);
        const watch = parsed.kind === 'message' ? viewerWatchSchema.safeParse(parsed.value) : null;
        if (!watch?.success) {
          viewer.badMessages++;
          if (viewer.badMessages > MAX_BAD_MESSAGES) {
            socket.close(CLOSE.protocolViolation, 'too many invalid messages');
          }
          return;
        }
        this.setWatching(viewer, watch.data.on);
      } catch (error) {
        this.options.log.error({ err: error }, 'error handling viewer message');
      }
    });
    socket.on('pong', () => {
      viewer.missedPongs = 0;
    });
    socket.on('error', (error) => {
      this.options.log.debug({ err: error }, 'viewer socket error');
    });
    socket.on('close', () => {
      this.viewers.delete(viewer);
      if (this.options.relay.remove(viewer)) {
        this.options.onWatchersChanged(this.options.relay.watcherCount);
      }
    });
  }

  private setWatching(viewer: Viewer, on: boolean) {
    const { relay } = this.options;
    if (on === relay.has(viewer)) {
      if (on) viewer.sendJson({ type: 'stream.state', ...this.options.getStreamState() });
      return;
    }
    if (on) {
      relay.add(viewer);
      viewer.sendJson({ type: 'stream.state', ...this.options.getStreamState() });
    } else {
      relay.remove(viewer);
      viewer.sendJson({ type: 'stream.state', state: 'stopped', reason: 'viewer_left' });
    }
    this.options.onWatchersChanged(relay.watcherCount);
  }

  broadcast(message: ServerToViewerMessage) {
    for (const viewer of this.viewers) viewer.sendJson(message);
  }

  broadcastToWatchers(message: ServerToViewerMessage) {
    for (const viewer of this.viewers) {
      if (this.options.relay.has(viewer)) viewer.sendJson(message);
    }
  }

  ping() {
    for (const viewer of this.viewers) {
      if (viewer.missedPongs >= 2) {
        viewer.socket.terminate();
        continue;
      }
      viewer.missedPongs++;
      viewer.socket.ping();
    }
  }

  closeAll(code: number, reason: string) {
    for (const viewer of this.viewers) viewer.close(code, reason);
  }
}
