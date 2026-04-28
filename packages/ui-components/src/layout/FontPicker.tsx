import { useEffect, useRef, useState } from 'react';
import { Check, ChevronDown, Type } from 'lucide-react';
import { ALL_FONTS, applyFont, getStoredFontId, type FontFamilyId } from '../theme/applyFont';
import { cn } from '../primitives/cn';

// Sibling of ThemePicker. Lives in TopBar next to the theme dropdown so a
// developer can pick a font face that matches what's already installed on
// their machine — no more "the UI is in Courier New because JetBrains
// Mono isn't installed" surprise.
export function FontPicker() {
  const [fontId, setFontId] = useState<FontFamilyId>(() => getStoredFontId());
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

  const choose = (id: FontFamilyId) => {
    applyFont(id);
    setFontId(id);
    setOpen(false);
  };

  const current = ALL_FONTS.find((f) => f.id === fontId) ?? ALL_FONTS[0];
  const monoFonts = ALL_FONTS.filter((f) => f.category === 'mono');
  const sansFonts = ALL_FONTS.filter((f) => f.category === 'sans');

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
          className="absolute right-0 top-9 z-40 w-56 overflow-hidden rounded-sm border border-border-strong bg-card shadow-elevated"
        >
          <li
            aria-hidden="true"
            className="px-3 pb-1 pt-2 text-[10px] font-medium uppercase tracking-wider text-text-dim"
          >
            Monospace
          </li>
          {monoFonts.map((font) => (
            <FontOption
              key={font.id}
              fontId={font.id}
              label={font.label}
              stack={font.stack}
              active={font.id === fontId}
              onSelect={() => choose(font.id)}
            />
          ))}
          <li
            aria-hidden="true"
            className="border-t border-border-subtle px-3 pb-1 pt-2 text-[10px] font-medium uppercase tracking-wider text-text-dim"
          >
            Sans-serif
          </li>
          {sansFonts.map((font) => (
            <FontOption
              key={font.id}
              fontId={font.id}
              label={font.label}
              stack={font.stack}
              active={font.id === fontId}
              onSelect={() => choose(font.id)}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

interface FontOptionProps {
  fontId: FontFamilyId;
  label: string;
  stack: string;
  active: boolean;
  onSelect: () => void;
}

function FontOption({ label, stack, active, onSelect }: FontOptionProps) {
  return (
    <li>
      <button
        type="button"
        role="option"
        aria-selected={active}
        onClick={onSelect}
        className={cn(
          'flex w-full items-center justify-between px-3 py-2 text-left text-sm transition-colors',
          active
            ? 'bg-accent/10 text-text-primary'
            : 'text-text-muted hover:bg-surface hover:text-text-primary',
        )}
      >
        <span className="flex flex-col">
          <span style={{ fontFamily: stack }}>{label}</span>
          <span style={{ fontFamily: stack }} className="text-[10px] text-text-dim">
            AaBbCc 0123 {'{'} {'}'}
          </span>
        </span>
        {active && <Check size={14} className="text-accent" />}
      </button>
    </li>
  );
}
