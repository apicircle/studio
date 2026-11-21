import { forwardRef } from 'react';
import type { InputHTMLAttributes, ReactNode } from 'react';
import { Check } from 'lucide-react';
import { cn } from './cn';

interface CheckboxProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> {
  /** Visible label rendered beside the box; the whole row becomes the target. */
  label?: ReactNode;
  /** Secondary line under the label. */
  hint?: ReactNode;
}

/**
 * A themed checkbox with a real, ≥24px-tall click target. The native input stays
 * in the tree (keyboard + form semantics intact) but is visually replaced by a
 * tokenised box so it matches the app in every theme — native checkboxes can't
 * be themed and looked foreign wherever they appeared.
 *
 * The box and the tick are both siblings *after* the input so Tailwind's
 * `peer-checked:` modifier can drive them (it only reaches following siblings,
 * never descendants).
 */
export const Checkbox = forwardRef<HTMLInputElement, CheckboxProps>(function Checkbox(
  { label, hint, className, disabled, ...rest },
  ref,
) {
  const box = (
    <span className="relative inline-flex h-4 w-4 shrink-0">
      <input
        ref={ref}
        type="checkbox"
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
          'pointer-events-none absolute inset-0 rounded-[3px] border transition-colors',
          'border-border bg-card',
          // What says "ticked" and "focused" is the accent's readable colour
          // (`accent-fg`), measured on every theme by apps/web's theme-contrast
          // test: the bare accent's tick is under 3:1 on 10 themes, and a ring
          // at 50% of it under 3:1 on 51.
          'peer-checked:border-accent-fg peer-checked:bg-accent/20',
          'peer-focus-visible:ring-2 peer-focus-visible:ring-accent-fg',
          'peer-disabled:opacity-50',
        )}
      />
      <Check
        size={11}
        strokeWidth={3}
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 m-auto text-accent-fg opacity-0 peer-checked:opacity-100"
      />
    </span>
  );

  if (!label && !hint) return box;

  return (
    <label
      className={cn(
        'flex min-h-6 cursor-pointer items-start gap-2 text-xs text-text-primary',
        disabled && 'cursor-not-allowed opacity-50',
      )}
    >
      {box}
      <span className="flex flex-col gap-0.5 leading-tight">
        <span>{label}</span>
        {hint ? <span className="text-[0.6875rem] text-text-muted">{hint}</span> : null}
      </span>
    </label>
  );
});
