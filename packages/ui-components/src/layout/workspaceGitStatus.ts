import { useEffect, useState } from 'react';
import { summarizeUnpushedChanges } from '@apicircle/core';
import { GIT_HOST_LABELS, type GitHostKind } from '@apicircle/git';
import {
  anyWorkspaceSession,
  connectedHostKind,
  hostOfWorkspaceSession,
  useWorkspaceStore,
} from '../store/workspaceStore';
import { useActiveBranchChanges } from './branchChanges';
import { isGitHostLocked, useGitHostAccess } from './gitHostAccess';

/**
 * Where the workspace stands with its Git source — the same ladder the
 * Workspace page's header badge climbs, as data, so a surface outside that page
 * can show it without the page being open.
 */
export type WorkspaceGitStatus =
  /** No session on any host: the workspace lives on this device only. */
  | { kind: 'local' }
  /** The workspace's host is one the edition has locked (`gitHostAccess`). */
  | { kind: 'locked'; host: GitHostKind }
  /** A session, and no repository chosen yet. */
  | { kind: 'no-repo'; host: GitHostKind }
  /** A repository, and no working branch to push to. */
  | { kind: 'no-branch'; host: GitHostKind; repo: string }
  | {
      kind: 'branch';
      host: GitHostKind;
      repo: string;
      branch: string;
      /**
       * Changes the next push would carry: Studio's own, plus what each of an
       * edition's branch change sources has included. `null` until Studio's have
       * been counted.
       */
      unpushed: number | null;
    };

/**
 * How long the workspace must sit still before its unpushed changes are counted
 * again. The count walks the whole document, and the document changes on every
 * keystroke in the editor, so it is taken once typing pauses.
 */
export const UNPUSHED_RECOUNT_DELAY_MS = 300;

/**
 * The number of changes the next push would carry — the Workspace page's own
 * figure (`summarizeUnpushedChanges` against the last pull), counted after the
 * workspace has been still for {@link UNPUSHED_RECOUNT_DELAY_MS}. `null` while
 * `enabled` is false and until the first count lands; a recount keeps showing
 * the previous figure rather than blanking it.
 */
function useUnpushedCount(enabled: boolean): number | null {
  const lastPulledSnapshot = useWorkspaceStore((s) => s.local?.sync.lastPulledSnapshot ?? null);
  const synced = useWorkspaceStore((s) => s.synced);
  const [count, setCount] = useState<number | null>(null);

  useEffect(() => {
    if (!enabled || !synced) {
      setCount(null);
      return;
    }
    const timer = setTimeout(() => {
      setCount(summarizeUnpushedChanges(lastPulledSnapshot, synced).total);
    }, UNPUSHED_RECOUNT_DELAY_MS);
    return () => clearTimeout(timer);
  }, [enabled, lastPulledSnapshot, synced]);

  return count;
}

/** The workspace's Git status, live from the store and the host-access policy. */
export function useWorkspaceGitStatus(): WorkspaceGitStatus {
  const connected = useWorkspaceStore((s) => anyWorkspaceSession(s.local) !== null);
  const sessionHost = useWorkspaceStore((s) => hostOfWorkspaceSession(s.local));
  const repoHost = useWorkspaceStore((s) => connectedHostKind(s.local));
  const repo = useWorkspaceStore((s) => s.local?.connectedRepo?.fullName ?? null);
  const branch = useWorkspaceStore((s) => s.local?.workingBranch ?? null);
  const access = useGitHostAccess();

  // The repo's host once one is connected, else the host holding the session —
  // the same choice the Workspace page makes, so the two never name different hosts.
  const host = repo !== null ? repoHost : sessionHost;
  const locked = connected && isGitHostLocked(access, host);
  const studioUnpushed = useUnpushedCount(connected && !locked && branch !== null);
  // An edition's changes on the branch (the Lens edition's code) go out in the
  // same push, so they are waiting to be pushed exactly as Studio's are. A
  // source that cannot push right now carries nothing. Studio registers no
  // source: this adds zero.
  const editionUnpushed = useActiveBranchChanges().reduce(
    (sum, { summary }) => sum + (summary.blockedReason ? 0 : summary.included),
    0,
  );
  const unpushed = studioUnpushed === null ? null : studioUnpushed + editionUnpushed;

  if (!connected) return { kind: 'local' };
  if (locked) return { kind: 'locked', host };
  if (branch !== null) {
    return {
      kind: 'branch',
      host,
      repo: repo ?? branch.repoFullName,
      branch: branch.name,
      unpushed,
    };
  }
  if (repo !== null) return { kind: 'no-branch', host, repo };
  return { kind: 'no-repo', host };
}

export interface WorkspaceStatusCopy {
  /** What the chip shows when it has no repository to name. */
  label: string | null;
  /** The status in words — read out after "Open Workspace:". */
  summary: string;
  /** The tooltip: what the status means, and what the Workspace page offers for it. */
  hint: string;
}

function unpushedPhrase(count: number): string {
  return `${count} unpushed change${count === 1 ? '' : 's'}`;
}

/** The words a surface shows for each Git status. */
export function workspaceStatusCopy(status: WorkspaceGitStatus): WorkspaceStatusCopy {
  switch (status.kind) {
    case 'local':
      return {
        label: 'Local workspace',
        summary: 'local workspace, no Git host connected',
        hint: 'This workspace is saved on this device only. Open Workspace to connect a Git host.',
      };
    case 'locked': {
      const host = GIT_HOST_LABELS[status.host];
      return {
        label: `${host} locked`,
        summary: `${host} is locked`,
        hint: `${host} isn't available on this plan. Open Workspace for details.`,
      };
    }
    case 'no-repo': {
      const host = GIT_HOST_LABELS[status.host];
      return {
        label: 'No repository',
        summary: `connected to ${host}, no repository chosen`,
        hint: `Connected to ${host}. Open Workspace to choose a repository.`,
      };
    }
    case 'no-branch':
      return {
        label: null,
        summary: `${status.repo}, no working branch`,
        hint: 'No working branch yet. Open Workspace to create one.',
      };
    case 'branch': {
      const where = `${status.repo}, branch ${status.branch}`;
      if (status.unpushed === null) {
        return { label: null, summary: where, hint: 'Open Workspace to pull and push.' };
      }
      if (status.unpushed === 0) {
        // Worded apart from the Workspace page's own "No unpushed changes" line. A
        // tooltip's text stays in the document while it is hidden, so a second copy
        // of that sentence would answer for the page's wherever text is read.
        return {
          label: null,
          summary: `${where}, nothing to push`,
          hint: 'Nothing to push. Open Workspace to pull the latest.',
        };
      }
      const pending = unpushedPhrase(status.unpushed);
      return {
        label: null,
        summary: `${where}, ${pending}`,
        hint: `${pending}. Open Workspace to review and push.`,
      };
    }
  }
}
