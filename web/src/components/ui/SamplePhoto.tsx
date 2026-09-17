import type { Sample } from '@sylvan/shared';
import { useState } from 'react';
import { photoAlt } from '../../lib/format';
import { IconAlert, IconImageOff } from './Icons';

interface SamplePhotoProps {
  sample: Pick<Sample, 'id' | 'createdAt' | 'photoUrl'>;
  className?: string;
  /** Eager-load photos that are visible on first paint (for example the latest sample). */
  priority?: boolean;
  size?: 'sm' | 'md' | 'lg';
}

/** A sample photo in a fixed 4:3 frame, with clear placeholders for missing or broken images. */
export function SamplePhoto({
  sample,
  className = '',
  priority = false,
  size = 'md',
}: SamplePhotoProps) {
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const failed = sample.photoUrl !== null && failedUrl === sample.photoUrl;
  const iconSize = size === 'sm' ? 18 : size === 'md' ? 28 : 40;
  const frame = `relative aspect-[4/3] w-full overflow-hidden bg-surface-muted ${className}`;

  if (!sample.photoUrl || failed) {
    return (
      <div className={`${frame} flex flex-col items-center justify-center gap-1 text-ink-muted`}>
        {failed ? <IconAlert size={iconSize} /> : <IconImageOff size={iconSize} />}
        {size !== 'sm' && (
          <span className="text-xs font-medium">{failed ? 'Photo unavailable' : 'No photo'}</span>
        )}
        <span className="sr-only">
          {failed
            ? `Photo for sample #${sample.id} could not be loaded`
            : `No photo for sample #${sample.id}`}
        </span>
      </div>
    );
  }

  return (
    <div className={frame}>
      <img
        src={sample.photoUrl}
        alt={photoAlt(sample)}
        width={320}
        height={240}
        loading={priority ? 'eager' : 'lazy'}
        decoding="async"
        fetchPriority={priority ? 'high' : 'auto'}
        className="absolute inset-0 size-full object-cover"
        onError={() => {
          setFailedUrl(sample.photoUrl);
        }}
      />
    </div>
  );
}
