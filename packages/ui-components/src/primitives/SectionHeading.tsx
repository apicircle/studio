import type { ReactNode } from 'react';
import { cn } from './cn';

type Level = 'h2' | 'h3' | 'h4';

interface SectionHeadingProps {
  /** The heading level in the page's outline. Defaults to `h2`, a panel's own sections. */
  as?: Level;
  /**
   * `md` (12px) titles a section of a panel; `sm` (11px) a group inside a dense
   * card or sidebar. Nothing smaller: the type scale's floor.
   */
  size?: 'sm' | 'md';
  id?: string;
  className?: string;
  children: ReactNode;
}

const SIZE = { sm: 'text-[0.6875rem]', md: 'text-xs' } as const;

/**
 * The small uppercase title over a section — "Steps", "Plan variables",
 * "Working branch". One style, so every panel's sections read alike and a
 * heading is a real heading to a screen reader, not a styled line of text.
 */
export function SectionHeading({
  as: Tag = 'h2',
  size = 'md',
  id,
  className,
  children,
}: SectionHeadingProps) {
  return (
    <Tag
      id={id}
      className={cn('font-medium uppercase tracking-wider text-text-dim', SIZE[size], className)}
    >
      {children}
    </Tag>
  );
}
