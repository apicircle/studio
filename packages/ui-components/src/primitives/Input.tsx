import { forwardRef } from 'react';
import type { InputHTMLAttributes } from 'react';
import { cn } from './cn';

type InputProps = InputHTMLAttributes<HTMLInputElement>;

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { className, ...rest },
  ref,
) {
  return (
    <input
      ref={ref}
      className={cn(
        'h-9 w-full rounded-sm border border-border bg-card px-3 text-sm text-text-primary',
        'placeholder:text-text-faint',
        'focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/30',
        'disabled:opacity-50',
        className,
      )}
      {...rest}
    />
  );
});
