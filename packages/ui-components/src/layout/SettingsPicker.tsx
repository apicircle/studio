// Workspace settings popover. Opens via the Settings chip in the top
// bar and hosts both behavioral toggles (validate-on-send, etc.) and
// the appearance pickers (theme + font). Theme/Font rows host a side
// popover that opens on click. The side popover preserves the
// standalone pickers' live preview / Esc revert / Enter commit
// semantics via shared ThemeList / FontList components.

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from 'react';
import { createPortal } from 'react-dom';
import {
  Check,
  ChevronDown,
  ChevronRight,
  Minus,
  Palette,
  Plus,
  RotateCcw,
  SlidersHorizontal,
  TextCursorInput,
  Type,
} from 'lucide-react';
import {
  FONT_SIZE_PERCENT_DEFAULT,
  FONT_SIZE_PERCENT_MAX,
  FONT_SIZE_PERCENT_MIN,
  FONT_SIZE_PERCENT_STEP,
} from '@apicircle/shared';
import { useWorkspaceStore } from '../store/workspaceStore';
import { cn } from '../primitives/cn';
import { ALL_THEMES } from '../theme/applyTheme';
import { ALL_FONTS } from '../theme/applyFont';
import { CommunitySection } from '../community/CommunitySection';
import { ThemeList } from './ThemeList';
import { FontList } from './FontList';

const SNAPSHOT_CAP_OPTIONS: Array<{ label: string; bytes: number }> = [
  { label: '10 MB', bytes: 10 * 1024 * 1024 },
  { label: '50 MB', bytes: 50 * 1024 * 1024 },
  { label: '200 MB', bytes: 200 * 1024 * 1024 },
  { label: 'Unlimited', bytes: Number.POSITIVE_INFINITY },
];

type SidePopover = 'theme' | 'font' | null;
const SIDE_POPOVER_ATTR = 'data-settings-side-popover';
const SIDE_POPOVER_GAP_PX = 6;
const SIDE_POPOVER_WIDTH_PX = 256;
const SIDE_POPOVER_VIEWPORT_PADDING_PX = 8;

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
  const fontSizePercent = useWorkspaceStore(
    (s) => s.local?.ui.fontSizePercent ?? FONT_SIZE_PERCENT_DEFAULT,
  );
  const setFontSizePercent = useWorkspaceStore((s) => s.setFontSizePercent);

  const [open, setOpen] = useState(false);
  const [sidePopover, setSidePopover] = useState<SidePopover>(null);
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  // Live "revert to original" callback for whichever side popover (theme
  // or font) is currently mounted. ThemeList / FontList register their
  // revertAndCancel here on mount, and clear it when the user explicitly
  // commits. Any close path that should NOT commit (outside-click, Esc on
  // settings while side popover is open) calls this first to undo the
  // live preview.
  const cancelSidePopoverRef = useRef<(() => void) | null>(null);

  // Always-on subscriptions for the appearance row labels — hooks must
  // run unconditionally regardless of whether the popover is rendered.
  const themeLabel = useThemeLabel();
  const fontLabel = useFontLabel();

  // Click-outside / Escape closes the whole stack. When a side popover
  // is mounted, fire its registered revert callback first so the live
  // theme/font preview reverts to the value we snapshotted on mount —
  // outside-click is treated as cancel, not commit (matches user
  // expectation; the previous behavior silently committed previews).
  useEffect(() => {
    if (!open) return;
    const cancelSidePopover = () => {
      const fn = cancelSidePopoverRef.current;
      if (fn) fn();
      cancelSidePopoverRef.current = null;
    };
    const onPointer = (e: PointerEvent) => {
      const target = e.target as Node;
      const sidePopover = document.querySelector(`[${SIDE_POPOVER_ATTR}]`);
      const insideSettings = wrapperRef.current?.contains(target) ?? false;
      const insideSidePopover = sidePopover?.contains(target) ?? false;
      if (!insideSettings && !insideSidePopover) {
        cancelSidePopover();
        setOpen(false);
        setSidePopover(null);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (sidePopover !== null) {
          // Esc inside the side popover is handled by ThemeList/FontList
          // (revert + close). Only swallow Esc that escapes them.
          return;
        }
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

  const closeSidePopover = () => {
    cancelSidePopoverRef.current = null;
    setSidePopover(null);
  };
  const cancelSidePopover = () => {
    const fn = cancelSidePopoverRef.current;
    if (fn) fn();
    cancelSidePopoverRef.current = null;
    setSidePopover(null);
  };
  const registerCancel = (fn: (() => void) | null) => {
    cancelSidePopoverRef.current = fn;
  };

  return (
    <div ref={wrapperRef} className="relative">
      <button
        type="button"
        data-tour="settings"
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
          // `max-h-[calc(100vh-4rem)] overflow-y-auto` lets the popover
          // scroll when its content (now including the Community section)
          // is taller than the viewport — without this, the bottom of
          // the popover is clipped off-screen and unreachable.
          className="absolute left-0 top-full z-30 mt-1 flex max-h-[calc(100vh-4rem)] w-72 flex-col gap-2 overflow-y-auto rounded-sm border border-border bg-card p-3 shadow-lg"
        >
          <SectionLabel>Appearance</SectionLabel>
          <AppearanceRow
            row="theme"
            icon={<Palette size={13} aria-hidden="true" />}
            label="Theme"
            valueLabel={themeLabel}
            open={sidePopover === 'theme'}
            onOpen={() => setSidePopover('theme')}
            onCommit={closeSidePopover}
            onCancel={cancelSidePopover}
            registerCancel={registerCancel}
          />
          <AppearanceRow
            row="font"
            icon={<Type size={13} aria-hidden="true" />}
            label="Font family"
            valueLabel={fontLabel}
            open={sidePopover === 'font'}
            onOpen={() => setSidePopover('font')}
            onCommit={closeSidePopover}
            onCancel={cancelSidePopover}
            registerCancel={registerCancel}
          />
          <FontSizeRow current={fontSizePercent} onChange={setFontSizePercent} />

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

          <div className="my-1 h-px bg-border-subtle" aria-hidden="true" />
          <CommunitySection />
        </div>
      )}
    </div>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="px-1.5 text-[0.625rem] font-medium uppercase tracking-wider text-text-dim">
      {children}
    </div>
  );
}

function useThemeLabel(): string {
  const themeId = useWorkspaceStore((s) => s.local?.ui.themeId ?? 'one-dark-pro');
  return useMemo(
    () => ALL_THEMES.find((t) => t.id === themeId)?.label ?? 'One Dark Pro',
    [themeId],
  );
}

function useFontLabel(): string {
  const fontId = useWorkspaceStore((s) => s.local?.ui.fontId ?? 'system-sans');
  return useMemo(() => ALL_FONTS.find((f) => f.id === fontId)?.label ?? 'System Sans', [fontId]);
}

interface AppearanceRowProps {
  row: 'theme' | 'font';
  icon: React.ReactNode;
  label: string;
  valueLabel: string;
  open: boolean;
  onOpen: () => void;
  /** Explicit commit (Enter / click on an option). Keeps the previewed value. */
  onCommit: () => void;
  /** Explicit cancel (Esc, outside-click). Reverts to the original value. */
  onCancel: () => void;
  /**
   * Lets the mounted ThemeList / FontList expose its revertAndCancel so
   * the SettingsPicker shell can fire it when the user clicks outside or
   * presses Esc on the parent popover. Pass `null` to clear the registration.
   */
  registerCancel: (fn: (() => void) | null) => void;
}

/**
 * Row inside the Settings popover. Click toggles the side popover
 * hosting the Theme or Font listbox. The active state stays applied to
 * the row whose popover is open so the user has a clear visual anchor
 * while browsing the list.
 */
function AppearanceRow({
  row,
  icon,
  label,
  valueLabel,
  open,
  onOpen,
  onCommit,
  onCancel,
  registerCancel,
}: AppearanceRowProps) {
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const [popoverStyle, setPopoverStyle] = useState<CSSProperties | null>(null);

  const updatePopoverPosition = useCallback(() => {
    const button = buttonRef.current;
    const rect = button?.getBoundingClientRect();
    if (!button || !rect) return;
    const settingsRect = button
      .closest('[role="dialog"][aria-label="Workspace settings"]')
      ?.getBoundingClientRect();
    const anchorRight = Math.max(rect.right, settingsRect?.right ?? rect.right);
    const anchorLeft = Math.min(rect.left, settingsRect?.left ?? rect.left);
    const padding = SIDE_POPOVER_VIEWPORT_PADDING_PX;
    const listHeight = Math.min(window.innerHeight * 0.6, window.innerHeight - padding * 2);
    const hasRightRoom =
      anchorRight + SIDE_POPOVER_GAP_PX + SIDE_POPOVER_WIDTH_PX <= window.innerWidth - padding;
    const left = hasRightRoom
      ? anchorRight + SIDE_POPOVER_GAP_PX
      : Math.max(padding, anchorLeft - SIDE_POPOVER_GAP_PX - SIDE_POPOVER_WIDTH_PX);
    const top = Math.min(
      Math.max(padding, rect.top),
      Math.max(padding, window.innerHeight - listHeight - padding),
    );
    setPopoverStyle({ left, top });
  }, []);

  const openSidePopover = useCallback(() => {
    updatePopoverPosition();
    onOpen();
  }, [onOpen, updatePopoverPosition]);

  useLayoutEffect(() => {
    if (!open) return;
    updatePopoverPosition();
  }, [open, updatePopoverPosition]);

  useEffect(() => {
    if (!open) return;
    window.addEventListener('resize', updatePopoverPosition);
    window.addEventListener('scroll', updatePopoverPosition, true);
    return () => {
      window.removeEventListener('resize', updatePopoverPosition);
      window.removeEventListener('scroll', updatePopoverPosition, true);
    };
  }, [open, updatePopoverPosition]);

  return (
    <div className="relative">
      <button
        ref={buttonRef}
        type="button"
        onClick={() => (open ? onCancel() : openSidePopover())}
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
            'flex items-center gap-1 text-[0.6875rem]',
            open ? 'text-accent' : 'text-text-muted',
          )}
        >
          <span className="max-w-[110px] truncate">{valueLabel}</span>
          <ChevronRight size={11} aria-hidden="true" />
        </span>
      </button>
      {open &&
        typeof document !== 'undefined' &&
        createPortal(
          <div
            {...{ [SIDE_POPOVER_ATTR]: '' }}
            // The side popover is portalled out of the scrollable
            // Settings dialog. Rendering it inside the dialog allowed
            // listbox focus/scrollIntoView to horizontally scroll the
            // Settings panel itself.
            // `bg-card` ensures the popover surface paints opaque even if
            // the inner list is briefly mid-render or its own background
            // doesn't fully cover (e.g. rounded corners).
            className="fixed z-40 rounded-sm bg-card"
            style={popoverStyle ?? { left: -9999, top: -9999 }}
          >
            {row === 'theme' ? (
              <ThemeList onCommit={onCommit} onCancel={onCancel} registerCancel={registerCancel} />
            ) : (
              <FontList onCommit={onCommit} onCancel={onCancel} registerCancel={registerCancel} />
            )}
          </div>,
          document.body,
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
      <p className="mb-1.5 text-[0.6875rem] leading-snug text-text-dim">
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
                  ? 'rounded-sm border border-accent/40 bg-accent/10 px-2 py-0.5 text-[0.6875rem] text-accent'
                  : 'rounded-sm border border-border bg-surface px-2 py-0.5 text-[0.6875rem] text-text-muted hover:border-border-strong hover:text-text-primary'
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

/**
 * Workspace text-size scaling. Three buttons: decrease / current / increase,
 * with a Reset affordance that only appears when the current value differs
 * from 100%. The current-value chip uses the accent style when scaled so
 * the user has a glance-cue that the workspace is non-default. The buttons
 * snap by `FONT_SIZE_PERCENT_STEP` and are disabled at the min/max edges
 * so keyboard users can tab past gracefully.
 */
function FontSizeRow({
  current,
  onChange,
}: {
  current: number;
  onChange: (percent: number) => void;
}) {
  const atMin = current <= FONT_SIZE_PERCENT_MIN;
  const atMax = current >= FONT_SIZE_PERCENT_MAX;
  const atDefault = current === FONT_SIZE_PERCENT_DEFAULT;
  return (
    <div className="rounded-sm border border-transparent p-1.5 hover:border-border-subtle">
      <div className="flex items-center gap-2 text-xs text-text-primary">
        <TextCursorInput size={13} className="text-text-dim" aria-hidden="true" />
        Text size
      </div>
      <p className="mb-1.5 ml-[21px] text-[0.6875rem] leading-snug text-text-dim">
        Scales all UI text, including code editors. Snaps in {FONT_SIZE_PERCENT_STEP}% steps.
      </p>
      <div className="ml-[21px] flex items-center gap-1.5">
        <button
          type="button"
          onClick={() => onChange(current - FONT_SIZE_PERCENT_STEP)}
          disabled={atMin}
          aria-label="Decrease text size"
          className={cn(
            'inline-flex h-6 w-6 items-center justify-center rounded-sm border transition-colors',
            atMin
              ? 'cursor-not-allowed border-border-subtle bg-surface/40 text-text-faint'
              : 'border-border bg-surface text-text-muted hover:border-border-strong hover:text-text-primary',
          )}
        >
          <Minus size={12} aria-hidden="true" />
        </button>
        <span
          aria-live="polite"
          aria-label={`Current text size ${current} percent`}
          className={cn(
            'inline-flex h-6 min-w-[3.25rem] items-center justify-center rounded-sm border px-2 text-[0.6875rem] tabular-nums',
            atDefault
              ? 'border-border bg-surface text-text-muted'
              : 'border-accent/40 bg-accent/10 text-accent',
          )}
        >
          {current}%
        </span>
        <button
          type="button"
          onClick={() => onChange(current + FONT_SIZE_PERCENT_STEP)}
          disabled={atMax}
          aria-label="Increase text size"
          className={cn(
            'inline-flex h-6 w-6 items-center justify-center rounded-sm border transition-colors',
            atMax
              ? 'cursor-not-allowed border-border-subtle bg-surface/40 text-text-faint'
              : 'border-border bg-surface text-text-muted hover:border-border-strong hover:text-text-primary',
          )}
        >
          <Plus size={12} aria-hidden="true" />
        </button>
        {!atDefault && (
          <button
            type="button"
            onClick={() => onChange(FONT_SIZE_PERCENT_DEFAULT)}
            aria-label="Reset text size to 100%"
            className="ml-auto inline-flex h-6 items-center gap-1 rounded-sm border border-transparent px-1.5 text-[0.6875rem] text-text-muted transition-colors hover:border-border-subtle hover:text-text-primary"
          >
            <RotateCcw size={11} aria-hidden="true" />
            Reset
          </button>
        )}
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
        <p className="text-[0.6875rem] leading-snug text-text-dim">{description}</p>
      </div>
    </label>
  );
}
