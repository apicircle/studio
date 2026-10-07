import { cloneElement, useId, useRef, useState } from 'react';
import type { ReactElement, ReactNode } from 'react';
import { cn } from './cn';
import { FLOATING_Z, useAnchoredPosition } from './floating';
import { FloatingPortal } from './FloatingPortal';
import type { FloatingAlign, FloatingSide } from './floating';

interface TooltipProps {
  /** The tooltip text. Kept to a short string so it can be the accessible desc. */
  content: ReactNode;
  /**
   * The side the tooltip prefers. It opens on the opposite side instead when
   * this one has no room on screen.
   */
  side?: FloatingSide;
  /**
   * Where the tooltip prefers to sit along its side. `center` (the default)
   * centres it on the trigger; `start` / `end` line it up with one edge of the
   * trigger — the left / right edge for `top` and `bottom`, the top / bottom
   * edge for `left` and `right`. Either way it slides along the trigger rather
   * than hang off the edge of the screen.
   */
  align?: FloatingAlign;
  /**
   * Keep the tooltip shut and unmounted — for a hint that only applies some of
   * the time (the full text of a label that is not actually cut short).
   */
  disabled?: boolean;
  /**
   * Classes for the wrapper around the trigger, for when the trigger has to
   * take part in its parent's layout (`min-w-0 flex-1` on a row that truncates).
   */
  className?: string;
  /**
   * The single interactive child the tooltip describes. It must accept
   * `aria-describedby` and `className` — a native element or any primitive
   * here does.
   */
  children: ReactElement;
}

/**
 * An accessible replacement for the native `title=` attribute (227 of which are
 * scattered through the app). Native titles are unreachable by keyboard, never
 * appear on touch, can't be styled, and — worst — become the element's
 * accessible *name*, which is how the Send button ended up announced as a whole
 * sentence. This surfaces on hover AND on keyboard focus, and links via
 * `aria-describedby` so it *describes* rather than *renames* its control.
 *
 * The tooltip renders on the floating layer (`./floating`): portalled to the
 * document body and placed from the trigger's position on screen, so no
 * scrolling or `overflow-hidden` ancestor can cut it off, and it flips or
 * slides to stay on screen. The wrapper carries `data-tooltip-anchor` (the
 * tooltip's id), linking the two now that they are no longer DOM siblings.
 *
 * Hover and focus are read on the wrapper, not the trigger, which is what lets
 * a DISABLED trigger still explain itself: a disabled button takes no pointer
 * or focus events, and "why can't I press this" is the hint most worth reading.
 * The wrapper then takes the pointer and a tab stop in the button's place, and
 * the button is described by the tooltip at all times, not only while it shows.
 *
 * A trigger that opens a popup (`aria-haspopup`: a menu button, a select, a
 * popover) keeps its tooltip shut while that popup is open (`aria-expanded`):
 * the popup opens where the tooltip would be, and a hint for a control the user
 * has already used only covers what they opened. A plain disclosure — a row
 * that expands in place, with `aria-expanded` and no popup — keeps its hint.
 */
export function Tooltip({
  content,
  side = 'top',
  align = 'center',
  disabled = false,
  className,
  children,
}: TooltipProps) {
  const id = useId();
  const [hovered, setHovered] = useState(false);
  const anchorRef = useRef<HTMLSpanElement | null>(null);
  const tipRef = useRef<HTMLSpanElement | null>(null);

  const child = children as ReactElement<{
    'aria-describedby'?: string;
    'aria-expanded'?: boolean | 'true' | 'false';
    'aria-haspopup'?: boolean | 'true' | 'false' | 'menu' | 'listbox' | 'tree' | 'grid' | 'dialog';
    disabled?: boolean;
    className?: string;
  }>;
  const triggerDisabled = child.props.disabled === true;
  const hasPopup =
    child.props['aria-haspopup'] !== undefined &&
    child.props['aria-haspopup'] !== false &&
    child.props['aria-haspopup'] !== 'false';
  const popupOpen =
    hasPopup && (child.props['aria-expanded'] === true || child.props['aria-expanded'] === 'true');
  const open = hovered && !popupOpen && !disabled;
  const placement = useAnchoredPosition(anchorRef, tipRef, { open, side, align, offset: 4 });

  // While `disabled` the trigger is left exactly as given and nothing is
  // mounted for it — but the wrapper and its listeners stay, so the same
  // elements are reused when the hint starts to apply, and a pointer that is
  // already over the trigger at that moment opens it without leaving first.
  const explainsDisabled = triggerDisabled && !disabled;
  const trigger = disabled
    ? children
    : cloneElement(child, {
        'aria-describedby':
          [child.props['aria-describedby'], open || triggerDisabled ? id : null]
            .filter(Boolean)
            .join(' ') || undefined,
        // The wrapper is the hit target for a disabled trigger (see above).
        ...(triggerDisabled ? { className: cn(child.props.className, 'pointer-events-none') } : {}),
      });

  return (
    <span
      ref={anchorRef}
      className={cn('relative inline-flex', explainsDisabled && 'cursor-not-allowed', className)}
      data-tooltip-anchor={disabled ? undefined : id}
      // Only a disabled trigger hands its tab stop to the wrapper; an enabled
      // one is focused itself and the focus event bubbles up to here.
      tabIndex={explainsDisabled ? 0 : undefined}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onFocus={() => setHovered(true)}
      onBlur={() => setHovered(false)}
    >
      {trigger}
      {disabled ? null : (
        <FloatingPortal>
          <span
            ref={tipRef}
            role="tooltip"
            id={id}
            data-side={placement.side}
            data-align={placement.align}
            style={placement.style}
            // Kept in the DOM so the aria-describedby target always resolves;
            // only its visibility toggles, and it waits off screen while closed.
            className={cn(
              'pointer-events-none w-max max-w-xs rounded-sm border border-border bg-card px-2 py-1',
              'text-[0.6875rem] leading-snug text-text-primary shadow-md transition-opacity',
              FLOATING_Z.tooltip,
              open && !placement.anchorHidden ? 'opacity-100' : 'opacity-0',
            )}
          >
            {content}
          </span>
        </FloatingPortal>
      )}
    </span>
  );
}
