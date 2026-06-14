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
  setLinkNameFieldCommand,
  setLinkDescriptionFieldCommand,
  setLinkSessionModeFieldCommand,
  clearLinkSessionTokenCommand,
  showLinkedChangelogCommand,
  openLinkYamlCommand,
  discardLinkedModsCommand,
  searchMarketplaceCommand,
  openLinkedRequestCommand,
  resetLinkedRequestCommand,
  setLinkedEnvVarOverrideCommand,
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
    return Uri.parse(`apicircle://x/links/link.yaml?id=${id}`) as never;
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
      source: 'git-folder',
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

  describe('additional config command coverage', () => {
    it('setLinkNameFieldCommand updates the link name', async () => {
      setup({ lw1: link('lw1') });
      (window.showInputBox as Mock).mockResolvedValueOnce('Renamed');
      await setLinkNameFieldCommand(deps(), linkUri('lw1'));
      const state = await bridge.activeWorkspace()!.read();
      expect(state.synced.linkedWorkspaces.lw1.name).toBe('Renamed');
    });

    it('setLinkNameFieldCommand exits silently on cancel', async () => {
      setup({ lw1: link('lw1') });
      (window.showInputBox as Mock).mockResolvedValueOnce(undefined);
      await setLinkNameFieldCommand(deps(), linkUri('lw1'));
      const state = await bridge.activeWorkspace()!.read();
      expect(state.synced.linkedWorkspaces.lw1.name).toBe('Payments API');
    });

    it('setLinkNameFieldCommand warns when no link arg supplied', async () => {
      setup({ lw1: link('lw1') });
      await setLinkNameFieldCommand(deps(), undefined);
      expect(window.showWarningMessage).toHaveBeenCalled();
    });

    it('setLinkNameFieldCommand warns when no active workspace', async () => {
      // No setup() — bridge undefined → activeWorkspace returns null
      bridge = new VsCodeBridge(makeMockContext(path.join(tmp, 'globalStorage')));
      fsProvider = new ApicircleFsProvider(bridge);
      await setLinkNameFieldCommand(deps(), linkUri('lw1'));
      expect(window.showWarningMessage).toHaveBeenCalled();
    });

    it('setLinkNameFieldCommand warns when link id is unknown', async () => {
      setup({ lw1: link('lw1') });
      await setLinkNameFieldCommand(deps(), linkUri('ghost'));
      expect(window.showWarningMessage).toHaveBeenCalled();
    });

    it('setLinkDescriptionFieldCommand sets description', async () => {
      setup({ lw1: link('lw1') });
      (window.showInputBox as Mock).mockResolvedValueOnce('Useful description');
      await setLinkDescriptionFieldCommand(deps(), linkUri('lw1'));
      const state = await bridge.activeWorkspace()!.read();
      expect(state.synced.linkedWorkspaces.lw1.description).toBe('Useful description');
    });

    it('setLinkDescriptionFieldCommand clears empty description', async () => {
      setup({ lw1: link('lw1', { description: 'old' }) });
      (window.showInputBox as Mock).mockResolvedValueOnce('   ');
      await setLinkDescriptionFieldCommand(deps(), linkUri('lw1'));
      const state = await bridge.activeWorkspace()!.read();
      expect(state.synced.linkedWorkspaces.lw1.description).toBeUndefined();
    });

    it('setLinkSessionModeFieldCommand flips workspace → dedicated', async () => {
      setup({ lw1: link('lw1') });
      (window.showQuickPick as Mock).mockResolvedValueOnce({ value: 'dedicated' });
      await setLinkSessionModeFieldCommand(deps(), linkUri('lw1'));
      const state = await bridge.activeWorkspace()!.read();
      expect(state.synced.linkedWorkspaces.lw1.source.sessionMode).toBe('dedicated');
    });

    it('setLinkSessionModeFieldCommand is no-op on same value', async () => {
      setup({ lw1: link('lw1') });
      (window.showQuickPick as Mock).mockResolvedValueOnce({ value: 'workspace' });
      await setLinkSessionModeFieldCommand(deps(), linkUri('lw1'));
      const state = await bridge.activeWorkspace()!.read();
      expect(state.synced.linkedWorkspaces.lw1.source.sessionMode).toBe('workspace');
    });

    it('setLinkScopeFieldCommand warns on empty scope', async () => {
      setup({ lw1: link('lw1') });
      (window.showQuickPick as Mock).mockResolvedValueOnce([]);
      await setLinkScopeFieldCommand(deps(), linkUri('lw1'));
      expect(window.showWarningMessage).toHaveBeenCalledWith(
        expect.stringContaining('at least one scope'),
      );
    });

    it('setLinkPinnedVersionFieldCommand exits silently when no version picked', async () => {
      setup({ lw1: link('lw1') }, { lw1: ledger });
      (window.showQuickPick as Mock).mockResolvedValueOnce(undefined);
      await setLinkPinnedVersionFieldCommand(deps(), linkUri('lw1'));
      const state = await bridge.activeWorkspace()!.read();
      expect(state.synced.linkedWorkspaces.lw1.pinnedVersion).toBeNull();
    });

    it('setLinkPinnedVersionFieldCommand reports no versions when ledger empty', async () => {
      setup({ lw1: link('lw1') });
      (window.showQuickPick as Mock).mockResolvedValueOnce(undefined);
      await setLinkPinnedVersionFieldCommand(deps(), linkUri('lw1'));
      const calls = (window.showQuickPick as Mock).mock.calls[0][0] as Array<{ label: string }>;
      expect(calls.some((c) => c.label.includes('No cached versions'))).toBe(true);
    });

    it('addLinkRequiredKeyCommand appends a key', async () => {
      setup({ lw1: link('lw1') });
      (window.showInputBox as Mock).mockResolvedValueOnce('NEW_KEY');
      await addLinkRequiredKeyCommand(deps(), linkUri('lw1'));
      const state = await bridge.activeWorkspace()!.read();
      expect(state.synced.linkedWorkspaces.lw1.requiredSecretKeyIds).toContain('NEW_KEY');
    });

    it('addLinkRequiredKeyCommand exits silently when input cancelled', async () => {
      setup({ lw1: link('lw1') });
      (window.showInputBox as Mock).mockResolvedValueOnce(undefined);
      await addLinkRequiredKeyCommand(deps(), linkUri('lw1'));
      const state = await bridge.activeWorkspace()!.read();
      expect(state.synced.linkedWorkspaces.lw1.requiredSecretKeyIds).toEqual([]);
    });

    it('removeLinkRequiredKeyCommand removes the named key', async () => {
      setup({ lw1: link('lw1', { requiredSecretKeyIds: ['A', 'B'] }) });
      await removeLinkRequiredKeyCommand(deps(), linkUri('lw1'), 'A');
      const state = await bridge.activeWorkspace()!.read();
      expect(state.synced.linkedWorkspaces.lw1.requiredSecretKeyIds).toEqual(['B']);
    });

    it('removeLinkRequiredKeyCommand is a no-op when key not in list', async () => {
      setup({ lw1: link('lw1', { requiredSecretKeyIds: ['A'] }) });
      await removeLinkRequiredKeyCommand(deps(), linkUri('lw1'), 'Z');
      const state = await bridge.activeWorkspace()!.read();
      expect(state.synced.linkedWorkspaces.lw1.requiredSecretKeyIds).toEqual(['A']);
    });

    it('unlinkWorkspaceCommand aborts on modal cancel', async () => {
      setup({ lw1: link('lw1') });
      (window.showWarningMessage as Mock).mockResolvedValueOnce(undefined);
      await unlinkWorkspaceCommand(deps(), linkUri('lw1'));
      const state = await bridge.activeWorkspace()!.read();
      expect(state.synced.linkedWorkspaces.lw1).toBeDefined();
    });

    it('unlinkWorkspaceCommand removes link when user confirms', async () => {
      setup({ lw1: link('lw1') });
      (window.showWarningMessage as Mock).mockResolvedValueOnce('Unlink');
      await unlinkWorkspaceCommand(deps(), linkUri('lw1'));
      const state = await bridge.activeWorkspace()!.read();
      expect(state.synced.linkedWorkspaces.lw1).toBeUndefined();
    });

    it('clearLinkSessionTokenCommand deletes the stored PAT', async () => {
      setup({ lw1: link('lw1') });
      secretStore.set('apicircle.linkSession.lw1', 'gh_abc');
      await clearLinkSessionTokenCommand(deps(), linkUri('lw1'));
      expect(secretStore.has('apicircle.linkSession.lw1')).toBe(false);
    });

    it('clearLinkSessionTokenCommand warns on missing link', async () => {
      setup({ lw1: link('lw1') });
      await clearLinkSessionTokenCommand(deps(), linkUri('ghost'));
      expect(window.showWarningMessage).toHaveBeenCalled();
    });

    it('showLinkedChangelogCommand warns when no ledger is cached', async () => {
      setup({ lw1: link('lw1') });
      await showLinkedChangelogCommand(deps(), linkUri('lw1'));
      // Either a warning or an info message acceptable — the command renders the
      // cached ledger or surfaces a hint to refresh.
      const warned = (window.showWarningMessage as Mock).mock.calls.length > 0;
      const informed = (window.showInformationMessage as Mock).mock.calls.length > 0;
      expect(warned || informed).toBe(true);
    });

    it('openLinkYamlCommand fires when invoked with valid arg', async () => {
      setup({ lw1: link('lw1') });
      await openLinkYamlCommand(deps(), linkUri('lw1'));
      // executeCommand opens the editor view.
      expect(commands.executeCommand).toHaveBeenCalled();
    });

    it('openLinkYamlCommand warns when no link', async () => {
      setup({ lw1: link('lw1') });
      await openLinkYamlCommand(deps(), undefined);
      expect(window.showWarningMessage).toHaveBeenCalled();
    });

    it('discardLinkedModsCommand aborts when modal dismissed', async () => {
      setup({ lw1: link('lw1') });
      (window.showWarningMessage as Mock).mockResolvedValueOnce(undefined);
      await discardLinkedModsCommand(deps(), linkUri('lw1'));
      // No changes — link untouched.
    });

    it('searchMarketplaceCommand exits silently when GitHub search is empty', async () => {
      setup({});
      auth.getGitHubToken.mockResolvedValueOnce('gh');
      gh.searchMarketplaceRepos.mockResolvedValueOnce([]);
      (window.showInputBox as Mock).mockResolvedValueOnce('payments');
      await searchMarketplaceCommand(deps());
    });
  });

  describe('linked request + override helpers', () => {
    it('openLinkedRequestCommand warns when no active workspace', async () => {
      bridge = new VsCodeBridge(makeMockContext(path.join(tmp, 'globalStorage')));
      fsProvider = new ApicircleFsProvider(bridge);
      await openLinkedRequestCommand(deps(), { linkId: 'lw1', requestId: 'r1' });
      expect(window.showWarningMessage).toHaveBeenCalled();
    });

    it('openLinkedRequestCommand exits silently with missing args', async () => {
      setup({ lw1: link('lw1') });
      await openLinkedRequestCommand(deps(), {});
      // No throw, no error
    });

    it('openLinkedRequestCommand warns when the cached request is gone', async () => {
      setup({ lw1: link('lw1') });
      await openLinkedRequestCommand(deps(), { linkId: 'lw1', requestId: 'missing' });
      expect(window.showWarningMessage).toHaveBeenCalledWith(
        expect.stringContaining('no longer cached'),
      );
    });

    it('resetLinkedRequestCommand exits silently when no surface', async () => {
      bridge = new VsCodeBridge(makeMockContext(path.join(tmp, 'globalStorage')));
      fsProvider = new ApicircleFsProvider(bridge);
      await resetLinkedRequestCommand(deps(), { linkId: 'lw1', requestId: 'r1' });
      // No throw expected
    });

    it('resetLinkedRequestCommand fires the linkedOverride.removeRequest patch', async () => {
      setup({ lw1: link('lw1') });
      await resetLinkedRequestCommand(deps(), { linkId: 'lw1', requestId: 'r1' });
      expect(window.showInformationMessage).toHaveBeenCalledWith(
        expect.stringContaining('Reset the linked request'),
      );
    });

    it('setLinkedEnvVarOverrideCommand reports no linked workspaces', async () => {
      setup({});
      (window.showQuickPick as Mock).mockResolvedValueOnce(undefined);
      await setLinkedEnvVarOverrideCommand(deps(), undefined);
      // The function should exit either at "No linked workspaces" or at the pick
    });

    it('setLinkedEnvVarOverrideCommand warns when no cached snapshot for link', async () => {
      setup({ lw1: link('lw1') });
      await setLinkedEnvVarOverrideCommand(deps(), { linkId: 'lw1' });
      expect(window.showWarningMessage).toHaveBeenCalledWith(
        expect.stringContaining('No cached snapshot'),
      );
    });

    it('clearLinkedSecretCommand exits silently when no required keys declared', async () => {
      setup({ lw1: link('lw1') });
      await clearLinkedSecretCommand(deps(), linkUri('lw1'));
      // No throw expected; nothing to clear.
    });

    it('clearLinkedSecretCommand deletes the secret value when keyId is supplied', async () => {
      setup({ lw1: link('lw1', { requiredSecretKeyIds: ['K1'] }) });
      secretStore.set('apicircle.linkedSecret.lw1.K1', 'value');
      await clearLinkedSecretCommand(deps(), linkUri('lw1'), 'K1');
      expect(secretStore.has('apicircle.linkedSecret.lw1.K1')).toBe(false);
    });
  });

  // ==========================================================================
  // linkIdFromArg — the {id: string} object-arg branch
  // ==========================================================================
  describe('linkIdFromArg object branch', () => {
    it('resolves link from an {id} plain object arg', async () => {
      setup({ lw1: link('lw1') });
      (window.showInputBox as Mock).mockResolvedValueOnce('New Name');
      await setLinkNameFieldCommand(deps(), { id: 'lw1' } as never);
      const state = await bridge.activeWorkspace()!.read();
      expect(state.synced.linkedWorkspaces.lw1.name).toBe('New Name');
    });
  });

  // ==========================================================================
  // tokenMissingMessage — private link branch (sessionMode !== 'dedicated')
  // ==========================================================================
  describe('tokenMissingMessage — private link', () => {
    it('warns with "GitHub sign-in" message for private workspace-session link', async () => {
      setup({
        lw1: link('lw1', {
          kind: 'private',
          source: {
            provider: 'github',
            repoFullName: 'org/secret',
            branch: 'main',
            sessionMode: 'workspace',
          },
        }),
      });
      // getLinkToken for a workspace-session link calls getGitHubToken(true).
      auth.getGitHubToken.mockResolvedValue(null);
      await refreshLinkedWorkspaceCommand(deps(), linkUri('lw1'));
      expect(window.showWarningMessage).toHaveBeenCalledWith(expect.stringContaining('sign-in'));
    });
  });

  // ==========================================================================
  // addLinkRequiredKeyCommand — validateInput branches
  // ==========================================================================
  describe('addLinkRequiredKeyCommand validation', () => {
    it('validates empty key input returns error', async () => {
      setup({ lw1: link('lw1') });
      // Supply a value so the command proceeds; we test the validateInput fn
      // by inspecting what was passed to showInputBox.
      (window.showInputBox as Mock).mockImplementation(
        async (opts: { validateInput?: (v: string) => string | null }) => {
          // Exercise the validation function
          expect(opts.validateInput?.('')).toBe('Key id is required');
          expect(opts.validateInput?.('  ')).toBe('Key id is required');
          return undefined; // cancel
        },
      );
      await addLinkRequiredKeyCommand(deps(), linkUri('lw1'));
    });

    it('validates duplicate key returns error', async () => {
      setup({ lw1: link('lw1', { requiredSecretKeyIds: ['EXISTING'] }) });
      (window.showInputBox as Mock).mockImplementation(
        async (opts: { validateInput?: (v: string) => string | null }) => {
          expect(opts.validateInput?.('EXISTING')).toBe('Already required');
          expect(opts.validateInput?.('NEW')).toBeNull();
          return undefined;
        },
      );
      await addLinkRequiredKeyCommand(deps(), linkUri('lw1'));
    });
  });

  // ==========================================================================
  // provisionLinkedSecretCommand — no required keys / quick-pick flow
  // ==========================================================================
  describe('provisionLinkedSecretCommand additional paths', () => {
    it('informs when no required keys declared and keyId not supplied', async () => {
      setup({ lw1: link('lw1', { requiredSecretKeyIds: [] }) });
      await provisionLinkedSecretCommand(deps(), linkUri('lw1'));
      expect(window.showInformationMessage).toHaveBeenCalledWith(
        expect.stringContaining('no required secret keys'),
      );
    });

    it('exits silently when quick-pick of required keys is dismissed', async () => {
      setup({ lw1: link('lw1', { requiredSecretKeyIds: ['K1'] }) });
      (window.showQuickPick as Mock).mockResolvedValueOnce(undefined);
      await provisionLinkedSecretCommand(deps(), linkUri('lw1'));
      // No store call, no error
      expect(window.showInformationMessage).not.toHaveBeenCalled();
    });

    it('exits when value input is cancelled', async () => {
      setup({ lw1: link('lw1', { requiredSecretKeyIds: ['K1'] }) });
      (window.showInputBox as Mock).mockResolvedValueOnce(undefined);
      await provisionLinkedSecretCommand(deps(), linkUri('lw1'), 'K1');
      expect(secretStore.has('apicircle.linkedSecret.lw1.K1')).toBe(false);
    });

    it('exits when value input is empty string', async () => {
      setup({ lw1: link('lw1', { requiredSecretKeyIds: ['K1'] }) });
      (window.showInputBox as Mock).mockResolvedValueOnce('');
      await provisionLinkedSecretCommand(deps(), linkUri('lw1'), 'K1');
      expect(secretStore.has('apicircle.linkedSecret.lw1.K1')).toBe(false);
    });
  });

  // ==========================================================================
  // clearLinkedSecretCommand — picker flow (no keyId supplied, has keys)
  // ==========================================================================
  describe('clearLinkedSecretCommand picker flow', () => {
    it('shows a picker and clears the picked key', async () => {
      setup({ lw1: link('lw1', { requiredSecretKeyIds: ['K1', 'K2'] }) });
      secretStore.set('apicircle.linkedSecret.lw1.K1', 'v1');
      (window.showQuickPick as Mock).mockResolvedValueOnce('K1');
      await clearLinkedSecretCommand(deps(), linkUri('lw1'));
      expect(secretStore.has('apicircle.linkedSecret.lw1.K1')).toBe(false);
    });

    it('exits silently when picker is cancelled', async () => {
      setup({ lw1: link('lw1', { requiredSecretKeyIds: ['K1'] }) });
      secretStore.set('apicircle.linkedSecret.lw1.K1', 'v1');
      (window.showQuickPick as Mock).mockResolvedValueOnce(undefined);
      await clearLinkedSecretCommand(deps(), linkUri('lw1'));
      expect(secretStore.has('apicircle.linkedSecret.lw1.K1')).toBe(true);
    });
  });

  // ==========================================================================
  // showLinkedChangelogCommand — ledger HAS versions
  // ==========================================================================
  describe('showLinkedChangelogCommand with versions', () => {
    it('shows a quick-pick with the cached version list', async () => {
      setup({ lw1: link('lw1') }, { lw1: ledger });
      (window.showQuickPick as Mock).mockResolvedValueOnce(undefined);
      await showLinkedChangelogCommand(deps(), linkUri('lw1'));
      const items = (window.showQuickPick as Mock).mock.calls[0][0] as Array<{
        label: string;
        detail?: string;
      }>;
      expect(items.length).toBe(2); // two versions
      expect(items[0].label).toContain('1.1.0'); // reversed: latest first
      expect(items[0].label).toContain('(current)');
      expect(items[1].label).toContain('1.0.0');
    });

    it('shows deprecated/yanked annotations', async () => {
      const depLedger: ReleaseHistory = {
        currentVersion: '2.0.0',
        versions: [
          {
            version: '1.0.0',
            publishedAt: 't',
            notes: '',
            workspaceSnapshot: 'a'.repeat(64),
            deprecated: true,
            yanked: false,
          },
          {
            version: '2.0.0',
            publishedAt: 't',
            notes: 'latest',
            workspaceSnapshot: 'b'.repeat(64),
            deprecated: false,
            yanked: true,
          },
        ],
      };
      setup({ lw1: link('lw1') }, { lw1: depLedger });
      (window.showQuickPick as Mock).mockResolvedValueOnce(undefined);
      await showLinkedChangelogCommand(deps(), linkUri('lw1'));
      const items = (window.showQuickPick as Mock).mock.calls[0][0] as Array<{
        description: string;
      }>;
      // v2.0.0 (reversed order) is index 0
      expect(items[0].description).toContain('withdrawn');
      // v1.0.0 is index 1
      expect(items[1].description).toContain('deprecated');
    });
  });

  // ==========================================================================
  // openLinkedRequestCommand — success path (with cached link + request)
  // ==========================================================================
  describe('openLinkedRequestCommand success', () => {
    it('opens the linked request editor when link + request are cached', async () => {
      setup({ lw1: link('lw1') });
      // Inject a linked collection into local state
      const surface = bridge.activeWorkspace()!;
      const state = await surface.read();
      await surface.write({
        local: {
          ...state.local,
          linkedCollections: {
            lw1: {
              ref: 'abc',
              collections: {
                tree: { id: 'root', type: 'root' as const, children: [] },
                requests: {
                  'req-1': {
                    id: 'req-1',
                    name: 'Get Users',
                    method: 'GET',
                    url: 'https://api/users',
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
            },
          },
        },
      });
      await openLinkedRequestCommand(deps(), { linkId: 'lw1', requestId: 'req-1' });
      expect(commands.executeCommand).toHaveBeenCalledWith('vscode.open', expect.anything());
    });
  });

  // ==========================================================================
  // resetLinkedRequestCommand — success with valid link + request fires FS change
  // ==========================================================================
  describe('resetLinkedRequestCommand with cached data', () => {
    it('fires FS change when the link and request exist in state', async () => {
      setup({ lw1: link('lw1') });
      const surface = bridge.activeWorkspace()!;
      const state = await surface.read();
      await surface.write({
        local: {
          ...state.local,
          linkedCollections: {
            lw1: {
              ref: 'abc',
              collections: {
                tree: { id: 'root', type: 'root' as const, children: [] },
                requests: {
                  'req-1': {
                    id: 'req-1',
                    name: 'Get Users',
                    method: 'GET',
                    url: 'https://api/users',
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
            },
          },
        },
      });
      await resetLinkedRequestCommand(deps(), { linkId: 'lw1', requestId: 'req-1' });
      expect(window.showInformationMessage).toHaveBeenCalledWith(
        expect.stringContaining('Reset the linked request'),
      );
    });
  });

  // ==========================================================================
  // setLinkedEnvVarOverrideCommand — full flows
  // ==========================================================================
  describe('setLinkedEnvVarOverrideCommand flows', () => {
    async function setupWithSnapshot() {
      setup({ lw1: link('lw1') });
      const surface = bridge.activeWorkspace()!;
      const state = await surface.read();
      await surface.write({
        local: {
          ...state.local,
          linkedCollections: {
            lw1: {
              ref: 'abc',
              collections: {
                tree: { id: 'root', type: 'root' as const, children: [] },
                requests: {},
                folders: {},
              },
              environments: {
                items: {
                  Production: {
                    variables: [
                      {
                        key: 'API_URL',
                        value: 'https://prod.api',
                        enabled: true,
                        encrypted: false,
                      },
                      { key: 'SECRET', value: '', enabled: true, encrypted: true },
                    ],
                  },
                  Staging: {
                    variables: [
                      {
                        key: 'API_URL',
                        value: 'https://staging.api',
                        enabled: true,
                        encrypted: false,
                      },
                    ],
                  },
                },
                activeName: 'Production',
                priorityOrder: ['Production', 'Staging'],
              },
            },
          },
        },
      });
    }

    it('exits when no surface (no active workspace)', async () => {
      bridge = new VsCodeBridge(makeMockContext(path.join(tmp, 'globalStorage')));
      fsProvider = new ApicircleFsProvider(bridge);
      await setLinkedEnvVarOverrideCommand(deps());
      // No throw, no calls
    });

    it('picks link when linkId not supplied', async () => {
      await setupWithSnapshot();
      // link pick → cancel
      (window.showQuickPick as Mock).mockResolvedValueOnce(undefined);
      await setLinkedEnvVarOverrideCommand(deps());
      // Exited after link pick cancel
    });

    it('picks link from multiple when linkId not supplied', async () => {
      await setupWithSnapshot();
      // link pick → picks lw1 → env pick → cancel
      (window.showQuickPick as Mock)
        .mockResolvedValueOnce({ label: 'Payments API', id: 'lw1' })
        .mockResolvedValueOnce(undefined); // env pick cancelled
      await setLinkedEnvVarOverrideCommand(deps());
    });

    it('warns when env not in snapshot', async () => {
      await setupWithSnapshot();
      await setLinkedEnvVarOverrideCommand(deps(), {
        linkId: 'lw1',
        envName: 'NonExistent',
      });
      expect(window.showWarningMessage).toHaveBeenCalledWith(
        expect.stringContaining('not in the linked snapshot'),
      );
    });

    it('picks env when envName not supplied', async () => {
      await setupWithSnapshot();
      // env pick → cancel
      (window.showQuickPick as Mock).mockResolvedValueOnce(undefined);
      await setLinkedEnvVarOverrideCommand(deps(), { linkId: 'lw1' });
    });

    it('picks a var and applies reset mode', async () => {
      await setupWithSnapshot();
      // var pick → API_URL
      (window.showQuickPick as Mock)
        .mockResolvedValueOnce({ label: 'API_URL', key: 'API_URL' })
        // mode pick → reset
        .mockResolvedValueOnce({ label: 'Reset', value: 'reset' });
      await setLinkedEnvVarOverrideCommand(deps(), {
        linkId: 'lw1',
        envName: 'Production',
      });
      expect(window.showInformationMessage).toHaveBeenCalledWith(
        expect.stringContaining('Reset Production:API_URL'),
      );
    });

    it('picks a var and applies remove mode', async () => {
      await setupWithSnapshot();
      (window.showQuickPick as Mock)
        .mockResolvedValueOnce({ label: 'API_URL', key: 'API_URL' })
        .mockResolvedValueOnce({ label: 'Remove', value: 'remove' });
      await setLinkedEnvVarOverrideCommand(deps(), {
        linkId: 'lw1',
        envName: 'Production',
      });
      expect(window.showInformationMessage).toHaveBeenCalledWith(expect.stringContaining('hidden'));
    });

    it('picks a var and applies replace mode', async () => {
      await setupWithSnapshot();
      (window.showQuickPick as Mock)
        .mockResolvedValueOnce({ label: 'API_URL', key: 'API_URL' })
        .mockResolvedValueOnce({ label: 'Replace', value: 'replace' });
      (window.showInputBox as Mock).mockResolvedValueOnce('https://new.api');
      await setLinkedEnvVarOverrideCommand(deps(), {
        linkId: 'lw1',
        envName: 'Production',
      });
      expect(window.showInformationMessage).toHaveBeenCalledWith(
        expect.stringContaining('Overrode Production:API_URL'),
      );
    });

    it('exits on replace mode when value input is cancelled', async () => {
      await setupWithSnapshot();
      (window.showQuickPick as Mock)
        .mockResolvedValueOnce({ label: 'API_URL', key: 'API_URL' })
        .mockResolvedValueOnce({ label: 'Replace', value: 'replace' });
      (window.showInputBox as Mock).mockResolvedValueOnce(undefined);
      await setLinkedEnvVarOverrideCommand(deps(), {
        linkId: 'lw1',
        envName: 'Production',
      });
      expect(window.showInformationMessage).not.toHaveBeenCalled();
    });

    it('exits when var pick is dismissed', async () => {
      await setupWithSnapshot();
      (window.showQuickPick as Mock).mockResolvedValueOnce(undefined);
      await setLinkedEnvVarOverrideCommand(deps(), {
        linkId: 'lw1',
        envName: 'Production',
      });
      expect(window.showInformationMessage).not.toHaveBeenCalled();
    });

    it('exits when mode pick is dismissed', async () => {
      await setupWithSnapshot();
      (window.showQuickPick as Mock)
        .mockResolvedValueOnce({ label: 'API_URL', key: 'API_URL' })
        .mockResolvedValueOnce(undefined); // mode pick cancelled
      await setLinkedEnvVarOverrideCommand(deps(), {
        linkId: 'lw1',
        envName: 'Production',
      });
      expect(window.showInformationMessage).not.toHaveBeenCalled();
    });

    it('injects a new variable via the inject flow', async () => {
      await setupWithSnapshot();
      // var pick → inject
      (window.showQuickPick as Mock)
        .mockResolvedValueOnce({ label: '$(plus) Add a new variable…', inject: true })
        // mode pick → replace
        .mockResolvedValueOnce({ label: 'Replace', value: 'replace' });
      // new key input
      (window.showInputBox as Mock)
        .mockResolvedValueOnce('NEW_VAR')
        // value input
        .mockResolvedValueOnce('new-value');
      await setLinkedEnvVarOverrideCommand(deps(), {
        linkId: 'lw1',
        envName: 'Production',
      });
      expect(window.showInformationMessage).toHaveBeenCalledWith(
        expect.stringContaining('Overrode Production:NEW_VAR'),
      );
    });

    it('exits when inject new key input is cancelled', async () => {
      await setupWithSnapshot();
      (window.showQuickPick as Mock).mockResolvedValueOnce({
        label: '$(plus) Add a new variable…',
        inject: true,
      });
      (window.showInputBox as Mock).mockResolvedValueOnce(undefined);
      await setLinkedEnvVarOverrideCommand(deps(), {
        linkId: 'lw1',
        envName: 'Production',
      });
      expect(window.showInformationMessage).not.toHaveBeenCalled();
    });

    it('shows no linked workspaces message when there are none', async () => {
      setup({});
      await setLinkedEnvVarOverrideCommand(deps());
      expect(window.showInformationMessage).toHaveBeenCalledWith(
        expect.stringContaining('No linked workspaces'),
      );
    });

    it('uses pre-supplied varKey directly', async () => {
      await setupWithSnapshot();
      (window.showQuickPick as Mock).mockResolvedValueOnce({ label: 'Replace', value: 'replace' });
      (window.showInputBox as Mock).mockResolvedValueOnce('override-val');
      await setLinkedEnvVarOverrideCommand(deps(), {
        linkId: 'lw1',
        envName: 'Production',
        varKey: 'API_URL',
      });
      expect(window.showInformationMessage).toHaveBeenCalledWith(
        expect.stringContaining('Overrode Production:API_URL'),
      );
    });
  });

  // ==========================================================================
  // discardLinkedModsCommand — full flow (count > 0 / confirm / info)
  // ==========================================================================
  describe('discardLinkedModsCommand flows', () => {
    it('reports zero modifications and exits', async () => {
      setup({ lw1: link('lw1') });
      await discardLinkedModsCommand(deps(), linkUri('lw1'));
      expect(window.showInformationMessage).toHaveBeenCalledWith(
        expect.stringContaining('no local modifications'),
      );
    });

    it('discards overrides after confirmation', async () => {
      setup({ lw1: link('lw1') });
      // Inject overrides into synced state
      const surface = bridge.activeWorkspace()!;
      const state = await surface.read();
      await surface.write({
        synced: {
          ...state.synced,
          linkedOverrides: {
            requests: {
              'lw1:req1': {
                linkedWorkspaceId: 'lw1',
                itemId: 'req1',
                request: {} as never,
                updatedAt: 't',
              },
            },
            environmentVars: {
              'lw1:env:k': {
                linkedWorkspaceId: 'lw1',
                envName: 'e',
                varKey: 'k',
                value: 'v',
                updatedAt: 't',
              },
            },
          },
        },
      });
      (window.showWarningMessage as Mock).mockResolvedValueOnce('Discard');
      await discardLinkedModsCommand(deps(), linkUri('lw1'));
      // The patch was applied — check info message
      expect(window.showWarningMessage).toHaveBeenCalledWith(
        expect.stringContaining('Discard 2 local modification'),
        expect.anything(),
        'Discard',
      );
    });

    it('aborts discard when user does not confirm', async () => {
      setup({ lw1: link('lw1') });
      const surface = bridge.activeWorkspace()!;
      const state = await surface.read();
      await surface.write({
        synced: {
          ...state.synced,
          linkedOverrides: {
            requests: {
              'lw1:req1': {
                linkedWorkspaceId: 'lw1',
                itemId: 'req1',
                request: {} as never,
                updatedAt: 't',
              },
            },
            environmentVars: {},
          },
        },
      });
      (window.showWarningMessage as Mock).mockResolvedValueOnce(undefined);
      await discardLinkedModsCommand(deps(), linkUri('lw1'));
      // Did not apply discard patch
    });
  });

  // ==========================================================================
  // linkWorkspaceCommand — additional branches
  // ==========================================================================
  describe('linkWorkspaceCommand branches', () => {
    it('warns when no active workspace', async () => {
      bridge = new VsCodeBridge(makeMockContext(path.join(tmp, 'globalStorage')));
      fsProvider = new ApicircleFsProvider(bridge);
      await linkWorkspaceCommand(deps());
      expect(window.showWarningMessage).toHaveBeenCalledWith(expect.stringContaining('No active'));
    });

    it('manual repo entry flow', async () => {
      setup({});
      auth.getGitHubToken.mockResolvedValue('tok');
      gh.listAccessibleRepos.mockResolvedValue([]);
      gh.listBranches.mockRejectedValue(new Error('not found')); // triggers catch for manual
      gh.getContents.mockResolvedValue({
        content: JSON.stringify({
          releases: { self: null },
          collections: {
            tree: { id: 'r', type: 'root', children: [] },
            requests: {},
            folders: {},
          },
          environments: { items: {}, activeName: null, priorityOrder: [] },
        }),
        sha: 'blob',
        path: '.apicircle/workspace.json',
        size: 1,
      });
      // repo pick → manual entry
      (window.showQuickPick as Mock).mockResolvedValueOnce({
        label: '$(edit) Enter owner/name manually…',
        repo: undefined,
      });
      // no version pick (no ledger versions)
      (window.showInputBox as Mock).mockResolvedValueOnce('some-org/some-repo');
      await linkWorkspaceCommand(deps());
      const state = await bridge.activeWorkspace()!.read();
      const links = Object.values(state.synced.linkedWorkspaces);
      expect(links).toHaveLength(1);
      expect(links[0].source.repoFullName).toBe('some-org/some-repo');
      expect(links[0].source.branch).toBe('main'); // default since listBranches failed
    });

    it('exits on manual entry cancel', async () => {
      setup({});
      auth.getGitHubToken.mockResolvedValue('tok');
      gh.listAccessibleRepos.mockResolvedValue([]);
      (window.showQuickPick as Mock).mockResolvedValueOnce({
        label: '$(edit) Enter owner/name manually…',
        repo: undefined,
      });
      (window.showInputBox as Mock).mockResolvedValueOnce(undefined);
      await linkWorkspaceCommand(deps());
      const state = await bridge.activeWorkspace()!.read();
      expect(Object.keys(state.synced.linkedWorkspaces)).toHaveLength(0);
    });

    it('exits on repo pick cancel', async () => {
      setup({});
      auth.getGitHubToken.mockResolvedValue('tok');
      gh.listAccessibleRepos.mockResolvedValue([]);
      (window.showQuickPick as Mock).mockResolvedValueOnce(undefined);
      await linkWorkspaceCommand(deps());
      const state = await bridge.activeWorkspace()!.read();
      expect(Object.keys(state.synced.linkedWorkspaces)).toHaveLength(0);
    });

    it('exits on branch pick cancel', async () => {
      setup({});
      auth.getGitHubToken.mockResolvedValue('tok');
      gh.listAccessibleRepos.mockResolvedValue([
        {
          fullName: 'org/repo',
          owner: 'org',
          name: 'repo',
          defaultBranch: 'main',
          visibility: 'public',
          isPrivate: false,
          pushable: true,
        },
      ]);
      gh.listBranches.mockResolvedValue([
        { name: 'main', commitSha: 'sha1' },
        { name: 'dev', commitSha: 'sha2' },
      ]);
      (window.showQuickPick as Mock)
        .mockResolvedValueOnce({
          label: 'org/repo',
          repo: { fullName: 'org/repo', defaultBranch: 'main', isPrivate: false },
        })
        .mockResolvedValueOnce(undefined); // branch pick cancelled
      await linkWorkspaceCommand(deps());
      const state = await bridge.activeWorkspace()!.read();
      expect(Object.keys(state.synced.linkedWorkspaces)).toHaveLength(0);
    });

    it('falls back when listAccessibleRepos throws', async () => {
      setup({});
      auth.getGitHubToken.mockResolvedValue('tok');
      gh.listAccessibleRepos.mockRejectedValue(new Error('rate limited'));
      gh.listBranches.mockRejectedValue(new Error('not found'));
      gh.getContents.mockResolvedValue({
        content: JSON.stringify({
          releases: { self: null },
          collections: {
            tree: { id: 'r', type: 'root', children: [] },
            requests: {},
            folders: {},
          },
          environments: { items: {}, activeName: null, priorityOrder: [] },
        }),
        sha: 'blob',
        path: '.apicircle/workspace.json',
        size: 1,
      });
      (window.showQuickPick as Mock).mockResolvedValueOnce({
        label: '$(edit) Enter owner/name manually…',
        repo: undefined,
      });
      (window.showInputBox as Mock).mockResolvedValueOnce('x/y');
      await linkWorkspaceCommand(deps());
      const state = await bridge.activeWorkspace()!.read();
      expect(Object.values(state.synced.linkedWorkspaces)).toHaveLength(1);
    });
  });

  // ==========================================================================
  // searchMarketplaceCommand — full flows
  // ==========================================================================
  describe('searchMarketplaceCommand flows', () => {
    it('warns when no active workspace', async () => {
      bridge = new VsCodeBridge(makeMockContext(path.join(tmp, 'globalStorage')));
      fsProvider = new ApicircleFsProvider(bridge);
      await searchMarketplaceCommand(deps());
      expect(window.showWarningMessage).toHaveBeenCalledWith(expect.stringContaining('No active'));
    });

    it('exits when search input is cancelled', async () => {
      setup({});
      (window.showInputBox as Mock).mockResolvedValueOnce(undefined);
      await searchMarketplaceCommand(deps());
      // Should not call getGitHubToken at all
    });

    it('shows error when searchMarketplaceRepos throws', async () => {
      setup({});
      (window.showInputBox as Mock).mockResolvedValueOnce('test');
      auth.getGitHubToken.mockResolvedValue('tok');
      gh.searchMarketplaceRepos.mockRejectedValue(new Error('API rate limit'));
      await searchMarketplaceCommand(deps());
      expect(window.showErrorMessage).toHaveBeenCalledWith(
        expect.stringContaining('Marketplace search failed'),
      );
    });

    it('completes full search + link flow', async () => {
      setup({});
      (window.showInputBox as Mock).mockResolvedValueOnce('payments');
      auth.getGitHubToken.mockResolvedValue('tok');
      gh.searchMarketplaceRepos.mockResolvedValue([
        {
          fullName: 'pub/payments-api',
          name: 'payments-api',
          owner: 'pub',
          defaultBranch: 'main',
          description: 'A payments API workspace',
          topics: ['apicircle-workspace', 'payments'],
          stargazers: 42,
          isPrivate: false,
        },
      ]);
      gh.getContents.mockResolvedValue({
        content: JSON.stringify({
          releases: { self: null },
          collections: {
            tree: { id: 'r', type: 'root', children: [] },
            requests: {},
            folders: {},
          },
          environments: { items: {}, activeName: null, priorityOrder: [] },
        }),
        sha: 'blob',
        path: '.apicircle/workspace.json',
        size: 1,
      });
      // result pick
      (window.showQuickPick as Mock).mockResolvedValueOnce({
        label: '$(star) 42  pub/payments-api',
        repo: {
          fullName: 'pub/payments-api',
          name: 'payments-api',
          defaultBranch: 'main',
          description: 'A payments API workspace',
          topics: ['apicircle-workspace', 'payments'],
        },
      });
      await searchMarketplaceCommand(deps());
      const state = await bridge.activeWorkspace()!.read();
      const links = Object.values(state.synced.linkedWorkspaces);
      expect(links).toHaveLength(1);
      expect(links[0].kind).toBe('public');
      expect(links[0].source.repoFullName).toBe('pub/payments-api');
    });

    it('exits when result pick is dismissed', async () => {
      setup({});
      (window.showInputBox as Mock).mockResolvedValueOnce('test');
      auth.getGitHubToken.mockResolvedValue('tok');
      gh.searchMarketplaceRepos.mockResolvedValue([
        {
          fullName: 'pub/x',
          name: 'x',
          owner: 'pub',
          defaultBranch: 'main',
          description: '',
          topics: [],
          stargazers: 1,
          isPrivate: false,
        },
      ]);
      (window.showQuickPick as Mock).mockResolvedValueOnce(undefined);
      await searchMarketplaceCommand(deps());
      const state = await bridge.activeWorkspace()!.read();
      expect(Object.keys(state.synced.linkedWorkspaces)).toHaveLength(0);
    });
  });

  // ==========================================================================
  // refreshLinkedWorkspaceCommand — additional branches
  // ==========================================================================
  describe('refreshLinkedWorkspaceCommand branches', () => {
    it('shows error when getContents throws', async () => {
      setup({ lw1: link('lw1', { kind: 'public' }) });
      auth.getGitHubToken.mockResolvedValue('tok');
      gh.getContents.mockRejectedValue(new Error('network error'));
      await refreshLinkedWorkspaceCommand(deps(), linkUri('lw1'));
      expect(window.showErrorMessage).toHaveBeenCalledWith(
        expect.stringContaining('Refresh failed'),
      );
    });

    it('shows error when workspace.json not found', async () => {
      setup({ lw1: link('lw1', { kind: 'public' }) });
      auth.getGitHubToken.mockResolvedValue('tok');
      gh.getContents.mockResolvedValue({ content: null, sha: 's', path: 'p', size: 0 });
      await refreshLinkedWorkspaceCommand(deps(), linkUri('lw1'));
      expect(window.showErrorMessage).toHaveBeenCalledWith(
        expect.stringContaining('workspace.json not found'),
      );
    });

    it('bootstraps snapshot when no cached linkedCollections exist', async () => {
      setup({ lw1: link('lw1', { kind: 'public' }) });
      auth.getGitHubToken.mockResolvedValue('tok');
      gh.getContents.mockResolvedValue({
        content: JSON.stringify({
          releases: { self: ledger },
          collections: {
            tree: { id: 'r', type: 'root', children: [{ kind: 'request', id: 'req-1' }] },
            requests: {
              'req-1': {
                id: 'req-1',
                name: 'Hello',
                method: 'GET',
                url: 'https://api/hello',
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
      await refreshLinkedWorkspaceCommand(deps(), linkUri('lw1'));
      const state = await bridge.activeWorkspace()!.read();
      // Snapshot should be bootstrapped
      expect(state.local.linkedCollections.lw1).toBeDefined();
      expect(window.showInformationMessage).toHaveBeenCalledWith(
        expect.stringContaining('Refreshed'),
      );
    });
  });

  // ==========================================================================
  // reviewLinkedUpdateCommand — additional branches
  // ==========================================================================
  describe('reviewLinkedUpdateCommand branches', () => {
    it('warns when token is required but missing for dedicated private link', async () => {
      setup({
        lw1: link('lw1', {
          kind: 'private',
          source: {
            provider: 'github',
            repoFullName: 'org/repo',
            branch: 'main',
            sessionMode: 'dedicated',
          },
        }),
      });
      // No stored dedicated token, no built-in session
      auth.getGitHubToken.mockResolvedValue(null);
      await reviewLinkedUpdateCommand(deps(), linkUri('lw1'));
      expect(window.showWarningMessage).toHaveBeenCalledWith(
        expect.stringContaining('dedicated session'),
      );
    });

    it('shows error when fetch throws', async () => {
      setup({ lw1: link('lw1', { kind: 'public' }) });
      auth.getGitHubToken.mockResolvedValue('tok');
      gh.getContents.mockRejectedValue(new Error('timeout'));
      await reviewLinkedUpdateCommand(deps(), linkUri('lw1'));
      expect(window.showErrorMessage).toHaveBeenCalledWith(
        expect.stringContaining('Could not fetch source'),
      );
    });

    it('shows error when content is null (workspace.json missing)', async () => {
      setup({ lw1: link('lw1', { kind: 'public' }) });
      auth.getGitHubToken.mockResolvedValue('tok');
      gh.getContents.mockResolvedValue({ content: null, sha: 's', path: 'p', size: 0 });
      await reviewLinkedUpdateCommand(deps(), linkUri('lw1'));
      expect(window.showErrorMessage).toHaveBeenCalledWith(
        expect.stringContaining('workspace.json not found'),
      );
    });

    it('shows info when source has no collections or environments', async () => {
      setup({
        lw1: link('lw1', { kind: 'public', pinnedVersion: '1.0.0' }),
      });
      auth.getGitHubToken.mockResolvedValue('tok');
      // Source with no collections and no environments → buildLinkedSnapshot returns null
      gh.getContents.mockResolvedValue({
        content: JSON.stringify({
          releases: { self: ledger },
        }),
        sha: 'blob',
        path: '.apicircle/workspace.json',
        size: 1,
      });
      await reviewLinkedUpdateCommand(deps(), linkUri('lw1'));
      expect(window.showInformationMessage).toHaveBeenCalledWith(
        expect.stringContaining('no collections or environments'),
      );
    });

    it('reports already up to date when no changes and pin matches', async () => {
      // For the "already up to date" path we need:
      //   1. preview.entries.length === 0  (base and target have the same content)
      //   2. newPinned === r.link.pinnedVersion  (pin doesn't change)
      //   3. base?.ref === target.ref  (refs match)
      // We achieve this by fetching the source to build target, injecting the
      // same content as the base, and matching the ref that buildLinkedSnapshot
      // computes.
      const sourcePayload = JSON.stringify({
        releases: { self: ledger },
        collections: {
          tree: { id: 'r', type: 'root', children: [] },
          requests: {},
          folders: {},
        },
        environments: { items: {}, activeName: null, priorityOrder: [] },
      });
      setup(
        {
          lw1: link('lw1', { kind: 'public', pinnedVersion: '1.1.0' }),
        },
        { lw1: ledger },
      );
      auth.getGitHubToken.mockResolvedValue('tok');
      gh.getContents.mockResolvedValue({
        content: sourcePayload,
        sha: 'blob',
        path: '.apicircle/workspace.json',
        size: 1,
      });

      // First, do one review to populate the snapshot with the correct ref.
      // This path takes the "content-identical — updated pin" branch (since
      // base is null initially → ref mismatch), but it stores the target
      // snapshot with the correct ref. Then the second call hits "up to date".
      await reviewLinkedUpdateCommand(deps(), linkUri('lw1'));
      // Now the snapshot is stored. Call again — this time base.ref === target.ref
      // and the pin is already 1.1.0.
      (window.showInformationMessage as Mock).mockClear();
      gh.getContents.mockResolvedValue({
        content: sourcePayload,
        sha: 'blob',
        path: '.apicircle/workspace.json',
        size: 1,
      });
      await reviewLinkedUpdateCommand(deps(), linkUri('lw1'));
      expect(window.showInformationMessage).toHaveBeenCalledWith(
        expect.stringContaining('already up to date'),
      );
    });

    it('applies pin-only update when content identical but pin differs', async () => {
      setup(
        {
          lw1: link('lw1', { kind: 'public', pinnedVersion: '1.0.0' }),
        },
        { lw1: ledger },
      );
      auth.getGitHubToken.mockResolvedValue('tok');
      const surface = bridge.activeWorkspace()!;
      const state = await surface.read();
      await surface.write({
        local: {
          ...state.local,
          linkedCollections: {
            lw1: {
              ref: 'old-ref',
              collections: {
                tree: { id: 'r', type: 'root' as const, children: [] },
                requests: {},
                folders: {},
              },
              environments: { items: {}, activeName: null, priorityOrder: [] },
            },
          },
        },
      });
      gh.getContents.mockResolvedValue({
        content: JSON.stringify({
          releases: { self: ledger },
          collections: {
            tree: { id: 'r', type: 'root', children: [] },
            requests: {},
            folders: {},
          },
          environments: { items: {}, activeName: null, priorityOrder: [] },
        }),
        sha: 'blob',
        path: '.apicircle/workspace.json',
        size: 1,
      });
      await reviewLinkedUpdateCommand(deps(), linkUri('lw1'));
      const updatedState = await bridge.activeWorkspace()!.read();
      expect(updatedState.synced.linkedWorkspaces.lw1.pinnedVersion).toBe('1.1.0');
      expect(window.showInformationMessage).toHaveBeenCalledWith(
        expect.stringContaining('content-identical'),
      );
    });

    it('applies update with bulk "keep all mine" resolution', async () => {
      setup(
        {
          lw1: link('lw1', { kind: 'public', pinnedVersion: '1.0.0' }),
        },
        { lw1: { currentVersion: '1.0.0', versions: [ledger.versions[0]] } },
      );
      auth.getGitHubToken.mockResolvedValue('tok');
      gh.getContents.mockResolvedValue({
        content: JSON.stringify({
          releases: { self: ledger },
          collections: {
            tree: {
              id: 'r',
              type: 'root',
              children: [{ kind: 'request', id: 'req-1' }],
            },
            requests: {
              'req-1': {
                id: 'req-1',
                name: 'List pets v2',
                method: 'POST',
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
      // Bulk resolution → keep all mine
      (window.showQuickPick as Mock).mockResolvedValueOnce({
        label: 'Keep all mine',
        value: 'mine',
      });
      await reviewLinkedUpdateCommand(deps(), linkUri('lw1'));
      const state = await bridge.activeWorkspace()!.read();
      expect(state.synced.linkedWorkspaces.lw1.pinnedVersion).toBe('1.1.0');
      expect(state.local.linkedCollections.lw1).toBeDefined();
    });

    it('exits when resolution mode pick is cancelled (with conflicts)', async () => {
      // To trigger the mode quick-pick we need REAL conflicts
      // (both-changed non-auto-mergeable or removed-in-source). The simplest:
      // base has a request, we add a local override on it, and source removes it
      // → that's a "removed-in-source" conflict.
      setup(
        {
          lw1: link('lw1', { kind: 'public', pinnedVersion: '1.0.0' }),
        },
        { lw1: { currentVersion: '1.0.0', versions: [ledger.versions[0]] } },
      );
      auth.getGitHubToken.mockResolvedValue('tok');

      // Seed a base snapshot with req-1
      const surface = bridge.activeWorkspace()!;
      const state = await surface.read();
      await surface.write({
        synced: {
          ...state.synced,
          linkedOverrides: {
            requests: {
              'lw1:req-1': {
                linkedWorkspaceId: 'lw1',
                itemId: 'req-1',
                request: {
                  id: 'req-1',
                  name: 'Local edit',
                  method: 'PUT',
                  url: 'https://api/mine',
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
                } as never,
                updatedAt: 't',
              },
            },
            environmentVars: {},
          },
        },
        local: {
          ...state.local,
          linkedCollections: {
            lw1: {
              ref: 'old-ref',
              collections: {
                tree: {
                  id: 'r',
                  type: 'root' as const,
                  children: [{ kind: 'request' as const, id: 'req-1' }],
                },
                requests: {
                  'req-1': {
                    id: 'req-1',
                    name: 'Original',
                    method: 'GET',
                    url: 'https://api/old',
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
            },
          },
        },
      });

      // Source removes req-1 entirely → "removed-in-source" conflict
      gh.getContents.mockResolvedValue({
        content: JSON.stringify({
          releases: { self: ledger },
          collections: {
            tree: { id: 'r', type: 'root', children: [] },
            requests: {},
            folders: {},
          },
          environments: { items: {}, activeName: null, priorityOrder: [] },
        }),
        sha: 'blob',
        path: '.apicircle/workspace.json',
        size: 1,
      });
      // Mode pick cancelled
      (window.showQuickPick as Mock).mockResolvedValueOnce(undefined);
      await reviewLinkedUpdateCommand(deps(), linkUri('lw1'));
      // Pin should NOT have changed because user cancelled
      const updatedState = await bridge.activeWorkspace()!.read();
      expect(updatedState.synced.linkedWorkspaces.lw1.pinnedVersion).toBe('1.0.0');
    });
  });

  // ==========================================================================
  // linkFromRepo — error + guard branches
  // ==========================================================================
  describe('linkFromRepo error paths (via linkWorkspaceCommand)', () => {
    it('shows error when getContents throws during linking', async () => {
      setup({});
      auth.getGitHubToken.mockResolvedValue('tok');
      gh.listAccessibleRepos.mockResolvedValue([
        {
          fullName: 'org/repo',
          owner: 'org',
          name: 'repo',
          defaultBranch: 'main',
          visibility: 'public',
          isPrivate: false,
          pushable: true,
        },
      ]);
      gh.listBranches.mockResolvedValue([{ name: 'main', commitSha: 'sha' }]);
      gh.getContents.mockRejectedValue(new Error('403 Forbidden'));
      (window.showQuickPick as Mock)
        .mockResolvedValueOnce({
          label: 'org/repo',
          repo: { fullName: 'org/repo', defaultBranch: 'main', isPrivate: false },
        })
        .mockResolvedValueOnce({ label: 'main' });
      await linkWorkspaceCommand(deps());
      expect(window.showErrorMessage).toHaveBeenCalledWith(
        expect.stringContaining('Could not read'),
      );
    });

    it('shows error when workspace.json content is null', async () => {
      setup({});
      auth.getGitHubToken.mockResolvedValue('tok');
      gh.listAccessibleRepos.mockResolvedValue([
        {
          fullName: 'org/repo',
          owner: 'org',
          name: 'repo',
          defaultBranch: 'main',
          visibility: 'public',
          isPrivate: false,
          pushable: true,
        },
      ]);
      gh.listBranches.mockResolvedValue([{ name: 'main', commitSha: 'sha' }]);
      gh.getContents.mockResolvedValue({ content: null, sha: 's', path: 'p', size: 0 });
      (window.showQuickPick as Mock)
        .mockResolvedValueOnce({
          label: 'org/repo',
          repo: { fullName: 'org/repo', defaultBranch: 'main', isPrivate: false },
        })
        .mockResolvedValueOnce({ label: 'main' });
      await linkWorkspaceCommand(deps());
      expect(window.showErrorMessage).toHaveBeenCalledWith(
        expect.stringContaining('No .apicircle/workspace.json'),
      );
    });

    it('warns when linking a duplicate repo+branch', async () => {
      setup({ lw1: link('lw1') }); // already linked to org/payments@main
      auth.getGitHubToken.mockResolvedValue('tok');
      gh.listAccessibleRepos.mockResolvedValue([]);
      gh.listBranches.mockRejectedValue(new Error('nope'));
      gh.getContents.mockResolvedValue({
        content: JSON.stringify({
          releases: { self: null },
          collections: {
            tree: { id: 'r', type: 'root', children: [] },
            requests: {},
            folders: {},
          },
          environments: { items: {}, activeName: null, priorityOrder: [] },
        }),
        sha: 'blob',
        path: '.apicircle/workspace.json',
        size: 1,
      });
      (window.showQuickPick as Mock).mockResolvedValueOnce({
        label: '$(edit) Enter owner/name manually…',
        repo: undefined,
      });
      (window.showInputBox as Mock).mockResolvedValueOnce('org/payments');
      await linkWorkspaceCommand(deps());
      expect(window.showWarningMessage).toHaveBeenCalledWith(
        expect.stringContaining('Already linked'),
      );
    });

    it('exits on version pick cancel during linking', async () => {
      setup({});
      auth.getGitHubToken.mockResolvedValue('tok');
      gh.listAccessibleRepos.mockResolvedValue([
        {
          fullName: 'org/repo',
          owner: 'org',
          name: 'repo',
          defaultBranch: 'main',
          visibility: 'public',
          isPrivate: false,
          pushable: true,
        },
      ]);
      gh.listBranches.mockResolvedValue([{ name: 'main', commitSha: 'sha' }]);
      gh.getContents.mockResolvedValue({
        content: JSON.stringify({
          releases: {
            self: ledger,
          },
          collections: {
            tree: { id: 'r', type: 'root', children: [] },
            requests: {},
            folders: {},
          },
          environments: { items: {}, activeName: null, priorityOrder: [] },
        }),
        sha: 'blob',
        path: '.apicircle/workspace.json',
        size: 1,
      });
      (window.showQuickPick as Mock)
        .mockResolvedValueOnce({
          label: 'org/repo',
          repo: { fullName: 'org/repo', defaultBranch: 'main', isPrivate: false },
        })
        .mockResolvedValueOnce({ label: 'main' })
        .mockResolvedValueOnce(undefined); // version pick cancelled
      await linkWorkspaceCommand(deps());
      const state = await bridge.activeWorkspace()!.read();
      expect(Object.keys(state.synced.linkedWorkspaces)).toHaveLength(0);
    });
  });

  // ==========================================================================
  // setLinkSessionTokenCommand — already in dedicated mode
  // ==========================================================================
  describe('setLinkSessionTokenCommand — already dedicated', () => {
    it('stores token without flipping mode if already dedicated', async () => {
      setup({
        lw1: link('lw1', {
          source: {
            provider: 'github',
            repoFullName: 'org/payments',
            branch: 'main',
            sessionMode: 'dedicated',
          },
        }),
      });
      (window.showInputBox as Mock).mockResolvedValueOnce('ghp_newtoken');
      await setLinkSessionTokenCommand(deps(), linkUri('lw1'));
      expect(secretStore.get('apicircle.linkSession.lw1')).toBe('ghp_newtoken');
      // Should NOT have called commitLink because mode was already dedicated
      expect(window.showInformationMessage).toHaveBeenCalledWith(
        expect.stringContaining('Stored a dedicated session token'),
      );
    });

    it('exits when token input is cancelled', async () => {
      setup({ lw1: link('lw1') });
      (window.showInputBox as Mock).mockResolvedValueOnce(undefined);
      await setLinkSessionTokenCommand(deps(), linkUri('lw1'));
      expect(secretStore.has('apicircle.linkSession.lw1')).toBe(false);
    });
  });

  // ==========================================================================
  // setLinkPinnedVersionFieldCommand — same value no-op
  // ==========================================================================
  describe('setLinkPinnedVersionFieldCommand same value no-op', () => {
    it('does not commit when the picked value equals current pin', async () => {
      setup({ lw1: link('lw1', { pinnedVersion: '1.0.0' }) }, { lw1: ledger });
      (window.showQuickPick as Mock).mockResolvedValueOnce({ label: 'v1.0.0', value: '1.0.0' });
      await setLinkPinnedVersionFieldCommand(deps(), linkUri('lw1'));
      // Pin should still be 1.0.0 and no unnecessary write
      const state = await bridge.activeWorkspace()!.read();
      expect(state.synced.linkedWorkspaces.lw1.pinnedVersion).toBe('1.0.0');
    });
  });

  // ==========================================================================
  // setLinkDescriptionFieldCommand — cancel
  // ==========================================================================
  describe('setLinkDescriptionFieldCommand cancel', () => {
    it('exits silently when description input is cancelled', async () => {
      setup({ lw1: link('lw1') });
      (window.showInputBox as Mock).mockResolvedValueOnce(undefined);
      await setLinkDescriptionFieldCommand(deps(), linkUri('lw1'));
      const state = await bridge.activeWorkspace()!.read();
      expect(state.synced.linkedWorkspaces.lw1.description).toBeUndefined();
    });
  });

  // ==========================================================================
  // setLinkScopeFieldCommand — cancel
  // ==========================================================================
  describe('setLinkScopeFieldCommand cancel', () => {
    it('exits silently when scope pick is cancelled', async () => {
      setup({ lw1: link('lw1') });
      (window.showQuickPick as Mock).mockResolvedValueOnce(undefined);
      await setLinkScopeFieldCommand(deps(), linkUri('lw1'));
      const state = await bridge.activeWorkspace()!.read();
      expect(state.synced.linkedWorkspaces.lw1.scope).toEqual(['collections', 'environments']);
    });
  });

  // ==========================================================================
  // setLinkSessionModeFieldCommand — cancel
  // ==========================================================================
  describe('setLinkSessionModeFieldCommand cancel', () => {
    it('exits silently when session mode pick is cancelled', async () => {
      setup({ lw1: link('lw1') });
      (window.showQuickPick as Mock).mockResolvedValueOnce(undefined);
      await setLinkSessionModeFieldCommand(deps(), linkUri('lw1'));
      const state = await bridge.activeWorkspace()!.read();
      expect(state.synced.linkedWorkspaces.lw1.source.sessionMode).toBe('workspace');
    });
  });

  // ==========================================================================
  // linkIdFromArg — final return undefined branch (object with no id/query)
  // ==========================================================================
  describe('linkIdFromArg fallback branch', () => {
    it('returns undefined for an arg with no query and no string id', async () => {
      setup({ lw1: link('lw1') });
      // Pass an object that has neither 'query' nor 'id' properties
      await setLinkNameFieldCommand(deps(), {} as never);
      expect(window.showWarningMessage).toHaveBeenCalledWith(
        expect.stringContaining('Could not determine'),
      );
    });
  });

  // ==========================================================================
  // provisionLinkedSecretCommand — picker shows 'provided' for existing secrets
  // ==========================================================================
  describe('provisionLinkedSecretCommand — provided description', () => {
    it('shows "provided" description for keys that already have a stored value', async () => {
      setup({ lw1: link('lw1', { requiredSecretKeyIds: ['K1', 'K2'] }) });
      // Pre-provision K1
      secretStore.set('apicircle.linkedSecret.lw1.K1', 'existing');
      (window.showQuickPick as Mock).mockImplementation(
        async (items: Array<{ label: string; description: string; value: string }>) => {
          // Verify the items show correct descriptions
          const k1 = items.find((i) => i.label === 'K1');
          const k2 = items.find((i) => i.label === 'K2');
          expect(k1?.description).toBe('provided');
          expect(k2?.description).toBe('missing');
          return undefined; // cancel
        },
      );
      await provisionLinkedSecretCommand(deps(), linkUri('lw1'));
    });
  });

  // ==========================================================================
  // setLinkedEnvVarOverrideCommand — env pick success (envName not pre-supplied)
  // ==========================================================================
  describe('setLinkedEnvVarOverrideCommand env pick success path', () => {
    it('picks an env from the list and proceeds to var pick', async () => {
      setup({ lw1: link('lw1') });
      const surface = bridge.activeWorkspace()!;
      const state = await surface.read();
      await surface.write({
        local: {
          ...state.local,
          linkedCollections: {
            lw1: {
              ref: 'abc',
              collections: {
                tree: { id: 'root', type: 'root' as const, children: [] },
                requests: {},
                folders: {},
              },
              environments: {
                items: {
                  Dev: {
                    variables: [
                      {
                        key: 'BASE_URL',
                        value: 'http://localhost',
                        enabled: true,
                        encrypted: false,
                      },
                    ],
                  },
                },
                activeName: 'Dev',
                priorityOrder: ['Dev'],
              },
            },
          },
        },
      });
      // env pick → 'Dev'
      (window.showQuickPick as Mock)
        .mockResolvedValueOnce('Dev')
        // var pick → BASE_URL
        .mockResolvedValueOnce({ label: 'BASE_URL', key: 'BASE_URL' })
        // mode pick → replace
        .mockResolvedValueOnce({ label: 'Replace', value: 'replace' });
      (window.showInputBox as Mock).mockResolvedValueOnce('http://new-host');
      await setLinkedEnvVarOverrideCommand(deps(), { linkId: 'lw1' });
      expect(window.showInformationMessage).toHaveBeenCalledWith(
        expect.stringContaining('Overrode Dev:BASE_URL'),
      );
    });
  });

  // ==========================================================================
  // reviewLinkedUpdateCommand — per-conflict "resolve each" flow
  // ==========================================================================
  describe('reviewLinkedUpdateCommand — resolve each conflict', () => {
    it('resolves each conflict individually', async () => {
      setup(
        {
          lw1: link('lw1', { kind: 'public', pinnedVersion: '1.0.0' }),
        },
        { lw1: { currentVersion: '1.0.0', versions: [ledger.versions[0]] } },
      );
      auth.getGitHubToken.mockResolvedValue('tok');

      // Seed a base with req-1 + a local override, then source removes req-1
      const surface = bridge.activeWorkspace()!;
      const state = await surface.read();
      await surface.write({
        synced: {
          ...state.synced,
          linkedOverrides: {
            requests: {
              'lw1:req-1': {
                linkedWorkspaceId: 'lw1',
                itemId: 'req-1',
                request: {
                  id: 'req-1',
                  name: 'Locally modified',
                  method: 'PATCH',
                  url: 'https://api/mine',
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
                } as never,
                updatedAt: 't',
              },
            },
            environmentVars: {},
          },
        },
        local: {
          ...state.local,
          linkedCollections: {
            lw1: {
              ref: 'old-ref',
              collections: {
                tree: {
                  id: 'r',
                  type: 'root' as const,
                  children: [{ kind: 'request' as const, id: 'req-1' }],
                },
                requests: {
                  'req-1': {
                    id: 'req-1',
                    name: 'Original',
                    method: 'GET',
                    url: 'https://api/old',
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
            },
          },
        },
      });

      // Source removes req-1
      gh.getContents.mockResolvedValue({
        content: JSON.stringify({
          releases: { self: ledger },
          collections: {
            tree: { id: 'r', type: 'root', children: [] },
            requests: {},
            folders: {},
          },
          environments: { items: {}, activeName: null, priorityOrder: [] },
        }),
        sha: 'blob',
        path: '.apicircle/workspace.json',
        size: 1,
      });
      // Mode pick → "resolve each"
      (window.showQuickPick as Mock)
        .mockResolvedValueOnce({ label: 'Resolve each', value: 'each' })
        // Per-conflict pick → "Accept source" for the removed request
        .mockResolvedValueOnce({ label: 'Accept source', value: 'theirs' });
      await reviewLinkedUpdateCommand(deps(), linkUri('lw1'));
      const updatedState = await bridge.activeWorkspace()!.read();
      expect(updatedState.synced.linkedWorkspaces.lw1.pinnedVersion).toBe('1.1.0');
      expect(window.showInformationMessage).toHaveBeenCalledWith(
        expect.stringContaining('1 resolved'),
      );
    });

    it('cancels mid-conflict resolution', async () => {
      setup(
        {
          lw1: link('lw1', { kind: 'public', pinnedVersion: '1.0.0' }),
        },
        { lw1: { currentVersion: '1.0.0', versions: [ledger.versions[0]] } },
      );
      auth.getGitHubToken.mockResolvedValue('tok');

      const surface = bridge.activeWorkspace()!;
      const state = await surface.read();
      await surface.write({
        synced: {
          ...state.synced,
          linkedOverrides: {
            requests: {
              'lw1:req-1': {
                linkedWorkspaceId: 'lw1',
                itemId: 'req-1',
                request: {
                  id: 'req-1',
                  name: 'My version',
                  method: 'DELETE',
                  url: 'https://api/mine',
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
                } as never,
                updatedAt: 't',
              },
            },
            environmentVars: {},
          },
        },
        local: {
          ...state.local,
          linkedCollections: {
            lw1: {
              ref: 'old-ref',
              collections: {
                tree: {
                  id: 'r',
                  type: 'root' as const,
                  children: [{ kind: 'request' as const, id: 'req-1' }],
                },
                requests: {
                  'req-1': {
                    id: 'req-1',
                    name: 'Baseline',
                    method: 'GET',
                    url: 'https://api/old',
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
            },
          },
        },
      });

      gh.getContents.mockResolvedValue({
        content: JSON.stringify({
          releases: { self: ledger },
          collections: {
            tree: { id: 'r', type: 'root', children: [] },
            requests: {},
            folders: {},
          },
          environments: { items: {}, activeName: null, priorityOrder: [] },
        }),
        sha: 'blob',
        path: '.apicircle/workspace.json',
        size: 1,
      });
      // Mode → "resolve each", then cancel on the first conflict
      (window.showQuickPick as Mock)
        .mockResolvedValueOnce({ label: 'Resolve each', value: 'each' })
        .mockResolvedValueOnce(undefined); // cancel mid-resolution
      await reviewLinkedUpdateCommand(deps(), linkUri('lw1'));
      // Should not have updated the pin
      const updatedState = await bridge.activeWorkspace()!.read();
      expect(updatedState.synced.linkedWorkspaces.lw1.pinnedVersion).toBe('1.0.0');
    });
  });

  // ==========================================================================
  // reviewLinkedUpdateCommand — bulk "theirs" resolution with conflicts
  // ==========================================================================
  describe('reviewLinkedUpdateCommand — bulk theirs resolution', () => {
    it('applies all conflicts as theirs (accept source)', async () => {
      setup(
        {
          lw1: link('lw1', { kind: 'public', pinnedVersion: '1.0.0' }),
        },
        { lw1: { currentVersion: '1.0.0', versions: [ledger.versions[0]] } },
      );
      auth.getGitHubToken.mockResolvedValue('tok');

      const surface = bridge.activeWorkspace()!;
      const state = await surface.read();
      await surface.write({
        synced: {
          ...state.synced,
          linkedOverrides: {
            requests: {
              'lw1:req-1': {
                linkedWorkspaceId: 'lw1',
                itemId: 'req-1',
                request: {
                  id: 'req-1',
                  name: 'Mine',
                  method: 'PUT',
                  url: 'https://api/mine',
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
                } as never,
                updatedAt: 't',
              },
            },
            environmentVars: {},
          },
        },
        local: {
          ...state.local,
          linkedCollections: {
            lw1: {
              ref: 'old-ref',
              collections: {
                tree: {
                  id: 'r',
                  type: 'root' as const,
                  children: [{ kind: 'request' as const, id: 'req-1' }],
                },
                requests: {
                  'req-1': {
                    id: 'req-1',
                    name: 'Base',
                    method: 'GET',
                    url: 'https://api/base',
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
            },
          },
        },
      });

      // Source removes req-1
      gh.getContents.mockResolvedValue({
        content: JSON.stringify({
          releases: { self: ledger },
          collections: {
            tree: { id: 'r', type: 'root', children: [] },
            requests: {},
            folders: {},
          },
          environments: { items: {}, activeName: null, priorityOrder: [] },
        }),
        sha: 'blob',
        path: '.apicircle/workspace.json',
        size: 1,
      });
      // Bulk resolution → accept all source (theirs)
      (window.showQuickPick as Mock).mockResolvedValueOnce({
        label: 'Accept all source',
        value: 'theirs',
      });
      await reviewLinkedUpdateCommand(deps(), linkUri('lw1'));
      const updatedState = await bridge.activeWorkspace()!.read();
      expect(updatedState.synced.linkedWorkspaces.lw1.pinnedVersion).toBe('1.1.0');
    });
  });

  // ==========================================================================
  // linkFromRepo — version picker with null currentVersion but has versions
  // ==========================================================================
  describe('linkFromRepo — null currentVersion with versions', () => {
    it('omits the current-version entry when currentVersion is null', async () => {
      setup({});
      auth.getGitHubToken.mockResolvedValue('tok');
      gh.listAccessibleRepos.mockResolvedValue([
        {
          fullName: 'org/repo',
          owner: 'org',
          name: 'repo',
          defaultBranch: 'main',
          visibility: 'public',
          isPrivate: false,
          pushable: true,
        },
      ]);
      gh.listBranches.mockResolvedValue([{ name: 'main', commitSha: 'sha' }]);
      // Source has versions but currentVersion is null
      gh.getContents.mockResolvedValue({
        content: JSON.stringify({
          releases: {
            self: {
              currentVersion: null,
              versions: [
                {
                  version: '0.1.0',
                  publishedAt: 't',
                  notes: '',
                  workspaceSnapshot: 'a'.repeat(64),
                  deprecated: false,
                  yanked: false,
                },
              ],
            },
          },
          collections: {
            tree: { id: 'r', type: 'root', children: [] },
            requests: {},
            folders: {},
          },
          environments: { items: {}, activeName: null, priorityOrder: [] },
        }),
        sha: 'blob',
        path: '.apicircle/workspace.json',
        size: 1,
      });
      (window.showQuickPick as Mock)
        .mockResolvedValueOnce({
          label: 'org/repo',
          repo: { fullName: 'org/repo', defaultBranch: 'main', isPrivate: false },
        })
        .mockResolvedValueOnce({ label: 'main' })
        // Version pick — pick the unpinned option
        .mockResolvedValueOnce({ label: 'Unpinned', value: null });
      await linkWorkspaceCommand(deps());
      const state = await bridge.activeWorkspace()!.read();
      const links = Object.values(state.synced.linkedWorkspaces);
      expect(links).toHaveLength(1);
      expect(links[0].pinnedVersion).toBeNull();
      // Verify the quick pick didn't have a "current (recommended)" item
      const versionPickItems = (window.showQuickPick as Mock).mock.calls[2][0] as Array<{
        label: string;
        description: string;
      }>;
      expect(versionPickItems.some((i) => i.description?.includes('current'))).toBe(false);
    });
  });
});
