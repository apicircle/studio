import { forwardRef } from 'react';
import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { BrandLoader } from './BrandLoader';
import { DisabledReason } from './DisabledReason';
import { cn } from './cn';

type Variant = 'solid' | 'primary' | 'ghost' | 'danger' | 'subtle';
type Size = 'xs' | 'sm' | 'md' | 'lg';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  leftIcon?: ReactNode;
  rightIcon?: ReactNode;
  /**
   * The action this button started is still running: the brand loader takes
   * the left icon's place, the button is disabled so it cannot be pressed
   * twice, and it is marked `aria-busy`. The label is the caller's — pass the
   * in-flight wording ("Sending…") as the children while it is set.
   */
  loading?: boolean;
  /**
   * Why the button is disabled, shown on hover and on keyboard focus while it
   * is (`DisabledReason`). `null` while no reason applies. Not shown while
   * `loading`: the in-flight label already says what is happening.
   */
  disabledReason?: string | null;
  /** Classes for the wrapper `disabledReason` adds, when the button takes part in its row's layout. */
  reasonClassName?: string;
}

/**
 * Tinted-surface button idiom: a tone-coloured border and a low-alpha fill that
 * deepens on hover. This matches how buttons are actually written across the
 * panels, so a hand-rolled button can be swapped for `<Button>` without the
 * surrounding screen shifting.
 *
 * `solid` is the exception, and there is at most one on a screen: the main
 * action (Send, Run, Push). A fill of the accent itself, labelled in the
 * theme's `on-accent` and hovering to `accent-hover`, both generated per theme
 * so the label reads at AA on every one (`scripts/gen-status-fg.mjs`).
 */
const VARIANT: Record<Variant, string> = {
  solid:
    'border border-accent bg-accent text-on-accent hover:border-accent-hover hover:bg-accent-hover',
  primary: 'border border-accent/40 bg-accent/15 text-accent-fg hover:bg-accent/25',
  danger: 'border border-danger/40 bg-danger/15 text-danger-fg hover:bg-danger/25',
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
  {
    variant = 'ghost',
    size = 'sm',
    className,
    leftIcon,
    rightIcon,
    loading = false,
    disabled,
    disabledReason,
    reasonClassName,
    children,
    ...rest
  },
  ref,
) {
  // The brand mark is drawn in the theme's own colours, which a fill of the
  // accent would swallow: a busy solid button wears the tinted look instead,
  // which also reads as "working" at a glance.
  const look = loading && variant === 'solid' ? 'primary' : variant;
  const button = (
    <button
      // Default to a non-submitting button: inside a <form>, the HTML default of
      // type="submit" silently submits. Callers can still pass type explicitly.
      type="button"
      ref={ref}
      className={cn(
        'inline-flex items-center justify-center rounded-sm font-medium transition-colors',
        'disabled:cursor-not-allowed disabled:opacity-50',
        // A busy button is disabled, but it is not unavailable: keep it at full
        // strength so the loader and the in-flight label stay readable.
        loading && 'disabled:cursor-progress disabled:opacity-100',
        VARIANT[look],
        SIZE[size],
        className,
      )}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...rest}
    >
      {loading ? <BrandLoader size="xs" /> : leftIcon}
      {children}
      {rightIcon}
    </button>
  );
  if (disabledReason === undefined) return button;
  return (
    <DisabledReason reason={loading ? null : disabledReason} className={reasonClassName}>
      {button}
    </DisabledReason>
  );
});
