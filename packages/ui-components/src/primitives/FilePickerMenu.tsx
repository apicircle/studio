import { useEffect, useId, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { ChevronDown, FileArchive, Upload } from 'lucide-react';
import type { GlobalFileAsset } from '@apicircle/shared';
import { cn } from './cn';

// Consolidated file-picker affordance used by the form-data row, binary
// body, and mock-response binary editors. Replaces the older pattern of
// "Upload" button + separate browser-native `<select>` for library
// files — which had two failure modes:
//
//   1. UX: two parallel controls (one for upload, one for picking from
//      the library) made it ambiguous which to use when both were
//      visible. A single trigger with a menu enumerates the choices
//      so the user makes one decision.
//
//   2. Theming: `<select>`'s dropdown arrow + option list are
//      browser-controlled and can't be themed; on dark UI builds they
//      render with the OS's default light styling, breaking the dark
//      surface. A custom menu sits inside the same Tailwind utility
//      vocabulary as the rest of the dock.
//
// Menu items (top → bottom):
//   - "Upload new file..." — always present, opens the local picker via
//     `onPickLocal`.
//   - "From library" section — only present when `libraryFiles.length > 0`;
//     each entry calls `onPickLibrary(file.id)`.
//
// Keyboard model mirrors `KebabMenu`: Enter / Space / Arrow Down open;
// Escape / outside-click close; Arrow Up/Down cycle through items.

export interface FilePickerMenuProps {
  libraryFiles: GlobalFileAsset[];
  onPickLocal: () => void;
  onPickLibrary: (assetId: string) => void;
  /** Visible label on the trigger. Defaults to "Pick file". */
  triggerLabel?: string;
  /** ARIA label used as the menu name + trigger title. */
  ariaLabel: string;
  /** Optional icon prefix on the trigger; defaults to `<Upload />`. */
  triggerIcon?: ReactNode;
  /** Compact trigger sizing for tight rows (`'sm'`) vs. comfortable button (`'md'`). */
  size?: 'sm' | 'md';
  /** Extra class on the trigger button — used for inline alignment. */
  triggerClassName?: string;
  /**
   * When true, the outer wrapper + trigger fill the available width
   * of the parent (instead of `inline-block` / content-sized). Use
   * this when the picker IS the field — e.g. inside a form-data row's
   * value column. The trigger uses `justify-between` so the chevron
   * sits at the right edge and the label hugs the left.
   */
  fullWidth?: boolean;
  /** When true, the trigger renders disabled (no menu open). */
  disabled?: boolean;
}

export function FilePickerMenu({
  libraryFiles,
  onPickLocal,
  onPickLibrary,
  triggerLabel = 'Pick file',
  ariaLabel,
  triggerIcon,
  size = 'sm',
  triggerClassName,
  fullWidth = false,
  disabled = false,
}: FilePickerMenuProps) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const [activeIndex, setActiveIndex] = useState(0);
  const menuId = useId();

  // Each menu item, in render order. The first is always "Upload new",
  // so library entries start at index 1.
  const itemCount = 1 + libraryFiles.length;

  useEffect(() => {
    if (!open) return;
    const onPointer = (e: PointerEvent) => {
      const target = e.target as Node;
      if (triggerRef.current?.contains(target) || menuRef.current?.contains(target)) return;
      setOpen(false);
    };
    window.addEventListener('pointerdown', onPointer);
    return () => window.removeEventListener('pointerdown', onPointer);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    // Focus the first item when the menu opens.
    setActiveIndex(0);
    itemRefs.current[0]?.focus();
  }, [open]);

  const closeAndReturnFocus = () => {
    setOpen(false);
    requestAnimationFrame(() => triggerRef.current?.focus());
  };

  const moveFocus = (delta: 1 | -1) => {
    if (itemCount === 0) return;
    const next = (activeIndex + delta + itemCount) % itemCount;
    setActiveIndex(next);
    itemRefs.current[next]?.focus();
  };

  const onMenuKey = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      closeAndReturnFocus();
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      moveFocus(1);
      return;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      moveFocus(-1);
      return;
    }
    if (e.key === 'Home') {
      e.preventDefault();
      setActiveIndex(0);
      itemRefs.current[0]?.focus();
      return;
    }
    if (e.key === 'End') {
      e.preventDefault();
      const last = itemCount - 1;
      setActiveIndex(last);
      itemRefs.current[last]?.focus();
      return;
    }
  };

  const onTriggerKey = (e: React.KeyboardEvent<HTMLButtonElement>) => {
    if (disabled) return;
    if (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowDown') {
      e.preventDefault();
      setOpen(true);
    }
  };

  // Layout strategy:
  //   - default: trigger is content-sized (`inline-flex`), label and
  //     chevron sit side-by-side with a small gap.
  //   - fullWidth: trigger fills the parent (`w-full`), label hugs left,
  //     chevron sits flush right via `justify-between`. The wrapper
  //     also becomes `block` so the parent's flex / grid sizing
  //     reaches this control instead of stopping at an inline box.
  const triggerSizeClass =
    size === 'sm'
      ? cn(
          'h-7 items-center gap-1.5 rounded-sm border border-border bg-card px-2 text-[0.6875rem]',
          fullWidth ? 'flex w-full justify-between' : 'inline-flex',
        )
      : cn(
          'h-8 items-center gap-2 rounded-sm border border-border bg-card px-3 text-xs',
          fullWidth ? 'flex w-full justify-between' : 'inline-flex',
        );
  const triggerToneClass = disabled
    ? 'text-text-faint cursor-not-allowed'
    : 'text-text-muted hover:border-accent hover:text-text-primary focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent/30';

  const icon =
    triggerIcon === undefined ? (
      <Upload size={size === 'sm' ? 11 : 13} aria-hidden="true" />
    ) : (
      triggerIcon
    );

  return (
    <div className={cn('relative', fullWidth ? 'block w-full' : 'inline-block')}>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => {
          if (disabled) return;
          setOpen((v) => !v);
        }}
        onKeyDown={onTriggerKey}
        aria-label={ariaLabel}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        aria-disabled={disabled || undefined}
        title={ariaLabel}
        className={cn(triggerSizeClass, triggerToneClass, triggerClassName)}
      >
        {fullWidth ? (
          <>
            <span className="flex min-w-0 items-center gap-1.5">
              {icon}
              <span className="truncate">{triggerLabel}</span>
            </span>
            <ChevronDown size={size === 'sm' ? 11 : 13} aria-hidden="true" className="shrink-0" />
          </>
        ) : (
          <>
            {icon}
            <span className="truncate">{triggerLabel}</span>
            <ChevronDown size={size === 'sm' ? 11 : 13} aria-hidden="true" className="shrink-0" />
          </>
        )}
      </button>
      {open && (
        <div
          id={menuId}
          ref={menuRef}
          role="menu"
          aria-label={ariaLabel}
          tabIndex={-1}
          onKeyDown={onMenuKey}
          className={cn(
            'absolute left-0 top-full z-30 mt-1 max-h-[300px] overflow-auto rounded-sm border border-border bg-card shadow-lg',
            // When the trigger is full-width, the menu matches the
            // trigger's width so options align with the field. When
            // content-sized, fall back to the comfortable default.
            fullWidth ? 'w-full' : 'min-w-[220px]',
          )}
        >
          {/* Upload new file — always available. */}
          <button
            ref={(el) => {
              itemRefs.current[0] = el;
            }}
            type="button"
            role="menuitem"
            tabIndex={activeIndex === 0 ? 0 : -1}
            onClick={() => {
              setOpen(false);
              onPickLocal();
            }}
            className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs text-text-primary hover:bg-surface focus:bg-surface focus:outline-none focus:ring-1 focus:ring-accent/40"
          >
            <Upload size={12} aria-hidden="true" className="shrink-0 text-text-faint" />
            Upload new file…
          </button>
          {libraryFiles.length > 0 && (
            <>
              <div className="border-t border-border-subtle px-3 pt-2 pb-1 text-[0.625rem] uppercase tracking-wider text-text-faint">
                From library
              </div>
              {libraryFiles.map((file, i) => (
                <button
                  key={file.id}
                  ref={(el) => {
                    itemRefs.current[i + 1] = el;
                  }}
                  type="button"
                  role="menuitem"
                  tabIndex={activeIndex === i + 1 ? 0 : -1}
                  onClick={() => {
                    setOpen(false);
                    onPickLibrary(file.id);
                  }}
                  title={`${file.filename} · ${file.mimeType}`}
                  className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs text-text-primary hover:bg-surface focus:bg-surface focus:outline-none focus:ring-1 focus:ring-accent/40"
                >
                  <FileArchive size={12} aria-hidden="true" className="shrink-0 text-text-faint" />
                  <span className="flex-1 truncate">{file.name}</span>
                </button>
              ))}
            </>
          )}
        </div>
      )}
    </div>
  );
}
