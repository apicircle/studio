import { forwardRef } from 'react';
import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { cn } from './cn';

type Variant = 'primary' | 'ghost' | 'danger' | 'subtle';
type Size = 'xs' | 'sm' | 'md' | 'lg';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  leftIcon?: ReactNode;
  rightIcon?: ReactNode;
}

/**
 * Tinted-surface button idiom: a tone-coloured border and a low-alpha fill that
 * deepens on hover. This matches how buttons are actually written across the
 * panels, so a hand-rolled button can be swapped for `<Button>` without the
 * surrounding screen shifting.
 */
const VARIANT: Record<Variant, string> = {
  primary: 'border border-accent/40 bg-accent/15 text-accent-strong hover:bg-accent/25',
  danger: 'border border-danger/40 bg-danger/15 text-danger hover:bg-danger/25',
  ghost:
    'border border-border bg-surface text-text-muted hover:border-accent hover:text-text-primary',
  subtle: 'border border-border-subtle bg-card text-text-muted hover:bg-card/80',
};

/**
 * The canonical control-height scale. `xs` is 24px — the WCAG 2.5.8 AA minimum
 * target size — and is therefore the floor; nothing smaller is offered.
 * `sm` is the default because it is the height the panels overwhelmingly use.
 */
const SIZE: Record<Size, string> = {
  xs: 'h-6 gap-1 px-2 text-[0.6875rem]',
  sm: 'h-7 gap-1.5 px-2.5 text-xs',
  md: 'h-8 gap-1.5 px-3 text-xs',
  lg: 'h-9 gap-2 px-4 text-sm',
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'ghost', size = 'sm', className, leftIcon, rightIcon, children, ...rest },
  ref,
) {
  return (
    <button
      // Default to a non-submitting button: inside a <form>, the HTML default of
      // type="submit" silently submits. Callers can still pass type explicitly.
      type="button"
      ref={ref}
      className={cn(
        'inline-flex items-center justify-center rounded-sm font-medium transition-colors',
        'disabled:cursor-not-allowed disabled:opacity-50',
        VARIANT[variant],
        SIZE[size],
        className,
      )}
      {...rest}
    >
      {leftIcon}
      {children}
      {rightIcon}
    </button>
  );
});
