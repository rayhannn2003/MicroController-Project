import * as Dialog from '@radix-ui/react-dialog';
import type { ReactNode } from 'react';
import { IconX } from '../ui/Icons';

/**
 * A modal panel: a bottom sheet on phones and a centered dialog on larger screens.
 * Radix handles focus trapping, focus restore, Escape and hiding the background from assistive tech.
 */
export function Sheet({
  open,
  onOpenChange,
  title,
  description,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 animate-fade-in bg-overlay" />
        <Dialog.Content
          className="fixed inset-x-0 bottom-0 z-50 max-h-[90dvh] animate-sheet-up overflow-y-auto rounded-t-xl border border-border bg-surface p-4 pb-[max(1rem,env(safe-area-inset-bottom))] text-ink shadow-xl focus:outline-none md:inset-x-auto md:top-24 md:bottom-auto md:left-1/2 md:w-[28rem] md:-translate-x-1/2 md:rounded-xl md:p-6"
          {...(description ? {} : { 'aria-describedby': undefined })}
        >
          <div className="mb-4 flex items-center justify-between gap-2">
            <Dialog.Title className="text-lg font-semibold">{title}</Dialog.Title>
            <Dialog.Close className="inline-flex size-11 items-center justify-center rounded-md text-ink-muted hover:bg-surface-muted">
              <IconX />
              <span className="sr-only">Close</span>
            </Dialog.Close>
          </div>
          {description && (
            <Dialog.Description className="mb-4 text-sm text-ink-muted">
              {description}
            </Dialog.Description>
          )}
          {children}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
