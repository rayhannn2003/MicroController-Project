import type { DeviceStatus, Sample } from '@sylvan/shared';
import type { UseQueryResult } from '@tanstack/react-query';
import { formatNumber, formatRelative } from '../../lib/format';
import { useDeviceStatus } from '../../lib/queries';
import { useSocketSnapshot } from '../../lib/socketContext';
import { useNow } from '../../lib/useNow';
import { IconPlugOff, IconSignal } from '../ui/Icons';
import { RelativeTime } from '../ui/RelativeTime';

/** Signal wording that does not rely on the number alone. */
export function signalLabel(rssi: number | null): string | null {
  if (rssi === null) return null;
  if (rssi >= -60) return 'strong';
  if (rssi >= -70) return 'good';
  if (rssi >= -80) return 'weak';
  return 'very weak';
}

export function deviceStatusText(device: DeviceStatus | undefined, now: number): string {
  if (!device) return 'Checking rover…';
  if (device.online) {
    const signal = device.rssi === null ? '' : ` · signal ${formatNumber(device.rssi)} dBm`;
    return `Online${signal}`;
  }
  if (!device.lastSeenAt) return 'Offline · never seen';
  return `Offline · last seen ${formatRelative(device.lastSeenAt, now)}`;
}

/** Status dot plus text; never colour alone. */
function DeviceBadge({ device }: { device: DeviceStatus | undefined }) {
  const now = useNow();
  const text = deviceStatusText(device, now);
  const online = device?.online ?? false;
  const signal = device ? signalLabel(device.rssi) : null;

  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium ${
        device === undefined
          ? 'bg-surface-muted text-ink-muted'
          : online
            ? 'bg-ok-soft text-ok'
            : 'bg-surface-muted text-ink-muted'
      }`}
    >
      {online ? <IconSignal size={14} /> : <IconPlugOff size={14} />}
      <span>{text}</span>
      {online && signal && <span className="sr-only">({signal} signal)</span>}
    </span>
  );
}

/** The quiet "live updates" indicator: it only speaks up when something is wrong. */
function ConnectionIndicator() {
  const { status, blocked, everConnected } = useSocketSnapshot();
  if (status === 'open') {
    return (
      <span className="hidden items-center gap-1 text-xs text-ink-muted sm:inline-flex">
        <span aria-hidden="true" className="size-1.5 rounded-full bg-ok" />
        Live
      </span>
    );
  }
  if (status === 'unsupported' || blocked) {
    return (
      <span className="text-xs text-ink-muted">
        Live updates unavailable · refreshing every 15 s
      </span>
    );
  }
  if (everConnected || status === 'connecting') {
    return <span className="text-xs text-ink-muted">Reconnecting…</span>;
  }
  return null;
}

/**
 * Rover status (from the WebSocket heartbeat, or `GET /api/device` when the socket is blocked),
 * with the last upload time as secondary information.
 */
export function LastUpload({ latest }: { latest: UseQueryResult<Sample | null> }) {
  const now = useNow();
  const device = useDeviceStatus();
  const updated = latest.dataUpdatedAt ? formatRelative(latest.dataUpdatedAt, now) : null;

  return (
    <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-xs text-ink-muted sm:text-sm">
      <DeviceBadge device={device.data} />
      {latest.isPending ? (
        <span>Checking uploads…</span>
      ) : latest.isError && latest.data === undefined ? (
        <span>Upload status unavailable</span>
      ) : latest.data ? (
        <RelativeTime value={latest.data.createdAt} prefix="Last upload" focusable />
      ) : (
        <span>No uploads yet</span>
      )}
      {updated && (
        <span className="hidden text-ink-muted lg:inline" aria-live="off">
          · Updated {updated}
        </span>
      )}
      <ConnectionIndicator />
    </div>
  );
}
