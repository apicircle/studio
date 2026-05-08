import { useEffect } from 'react';
import type { ReactNode } from 'react';
import { cn } from './cn';

interface ModalProps {
  open: boolean;
  onClose: () => void;
  title?: string;
  children: ReactNode;
  className?: string;
  /**
   * Class applied to the inner content wrapper. Defaults to `overflow-hidden`
   * so the modal shell does not render a scrollbar groove. Pass
   * `overflow-y-auto` for content whose height is unknown and should scroll
   * inside the modal.
   */
  bodyClassName?: string;
}

export function Modal({ open, onClose, title, children, className, bodyClassName }: ModalProps) {
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
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-6"
      onClick={onClose}
      role="presentation"
    >
      <div
        className={cn(
          'flex max-h-[92vh] w-full max-w-3xl flex-col rounded-md border border-border-strong bg-card shadow-elevated',
          className,
        )}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        {title && (
          <div className="shrink-0 border-b border-border-subtle px-4 py-3 text-sm font-medium text-text-primary">
            {title}
          </div>
        )}
        <div className={cn('flex min-h-0 flex-1 flex-col overflow-y-auto p-4', bodyClassName)}>
          {children}
        </div>
      </div>
    </div>
  );
}
