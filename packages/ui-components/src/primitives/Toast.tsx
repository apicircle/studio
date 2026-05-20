import { useEffect } from 'react';
import { AlertCircle, CheckCircle2, Info, X } from 'lucide-react';
import { cn } from './cn';

export type ToastTone = 'info' | 'success' | 'error';

export interface ToastRecord {
  id: string;
  tone: ToastTone;
  title: string;
  detail?: string;
  /** Milliseconds before auto-dismiss. Errors default to 8s, others 4s. */
  ttlMs?: number;
}

interface ToastViewportProps {
  toasts: ReadonlyArray<ToastRecord>;
  onDismiss: (id: string) => void;
}

/**
 * Stacked toast viewport — mounted once at the App root. Each toast carries
 * its own ttl; the slot fires `onDismiss` when the timer expires OR when
 * the user clicks the close affordance. `role="status"` for info/success
 * (polite), `role="alert"` for error (assertive). Screen readers announce
 * either way.
 */
export function ToastViewport({ toasts, onDismiss }: ToastViewportProps) {
  if (toasts.length === 0) return null;
  return (
    <div
      // aria-live region; per-toast role overrides this for assertive cases.
      aria-live="polite"
      className="pointer-events-none fixed bottom-3 right-3 z-[60] flex max-w-sm flex-col gap-2"
    >
      {toasts.map((t) => (
        <ToastItem key={t.id} toast={t} onDismiss={onDismiss} />
      ))}
    </div>
  );
}

function ToastItem({ toast, onDismiss }: { toast: ToastRecord; onDismiss: (id: string) => void }) {
  const ttl = toast.ttlMs ?? (toast.tone === 'error' ? 8000 : 4000);
  useEffect(() => {
    const id = window.setTimeout(() => onDismiss(toast.id), ttl);
    return () => window.clearTimeout(id);
  }, [toast.id, ttl, onDismiss]);

  const Icon =
    toast.tone === 'success' ? CheckCircle2 : toast.tone === 'error' ? AlertCircle : Info;
  return (
    <div
      role={toast.tone === 'error' ? 'alert' : 'status'}
      className={cn(
        'pointer-events-auto flex items-start gap-2 rounded-sm border px-3 py-2 text-xs shadow-elevated',
        toast.tone === 'success' && 'border-success/40 bg-success/10 text-text-primary',
        toast.tone === 'error' && 'border-danger/40 bg-danger/10 text-text-primary',
        toast.tone === 'info' && 'border-accent/40 bg-accent/10 text-text-primary',
      )}
    >
      <Icon
        size={13}
        className={cn(
          'mt-0.5 shrink-0',
          toast.tone === 'success' && 'text-success',
          toast.tone === 'error' && 'text-danger',
          toast.tone === 'info' && 'text-accent',
        )}
        aria-hidden="true"
      />
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <div className="font-medium">{toast.title}</div>
        {toast.detail && (
          <div className="break-words text-[0.6875rem] text-text-muted">{toast.detail}</div>
        )}
      </div>
      <button
        type="button"
        onClick={() => onDismiss(toast.id)}
        aria-label="Dismiss"
        className="ml-1 shrink-0 rounded-sm p-0.5 text-text-faint hover:text-text-primary"
      >
        <X size={11} aria-hidden="true" />
      </button>
    </div>
  );
}
