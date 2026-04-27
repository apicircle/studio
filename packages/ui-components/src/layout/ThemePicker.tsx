import { useEffect, useRef, useState } from 'react';
import { Check, ChevronDown, Palette } from 'lucide-react';
import { useWorkspaceStore } from '../store/workspaceStore';
import { ALL_THEMES } from '../theme/applyTheme';
import { cn } from '../primitives/cn';

export function ThemePicker() {
  const themeId = useWorkspaceStore((s) => s.local?.ui.themeId ?? 'studio-dark');
  const setThemeId = useWorkspaceStore((s) => s.setThemeId);
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
          className="absolute right-0 top-9 z-40 w-56 overflow-hidden rounded-sm border border-border-strong bg-card shadow-elevated"
        >
          {ALL_THEMES.map((theme) => {
            const active = theme.id === themeId;
            return (
              <li key={theme.id}>
                <button
                  type="button"
                  role="option"
                  aria-selected={active}
                  onClick={() => {
                    setThemeId(theme.id);
                    setOpen(false);
                  }}
                  className={cn(
                    'flex w-full items-center justify-between px-3 py-2 text-left text-sm transition-colors',
                    active
                      ? 'bg-accent/10 text-text-primary'
                      : 'text-text-muted hover:bg-surface hover:text-text-primary',
                  )}
                >
                  <span className="flex items-center gap-2">
                    <span>{theme.label}</span>
                    <span className="text-[10px] uppercase tracking-wider text-text-dim">
                      {theme.mode}
                    </span>
                  </span>
                  {active && <Check size={14} className="text-accent" />}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
