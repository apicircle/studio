// Workspace settings popover. Today it carries one toggle —
// `validateOnSend` — that controls whether the Editor surfaces the
// pre-send validation panel above the Send button. As more
// developer-experience toggles arrive (verbose plan output, body-size
// hints, etc.) they slot into the same popover.

import { useEffect, useRef, useState } from 'react';
import { Check, ChevronDown, SlidersHorizontal } from 'lucide-react';
import { useWorkspaceStore } from '../store/workspaceStore';
import { cn } from '../primitives/cn';

const SNAPSHOT_CAP_OPTIONS: Array<{ label: string; bytes: number }> = [
  { label: '10 MB', bytes: 10 * 1024 * 1024 },
  { label: '50 MB', bytes: 50 * 1024 * 1024 },
  { label: '200 MB', bytes: 200 * 1024 * 1024 },
  { label: 'Unlimited', bytes: Number.POSITIVE_INFINITY },
];

export function SettingsPicker() {
  const validateOnSend = useWorkspaceStore((s) => s.local?.settings?.validateOnSend ?? true);
  const setValidateOnSend = useWorkspaceStore((s) => s.setValidateOnSend);
  const monacoConsumesWheel = useWorkspaceStore(
    (s) => s.local?.settings?.monacoConsumesWheel ?? false,
  );
  const setMonacoConsumesWheel = useWorkspaceStore((s) => s.setMonacoConsumesWheel);
  const snapshotMaxBytes = useWorkspaceStore(
    (s) => s.local?.snapshots?.maxBytes ?? 50 * 1024 * 1024,
  );
  const setSnapshotMaxBytes = useWorkspaceStore((s) => s.setSnapshotMaxBytes);
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
          <ToggleRow
            label="Monaco consumes mouse wheel"
            description="When on, the code editor scrolls first and only releases the wheel at its top/bottom. When off (default), wheel events fall through so the page keeps scrolling past the editor."
            checked={monacoConsumesWheel}
            onChange={setMonacoConsumesWheel}
            ariaLabel="Monaco consumes mouse wheel"
          />
          <SnapshotCapRow current={snapshotMaxBytes} onChange={setSnapshotMaxBytes} />
        </div>
      )}
    </div>
  );
}

function SnapshotCapRow({
  current,
  onChange,
}: {
  current: number;
  onChange: (bytes: number) => void;
}) {
  return (
    <div className="rounded-sm border border-transparent p-1.5 hover:border-border-subtle">
      <div className="text-xs text-text-primary">Workspace snapshot cap</div>
      <p className="mb-1.5 text-[11px] leading-snug text-text-dim">
        Total size budget for the local snapshot ledger. Auto-captures (push, merge, yank, etc.)
        keep the latest entries that fit; older snapshots evict when over cap.
      </p>
      <div role="radiogroup" aria-label="Workspace snapshot cap" className="flex flex-wrap gap-1">
        {SNAPSHOT_CAP_OPTIONS.map((opt) => {
          const active =
            current === opt.bytes ||
            (opt.bytes === Number.POSITIVE_INFINITY && !Number.isFinite(current));
          return (
            <button
              key={opt.label}
              type="button"
              role="radio"
              aria-checked={active}
              onClick={() => onChange(opt.bytes)}
              className={
                active
                  ? 'rounded-sm border border-accent/40 bg-accent/10 px-2 py-0.5 text-[11px] text-accent'
                  : 'rounded-sm border border-border bg-surface px-2 py-0.5 text-[11px] text-text-muted hover:border-border-strong hover:text-text-primary'
              }
            >
              {opt.label}
            </button>
          );
        })}
      </div>
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
