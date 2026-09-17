import { formatDateTime, formatRelative } from '../../lib/format';
import { useNow } from '../../lib/useNow';

interface RelativeTimeProps {
  value: string;
  className?: string;
  /** Standalone times are focusable so keyboard users can reveal the exact time. */
  focusable?: boolean;
  prefix?: string;
}

/**
 * Visible relative time ("12 min ago"). The exact local time is part of the accessible text and
 * appears as a tooltip on hover or keyboard focus.
 */
export function RelativeTime({
  value,
  className = '',
  focusable = false,
  prefix,
}: RelativeTimeProps) {
  const now = useNow();
  const relative = formatRelative(value, now);
  const exact = formatDateTime(value);
  const visible = prefix ? `${prefix} ${relative}` : relative;

  return (
    <time
      dateTime={value}
      className={`group relative inline-block tabular ${focusable ? 'cursor-help rounded-sm' : ''} ${className}`}
      tabIndex={focusable ? 0 : undefined}
    >
      <span aria-hidden="true">{visible}</span>
      <span className="sr-only">
        {visible} ({exact})
      </span>
      <span
        role="presentation"
        aria-hidden="true"
        className="pointer-events-none absolute top-full left-1/2 z-30 mt-1 hidden -translate-x-1/2 rounded-sm bg-ink px-2 py-1 text-xs font-normal whitespace-nowrap text-canvas shadow-card group-hover:block group-focus-visible:block"
      >
        {exact}
      </span>
    </time>
  );
}
