import { Download, ExternalLink } from 'lucide-react';
import { cn } from './cn';
import { DESKTOP_RELEASES_URL } from './externalLinks';

// Re-exported for back-compat with existing call sites. New code should
// import directly from `./externalLinks` (`GITHUB_RELEASES_LATEST_URL`).
export { DESKTOP_RELEASES_URL };

interface DesktopAppLinkProps {
  /** Anchor text. Defaults to "Desktop App". */
  children?: React.ReactNode;
  /** Visual variant. `inline` flows with surrounding text (no icon by
   *  default); `button` adds a download icon + chip styling for primary
   *  CTAs (empty states, error toasts). */
  variant?: 'inline' | 'button';
  /** Override the icon — pass `null` for no icon. */
  icon?: React.ReactNode | null;
  className?: string;
}

/**
 * Anchor pointing at the latest Desktop App release on GitHub. Opens in a
 * new tab; uses `noopener noreferrer` for safety.
 *
 * Use `variant="inline"` (default) when the link sits inside a sentence,
 * `variant="button"` for empty-state or banner CTAs that need to read
 * as an action.
 */
export function DesktopAppLink({
  children = 'Desktop App',
  variant = 'inline',
  icon,
  className,
}: DesktopAppLinkProps) {
  const resolvedIcon =
    icon === null
      ? null
      : (icon ??
        (variant === 'button' ? (
          <Download size={11} aria-hidden="true" />
        ) : (
          <ExternalLink size={10} aria-hidden="true" />
        )));
  return (
    <a
      href={DESKTOP_RELEASES_URL}
      target="_blank"
      rel="noopener noreferrer"
      className={cn(
        variant === 'inline'
          ? 'inline-flex items-center gap-1 text-accent underline-offset-2 hover:underline'
          : 'inline-flex h-7 items-center gap-1.5 rounded-sm border border-accent/40 bg-accent/10 px-2.5 text-[0.6875rem] text-accent hover:bg-accent/20',
        className,
      )}
    >
      {children}
      {resolvedIcon}
    </a>
  );
}
