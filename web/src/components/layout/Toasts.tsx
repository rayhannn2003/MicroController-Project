import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { Link } from 'react-router';
import { IconX } from '../ui/Icons';

export interface Toast {
  id: number;
  message: string;
  link?: { to: string; label: string };
}

interface ToastContextValue {
  showToast: (toast: Omit<Toast, 'id'>) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);
const TOAST_MS = 8000;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextId = useRef(1);

  const dismiss = useCallback((id: number) => {
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);

  const showToast = useCallback(
    (toast: Omit<Toast, 'id'>) => {
      const id = nextId.current++;
      setToasts((current) => [...current.slice(-2), { ...toast, id }]);
      setTimeout(() => {
        dismiss(id);
      }, TOAST_MS);
    },
    [dismiss],
  );

  const value = useMemo(() => ({ showToast }), [showToast]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div
        role="status"
        aria-live="polite"
        className="pointer-events-none fixed inset-x-0 bottom-20 z-50 flex flex-col items-center gap-2 px-4 md:bottom-6"
      >
        {toasts.map((toast) => (
          <div
            key={toast.id}
            className="pointer-events-auto flex animate-sheet-up items-center gap-2 rounded-lg border border-border bg-surface py-1 pr-1 pl-4 text-sm text-ink shadow-lg"
          >
            <span>{toast.message}</span>
            {toast.link && (
              <Link
                to={toast.link.to}
                className="inline-flex min-h-11 items-center rounded-md px-2 font-semibold text-brand underline-offset-2 hover:underline"
                onClick={() => {
                  dismiss(toast.id);
                }}
              >
                {toast.link.label}
              </Link>
            )}
            <button
              type="button"
              className="inline-flex size-11 items-center justify-center rounded-md text-ink-muted hover:bg-surface-muted"
              onClick={() => {
                dismiss(toast.id);
              }}
            >
              <IconX size={16} />
              <span className="sr-only">Dismiss</span>
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToasts(): ToastContextValue {
  const context = useContext(ToastContext);
  if (!context) throw new Error('useToasts must be used inside ToastProvider');
  return context;
}
