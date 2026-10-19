import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { BrandLoader } from './BrandLoader';
import { Modal } from './Modal';
import { cn } from './cn';

interface BaseProps {
  open: boolean;
  title: string;
  description?: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  /** "danger" recolors the confirm button red — used for destructive actions. */
  tone?: 'normal' | 'danger';
  /**
   * What the confirm button says while the action runs ("Resetting…"). It is
   * busy for as long as the promise `onConfirm` returns is pending, and for as
   * long as `busy` is set — for a caller that closes nothing until work it
   * started elsewhere has finished.
   */
  busyLabel?: string;
  busy?: boolean;
  onCancel: () => void;
  onConfirm: () => void | Promise<void>;
}

interface SimpleProps extends BaseProps {
  /** When omitted, a single click confirms. */
  typedConfirm?: undefined;
}

interface TypedProps extends BaseProps {
  /**
   * The user must type this string verbatim before the confirm button
   * enables. Used for destructive actions like withdrawing a release
   * version (e.g. "Type WITHDRAW v1.3.0…" — internal name `yank` survives
   * in the data model, but the user-facing label is "Withdraw").
   */
  typedConfirm: string;
}

type ConfirmDialogProps = SimpleProps | TypedProps;

/**
 * Modal yes/no with an optional typed-confirm gate. Plan §5.2 (P5)
 * routes every version-change action through one of these so the user
 * can't tap-through-and-regret a destructive change.
 */
export function ConfirmDialog(props: ConfirmDialogProps) {
  const {
    open,
    title,
    description,
    confirmLabel = 'Confirm',
    cancelLabel = 'Cancel',
    tone = 'normal',
    busyLabel = 'Working…',
    busy: busyProp = false,
    onCancel,
    onConfirm,
  } = props;
  const typed = 'typedConfirm' in props ? props.typedConfirm : undefined;
  const [text, setText] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) {
      setText('');
      setSubmitting(false);
    } else if (typed && inputRef.current) {
      // Focus the typed-confirm input on open so the user can start typing
      // immediately. Without this they'd have to click twice.
      requestAnimationFrame(() => inputRef.current?.focus());
    } else {
      // Cancel otherwise, wherever it sits. The modal opens on its first
      // control, and that is Cancel only while the description holds none of
      // its own: with an option in it (the box that also clears a workspace's
      // data on disconnect) the dialog opened on the option, a Space away from
      // ticking it. This runs after the modal's own focus, so it wins.
      requestAnimationFrame(() => cancelRef.current?.focus());
    }
  }, [open, typed]);

  const busy = submitting || busyProp;
  const canConfirm = !busy && (typed === undefined || text === typed);

  const submit = async () => {
    if (!canConfirm) return;
    setSubmitting(true);
    try {
      await onConfirm();
    } finally {
      setSubmitting(false);
    }
  };

  return (
    // While the action runs there is nothing to cancel: Escape and the backdrop
    // leave the dialog up, so the user sees it finish instead of losing track of
    // an action that is still going.
    <Modal open={open} onClose={busy ? () => {} : onCancel} title={title} className="max-w-md">
      <div className="space-y-3 text-xs text-text-muted">
        {description && <div>{description}</div>}
        {typed !== undefined && (
          <div>
            <label htmlFor="confirm-typed-input" className="block text-[0.6875rem] text-text-dim">
              Type <code className="text-text-primary">{typed}</code> to continue
            </label>
            <input
              id="confirm-typed-input"
              ref={inputRef}
              value={text}
              onChange={(e) => setText(e.target.value)}
              aria-label="Type to confirm"
              className="mt-1 h-8 w-full rounded-sm border border-border bg-surface px-2 font-mono text-xs text-text-primary focus:border-accent focus:outline-none"
            />
          </div>
        )}
        <div className="flex justify-end gap-2 pt-1">
          <button
            ref={cancelRef}
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="inline-flex h-7 items-center rounded-sm border border-border bg-surface px-3 text-xs text-text-muted hover:border-border-strong hover:text-text-primary disabled:opacity-50"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={() => void submit()}
            disabled={!canConfirm}
            aria-busy={busy || undefined}
            className={cn(
              'inline-flex h-7 items-center gap-1.5 rounded-sm border px-3 text-xs disabled:opacity-50',
              busy && 'disabled:cursor-progress disabled:opacity-100',
              tone === 'danger'
                ? 'border-danger/50 bg-danger/10 text-danger hover:bg-danger/20'
                : 'border-accent/40 bg-accent/10 text-accent hover:bg-accent/20',
            )}
          >
            {busy && <BrandLoader size="xs" />}
            {busy ? busyLabel : confirmLabel}
          </button>
        </div>
      </div>
    </Modal>
  );
}
