import { useEffect, useMemo, useRef, useState } from 'react';
import { Check, ChevronDown, Type } from 'lucide-react';
import type { FontFamilyId } from '@apicircle/shared';
import { ALL_FONTS, type FontFamilyDef } from '../theme/applyFont';
import { cn } from '../primitives/cn';
import { useWorkspaceStore } from '../store/workspaceStore';

// Sibling of ThemePicker. Lives in TopBar next to the theme dropdown so a
// developer can pick a font face that matches what's already installed on
// their machine — no more "the UI is in Courier New because JetBrains
// Mono isn't installed" surprise.
//
// The chosen font is workspace-bound (parity with the theme picker) —
// it lives on `local.ui.fontId` so switching workspaces re-applies the
// per-workspace selection.
export function FontPicker() {
  const fontId = useWorkspaceStore((s) => s.local?.ui.fontId ?? 'system-mono');
  const setFontId = useWorkspaceStore((s) => s.setFontId);
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const optionRefs = useRef<Map<FontFamilyId, HTMLButtonElement>>(new Map());
  // Original font captured when the dropdown opens — used to revert if
  // the user dismisses the picker (Escape, click outside) after live-
  // previewing other fonts via arrow keys.
  const originalFontRef = useRef<FontFamilyId | null>(null);
  // Latest fontId mirror — listeners bound when the picker opened
  // would otherwise see the open-time fontId in their closure.
  const currentFontRef = useRef(fontId);
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
    if (open) {
      originalFontRef.current = currentFontRef.current;
    } else {
      originalFontRef.current = null;
    }
  }, [open]);

  const closeAndRevert = () => {
    const original = originalFontRef.current;
    if (original && original !== currentFontRef.current) {
      setFontId(original);
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const idx = flatOrder.indexOf(fontId);
    const target = idx >= 0 ? idx : 0;
    setFocusIndex(target);
    const id = flatOrder[target];
    const btn = optionRefs.current.get(id);
    if (btn) {
      btn.focus({ preventScroll: true });
      btn.scrollIntoView?.({ block: 'nearest' });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Keep DOM focus in sync with focusIndex while navigating, and live-
  // preview the focused font.
  useEffect(() => {
    if (!open) return;
    const id = flatOrder[focusIndex];
    if (!id) return;
    const btn = optionRefs.current.get(id);
    if (btn && document.activeElement !== btn) {
      btn.focus({ preventScroll: true });
      btn.scrollIntoView({ block: 'nearest' });
    }
    if (id !== fontId) setFontId(id);
  }, [focusIndex, open, flatOrder, fontId, setFontId]);

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
      originalFontRef.current = flatOrder[focusIndex] ?? null;
      setOpen(false);
    } else if (e.key === 'Tab') {
      closeAndRevert();
    }
  };

  const choose = (id: FontFamilyId) => {
    setFontId(id);
    // Click commits — no revert on subsequent close.
    originalFontRef.current = id;
    setOpen(false);
  };

  const current = ALL_FONTS.find((f) => f.id === fontId) ?? ALL_FONTS[0];

  return (
    <div ref={wrapperRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="inline-flex h-8 items-center gap-2 rounded-sm border border-border bg-surface px-2.5 text-xs text-text-muted transition-colors hover:border-border-strong hover:text-text-primary"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label="Choose font family"
      >
        <Type size={14} />
        <span>{current.label}</span>
        <ChevronDown size={12} className={cn('transition-transform', open && 'rotate-180')} />
      </button>

      {open && (
        <ul
          role="listbox"
          aria-label="Font families"
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
                {group.fonts.map((font) => (
                  <FontOption
                    key={font.id}
                    font={font}
                    active={font.id === fontId}
                    onSelect={() => choose(font.id)}
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
      )}
    </div>
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
            <span style={{ fontFamily: font.stack }} className="text-[10px] text-text-dim">
              AaBbCc 0123 {'{'} {'}'}
            </span>
          )}
        </span>
        {active && <Check size={14} className="text-accent" />}
      </button>
    </li>
  );
}
