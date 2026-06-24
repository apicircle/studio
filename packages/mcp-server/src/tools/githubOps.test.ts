import { beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  LinkedWorkspace,
  ReleaseHistory,
  WorkspaceLocal,
  WorkspaceSynced,
} from '@apicircle/shared';
import { InMemoryWorkspaceProvider } from '../providers/InMemoryWorkspaceProvider';
import { SingleWorkspaceAdapter } from '../providers/Workspaces';
import { InProcessMockController } from '../providers/InProcessMockController';

const gh = {
  getContents: vi.fn(),
  getRepo: vi.fn(),
  getRef: vi.fn(),
  getTagSha: vi.fn(),
  deleteRef: vi.fn(),
  createTag: vi.fn(),
  createRelease: vi.fn(),
  setRepoTopics: vi.fn(),
  searchMarketplaceRepos: vi.fn(),
};
vi.mock('@apicircle/git', () => ({
  getGitProvider: () => gh,
  GitHubError: class extends Error {},
}));

import {
  linkedLinkTool,
  linkedRefreshTool,
  marketplaceSearchTool,
  releaseTagTool,
  repoSetTopicsTool,
} from './githubOps';

const T0 = '2026-06-06T00:00:00.000Z';
const ledger: ReleaseHistory = {
  currentVersion: '1.1.0',
  versions: [
    {
      version: '1.0.0',
      publishedAt: T0,
      notes: '',
      workspaceSnapshot: 'a'.repeat(64),
      deprecated: false,
      yanked: false,
    },
    {
      version: '1.1.0',
      publishedAt: T0,
      notes: '',
      workspaceSnapshot: 'b'.repeat(64),
      deprecated: false,
      yanked: false,
    },
  ],
};

function freshState(links: Record<string, LinkedWorkspace> = {}): {
  synced: WorkspaceSynced;
  local: WorkspaceLocal;
} {
  return {
    synced: {
      schemaVersion: 1,
      workspaceId: 'ws-1',
      collections: { tree: { id: 'r', type: 'root', children: [] }, requests: {}, folders: {} },
      environments: { items: {}, activeName: null, priorityOrder: [] },
      linkedWorkspaces: links,
      linkedOverrides: { requests: {}, environmentVars: {} },
      releases: { self: null, perLink: {} },
      globalAssets: { schemas: {}, graphql: {} },
      mockServers: {},
      meta: { createdAt: T0, updatedAt: T0, appVersion: '0.1.0' },
    },
    local: {
      schemaVersion: 1,
      workspaceId: 'ws-1',
      executionPlans: {},
      history: { requestRuns: [], planRuns: [] },
      secretIndex: { entries: {} },
      sessions: { github: { workspace: null, links: {} } },
      connectedRepo: null,
      workingBranch: null,
      seededWorkspaceSha: null,
      retiredBranch: null,
      sync: { lastPulledSnapshot: null, lastPulledSha: null, lastPulledAt: null, dirtyKeys: [] },
      linkedCollections: {},
      globalContext: {},
      mockRuntime: { active: {} },
      ui: {
        activeRequestId: null,
        sidebarExpandedSections: [],
        themeId: 'studio-dark',
        fontId: 'system-mono',
        fontSizePercent: 100,
      },
      settings: { validateOnSend: true, monacoConsumesWheel: false },
      snapshots: { entries: [], maxBytes: 50 * 1024 * 1024 },
    },
  };
}

let ctx: {
  workspace: InMemoryWorkspaceProvider;
  workspaces: SingleWorkspaceAdapter;
  mock: InProcessMockController;
};
function setup(links: Record<string, LinkedWorkspace> = {}) {
  const workspace = new InMemoryWorkspaceProvider(freshState(links));
  ctx = {
    workspace,
    workspaces: new SingleWorkspaceAdapter(workspace, 'ws-test'),
    mock: new InProcessMockController(),
  };
}

beforeEach(() => {
  for (const m of Object.values(gh)) m.mockReset();
  delete process.env.GITHUB_TOKEN;
  setup();
});

function mockRemoteRepo(workspaceContent: object, wsId = 'remote-ws-1') {
  const registry = JSON.stringify({
    schemaVersion: 1,
    activeWorkspaceId: wsId,
    workspaces: [{ id: wsId, name: 'Remote', createdAt: 't', lastOpenedAt: 't' }],
  });
  const wsJson = JSON.stringify(workspaceContent);
  gh.getContents.mockImplementation(
    (_tok: string, _o: string, _n: string, p: string, _b: string) => {
      if (p.endsWith('registry.json'))
        return Promise.resolve({ content: registry, sha: 'r', path: p, size: 1 });
      if (p.endsWith('workspace.json'))
        return Promise.resolve({ content: wsJson, sha: 'w', path: p, size: 1 });
      return Promise.resolve(null);
    },
  );
}

describe('linked.link', () => {
  it('links a repo from the fetched workspace.json', async () => {
    mockRemoteRepo({
      releases: { self: ledger },
      collections: { tree: { id: 'r', type: 'root', children: [] }, requests: {}, folders: {} },
      environments: { items: {}, activeName: null, priorityOrder: [] },
      secretKeys: { K: { id: 'K', label: 'Key', salt: 's', createdAt: 't' } },
    });
    const out = (await linkedLinkTool.handler(
      { repoFullName: 'org/payments', branch: 'main', kind: 'private', token: 'tok' },
      ctx,
    )) as { ok: boolean; id: string; pinnedVersion: string };
    expect(out.ok).toBe(true);
    expect(out.pinnedVersion).toBe('1.1.0');
    const state = await ctx.workspace.read();
    const link = state.synced.linkedWorkspaces[out.id];
    expect(link.requiredSecretKeyIds).toEqual(['K']);
    expect(state.synced.releases.perLink[out.id].currentVersion).toBe('1.1.0');
    expect(state.local.linkedCollections[out.id]).toBeDefined();
  });

  it('requires a token for private repos', async () => {
    const out = (await linkedLinkTool.handler({ repoFullName: 'o/n', kind: 'private' }, ctx)) as {
      ok: boolean;
      error: string;
    };
    expect(out.ok).toBe(false);
    expect(out.error).toMatch(/token is required/);
  });

  it('falls back to GITHUB_TOKEN env', async () => {
    process.env.GITHUB_TOKEN = 'env-tok';
    mockRemoteRepo({ releases: { self: ledger } });
    const out = (await linkedLinkTool.handler(
      { repoFullName: 'o/n', kind: 'private', branch: 'main' },
      ctx,
    )) as { ok: boolean };
    expect(out.ok).toBe(true);
    expect(gh.getContents).toHaveBeenCalledWith('env-tok', 'o', 'n', expect.any(String), 'main');
  });

  it('rejects a duplicate repo+branch', async () => {
    setup({
      lw1: {
        id: 'lw1',
        kind: 'public',
        name: 'x',
        sourceWorkspaceId: 'remote-ws-1',
        source: {
          provider: 'github',
          repoFullName: 'o/n',
          branch: 'main',
          sessionMode: 'workspace',
        },
        scope: ['collections'],
        pinnedVersion: null,
        updatePolicy: 'manual',
        linkedAt: T0,
        requiredSecretKeyIds: [],
      },
    });
    const out = (await linkedLinkTool.handler(
      { repoFullName: 'o/n', kind: 'public', token: 't', branch: 'main' },
      ctx,
    )) as { ok: boolean; error: string };
    expect(out.ok).toBe(false);
    expect(out.error).toMatch(/Already linked/);
  });
});

describe('linked.refresh', () => {
  it('re-pulls the ledger', async () => {
    setup({
      lw1: {
        id: 'lw1',
        kind: 'public',
        name: 'x',
        sourceWorkspaceId: 'remote-ws-1',
        source: {
          provider: 'github',
          repoFullName: 'o/n',
          branch: 'main',
          sessionMode: 'workspace',
        },
        scope: ['collections'],
        pinnedVersion: null,
        updatePolicy: 'manual',
        linkedAt: T0,
        requiredSecretKeyIds: [],
      },
    });
    mockRemoteRepo({ releases: { self: ledger } }, 'remote-ws-1');
    const out = (await linkedRefreshTool.handler({ id: 'lw1' }, ctx)) as {
      ok: boolean;
      currentVersion: string;
    };
    expect(out.ok).toBe(true);
    expect(out.currentVersion).toBe('1.1.0');
    const state = await ctx.workspace.read();
    expect(state.synced.releases.perLink.lw1.versions).toHaveLength(2);
  });
});

describe('release.tag', () => {
  it('tags the default branch HEAD (+ optional release)', async () => {
    gh.getRepo.mockResolvedValue({
      fullName: 'o/n',
      owner: 'o',
      name: 'n',
      defaultBranch: 'main',
      visibility: 'public',
      isPrivate: false,
      pushable: true,
    });
    gh.getRef.mockResolvedValue({ ref: 'refs/heads/main', sha: 'deadbeef' });
    gh.getTagSha.mockResolvedValue(null);
    gh.createTag.mockResolvedValue({ ref: 'refs/tags/v1.1.0', sha: 'deadbeef' });
    gh.createRelease.mockResolvedValue({
      id: 1,
      htmlUrl: 'https://gh/releases/1',
      tagName: 'v1.1.0',
    });
    const out = (await releaseTagTool.handler(
      { owner: 'o', name: 'n', version: '1.1.0', createGitHubRelease: true, token: 'tok' },
      ctx,
    )) as { ok: boolean; tagName: string; releaseUrl?: string };
    expect(out.ok).toBe(true);
    expect(out.tagName).toBe('v1.1.0');
    expect(out.releaseUrl).toBe('https://gh/releases/1');
    expect(gh.createTag).toHaveBeenCalledWith('tok', 'o', 'n', {
      tagName: 'v1.1.0',
      sha: 'deadbeef',
    });
  });

  it('refuses to overwrite an existing tag unless overrideExisting', async () => {
    gh.getRepo.mockResolvedValue({
      fullName: 'o/n',
      owner: 'o',
      name: 'n',
      defaultBranch: 'main',
      visibility: 'public',
      isPrivate: false,
      pushable: true,
    });
    gh.getRef.mockResolvedValue({ ref: 'refs/heads/main', sha: 'sha' });
    gh.getTagSha.mockResolvedValue('existingsha');
    const out = (await releaseTagTool.handler(
      { owner: 'o', name: 'n', version: '1.0.0', token: 'tok' },
      ctx,
    )) as { ok: boolean; error: string };
    expect(out.ok).toBe(false);
    expect(out.error).toMatch(/already exists/);
  });

  it('requires a token', async () => {
    const out = (await releaseTagTool.handler(
      { owner: 'o', name: 'n', version: '1.0.0' },
      ctx,
    )) as { ok: boolean };
    expect(out.ok).toBe(false);
  });
});

describe('repo.set_topics', () => {
  it('keeps apicircle + normalizes', async () => {
    gh.setRepoTopics.mockResolvedValue(['apicircle', 'payments']);
    const out = (await repoSetTopicsTool.handler(
      { owner: 'o', name: 'n', topics: ['Payments'], token: 'tok' },
      ctx,
    )) as { ok: boolean; topics: string[] };
    expect(out.ok).toBe(true);
    expect(gh.setRepoTopics).toHaveBeenCalledWith('tok', 'o', 'n', ['apicircle', 'payments']);
  });

  it('rejects invalid topic shapes', async () => {
    const out = (await repoSetTopicsTool.handler(
      { owner: 'o', name: 'n', topics: ['Bad Topic!'], token: 'tok' },
      ctx,
    )) as { ok: boolean; error: string };
    expect(out.ok).toBe(false);
    expect(out.error).toMatch(/Invalid topic/);
  });
});

describe('marketplace.search', () => {
  const sampleRepos = [
    {
      fullName: 'org/payments-api',
      owner: 'org',
      name: 'payments-api',
      description: 'Payment processing workspace',
      topics: ['apicircle', 'payments'],
      stargazers: 42,
      defaultBranch: 'main',
    },
  ];

  it('returns matching repos', async () => {
    gh.searchMarketplaceRepos.mockResolvedValue(sampleRepos);
    const out = (await marketplaceSearchTool.handler(
      { query: 'payments', sort: 'best-match', token: 'tok' },
      ctx,
    )) as { ok: boolean; count: number; results: unknown[] };
    expect(out.ok).toBe(true);
    expect(out.count).toBe(1);
    expect(out.results).toEqual(sampleRepos);
    expect(gh.searchMarketplaceRepos).toHaveBeenCalledWith('tok', 'payments', { sort: undefined });
  });

  it('works anonymously (no token)', async () => {
    gh.searchMarketplaceRepos.mockResolvedValue([]);
    const out = (await marketplaceSearchTool.handler({ query: '', sort: 'best-match' }, ctx)) as {
      ok: boolean;
      count: number;
    };
    expect(out.ok).toBe(true);
    expect(out.count).toBe(0);
    expect(gh.searchMarketplaceRepos).toHaveBeenCalledWith(null, '', { sort: undefined });
  });

  it('falls back to GITHUB_TOKEN env', async () => {
    process.env.GITHUB_TOKEN = 'env-tok';
    gh.searchMarketplaceRepos.mockResolvedValue([]);
    await marketplaceSearchTool.handler({ query: 'x', sort: 'best-match' }, ctx);
    expect(gh.searchMarketplaceRepos).toHaveBeenCalledWith('env-tok', 'x', { sort: undefined });
  });

  it('passes sort parameter through', async () => {
    gh.searchMarketplaceRepos.mockResolvedValue(sampleRepos);
    await marketplaceSearchTool.handler({ query: '', sort: 'stars', token: 'tok' }, ctx);
    expect(gh.searchMarketplaceRepos).toHaveBeenCalledWith('tok', '', { sort: 'stars' });

    await marketplaceSearchTool.handler({ query: '', sort: 'updated', token: 'tok' }, ctx);
    expect(gh.searchMarketplaceRepos).toHaveBeenCalledWith('tok', '', { sort: 'updated' });
  });

  it('returns ok:false on GitHub error', async () => {
    gh.searchMarketplaceRepos.mockRejectedValue(new Error('rate limited'));
    const out = (await marketplaceSearchTool.handler(
      { query: 'x', sort: 'best-match', token: 'tok' },
      ctx,
    )) as { ok: boolean; error: string };
    expect(out.ok).toBe(false);
    expect(out.error).toBe('rate limited');
  });

  it('returns empty results gracefully', async () => {
    gh.searchMarketplaceRepos.mockResolvedValue([]);
    const out = (await marketplaceSearchTool.handler(
      { query: 'nonexistent', sort: 'best-match', token: 'tok' },
      ctx,
    )) as { ok: boolean; count: number; results: unknown[] };
    expect(out.ok).toBe(true);
    expect(out.count).toBe(0);
    expect(out.results).toEqual([]);
  });
});
