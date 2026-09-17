import type { ServerToViewerMessage } from '@sylvan/shared';

export type SocketStatus = 'connecting' | 'open' | 'closed' | 'unsupported';

/** Viewer close codes (the server's values; shared/src/types.ts documents them). */
export const VIEWER_CLOSE = { goingAway: 1001, tooSlow: 4008 } as const;

export interface SocketSnapshot {
  status: SocketStatus;
  /** True once a connection has succeeded at least once. */
  everConnected: boolean;
  /** Consecutive failed attempts since the last success. */
  failures: number;
  lastCloseCode: number | null;
  /** Repeated failures without ever connecting: most likely a proxy or firewall blocking WS. */
  blocked: boolean;
  watching: boolean;
}

type MessageHandler = (message: ServerToViewerMessage) => void;
type FrameHandler = (frame: Blob) => void;

const HIDDEN_PAUSE_MS = 60_000;
const MAX_BACKOFF_MS = 30_000;
const BASE_BACKOFF_MS = 1000;
const BLOCKED_AFTER_FAILURES = 3;

export interface LiveSocketOptions {
  url?: string;
  /** Pass null to simulate a browser without WebSocket support. */
  WebSocketImpl?: typeof WebSocket | null;
  now?: () => number;
  random?: () => number;
  /** Test hook: how long the tab may stay hidden before the socket is closed. */
  hiddenPauseMs?: number;
}

function defaultUrl(): string {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${protocol}//${window.location.host}/ws/live`;
}

/**
 * One shared connection to `/ws/live` for the whole app: it reconnects with exponential backoff
 * and jitter, pauses while the tab stays hidden, and re-sends the watch flag after reconnecting.
 * Everything keeps working without it; Phase 2's polling stays on whenever it is not open.
 */
export class LiveSocket {
  private socket: WebSocket | null = null;
  private readonly messageHandlers = new Set<MessageHandler>();
  private readonly frameHandlers = new Set<FrameHandler>();
  private readonly statusListeners = new Set<() => void>();
  private snapshot: SocketSnapshot = {
    status: 'closed',
    everConnected: false,
    failures: 0,
    lastCloseCode: null,
    blocked: false,
    watching: false,
  };
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private hiddenTimer: ReturnType<typeof setTimeout> | null = null;
  private started = false;
  private readonly WebSocketImpl: typeof WebSocket | undefined;
  private readonly now: () => number;
  private readonly random: () => number;
  private readonly hiddenPauseMs: number;
  private readonly url: string | undefined;

  constructor(options: LiveSocketOptions = {}) {
    const fallback = typeof WebSocket === 'undefined' ? undefined : WebSocket;
    this.WebSocketImpl =
      options.WebSocketImpl === undefined ? fallback : (options.WebSocketImpl ?? undefined);
    this.now = options.now ?? Date.now;
    this.random = options.random ?? Math.random;
    this.hiddenPauseMs = options.hiddenPauseMs ?? HIDDEN_PAUSE_MS;
    this.url = options.url;
    if (!this.WebSocketImpl) this.patch({ status: 'unsupported' });
  }

  getSnapshot = (): SocketSnapshot => this.snapshot;

  subscribeStatus = (listener: () => void): (() => void) => {
    this.statusListeners.add(listener);
    return () => this.statusListeners.delete(listener);
  };

  subscribe(handler: MessageHandler): () => void {
    this.messageHandlers.add(handler);
    return () => this.messageHandlers.delete(handler);
  }

  subscribeFrames(handler: FrameHandler): () => void {
    this.frameHandlers.add(handler);
    return () => this.frameHandlers.delete(handler);
  }

  private patch(changes: Partial<SocketSnapshot>) {
    const next = { ...this.snapshot, ...changes };
    next.blocked = !next.everConnected && next.failures >= BLOCKED_AFTER_FAILURES;
    this.snapshot = next;
    for (const listener of this.statusListeners) listener();
  }

  /** Starts connecting and watching the page's visibility. Safe to call repeatedly. */
  start() {
    if (this.started || !this.WebSocketImpl) return;
    this.started = true;
    document.addEventListener('visibilitychange', this.onVisibilityChange);
    this.connect();
  }

  stop() {
    this.started = false;
    document.removeEventListener('visibilitychange', this.onVisibilityChange);
    this.clearTimers();
    this.closeSocket();
    this.patch({ status: 'closed' });
  }

  private onVisibilityChange = () => {
    if (document.visibilityState === 'hidden') {
      // Only pause if the tab stays hidden; switching windows briefly should not drop frames.
      this.hiddenTimer ??= setTimeout(() => {
        this.hiddenTimer = null;
        this.closeSocket();
        this.clearReconnect();
        this.patch({ status: 'closed' });
      }, this.hiddenPauseMs);
      return;
    }
    if (this.hiddenTimer) {
      clearTimeout(this.hiddenTimer);
      this.hiddenTimer = null;
    }
    if (this.started && this.snapshot.status === 'closed') this.retryNow();
  };

  private connect() {
    const Impl = this.WebSocketImpl;
    if (!Impl || !this.started || this.socket) return;
    this.clearReconnect();
    this.patch({ status: 'connecting' });

    const socket = new Impl(this.url ?? defaultUrl());
    socket.binaryType = 'blob';
    this.socket = socket;

    socket.onopen = () => {
      this.patch({ status: 'open', everConnected: true, failures: 0, lastCloseCode: null });
      if (this.snapshot.watching) this.send({ type: 'watch', on: true });
    };
    socket.onmessage = (event: MessageEvent<unknown>) => {
      this.handleMessage(event.data);
    };
    socket.onerror = () => {
      // `onclose` always follows; the failure is counted there.
    };
    socket.onclose = (event: CloseEvent) => {
      if (this.socket !== socket) return;
      this.socket = null;
      const tooSlow = event.code === VIEWER_CLOSE.tooSlow;
      this.patch({
        status: 'closed',
        failures: this.snapshot.failures + 1,
        lastCloseCode: event.code,
        // The server dropped us for being too slow: do not immediately ask for frames again.
        ...(tooSlow ? { watching: false } : {}),
      });
      if (this.started && document.visibilityState !== 'hidden') this.scheduleReconnect();
    };
  }

  private handleMessage(data: unknown) {
    if (typeof data === 'string') {
      let message: ServerToViewerMessage;
      try {
        message = JSON.parse(data) as ServerToViewerMessage;
      } catch {
        return;
      }
      for (const handler of this.messageHandlers) handler(message);
      return;
    }
    if (typeof Blob !== 'undefined' && data instanceof Blob) {
      for (const handler of this.frameHandlers) handler(data);
    }
  }

  private scheduleReconnect() {
    if (this.reconnectTimer) return;
    const attempt = Math.min(this.snapshot.failures, 10);
    const ceiling = Math.min(MAX_BACKOFF_MS, BASE_BACKOFF_MS * 2 ** (attempt - 1));
    // Full jitter in the upper half of the window: spreads reconnects without waiting too long.
    const delay = Math.round(ceiling / 2 + this.random() * (ceiling / 2));
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delay);
  }

  /** Reconnects straight away (used by the Retry button and when the tab becomes visible). */
  retryNow() {
    if (!this.started) this.started = true;
    this.clearReconnect();
    if (this.socket) return;
    this.patch({ failures: 0 });
    this.connect();
  }

  setWatching(on: boolean) {
    if (this.snapshot.watching === on) return;
    this.patch({ watching: on });
    this.send({ type: 'watch', on });
  }

  private send(message: { type: 'watch'; on: boolean }) {
    if (this.socket?.readyState === 1) this.socket.send(JSON.stringify(message));
  }

  private closeSocket() {
    const socket = this.socket;
    this.socket = null;
    if (!socket) return;
    socket.onopen = socket.onmessage = socket.onerror = socket.onclose = null;
    socket.close();
  }

  private clearReconnect() {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  private clearTimers() {
    this.clearReconnect();
    if (this.hiddenTimer) {
      clearTimeout(this.hiddenTimer);
      this.hiddenTimer = null;
    }
  }

  /** Test helper: milliseconds until the next reconnect attempt, or null. */
  get reconnectPending() {
    return this.reconnectTimer !== null;
  }
}
