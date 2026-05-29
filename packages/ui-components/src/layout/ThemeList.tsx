// Listbox + keyboard navigation for theme selection. Shared between
// SettingsPicker (theme row → side popover) and any future surface that
// needs the same picker. Keeps the live-preview / Esc-revert /
// Enter-commit semantics identical to the standalone version.

import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { Check, LoaderCircle } from 'lucide-react';
import type { ThemeId } from '@apicircle/shared';
import { useWorkspaceStore } from '../store/workspaceStore';
import { ALL_THEMES, type ThemeDef } from '../theme/applyTheme';
import { cn } from '../primitives/cn';

type Group = { key: 'dark' | 'light' | 'high-contrast'; label: string; themes: ThemeDef[] };
const HOVER_PREVIEW_DELAY_MS = 1000;

function groupThemes(themes: ReadonlyArray<ThemeDef>): Group[] {
  const dark = themes.filter((t) => t.mode === 'dark' && t.tag !== 'high-contrast');
  const light = themes.filter((t) => t.mode === 'light' && t.tag !== 'high-contrast');
  const hc = themes.filter((t) => t.tag === 'high-contrast');
  const all: Group[] = [
    { key: 'dark', label: 'Dark', themes: dark },
    { key: 'light', label: 'Light', themes: light },
    { key: 'high-contrast', label: 'High Contrast', themes: hc },
  ];
  return all.filter((g) => g.themes.length > 0);
}

interface ThemeListProps {
  /** Called when the user commits a selection (Enter / click). */
  onCommit: () => void;
  /** Called when the user dismisses with Escape — reverts to the original theme. */
  onCancel: () => void;
  /**
   * Hands the parent shell a "revert + close" callback so it can fire it
   * when the user clicks outside the parent popover or otherwise dismisses
   * implicitly. Without this, outside-click would silently commit the live
   * preview because the parent shell has no way to ask us to revert.
   */
  registerCancel?: (fn: (() => void) | null) => void;
}

/**
 * Theme listbox with grouped sections, keyboard navigation, and live
 * preview. Snapshots the original theme on mount and reverts on cancel
 * so the user can browse without committing.
 */
export function ThemeList({ onCommit, onCancel, registerCancel }: ThemeListProps) {
  const themeId = useWorkspaceStore((s) => s.local?.ui.themeId ?? 'command-center');
  const setThemeId = useWorkspaceStore((s) => s.setThemeId);
  const optionRefs = useRef<Map<ThemeId, HTMLButtonElement>>(new Map());
  const originalThemeRef = useRef<ThemeId>(themeId);
  const currentThemeRef = useRef(themeId);
  const hoverPreviewTimerRef = useRef<number | null>(null);
  const guidanceId = useId();
  const [pendingPreviewId, setPendingPreviewId] = useState<ThemeId | null>(null);
  useEffect(() => {
    currentThemeRef.current = themeId;
  }, [themeId]);

  // Tracks whether the user has explicitly committed the current selection.
  // Used by the unmount-revert below — if the component unmounts without a
  // commit (parent click-outside, parent unmount), we revert the live preview.
  const committedRef = useRef(false);

  const groups = useMemo(() => groupThemes(ALL_THEMES), []);
  const flatOrder = useMemo(() => groups.flatMap((g) => g.themes.map((t) => t.id)), [groups]);
  const activeIndex = flatOrder.indexOf(themeId);
  const [focusIndex, setFocusIndex] = useState(activeIndex >= 0 ? activeIndex : 0);

  const clearHoverPreviewTimer = useCallback(() => {
    if (hoverPreviewTimerRef.current !== null) {
      window.clearTimeout(hoverPreviewTimerRef.current);
      hoverPreviewTimerRef.current = null;
    }
  }, []);

  const cancelHoverPreview = useCallback(() => {
    clearHoverPreviewTimer();
    setPendingPreviewId(null);
  }, [clearHoverPreviewTimer]);

  const scheduleHoverPreview = useCallback(
    (id: ThemeId) => {
      cancelHoverPreview();
      if (id === currentThemeRef.current) return;
      setPendingPreviewId(id);
      hoverPreviewTimerRef.current = window.setTimeout(() => {
        setThemeId(id);
        setPendingPreviewId(null);
        hoverPreviewTimerRef.current = null;
      }, HOVER_PREVIEW_DELAY_MS);
    },
    [cancelHoverPreview, setThemeId],
  );

  useEffect(() => () => clearHoverPreviewTimer(), [clearHoverPreviewTimer]);

  // Snapshot the original on mount — list lives only while open, so the
  // mount is the open moment. If the consumer unmounts us without a
  // commit, we don't auto-revert; the consumer is expected to call
  // onCancel which we expose for that purpose.
  useEffect(() => {
    originalThemeRef.current = currentThemeRef.current;
    const id = flatOrder[focusIndex];
    const btn = id ? optionRefs.current.get(id) : null;
    btn?.focus({ preventScroll: true });
    btn?.scrollIntoView?.({ block: 'nearest' });
    // Intentional: mount-only snapshot.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Live-preview the focused theme as the user navigates.
  useEffect(() => {
    const id = flatOrder[focusIndex];
    if (!id) return;
    const btn = optionRefs.current.get(id);
    if (btn && document.activeElement !== btn) {
      btn.focus({ preventScroll: true });
      btn.scrollIntoView({ block: 'nearest' });
    }
    if (id !== currentThemeRef.current) setThemeId(id);
  }, [focusIndex, flatOrder, setThemeId]);

  const revertAndCancel = () => {
    cancelHoverPreview();
    const original = originalThemeRef.current;
    if (original !== currentThemeRef.current) setThemeId(original);
    onCancel();
  };

  const commit = () => {
    cancelHoverPreview();
    originalThemeRef.current = currentThemeRef.current;
    committedRef.current = true;
    onCommit();
  };

  // Hand the parent shell our revert-on-cancel function so click-outside
  // and other implicit-dismiss paths can fire it before unmounting us.
  // Without this, the parent has no way to undo the live preview.
  useEffect(() => {
    if (!registerCancel) return;
    const fn = () => {
      cancelHoverPreview();
      const original = originalThemeRef.current;
      if (original !== currentThemeRef.current) setThemeId(original);
      committedRef.current = true; // suppresses unmount-revert below
    };
    registerCancel(fn);
    return () => registerCancel(null);
  }, [cancelHoverPreview, registerCancel, setThemeId]);

  // Belt-and-braces revert: if we unmount without an explicit commit (e.g.
  // a parent that doesn't use registerCancel), restore the original.
  useEffect(() => {
    return () => {
      if (committedRef.current) return;
      const original = originalThemeRef.current;
      if (original !== currentThemeRef.current) setThemeId(original);
    };
  }, [setThemeId]);

  const handleKey = (e: React.KeyboardEvent<HTMLUListElement>) => {
    if (['ArrowDown', 'ArrowUp', 'Home', 'End', 'Enter', ' ', 'Escape'].includes(e.key)) {
      cancelHoverPreview();
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setFocusIndex((i) => Math.min(flatOrder.length - 1, i + 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setFocusIndex((i) => Math.max(0, i - 1));
    } else if (e.key === 'Home') {
      e.preventDefault();
      setFocusIndex(0);
    } else if (e.key === 'End') {
      e.preventDefault();
      setFocusIndex(flatOrder.length - 1);
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      commit();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      revertAndCancel();
    }
  };

  return (
    <div className="w-64 overflow-hidden rounded-sm border border-border-strong bg-card shadow-elevated">
      <div
        id={guidanceId}
        className="sticky top-0 z-20 border-b border-border-subtle bg-card px-3 py-2 text-[0.6875rem] leading-snug text-text-muted"
      >
        Hover or use keyboard navigation to preview. Click to apply.
      </div>
      <ul
        role="listbox"
        aria-label="Themes"
        aria-describedby={guidanceId}
        onKeyDown={handleKey}
        className="max-h-[calc(60vh-2.5rem)] overflow-y-auto overscroll-contain"
      >
        {groups.map((group) => (
          <li key={group.key}>
            <div
              role="presentation"
              className="sticky top-0 z-10 border-b border-border-subtle bg-card px-3 pb-1 pt-2 text-[0.625rem] font-medium uppercase tracking-wider text-text-dim"
            >
              {group.label}
            </div>
            <ul role="presentation">
              {group.themes.map((theme) => {
                const active = theme.id === themeId;
                const pending = pendingPreviewId === theme.id;
                return (
                  <li key={theme.id}>
                    <button
                      ref={(el) => {
                        if (el) optionRefs.current.set(theme.id, el);
                        else optionRefs.current.delete(theme.id);
                      }}
                      type="button"
                      role="option"
                      aria-selected={active}
                      tabIndex={-1}
                      onClick={() => {
                        cancelHoverPreview();
                        setThemeId(theme.id);
                        originalThemeRef.current = theme.id;
                        committedRef.current = true;
                        onCommit();
                      }}
                      onMouseEnter={() => scheduleHoverPreview(theme.id)}
                      onMouseLeave={cancelHoverPreview}
                      className={cn(
                        'flex w-full items-center justify-between px-3 py-2 text-left text-sm transition-colors',
                        active
                          ? 'bg-accent/10 text-text-primary'
                          : 'text-text-muted hover:bg-surface hover:text-text-primary',
                      )}
                    >
                      <span>{theme.label}</span>
                      <OptionStatus
                        active={active}
                        pending={pending}
                        testId={`theme-${theme.id}`}
                      />
                    </button>
                  </li>
                );
              })}
            </ul>
          </li>
        ))}
      </ul>
    </div>
  );
}

function OptionStatus({
  active,
  pending,
  testId,
}: {
  active: boolean;
  pending: boolean;
  testId: string;
}) {
  return (
    <span className="ml-2 flex h-4 w-4 shrink-0 items-center justify-center">
      {pending ? (
        <LoaderCircle
          size={14}
          aria-hidden="true"
          data-testid={`${testId}-preview-pending`}
          className="animate-spin text-accent transition-opacity"
        />
      ) : active ? (
        <Check
          size={14}
          aria-hidden="true"
          data-testid={`${testId}-preview-active`}
          className="text-accent transition-transform duration-150"
        />
      ) : null}
    </span>
  );
}
