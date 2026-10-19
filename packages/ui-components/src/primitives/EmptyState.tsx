import type { ReactNode } from 'react';
import { cn } from './cn';

export interface EmptyStateProps {
  /** A lucide icon at ~18px; drawn in a soft accent circle above the title. */
  icon?: ReactNode;
  /** What is missing, as a short statement: "No request open". */
  title: string;
  /** One line on how to get something here. */
  description?: ReactNode;
  /** The one or two buttons that fill it — the first is the main way in. */
  actions?: ReactNode;
  className?: string;
}

/**
 * What a panel shows when it has nothing to show: a statement of what is
 * missing, a line on how to fill it, and the buttons that do. An empty panel
 * with nothing to press is a dead end, so a caller should pass `actions`
 * wherever an action exists.
 */
export function EmptyState({ icon, title, description, actions, className }: EmptyStateProps) {
  return (
    <div
      className={cn(
        'flex h-full flex-col items-center justify-center gap-3 p-6 text-center',
        className,
      )}
    >
      {icon ? (
        <span
          aria-hidden="true"
          className="flex h-10 w-10 items-center justify-center rounded-full bg-accent/10 text-accent"
        >
          {icon}
        </span>
      ) : null}
      <div className="max-w-sm">
        <p className="text-sm font-medium text-text-primary">{title}</p>
        {description ? <p className="mt-1 text-xs text-text-muted">{description}</p> : null}
      </div>
      {actions ? (
        <div className="flex flex-wrap items-center justify-center gap-2">{actions}</div>
      ) : null}
    </div>
  );
}
