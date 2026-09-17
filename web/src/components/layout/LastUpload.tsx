import type { UseQueryResult } from '@tanstack/react-query';
import type { Sample } from '@sylvan/shared';
import { formatRelative } from '../../lib/format';
import { useNow } from '../../lib/useNow';
import { RelativeTime } from '../ui/RelativeTime';

/**
 * "Last upload 12 min ago" plus a subtle refresh note. This is deliberately not an online/offline
 * indicator: Phase 3 adds real device status in the slot marked below.
 */
export function LastUpload({ latest }: { latest: UseQueryResult<Sample | null> }) {
  const now = useNow();
  const updated = latest.dataUpdatedAt ? formatRelative(latest.dataUpdatedAt, now) : null;

  return (
    <div className="flex min-w-0 items-center gap-2 text-xs text-ink-muted sm:text-sm">
      {/* Phase 3: device status badge (online/offline from the WebSocket heartbeat) goes here. */}
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
        <span className="hidden text-ink-muted sm:inline" aria-live="off">
          · Updated {updated}
        </span>
      )}
    </div>
  );
}
