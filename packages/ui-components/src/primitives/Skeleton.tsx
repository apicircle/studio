import type { HTMLAttributes } from 'react';
import { cn } from './cn';

interface SkeletonProps extends HTMLAttributes<HTMLDivElement> {
  /** Number of stacked lines to render (a quick list/paragraph placeholder). */
  lines?: number;
}

/**
 * A content-shaped loading placeholder. The app had no skeleton and leaned on
 * bare "Loading…" text, which reflows the layout when content arrives; a
 * skeleton holds the space and reads as progress. Respects
 * `prefers-reduced-motion` (the shimmer is a Tailwind `animate-pulse`, which the
 * global reduced-motion rule already disables).
 */
export function Skeleton({ lines = 1, className, ...rest }: SkeletonProps) {
  if (lines <= 1) {
    return (
      <div
        aria-hidden="true"
        className={cn('h-3 w-full animate-pulse rounded-sm bg-border/60', className)}
        {...rest}
      />
    );
  }
  return (
    <div aria-hidden="true" className={cn('flex flex-col gap-2', className)} {...rest}>
      {Array.from({ length: lines }).map((_, i) => (
        <div
          key={i}
          className={cn(
            'h-3 animate-pulse rounded-sm bg-border/60',
            // The last line is short, like a real paragraph tail.
            i === lines - 1 ? 'w-2/3' : 'w-full',
          )}
        />
      ))}
    </div>
  );
}
