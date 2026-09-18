import type { ReactNode } from 'react';
import { ApiError } from '../../lib/api';
import { Button } from './Button';
import { IconAlert, IconRefresh } from './Icons';

export function EmptyState({
  icon,
  title,
  message,
  action,
  className = '',
}: {
  icon?: ReactNode;
  title: string;
  message: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`flex flex-col items-center gap-3 rounded-lg border border-dashed border-border-strong bg-surface px-6 py-10 text-center ${className}`}
    >
      {icon && <div className="text-ink-muted">{icon}</div>}
      <h2 className="text-base font-semibold text-ink">{title}</h2>
      <p className="max-w-md text-sm text-ink-muted">{message}</p>
      {action}
    </div>
  );
}

export function errorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.code === 'NETWORK_ERROR') return error.message;
    if (error.status === 429) return 'Too many requests right now. Please try again shortly.';
    if (error.status >= 500) return 'The server had a problem loading this data.';
    return error.message;
  }
  return 'Something went wrong while loading this data.';
}

export function ErrorState({
  error,
  onRetry,
  title = 'Could not load data',
  className = '',
}: {
  error: unknown;
  onRetry?: () => void;
  title?: string;
  className?: string;
}) {
  return (
    <div
      role="alert"
      className={`flex flex-col items-center gap-3 rounded-lg border border-failed/40 bg-failed-soft px-6 py-8 text-center ${className}`}
    >
      <IconAlert className="text-failed" size={24} />
      <h2 className="text-base font-semibold text-ink">{title}</h2>
      <p className="max-w-md text-sm text-ink">{errorMessage(error)}</p>
      {onRetry && (
        <Button onClick={onRetry} variant="secondary">
          <IconRefresh size={16} />
          Retry
        </Button>
      )}
    </div>
  );
}
