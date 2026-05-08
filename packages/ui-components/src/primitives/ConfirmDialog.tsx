import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
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
   * enables. Plan §5.2 calls for this on yank: "Type YANK v1.3.0…".
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
    onCancel,
    onConfirm,
  } = props;
  const typed = 'typedConfirm' in props ? props.typedConfirm : undefined;
  const [text, setText] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) {
      setText('');
      setSubmitting(false);
    } else if (typed && inputRef.current) {
      // Focus the typed-confirm input on open so the user can start typing
      // immediately. Without this they'd have to click twice.
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open, typed]);

  const canConfirm = !submitting && (typed === undefined || text === typed);

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
    <Modal open={open} onClose={onCancel} title={title} className="max-w-md">
      <div className="space-y-3 text-xs text-text-muted">
        {description && <div>{description}</div>}
        {typed !== undefined && (
          <div>
            <label htmlFor="confirm-typed-input" className="block text-[11px] text-text-dim">
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
            type="button"
            onClick={onCancel}
            className="inline-flex h-7 items-center rounded-sm border border-border bg-surface px-3 text-xs text-text-muted hover:border-border-strong hover:text-text-primary"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={() => void submit()}
            disabled={!canConfirm}
            className={cn(
              'inline-flex h-7 items-center rounded-sm border px-3 text-xs disabled:opacity-50',
              tone === 'danger'
                ? 'border-danger/50 bg-danger/10 text-danger hover:bg-danger/20'
                : 'border-accent/40 bg-accent/10 text-accent hover:bg-accent/20',
            )}
          >
            {submitting ? 'Working…' : confirmLabel}
          </button>
        </div>
      </div>
    </Modal>
  );
}
