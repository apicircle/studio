import { forwardRef } from 'react';
import type { InputHTMLAttributes } from 'react';
import { cn } from './cn';

type Size = 'xs' | 'sm' | 'md' | 'lg';

interface InputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'size'> {
  /** Matches the `Button` scale so a field and its adjacent button line up. */
  size?: Size;
  /** Renders the error affordance and wires `aria-invalid` for assistive tech. */
  invalid?: boolean;
}

const SIZE: Record<Size, string> = {
  xs: 'h-6 px-2 text-[0.6875rem]',
  sm: 'h-7 px-2 text-xs',
  md: 'h-8 px-2.5 text-xs',
  lg: 'h-9 px-3 text-sm',
};

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { className, size = 'sm', invalid, ...rest },
  ref,
) {
  return (
    <input
      ref={ref}
      aria-invalid={invalid || undefined}
      className={cn(
        'w-full min-w-0 rounded-sm border bg-card text-text-primary',
        'placeholder:text-text-faint',
        'focus:outline-none focus:ring-1',
        invalid
          ? 'border-danger focus:border-danger focus:ring-danger/40'
          : 'border-border focus:border-accent focus:ring-accent/30',
        'disabled:cursor-not-allowed disabled:opacity-50',
        SIZE[size],
        className,
      )}
      {...rest}
    />
  );
});
