import { vi } from 'vitest';

type Listener = ((event: unknown) => void) | null;

/** A WebSocket stand-in that tests drive by hand. */
export class FakeWebSocket {
  static instances: FakeWebSocket[] = [];
  static get last(): FakeWebSocket {
    const socket = FakeWebSocket.instances.at(-1);
    if (!socket) throw new Error('No FakeWebSocket has been created');
    return socket;
  }
  static reset() {
    FakeWebSocket.instances = [];
  }

  readyState = 0;
  binaryType = 'blob';
  sent: string[] = [];
  onopen: Listener = null;
  onmessage: Listener = null;
  onerror: Listener = null;
  onclose: Listener = null;
  closedWith: number | null = null;

  constructor(readonly url: string) {
    FakeWebSocket.instances.push(this);
  }

  send(data: string) {
    this.sent.push(data);
  }

  close(code = 1000) {
    if (this.readyState === 3) return;
    this.readyState = 3;
    this.closedWith = code;
    this.onclose?.({ code, reason: '' });
  }

  // Test helpers
  accept() {
    this.readyState = 1;
    this.onopen?.({});
  }
  drop(code = 1006) {
    this.readyState = 3;
    this.onclose?.({ code, reason: '' });
  }
  emit(message: unknown) {
    this.onmessage?.({ data: JSON.stringify(message) });
  }
  emitFrame(blob: Blob) {
    this.onmessage?.({ data: blob });
  }
  get watchMessages(): { type: string; on: boolean }[] {
    return this.sent.map((text) => JSON.parse(text) as { type: string; on: boolean });
  }
}

export const FakeWebSocketImpl = FakeWebSocket as unknown as typeof WebSocket;

/** Replaces URL.createObjectURL/revokeObjectURL with counting stubs. */
export function stubObjectUrls() {
  let next = 0;
  const create = vi.fn(() => `blob:fake/${++next}`);
  const revoke = vi.fn();
  Object.defineProperty(URL, 'createObjectURL', {
    value: create,
    configurable: true,
    writable: true,
  });
  Object.defineProperty(URL, 'revokeObjectURL', {
    value: revoke,
    configurable: true,
    writable: true,
  });
  return { create, revoke };
}
