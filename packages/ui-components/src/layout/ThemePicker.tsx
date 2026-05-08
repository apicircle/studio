import { useEffect, useMemo, useRef, useState } from 'react';
import { Check, ChevronDown, Palette } from 'lucide-react';
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

export function ThemePicker() {
  const themeId = useWorkspaceStore((s) => s.local?.ui.themeId ?? 'studio-dark');
  const setThemeId = useWorkspaceStore((s) => s.setThemeId);
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const optionRefs = useRef<Map<ThemeId, HTMLButtonElement>>(new Map());
  // Original theme captured when the dropdown opens — used to revert if
  // the user dismisses the picker (Escape, click outside) after live-
  // previewing other themes via arrow keys.
  const originalThemeRef = useRef<ThemeId | null>(null);
  // Latest themeId mirror — keeps `closeAndRevert` honest even though
  // it's invoked from listeners bound when the dropdown opened (closures
  // would otherwise see the stale-at-open themeId).
  const currentThemeRef = useRef(themeId);
  useEffect(() => {
    currentThemeRef.current = themeId;
  }, [themeId]);

  const groups = useMemo(() => groupThemes(ALL_THEMES), []);
  const flatOrder = useMemo(() => groups.flatMap((g) => g.themes.map((t) => t.id)), [groups]);
  const activeIndex = flatOrder.indexOf(themeId);
  const [focusIndex, setFocusIndex] = useState(activeIndex >= 0 ? activeIndex : 0);

  // Capture/clear the original theme as the dropdown opens/closes. We
  // intentionally do NOT include `themeId` in the deps — the ref should
  // only snapshot at open time, not every time the previewed theme
  // changes during navigation.
  useEffect(() => {
    if (open) {
      originalThemeRef.current = currentThemeRef.current;
    } else {
      originalThemeRef.current = null;
    }
  }, [open]);

  const closeAndRevert = () => {
    const original = originalThemeRef.current;
    if (original && original !== currentThemeRef.current) {
      setThemeId(original);
    }
    setOpen(false);
  };

  useEffect(() => {
    if (!open) return;
    const onPointer = (e: PointerEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        closeAndRevert();
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeAndRevert();
    };
    window.addEventListener('pointerdown', onPointer);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('pointerdown', onPointer);
      window.removeEventListener('keydown', onKey);
    };
    // closeAndRevert reads the latest themeId via currentThemeRef — safe
    // to skip themeId/setThemeId in the deps lint.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // On open: focus + scroll the active option into view.
  useEffect(() => {
    if (!open) return;
    const idx = flatOrder.indexOf(themeId);
    const target = idx >= 0 ? idx : 0;
    setFocusIndex(target);
    const id = flatOrder[target];
    const btn = optionRefs.current.get(id);
    if (btn) {
      btn.focus({ preventScroll: true });
      btn.scrollIntoView?.({ block: 'nearest' });
    }
    // Snapshot is taken in the open/close effect — don't re-run when
    // themeId changes mid-preview, that would re-anchor focus on every
    // arrow keypress.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Keep DOM focus in sync with focusIndex while navigating, and live-
  // preview the focused theme so the user can see how each one looks.
  useEffect(() => {
    if (!open) return;
    const id = flatOrder[focusIndex];
    if (!id) return;
    const btn = optionRefs.current.get(id);
    if (btn && document.activeElement !== btn) {
      btn.focus({ preventScroll: true });
      btn.scrollIntoView({ block: 'nearest' });
    }
    if (id !== themeId) setThemeId(id);
  }, [focusIndex, open, flatOrder, themeId, setThemeId]);

  const handleListKey = (e: React.KeyboardEvent<HTMLUListElement>) => {
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
      // Whatever's currently previewed becomes the committed choice.
      originalThemeRef.current = flatOrder[focusIndex] ?? null;
      setOpen(false);
    } else if (e.key === 'Tab') {
      closeAndRevert();
    }
  };

  const current = ALL_THEMES.find((t) => t.id === themeId) ?? ALL_THEMES[0];

  return (
    <div ref={wrapperRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="inline-flex h-8 items-center gap-2 rounded-sm border border-border bg-surface px-2.5 text-xs text-text-muted transition-colors hover:border-border-strong hover:text-text-primary"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label="Choose theme"
      >
        <Palette size={14} />
        <span>{current.label}</span>
        <ChevronDown size={12} className={cn('transition-transform', open && 'rotate-180')} />
      </button>

      {open && (
        <ul
          role="listbox"
          aria-label="Themes"
          onKeyDown={handleListKey}
          className="absolute right-0 top-9 z-40 w-64 max-h-[60vh] overflow-y-auto overscroll-contain rounded-sm border border-border-strong bg-card shadow-elevated"
        >
          {groups.map((group) => (
            <li key={group.key}>
              <div
                role="presentation"
                className="sticky top-0 z-10 border-b border-border-subtle bg-card px-3 pb-1 pt-2 text-[10px] font-medium uppercase tracking-wider text-text-dim"
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
                          // Mirror the Enter-key path: the clicked theme
                          // becomes the committed choice (no revert on
                          // close).
                          originalThemeRef.current = theme.id;
                          setOpen(false);
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
      )}
    </div>
  );
}
