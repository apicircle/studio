// Workspace settings popover. Opens via the Settings chip in the top
// bar and hosts both behavioral toggles (validate-on-send, etc.) and
// the appearance pickers (theme + font). Theme/Font rows host a side
// popover that opens on hover (with a 200ms intent delay so an
// accidental cursor pass doesn't trigger it) and on click for keyboard
// users. The side popover preserves the standalone pickers' live
// preview / Esc revert / Enter commit semantics via shared ThemeList /
// FontList components.

import { useEffect, useMemo, useRef, useState } from 'react';
import { Check, ChevronDown, ChevronRight, Palette, SlidersHorizontal, Type } from 'lucide-react';
import { useWorkspaceStore } from '../store/workspaceStore';
import { cn } from '../primitives/cn';
import { ALL_THEMES } from '../theme/applyTheme';
import { ALL_FONTS } from '../theme/applyFont';
import { ThemeList } from './ThemeList';
import { FontList } from './FontList';

const SNAPSHOT_CAP_OPTIONS: Array<{ label: string; bytes: number }> = [
  { label: '10 MB', bytes: 10 * 1024 * 1024 },
  { label: '50 MB', bytes: 50 * 1024 * 1024 },
  { label: '200 MB', bytes: 200 * 1024 * 1024 },
  { label: 'Unlimited', bytes: Number.POSITIVE_INFINITY },
];

// Hover-intent timing. Open is generous so brushing past doesn't fire.
// There's no hover-leave close timer by design — once the popover is
// open, only an explicit click outside the Settings popover or an Esc
// keypress dismisses it. This avoids the "I moved my mouse and the
// theme list disappeared mid-browse" problem.
const HOVER_OPEN_DELAY_MS = 200;

type SidePopover = 'theme' | 'font' | null;

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
  const [sidePopover, setSidePopover] = useState<SidePopover>(null);
  const wrapperRef = useRef<HTMLDivElement | null>(null);

  // Always-on subscriptions for the appearance row labels — hooks must
  // run unconditionally regardless of whether the popover is rendered.
  const themeLabel = useThemeLabel();
  const fontLabel = useFontLabel();

  // Click-outside / Escape closes the whole stack. Side popover Escape
  // is handled inside ThemeList/FontList (revert + close), so this
  // handler only fires when the side popover is closed.
  useEffect(() => {
    if (!open) return;
    const onPointer = (e: PointerEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setOpen(false);
        setSidePopover(null);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && sidePopover === null) {
        setOpen(false);
      }
    };
    window.addEventListener('pointerdown', onPointer);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('pointerdown', onPointer);
      window.removeEventListener('keydown', onKey);
    };
  }, [open, sidePopover]);

  const closeSidePopover = () => setSidePopover(null);

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
          className="absolute left-0 top-full z-30 mt-1 flex w-72 flex-col gap-2 rounded-sm border border-border bg-card p-3 shadow-lg"
        >
          <SectionLabel>Appearance</SectionLabel>
          <AppearanceRow
            row="theme"
            icon={<Palette size={13} aria-hidden="true" />}
            label="Theme"
            valueLabel={themeLabel}
            open={sidePopover === 'theme'}
            onOpen={() => setSidePopover('theme')}
            onClose={closeSidePopover}
          />
          <AppearanceRow
            row="font"
            icon={<Type size={13} aria-hidden="true" />}
            label="Font family"
            valueLabel={fontLabel}
            open={sidePopover === 'font'}
            onOpen={() => setSidePopover('font')}
            onClose={closeSidePopover}
          />

          <div className="my-1 h-px bg-border-subtle" aria-hidden="true" />
          <SectionLabel>Behavior</SectionLabel>
          <ToggleRow
            label="Validate before sending"
            description="Show warnings (unresolved variables, unbound path params, etc.) and block Send when auth fields are blank."
            checked={validateOnSend}
            onChange={setValidateOnSend}
            ariaLabel="Validate before sending"
          />
          <ToggleRow
            label="Code editor captures mouse wheel"
            description="When on, scrolling inside a code editor stays inside the editor until you reach its top or bottom. When off (default), the page keeps scrolling so long content doesn't get trapped inside the editor."
            checked={monacoConsumesWheel}
            onChange={setMonacoConsumesWheel}
            ariaLabel="Code editor captures mouse wheel"
          />
          <SnapshotCapRow current={snapshotMaxBytes} onChange={setSnapshotMaxBytes} />
        </div>
      )}
    </div>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="px-1.5 text-[10px] font-medium uppercase tracking-wider text-text-dim">
      {children}
    </div>
  );
}

function useThemeLabel(): string {
  const themeId = useWorkspaceStore((s) => s.local?.ui.themeId ?? 'studio-dark');
  return useMemo(() => ALL_THEMES.find((t) => t.id === themeId)?.label ?? 'Studio Dark', [themeId]);
}

function useFontLabel(): string {
  const fontId = useWorkspaceStore((s) => s.local?.ui.fontId ?? 'system-mono');
  return useMemo(() => ALL_FONTS.find((f) => f.id === fontId)?.label ?? 'System mono', [fontId]);
}

interface AppearanceRowProps {
  row: 'theme' | 'font';
  icon: React.ReactNode;
  label: string;
  valueLabel: string;
  open: boolean;
  onOpen: () => void;
  onClose: () => void;
}

/**
 * Row inside the Settings popover. Hover with a 200ms intent delay
 * opens the side popover hosting the Theme or Font listbox; clicking
 * the row toggles the same popover (handy for keyboard users). The
 * popover does NOT auto-close on hover-leave — only an explicit click
 * outside Settings or an Esc keypress dismisses it. The active state
 * stays applied to the row whose popover is open so the user has a
 * clear visual anchor while browsing the list.
 */
function AppearanceRow({
  row,
  icon,
  label,
  valueLabel,
  open,
  onOpen,
  onClose,
}: AppearanceRowProps) {
  const openTimerRef = useRef<number | null>(null);

  const cancelOpenTimer = () => {
    if (openTimerRef.current !== null) {
      window.clearTimeout(openTimerRef.current);
      openTimerRef.current = null;
    }
  };

  const scheduleOpen = () => {
    cancelOpenTimer();
    if (open) return;
    openTimerRef.current = window.setTimeout(() => {
      onOpen();
      openTimerRef.current = null;
    }, HOVER_OPEN_DELAY_MS);
  };

  // Cleanup if the row unmounts before the open timer fires.
  useEffect(() => () => cancelOpenTimer(), []);

  return (
    <div
      className="relative"
      // Intent-delayed open on hover. The popover persists after mouse
      // leave — closing happens via click-outside / Esc.
      onPointerEnter={scheduleOpen}
      // Cancel any pending open if the cursor leaves before the delay
      // elapses. Once `open === true`, this is a no-op.
      onPointerLeave={cancelOpenTimer}
    >
      <button
        type="button"
        onClick={() => (open ? onClose() : onOpen())}
        onFocus={onOpen}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={`${label}: ${valueLabel} — open list`}
        className={cn(
          'flex w-full items-center justify-between gap-2 rounded-sm border border-transparent px-1.5 py-1.5 text-left transition-colors',
          'hover:border-border-subtle hover:bg-surface',
          // Active state mirrors the side popover so the row whose list
          // is showing has a clear visual anchor.
          open && 'border-accent/40 bg-accent/10 text-accent',
        )}
      >
        <span
          className={cn(
            'flex items-center gap-2 text-xs',
            open ? 'text-accent' : 'text-text-primary',
          )}
        >
          <span className={open ? 'text-accent' : 'text-text-dim'}>{icon}</span>
          {label}
        </span>
        <span
          className={cn(
            'flex items-center gap-1 text-[11px]',
            open ? 'text-accent' : 'text-text-muted',
          )}
        >
          <span className="max-w-[110px] truncate">{valueLabel}</span>
          <ChevronRight size={11} aria-hidden="true" />
        </span>
      </button>
      {open && (
        <div
          // Side popover sits to the right of the Settings popover.
          // Settings is left-anchored under the top-bar trigger, so
          // there's room. Vertical alignment matches the row's top.
          // `bg-card` ensures the popover surface paints opaque even if
          // the inner list is briefly mid-render or its own background
          // doesn't fully cover (e.g. rounded corners).
          className="absolute left-full top-0 z-40 ml-1.5 rounded-sm bg-card"
        >
          {row === 'theme' ? (
            <ThemeList onCommit={onClose} onCancel={onClose} />
          ) : (
            <FontList onCommit={onClose} onCancel={onClose} />
          )}
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
