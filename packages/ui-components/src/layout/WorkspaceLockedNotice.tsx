import { ExternalLink, Lock } from 'lucide-react';
import { PRICING_URL } from '../primitives/externalLinks';

/**
 * The default explanation shown when a workspace is locked, or when creating one
 * would exceed the cap.
 *
 * Its one action is a link to the pricing page. This build sells no plan of its
 * own and has no account to sign in to, so it cannot upgrade anybody itself: the
 * pricing page says how many workspaces each plan keeps open, and leads on to
 * the account site from there. An edition replaces this wholesale via
 * `workspaceAccess.lockedNotice` with its own upgrade path.
 *
 * The one thing this copy must carry is that the data is safe, because "locked"
 * reads as "lost" otherwise. It names no date: a promised date in shipped copy
 * goes stale the day it passes.
 */
export function WorkspaceLockedNotice() {
  return (
    <div className="flex items-start gap-2.5">
      <span
        className="mt-0.5 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-sm border border-border bg-surface text-text-muted"
        aria-hidden="true"
      >
        <Lock size={13} />
      </span>
      <div className="flex min-w-0 flex-col items-start gap-2.5">
        <p className="text-xs leading-relaxed text-text-muted">
          Additional workspaces are locked on this plan. Nothing has been deleted — your requests,
          environments and history are all still here, and unlock again with a plan that includes
          them.
        </p>
        {/* `target="_blank"` is how a desktop build hands the link to the
            browser: a plain link is a navigation, and the shell cancels those. */}
        <a
          className="inline-flex h-7 items-center gap-1.5 rounded-sm border border-accent/40 bg-accent/10 px-2.5 text-[0.6875rem] text-accent hover:bg-accent/20"
          href={PRICING_URL}
          target="_blank"
          rel="noopener noreferrer"
        >
          See plans
          <ExternalLink size={11} aria-hidden="true" />
        </a>
      </div>
    </div>
  );
}
