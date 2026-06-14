import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { Mock } from 'vitest';
import type * as GitModule from '@apicircle/git';

const tagClientStub = {
  getRepo: vi.fn(),
  getRef: vi.fn(),
  getTagSha: vi.fn(),
  deleteRef: vi.fn(),
  createTag: vi.fn(),
  createRelease: vi.fn(),
  listRepoTopics: vi.fn(),
  setRepoTopics: vi.fn(),
};

vi.mock('@apicircle/git', async () => {
  const actual = await vi.importActual<typeof GitModule>('@apicircle/git');
  return {
    ...actual,
    GitHubClient: vi.fn(() => tagClientStub),
  };
});

import { GitHubError } from '@apicircle/git';
import { Uri, authentication, env, window } from '../../test/mocks/vscode';
import { parseGitHubRemote, tagReleaseCommand, editRepoTopicsCommand } from './repoActions';
import type { VsCodeBridge } from '../host/vscodeBridge';

function makeSurface(
  releases: { currentVersion: string; versions: Array<{ version: string; notes?: string }> } | null,
) {
  return {
    workspace: {
      id: 'ws-1',
      name: 'demo',
      workspaceFolder: { uri: Uri.file('/no-such-folder'), name: 'demo', index: 0 },
    },
    read: vi.fn(async () => ({
      synced: { releases: { self: releases } } as never,
      local: {} as never,
    })),
    apply: vi.fn(),
    write: vi.fn(),
  } as unknown;
}

function makeBridge(surface: unknown) {
  return {
    activeWorkspace: () => surface as ReturnType<VsCodeBridge['activeWorkspace']>,
  } as unknown as VsCodeBridge;
}

function defaultClient(): void {
  tagClientStub.getRepo.mockResolvedValue({ defaultBranch: 'main' });
  tagClientStub.getRef.mockResolvedValue({ sha: 'sha-1234567' });
  tagClientStub.getTagSha.mockResolvedValue(null);
  tagClientStub.deleteRef.mockResolvedValue(undefined);
  tagClientStub.createTag.mockResolvedValue(undefined);
  tagClientStub.createRelease.mockResolvedValue({
    htmlUrl: 'https://github.com/o/n/releases/tag/v1',
  });
  tagClientStub.listRepoTopics.mockResolvedValue(['apicircle', 'rest']);
  tagClientStub.setRepoTopics.mockResolvedValue(undefined);
}

function reset(): void {
  (window.showInformationMessage as Mock).mockReset();
  (window.showWarningMessage as Mock).mockReset();
  (window.showErrorMessage as Mock).mockReset();
  (window.showQuickPick as Mock).mockReset();
  (window.showInputBox as Mock).mockReset();
  (env.openExternal as Mock).mockReset();
  (authentication.getSession as Mock).mockReset();
  for (const fn of Object.values(tagClientStub)) fn.mockReset();
  defaultClient();
}

describe('parseGitHubRemote', () => {
  it('parses https remotes', () => {
    expect(parseGitHubRemote('https://github.com/octo-org/payments')).toEqual({
      owner: 'octo-org',
      name: 'payments',
    });
  });

  it('parses https remotes with a .git suffix', () => {
    expect(parseGitHubRemote('https://github.com/octo-org/payments.git')).toEqual({
      owner: 'octo-org',
      name: 'payments',
    });
  });

  it('parses ssh remotes', () => {
    expect(parseGitHubRemote('git@github.com:octo-org/payments.git')).toEqual({
      owner: 'octo-org',
      name: 'payments',
    });
  });

  it('parses ssh:// remotes', () => {
    expect(parseGitHubRemote('ssh://git@github.com/octo-org/payments')).toEqual({
      owner: 'octo-org',
      name: 'payments',
    });
  });

  it('trims trailing whitespace/newlines', () => {
    expect(parseGitHubRemote('https://github.com/o/n\n')).toEqual({ owner: 'o', name: 'n' });
  });

  it('returns null for non-GitHub remotes', () => {
    expect(parseGitHubRemote('https://gitlab.com/o/n')).toBeNull();
    expect(parseGitHubRemote('')).toBeNull();
  });
});

describe('tagReleaseCommand', () => {
  beforeEach(reset);

  it('warns when no active workspace', async () => {
    await tagReleaseCommand({ bridge: makeBridge(null) });
    expect(window.showWarningMessage).toHaveBeenCalledWith('No active APICircle workspace.');
  });

  it('reports nothing-to-tag when releases ledger is empty', async () => {
    const surface = makeSurface(null);
    await tagReleaseCommand({ bridge: makeBridge(surface) });
    expect(window.showInformationMessage).toHaveBeenCalledWith(
      expect.stringContaining('No published releases'),
    );
  });

  it('aborts on version-picker cancel without prompting auth', async () => {
    const surface = makeSurface({
      currentVersion: '1.0.0',
      versions: [{ version: '1.0.0', notes: 'first' }],
    });
    (window.showQuickPick as Mock).mockResolvedValueOnce(undefined);
    await tagReleaseCommand({ bridge: makeBridge(surface) });
    expect(authentication.getSession).not.toHaveBeenCalled();
  });

  it('warns when GitHub sign-in fails', async () => {
    const surface = makeSurface({
      currentVersion: '1.0.0',
      versions: [{ version: '1.0.0' }],
    });
    (window.showQuickPick as Mock).mockResolvedValueOnce({ value: '1.0.0', notes: '' });
    (authentication.getSession as Mock).mockResolvedValueOnce(undefined);
    await tagReleaseCommand({ bridge: makeBridge(surface) });
    expect(window.showWarningMessage).toHaveBeenCalledWith(
      expect.stringContaining('GitHub sign-in is required'),
    );
  });

  it('exits silently when repo resolution returns empty (no remote + dismissed prompt)', async () => {
    const surface = makeSurface({
      currentVersion: '1.0.0',
      versions: [{ version: '1.0.0' }],
    });
    (window.showQuickPick as Mock).mockResolvedValueOnce({ value: '1.0.0', notes: '' });
    (authentication.getSession as Mock).mockResolvedValueOnce({ accessToken: 'gh' });
    (window.showInputBox as Mock).mockResolvedValueOnce(undefined); // manual repo cancel
    await tagReleaseCommand({ bridge: makeBridge(surface) });
    expect(tagClientStub.createTag).not.toHaveBeenCalled();
  });

  it('tags a release with manual owner/name fallback and picks "just the tag"', async () => {
    const surface = makeSurface({
      currentVersion: '1.0.0',
      versions: [{ version: '1.0.0', notes: 'first cut' }],
    });
    (window.showQuickPick as Mock)
      .mockResolvedValueOnce({ value: '1.0.0', notes: 'first cut' })
      .mockResolvedValueOnce({ value: false });
    (authentication.getSession as Mock).mockResolvedValueOnce({ accessToken: 'gh' });
    (window.showInputBox as Mock).mockResolvedValueOnce('o/n'); // manual repo
    await tagReleaseCommand({ bridge: makeBridge(surface) });
    expect(tagClientStub.createTag).toHaveBeenCalledWith(
      'gh',
      'o',
      'n',
      expect.objectContaining({ tagName: 'v1.0.0', sha: 'sha-1234567' }),
    );
    expect(window.showInformationMessage).toHaveBeenCalledWith(
      expect.stringMatching(/Tagged v1\.0\.0 on main/),
    );
  });

  it('also creates a GitHub Release and offers a "View Release" link', async () => {
    const surface = makeSurface({
      currentVersion: '1.0.0',
      versions: [{ version: '1.0.0', notes: 'first cut' }],
    });
    (window.showQuickPick as Mock)
      .mockResolvedValueOnce({ value: '1.0.0', notes: 'first cut' })
      .mockResolvedValueOnce({ value: true });
    (window.showInformationMessage as Mock).mockResolvedValueOnce('View Release');
    (authentication.getSession as Mock).mockResolvedValueOnce({ accessToken: 'gh' });
    (window.showInputBox as Mock).mockResolvedValueOnce('o/n');
    await tagReleaseCommand({ bridge: makeBridge(surface) });
    expect(tagClientStub.createRelease).toHaveBeenCalled();
    expect(env.openExternal).toHaveBeenCalled();
  });

  it('prompts to replace an existing tag and proceeds only when user confirms', async () => {
    const surface = makeSurface({
      currentVersion: '1.0.0',
      versions: [{ version: '1.0.0' }],
    });
    (window.showQuickPick as Mock)
      .mockResolvedValueOnce({ value: '1.0.0', notes: '' })
      .mockResolvedValueOnce({ value: false });
    (window.showWarningMessage as Mock).mockResolvedValueOnce('Replace');
    (authentication.getSession as Mock).mockResolvedValueOnce({ accessToken: 'gh' });
    (window.showInputBox as Mock).mockResolvedValueOnce('o/n');
    tagClientStub.getTagSha.mockResolvedValueOnce('oldsha1234');
    await tagReleaseCommand({ bridge: makeBridge(surface) });
    expect(tagClientStub.deleteRef).toHaveBeenCalled();
    expect(tagClientStub.createTag).toHaveBeenCalled();
  });

  it('aborts the replace when the user dismisses the modal', async () => {
    const surface = makeSurface({
      currentVersion: '1.0.0',
      versions: [{ version: '1.0.0' }],
    });
    (window.showQuickPick as Mock).mockResolvedValueOnce({ value: '1.0.0', notes: '' });
    (window.showWarningMessage as Mock).mockResolvedValueOnce(undefined);
    (authentication.getSession as Mock).mockResolvedValueOnce({ accessToken: 'gh' });
    (window.showInputBox as Mock).mockResolvedValueOnce('o/n');
    tagClientStub.getTagSha.mockResolvedValueOnce('oldsha1234');
    await tagReleaseCommand({ bridge: makeBridge(surface) });
    expect(tagClientStub.deleteRef).not.toHaveBeenCalled();
    expect(tagClientStub.createTag).not.toHaveBeenCalled();
  });

  it('surfaces an error when GitHub Release creation fails AFTER the tag succeeds', async () => {
    const surface = makeSurface({
      currentVersion: '1.0.0',
      versions: [{ version: '1.0.0' }],
    });
    (window.showQuickPick as Mock)
      .mockResolvedValueOnce({ value: '1.0.0', notes: '' })
      .mockResolvedValueOnce({ value: true });
    (authentication.getSession as Mock).mockResolvedValueOnce({ accessToken: 'gh' });
    (window.showInputBox as Mock).mockResolvedValueOnce('o/n');
    tagClientStub.createRelease.mockRejectedValueOnce(new Error('rate limit'));
    await tagReleaseCommand({ bridge: makeBridge(surface) });
    expect(window.showErrorMessage).toHaveBeenCalledWith(
      expect.stringMatching(/Tag created.*GitHub Release failed.*rate limit/),
    );
  });

  it('surfaces a tagging error and exits', async () => {
    const surface = makeSurface({
      currentVersion: '1.0.0',
      versions: [{ version: '1.0.0' }],
    });
    (window.showQuickPick as Mock).mockResolvedValueOnce({ value: '1.0.0', notes: '' });
    (authentication.getSession as Mock).mockResolvedValueOnce({ accessToken: 'gh' });
    (window.showInputBox as Mock).mockResolvedValueOnce('o/n');
    tagClientStub.createTag.mockRejectedValueOnce(new Error('permission denied'));
    await tagReleaseCommand({ bridge: makeBridge(surface) });
    expect(window.showErrorMessage).toHaveBeenCalledWith(
      expect.stringMatching(/Tagging failed.*permission denied/),
    );
  });

  it('surfaces an error when default-branch resolution throws a non-GitHubError', async () => {
    const surface = makeSurface({
      currentVersion: '1.0.0',
      versions: [{ version: '1.0.0' }],
    });
    (window.showQuickPick as Mock).mockResolvedValueOnce({ value: '1.0.0', notes: '' });
    (authentication.getSession as Mock).mockResolvedValueOnce({ accessToken: 'gh' });
    (window.showInputBox as Mock).mockResolvedValueOnce('o/n');
    tagClientStub.getRepo.mockRejectedValueOnce(new Error('boom'));
    await tagReleaseCommand({ bridge: makeBridge(surface) });
    expect(window.showErrorMessage).toHaveBeenCalledWith(
      expect.stringContaining('Could not resolve the default branch'),
    );
  });

  it('falls back to probing main/master after a getRepo GitHubError', async () => {
    const surface = makeSurface({
      currentVersion: '1.0.0',
      versions: [{ version: '1.0.0' }],
    });
    (window.showQuickPick as Mock)
      .mockResolvedValueOnce({ value: '1.0.0', notes: '' })
      .mockResolvedValueOnce({ value: false });
    (authentication.getSession as Mock).mockResolvedValueOnce({ accessToken: 'gh' });
    (window.showInputBox as Mock).mockResolvedValueOnce('o/n');
    tagClientStub.getRepo.mockRejectedValueOnce(new GitHubError('forbidden', 403, ''));
    tagClientStub.getRef
      .mockRejectedValueOnce(new GitHubError('not found', 404, ''))
      .mockResolvedValueOnce({ sha: 'master-sha' });
    await tagReleaseCommand({ bridge: makeBridge(surface) });
    expect(tagClientStub.createTag).toHaveBeenCalledWith(
      'gh',
      'o',
      'n',
      expect.objectContaining({ sha: 'master-sha' }),
    );
  });
});

describe('editRepoTopicsCommand', () => {
  beforeEach(reset);

  it('warns when no GitHub token is available', async () => {
    (authentication.getSession as Mock).mockResolvedValueOnce(undefined);
    await editRepoTopicsCommand({ bridge: makeBridge(makeSurface(null)) });
    expect(window.showWarningMessage).toHaveBeenCalledWith(
      expect.stringContaining('GitHub sign-in is required'),
    );
  });

  it('surfaces an error when listRepoTopics fails', async () => {
    (authentication.getSession as Mock).mockResolvedValueOnce({ accessToken: 'gh' });
    (window.showInputBox as Mock).mockResolvedValueOnce('o/n'); // repo
    tagClientStub.listRepoTopics.mockRejectedValueOnce(new Error('forbidden'));
    await editRepoTopicsCommand({ bridge: makeBridge(makeSurface(null)) });
    expect(window.showErrorMessage).toHaveBeenCalledWith(
      expect.stringContaining('Could not read topics'),
    );
  });

  it('exits silently when the topics input is dismissed', async () => {
    (authentication.getSession as Mock).mockResolvedValueOnce({ accessToken: 'gh' });
    (window.showInputBox as Mock)
      .mockResolvedValueOnce('o/n') // repo
      .mockResolvedValueOnce(undefined); // topics
    await editRepoTopicsCommand({ bridge: makeBridge(makeSurface(null)) });
    expect(tagClientStub.setRepoTopics).not.toHaveBeenCalled();
  });

  it('saves the typed topics with apicircle always present', async () => {
    (authentication.getSession as Mock).mockResolvedValueOnce({ accessToken: 'gh' });
    (window.showInputBox as Mock)
      .mockResolvedValueOnce('o/n')
      .mockResolvedValueOnce('Mocks, GraphQL');
    await editRepoTopicsCommand({ bridge: makeBridge(makeSurface(null)) });
    expect(tagClientStub.setRepoTopics).toHaveBeenCalledWith('gh', 'o', 'n', [
      'apicircle',
      'mocks',
      'graphql',
    ]);
    expect(window.showInformationMessage).toHaveBeenCalledWith(
      expect.stringContaining('saved (3)'),
    );
  });

  it('surfaces an error when setRepoTopics fails', async () => {
    (authentication.getSession as Mock).mockResolvedValueOnce({ accessToken: 'gh' });
    (window.showInputBox as Mock).mockResolvedValueOnce('o/n').mockResolvedValueOnce('ok');
    tagClientStub.setRepoTopics.mockRejectedValueOnce(new Error('rate limit'));
    await editRepoTopicsCommand({ bridge: makeBridge(makeSurface(null)) });
    expect(window.showErrorMessage).toHaveBeenCalledWith(
      expect.stringContaining('Saving topics failed'),
    );
  });

  it('exposes a topic validator that rejects bad formats and accepts valid ones', async () => {
    (authentication.getSession as Mock).mockResolvedValueOnce({ accessToken: 'gh' });
    let captured: ((v: string) => string | null) | undefined;
    (window.showInputBox as Mock)
      .mockResolvedValueOnce('o/n') // repo prompt
      .mockImplementationOnce(async (opts: { validateInput?: (v: string) => string | null }) => {
        captured = opts.validateInput;
        return undefined;
      });
    await editRepoTopicsCommand({ bridge: makeBridge(makeSurface(null)) });
    expect(captured).toBeDefined();
    expect(captured?.('Bad_Topic')).toMatch(/lowercase/);
    const oversize = 'x'.repeat(51);
    expect(captured?.(oversize)).toMatch(/exceeds/);
    expect(captured?.('one,two,three')).toBeNull();
    expect(captured?.(Array(20).fill('t').join(','))).toMatch(/at most 20/);
  });
});
