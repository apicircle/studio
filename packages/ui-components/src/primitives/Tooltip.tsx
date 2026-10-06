import { cloneElement, useId, useRef, useState } from 'react';
import type { FocusEvent, MouseEvent, ReactElement, ReactNode } from 'react';
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
   * The single interactive child the tooltip describes. It must forward
   * `onMouseEnter/Leave`, `onFocus/Blur`, and `aria-describedby` — a native
   * element or any primitive here does.
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
 */
export function Tooltip({ content, side = 'top', align = 'center', children }: TooltipProps) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const anchorRef = useRef<HTMLSpanElement | null>(null);
  const tipRef = useRef<HTMLSpanElement | null>(null);
  const placement = useAnchoredPosition(anchorRef, tipRef, { open, side, align, offset: 4 });

  const show = () => setOpen(true);
  const hide = () => setOpen(false);

  const child = children as ReactElement<{
    onMouseEnter?: (e: MouseEvent) => void;
    onMouseLeave?: (e: MouseEvent) => void;
    onFocus?: (e: FocusEvent) => void;
    onBlur?: (e: FocusEvent) => void;
    'aria-describedby'?: string;
  }>;

  const trigger = cloneElement(child, {
    onMouseEnter: (e: MouseEvent) => {
      show();
      child.props.onMouseEnter?.(e);
    },
    onMouseLeave: (e: MouseEvent) => {
      hide();
      child.props.onMouseLeave?.(e);
    },
    onFocus: (e: FocusEvent) => {
      show();
      child.props.onFocus?.(e);
    },
    onBlur: (e: FocusEvent) => {
      hide();
      child.props.onBlur?.(e);
    },
    'aria-describedby':
      [child.props['aria-describedby'], open ? id : null].filter(Boolean).join(' ') || undefined,
  });

  return (
    <span ref={anchorRef} className="relative inline-flex" data-tooltip-anchor={id}>
      {trigger}
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
    </span>
  );
}
