import { Lock } from 'lucide-react';
import { GIT_HOST_LABELS, type GitHostKind } from '@apicircle/git';
import { useGitHostAccess } from './gitHostAccess';

/**
 * What a locked Git host shows where its connect form, session controls or repo
 * controls would be: the edition's notice when it supplies one (its upgrade
 * path), else this build's one-line explanation.
 *
 * The default deliberately has no call to action — a dead "Upgrade" button is
 * worse than none — and says the one thing "locked" must never be read as:
 * that something was deleted.
 */
export function GitHostLockedNotice({ host }: { host: GitHostKind }) {
  const { lockedNotice } = useGitHostAccess();
  if (lockedNotice) return <>{lockedNotice}</>;
  return (
    <div className="flex items-start gap-2 rounded-sm border border-border bg-card p-3">
      <Lock size={13} className="mt-0.5 shrink-0 text-text-muted" aria-hidden="true" />
      <p className="text-xs leading-relaxed text-text-muted">
        {GIT_HOST_LABELS[host]} isn&apos;t available on this plan. Nothing has been deleted — a
        session or repo you saved for it is kept.
      </p>
    </div>
  );
}
