import type { LabelHTMLAttributes, ReactNode } from 'react';
import { cn } from './cn';

interface LabelProps extends LabelHTMLAttributes<HTMLLabelElement> {
  /** Renders the required marker and an accessible "(required)" note. */
  required?: boolean;
  children: ReactNode;
}

/**
 * The one field-label style: an uppercase, dimmed micro-label sitting above its
 * control. Extracted from the `labelClass` const that was privately re-declared
 * across the panels (AuthEditor, HistoryPanel, …) so labels stop drifting.
 *
 * Always pair with `htmlFor` (or let `Field` wire it) — a floating label with no
 * association is the exact gap the audit found (visible label, placeholder as the
 * accessible name).
 */
export function Label({ required, children, className, ...rest }: LabelProps) {
  return (
    <label
      className={cn(
        'flex items-center gap-1 text-[0.6875rem] font-medium uppercase tracking-wide text-text-dim',
        className,
      )}
      {...rest}
    >
      {children}
      {required ? (
        <>
          <span aria-hidden="true" className="text-danger">
            *
          </span>
          <span className="sr-only">(required)</span>
        </>
      ) : null}
    </label>
  );
}
