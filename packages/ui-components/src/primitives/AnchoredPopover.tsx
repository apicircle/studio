import { forwardRef, useCallback, useEffect, useRef } from 'react';
import type { HTMLAttributes, ReactNode, RefObject } from 'react';
import { cn } from './cn';
import { FLOATING_Z, useAnchoredPosition } from './floating';
import { FloatingPortal } from './FloatingPortal';
import type { FloatingAlign, FloatingSide } from './floating';

export interface AnchoredPopoverProps extends Omit<HTMLAttributes<HTMLDivElement>, 'style'> {
  /** Rendered, and positioned, only while open. */
  open: boolean;
  /** The element it opens next to: the trigger, or the wrapper around it. */
  anchorRef: RefObject<HTMLElement | null>;
  side?: FloatingSide;
  align?: FloatingAlign;
  /** Size from the anchor's width: `min` = at least as wide, `exact` = as wide. */
  matchAnchorWidth?: 'min' | 'exact';
  /** The tallest it may be, in px. Use this, not a `max-h-*` class, so placement measures it. */
  maxHeight?: number;
  /** The anchor scrolled out of view: close the popover, or it would float detached from it. */
  onAnchorHidden?: () => void;
  children: ReactNode;
}

/**
 * A popover on the floating layer (`./floating`): portalled to the document body
 * and placed next to `anchorRef`, so no scrolling or `overflow-hidden` ancestor —
 * a sidebar, a resizable panel, the panel `<main>` — can cut it off. It keeps to
 * the preferred side and alignment while there is room, flips or slides when
 * there isn't, and caps its height to the room it has.
 *
 * Use it for anything that opens next to a control and is not a `KebabMenu` or a
 * `Tooltip`: an autocomplete list, a picker, a small form. Give it its own
 * `role` and accessible name; it adds none.
 *
 * Its subtree is outside its opener's DOM, so a "press outside closes it" check
 * that uses `contains` reads a press INSIDE it as outside. Dismiss with
 * `useDismissableLayer` (inside = the React subtree), or test the popover's own
 * element as well as the opener's.
 */
export const AnchoredPopover = forwardRef<HTMLDivElement, AnchoredPopoverProps>(
  function AnchoredPopover(
    {
      open,
      anchorRef,
      side = 'bottom',
      align = 'start',
      matchAnchorWidth,
      maxHeight,
      onAnchorHidden,
      className,
      children,
      ...rest
    },
    forwardedRef,
  ) {
    const ownRef = useRef<HTMLDivElement | null>(null);
    const setRef = useCallback(
      (el: HTMLDivElement | null) => {
        ownRef.current = el;
        if (typeof forwardedRef === 'function') forwardedRef(el);
        else if (forwardedRef) forwardedRef.current = el;
      },
      [forwardedRef],
    );
    const placement = useAnchoredPosition(anchorRef, ownRef, {
      open,
      side,
      align,
      capToRoom: true,
      matchAnchorWidth,
      maxHeight,
    });

    const onHiddenRef = useRef(onAnchorHidden);
    onHiddenRef.current = onAnchorHidden;
    const hidden = open && placement.anchorHidden;
    useEffect(() => {
      if (hidden) onHiddenRef.current?.();
    }, [hidden]);

    if (!open) return null;
    return (
      <FloatingPortal>
        <div
          {...rest}
          ref={setRef}
          data-side={placement.side}
          style={placement.style}
          className={cn(className, FLOATING_Z.menu)}
        >
          {children}
        </div>
      </FloatingPortal>
    );
  },
);
