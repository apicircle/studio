import { describe, expect, it } from 'vitest';
import type { SecretIndex, WorkspaceLocal, WorkspaceSynced } from './index';

// Plan §7.5.4 P3 + P4: regression snapshot of the schema shape. Fixtures
// here describe the canonical empty-workspace state and the SecretIndex
// shape; an unintentional schema bump (renamed key, removed field) fails
// CI rather than slipping through into a release.
//
// Updating these snapshots requires a code-review-justified reason in
// the PR description — the whole point of a regression snapshot is that
// drift is loud.

describe('WorkspaceSynced shape (regression)', () => {
  it('matches the locked-in snapshot for an empty workspace', () => {
    // Use deterministic values so the snapshot doesn't churn on every
    // test run. The actual `createEmptyWorkspace` helper uses generateId
    // and Date.now — we don't snapshot it directly because we want a
    // stable fixture, not a moving target.
    const empty: WorkspaceSynced = {
      schemaVersion: 1,
      workspaceId: 'ws-fixture',
      workspaceName: 'My Workspace',
      collections: {
        tree: { id: 'root-fixture', type: 'root', children: [] },
        requests: {},
        folders: {},
      },
      environments: { items: {}, activeName: null, priorityOrder: [] },
      linkedWorkspaces: {},
      releases: { self: null, perLink: {} },
      globalAssets: { schemas: {}, graphql: {} },
      mockServers: {},
      meta: {
        createdAt: '2026-04-27T00:00:00.000Z',
        updatedAt: '2026-04-27T00:00:00.000Z',
        appVersion: '0.1.0',
      },
    };

    // Snapshot every top-level key so a schema rename fails immediately.
    expect(Object.keys(empty).sort()).toEqual(
      [
        'collections',
        'environments',
        'globalAssets',
        'linkedWorkspaces',
        'meta',
        'mockServers',
        'releases',
        'schemaVersion',
        'workspaceId',
        'workspaceName',
      ].sort(),
    );
    expect(Object.keys(empty.globalAssets).sort()).toEqual(['graphql', 'schemas'].sort());
    expect(Object.keys(empty.collections).sort()).toEqual(['folders', 'requests', 'tree'].sort());
    expect(Object.keys(empty.environments).sort()).toEqual(
      ['activeName', 'items', 'priorityOrder'].sort(),
    );
    expect(Object.keys(empty.releases).sort()).toEqual(['perLink', 'self'].sort());
    expect(Object.keys(empty.meta).sort()).toEqual(['appVersion', 'createdAt', 'updatedAt'].sort());
  });
});

describe('WorkspaceLocal shape (regression)', () => {
  it('matches the locked-in snapshot for an empty local doc', () => {
    const empty: WorkspaceLocal = {
      schemaVersion: 1,
      workspaceId: 'ws-fixture',
      overrides: { items: {} },
      executionPlans: {},
      history: { requestRuns: [], planRuns: [] },
      secretIndex: { entries: {} },
      sessions: { github: null },
      connectedRepo: null,
      workingBranch: null,
      sync: {
        lastPulledSnapshot: null,
        lastPulledSha: null,
        lastPulledAt: null,
        dirtyKeys: [],
      },
      linkedCollections: {},
      globalContext: {},
      mockRuntime: { active: {} },
      ui: {
        activeRequestId: null,
        sidebarExpandedSections: [],
        themeId: 'studio-dark',
      },
    };

    expect(Object.keys(empty).sort()).toEqual(
      [
        'connectedRepo',
        'executionPlans',
        'globalContext',
        'history',
        'linkedCollections',
        'mockRuntime',
        'overrides',
        'schemaVersion',
        'secretIndex',
        'sessions',
        'sync',
        'ui',
        'workingBranch',
        'workspaceId',
      ].sort(),
    );
    expect(Object.keys(empty.history).sort()).toEqual(['planRuns', 'requestRuns'].sort());
    expect(Object.keys(empty.sync).sort()).toEqual(
      ['dirtyKeys', 'lastPulledAt', 'lastPulledSha', 'lastPulledSnapshot'].sort(),
    );
    expect(Object.keys(empty.ui).sort()).toEqual(
      ['activeRequestId', 'sidebarExpandedSections', 'themeId'].sort(),
    );
  });
});

describe('SecretIndex shape (regression)', () => {
  it('locks every field that may appear on a SecretEntry', () => {
    const index: SecretIndex = {
      entries: {
        'sec-1': {
          id: 'sec-1',
          label: 'API_KEY',
          createdAt: '2026-04-27T00:00:00.000Z',
          origin: 'workspace',
          usedIn: [],
        },
        'sec-2': {
          id: 'sec-2',
          label: 'link:Payments:DB_URL',
          createdAt: '2026-04-27T00:00:00.000Z',
          origin: 'linked',
          linkedWorkspaceId: 'lw-1',
          linkedKeyId: 'DB_URL',
          usedIn: [{ kind: 'environment-var', id: 'dev:DB_URL', label: 'dev / DB_URL' }],
        },
      },
    };

    expect(Object.keys(index)).toEqual(['entries']);
    const workspaceEntry = index.entries['sec-1'];
    expect(Object.keys(workspaceEntry).sort()).toEqual(
      ['createdAt', 'id', 'label', 'origin', 'usedIn'].sort(),
    );
    const linkedEntry = index.entries['sec-2'];
    // Linked entries add linkedWorkspaceId + linkedKeyId.
    expect(Object.keys(linkedEntry).sort()).toEqual(
      ['createdAt', 'id', 'label', 'linkedKeyId', 'linkedWorkspaceId', 'origin', 'usedIn'].sort(),
    );

    // Lock the SecretUsage shape too — usedIn is what the Secret Vault
    // modal renders, and a renamed key would break the UI silently.
    if (linkedEntry.usedIn[0]) {
      expect(Object.keys(linkedEntry.usedIn[0]).sort()).toEqual(['id', 'kind', 'label'].sort());
    }
  });
});
