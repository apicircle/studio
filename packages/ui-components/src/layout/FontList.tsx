// Listbox + keyboard navigation for font-family selection. Mirror of
// ThemeList — lives in SettingsPicker as a side popover with the same
// live-preview / Esc-revert / Enter-commit semantics.

import { useEffect, useMemo, useRef, useState } from 'react';
import { Check } from 'lucide-react';
import type { FontFamilyId } from '@apicircle/shared';
import { ALL_FONTS, type FontFamilyDef } from '../theme/applyFont';
import { cn } from '../primitives/cn';
import { useWorkspaceStore } from '../store/workspaceStore';

interface FontListProps {
  onCommit: () => void;
  onCancel: () => void;
  /**
   * Lets the parent shell hold onto a "revert + close" callback so it can
   * fire it on click-outside. Without this, click-outside silently keeps
   * whichever font the user was previewing.
   */
  registerCancel?: (fn: (() => void) | null) => void;
}

export function FontList({ onCommit, onCancel, registerCancel }: FontListProps) {
  const fontId = useWorkspaceStore((s) => s.local?.ui.fontId ?? 'system-sans');
  const setFontId = useWorkspaceStore((s) => s.setFontId);
  const optionRefs = useRef<Map<FontFamilyId, HTMLButtonElement>>(new Map());
  const originalFontRef = useRef<FontFamilyId>(fontId);
  const currentFontRef = useRef(fontId);
  // True only after an explicit commit (Enter / click). Drives the
  // unmount-revert below.
  const committedRef = useRef(false);
  useEffect(() => {
    currentFontRef.current = fontId;
  }, [fontId]);

  const groups = useMemo(
    () => [
      {
        key: 'mono' as const,
        label: 'Monospace',
        fonts: ALL_FONTS.filter((f) => f.category === 'mono'),
      },
      {
        key: 'sans' as const,
        label: 'Sans-serif',
        fonts: ALL_FONTS.filter((f) => f.category === 'sans'),
      },
    ],
    [],
  );
  const flatOrder = useMemo(() => groups.flatMap((g) => g.fonts.map((f) => f.id)), [groups]);
  const activeIndex = flatOrder.indexOf(fontId);
  const [focusIndex, setFocusIndex] = useState(activeIndex >= 0 ? activeIndex : 0);

  useEffect(() => {
    originalFontRef.current = currentFontRef.current;
    const id = flatOrder[focusIndex];
    const btn = id ? optionRefs.current.get(id) : null;
    btn?.focus({ preventScroll: true });
    btn?.scrollIntoView?.({ block: 'nearest' });
    // Mount-only snapshot.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const id = flatOrder[focusIndex];
    if (!id) return;
    const btn = optionRefs.current.get(id);
    if (btn && document.activeElement !== btn) {
      btn.focus({ preventScroll: true });
      btn.scrollIntoView({ block: 'nearest' });
    }
    if (id !== currentFontRef.current) setFontId(id);
  }, [focusIndex, flatOrder, setFontId]);

  const revertAndCancel = () => {
    const original = originalFontRef.current;
    if (original !== currentFontRef.current) setFontId(original);
    onCancel();
  };

  const commit = () => {
    originalFontRef.current = currentFontRef.current;
    committedRef.current = true;
    onCommit();
  };

  // Mirror of ThemeList's hand-off — gives the parent shell an explicit
  // revert callback so click-outside / Esc on the parent can undo the
  // live preview.
  useEffect(() => {
    if (!registerCancel) return;
    const fn = () => {
      const original = originalFontRef.current;
      if (original !== currentFontRef.current) setFontId(original);
      committedRef.current = true;
    };
    registerCancel(fn);
    return () => registerCancel(null);
  }, [registerCancel, setFontId]);

  // Belt-and-braces revert on unmount when nothing committed.
  useEffect(() => {
    return () => {
      if (committedRef.current) return;
      const original = originalFontRef.current;
      if (original !== currentFontRef.current) setFontId(original);
    };
  }, [setFontId]);

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
      aria-label="Font families"
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
            {group.fonts.map((font) => (
              <FontOption
                key={font.id}
                font={font}
                active={font.id === fontId}
                onSelect={() => {
                  setFontId(font.id);
                  originalFontRef.current = font.id;
                  committedRef.current = true;
                  onCommit();
                }}
                registerRef={(el) => {
                  if (el) optionRefs.current.set(font.id, el);
                  else optionRefs.current.delete(font.id);
                }}
              />
            ))}
          </ul>
        </li>
      ))}
    </ul>
  );
}

interface FontOptionProps {
  font: FontFamilyDef;
  active: boolean;
  onSelect: () => void;
  registerRef: (el: HTMLButtonElement | null) => void;
}

function FontOption({ font, active, onSelect, registerRef }: FontOptionProps) {
  return (
    <li>
      <button
        ref={registerRef}
        type="button"
        role="option"
        aria-selected={active}
        tabIndex={-1}
        onClick={onSelect}
        className={cn(
          'flex w-full items-center justify-between px-3 py-2 text-left text-sm transition-colors',
          active
            ? 'bg-accent/10 text-text-primary'
            : 'text-text-muted hover:bg-surface hover:text-text-primary',
        )}
      >
        <span className="flex flex-col">
          <span style={{ fontFamily: font.stack }}>{font.label}</span>
          {!active && (
            <span style={{ fontFamily: font.stack }} className="text-[0.625rem] text-text-dim">
              AaBbCc 0123 {'{'} {'}'}
            </span>
          )}
        </span>
        {active && <Check size={14} className="text-accent" />}
      </button>
    </li>
  );
}
