import type { Sample } from '@sylvan/shared';
import { Link } from 'react-router';
import { Card, CardHeader } from '../../components/ui/Card';
import { RelativeTime } from '../../components/ui/RelativeTime';
import { SamplePhoto } from '../../components/ui/SamplePhoto';
import { StatusBadge } from '../../components/ui/StatusBadge';
import { Skeleton } from '../../components/ui/Skeleton';
import { ErrorState } from '../../components/ui/States';
import { formatDateTime } from '../../lib/format';

export function SampleMiniCard({ sample, linkSearch }: { sample: Sample; linkSearch: string }) {
  return (
    <Link
      to={`/samples/${sample.id}${linkSearch}`}
      className="group block overflow-hidden rounded-md border border-border bg-surface transition-colors hover:border-border-strong"
      aria-label={`Sample #${sample.id}, ${sample.ok ? 'OK' : 'failed'}, ${formatDateTime(sample.createdAt)}`}
    >
      <SamplePhoto sample={sample} size="sm" />
      <div className="flex items-center justify-between gap-1 px-2 py-1.5">
        <span className="text-sm font-semibold tabular">#{sample.id}</span>
        <StatusBadge ok={sample.ok} />
      </div>
      <div className="px-2 pb-2 text-xs text-ink-muted">
        <RelativeTime value={sample.createdAt} />
      </div>
    </Link>
  );
}

export function RecentStrip({
  samples,
  isPending,
  error,
  onRetry,
  linkSearch,
}: {
  samples: Sample[] | undefined;
  isPending: boolean;
  error: unknown;
  onRetry: () => void;
  linkSearch: string;
}) {
  return (
    <Card aria-labelledby="recent-heading">
      <CardHeader
        id="recent-heading"
        title="Recent samples"
        actions={
          <Link
            to={`/gallery${linkSearch}`}
            className="inline-flex min-h-11 items-center rounded-md px-2 text-sm font-medium text-brand hover:underline"
          >
            Open gallery
          </Link>
        }
      />
      <div className="p-4 sm:p-6">
        {isPending ? (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 xl:grid-cols-8" aria-hidden="true">
            {Array.from({ length: 8 }, (_, index) => (
              <Skeleton key={index} className="aspect-[4/5]" />
            ))}
          </div>
        ) : error && !samples ? (
          <ErrorState error={error} onRetry={onRetry} title="Could not load recent samples" />
        ) : (
          <ul className="-mx-4 flex snap-x gap-3 overflow-x-auto px-4 pb-2 sm:mx-0 sm:grid sm:grid-cols-4 sm:overflow-visible sm:px-0 sm:pb-0 xl:grid-cols-8">
            {samples?.map((sample) => (
              <li key={sample.id} className="w-36 shrink-0 snap-start sm:w-auto">
                <SampleMiniCard sample={sample} linkSearch={linkSearch} />
              </li>
            ))}
          </ul>
        )}
      </div>
    </Card>
  );
}
