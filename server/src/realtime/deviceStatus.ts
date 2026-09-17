import type { DeviceStatus } from '@sylvan/shared';

export interface HelloInfo {
  fw?: string | undefined;
  bootId?: string | undefined;
}

export interface HeartbeatInfo {
  rssi?: number | undefined;
  uptimeS?: number | undefined;
  freeHeap?: number | undefined;
  streaming?: boolean | undefined;
}

/**
 * In-memory rover status. Nothing here touches the database; the realtime hub persists the
 * notable transitions (connect, disconnect, boot, timeout).
 */
export class DeviceStatusTracker {
  private socketOpen = false;
  private online = false;
  private lastHeartbeatAt = 0;
  private lastSeenAt: number | null = null;
  private connectedAt: number | null = null;
  private rssi: number | null = null;
  private uptimeS: number | null = null;
  private freeHeap: number | null = null;
  private streaming = false;
  private viewers = 0;
  private fw: string | null = null;
  private bootId: string | null = null;

  constructor(
    private readonly options: {
      timeoutMs: number;
      now: () => number;
      /** Called for changes worth broadcasting (not for lastSeenAt-only updates). */
      onChange: (urgent: boolean) => void;
    },
  ) {}

  restore(lastSeenAt: Date | null, bootId: string | null) {
    this.lastSeenAt = lastSeenAt?.getTime() ?? null;
    this.bootId = bootId;
  }

  connected() {
    const now = this.options.now();
    this.socketOpen = true;
    this.online = true;
    // The connection itself counts as contact, giving the device one timeout to send a heartbeat.
    this.lastHeartbeatAt = now;
    this.lastSeenAt = now;
    this.connectedAt = now;
    this.streaming = false;
    this.options.onChange(true);
  }

  /** Returns true when the hello reports a boot id different from the last one recorded. */
  hello(info: HelloInfo): boolean {
    this.lastSeenAt = this.options.now();
    if (info.fw !== undefined) this.fw = info.fw;
    let newBoot = false;
    if (info.bootId !== undefined && info.bootId !== this.bootId) {
      this.bootId = info.bootId;
      newBoot = true;
    }
    this.options.onChange(false);
    return newBoot;
  }

  heartbeat(info: HeartbeatInfo) {
    const now = this.options.now();
    this.lastHeartbeatAt = now;
    this.lastSeenAt = now;
    if (info.rssi !== undefined) this.rssi = info.rssi;
    if (info.uptimeS !== undefined) this.uptimeS = info.uptimeS;
    if (info.freeHeap !== undefined) this.freeHeap = info.freeHeap;
    if (info.streaming !== undefined) this.streaming = info.streaming;
    const cameBack = this.socketOpen && !this.online;
    if (cameBack) this.online = true;
    this.options.onChange(cameBack);
  }

  frame() {
    this.lastSeenAt = this.options.now();
  }

  disconnected() {
    this.socketOpen = false;
    this.online = false;
    this.streaming = false;
    this.connectedAt = null;
    this.options.onChange(true);
  }

  setViewers(count: number) {
    if (count === this.viewers) return;
    this.viewers = count;
    this.options.onChange(false);
  }

  /** Called on the shared timer. Returns true when the device just timed out. */
  tick(): boolean {
    if (!this.online) return false;
    if (this.options.now() - this.lastHeartbeatAt <= this.options.timeoutMs) return false;
    this.online = false;
    this.streaming = false;
    this.options.onChange(true);
    return true;
  }

  get isOnline() {
    return this.online;
  }

  get currentBootId() {
    return this.bootId;
  }

  snapshot(): DeviceStatus {
    const iso = (value: number | null) => (value === null ? null : new Date(value).toISOString());
    return {
      online: this.online,
      lastSeenAt: iso(this.lastSeenAt),
      connectedAt: iso(this.connectedAt),
      rssi: this.rssi,
      uptimeS: this.uptimeS,
      freeHeap: this.freeHeap,
      streaming: this.streaming,
      viewers: this.viewers,
      fw: this.fw,
    };
  }
}
