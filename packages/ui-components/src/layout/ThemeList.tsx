// Listbox + keyboard navigation for theme selection. Shared between
// SettingsPicker (theme row → side popover) and any future surface that
// needs the same picker. Keeps the live-preview / Esc-revert /
// Enter-commit semantics identical to the standalone version.

import { useEffect, useMemo, useRef, useState } from 'react';
import { Check } from 'lucide-react';
import type { ThemeId } from '@apicircle/shared';
import { useWorkspaceStore } from '../store/workspaceStore';
import { ALL_THEMES, type ThemeDef } from '../theme/applyTheme';
import { cn } from '../primitives/cn';

type Group = { key: 'dark' | 'light' | 'high-contrast'; label: string; themes: ThemeDef[] };

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
  const themeId = useWorkspaceStore((s) => s.local?.ui.themeId ?? 'one-dark-pro');
  const setThemeId = useWorkspaceStore((s) => s.setThemeId);
  const optionRefs = useRef<Map<ThemeId, HTMLButtonElement>>(new Map());
  const originalThemeRef = useRef<ThemeId>(themeId);
  const currentThemeRef = useRef(themeId);
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
    const original = originalThemeRef.current;
    if (original !== currentThemeRef.current) setThemeId(original);
    onCancel();
  };

  const commit = () => {
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
      const original = originalThemeRef.current;
      if (original !== currentThemeRef.current) setThemeId(original);
      committedRef.current = true; // suppresses unmount-revert below
    };
    registerCancel(fn);
    return () => registerCancel(null);
  }, [registerCancel, setThemeId]);

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
    <ul
      role="listbox"
      aria-label="Themes"
      onKeyDown={handleKey}
      className="max-h-[60vh] w-64 overflow-y-auto overscroll-contain rounded-sm border border-border-strong bg-card shadow-elevated"
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
                      setThemeId(theme.id);
                      originalThemeRef.current = theme.id;
                      committedRef.current = true;
                      onCommit();
                    }}
                    className={cn(
                      'flex w-full items-center justify-between px-3 py-2 text-left text-sm transition-colors',
                      active
                        ? 'bg-accent/10 text-text-primary'
                        : 'text-text-muted hover:bg-surface hover:text-text-primary',
                    )}
                  >
                    <span>{theme.label}</span>
                    {active && <Check size={14} className="text-accent" />}
                  </button>
                </li>
              );
            })}
          </ul>
        </li>
      ))}
    </ul>
  );
}
