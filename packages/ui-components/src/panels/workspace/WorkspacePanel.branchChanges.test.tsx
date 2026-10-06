import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MissingScopeError } from '@apicircle/git';
import { SecretsInPushError } from '@apicircle/core';
import type { WorkingBranch } from '@apicircle/shared';
import { WorkspacePanel } from './WorkspacePanel';
import { renderWithStore } from '../../../test/renderWithStore';
import { useWorkspaceStore, type BranchPushOutcome } from '../../store/workspaceStore';
import * as workspaceSharing from '../../layout/workspaceSharing';
import { addEnvironment } from '../../store/envActions';
import {
  BranchChangeSourcesProvider,
  type BranchChangeSource,
  type BranchChangeSummary,
} from '../../layout/branchChanges';

// The working-branch card when an edition changes the branch too (the Lens
// Code editor's code): one preview with a section per source, one push, one PR
// description — and the two fixes every Studio user gets (a PR known only by its
// number, a PR closed without merging).

beforeEach(() => {
  vi.spyOn(workspaceSharing, 'isWorkspaceSharingEnabled').mockReturnValue(true);
});

function seedBranch(over: Partial<WorkingBranch> = {}): void {
  const local = useWorkspaceStore.getState().local!;
  useWorkspaceStore.setState({
    local: {
      ...local,
      sync: {
        ...local.sync,
        lastPulledAt: null,
        lastPulledSnapshot: useWorkspaceStore.getState().synced,
      },
      sessions: {
        github: {
          workspace: {
            accountLogin: 'me',
            tokenSecretId: 'sec',
            grantedScopes: ['repo'],
            addedAt: 't',
            lastVerifiedAt: 't',
            canCreatePullRequests: true,
          },
          links: {},
        },
      },
      connectedRepo: {
        fullName: 'me/api',
        owner: 'me',
        name: 'api',
        defaultBranch: 'main',
        visibility: 'public',
        isPrivate: false,
        pushable: true,
        connectedAt: 't',
      },
      workingBranch: {
        name: 'apicircle/review',
        baseBranch: 'main',
        repoFullName: 'me/api',
        repoOwner: 'me',
        repoName: 'api',
        headSha: 'abc1234def',
        createdAt: 't',
        lastPushedSha: 'abc1234def',
        diffSummary: null,
        openPrUrl: null,
        ...over,
      },
    },
  });
}

function lensSource(summary: BranchChangeSummary | null, over: Partial<BranchChangeSource> = {}) {
  let value = summary;
  const listeners = new Set<() => void>();
  const source: BranchChangeSource = {
    id: 'lens',
    label: 'Code changes',
    summary: {
      subscribe: (cb) => {
        listeners.add(cb);
        return () => listeners.delete(cb);
      },
      getSnapshot: () => value,
    },
    refresh: vi.fn().mockResolvedValue(undefined),
    Section: ({ branch }) => <p>Lens files for {branch.name}</p>,
    push: vi.fn().mockResolvedValue({ headSha: 'c0de123' }),
    describeForPullRequest: vi.fn().mockResolvedValue('## Code changes\n\n- `src/main.ts`'),
    ...over,
  };
  return {
    source,
    set(next: BranchChangeSummary | null) {
      value = next;
      listeners.forEach((cb) => cb());
    },
  };
}

const TWO: BranchChangeSummary = { added: 0, modified: 2, removed: 0, total: 2, included: 2 };

async function renderCard(sources: BranchChangeSource[], over: Partial<WorkingBranch> = {}) {
  await renderWithStore(
    <BranchChangeSourcesProvider value={sources}>
      <WorkspacePanel />
    </BranchChangeSourcesProvider>,
  );
  await act(async () => seedBranch(over));
}

describe('working-branch card with edition changes', () => {
  it('counts the source in the strip and reviews both parts in one preview', async () => {
    const { source, set } = lensSource({ ...TWO, included: 1 });
    await renderCard([source]);
    const strip = screen.getByRole('button', { name: 'Show unpushed changes preview' });
    expect(strip).toHaveTextContent('Code changes: 2 (1 to push)');
    expect(strip).not.toHaveTextContent('Studio:');

    act(() => useWorkspaceStore.getState().addEnvironment('Staging'));
    expect(strip).toHaveTextContent('Studio: 2 changes');

    await userEvent.click(strip);
    const dialog = await screen.findByRole('dialog', { name: 'Unpushed changes preview' });
    const studio = within(dialog).getByRole('region', { name: 'Studio changes' });
    expect(within(studio).getByRole('list', { name: 'Unpushed changes' })).toBeInTheDocument();
    const include = within(studio).getByRole('checkbox', { name: 'Include Studio changes' });
    expect(include).toBeChecked();
    await userEvent.click(include);
    expect(useWorkspaceStore.getState().branchPushIncludeStudio).toBe(false);
    const code = within(dialog).getByRole('region', { name: 'Code changes' });
    expect(code).toHaveTextContent('Lens files for apicircle/review');

    // Studio unchanged: its section says so and offers no choice.
    act(() => set({ ...TWO }));
    await act(async () => seedBranch());
    expect(within(dialog).getByRole('region', { name: 'Studio changes' })).toHaveTextContent(
      'none since the last pull',
    );
    await userEvent.click(within(dialog).getByRole('button', { name: 'Close' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('counts a single Studio change in the singular', async () => {
    const { source } = lensSource(TWO);
    await renderCard([source]);
    act(() => {
      const pulled = addEnvironment(useWorkspaceStore.getState().synced!, 'Staging');
      const local = useWorkspaceStore.getState().local!;
      useWorkspaceStore.setState({
        local: { ...local, sync: { ...local.sync, lastPulledSnapshot: pulled } },
        synced: {
          ...pulled,
          environments: {
            ...pulled.environments,
            items: {
              ...pulled.environments.items,
              Staging: { name: 'Staging', variables: [{ key: 'host', value: 'x', enabled: true }] },
            },
          },
        } as typeof pulled,
      });
    });
    expect(screen.getByRole('button', { name: 'Show unpushed changes preview' })).toHaveTextContent(
      'Studio: 1 change',
    );
  });

  it('shows the plain strip when neither Studio nor the source has anything', async () => {
    const { source } = lensSource({ ...TWO, total: 0, included: 0 });
    await renderCard([source]);
    expect(screen.getByText(/No unpushed changes/)).toBeInTheDocument();
  });

  it('pushes the whole branch and reports each part', async () => {
    const { source } = lensSource(TWO);
    await renderCard([source]);
    const outcome: BranchPushOutcome = {
      parts: [
        { id: 'studio', label: 'Studio changes', status: 'skipped' },
        { id: 'lens', label: 'Code changes', status: 'pushed', commitSha: 'c0de1234' },
      ],
      headSha: 'c0de1234',
      refresh: 'up-to-date',
    };
    const pushBranchChanges = vi.fn().mockResolvedValue(outcome);
    const pushWorkspace = vi.fn();
    act(() => useWorkspaceStore.setState({ pushBranchChanges, pushWorkspace }));
    // An edition change still waiting makes the card not clean.
    await userEvent.click(screen.getByRole('button', { name: 'Custom commit message' }));
    await userEvent.type(screen.getByRole('textbox', { name: 'Commit message' }), 'feat: users');
    await userEvent.click(screen.getByRole('button', { name: 'Push to save' }));
    expect(pushBranchChanges).toHaveBeenCalledWith({ message: 'feat: users', sources: [source] });
    expect(pushWorkspace).not.toHaveBeenCalled();
    const results = await screen.findByLabelText('Push results');
    expect(results).toHaveTextContent('Code changes: pushed c0de123');
    expect(results).not.toHaveTextContent('Studio changes');
    expect(screen.getByText(/Pushed/)).toBeInTheDocument();
    expect(useWorkspaceStore.getState().toasts.at(-1)).toMatchObject({
      tone: 'success',
      title: 'Branch pushed',
      detail: 'Code changes: c0de123',
    });
    expect(screen.queryByRole('textbox', { name: 'Commit message' })).not.toBeInTheDocument();
  });

  it('reports a failed part and retries the rest', async () => {
    const { source } = lensSource(TWO);
    await renderCard([source]);
    const pushBranchChanges = vi
      .fn()
      .mockResolvedValueOnce({
        parts: [
          { id: 'studio', label: 'Studio changes', status: 'pushed', commitSha: 's1234567' },
          { id: 'lens', label: 'Code changes', status: 'failed', error: 'origin changed main.ts' },
          { id: 'x', label: 'More', status: 'not-attempted' },
        ],
        headSha: 's1234567',
        refresh: null,
      } satisfies BranchPushOutcome)
      .mockResolvedValueOnce({
        parts: [{ id: 'studio', label: 'Studio changes', status: 'skipped' }],
        headSha: null,
        refresh: null,
        refreshError: 'branch moved',
      } satisfies BranchPushOutcome);
    act(() => useWorkspaceStore.setState({ pushBranchChanges }));
    await userEvent.click(screen.getByRole('button', { name: 'Push to save' }));
    const results = await screen.findByLabelText('Push results');
    expect(results).toHaveTextContent('Studio changes: pushed s123456');
    expect(results).toHaveTextContent('Code changes: not pushed — origin changed main.ts');
    expect(results).toHaveTextContent('More: not attempted');
    expect(useWorkspaceStore.getState().toasts.at(-1)).toMatchObject({
      tone: 'info',
      title: 'Pushed in part',
    });
    await userEvent.click(screen.getByRole('button', { name: 'Retry the rest' }));
    expect(pushBranchChanges).toHaveBeenCalledTimes(2);
    expect(
      await screen.findByText(/re-reading the branch failed: branch moved/),
    ).toBeInTheDocument();
  });

  it('shows nothing when every part was skipped', async () => {
    const { source } = lensSource(TWO);
    await renderCard([source]);
    act(() =>
      useWorkspaceStore.setState({
        pushBranchChanges: vi.fn().mockResolvedValue({
          parts: [{ id: 'studio', label: 'Studio changes', status: 'skipped' }],
          headSha: null,
          refresh: null,
        }),
      }),
    );
    await userEvent.click(screen.getByRole('button', { name: 'Push to save' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Push to save' })).toBeEnabled());
    expect(screen.queryByLabelText('Push results')).not.toBeInTheDocument();
  });

  it('asks before pushing values shaped like secrets, then pushes with them acknowledged', async () => {
    const { source } = lensSource(TWO);
    await renderCard([source]);
    const findings = [
      { id: 'f1', location: 'Header "Authorization"', reason: 'looks like a token' },
    ];
    const pushBranchChanges = vi
      .fn()
      .mockRejectedValueOnce(new SecretsInPushError(findings))
      .mockResolvedValueOnce({ parts: [], headSha: null, refresh: null });
    act(() => useWorkspaceStore.setState({ pushBranchChanges }));
    await userEvent.click(screen.getByRole('button', { name: 'Push to save' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Push anyway' }));
    expect(pushBranchChanges).toHaveBeenLastCalledWith({
      message: undefined,
      sources: [source],
      acknowledgedSecretFindings: findings,
    });
  });

  it('advises like a Studio push when nothing could be written', async () => {
    const { source } = lensSource(TWO);
    await renderCard([source]);
    act(() =>
      useWorkspaceStore.setState({
        pushBranchChanges: vi.fn().mockRejectedValue(new Error('Remote branch has moved')),
      }),
    );
    await userEvent.click(screen.getByRole('button', { name: 'Push to save' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Remote branch has moved');
  });

  it('asks for a token scope when the push lacked one', async () => {
    const { source } = lensSource(TWO);
    await renderCard([source]);
    const surfaceMissingScope = vi.fn();
    act(() =>
      useWorkspaceStore.setState({
        surfaceMissingScope,
        pushBranchChanges: vi
          .fn()
          .mockRejectedValue(new MissingScopeError('needs repo', 403, ['repo'], [])),
      }),
    );
    await userEvent.click(screen.getByRole('button', { name: 'Push to save' }));
    await waitFor(() => expect(surfaceMissingScope).toHaveBeenCalledWith(['repo']));
  });

  it("re-reads the sources on Refresh, and one that can't refresh never blocks it", async () => {
    const { source } = lensSource(TWO);
    const silent = { ...lensSource(TWO).source, id: 'silent', refresh: undefined };
    await renderCard([source, silent]);
    act(() =>
      useWorkspaceStore.setState({
        refreshWorkspace: vi.fn().mockResolvedValue({ status: 'merged' }),
      }),
    );
    await userEvent.click(screen.getByRole('button', { name: /^Refresh$/ }));
    expect(source.refresh).toHaveBeenCalledOnce();
  });

  it("describes the PR with Studio's part and each source's, until the user writes their own", async () => {
    const { source } = lensSource(TWO);
    const quiet = { ...lensSource(TWO).source, id: 'quiet', describeForPullRequest: undefined };
    const broken = {
      ...lensSource(TWO).source,
      id: 'broken',
      describeForPullRequest: vi.fn().mockRejectedValue(new Error('offline')),
    };
    await renderCard([source, quiet, broken]);
    act(() =>
      useWorkspaceStore.setState({
        describeStudioChangesForPullRequest: vi
          .fn()
          .mockResolvedValue('## Studio changes\n\n- Added environment `Staging`'),
      }),
    );
    await userEvent.click(screen.getByRole('button', { name: 'Create PR' }));
    const body = (await screen.findByRole('textbox', { name: 'PR body' })) as HTMLTextAreaElement;
    await waitFor(() =>
      expect(body.value).toBe(
        '## Studio changes\n\n- Added environment `Staging`\n\n## Code changes\n\n- `src/main.ts`',
      ),
    );
    fireEvent.change(body, { target: { value: 'my words' } });
    expect(body.value).toBe('my words');
  });

  it('opens the PR with an empty description when nothing describes it', async () => {
    const { source } = lensSource(TWO, { describeForPullRequest: undefined });
    await renderCard([source]);
    const createPullRequest = vi.fn().mockResolvedValue({ number: 3, htmlUrl: 'u' });
    act(() =>
      useWorkspaceStore.setState({
        createPullRequest,
        describeStudioChangesForPullRequest: vi.fn().mockRejectedValue(new Error('offline')),
      }),
    );
    await userEvent.click(screen.getByRole('button', { name: 'Create PR' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Open PR' }));
    expect(createPullRequest).toHaveBeenCalledWith({
      title: 'API Circle workspace updates',
      body: '',
    });
  });
});

describe('the open and the closed pull request', () => {
  it('shows a PR the host gave no page URL for, by its number, and offers no second one', async () => {
    await renderCard([], { openPrNumber: 12 });
    expect(screen.getByText('PR open: #12')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Create PR' })).not.toBeInTheDocument();
  });

  it('says a PR was closed without merging, links it, and offers a new one', async () => {
    const dismissClosedPullRequest = vi.fn();
    await renderCard([], {
      closedPr: { number: 7, url: 'https://github.com/me/api/pull/7', closedAt: 't' },
    });
    act(() => useWorkspaceStore.setState({ dismissClosedPullRequest }));
    const notice = screen.getByRole('status');
    expect(notice).toHaveTextContent('PR #7 was closed without merging');
    expect(within(notice).getByRole('link', { name: 'PR #7' })).toHaveAttribute(
      'href',
      'https://github.com/me/api/pull/7',
    );
    expect(screen.getByRole('button', { name: 'Create PR' })).toBeEnabled();
    await userEvent.click(within(notice).getByRole('button', { name: 'Dismiss' }));
    expect(dismissClosedPullRequest).toHaveBeenCalledOnce();
  });

  it('names a closed PR it has no link or number for as "The pull request"', async () => {
    await renderCard([], { closedPr: { number: null, url: null, closedAt: 't' } });
    expect(screen.getByRole('status')).toHaveTextContent(
      'The pull request was closed without merging',
    );
  });

  it('links a closed PR known only by its page URL as "The pull request"', async () => {
    await renderCard([], { closedPr: { number: null, url: 'https://x/pr', closedAt: 't' } });
    expect(screen.getByRole('link', { name: 'The pull request' })).toHaveAttribute(
      'href',
      'https://x/pr',
    );
  });

  it('shows a closed PR known only by its number', async () => {
    await renderCard([], { closedPr: { number: 9, url: null, closedAt: 't' } });
    expect(screen.getByRole('status')).toHaveTextContent('PR #9 was closed without merging');
    expect(screen.queryByRole('link', { name: 'PR #9' })).not.toBeInTheDocument();
  });
});
