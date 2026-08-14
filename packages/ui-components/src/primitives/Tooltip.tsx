import { cloneElement, useId, useState } from 'react';
import type { FocusEvent, MouseEvent, ReactElement, ReactNode } from 'react';
import { cn } from './cn';

type Side = 'top' | 'bottom' | 'left' | 'right';

interface TooltipProps {
  /** The tooltip text. Kept to a short string so it can be the accessible desc. */
  content: ReactNode;
  side?: Side;
  /**
   * The single interactive child the tooltip describes. It must forward
   * `onMouseEnter/Leave`, `onFocus/Blur`, and `aria-describedby` — a native
   * element or any primitive here does.
   */
  children: ReactElement;
}

const SIDE: Record<Side, string> = {
  top: 'bottom-full left-1/2 mb-1 -translate-x-1/2',
  bottom: 'top-full left-1/2 mt-1 -translate-x-1/2',
  left: 'right-full top-1/2 mr-1 -translate-y-1/2',
  right: 'left-full top-1/2 ml-1 -translate-y-1/2',
};

/**
 * An accessible replacement for the native `title=` attribute (227 of which are
 * scattered through the app). Native titles are unreachable by keyboard, never
 * appear on touch, can't be styled, and — worst — become the element's
 * accessible *name*, which is how the Send button ended up announced as a whole
 * sentence. This surfaces on hover AND on keyboard focus, and links via
 * `aria-describedby` so it *describes* rather than *renames* its control.
 */
export function Tooltip({ content, side = 'top', children }: TooltipProps) {
  const id = useId();
  const [open, setOpen] = useState(false);

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
    <span className="relative inline-flex">
      {trigger}
      <span
        role="tooltip"
        id={id}
        // Kept in the DOM so the aria-describedby target always resolves; only
        // its visibility toggles.
        className={cn(
          'pointer-events-none absolute z-50 w-max max-w-xs rounded-sm border border-border bg-card px-2 py-1',
          'text-[0.6875rem] leading-snug text-text-primary shadow-md transition-opacity',
          SIDE[side],
          open ? 'opacity-100' : 'opacity-0',
        )}
      >
        {content}
      </span>
    </span>
  );
}
