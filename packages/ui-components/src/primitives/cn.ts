import { twMerge } from 'tailwind-merge';

/**
 * Combines Tailwind class names, resolving conflicts so the LAST class wins.
 *
 * This is what makes the primitives (`Button`, `Input`, …) usable: a component
 * declares a base like `h-8`, and a call site that passes `className="h-7"`
 * reliably overrides it. A plain string join cannot do that — both classes end
 * up in the attribute and the winner is decided by stylesheet order, not by
 * intent, so every call site that needed a variant had to abandon the primitive
 * and hand-roll its own classes.
 *
 * Conflicts are resolved per Tailwind group, so size and colour don't collide:
 * `cn('text-xs', 'text-accent')` keeps both, while `cn('text-xs', 'text-sm')`
 * keeps only `text-sm`.
 */
export function cn(...parts: Array<string | false | null | undefined>): string {
  return twMerge(parts.filter(Boolean).join(' '));
}
