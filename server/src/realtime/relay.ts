import { CLOSE } from './protocol.js';

/** The part of a viewer socket the relay needs; lets tests use fakes. */
export interface RelayTarget {
  readonly bufferedAmount: number;
  sendFrame(frame: Buffer): void;
  close(code: number, reason: string): void;
}

export interface RelayStats {
  framesIn: number;
  framesSent: number;
  droppedSlow: number;
  droppedRate: number;
  droppedNoViewers: number;
  bytesIn: number;
}

const emptyStats = (): RelayStats => ({
  framesIn: 0,
  framesSent: 0,
  droppedSlow: 0,
  droppedRate: 0,
  droppedNoViewers: 0,
  bytesIn: 0,
});

/**
 * Fans each device frame out to watching viewers without buffering anything. A viewer whose
 * socket already holds `slowViewerBytes` of unsent data skips the frame; one that stays that
 * slow for `slowCloseMs` is closed with 4008 so it cannot hold memory indefinitely.
 */
export class StreamRelay {
  private readonly watchers = new Map<RelayTarget, { slowSince: number | null }>();
  private tokens: number;
  private lastRefill: number;
  private stats = emptyStats();
  lastFrameAt: number | null = null;

  constructor(
    private readonly options: {
      slowViewerBytes: number;
      slowCloseMs: number;
      /** Incoming frames beyond this rate are dropped (token bucket, burst = 1 s). */
      maxFps: number;
      now: () => number;
      onSlowClose?: (target: RelayTarget) => void;
    },
  ) {
    this.tokens = options.maxFps;
    this.lastRefill = options.now();
  }

  get watcherCount() {
    return this.watchers.size;
  }

  has(target: RelayTarget) {
    return this.watchers.has(target);
  }

  add(target: RelayTarget) {
    if (!this.watchers.has(target)) this.watchers.set(target, { slowSince: null });
  }

  remove(target: RelayTarget) {
    return this.watchers.delete(target);
  }

  private takeToken(now: number) {
    const elapsed = now - this.lastRefill;
    this.lastRefill = now;
    this.tokens = Math.min(
      this.options.maxFps,
      this.tokens + (elapsed / 1000) * this.options.maxFps,
    );
    if (this.tokens < 1) return false;
    this.tokens -= 1;
    return true;
  }

  /** Returns true when the frame was accepted for fan-out (not rate-limited or unwatched). */
  handleFrame(frame: Buffer): boolean {
    const now = this.options.now();
    this.stats.framesIn++;
    this.stats.bytesIn += frame.length;

    if (this.watchers.size === 0) {
      this.stats.droppedNoViewers++;
      return false;
    }
    if (!this.takeToken(now)) {
      this.stats.droppedRate++;
      return false;
    }
    this.lastFrameAt = now;

    for (const [target, state] of this.watchers) {
      if (target.bufferedAmount >= this.options.slowViewerBytes) {
        this.stats.droppedSlow++;
        state.slowSince ??= now;
        if (now - state.slowSince > this.options.slowCloseMs) this.closeSlow(target);
        continue;
      }
      state.slowSince = null;
      target.sendFrame(frame);
      this.stats.framesSent++;
    }
    return true;
  }

  /** Called on the shared timer so a slow viewer is closed even if frames stop arriving. */
  tick() {
    const now = this.options.now();
    for (const [target, state] of this.watchers) {
      if (target.bufferedAmount < this.options.slowViewerBytes) {
        state.slowSince = null;
      } else if (state.slowSince !== null && now - state.slowSince > this.options.slowCloseMs) {
        this.closeSlow(target);
      }
    }
  }

  private closeSlow(target: RelayTarget) {
    this.watchers.delete(target);
    this.options.onSlowClose?.(target);
    target.close(CLOSE.tooSlow, 'too slow');
  }

  /** Returns counters since the last call and resets them. */
  takeStats(): RelayStats {
    const stats = this.stats;
    this.stats = emptyStats();
    return stats;
  }

  clear() {
    this.watchers.clear();
  }
}

/**
 * Tells the device how many viewers are watching without spamming it: a start (0 → n) waits
 * `startDelayMs`, a stop (n → 0) waits `stopDelayMs` so quick page toggles cancel out, and any
 * message is at most one per `throttleMs`.
 */
export class ViewerCountNotifier {
  private desired = 0;
  private lastSent: number | null = null;
  private lastSentAt = -Infinity;
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly options: {
      startDelayMs: number;
      stopDelayMs: number;
      throttleMs: number;
      now: () => number;
      send: (count: number) => void;
    },
  ) {}

  /** A (re)connected device must learn the current count immediately. */
  deviceConnected() {
    this.cancel();
    this.sendNow();
  }

  update(count: number) {
    this.desired = count;
    this.schedule();
  }

  private schedule() {
    this.cancel();
    if (this.desired === this.lastSent) return;
    const wasZero = (this.lastSent ?? 0) === 0;
    const isZero = this.desired === 0;
    const delay =
      wasZero && !isZero
        ? this.options.startDelayMs
        : !wasZero && isZero
          ? this.options.stopDelayMs
          : 0;
    const now = this.options.now();
    const at = Math.max(now + delay, this.lastSentAt + this.options.throttleMs);
    this.timer = setTimeout(
      () => {
        this.timer = null;
        if (this.desired !== this.lastSent) this.sendNow();
      },
      Math.max(0, at - now),
    );
    this.timer.unref();
  }

  private sendNow() {
    this.lastSent = this.desired;
    this.lastSentAt = this.options.now();
    this.options.send(this.desired);
  }

  deviceDisconnected() {
    this.cancel();
    this.lastSent = null;
  }

  cancel() {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  get hasTimer() {
    return this.timer !== null;
  }
}
