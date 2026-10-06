import { act } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { registerGitProvider, resetGitProviderRegistry } from '@apicircle/git';
import { SecretsInPushError, encryptString, serializeWorkspaceForGit } from '@apicircle/core';
import type { WorkingBranch } from '@apicircle/shared';
import { getMasterKey } from '../persistence/secretKey';
import { putSecretPayload } from '../persistence/secrets';
import type { BranchChangeSource, BranchChangeSummary } from '../layout/branchChanges';
import { addEnvironment } from './envActions';
import { useWorkspaceStore } from './workspaceStore';

// The push of the whole working branch (Studio's workspace + an edition's
// changes), the record of an edition's push, the PR description, and the two
// working-branch fixes that ride with them. A fake GitLab provider stands in for
// the host: every call the store makes is a spy the test answers.

const provider = {
  getBranchHead: vi.fn(),
  isAncestor: vi.fn(),
  getContents: vi.fn(),
  getPullRequest: vi.fn(),
  createPullRequest: vi.fn(),
};

function branch(over: Partial<WorkingBranch> = {}): WorkingBranch {
  return {
    name: 'apicircle/wb',
    baseBranch: 'main',
    repoFullName: 'grp/api',
    repoOwner: 'grp',
    repoName: 'api',
    headSha: 'h0',
    createdAt: 't',
    lastPushedSha: 'h0',
    diffSummary: null,
    openPrUrl: null,
    hostKind: 'gitlab',
    ...over,
  };
}

async function seed(working: WorkingBranch | null = branch()): Promise<void> {
  const masterKey = await getMasterKey();
  await putSecretPayload('sec_gl', await encryptString('tok', masterKey));
  const local = useWorkspaceStore.getState().local!;
  useWorkspaceStore.setState({
    local: {
      ...local,
      sessions: {
        github: { workspace: null, links: {} },
        hosts: {
          gitlab: {
            workspace: {
              accountLogin: 'gl',
              tokenSecretId: 'sec_gl',
              grantedScopes: [],
              addedAt: 't',
              lastVerifiedAt: null,
              canCreatePullRequests: null,
            },
            links: {},
          },
        },
      },
      connectedRepo: {
        fullName: 'grp/api',
        owner: 'grp',
        name: 'api',
        defaultBranch: 'main',
        visibility: 'private',
        isPrivate: true,
        pushable: true,
        connectedAt: 't',
        hostKind: 'gitlab',
      },
      workingBranch: working,
      // The document matches the last pull: Studio has nothing of its own to push.
      sync: { ...local.sync, lastPulledSnapshot: useWorkspaceStore.getState().synced },
    },
  });
}

function source(
  id: string,
  summary: BranchChangeSummary | null,
  push: BranchChangeSource['push'],
): BranchChangeSource {
  return {
    id,
    label: `${id} changes`,
    summary: { subscribe: () => () => {}, getSnapshot: () => summary },
    Section: () => null,
    push,
  };
}

const READY: BranchChangeSummary = { added: 1, modified: 0, removed: 0, total: 1, included: 1 };
const wb = () => useWorkspaceStore.getState().local!.workingBranch!;

beforeEach(async () => {
  await act(async () => {
    await useWorkspaceStore.getState().hydrate();
  });
  registerGitProvider('gitlab', () => provider as never);
  for (const fn of Object.values(provider)) fn.mockReset();
});

afterEach(() => {
  resetGitProviderRegistry();
});

describe('pushBranchChanges', () => {
  it('refuses while another push of the branch is running', async () => {
    await seed();
    useWorkspaceStore.setState({ branchPushInFlight: true });
    await expect(useWorkspaceStore.getState().pushBranchChanges({ sources: [] })).rejects.toThrow(
      /already running/,
    );
  });

  it('needs a working branch', async () => {
    await seed(null);
    await expect(useWorkspaceStore.getState().pushBranchChanges({ sources: [] })).rejects.toThrow(
      /Create a working branch/,
    );
    expect(useWorkspaceStore.getState().branchPushInFlight).toBe(false);
  });

  it('needs a ready workspace', async () => {
    useWorkspaceStore.setState({ synced: null });
    await expect(useWorkspaceStore.getState().pushBranchChanges({ sources: [] })).rejects.toThrow(
      /Workspace not ready/,
    );
  });

  it('pushes Studio first, then each source, then records the head the last source left', async () => {
    await seed();
    const pushWorkspace = vi.fn().mockResolvedValue({ commitSha: 's1' });
    const recordBranchPush = vi.fn().mockResolvedValue({ status: 'up-to-date' });
    useWorkspaceStore.setState({
      pushWorkspace,
      recordBranchPush,
      branchPushIncludeStudio: true,
      synced: addEnvironment(useWorkspaceStore.getState().synced!, 'Staging'),
    });
    const lensPush = vi.fn().mockResolvedValue({ headSha: 'c1' });
    const outcome = await useWorkspaceStore.getState().pushBranchChanges({
      message: 'feat: users',
      sources: [source('lens', READY, lensPush)],
    });
    expect(pushWorkspace).toHaveBeenCalledWith('feat: users', undefined);
    expect(lensPush).toHaveBeenCalledWith({ branch: wb(), message: 'feat: users' });
    expect(recordBranchPush).toHaveBeenCalledWith('c1');
    expect(outcome).toEqual({
      parts: [
        { id: 'studio', label: 'Studio changes', status: 'pushed', commitSha: 's1' },
        { id: 'lens', label: 'lens changes', status: 'pushed', commitSha: 'c1' },
      ],
      headSha: 'c1',
      refresh: 'up-to-date',
    });
    expect(useWorkspaceStore.getState().branchPushInFlight).toBe(false);
  });

  it('skips Studio when it has nothing to push, or the user left it out — then resets the choice', async () => {
    await seed();
    const pushWorkspace = vi.fn();
    const recordBranchPush = vi.fn().mockResolvedValue({ status: 'no-remote' });
    useWorkspaceStore.setState({ pushWorkspace, recordBranchPush });
    const first = await useWorkspaceStore.getState().pushBranchChanges({
      sources: [source('lens', READY, async () => ({ headSha: 'c1' }))],
    });
    expect(first.parts[0]).toEqual({ id: 'studio', label: 'Studio changes', status: 'skipped' });

    useWorkspaceStore.setState({
      branchPushIncludeStudio: false,
      synced: addEnvironment(useWorkspaceStore.getState().synced!, 'Staging'),
    });
    const second = await useWorkspaceStore.getState().pushBranchChanges({
      sources: [source('lens', READY, async () => ({ headSha: 'c2' }))],
    });
    expect(second.parts[0].status).toBe('skipped');
    expect(pushWorkspace).not.toHaveBeenCalled();
    expect(useWorkspaceStore.getState().branchPushIncludeStudio).toBe(true);
  });

  it('passes acknowledged secret findings to Studio, and lets a refusal through with nothing pushed', async () => {
    await seed();
    const findings = [{ id: 'f', location: 'l', reason: 'r' }];
    const pushWorkspace = vi
      .fn()
      .mockRejectedValueOnce(new SecretsInPushError(findings))
      .mockResolvedValueOnce({ commitSha: 's1' });
    const lensPush = vi.fn().mockResolvedValue(null);
    useWorkspaceStore.setState({
      pushWorkspace,
      synced: addEnvironment(useWorkspaceStore.getState().synced!, 'Staging'),
    });
    const sources = [source('lens', READY, lensPush)];
    await expect(
      useWorkspaceStore.getState().pushBranchChanges({ sources }),
    ).rejects.toBeInstanceOf(SecretsInPushError);
    expect(lensPush).not.toHaveBeenCalled();
    expect(useWorkspaceStore.getState().branchPushInFlight).toBe(false);

    const outcome = await useWorkspaceStore
      .getState()
      .pushBranchChanges({ sources, acknowledgedSecretFindings: findings });
    expect(pushWorkspace).toHaveBeenLastCalledWith(undefined, {
      acknowledgedSecretFindings: findings,
    });
    // A source with nothing to push: Studio's part alone, no record, the choice reset.
    expect(outcome).toEqual({
      parts: [
        { id: 'studio', label: 'Studio changes', status: 'pushed', commitSha: 's1' },
        { id: 'lens', label: 'lens changes', status: 'skipped' },
      ],
      headSha: 's1',
      refresh: null,
    });
  });

  it('skips a source with nothing to say, nothing included, or a reason it is blocked', async () => {
    await seed();
    const push = vi.fn();
    const outcome = await useWorkspaceStore.getState().pushBranchChanges({
      sources: [
        source('none', null, push),
        source('empty', { ...READY, included: 0 }, push),
        source('blocked', { ...READY, blockedReason: 'Code changes are off' }, push),
      ],
    });
    expect(push).not.toHaveBeenCalled();
    expect(outcome.parts.map((p) => p.status)).toEqual([
      'skipped',
      'skipped',
      'skipped',
      'skipped',
    ]);
    expect(outcome).toMatchObject({ headSha: null, refresh: null });
  });

  it('reports a failing source, does not attempt the rest, and still records what landed before it', async () => {
    await seed();
    const recordBranchPush = vi.fn().mockResolvedValue({ status: 'merged' });
    useWorkspaceStore.setState({ recordBranchPush });
    const outcome = await useWorkspaceStore.getState().pushBranchChanges({
      sources: [
        source('a', READY, async () => ({ headSha: 'c1' })),
        source('b', READY, async () => {
          throw new Error('origin changed users.ts too');
        }),
        source('c', READY, async () => ({ headSha: 'c9' })),
      ],
    });
    expect(outcome.parts.slice(1)).toEqual([
      { id: 'a', label: 'a changes', status: 'pushed', commitSha: 'c1' },
      { id: 'b', label: 'b changes', status: 'failed', error: 'origin changed users.ts too' },
      { id: 'c', label: 'c changes', status: 'not-attempted' },
    ]);
    expect(recordBranchPush).toHaveBeenCalledWith('c1');
    expect(outcome.refresh).toBe('merged');
  });

  it('reports a source that threw a non-Error, and a follow-up refresh that failed', async () => {
    await seed();
    useWorkspaceStore.setState({
      recordBranchPush: vi.fn().mockRejectedValue(new Error('not on the remote')),
    });
    const thrown = await useWorkspaceStore.getState().pushBranchChanges({
      sources: [
        source('ok', READY, async () => ({ headSha: 'c1' })),
        // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors -- a source that rejects with a non-Error is the case under test
        source('odd', READY, () => Promise.reject('plain string')),
      ],
    });
    expect(thrown.parts[2]).toMatchObject({ status: 'failed', error: 'plain string' });
    expect(thrown).toMatchObject({
      headSha: 'c1',
      refresh: null,
      refreshError: 'not on the remote',
    });

    useWorkspaceStore.setState({ recordBranchPush: vi.fn().mockRejectedValue('gone') });
    const plain = await useWorkspaceStore.getState().pushBranchChanges({
      sources: [source('ok', READY, async () => ({ headSha: 'c2' }))],
    });
    expect(plain.refreshError).toBe('gone');
  });

  it('skips a source when the working branch disappears part-way', async () => {
    await seed();
    const later = vi.fn();
    const outcome = await useWorkspaceStore.getState().pushBranchChanges({
      sources: [
        source('first', READY, async () => {
          const local = useWorkspaceStore.getState().local!;
          useWorkspaceStore.setState({ local: { ...local, workingBranch: null } });
          return null;
        }),
        source('second', READY, later),
      ],
    });
    expect(later).not.toHaveBeenCalled();
    expect(outcome.parts[2]).toMatchObject({ id: 'second', status: 'skipped' });
  });
});

describe('recordBranchPush', () => {
  it('records the pushed commit when the remote head is at it, then refreshes', async () => {
    await seed();
    provider.getBranchHead.mockResolvedValue({ commitSha: 'c1' });
    const refreshWorkspace = vi.fn().mockResolvedValue({ status: 'no-remote' });
    useWorkspaceStore.setState({ refreshWorkspace });
    await expect(useWorkspaceStore.getState().recordBranchPush('c1')).resolves.toEqual({
      status: 'no-remote',
    });
    expect(wb()).toMatchObject({ headSha: 'c1', lastPushedSha: 'c1' });
    expect(provider.isAncestor).not.toHaveBeenCalled();
    expect(refreshWorkspace).toHaveBeenCalledOnce();
  });

  it('accepts a remote that has moved past the pushed commit, recording the commit itself', async () => {
    await seed();
    provider.getBranchHead.mockResolvedValue({ commitSha: 'c2' });
    provider.isAncestor.mockResolvedValue(true);
    useWorkspaceStore.setState({
      refreshWorkspace: vi.fn().mockResolvedValue({ status: 'merged' }),
    });
    await useWorkspaceStore.getState().recordBranchPush('c1');
    expect(provider.isAncestor).toHaveBeenCalledWith('tok', 'grp', 'api', 'c1', 'c2');
    expect(wb()).toMatchObject({ headSha: 'c1', lastPushedSha: 'c1' });
  });

  it('refuses a commit the remote branch does not contain, changing nothing', async () => {
    await seed();
    provider.getBranchHead.mockResolvedValue({ commitSha: 'other' });
    provider.isAncestor.mockResolvedValue(false);
    await expect(useWorkspaceStore.getState().recordBranchPush('c1abcdef')).rejects.toThrow(
      /does not contain c1abcde/,
    );
    expect(wb()).toMatchObject({ headSha: 'h0', lastPushedSha: 'h0' });
  });

  it('needs a ready workspace and a working branch', async () => {
    await seed(null);
    await expect(useWorkspaceStore.getState().recordBranchPush('c1')).rejects.toThrow(
      /Create a working branch first/,
    );
    useWorkspaceStore.setState({ local: null });
    await expect(useWorkspaceStore.getState().recordBranchPush('c1')).rejects.toThrow(
      /Workspace not ready/,
    );
  });

  it('records nothing on a branch that went away while it checked, and still refreshes', async () => {
    await seed();
    provider.getBranchHead.mockImplementation(async () => {
      const local = useWorkspaceStore.getState().local!;
      useWorkspaceStore.setState({ local: { ...local, workingBranch: null } });
      return { commitSha: 'c1' };
    });
    const refreshWorkspace = vi.fn().mockResolvedValue({ status: 'no-remote' });
    useWorkspaceStore.setState({ refreshWorkspace });
    await useWorkspaceStore.getState().recordBranchPush('c1');
    expect(useWorkspaceStore.getState().local!.workingBranch).toBeNull();
    expect(refreshWorkspace).toHaveBeenCalledOnce();
  });
});

describe('describeStudioChangesForPullRequest', () => {
  it("describes the branch's workspace against its base branch", async () => {
    await seed();
    const base = useWorkspaceStore.getState().synced!;
    provider.getContents.mockResolvedValue({ content: serializeWorkspaceForGit(base), sha: 'b' });
    useWorkspaceStore.setState({ synced: addEnvironment(base, 'Staging') });
    const md = await useWorkspaceStore.getState().describeStudioChangesForPullRequest();
    // A new environment also joins the priority order: both are what the PR changes.
    expect(md).toBe(
      [
        '## Studio changes',
        '',
        '- Added environment `Staging`',
        '- Changed environment priority',
      ].join('\n'),
    );
    expect(provider.getContents.mock.calls[0][4]).toBe('main');
  });

  it('describes everything as added when the base has no workspace yet', async () => {
    await seed();
    provider.getContents.mockResolvedValue(null);
    useWorkspaceStore.setState({
      synced: addEnvironment(useWorkspaceStore.getState().synced!, 'Staging'),
    });
    expect(await useWorkspaceStore.getState().describeStudioChangesForPullRequest()).toContain(
      '- Added environment `Staging`',
    );
  });

  it('says nothing when the base cannot be read, or there is no branch', async () => {
    await seed();
    provider.getContents.mockRejectedValue(new Error('offline'));
    expect(await useWorkspaceStore.getState().describeStudioChangesForPullRequest()).toBeNull();
    await seed(null);
    expect(await useWorkspaceStore.getState().describeStudioChangesForPullRequest()).toBeNull();
  });
});

describe('the pull request on the working branch', () => {
  it('records the number, keeps a missing page URL as none, and clears a closed notice', async () => {
    await seed(branch({ closedPr: { number: 3, url: null, closedAt: 't' } }));
    provider.createPullRequest.mockResolvedValue({ number: 12, htmlUrl: '' });
    await expect(useWorkspaceStore.getState().createPullRequest()).resolves.toEqual({
      number: 12,
      htmlUrl: '',
    });
    expect(wb()).toMatchObject({ openPrUrl: null, openPrNumber: 12, closedPr: null });
    // Open by number alone is still open.
    await expect(useWorkspaceStore.getState().createPullRequest()).rejects.toThrow(
      /already open for this branch: #12/,
    );
  });

  it('dismisses the closed notice, and does nothing without one', async () => {
    await seed(branch({ closedPr: { number: 3, url: null, closedAt: 't' } }));
    useWorkspaceStore.getState().dismissClosedPullRequest();
    expect(wb().closedPr).toBeNull();
    const before = useWorkspaceStore.getState().local;
    useWorkspaceStore.getState().dismissClosedPullRequest();
    expect(useWorkspaceStore.getState().local).toBe(before);
  });

  it('remembers whether a push of the whole branch includes Studio', () => {
    useWorkspaceStore.getState().setBranchPushIncludeStudio(false);
    expect(useWorkspaceStore.getState().branchPushIncludeStudio).toBe(false);
  });
});

describe('refreshWorkspace — the two working-branch fixes', () => {
  it('adopts the remote head on a branch with no workspace.json, so Studio can push next', async () => {
    await seed();
    provider.getBranchHead.mockResolvedValue({ commitSha: 'c7' });
    provider.getContents.mockResolvedValue(null);
    await expect(useWorkspaceStore.getState().refreshWorkspace()).resolves.toEqual({
      status: 'no-remote',
    });
    expect(wb().headSha).toBe('c7');
  });

  it('leaves the head alone when it has not moved', async () => {
    await seed();
    provider.getBranchHead.mockResolvedValue({ commitSha: 'h0' });
    provider.getContents.mockResolvedValue(null);
    const before = useWorkspaceStore.getState().local;
    await useWorkspaceStore.getState().refreshWorkspace();
    expect(useWorkspaceStore.getState().local!.workingBranch).toBe(before!.workingBranch);
  });

  it('turns a PR closed without merging into a notice, and offers a new one', async () => {
    await seed(branch({ openPrUrl: 'https://gitlab.com/grp/api/-/merge_requests/4' }));
    provider.getBranchHead.mockResolvedValue({ commitSha: 'h0' });
    provider.getPullRequest.mockResolvedValue({ state: 'closed', merged: false });
    provider.getContents.mockResolvedValue(null);
    await useWorkspaceStore.getState().refreshWorkspace();
    expect(provider.getPullRequest).toHaveBeenCalledWith('tok', 'grp', 'api', 4);
    expect(wb()).toMatchObject({
      openPrUrl: null,
      openPrNumber: null,
      closedPr: { number: 4, url: 'https://gitlab.com/grp/api/-/merge_requests/4' },
    });
  });
});
