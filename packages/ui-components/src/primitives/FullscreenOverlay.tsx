// Edge-to-edge overlay used by the body editor and response viewer to
// pop themselves to fullscreen. Differs from Modal: no max-width, no
// padded backdrop — the panel content fills the viewport so Monaco's
// `automaticLayout` picks up the new dimensions and re-flows.

import { useEffect } from 'react';
import type { ReactNode } from 'react';
import { Minimize2, X } from 'lucide-react';
import { cn } from './cn';

interface FullscreenOverlayProps {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  className?: string;
  toolbar?: ReactNode;
}

export function FullscreenOverlay({
  open,
  onClose,
  title,
  children,
  className,
  toolbar,
}: FullscreenOverlayProps) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className={cn('fixed inset-0 z-50 flex flex-col bg-card text-text-primary', className)}
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      <div className="flex items-center justify-between border-b border-border-subtle px-3 py-2">
        <span className="text-xs font-medium text-text-primary">{title}</span>
        <div className="flex items-center gap-2">
          {toolbar}
          <button
            type="button"
            onClick={onClose}
            aria-label="Exit fullscreen"
            title="Exit fullscreen (Esc)"
            className="inline-flex h-7 w-7 items-center justify-center rounded-sm border border-border bg-surface text-text-muted hover:text-text-primary"
          >
            <Minimize2 size={13} />
          </button>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="inline-flex h-7 w-7 items-center justify-center rounded-sm border border-border bg-surface text-text-muted hover:text-text-primary"
          >
            <X size={13} />
          </button>
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-hidden">{children}</div>
    </div>
  );
}
