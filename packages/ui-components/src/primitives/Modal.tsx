import { useEffect, useRef } from 'react';
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

/**
 * Selector for elements that should receive Tab focus inside the dialog.
 * Mirrors WAI-ARIA APG modal pattern. Skips elements with `tabindex="-1"`
 * and disabled controls.
 */
const FOCUSABLE_SELECTOR = [
  'a[href]',
  'area[href]',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  'button:not([disabled])',
  'iframe',
  'object',
  'embed',
  '[contenteditable="true"]',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

function getFocusable(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
    (el) => el.offsetParent !== null || el === document.activeElement,
  );
}

export function Modal({ open, onClose, title, children, className, bodyClassName }: ModalProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  // Element that had focus immediately before the modal opened. Restored
  // when the modal closes so the user lands back where they were —
  // typically the button that launched the dialog.
  const launcherRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return;
    launcherRef.current = (document.activeElement as HTMLElement) ?? null;

    // Defer to next frame so children have rendered and we can find the
    // first focusable element. If the dialog has no focusable child, fall
    // back to focusing the dialog container itself.
    const focusFrame = requestAnimationFrame(() => {
      const dialog = dialogRef.current;
      if (!dialog) return;
      const focusables = getFocusable(dialog);
      if (focusables.length > 0) focusables[0].focus();
      else dialog.focus();
    });

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
        return;
      }
      if (e.key !== 'Tab') return;
      const dialog = dialogRef.current;
      if (!dialog) return;
      const focusables = getFocusable(dialog);
      if (focusables.length === 0) {
        e.preventDefault();
        dialog.focus();
        return;
      }
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      const active = document.activeElement as HTMLElement | null;
      // Tab/Shift+Tab loops focus inside the dialog. Without this, focus
      // can fall into background DOM behind the overlay.
      if (e.shiftKey && (active === first || !dialog.contains(active))) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && (active === last || !dialog.contains(active))) {
        e.preventDefault();
        first.focus();
      }
    };

    window.addEventListener('keydown', onKey);
    return () => {
      cancelAnimationFrame(focusFrame);
      window.removeEventListener('keydown', onKey);
      // Restore focus to the launcher. Defer to a microtask so any
      // synchronous re-render settles first; without this, focus can land
      // before the launcher is back in the layout.
      const launcher = launcherRef.current;
      launcherRef.current = null;
      if (launcher && document.body.contains(launcher)) {
        queueMicrotask(() => launcher.focus({ preventScroll: true }));
      }
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-6"
      onClick={onClose}
      role="presentation"
    >
      <div
        ref={dialogRef}
        className={cn(
          'flex max-h-[92vh] w-full max-w-3xl flex-col rounded-md border border-border-strong bg-card shadow-elevated focus:outline-none',
          className,
        )}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        // tabIndex=-1 lets us programmatically focus the dialog container
        // when no focusable child exists (e.g. text-only confirm dialog
        // with the Cancel/Confirm buttons not yet mounted).
        tabIndex={-1}
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
