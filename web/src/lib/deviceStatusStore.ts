import type { DeviceStatus } from '@sylvan/shared';
import { useSyncExternalStore } from 'react';

/**
 * The most recent status pushed over the WebSocket. It is kept outside TanStack Query because a
 * poll that is already in flight would otherwise overwrite fresher pushed data when it resolves.
 */
let current: DeviceStatus | null = null;
const listeners = new Set<() => void>();

export function setPushedDeviceStatus(status: DeviceStatus) {
  current = status;
  for (const listener of listeners) listener();
}

export function resetPushedDeviceStatus() {
  current = null;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

const snapshot = () => current;

export function usePushedDeviceStatus(): DeviceStatus | null {
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}
