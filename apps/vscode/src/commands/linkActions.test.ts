import type { Mock } from 'vitest';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type * as vscode from 'vscode';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import type { LinkedWorkspace, ReleaseHistory } from '@apicircle/shared';
import type * as GithubAuthModule from '../host/githubAuth';
import { Uri, window, commands } from '../../test/mocks/vscode';
import { VsCodeBridge } from '../host/vscodeBridge';
import { ApicircleFsProvider } from '../fs/apicircleFsProvider';

// --- Mock the GitHub client + auth so network commands run offline. ---------
const gh = {
  listAccessibleRepos: vi.fn(),
  listBranches: vi.fn(),
  getContents: vi.fn(),
  searchMarketplaceRepos: vi.fn(),
};
vi.mock('@apicircle/git', () => ({
  GitHubClient: class {
    listAccessibleRepos = gh.listAccessibleRepos;
    listBranches = gh.listBranches;
    getContents = gh.getContents;
    searchMarketplaceRepos = gh.searchMarketplaceRepos;
  },
  GitHubError: class extends Error {},
}));
const auth = { getGitHubToken: vi.fn() };
vi.mock('../host/githubAuth', async (importActual) => {
  const actual = await importActual<typeof GithubAuthModule>();
  // Keep getLinkToken + linkSessionSecretKey real; only stub the interactive
  // GitHub session lookup so tests run offline.
  return { ...actual, getGitHubToken: (interactive: boolean) => auth.getGitHubToken(interactive) };
});

import {
  setLinkPinnedVersionFieldCommand,
  setLinkScopeFieldCommand,
  addLinkRequiredKeyCommand,
  removeLinkRequiredKeyCommand,
  unlinkWorkspaceCommand,
  linkWorkspaceCommand,
  refreshLinkedWorkspaceCommand,
  reviewLinkedUpdateCommand,
  setLinkSessionTokenCommand,
  provisionLinkedSecretCommand,
  clearLinkedSecretCommand,
} from './linkActions';

function makeMockContext(globalStoragePath: string) {
  const state = new Map<string, unknown>();
  return {
    subscriptions: [],
    globalState: {
      get: <T>(k: string, d?: T) => (state.has(k) ? (state.get(k) as T) : d),
      update: async (k: string, v: unknown) => void state.set(k, v),
      keys: () => Array.from(state.keys()),
    },
    workspaceState: { get: () => undefined, update: async () => undefined, keys: () => [] },
    secrets: {
      get: async () => undefined,
      store: async () => undefined,
      delete: async () => undefined,
    },
    globalStorageUri: Uri.file(globalStoragePath),
    storageUri: undefined,
    extensionUri: Uri.file('/ext'),
    extensionPath: '/ext',
    asAbsolutePath: (rel: string) => path.join('/ext', rel),
    extensionMode: 3,
  } as never;
}

function link(id: string, over: Partial<LinkedWorkspace> = {}): LinkedWorkspace {
  return {
    id,
    kind: 'public',
    name: 'Payments API',
    source: {
      provider: 'github',
      repoFullName: 'org/payments',
      branch: 'main',
      sessionMode: 'workspace',
    },
    scope: ['collections', 'environments'],
    pinnedVersion: null,
    updatePolicy: 'manual',
    linkedAt: '2026-01-01T00:00:00.000Z',
    requiredSecretKeyIds: [],
    ...over,
  };
}

const ledger: ReleaseHistory = {
  currentVersion: '1.1.0',
  versions: [
    {
      version: '1.0.0',
      publishedAt: 't',
      notes: '',
      workspaceSnapshot: 'a'.repeat(64),
      deprecated: false,
      yanked: false,
    },
    {
      version: '1.1.0',
      publishedAt: 't',
      notes: 'second',
      workspaceSnapshot: 'b'.repeat(64),
      deprecated: false,
      yanked: false,
    },
  ],
};

function seed(
  apicircleDir: string,
  links: Record<string, LinkedWorkspace>,
  perLink: Record<string, ReleaseHistory> = {},
): void {
  fs.mkdirSync(apicircleDir, { recursive: true });
  fs.writeFileSync(
    path.join(apicircleDir, 'workspace.json'),
    JSON.stringify({
      schemaVersion: 1,
      workspaceId: 'lk',
      collections: { tree: { id: 'root', type: 'root', children: [] }, requests: {}, folders: {} },
      environments: { items: {}, activeName: null, priorityOrder: [] },
      linkedWorkspaces: links,
      linkedOverrides: { requests: {}, environmentVars: {} },
      releases: { self: null, perLink },
      globalAssets: { schemas: {}, graphql: {}, files: {} },
      mockServers: {},
      executionPlans: {},
      secretKeys: {},
      secretCrypto: null,
      meta: { createdAt: '2026-01-01', updatedAt: '2026-01-01', appVersion: '0.1.0' },
    }),
  );
}

describe('linkActions', () => {
  let tmp: string;
  let bridge: VsCodeBridge;
  let fsProvider: ApicircleFsProvider;
  let apicircleDir: string;
  let secretStore: Map<string, string>;

  function makeSecrets(): vscode.SecretStorage {
    return {
      get: async (k: string) => secretStore.get(k),
      store: async (k: string, v: string) => {
        secretStore.set(k, v);
      },
      delete: async (k: string) => {
        secretStore.delete(k);
      },
      onDidChange: () => ({ dispose() {} }),
    } as unknown as vscode.SecretStorage;
  }

  function deps() {
    return { bridge, fsProvider, secrets: makeSecrets() };
  }
  function linkUri(id: string) {
    return Uri.parse(`apicircle://x/links/link.link.yaml?id=${id}`) as never;
  }

  function setup(
    links: Record<string, LinkedWorkspace>,
    perLink: Record<string, ReleaseHistory> = {},
  ) {
    apicircleDir = path.join(tmp, '.apicircle');
    seed(apicircleDir, links, perLink);
    bridge = new VsCodeBridge(makeMockContext(path.join(tmp, 'globalStorage')));
    bridge.registerWorkspace({
      id: apicircleDir,
      apicircleDir,
      workspaceJsonPath: path.join(apicircleDir, 'workspace.json'),
      workspaceFolder: { uri: Uri.file(tmp), name: 't', index: 0 } as never,
      label: 't',
    });
    bridge.setActive(apicircleDir);
    fsProvider = new ApicircleFsProvider(bridge);
  }

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'linkact-'));
    secretStore = new Map();
    for (const m of [
      window.showQuickPick,
      window.showInputBox,
      window.showWarningMessage,
      window.showInformationMessage,
      window.showErrorMessage,
      commands.executeCommand,
    ]) {
      (m as Mock).mockReset();
    }
    gh.listAccessibleRepos.mockReset();
    gh.listBranches.mockReset();
    gh.getContents.mockReset();
    gh.searchMarketplaceRepos.mockReset();
    auth.getGitHubToken.mockReset();
  });

  afterEach(() => {
    bridge?.dispose();
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  describe('config (pure)', () => {
    it('pins a version from the cached ledger', async () => {
      setup({ lw1: link('lw1') }, { lw1: ledger });
      (window.showQuickPick as Mock).mockResolvedValueOnce({ label: 'v1.0.0', value: '1.0.0' });
      await setLinkPinnedVersionFieldCommand(deps(), linkUri('lw1'));
      const state = await bridge.activeWorkspace()!.read();
      expect(state.synced.linkedWorkspaces.lw1.pinnedVersion).toBe('1.0.0');
    });

    it('sets scope from a multi-pick', async () => {
      setup({ lw1: link('lw1') }, { lw1: ledger });
      (window.showQuickPick as Mock).mockResolvedValueOnce([{ label: 'collections' }]);
      await setLinkScopeFieldCommand(deps(), linkUri('lw1'));
      const state = await bridge.activeWorkspace()!.read();
      expect(state.synced.linkedWorkspaces.lw1.scope).toEqual(['collections']);
    });

    it('adds + removes a required key', async () => {
      setup({ lw1: link('lw1') }, { lw1: ledger });
      (window.showInputBox as Mock).mockResolvedValueOnce('API_KEY');
      await addLinkRequiredKeyCommand(deps(), linkUri('lw1'));
      let state = await bridge.activeWorkspace()!.read();
      expect(state.synced.linkedWorkspaces.lw1.requiredSecretKeyIds).toContain('API_KEY');

      await removeLinkRequiredKeyCommand(deps(), linkUri('lw1'), 'API_KEY');
      state = await bridge.activeWorkspace()!.read();
      expect(state.synced.linkedWorkspaces.lw1.requiredSecretKeyIds).not.toContain('API_KEY');
    });

    it('unlinks after confirmation', async () => {
      setup({ lw1: link('lw1') }, { lw1: ledger });
      (window.showWarningMessage as Mock).mockResolvedValueOnce('Unlink');
      await unlinkWorkspaceCommand(deps(), linkUri('lw1'));
      const state = await bridge.activeWorkspace()!.read();
      expect(state.synced.linkedWorkspaces.lw1).toBeUndefined();
    });

    it('does not unlink when the confirmation is dismissed', async () => {
      setup({ lw1: link('lw1') }, { lw1: ledger });
      (window.showWarningMessage as Mock).mockResolvedValueOnce(undefined);
      await unlinkWorkspaceCommand(deps(), linkUri('lw1'));
      const state = await bridge.activeWorkspace()!.read();
      expect(state.synced.linkedWorkspaces.lw1).toBeDefined();
    });
  });

  describe('dedicated session token', () => {
    it('stores the PAT in SecretStorage and flips the link to dedicated mode', async () => {
      setup({ lw1: link('lw1', { kind: 'private' }) }, { lw1: ledger });
      (window.showInputBox as Mock).mockResolvedValueOnce('ghp_secret');
      await setLinkSessionTokenCommand(deps(), linkUri('lw1'));
      expect(secretStore.get('apicircle.linkSession.lw1')).toBe('ghp_secret');
      const state = await bridge.activeWorkspace()!.read();
      expect(state.synced.linkedWorkspaces.lw1.source.sessionMode).toBe('dedicated');
    });

    it('refresh on a dedicated link uses the stored PAT (no built-in session prompt)', async () => {
      setup(
        {
          lw1: link('lw1', {
            kind: 'private',
            source: {
              provider: 'github',
              repoFullName: 'o/n',
              branch: 'main',
              sessionMode: 'dedicated',
            },
          }),
        },
        { lw1: ledger },
      );
      secretStore.set('apicircle.linkSession.lw1', 'dedicated-tok');
      auth.getGitHubToken.mockResolvedValue(null); // built-in session would yield nothing
      gh.getContents.mockResolvedValue({
        content: JSON.stringify({ releases: { self: ledger } }),
        sha: 's',
        path: 'p',
        size: 1,
      });
      await refreshLinkedWorkspaceCommand(deps(), linkUri('lw1'));
      // Used the dedicated token, not the (null) built-in session.
      expect(gh.getContents).toHaveBeenCalledWith(
        'dedicated-tok',
        'o',
        'n',
        expect.any(String),
        'main',
      );
      expect(auth.getGitHubToken).not.toHaveBeenCalled();
    });

    it('refresh on a dedicated link with no stored token warns', async () => {
      setup(
        {
          lw1: link('lw1', {
            kind: 'private',
            source: {
              provider: 'github',
              repoFullName: 'o/n',
              branch: 'main',
              sessionMode: 'dedicated',
            },
          }),
        },
        { lw1: ledger },
      );
      await refreshLinkedWorkspaceCommand(deps(), linkUri('lw1'));
      expect(window.showWarningMessage).toHaveBeenCalledWith(
        expect.stringContaining('dedicated session'),
      );
      expect(gh.getContents).not.toHaveBeenCalled();
    });
  });

  describe('required-secret provisioning', () => {
    it('stores a provisioned value in SecretStorage for a given key', async () => {
      setup({ lw1: link('lw1', { requiredSecretKeyIds: ['API_KEY'] }) }, { lw1: ledger });
      (window.showInputBox as Mock).mockResolvedValueOnce('s3cr3t');
      await provisionLinkedSecretCommand(deps(), linkUri('lw1'), 'API_KEY');
      expect(secretStore.get('apicircle.linkedSecret.lw1.API_KEY')).toBe('s3cr3t');
    });

    it('prompts to pick a key when none is supplied', async () => {
      setup({ lw1: link('lw1', { requiredSecretKeyIds: ['A', 'B'] }) }, { lw1: ledger });
      (window.showQuickPick as Mock).mockResolvedValueOnce({ label: 'B', value: 'B' });
      (window.showInputBox as Mock).mockResolvedValueOnce('val');
      await provisionLinkedSecretCommand(deps(), linkUri('lw1'));
      expect(secretStore.get('apicircle.linkedSecret.lw1.B')).toBe('val');
    });

    it('clears a provisioned value', async () => {
      setup({ lw1: link('lw1', { requiredSecretKeyIds: ['API_KEY'] }) }, { lw1: ledger });
      secretStore.set('apicircle.linkedSecret.lw1.API_KEY', 'x');
      await clearLinkedSecretCommand(deps(), linkUri('lw1'), 'API_KEY');
      expect(secretStore.has('apicircle.linkedSecret.lw1.API_KEY')).toBe(false);
    });

    it('unlink wipes provisioned values + dedicated token', async () => {
      setup({ lw1: link('lw1', { requiredSecretKeyIds: ['API_KEY'] }) }, { lw1: ledger });
      secretStore.set('apicircle.linkedSecret.lw1.API_KEY', 'x');
      secretStore.set('apicircle.linkSession.lw1', 'tok');
      (window.showWarningMessage as Mock).mockResolvedValueOnce('Unlink');
      await unlinkWorkspaceCommand(deps(), linkUri('lw1'));
      expect(secretStore.has('apicircle.linkedSecret.lw1.API_KEY')).toBe(false);
      expect(secretStore.has('apicircle.linkSession.lw1')).toBe(false);
    });
  });

  describe('linkWorkspace (network)', () => {
    it('links a picked repo + version from the fetched workspace.json', async () => {
      setup({});
      auth.getGitHubToken.mockResolvedValue('tok');
      gh.listAccessibleRepos.mockResolvedValue([
        {
          fullName: 'org/payments',
          owner: 'org',
          name: 'payments',
          defaultBranch: 'main',
          visibility: 'private',
          isPrivate: true,
          pushable: true,
        },
      ]);
      gh.listBranches.mockResolvedValue([{ name: 'main', commitSha: 'sha' }]);
      gh.getContents.mockResolvedValue({
        content: JSON.stringify({
          releases: { self: ledger },
          collections: { tree: { id: 'r', type: 'root', children: [] }, requests: {}, folders: {} },
          environments: { items: {}, activeName: null, priorityOrder: [] },
          secretKeys: { K: { id: 'K', label: 'Key', salt: 's', createdAt: 't' } },
        }),
        sha: 'blob',
        path: '.apicircle/workspace.json',
        size: 1,
      });
      // repo pick → branch pick → version pick
      (window.showQuickPick as Mock)
        .mockResolvedValueOnce({
          label: 'org/payments',
          repo: { fullName: 'org/payments', defaultBranch: 'main', isPrivate: true },
        })
        .mockResolvedValueOnce({ label: 'main' })
        .mockResolvedValueOnce({ label: 'v1.1.0', value: '1.1.0' });

      await linkWorkspaceCommand(deps());

      const state = await bridge.activeWorkspace()!.read();
      const links = Object.values(state.synced.linkedWorkspaces);
      expect(links).toHaveLength(1);
      expect(links[0].source.repoFullName).toBe('org/payments');
      expect(links[0].pinnedVersion).toBe('1.1.0');
      expect(links[0].kind).toBe('private');
      expect(links[0].requiredSecretKeyIds).toEqual(['K']);
      // Ledger cached + snapshot stored locally.
      expect(state.synced.releases.perLink[links[0].id].currentVersion).toBe('1.1.0');
      expect(state.local.linkedCollections[links[0].id]).toBeDefined();
    });

    it('warns + aborts when GitHub sign-in is declined', async () => {
      setup({});
      auth.getGitHubToken.mockResolvedValue(null);
      await linkWorkspaceCommand(deps());
      expect(window.showWarningMessage).toHaveBeenCalledWith(expect.stringContaining('sign-in'));
      const state = await bridge.activeWorkspace()!.read();
      expect(Object.keys(state.synced.linkedWorkspaces)).toHaveLength(0);
    });
  });

  describe('refreshLinkedWorkspace (network)', () => {
    it('re-pulls the cached ledger', async () => {
      setup(
        { lw1: link('lw1', { kind: 'public' }) },
        { lw1: { currentVersion: '1.0.0', versions: [ledger.versions[0]] } },
      );
      auth.getGitHubToken.mockResolvedValue('tok');
      gh.getContents.mockResolvedValue({
        content: JSON.stringify({ releases: { self: ledger } }),
        sha: 'blob',
        path: '.apicircle/workspace.json',
        size: 1,
      });
      await refreshLinkedWorkspaceCommand(deps(), linkUri('lw1'));
      const state = await bridge.activeWorkspace()!.read();
      expect(state.synced.releases.perLink.lw1.currentVersion).toBe('1.1.0');
      expect(state.synced.releases.perLink.lw1.versions).toHaveLength(2);
    });
  });

  describe('reviewLinkedUpdate (network)', () => {
    it('applies a fresh-source update (caches snapshot + bumps pin)', async () => {
      setup(
        { lw1: link('lw1', { kind: 'public', pinnedVersion: '1.0.0' }) },
        { lw1: { currentVersion: '1.0.0', versions: [ledger.versions[0]] } },
      );
      auth.getGitHubToken.mockResolvedValue('tok');
      gh.getContents.mockResolvedValue({
        content: JSON.stringify({
          releases: { self: ledger },
          collections: {
            tree: { id: 'r', type: 'root', children: [{ kind: 'request', id: 'req-1' }] },
            requests: {
              'req-1': {
                id: 'req-1',
                name: 'List pets',
                method: 'GET',
                url: 'https://api/pets',
                headers: [],
                query: [],
                pathParams: [],
                cookies: [],
                body: { type: 'none' },
                auth: { type: 'none' },
                assertions: [],
                extractions: [],
                contextVars: {},
                folderId: null,
                createdAt: 't',
                updatedAt: 't',
              },
            },
            folders: {},
          },
          environments: { items: {}, activeName: null, priorityOrder: [] },
        }),
        sha: 'blob',
        path: '.apicircle/workspace.json',
        size: 1,
      });
      // Bulk-resolution pick → accept source.
      (window.showQuickPick as Mock).mockResolvedValueOnce({
        label: 'Accept all source',
        value: 'theirs',
      });

      await reviewLinkedUpdateCommand(deps(), linkUri('lw1'));

      const state = await bridge.activeWorkspace()!.read();
      expect(state.synced.linkedWorkspaces.lw1.pinnedVersion).toBe('1.1.0');
      expect(state.synced.releases.perLink.lw1.currentVersion).toBe('1.1.0');
      expect(state.local.linkedCollections.lw1).toBeDefined();
      expect(state.local.linkedCollections.lw1.collections.requests['req-1']).toBeDefined();
    });
  });
});
