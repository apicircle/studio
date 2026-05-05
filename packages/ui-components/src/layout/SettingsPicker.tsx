// Workspace settings popover. Today it carries one toggle —
// `validateOnSend` — that controls whether the Editor surfaces the
// pre-send validation panel above the Send button. As more
// developer-experience toggles arrive (verbose plan output, body-size
// hints, etc.) they slot into the same popover.

import { useEffect, useRef, useState } from 'react';
import { Check, ChevronDown, SlidersHorizontal } from 'lucide-react';
import { useWorkspaceStore } from '../store/workspaceStore';
import { cn } from '../primitives/cn';

export function SettingsPicker() {
  const validateOnSend = useWorkspaceStore((s) => s.local?.settings?.validateOnSend ?? true);
  const setValidateOnSend = useWorkspaceStore((s) => s.setValidateOnSend);
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onPointer = (e: PointerEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('pointerdown', onPointer);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('pointerdown', onPointer);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div ref={wrapperRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="inline-flex h-8 items-center gap-2 rounded-sm border border-border bg-surface px-2.5 text-xs text-text-muted transition-colors hover:border-border-strong hover:text-text-primary"
        aria-label="Open workspace settings"
        aria-haspopup="dialog"
        aria-expanded={open}
        title="Workspace settings"
      >
        <SlidersHorizontal size={14} />
        Settings
        <ChevronDown size={11} className={cn('transition-transform', open && 'rotate-180')} />
      </button>
      {open && (
        <div
          role="dialog"
          aria-label="Workspace settings"
          className="absolute right-0 top-full z-30 mt-1 flex w-72 flex-col gap-2 rounded-sm border border-border bg-card p-3 shadow-lg"
        >
          <ToggleRow
            label="Validate before sending"
            description="Show warnings (unresolved variables, unbound path params, etc.) and block Send when auth fields are blank."
            checked={validateOnSend}
            onChange={setValidateOnSend}
            ariaLabel="Validate before sending"
          />
        </div>
      )}
    </div>
  );
}

function ToggleRow({
  label,
  description,
  checked,
  onChange,
  ariaLabel,
}: {
  label: string;
  description: string;
  checked: boolean;
  onChange: (next: boolean) => void;
  ariaLabel: string;
}) {
  return (
    <label className="flex cursor-pointer items-start gap-2 rounded-sm border border-transparent p-1.5 hover:border-border-subtle">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        aria-label={ariaLabel}
        className="mt-0.5 h-3.5 w-3.5 shrink-0 cursor-pointer accent-accent"
      />
      <div className="flex flex-1 flex-col gap-0.5">
        <div className="flex items-center gap-1.5 text-xs text-text-primary">
          {label}
          {checked && <Check size={12} className="text-accent" aria-hidden="true" />}
        </div>
        <p className="text-[11px] leading-snug text-text-dim">{description}</p>
      </div>
    </label>
  );
}
