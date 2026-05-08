import { forwardRef } from 'react';
import type { CSSProperties, ReactNode, SelectHTMLAttributes } from 'react';
import { ChevronDown } from 'lucide-react';
import { cn } from './cn';

// `size` shadows the native `size: number` (visible-options count) — Omit
// it from the inherited attribute set so the override is unambiguous.
interface SelectProps extends Omit<SelectHTMLAttributes<HTMLSelectElement>, 'size'> {
  size?: 'sm' | 'md' | 'lg';
  /** Optional class on the wrapper div (positioning, width). */
  wrapperClassName?: string;
  /** Inline style applied to the <select> itself (used for color tokens). */
  selectStyle?: CSSProperties;
  children: ReactNode;
}

const SIZE_CLASS: Record<NonNullable<SelectProps['size']>, string> = {
  sm: 'h-7 text-xs',
  md: 'h-8 text-xs',
  lg: 'h-9 text-sm',
};

/**
 * Native <select> styled to match the rest of the app, with a custom chevron
 * icon overlaid so the right-side padding visually matches the left. Native
 * <option> rendering stays browser-native (no custom popover).
 */
export const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select(
  { size = 'sm', className, wrapperClassName, selectStyle, children, ...rest },
  ref,
) {
  return (
    <div className={cn('relative inline-flex', wrapperClassName)}>
      <select
        ref={ref}
        {...rest}
        style={selectStyle}
        className={cn(
          // Text color is inherited so consumers can override per-value
          // (e.g. method-color tints in the URL bar). The body inherits
          // `text-text-primary`, which is the right default fallback.
          'w-full appearance-none rounded-sm border border-border bg-card pl-2 pr-7 focus:border-accent focus:outline-none',
          SIZE_CLASS[size],
          className,
        )}
      >
        {children}
      </select>
      <ChevronDown
        size={size === 'sm' ? 12 : size === 'lg' ? 14 : 13}
        aria-hidden="true"
        className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-text-dim"
      />
    </div>
  );
});
