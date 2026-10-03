import { Lock } from 'lucide-react';

/**
 * The default explanation shown when a workspace is locked, or when creating one
 * would exceed the cap.
 *
 * Deliberately has no call to action. This build sells no plan of its own, and a
 * dead "Upgrade" button is worse than none — an edition replaces this wholesale
 * via `workspaceAccess.lockedNotice` with its own upgrade path.
 *
 * The two things this copy must carry are that the data is safe and that there
 * is a human to ask, because "locked" reads as "lost" otherwise. It names no
 * date: a promised date in shipped copy goes stale the day it passes.
 */
export function WorkspaceLockedNotice() {
  return (
    <div className="space-y-3">
      <div className="flex items-start gap-2.5">
        <span
          className="mt-0.5 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-sm border border-border bg-surface text-text-muted"
          aria-hidden="true"
        >
          <Lock size={13} />
        </span>
        <p className="text-xs leading-relaxed text-text-muted">
          Additional workspaces are locked on this plan. Nothing has been deleted — your requests,
          environments and history are all still here, and unlock again with a plan that includes
          them.
        </p>
      </div>
      <p className="text-[0.6875rem] text-text-dim">
        Need more workspaces, or a hand? Email{' '}
        <a className="text-accent hover:underline" href="mailto:contact@apicircle.dev">
          contact@apicircle.dev
        </a>
        .
      </p>
    </div>
  );
}
