import { describe, expect, it } from 'vitest';
import type {
  ExecutionPlan,
  MockServer,
  Request as ApiRequest,
  WorkspaceSynced,
} from '@apicircle/shared';
import { hasUnpushedChanges, summarizeUnpushedChanges } from './summarizeUnpushedChanges';

const T0 = '2026-04-27T00:00:00.000Z';
const NOW = () => new Date(T0);

function emptyDoc(overrides: Partial<WorkspaceSynced> = {}): WorkspaceSynced {
  return {
    schemaVersion: 1,
    workspaceId: 'ws-1',
    collections: { tree: { id: 'r', type: 'root', children: [] }, requests: {}, folders: {} },
    environments: { items: {}, activeName: null, priorityOrder: [] },
    linkedWorkspaces: {},
    linkedOverrides: { requests: {}, environmentVars: {} },
    releases: { self: null, perLink: {} },
    globalAssets: { schemas: {}, graphql: {} },
    mockServers: {},
    meta: { createdAt: T0, updatedAt: T0, appVersion: '0.1.0' },
    ...overrides,
  };
}

function mockServer(id: string, name: string): MockServer {
  return {
    id,
    name,
    source: { kind: 'manual', endpoints: [] },
    endpoints: [],
    defaultPort: null,
    cors: { enabled: false, origins: [] },
    createdAt: T0,
    updatedAt: T0,
  };
}

function executionPlan(id: string, name: string): ExecutionPlan {
  return {
    id,
    name,
    steps: [],
    envPriorityOrder: [],
    createdAt: T0,
    updatedAt: T0,
  };
}

function req(id: string, overrides: Partial<ApiRequest> = {}): ApiRequest {
  return {
    id,
    name: `Request ${id}`,
    folderId: null,
    method: 'GET',
    url: `https://example.test/${id}`,
    headers: [],
    query: [],
    body: { type: 'none', content: '' },
    auth: { type: 'none' },
    contextVars: [],
    extractions: [],
    assertions: [],
    createdAt: T0,
    updatedAt: T0,
    ...overrides,
  };
}

describe('summarizeUnpushedChanges — base = null (first push)', () => {
  it('returns added counts for every populated entity', () => {
    const r1 = req('r1');
    const current = emptyDoc({
      collections: {
        tree: { id: 'r', type: 'root', children: [{ kind: 'request', id: 'r1' }] },
        requests: { r1 },
        folders: {},
      },
    });
    const summary = summarizeUnpushedChanges(null, current, { now: NOW });
    expect(summary.added).toBe(2); // 1 request + 1 tree singleton
    expect(summary.modified).toBe(0);
    expect(summary.removed).toBe(0);
    expect(summary.changes.map((c) => c.bucket).sort()).toEqual(['request', 'tree']);
  });
});

describe('summarizeUnpushedChanges — base != null', () => {
  it('returns total = 0 when current === base by reference', () => {
    const doc = emptyDoc();
    const summary = summarizeUnpushedChanges(doc, doc, { now: NOW });
    expect(summary.total).toBe(0);
  });

  it('classifies a new request as "added"', () => {
    const base = emptyDoc();
    const r1 = req('r1');
    const current = emptyDoc({
      collections: {
        tree: { id: 'r', type: 'root', children: [{ kind: 'request', id: 'r1' }] },
        requests: { r1 },
        folders: {},
      },
    });
    const summary = summarizeUnpushedChanges(base, current, { now: NOW });
    const requestChange = summary.changes.find((c) => c.bucket === 'request');
    expect(requestChange?.kind).toBe('added');
    expect(requestChange?.label).toBe('Request r1');
    expect(summary.added).toBeGreaterThanOrEqual(1);
  });

  it('classifies a deleted request as "removed"', () => {
    const r1 = req('r1');
    const base = emptyDoc({
      collections: {
        tree: { id: 'r', type: 'root', children: [{ kind: 'request', id: 'r1' }] },
        requests: { r1 },
        folders: {},
      },
    });
    const current = emptyDoc({
      collections: { tree: { id: 'r', type: 'root', children: [] }, requests: {}, folders: {} },
    });
    const summary = summarizeUnpushedChanges(base, current, { now: NOW });
    const requestChange = summary.changes.find((c) => c.bucket === 'request');
    expect(requestChange?.kind).toBe('removed');
    expect(summary.removed).toBeGreaterThanOrEqual(1);
  });

  it('classifies a FIRST-TIME publish (releases.self transitioning from null → ledger) as a change', () => {
    // The reported bug: first publish doesn't surface in Push to save,
    // but a subsequent (upgrade) publish does. This nails the boundary
    // case `null → defined`. If the diff drops it, the strip stays empty.
    const base = emptyDoc({ releases: { self: null, perLink: {} } });
    const current = emptyDoc({
      releases: {
        self: {
          versions: [
            {
              version: '0.1.0',
              publishedAt: '2026-05-01T00:00:00.000Z',
              notes: 'Initial release',
              workspaceSnapshot: 'a'.repeat(64),
              deprecated: false,
              yanked: false,
            },
          ],
          currentVersion: '0.1.0',
        },
        perLink: {},
      },
    });
    const summary = summarizeUnpushedChanges(base, current, { now: NOW });
    const releaseChange = summary.changes.find((c) => c.bucket === 'releaseSelf');
    expect(releaseChange).toBeDefined();
    // null → ledger reads as "added" — going from no ledger to having one
    // is conceptually an add, not a modification.
    expect(releaseChange?.kind).toBe('added');
    expect(summary.added).toBeGreaterThanOrEqual(1);
  });

  it('classifies a publishRelease change to releases.self as "modified"', () => {
    // Repro for "publish release isn't surfaced by Push to save". After
    // a successful push, lastPulledSnapshot equals the just-pushed doc.
    // publishRelease then mutates `releases.self`. The strip should pick
    // it up as a `releaseSelf` modification.
    const baseLedger = {
      versions: [
        {
          version: '0.1.0',
          publishedAt: T0,
          notes: '',
          workspaceSnapshot: 'a'.repeat(64),
          deprecated: false,
          yanked: false,
        },
      ],
      currentVersion: '0.1.0',
    };
    const base = emptyDoc({ releases: { self: baseLedger, perLink: {} } });
    const current = emptyDoc({
      releases: {
        self: {
          versions: [
            ...baseLedger.versions,
            {
              version: '0.2.0',
              publishedAt: '2026-05-01T00:00:00.000Z',
              notes: 'Bug fixes',
              workspaceSnapshot: 'b'.repeat(64),
              deprecated: false,
              yanked: false,
            },
          ],
          currentVersion: '0.2.0',
        },
        perLink: {},
      },
    });
    const summary = summarizeUnpushedChanges(base, current, { now: NOW });
    const releaseChange = summary.changes.find((c) => c.bucket === 'releaseSelf');
    expect(releaseChange).toBeDefined();
    expect(releaseChange?.kind).toBe('modified');
    expect(summary.modified).toBe(1);
  });

  it('classifies an edited request as "modified"', () => {
    const r1Old = req('r1', { url: 'https://example.test/old' });
    const r1New = req('r1', { url: 'https://example.test/new' });
    const base = emptyDoc({
      collections: {
        tree: { id: 'r', type: 'root', children: [{ kind: 'request', id: 'r1' }] },
        requests: { r1: r1Old },
        folders: {},
      },
    });
    const current = emptyDoc({
      collections: {
        tree: { id: 'r', type: 'root', children: [{ kind: 'request', id: 'r1' }] },
        requests: { r1: r1New },
        folders: {},
      },
    });
    const summary = summarizeUnpushedChanges(base, current, { now: NOW });
    const requestChange = summary.changes.find((c) => c.bucket === 'request');
    expect(requestChange?.kind).toBe('modified');
    expect(summary.modified).toBe(1);
    expect(summary.added).toBe(0);
    expect(summary.removed).toBe(0);
  });

  it('ignores local credential values when base has git-redacted placeholders', () => {
    const baseRequest = req('r1', { auth: { type: 'bearer', token: '' } });
    const currentRequest = req('r1', {
      auth: { type: 'bearer', token: 'local-secret-token' },
    });
    const base = emptyDoc({
      collections: {
        tree: { id: 'r', type: 'root', children: [{ kind: 'request', id: 'r1' }] },
        requests: { r1: baseRequest },
        folders: {},
      },
    });
    const current = emptyDoc({
      collections: {
        tree: { id: 'r', type: 'root', children: [{ kind: 'request', id: 'r1' }] },
        requests: { r1: currentRequest },
        folders: {},
      },
    });
    expect(summarizeUnpushedChanges(base, current, { now: NOW }).total).toBe(0);
    expect(hasUnpushedChanges(base, current)).toBe(false);
  });

  it('ignores credential-only differences when both base and current keep local secrets', () => {
    const baseRequest = req('r1', { auth: { type: 'bearer', token: 'old-local-secret' } });
    const currentRequest = req('r1', {
      auth: { type: 'bearer', token: 'new-local-secret' },
    });
    const base = emptyDoc({
      collections: {
        tree: { id: 'r', type: 'root', children: [{ kind: 'request', id: 'r1' }] },
        requests: { r1: baseRequest },
        folders: {},
      },
    });
    const current = emptyDoc({
      collections: {
        tree: { id: 'r', type: 'root', children: [{ kind: 'request', id: 'r1' }] },
        requests: { r1: currentRequest },
        folders: {},
      },
    });
    expect(summarizeUnpushedChanges(base, current, { now: NOW }).total).toBe(0);
  });

  it('still reports real request edits while ignoring git-redacted credentials', () => {
    const baseRequest = req('r1', {
      url: 'https://example.test/old',
      auth: { type: 'bearer', token: '' },
    });
    const currentRequest = req('r1', {
      url: 'https://example.test/new',
      auth: { type: 'bearer', token: 'local-secret-token' },
    });
    const base = emptyDoc({
      collections: {
        tree: { id: 'r', type: 'root', children: [{ kind: 'request', id: 'r1' }] },
        requests: { r1: baseRequest },
        folders: {},
      },
    });
    const current = emptyDoc({
      collections: {
        tree: { id: 'r', type: 'root', children: [{ kind: 'request', id: 'r1' }] },
        requests: { r1: currentRequest },
        folders: {},
      },
    });
    const summary = summarizeUnpushedChanges(base, current, { now: NOW });
    const requestChange = summary.changes.find((c) => c.bucket === 'request');
    expect(requestChange?.kind).toBe('modified');
    expect(summary.total).toBe(1);
  });

  it('sorts changes by BUCKET_ORDER (singletons → requests → folders → environments → linked → releases)', () => {
    const r1 = req('r1');
    const base = emptyDoc();
    const current = emptyDoc({
      collections: {
        tree: { id: 'r', type: 'root', children: [{ kind: 'request', id: 'r1' }] },
        requests: { r1 },
        folders: {},
      },
      environments: {
        items: { dev: { name: 'dev', variables: [] } },
        activeName: 'dev',
        priorityOrder: [{ kind: 'local', name: 'dev' }],
      },
      linkedWorkspaces: {
        'lw-1': {
          id: 'lw-1',
          kind: 'public',
          name: 'Linked',
          sourceWorkspaceId: 'remote-ws-1',
          source: {
            provider: 'github',
            repoFullName: 'a/b',
            branch: 'main',
            sessionMode: 'workspace',
          },
          scope: ['collections'],
          pinnedVersion: null,
          updatePolicy: 'manual',
          linkedAt: T0,
          requiredSecretKeyIds: [],
        },
      },
    });
    const summary = summarizeUnpushedChanges(base, current, { now: NOW });
    const buckets = summary.changes.map((c) => c.bucket);
    // tree comes before request comes before environment comes before
    // linkedWorkspace.
    expect(buckets.indexOf('tree')).toBeLessThan(buckets.indexOf('request'));
    expect(buckets.indexOf('request')).toBeLessThan(buckets.indexOf('environment'));
    expect(buckets.indexOf('environment')).toBeLessThan(buckets.indexOf('linkedWorkspace'));
  });
});

// ---------------------------------------------------------------------------
// Regression: mock-server + execution-plan renames used to be invisible in the
// unpushed-changes UI. The diff engine didn't enumerate those buckets, so
// `summarizeUnpushedChanges` reported `total: 0` even after a real rename.
// These tests pin the behavior in.
// ---------------------------------------------------------------------------

describe('summarizeUnpushedChanges — mockServer bucket (regression)', () => {
  it('reports a renamed mock server as "modified" against a base snapshot', () => {
    const base = emptyDoc({ mockServers: { 'm-1': mockServer('m-1', 'Old name') } });
    const current = emptyDoc({ mockServers: { 'm-1': mockServer('m-1', 'New name') } });
    const summary = summarizeUnpushedChanges(base, current, { now: NOW });
    const change = summary.changes.find((c) => c.bucket === 'mockServer');
    expect(change).toBeDefined();
    expect(change?.kind).toBe('modified');
    expect(change?.label).toBe('New name');
    expect(summary.modified).toBe(1);
    expect(summary.total).toBe(1);
  });

  it('reports a newly-created mock server as "added"', () => {
    const base = emptyDoc({ mockServers: {} });
    const current = emptyDoc({ mockServers: { 'm-1': mockServer('m-1', 'Fresh') } });
    const summary = summarizeUnpushedChanges(base, current, { now: NOW });
    const change = summary.changes.find((c) => c.bucket === 'mockServer');
    expect(change?.kind).toBe('added');
    expect(summary.added).toBe(1);
  });

  it('reports a deleted mock server as "removed"', () => {
    const base = emptyDoc({ mockServers: { 'm-1': mockServer('m-1', 'Doomed') } });
    const current = emptyDoc({ mockServers: {} });
    const summary = summarizeUnpushedChanges(base, current, { now: NOW });
    const change = summary.changes.find((c) => c.bucket === 'mockServer');
    expect(change?.kind).toBe('removed');
    expect(summary.removed).toBe(1);
  });

  it('counts a populated mock server in the first-push (base = null) "added" walk', () => {
    const current = emptyDoc({ mockServers: { 'm-1': mockServer('m-1', 'First') } });
    const summary = summarizeUnpushedChanges(null, current, { now: NOW });
    const change = summary.changes.find((c) => c.bucket === 'mockServer');
    expect(change).toBeDefined();
    expect(change?.kind).toBe('added');
    expect(change?.label).toBe('First');
  });
});

describe('summarizeUnpushedChanges — executionPlan bucket (regression)', () => {
  it('reports a renamed execution plan as "modified" against a base snapshot', () => {
    const base = emptyDoc({ executionPlans: { 'p-1': executionPlan('p-1', 'Old plan') } });
    const current = emptyDoc({ executionPlans: { 'p-1': executionPlan('p-1', 'New plan') } });
    const summary = summarizeUnpushedChanges(base, current, { now: NOW });
    const change = summary.changes.find((c) => c.bucket === 'executionPlan');
    expect(change).toBeDefined();
    expect(change?.kind).toBe('modified');
    expect(change?.label).toBe('New plan');
    expect(summary.modified).toBe(1);
  });

  it('reports a newly-created execution plan as "added"', () => {
    const base = emptyDoc({ executionPlans: {} });
    const current = emptyDoc({ executionPlans: { 'p-1': executionPlan('p-1', 'Fresh plan') } });
    const summary = summarizeUnpushedChanges(base, current, { now: NOW });
    const change = summary.changes.find((c) => c.bucket === 'executionPlan');
    expect(change?.kind).toBe('added');
    expect(summary.added).toBe(1);
  });

  it('reports a deleted execution plan as "removed"', () => {
    const base = emptyDoc({ executionPlans: { 'p-1': executionPlan('p-1', 'Doomed') } });
    const current = emptyDoc({ executionPlans: {} });
    const summary = summarizeUnpushedChanges(base, current, { now: NOW });
    const change = summary.changes.find((c) => c.bucket === 'executionPlan');
    expect(change?.kind).toBe('removed');
    expect(summary.removed).toBe(1);
  });

  it('counts a populated execution plan in the first-push (base = null) "added" walk', () => {
    const current = emptyDoc({
      executionPlans: { 'p-1': executionPlan('p-1', 'First plan') },
    });
    const summary = summarizeUnpushedChanges(null, current, { now: NOW });
    const change = summary.changes.find((c) => c.bucket === 'executionPlan');
    expect(change).toBeDefined();
    expect(change?.kind).toBe('added');
    expect(change?.label).toBe('First plan');
  });

  it('treats `executionPlans: undefined` (pre-migration shape) as empty — no spurious changes', () => {
    // The optional field must not produce a phantom bucket entry when both
    // sides are absent. This is the boundary the runtime depends on for
    // workspaces that haven't been touched since the executionPlans
    // migration landed.
    const base = emptyDoc({ executionPlans: undefined });
    const current = emptyDoc({ executionPlans: undefined });
    expect(summarizeUnpushedChanges(base, current, { now: NOW }).total).toBe(0);
    expect(summarizeUnpushedChanges(null, current, { now: NOW }).total).toBe(0);
  });
});

describe('summarizeUnpushedChanges — bucket ordering with mockServer + executionPlan', () => {
  it('orders mockServer and executionPlan between linkedWorkspace and releaseSelf', () => {
    const base = emptyDoc();
    const current = emptyDoc({
      mockServers: { 'm-1': mockServer('m-1', 'Mock') },
      executionPlans: { 'p-1': executionPlan('p-1', 'Plan') },
      linkedWorkspaces: {
        'lw-1': {
          id: 'lw-1',
          kind: 'public',
          name: 'Linked',
          sourceWorkspaceId: 'remote-ws-1',
          source: {
            provider: 'github',
            repoFullName: 'a/b',
            branch: 'main',
            sessionMode: 'workspace',
          },
          scope: ['collections'],
          pinnedVersion: null,
          updatePolicy: 'manual',
          linkedAt: T0,
          requiredSecretKeyIds: [],
        },
      },
    });
    const summary = summarizeUnpushedChanges(base, current, { now: NOW });
    const buckets = summary.changes.map((c) => c.bucket);
    expect(buckets.indexOf('linkedWorkspace')).toBeLessThan(buckets.indexOf('mockServer'));
    expect(buckets.indexOf('mockServer')).toBeLessThan(buckets.indexOf('executionPlan'));
  });
});

describe('hasUnpushedChanges (cheap badge check)', () => {
  it('returns false when current === base by reference', () => {
    const doc = emptyDoc();
    expect(hasUnpushedChanges(doc, doc)).toBe(false);
  });

  it('returns true when there is at least one local mutation', () => {
    const base = emptyDoc();
    const current = emptyDoc({
      collections: {
        tree: { id: 'r', type: 'root', children: [{ kind: 'request', id: 'r1' }] },
        requests: { r1: req('r1') },
        folders: {},
      },
    });
    expect(hasUnpushedChanges(base, current)).toBe(true);
  });

  it('returns true when base is null and current is non-empty', () => {
    const current = emptyDoc({
      collections: {
        tree: { id: 'r', type: 'root', children: [{ kind: 'request', id: 'r1' }] },
        requests: { r1: req('r1') },
        folders: {},
      },
    });
    expect(hasUnpushedChanges(null, current)).toBe(true);
  });

  it('returns true after a mock server rename (regression)', () => {
    const base = emptyDoc({ mockServers: { 'm-1': mockServer('m-1', 'Old') } });
    const current = emptyDoc({ mockServers: { 'm-1': mockServer('m-1', 'New') } });
    expect(hasUnpushedChanges(base, current)).toBe(true);
  });

  it('returns true after an execution plan rename (regression)', () => {
    const base = emptyDoc({ executionPlans: { 'p-1': executionPlan('p-1', 'Old') } });
    const current = emptyDoc({ executionPlans: { 'p-1': executionPlan('p-1', 'New') } });
    expect(hasUnpushedChanges(base, current)).toBe(true);
  });
});
