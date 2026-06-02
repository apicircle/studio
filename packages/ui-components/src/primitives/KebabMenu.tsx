import { useEffect, useRef, useState } from 'react';
import type { KeyboardEvent, ReactNode } from 'react';
import { MoreVertical } from 'lucide-react';
import { cn } from './cn';

// Vertical three-dot menu primitive. Replaces the row-of-icons pattern in
// dense sidebars where users would otherwise have to memorize 5+ icons or
// click the wrong one.
//
// Behavior:
//   • Click trigger or press Enter / Space: open menu, focus first item.
//   • Arrow Down/Up: cycle items (wraps).
//   • Home/End: jump to first/last.
//   • Escape, click outside, or item activate: close menu, return focus to trigger.
//   • Items can be marked `tone: 'danger'` for destructive actions (red text).
//   • Items can be `disabled` (greyed out, not focusable).
//
// ARIA:
//   • Trigger: button + aria-haspopup="menu" + aria-expanded.
//   • Menu: role="menu" + aria-label.
//   • Items: role="menuitem" + tabIndex managed via the active index.

export interface KebabMenuItem {
  /** Stable id for the item — used as the React key + aria-label fallback. */
  id: string;
  label: string;
  icon?: ReactNode;
  onSelect: () => void;
  /** When true, the item renders dim and is skipped during keyboard nav. */
  disabled?: boolean;
  /** Visual tone — `'danger'` recolors the item red. */
  tone?: 'normal' | 'danger';
  /** Optional tooltip shown on hover. */
  title?: string;
}

interface KebabMenuProps {
  items: KebabMenuItem[];
  /** ARIA label for the trigger + menu (e.g. "Folder actions"). */
  ariaLabel: string;
  /** Compact mode shrinks the trigger; used in tight rows. */
  size?: 'sm' | 'md';
  /** Renders the trigger always-visible instead of group-hover-only. */
  alwaysVisible?: boolean;
  /** Adds an extra className to the trigger button — used for inline alignment. */
  triggerClassName?: string;
}

export function KebabMenu({
  items,
  ariaLabel,
  size = 'md',
  alwaysVisible = false,
  triggerClassName,
}: KebabMenuProps) {
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([]);

  // Skip disabled items when stepping through with arrow keys; the index
  // tracker still uses the raw item array index so item refs line up.
  const enabledIndexes = items.map((it, i) => (it.disabled ? -1 : i)).filter((i) => i >= 0);

  useEffect(() => {
    if (!open) return;
    const onPointer = (e: PointerEvent) => {
      const target = e.target as Node;
      if (triggerRef.current?.contains(target) || menuRef.current?.contains(target)) {
        return;
      }
      setOpen(false);
    };
    window.addEventListener('pointerdown', onPointer);
    return () => window.removeEventListener('pointerdown', onPointer);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    // Focus the first enabled item; if everything is disabled, fall back
    // to the menu container itself so keyboard users can still escape.
    const first = enabledIndexes[0];
    if (first !== undefined) {
      itemRefs.current[first]?.focus();
      setActiveIndex(first);
    } else {
      menuRef.current?.focus();
    }
  }, [open, enabledIndexes]);

  const closeAndReturnFocus = () => {
    setOpen(false);
    // Defer to the next tick so the DOM unmounts the menu before focus
    // moves back; otherwise the menu would briefly steal focus again.
    requestAnimationFrame(() => triggerRef.current?.focus());
  };

  const moveFocus = (delta: 1 | -1) => {
    if (enabledIndexes.length === 0) return;
    const here = enabledIndexes.indexOf(activeIndex);
    const next =
      here === -1
        ? enabledIndexes[0]
        : enabledIndexes[(here + delta + enabledIndexes.length) % enabledIndexes.length];
    setActiveIndex(next);
    itemRefs.current[next]?.focus();
  };

  const onTriggerKey = (e: KeyboardEvent<HTMLButtonElement>) => {
    if (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowDown') {
      e.preventDefault();
      setOpen(true);
    }
  };

  const onMenuKey = (e: KeyboardEvent<HTMLDivElement>) => {
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
      const first = enabledIndexes[0];
      if (first !== undefined) {
        setActiveIndex(first);
        itemRefs.current[first]?.focus();
      }
      return;
    }
    if (e.key === 'End') {
      e.preventDefault();
      const last = enabledIndexes[enabledIndexes.length - 1];
      if (last !== undefined) {
        setActiveIndex(last);
        itemRefs.current[last]?.focus();
      }
      return;
    }
  };

  const sizeClass =
    size === 'sm'
      ? 'inline-flex h-6 w-6 items-center justify-center'
      : 'inline-flex h-7 w-7 items-center justify-center';
  // Visibility model:
  //   • `alwaysVisible` → trigger is rendered at full opacity at all times
  //     (header-level kebabs that aren't tied to a hovered row).
  //   • default → trigger is hidden until the surrounding `group` row is
  //     hovered, focused, or its menu is open. We use opacity (no
  //     transition) so the icon snaps in at full brightness — a faded
  //     kebab reads as disabled.
  const visibilityClass = alwaysVisible
    ? ''
    : cn(
        'opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 focus:opacity-100',
        open && 'opacity-100',
      );

  return (
    <div className="relative inline-block">
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        onKeyDown={onTriggerKey}
        aria-label={ariaLabel}
        aria-haspopup="menu"
        aria-expanded={open}
        title={ariaLabel}
        className={cn(
          sizeClass,
          'shrink-0 rounded-sm text-text-primary',
          visibilityClass,
          triggerClassName,
        )}
      >
        <MoreVertical size={size === 'sm' ? 13 : 15} aria-hidden="true" />
      </button>
      {open && (
        <div
          ref={menuRef}
          role="menu"
          aria-label={ariaLabel}
          tabIndex={-1}
          onKeyDown={onMenuKey}
          className="absolute right-0 top-full z-30 mt-1 min-w-[180px] overflow-hidden rounded-sm border border-border bg-card shadow-lg"
        >
          {items.map((item, i) => (
            <button
              key={item.id}
              ref={(el) => {
                itemRefs.current[i] = el;
              }}
              type="button"
              role="menuitem"
              tabIndex={i === activeIndex ? 0 : -1}
              disabled={item.disabled}
              onClick={() => {
                if (item.disabled) return;
                // Run the action first so it can synchronously commit state
                // that mounts a follow-up element (inline rename/create
                // input, modal, etc). Then close the menu. Focus return is
                // conditional — see below.
                item.onSelect();
                setOpen(false);
                // Only return focus to the trigger if the action didn't
                // park focus somewhere meaningful. If onSelect mounted a
                // dialog or auto-focused input, document.activeElement is
                // already that target; reclaiming focus to the kebab would
                // blur and dismiss it (this exact bug surfaced in the
                // editor sidebar's New request / New folder flow). After
                // setOpen(false) the menuitem unmounts, so a no-op action
                // shows up here as activeElement === document.body.
                requestAnimationFrame(() => {
                  if (document.activeElement === document.body) {
                    triggerRef.current?.focus();
                  }
                });
              }}
              title={item.title}
              className={cn(
                'flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs transition-colors',
                item.disabled
                  ? 'cursor-not-allowed text-text-faint'
                  : item.tone === 'danger'
                    ? 'text-danger hover:bg-danger/10 focus:bg-danger/10'
                    : 'text-text-primary hover:bg-surface focus:bg-surface',
                'focus:outline-none focus:ring-1 focus:ring-accent/40',
              )}
            >
              {item.icon && (
                <span className="inline-flex h-4 w-4 shrink-0 items-center justify-center self-center text-text-faint">
                  {item.icon}
                </span>
              )}
              <span className="flex-1 self-center">{item.label}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
