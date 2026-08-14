import type { HTMLAttributes, ReactNode } from 'react';
import { cn } from './cn';

type Tone = 'neutral' | 'accent' | 'success' | 'warning' | 'danger' | 'info';

interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  tone?: Tone;
  /** Uppercase micro-caps styling for status/label chips. */
  uppercase?: boolean;
  children: ReactNode;
}

/**
 * The one status/label chip. Every panel had its own `rounded-sm border … px-1.5
 * text-[0.625rem]` chip; this collapses them onto a tone scale that reads the
 * same in every theme. Semantic tones (success/warning/danger/info) carry
 * meaning; `accent` is emphasis; `neutral` is the default quiet chip.
 */
const TONE: Record<Tone, string> = {
  neutral: 'border-border bg-surface text-text-muted',
  accent: 'border-accent/40 bg-accent/10 text-accent',
  success: 'border-success/40 bg-success/10 text-success',
  warning: 'border-warning/40 bg-warning/10 text-warning',
  danger: 'border-danger/40 bg-danger/10 text-danger',
  info: 'border-info/40 bg-info/10 text-info',
};

export function Badge({ tone = 'neutral', uppercase, className, children, ...rest }: BadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-sm border px-1.5 py-0.5 text-[0.625rem] font-medium',
        uppercase && 'uppercase tracking-wider',
        TONE[tone],
        className,
      )}
      {...rest}
    >
      {children}
    </span>
  );
}
