import { forwardRef } from 'react';
import type { InputHTMLAttributes, ReactNode } from 'react';
import { cn } from './cn';

interface RadioProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> {
  label?: ReactNode;
  hint?: ReactNode;
}

/**
 * A themed radio. Give a set of these the same `name` and native grouping does
 * the rest — arrow-key roving and single-selection come for free, which is why
 * this stays a real `<input type="radio">` under a tokenised dot.
 */
export const Radio = forwardRef<HTMLInputElement, RadioProps>(function Radio(
  { label, hint, className, disabled, ...rest },
  ref,
) {
  const dot = (
    <span className="relative inline-flex h-4 w-4 shrink-0">
      <input
        ref={ref}
        type="radio"
        disabled={disabled}
        className={cn(
          'peer absolute inset-0 z-10 m-0 h-full w-full cursor-pointer opacity-0',
          className,
        )}
        {...rest}
      />
      <span
        aria-hidden="true"
        className={cn(
          'pointer-events-none absolute inset-0 rounded-full border transition-colors',
          'border-border bg-card',
          // What says "chosen" and "focused" is the accent's readable colour
          // (`accent-fg`), measured on every theme by apps/web's theme-contrast
          // test: the bare accent's dot is under 3:1 on Ayu Light, and a ring at
          // 50% of it under 3:1 on 51 themes.
          'peer-checked:border-accent-fg',
          'peer-focus-visible:ring-2 peer-focus-visible:ring-accent-fg',
          'peer-disabled:opacity-50',
        )}
      />
      <span
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 m-auto h-1.5 w-1.5 rounded-full bg-accent-fg opacity-0 peer-checked:opacity-100"
      />
    </span>
  );

  if (!label && !hint) return dot;

  return (
    <label
      className={cn(
        'flex min-h-6 cursor-pointer items-start gap-2 text-xs text-text-primary',
        disabled && 'cursor-not-allowed opacity-50',
      )}
    >
      {dot}
      <span className="flex flex-col gap-0.5 leading-tight">
        <span>{label}</span>
        {hint ? <span className="text-[0.6875rem] text-text-muted">{hint}</span> : null}
      </span>
    </label>
  );
});
