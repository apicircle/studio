import { act, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { computeThreeWayDiff, type ResolutionMap } from '@apicircle/core';
import type { GitHubBranch } from '@apicircle/git';
import type { WorkspaceLocal, WorkspaceSynced } from '@apicircle/shared';
import { WorkspacePanel } from './WorkspacePanel';
import { renderWithStore } from '../../../test/renderWithStore';
import { useWorkspaceStore, type RefreshOutcome } from '../../store/workspaceStore';

// The Workspace panel's slow buttons — Apply merge, Seed <default branch> and
// Pull first — show the brand loader and are marked busy while the action they
// await runs. Each test holds that action's promise open, so the busy render can
// be looked at, then settles it and checks the button is back to its idle self.

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason: Error) => void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** In flight: disabled, `aria-busy`, and the brand loader in place of the icon. */
function expectBusy(button: HTMLElement): void {
  expect(button).toBeDisabled();
  expect(button).toHaveAttribute('aria-busy', 'true');
  expect(button.querySelector('svg[data-brand-loader]')).not.toBeNull();
  expect(button.querySelector('svg:not([data-brand-loader])')).toBeNull();
}

/** Idle: no `aria-busy` at all (not "false"), and the icon, not the loader. */
function expectIdle(button: HTMLElement): void {
  expect(button).not.toHaveAttribute('aria-busy');
  expect(button.querySelector('svg[data-brand-loader]')).toBeNull();
  expect(button.querySelector('svg:not([data-brand-loader])')).not.toBeNull();
}

/** A GitHub session, as the vault writes it, so the panel is not local-only. */
function githubSession(): WorkspaceLocal['sessions'] {
  return {
    github: {
      workspace: {
        accountLogin: 'me',
        tokenSecretId: 'sec',
        grantedScopes: ['repo'],
        addedAt: '2026-10-19T09:00:00.000Z',
        lastVerifiedAt: '2026-10-19T09:00:00.000Z',
        canCreatePullRequests: true,
      },
      links: {},
    },
  };
}

/** Connects `me/api` (default branch `main`) through that session. */
function connectRepo(withWorkingBranch: boolean): void {
  const local = useWorkspaceStore.getState().local!;
  useWorkspaceStore.setState({
    local: {
      ...local,
      sessions: githubSession(),
      connectedRepo: {
        fullName: 'me/api',
        owner: 'me',
        name: 'api',
        defaultBranch: 'main',
        visibility: 'public',
        isPrivate: false,
        pushable: true,
        connectedAt: '2026-10-19T09:00:00.000Z',
      },
      workingBranch: withWorkingBranch
        ? {
            name: 'apicircle/payments-a3f9c2',
            baseBranch: 'main',
            repoFullName: 'me/api',
            repoOwner: 'me',
            repoName: 'api',
            headSha: 'abc1234def',
            createdAt: '2026-10-19T09:00:00.000Z',
            lastPushedSha: null,
            diffSummary: null,
            openPrUrl: null,
          }
        : null,
    },
  });
}

describe('Apply merge in the conflict resolver', () => {
  /** The `staging` environment with its `baseUrl` set to `url`. */
  function stagingAt(synced: WorkspaceSynced, url: string): WorkspaceSynced {
    return {
      ...synced,
      environments: {
        ...synced.environments,
        items: {
          ...synced.environments.items,
          staging: {
            name: 'staging',
            variables: [{ key: 'baseUrl', value: url, encrypted: false }],
          },
        },
      },
    };
  }

  /**
   * A refresh that found both sides edited `staging` since the last pull — the
   * diff the store computes, stashed the way `refreshWorkspace` stashes it — with
   * `commitRefresh` swapped for the test's own.
   */
  async function renderConflict(commitRefresh: (resolutions: ResolutionMap) => Promise<void>) {
    await renderWithStore(<WorkspacePanel />);
    const synced = useWorkspaceStore.getState().synced!;
    const base = stagingAt(synced, 'https://staging.example.com');
    const local = stagingAt(synced, 'https://mine.example.com');
    const remote = stagingAt(synced, 'https://theirs.example.com');
    const diff = computeThreeWayDiff(base, local, remote);
    expect(diff.conflicts.map((c) => `${c.bucket}:${c.key}`)).toEqual(['environment:staging']);
    act(() =>
      useWorkspaceStore.setState({
        commitRefresh,
        pendingRefresh: { diff, remote, remoteSha: 'f00dfacecafe' },
      }),
    );
    return screen.findByRole('dialog', { name: 'Resolve conflicts' });
  }

  it('is idle and disabled until every conflict has a side', async () => {
    const commitRefresh = vi.fn<(resolutions: ResolutionMap) => Promise<void>>();
    const dialog = await renderConflict(commitRefresh);
    const apply = within(dialog).getByRole('button', { name: 'Apply merge' });
    expectIdle(apply);
    expect(apply).toBeDisabled();

    await userEvent.click(within(dialog).getByRole('button', { name: /^Mine \(local\)/ }));
    expectIdle(apply);
    expect(apply).toBeEnabled();
    expect(commitRefresh).not.toHaveBeenCalled();
  });

  it('shows Merging… with the loader while the merge is written, then returns to idle', async () => {
    const commit = deferred<void>();
    const commitRefresh = vi.fn<(resolutions: ResolutionMap) => Promise<void>>(
      () => commit.promise,
    );
    const dialog = await renderConflict(commitRefresh);
    await userEvent.click(within(dialog).getByRole('button', { name: /^Mine \(local\)/ }));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Apply merge' }));

    const merging = within(dialog).getByRole('button', { name: 'Merging…' });
    expectBusy(merging);
    expect(within(dialog).queryByRole('button', { name: 'Apply merge' })).not.toBeInTheDocument();
    expect(commitRefresh).toHaveBeenCalledWith({ 'environment:staging': 'mine' });
    // Disabled means a second click while the first merge runs starts nothing.
    await userEvent.click(merging);
    expect(commitRefresh).toHaveBeenCalledTimes(1);

    await act(async () => commit.resolve());

    // The stub leaves the pending refresh in place, so the modal stays open and
    // shows what the success path leaves behind: the choices cleared, and the
    // button idle again (and disabled, with nothing picked).
    const apply = within(dialog).getByRole('button', { name: 'Apply merge' });
    expectIdle(apply);
    expect(apply).toBeDisabled();
    expect(within(dialog).queryByRole('button', { name: 'Merging…' })).not.toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: /^Mine \(local\)/ })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
    expect(within(dialog).queryByRole('alert')).not.toBeInTheDocument();
  });

  it('returns to an enabled, idle Apply merge with the error when the merge fails', async () => {
    const commit = deferred<void>();
    const dialog = await renderConflict(vi.fn(() => commit.promise));
    await userEvent.click(within(dialog).getByRole('button', { name: /^Theirs \(remote\)/ }));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Apply merge' }));
    expectBusy(within(dialog).getByRole('button', { name: 'Merging…' }));

    await act(async () => commit.reject(new Error('Could not write workspace.json')));

    expect(within(dialog).getByRole('alert')).toHaveTextContent('Could not write workspace.json');
    const apply = within(dialog).getByRole('button', { name: 'Apply merge' });
    expectIdle(apply);
    // The choice survives a failure, so the user can simply try again.
    expect(apply).toBeEnabled();
    expect(within(dialog).getByRole('button', { name: /^Theirs \(remote\)/ })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });
});

describe('Seed <default branch> on an empty repo', () => {
  /**
   * `me/api` connected with no working branch, so the create-branch form shows;
   * the repo lists no branches, so the form offers to seed `main`.
   */
  async function renderEmptyRepo(
    seedInitialCommit: () => Promise<{ branchName: string; scaffoldSha: string }>,
  ): Promise<HTMLElement> {
    await renderWithStore(<WorkspacePanel />);
    await act(async () => {
      useWorkspaceStore.setState({
        listRepoBranches: vi.fn(async (): Promise<GitHubBranch[]> => []),
        seedInitialCommit,
      });
      connectRepo(false);
    });
    expect(await screen.findByText(/This repo is empty/)).toBeInTheDocument();
    return screen.getByRole('button', { name: 'Seed main' });
  }

  it('shows Seeding… with the loader while the commit is written, then offers the new branch', async () => {
    const seed = deferred<{ branchName: string; scaffoldSha: string }>();
    const seedInitialCommit = vi.fn(() => seed.promise);
    const button = await renderEmptyRepo(seedInitialCommit);
    expectIdle(button);
    expect(button).toBeEnabled();

    await userEvent.click(button);
    const seeding = screen.getByRole('button', { name: 'Seeding…' });
    expectBusy(seeding);
    expect(screen.queryByRole('button', { name: 'Seed main' })).not.toBeInTheDocument();
    await userEvent.click(seeding);
    expect(seedInitialCommit).toHaveBeenCalledTimes(1);

    await act(async () => seed.resolve({ branchName: 'main', scaffoldSha: 'f00dfacecafe' }));

    // The seeded branch is the list now, so the empty-repo offer is gone.
    expect(screen.queryByRole('button', { name: 'Seeding…' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Seed main' })).not.toBeInTheDocument();
    expect(screen.queryByText(/This repo is empty/)).not.toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Base branch' })).toHaveValue('main');
  });

  it('returns to an enabled, idle Seed main with the error when the seed fails', async () => {
    const seed = deferred<{ branchName: string; scaffoldSha: string }>();
    await renderEmptyRepo(vi.fn(() => seed.promise));
    await userEvent.click(screen.getByRole('button', { name: 'Seed main' }));
    expectBusy(screen.getByRole('button', { name: 'Seeding…' }));

    await act(async () => seed.reject(new Error('Repository is archived')));

    expect(screen.getByRole('alert')).toHaveTextContent('Repository is archived');
    const button = screen.getByRole('button', { name: 'Seed main' });
    expectIdle(button);
    expect(button).toBeEnabled();
    expect(screen.queryByRole('button', { name: 'Seeding…' })).not.toBeInTheDocument();
  });
});

describe('Pull first in the first-pull prompt', () => {
  /** A new working branch that already had a `workspace.json` upstream. */
  async function renderFirstPullPrompt(
    refreshWorkspace: () => Promise<RefreshOutcome>,
  ): Promise<HTMLElement> {
    await renderWithStore(<WorkspacePanel />);
    act(() => {
      connectRepo(true);
      useWorkspaceStore.setState({
        refreshWorkspace,
        firstPullPrompt: { branchName: 'apicircle/payments-a3f9c2', remoteSha: 'abc123' },
      });
    });
    expect(screen.getByText('This branch already has content')).toBeInTheDocument();
    return screen.getByRole('button', { name: 'Pull first' });
  }

  it('shows Pulling… with the loader while the pull runs, then dismisses the prompt', async () => {
    const pull = deferred<RefreshOutcome>();
    const refreshWorkspace = vi.fn(() => pull.promise);
    const button = await renderFirstPullPrompt(refreshWorkspace);
    expectIdle(button);
    expect(button).toBeEnabled();

    await userEvent.click(button);
    const pulling = screen.getByRole('button', { name: 'Pulling…' });
    expectBusy(pulling);
    expect(screen.queryByRole('button', { name: 'Pull first' })).not.toBeInTheDocument();
    // Still on screen while it pulls: the prompt is only acknowledged once the
    // pull is done.
    expect(useWorkspaceStore.getState().firstPullPrompt).not.toBeNull();
    await userEvent.click(pulling);
    expect(refreshWorkspace).toHaveBeenCalledTimes(1);

    await act(async () => pull.resolve({ status: 'merged' }));

    expect(useWorkspaceStore.getState().firstPullPrompt).toBeNull();
    expect(screen.queryByText('This branch already has content')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Pulling…' })).not.toBeInTheDocument();
  });

  it('returns to an enabled, idle Pull first with the error when the pull fails', async () => {
    const pull = deferred<RefreshOutcome>();
    await renderFirstPullPrompt(vi.fn(() => pull.promise));
    await userEvent.click(screen.getByRole('button', { name: 'Pull first' }));
    expectBusy(screen.getByRole('button', { name: 'Pulling…' }));

    await act(async () => pull.reject(new Error('GitHub returned 503')));

    expect(screen.getByRole('alert')).toHaveTextContent('GitHub returned 503');
    const button = screen.getByRole('button', { name: 'Pull first' });
    expectIdle(button);
    expect(button).toBeEnabled();
    // A failed pull leaves the prompt up, so the choice is still the user's.
    expect(useWorkspaceStore.getState().firstPullPrompt).not.toBeNull();
  });
});
