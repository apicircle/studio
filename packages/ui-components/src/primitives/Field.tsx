import { useId } from 'react';
import type { ReactNode } from 'react';
import { cn } from './cn';
import { Label } from './Label';

/** Props a `Field` wires into whatever control it wraps. */
export interface FieldControlProps {
  id: string;
  'aria-describedby'?: string;
  'aria-invalid'?: true;
}

interface FieldProps {
  label: ReactNode;
  /** Marks the control required (marker on the label + `required` semantics). */
  required?: boolean;
  /** Helper text shown under the control when there is no error. */
  hint?: ReactNode;
  /** Error text; when set it replaces the hint and wires `aria-invalid`. */
  error?: ReactNode;
  /** Lay the label beside the control instead of above it (e.g. a checkbox row). */
  orientation?: 'vertical' | 'horizontal';
  className?: string;
  /**
   * The control. Pass a function to receive the wired props
   * (`id` / `aria-describedby` / `aria-invalid`) — this is the reliable form and
   * works with the `Input` primitive, a native `<select>`, or a `<textarea>`:
   *
   *   <Field label="Email" required error={err}>
   *     {(f) => <Input type="email" {...f} />}
   *   </Field>
   *
   * Plain children are allowed for composite controls that wire themselves.
   */
  children: ReactNode | ((props: FieldControlProps) => ReactNode);
}

/**
 * The single labelled-field wrapper. It owns the label↔control association, the
 * required marker, and the hint/error slot with `aria-describedby` — the pieces
 * every screen was hand-assembling (and often getting wrong, e.g. a visible
 * label that was never bound to its input). Top-aligned by default, which is the
 * layout the form-design audit calls for.
 */
export function Field({
  label,
  required,
  hint,
  error,
  orientation = 'vertical',
  className,
  children,
}: FieldProps) {
  const id = useId();
  const describedById = `${id}-desc`;
  const describedText = error ?? hint;

  const controlProps: FieldControlProps = {
    id,
    'aria-describedby': describedText ? describedById : undefined,
    'aria-invalid': error ? true : undefined,
  };

  const control = typeof children === 'function' ? children(controlProps) : children;

  return (
    <div
      className={cn(
        orientation === 'horizontal' ? 'flex items-center gap-2' : 'flex flex-col gap-1',
        className,
      )}
    >
      <Label htmlFor={id} required={required}>
        {label}
      </Label>
      {control}
      {describedText ? (
        <p
          id={describedById}
          role={error ? 'alert' : undefined}
          className={cn('text-[0.6875rem]', error ? 'text-danger' : 'text-text-muted')}
        >
          {describedText}
        </p>
      ) : null}
    </div>
  );
}
