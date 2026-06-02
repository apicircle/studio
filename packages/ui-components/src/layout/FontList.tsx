// Listbox + keyboard navigation for font-family selection. Mirror of
// ThemeList — lives in SettingsPicker as a side popover with the same
// live-preview / Esc-revert / Enter-commit semantics.

import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { Check, LoaderCircle } from 'lucide-react';
import type { FontFamilyId } from '@apicircle/shared';
import { ALL_FONTS, type FontFamilyDef } from '../theme/applyFont';
import { getAvailableFonts } from '../theme/fontAvailability';
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

const HOVER_PREVIEW_DELAY_MS = 1000;

export function FontList({ onCommit, onCancel, registerCancel }: FontListProps) {
  const fontId = useWorkspaceStore((s) => s.local?.ui.fontId ?? 'system-sans');
  const setFontId = useWorkspaceStore((s) => s.setFontId);
  const optionRefs = useRef<Map<FontFamilyId, HTMLButtonElement>>(new Map());
  const originalFontRef = useRef<FontFamilyId>(fontId);
  const currentFontRef = useRef(fontId);
  const hoverPreviewTimerRef = useRef<number | null>(null);
  const guidanceId = useId();
  const [pendingPreviewId, setPendingPreviewId] = useState<FontFamilyId | null>(null);
  // Detector hydrates after webfonts settle. Until then we render the
  // full catalog so the picker is never empty mid-load.
  const [availableFonts, setAvailableFonts] = useState<readonly FontFamilyDef[]>(ALL_FONTS);
  // True only after an explicit commit (Enter / click). Drives the
  // unmount-revert below.
  const committedRef = useRef(false);
  useEffect(() => {
    currentFontRef.current = fontId;
  }, [fontId]);

  useEffect(() => {
    let alive = true;
    void getAvailableFonts().then((fonts) => {
      if (alive) setAvailableFonts(fonts);
    });
    return () => {
      alive = false;
    };
  }, []);

  const groups = useMemo(() => {
    // Force-include the currently-selected font even if the detector
    // filtered it — otherwise the user has no way to deselect it.
    const visibleIds = new Set(availableFonts.map((f) => f.id));
    visibleIds.add(fontId);
    const visible = ALL_FONTS.filter((f) => visibleIds.has(f.id));
    return [
      {
        key: 'mono' as const,
        label: 'Monospace',
        fonts: visible.filter((f) => f.category === 'mono'),
      },
      {
        key: 'sans' as const,
        label: 'Sans-serif',
        fonts: visible.filter((f) => f.category === 'sans'),
      },
    ];
  }, [availableFonts, fontId]);
  const flatOrder = useMemo(() => groups.flatMap((g) => g.fonts.map((f) => f.id)), [groups]);
  const activeIndex = flatOrder.indexOf(fontId);
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
    (id: FontFamilyId) => {
      cancelHoverPreview();
      if (id === currentFontRef.current) return;
      setPendingPreviewId(id);
      hoverPreviewTimerRef.current = window.setTimeout(() => {
        setFontId(id);
        setPendingPreviewId(null);
        hoverPreviewTimerRef.current = null;
      }, HOVER_PREVIEW_DELAY_MS);
    },
    [cancelHoverPreview, setFontId],
  );

  useEffect(() => () => clearHoverPreviewTimer(), [clearHoverPreviewTimer]);

  useEffect(() => {
    originalFontRef.current = currentFontRef.current;
    const id = flatOrder[focusIndex];
    const btn = id ? optionRefs.current.get(id) : null;
    btn?.focus({ preventScroll: true });
    btn?.scrollIntoView?.({ block: 'nearest' });
    // Mount-only snapshot.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Re-anchor focus to the active font when the visible list narrows
  // (detector resolves) — otherwise the old focusIndex points at a
  // different option in the shrunk list and the next effect would
  // preview-apply the wrong font.
  useEffect(() => {
    const activeIdx = flatOrder.indexOf(currentFontRef.current);
    if (activeIdx >= 0 && activeIdx !== focusIndex) setFocusIndex(activeIdx);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flatOrder]);

  useEffect(() => {
    const id = flatOrder[focusIndex];
    if (!id) return;
    const btn = optionRefs.current.get(id);
    if (btn && document.activeElement !== btn) {
      btn.focus({ preventScroll: true });
      btn.scrollIntoView?.({ block: 'nearest' });
    }
    if (id !== currentFontRef.current) setFontId(id);
  }, [focusIndex, flatOrder, setFontId]);

  const revertAndCancel = () => {
    cancelHoverPreview();
    const original = originalFontRef.current;
    if (original !== currentFontRef.current) setFontId(original);
    onCancel();
  };

  const commit = () => {
    cancelHoverPreview();
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
      cancelHoverPreview();
      const original = originalFontRef.current;
      if (original !== currentFontRef.current) setFontId(original);
      committedRef.current = true;
    };
    registerCancel(fn);
    return () => registerCancel(null);
  }, [cancelHoverPreview, registerCancel, setFontId]);

  // Belt-and-braces revert on unmount when nothing committed.
  useEffect(() => {
    return () => {
      if (committedRef.current) return;
      const original = originalFontRef.current;
      if (original !== currentFontRef.current) setFontId(original);
    };
  }, [setFontId]);

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
        aria-label="Font families"
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
              {group.fonts.map((font) => (
                <FontOption
                  key={font.id}
                  font={font}
                  active={font.id === fontId}
                  pending={pendingPreviewId === font.id}
                  onSelect={() => {
                    cancelHoverPreview();
                    setFontId(font.id);
                    originalFontRef.current = font.id;
                    committedRef.current = true;
                    onCommit();
                  }}
                  onPreviewIntent={() => scheduleHoverPreview(font.id)}
                  onPreviewCancel={cancelHoverPreview}
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
    </div>
  );
}

interface FontOptionProps {
  font: FontFamilyDef;
  active: boolean;
  pending: boolean;
  onSelect: () => void;
  onPreviewIntent: () => void;
  onPreviewCancel: () => void;
  registerRef: (el: HTMLButtonElement | null) => void;
}

function FontOption({
  font,
  active,
  pending,
  onSelect,
  onPreviewIntent,
  onPreviewCancel,
  registerRef,
}: FontOptionProps) {
  return (
    <li>
      <button
        ref={registerRef}
        type="button"
        role="option"
        aria-selected={active}
        tabIndex={-1}
        onClick={onSelect}
        onMouseEnter={onPreviewIntent}
        onMouseLeave={onPreviewCancel}
        className={cn(
          'flex w-full items-center justify-between px-3 py-2 text-left text-sm transition-colors',
          active
            ? 'bg-accent/10 text-text-primary'
            : 'text-text-muted hover:bg-surface hover:text-text-primary',
        )}
      >
        <span className="flex min-w-0 flex-col pr-2">
          <span style={{ fontFamily: font.stack }} className="truncate">
            {font.label}
          </span>
          {!active && (
            <span
              style={{ fontFamily: font.stack }}
              className="truncate text-[0.625rem] text-text-dim"
            >
              AaBbCc 0123 {'{'} {'}'}
            </span>
          )}
        </span>
        <OptionStatus active={active} pending={pending} testId={`font-${font.id}`} />
      </button>
    </li>
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
