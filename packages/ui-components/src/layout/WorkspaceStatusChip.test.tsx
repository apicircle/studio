import { act, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { GitHostKind } from '@apicircle/git';
import { renderWithStore } from '../../test/renderWithStore';
import { useWorkspaceStore } from '../store/workspaceStore';
import { GitHostAccessProvider } from './gitHostAccess';
import { WorkspaceStatusChip } from './WorkspaceStatusChip';
import { UNPUSHED_RECOUNT_DELAY_MS, workspaceStatusCopy } from './workspaceGitStatus';

const SESSION = {
  accountLogin: 'me',
  tokenSecretId: 's',
  grantedScopes: ['repo'],
  addedAt: 't',
  lastVerifiedAt: 't',
  canCreatePullRequests: true,
};

const REPO = {
  fullName: 'acme/payments-api',
  owner: 'acme',
  name: 'payments-api',
  defaultBranch: 'main',
  visibility: 'private' as const,
  isPrivate: true,
  pushable: true,
  connectedAt: 't',
};

const BRANCH = {
  name: 'apicircle/payments-a3f9c2',
  baseBranch: 'main',
  repoFullName: 'acme/payments-api',
  repoOwner: 'acme',
  repoName: 'payments-api',
  headSha: 'abc',
  createdAt: 't',
  lastPushedSha: null,
  diffSummary: null,
  openPrUrl: null,
};

interface Seed {
  /** The host holding the workspace session; omit for a local-only workspace. */
  session?: GitHostKind;
  repo?: boolean;
  branch?: boolean;
  /** The host recorded on the repo and branch (absent = GitHub, as on old records). */
  repoHost?: GitHostKind;
}

function seed({ session, repo = false, branch = false, repoHost }: Seed): void {
  act(() => {
    const local = useWorkspaceStore.getState().local!;
    useWorkspaceStore.setState({
      local: {
        ...local,
        sessions: {
          github: { workspace: session === 'github' ? SESSION : null, links: {} },
          hosts:
            session && session !== 'github' ? { [session]: { workspace: SESSION, links: {} } } : {},
        },
        connectedRepo: repo ? { ...REPO, ...(repoHost ? { hostKind: repoHost } : {}) } : null,
        workingBranch: branch ? { ...BRANCH, ...(repoHost ? { hostKind: repoHost } : {}) } : null,
      },
    });
  });
}

/** Marks everything in the workspace as pulled, so nothing counts as unpushed. */
function markAllPulled(): void {
  act(() => {
    const { local, synced } = useWorkspaceStore.getState();
    useWorkspaceStore.setState({
      local: { ...local!, sync: { ...local!.sync, lastPulledSnapshot: synced } },
    });
  });
}

function settleCount(): void {
  act(() => {
    vi.advanceTimersByTime(UNPUSHED_RECOUNT_DELAY_MS);
  });
}

const chip = () => screen.getByRole('button', { name: /^Open Workspace:/ });

describe('WorkspaceStatusChip', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('reads as a local workspace when no Git host is connected', async () => {
    await renderWithStore(<WorkspaceStatusChip />);
    expect(chip()).toHaveAccessibleName('Open Workspace: local workspace, no Git host connected');
    expect(chip()).toHaveTextContent('Local workspace');
    expect(chip()).toHaveAttribute('data-workspace-status', 'local');
    expect(screen.getByRole('tooltip')).toHaveTextContent(
      'This workspace is saved on this device only. Open Workspace to connect a Git host.',
    );
  });

  it('asks for a repository once a host is connected, naming that host', async () => {
    await renderWithStore(<WorkspaceStatusChip />);
    seed({ session: 'gitlab' });
    expect(chip()).toHaveAccessibleName(
      'Open Workspace: connected to GitLab, no repository chosen',
    );
    expect(chip()).toHaveTextContent('No repository');
    expect(chip()).toHaveAttribute('data-workspace-status', 'no-repo');
    expect(screen.getByRole('tooltip')).toHaveTextContent(
      'Connected to GitLab. Open Workspace to choose a repository.',
    );
  });

  it('names the repository and says the working branch is missing', async () => {
    await renderWithStore(<WorkspaceStatusChip />);
    seed({ session: 'github', repo: true });
    expect(chip()).toHaveAccessibleName('Open Workspace: acme/payments-api, no working branch');
    expect(chip()).toHaveTextContent('acme/payments-api');
    expect(chip()).toHaveTextContent('no working branch');
    expect(chip()).toHaveAttribute('data-workspace-status', 'no-branch');
    expect(screen.getByRole('tooltip')).toHaveTextContent(
      'No working branch yet. Open Workspace to create one.',
    );
  });

  it('names the repository and branch, then the unpushed count once the workspace is still', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    await renderWithStore(<WorkspaceStatusChip />);
    seed({ session: 'github', repo: true, branch: true });

    // Not counted yet: the chip says where it is and claims nothing about changes.
    expect(chip()).toHaveAccessibleName(
      'Open Workspace: acme/payments-api, branch apicircle/payments-a3f9c2',
    );
    expect(chip()).not.toHaveTextContent('unpushed');
    expect(screen.getByRole('tooltip')).toHaveTextContent('Open Workspace to pull and push.');

    markAllPulled();
    settleCount();
    expect(chip()).toHaveAccessibleName(
      'Open Workspace: acme/payments-api, branch apicircle/payments-a3f9c2, nothing to push',
    );
    expect(chip()).not.toHaveTextContent('unpushed');
    expect(screen.getByRole('tooltip')).toHaveTextContent(
      'Nothing to push. Open Workspace to pull the latest.',
    );

    act(() => {
      useWorkspaceStore.getState().addRequest(null);
    });
    settleCount();
    const pending = useWorkspaceStore.getState();
    expect(pending.synced).not.toBe(pending.local!.sync.lastPulledSnapshot);
    expect(chip()).toHaveTextContent(/\d+ unpushed/);
    expect(chip().getAttribute('aria-label')).toMatch(/, \d+ unpushed changes?$/);
    expect(screen.getByRole('tooltip')).toHaveTextContent(
      /^\d+ unpushed changes?\. Open Workspace to review and push\.$/,
    );
  });

  it('reads as locked, with a lock, when the edition has locked the repo host', async () => {
    await renderWithStore(
      <GitHostAccessProvider value={{ lockedHosts: ['bitbucket'] }}>
        <WorkspaceStatusChip />
      </GitHostAccessProvider>,
    );
    seed({ session: 'bitbucket', repo: true, branch: true, repoHost: 'bitbucket' });
    expect(chip()).toHaveAccessibleName('Open Workspace: Bitbucket is locked');
    expect(chip()).toHaveTextContent('Bitbucket locked');
    // A locked host is named, never its repo or branch: nothing can be done with them.
    expect(chip()).not.toHaveTextContent('acme/payments-api');
    expect(chip()).toHaveAttribute('data-workspace-status', 'locked');
    expect(screen.getByRole('tooltip')).toHaveTextContent(
      "Bitbucket isn't available on this plan. Open Workspace for details.",
    );
  });

  it('opens the Workspace page on click and marks itself current there', async () => {
    await renderWithStore(<WorkspaceStatusChip />);
    expect(useWorkspaceStore.getState().activePanel).toBe('editor');
    expect(chip()).not.toHaveAttribute('aria-current');

    await userEvent.click(chip());

    expect(useWorkspaceStore.getState().activePanel).toBe('workspace');
    expect(chip()).toHaveAttribute('aria-current', 'page');
  });
});

describe('workspaceStatusCopy', () => {
  it('counts one unpushed change in the singular', () => {
    const copy = workspaceStatusCopy({
      kind: 'branch',
      host: 'github',
      repo: 'acme/api',
      branch: 'main',
      unpushed: 1,
    });
    expect(copy.summary).toBe('acme/api, branch main, 1 unpushed change');
    expect(copy.hint).toBe('1 unpushed change. Open Workspace to review and push.');
  });

  it('counts several in the plural', () => {
    const copy = workspaceStatusCopy({
      kind: 'branch',
      host: 'github',
      repo: 'acme/api',
      branch: 'main',
      unpushed: 3,
    });
    expect(copy.summary).toBe('acme/api, branch main, 3 unpushed changes');
    expect(copy.hint).toBe('3 unpushed changes. Open Workspace to review and push.');
  });
});
