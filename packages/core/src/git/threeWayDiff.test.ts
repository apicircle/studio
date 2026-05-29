import { describe, expect, it } from 'vitest';
import type {
  ExecutionPlan,
  MockServer,
  Request as ApiRequest,
  WorkspaceSynced,
} from '@apicircle/shared';
import { applyMerge, computeThreeWayDiff } from './threeWayDiff';

const baseDoc = (overrides: Partial<WorkspaceSynced> = {}): WorkspaceSynced => ({
  schemaVersion: 1,
  workspaceId: 'ws-1',
  collections: { tree: { id: 'r', type: 'root', children: [] }, requests: {}, folders: {} },
  environments: { items: {}, activeName: null, priorityOrder: [] },
  linkedWorkspaces: {},
  linkedOverrides: { requests: {}, environmentVars: {} },
  releases: { self: null, perLink: {} },
  globalAssets: { schemas: {}, graphql: {} },
  mockServers: {},
  meta: { createdAt: 't', updatedAt: 't', appVersion: '0.1.0' },
  ...overrides,
});

const req = (id: string, name: string): ApiRequest => ({
  id,
  name,
  folderId: null,
  method: 'GET',
  url: 'https://x',
  headers: [],
  query: [],
  body: { type: 'none', content: '' },
  auth: { type: 'none' },
  contextVars: [],
  extractions: [],
  assertions: [],
  createdAt: 't',
  updatedAt: 't',
});

const withRequests = (...rs: ApiRequest[]): WorkspaceSynced => {
  const requests: Record<string, ApiRequest> = {};
  for (const r of rs) requests[r.id] = r;
  return baseDoc({
    collections: { tree: { id: 'r', type: 'root', children: [] }, requests, folders: {} },
  });
};

const withRootRequests = (...rs: ApiRequest[]): WorkspaceSynced => {
  const requests: Record<string, ApiRequest> = {};
  for (const r of rs) requests[r.id] = r;
  return baseDoc({
    collections: {
      tree: {
        id: 'r',
        type: 'root',
        children: rs.map((r) => ({ kind: 'request' as const, id: r.id })),
      },
      requests,
      folders: {},
    },
  });
};

const mock = (id: string, name: string): MockServer => ({
  id,
  name,
  source: { kind: 'manual', endpoints: [] },
  endpoints: [],
  defaultPort: null,
  cors: { enabled: false, origins: [] },
  createdAt: 't',
  updatedAt: 't',
});

const withMocks = (...ms: MockServer[]): WorkspaceSynced => {
  const mockServers: Record<string, MockServer> = {};
  for (const m of ms) mockServers[m.id] = m;
  return baseDoc({ mockServers });
};

const plan = (id: string, name: string): ExecutionPlan => ({
  id,
  name,
  steps: [],
  envPriorityOrder: [],
  createdAt: 't',
  updatedAt: 't',
});

const withPlans = (...ps: ExecutionPlan[]): WorkspaceSynced => {
  const executionPlans: Record<string, ExecutionPlan> = {};
  for (const p of ps) executionPlans[p.id] = p;
  return baseDoc({ executionPlans });
};

describe('computeThreeWayDiff', () => {
  it('returns no entries when base/local/remote are all equal', () => {
    const doc = baseDoc();
    const d = computeThreeWayDiff(doc, doc, doc);
    expect(d.entries).toEqual([]);
    expect(d.conflicts).toEqual([]);
  });

  it('detects an only-remote add as remote-only fast-forward', () => {
    const base = withRequests();
    const local = withRequests();
    const remote = withRequests(req('r-1', 'Get'));
    const d = computeThreeWayDiff(base, local, remote);
    expect(d.entries).toHaveLength(1);
    expect(d.entries[0]).toMatchObject({ bucket: 'request', key: 'r-1', status: 'remote-only' });
    expect(d.conflicts).toHaveLength(0);
  });

  it('detects an only-local add as local-only', () => {
    const base = withRequests();
    const local = withRequests(req('r-1', 'Get'));
    const remote = withRequests();
    const d = computeThreeWayDiff(base, local, remote);
    expect(d.entries[0].status).toBe('local-only');
  });

  it('preserves local credential fields when remote only has git-redacted placeholders', () => {
    const localRequest = {
      ...req('r-1', 'Get'),
      auth: { type: 'bearer', token: 'local-secret-token' },
    } as ApiRequest;
    const remoteRequest = {
      ...localRequest,
      url: 'https://remote.example.test',
      auth: { type: 'bearer', token: '' },
    } as ApiRequest;
    const base = withRequests(localRequest);
    const local = withRequests(localRequest);
    const remote = withRequests(remoteRequest);
    const d = computeThreeWayDiff(base, local, remote);
    expect(d.entries[0]).toMatchObject({ bucket: 'request', key: 'r-1', status: 'remote-only' });
    const merged = applyMerge(local, remote, d, {});
    expect(merged.collections.requests['r-1'].url).toBe('https://remote.example.test');
    expect(merged.collections.requests['r-1'].auth).toEqual({
      type: 'bearer',
      token: 'local-secret-token',
    });
  });

  it('marks identical changes on both sides as both-equal (auto-resolvable)', () => {
    const base = withRequests();
    const local = withRequests(req('r-1', 'X'));
    const remote = withRequests(req('r-1', 'X'));
    const d = computeThreeWayDiff(base, local, remote);
    expect(d.entries[0].status).toBe('both-equal');
    expect(d.conflicts).toHaveLength(0);
  });

  it('flags divergent edits as conflicts and includes both sides', () => {
    const base = withRequests(req('r-1', 'Original'));
    const local = withRequests(req('r-1', 'Mine'));
    const remote = withRequests(req('r-1', 'Theirs'));
    const d = computeThreeWayDiff(base, local, remote);
    expect(d.conflicts).toHaveLength(1);
    const entry = d.conflicts[0];
    expect(entry.status).toBe('conflict');
    expect((entry.local as { name: string }).name).toBe('Mine');
    expect((entry.remote as { name: string }).name).toBe('Theirs');
    expect(entry.label).toBe('Mine');
  });

  it('treats an entity deleted on one side and modified on the other as a conflict', () => {
    const base = withRequests(req('r-1', 'Old'));
    const local = withRequests(req('r-1', 'Edited'));
    const remote = withRequests();
    const d = computeThreeWayDiff(base, local, remote);
    expect(d.conflicts[0]).toMatchObject({ status: 'conflict', key: 'r-1' });
  });

  it('skips entries deleted on both sides (no diff entry surfaced)', () => {
    const base = withRequests(req('r-1', 'Old'));
    const local = withRequests();
    const remote = withRequests();
    const d = computeThreeWayDiff(base, local, remote);
    expect(d.entries).toEqual([]);
  });

  it('detects singleton conflicts (environments.activeName)', () => {
    const base = baseDoc({
      environments: { items: {}, activeName: 'a', priorityOrder: [] },
    });
    const local = baseDoc({
      environments: { items: {}, activeName: 'b', priorityOrder: [] },
    });
    const remote = baseDoc({
      environments: { items: {}, activeName: 'c', priorityOrder: [] },
    });
    const d = computeThreeWayDiff(base, local, remote);
    expect(d.conflicts.find((e) => e.bucket === 'environmentsActive')).toBeDefined();
  });

  it('without a base, equal-on-both-sides changes are no-ops; divergent ones are conflicts', () => {
    const local = withRequests(req('r-1', 'A'));
    const remote = withRequests(req('r-1', 'B'));
    const d = computeThreeWayDiff(null, local, remote);
    expect(d.conflicts).toHaveLength(1);

    const same = withRequests(req('r-1', 'A'));
    const d2 = computeThreeWayDiff(null, same, same);
    expect(d2.entries).toEqual([]);
  });
});

describe('applyMerge', () => {
  it('keeps local for local-only/both-equal entries and pulls remote-only forward', () => {
    const base = withRequests(req('keeps-base', 'k'));
    const local = withRequests(req('keeps-base', 'k'), req('only-local', 'l'));
    const remote = withRequests(req('keeps-base', 'k'), req('only-remote', 'r'));
    const d = computeThreeWayDiff(base, local, remote);
    const merged = applyMerge(local, remote, d, {});
    expect(Object.keys(merged.collections.requests).sort()).toEqual([
      'keeps-base',
      'only-local',
      'only-remote',
    ]);
  });

  it('auto-merges disjoint root tree additions represented by request entries', () => {
    const base = withRootRequests(req('keeps-base', 'Base'));
    const local = withRootRequests(req('keeps-base', 'Base'), req('only-local', 'Local'));
    const remote = withRootRequests(req('keeps-base', 'Base'), req('only-remote', 'Remote'));
    const d = computeThreeWayDiff(base, local, remote);
    expect(d.conflicts).toEqual([]);
    expect(d.entries.find((entry) => entry.bucket === 'tree')?.status).toBe('remote-only');

    const merged = applyMerge(local, remote, d, {});
    expect(Object.keys(merged.collections.requests).sort()).toEqual([
      'keeps-base',
      'only-local',
      'only-remote',
    ]);
    expect(merged.collections.tree.children).toEqual([
      { kind: 'request', id: 'keeps-base' },
      { kind: 'request', id: 'only-local' },
      { kind: 'request', id: 'only-remote' },
    ]);
  });

  it('keeps true tree reorder conflicts in the resolver', () => {
    const r1 = req('r-1', 'One');
    const r2 = req('r-2', 'Two');
    const r3 = req('r-3', 'Three');
    const requests = { 'r-1': r1, 'r-2': r2, 'r-3': r3 };
    const base = baseDoc({
      collections: {
        tree: {
          id: 'r',
          type: 'root',
          children: [
            { kind: 'request', id: 'r-1' },
            { kind: 'request', id: 'r-2' },
            { kind: 'request', id: 'r-3' },
          ],
        },
        requests,
        folders: {},
      },
    });
    const local = {
      ...base,
      collections: {
        ...base.collections,
        tree: {
          ...base.collections.tree,
          children: [
            { kind: 'request' as const, id: 'r-2' },
            { kind: 'request' as const, id: 'r-1' },
            { kind: 'request' as const, id: 'r-3' },
          ],
        },
      },
    };
    const remote = {
      ...base,
      collections: {
        ...base.collections,
        tree: {
          ...base.collections.tree,
          children: [
            { kind: 'request' as const, id: 'r-1' },
            { kind: 'request' as const, id: 'r-3' },
            { kind: 'request' as const, id: 'r-2' },
          ],
        },
      },
    };
    const d = computeThreeWayDiff(base, local, remote);
    expect(d.conflicts.find((entry) => entry.bucket === 'tree')).toBeDefined();
  });

  it('resolves conflicts by mine/theirs per the resolution map', () => {
    const base = withRequests(req('r-1', 'Original'));
    const local = withRequests(req('r-1', 'Mine'));
    const remote = withRequests(req('r-1', 'Theirs'));
    const d = computeThreeWayDiff(base, local, remote);
    const merged = applyMerge(local, remote, d, { 'request:r-1': 'theirs' });
    expect(merged.collections.requests['r-1'].name).toBe('Theirs');

    const mineMerge = applyMerge(local, remote, d, { 'request:r-1': 'mine' });
    expect(mineMerge.collections.requests['r-1'].name).toBe('Mine');
  });

  it('fills in deletions when "theirs" is the resolution for a delete-vs-modify conflict', () => {
    const base = withRequests(req('r-1', 'Old'));
    const local = withRequests(req('r-1', 'Mine'));
    const remote = withRequests();
    const d = computeThreeWayDiff(base, local, remote);
    const merged = applyMerge(local, remote, d, { 'request:r-1': 'theirs' });
    expect(merged.collections.requests['r-1']).toBeUndefined();
  });

  it('throws when a conflict is missing a resolution', () => {
    const base = withRequests(req('r-1', 'O'));
    const local = withRequests(req('r-1', 'L'));
    const remote = withRequests(req('r-1', 'R'));
    const d = computeThreeWayDiff(base, local, remote);
    expect(() => applyMerge(local, remote, d, {})).toThrow(/Missing resolution/);
  });

  it('applies singleton conflicts correctly', () => {
    const base = baseDoc({
      environments: { items: {}, activeName: 'a', priorityOrder: [] },
    });
    const local = baseDoc({
      environments: { items: {}, activeName: 'b', priorityOrder: [] },
    });
    const remote = baseDoc({
      environments: { items: {}, activeName: 'c', priorityOrder: [] },
    });
    const d = computeThreeWayDiff(base, local, remote);
    const merged = applyMerge(local, remote, d, { 'environmentsActive:': 'theirs' });
    expect(merged.environments.activeName).toBe('c');
  });
});

// ---------------------------------------------------------------------------
// Regression: mockServer + executionPlan buckets were absent from the diff
// engine, so renaming a mock or plan looked clean but didn't surface in the
// unpushed-changes UI or the pull conflict resolver. These tests pin both
// buckets in so the diff layer can never silently drop them again.
// ---------------------------------------------------------------------------

describe('computeThreeWayDiff — mockServer bucket', () => {
  it('treats a local rename as local-only when remote is untouched', () => {
    const base = withMocks(mock('m-1', 'Original'));
    const local = withMocks(mock('m-1', 'Renamed'));
    const remote = withMocks(mock('m-1', 'Original'));
    const d = computeThreeWayDiff(base, local, remote);
    const entry = d.entries.find((e) => e.bucket === 'mockServer');
    expect(entry).toBeDefined();
    expect(entry?.status).toBe('local-only');
    expect(entry?.label).toBe('Renamed');
  });

  it('flags divergent renames on both sides as a conflict', () => {
    const base = withMocks(mock('m-1', 'Original'));
    const local = withMocks(mock('m-1', 'Mine'));
    const remote = withMocks(mock('m-1', 'Theirs'));
    const d = computeThreeWayDiff(base, local, remote);
    expect(d.conflicts).toHaveLength(1);
    expect(d.conflicts[0]).toMatchObject({ bucket: 'mockServer', key: 'm-1', status: 'conflict' });
  });

  it('classifies a new mock server (added only locally) as local-only', () => {
    const base = withMocks();
    const local = withMocks(mock('m-1', 'New'));
    const remote = withMocks();
    const d = computeThreeWayDiff(base, local, remote);
    const entry = d.entries.find((e) => e.bucket === 'mockServer');
    expect(entry?.status).toBe('local-only');
    expect((entry?.local as MockServer).name).toBe('New');
  });

  it('classifies a deleted mock server (removed only locally) as local-only', () => {
    const base = withMocks(mock('m-1', 'Existing'));
    const local = withMocks();
    const remote = withMocks(mock('m-1', 'Existing'));
    const d = computeThreeWayDiff(base, local, remote);
    const entry = d.entries.find((e) => e.bucket === 'mockServer');
    expect(entry?.status).toBe('local-only');
    expect(entry?.local).toBeUndefined();
  });
});

describe('computeThreeWayDiff — executionPlan bucket', () => {
  it('treats a local plan rename as local-only when remote is untouched', () => {
    const base = withPlans(plan('p-1', 'Original'));
    const local = withPlans(plan('p-1', 'Renamed'));
    const remote = withPlans(plan('p-1', 'Original'));
    const d = computeThreeWayDiff(base, local, remote);
    const entry = d.entries.find((e) => e.bucket === 'executionPlan');
    expect(entry).toBeDefined();
    expect(entry?.status).toBe('local-only');
    expect(entry?.label).toBe('Renamed');
  });

  it('flags divergent plan renames as a conflict', () => {
    const base = withPlans(plan('p-1', 'Original'));
    const local = withPlans(plan('p-1', 'Mine'));
    const remote = withPlans(plan('p-1', 'Theirs'));
    const d = computeThreeWayDiff(base, local, remote);
    expect(d.conflicts).toHaveLength(1);
    expect(d.conflicts[0]).toMatchObject({
      bucket: 'executionPlan',
      key: 'p-1',
      status: 'conflict',
    });
  });

  it('treats `executionPlans: undefined` as `{}` so absence-vs-empty never differs', () => {
    // Pre-migration shape: synced doc may not yet have hydrated executionPlans.
    // The diff engine MUST coerce undefined to {} so the field's optional
    // type doesn't smuggle in a spurious bucket-shaped diff.
    const base = baseDoc({ executionPlans: undefined });
    const local = baseDoc({ executionPlans: {} });
    const remote = baseDoc({ executionPlans: undefined });
    const d = computeThreeWayDiff(base, local, remote);
    expect(d.entries.find((e) => e.bucket === 'executionPlan')).toBeUndefined();
  });

  it('classifies adding a new plan (when base has none) as local-only', () => {
    const base = baseDoc({ executionPlans: {} });
    const local = withPlans(plan('p-1', 'New'));
    const remote = baseDoc({ executionPlans: {} });
    const d = computeThreeWayDiff(base, local, remote);
    const entry = d.entries.find((e) => e.bucket === 'executionPlan');
    expect(entry?.status).toBe('local-only');
  });
});

describe('applyMerge — mockServer + executionPlan resolutions', () => {
  it('writes the remote mock server when "theirs" is chosen for a conflict', () => {
    const base = withMocks(mock('m-1', 'Original'));
    const local = withMocks(mock('m-1', 'Mine'));
    const remote = withMocks(mock('m-1', 'Theirs'));
    const d = computeThreeWayDiff(base, local, remote);
    const merged = applyMerge(local, remote, d, { 'mockServer:m-1': 'theirs' });
    expect(merged.mockServers['m-1'].name).toBe('Theirs');
  });

  it('deletes the mock locally when "theirs" is the resolution for a delete-vs-modify conflict', () => {
    const base = withMocks(mock('m-1', 'Original'));
    const local = withMocks(mock('m-1', 'Mine'));
    const remote = withMocks();
    const d = computeThreeWayDiff(base, local, remote);
    const merged = applyMerge(local, remote, d, { 'mockServer:m-1': 'theirs' });
    expect(merged.mockServers['m-1']).toBeUndefined();
  });

  it('writes the remote plan when "theirs" is chosen for a conflict', () => {
    const base = withPlans(plan('p-1', 'Original'));
    const local = withPlans(plan('p-1', 'Mine'));
    const remote = withPlans(plan('p-1', 'Theirs'));
    const d = computeThreeWayDiff(base, local, remote);
    const merged = applyMerge(local, remote, d, { 'executionPlan:p-1': 'theirs' });
    expect(merged.executionPlans?.['p-1'].name).toBe('Theirs');
  });

  it('keeps the local plan dict shape when no plan changes are present', () => {
    // Sanity check: a merge of two docs with no plan-bucket diff entries
    // must not nuke `executionPlans` to undefined.
    const docA = withPlans(plan('p-1', 'A'));
    const d = computeThreeWayDiff(docA, docA, docA);
    const merged = applyMerge(docA, docA, d, {});
    expect(merged.executionPlans?.['p-1']).toBeDefined();
  });

  it('initializes the executionPlans dict when remote adds a plan but local had none', () => {
    // Local doc shape with `executionPlans: undefined` must not crash when
    // applyMerge spreads it. The applyEntry case must coerce to `{}` first.
    const base = baseDoc({ executionPlans: undefined });
    const local = baseDoc({ executionPlans: undefined });
    const remote = withPlans(plan('p-1', 'FromRemote'));
    const d = computeThreeWayDiff(base, local, remote);
    const merged = applyMerge(local, remote, d, {});
    expect(merged.executionPlans?.['p-1'].name).toBe('FromRemote');
  });
});

// ---------------------------------------------------------------------------
// Regression: secretKeys, globalAssets.{schemas,graphql}, linkedOverrides.*,
// releases.perLink, and secretCrypto are git-tracked fields on WorkspaceSynced
// but used to be invisible to the diff engine. Adding rows in each bucket
// type silently slipped past the unpushed-changes strip AND the conflict
// resolver. These tests pin every new bucket in so the gap can't reopen.
// ---------------------------------------------------------------------------

describe('computeThreeWayDiff — newly-tracked buckets', () => {
  it('surfaces a local-only secretKey add as local-only', () => {
    const base = baseDoc({ secretKeys: {} });
    const local = baseDoc({
      secretKeys: {
        s1: { id: 's1', label: 'Database token', createdAt: 't', salt: 'AAAAAA==' },
      },
    });
    const remote = baseDoc({ secretKeys: {} });
    const d = computeThreeWayDiff(base, local, remote);
    const entry = d.entries.find((e) => e.bucket === 'secretKey');
    expect(entry?.status).toBe('local-only');
    expect(entry?.label).toBe('Database token');
  });

  it('flags divergent globalSchema renames as a conflict', () => {
    const baseSchema = {
      id: 'g1',
      name: 'Original',
      schema: '{}',
      createdAt: 't',
      updatedAt: 't',
    };
    const base = baseDoc({ globalAssets: { schemas: { g1: baseSchema }, graphql: {} } });
    const local = baseDoc({
      globalAssets: { schemas: { g1: { ...baseSchema, name: 'Mine' } }, graphql: {} },
    });
    const remote = baseDoc({
      globalAssets: { schemas: { g1: { ...baseSchema, name: 'Theirs' } }, graphql: {} },
    });
    const d = computeThreeWayDiff(base, local, remote);
    expect(d.conflicts.find((e) => e.bucket === 'globalSchema')).toBeDefined();
  });

  it('surfaces a globalGraphql add as local-only', () => {
    const base = baseDoc({ globalAssets: { schemas: {}, graphql: {} } });
    const local = baseDoc({
      globalAssets: {
        schemas: {},
        graphql: {
          gql1: {
            id: 'gql1',
            name: 'Catalog',
            kind: 'sdl' as const,
            source: 'type Query { x: Int }',
            createdAt: 't',
            updatedAt: 't',
          },
        },
      },
    });
    const remote = baseDoc({ globalAssets: { schemas: {}, graphql: {} } });
    const d = computeThreeWayDiff(base, local, remote);
    const entry = d.entries.find((e) => e.bucket === 'globalGraphql');
    expect(entry?.status).toBe('local-only');
    expect(entry?.label).toBe('Catalog');
  });

  it('surfaces a globalFile add as local-only', () => {
    const base = baseDoc({ globalAssets: { schemas: {}, graphql: {}, files: {} } });
    const local = baseDoc({
      globalAssets: {
        schemas: {},
        graphql: {},
        files: {
          file1: {
            id: 'file1',
            name: 'Payload',
            slotId: 'slot-1',
            filename: 'payload.json',
            size: 12,
            mimeType: 'application/json',
            createdAt: 't',
            updatedAt: 't',
          },
        },
      },
    });
    const remote = baseDoc({ globalAssets: { schemas: {}, graphql: {}, files: {} } });
    const d = computeThreeWayDiff(base, local, remote);
    const entry = d.entries.find((e) => e.bucket === 'globalFile');
    expect(entry?.status).toBe('local-only');
    expect(entry?.label).toBe('Payload');
  });

  it('surfaces a linkedRequestOverride add as local-only', () => {
    const base = baseDoc();
    const local = baseDoc({
      linkedOverrides: {
        requests: {
          'lw1:r1': {
            linkedWorkspaceId: 'lw1',
            itemId: 'r1',
            patch: { url: 'https://fork.test' },
            updatedAt: 't',
          },
        },
        environmentVars: {},
      },
    });
    const remote = baseDoc();
    const d = computeThreeWayDiff(base, local, remote);
    const entry = d.entries.find((e) => e.bucket === 'linkedRequestOverride');
    expect(entry?.status).toBe('local-only');
  });

  it('surfaces a linkedEnvOverride add as local-only', () => {
    const base = baseDoc();
    const local = baseDoc({
      linkedOverrides: {
        requests: {},
        environmentVars: {
          'lw1:dev:URL': {
            linkedWorkspaceId: 'lw1',
            envName: 'dev',
            varKey: 'URL',
            value: 'https://fork.test',
            updatedAt: 't',
          },
        },
      },
    });
    const remote = baseDoc();
    const d = computeThreeWayDiff(base, local, remote);
    const entry = d.entries.find((e) => e.bucket === 'linkedEnvOverride');
    expect(entry?.status).toBe('local-only');
  });

  it('surfaces a releasePerLink change as local-only', () => {
    const baseLedger = { versions: [], currentVersion: null };
    const base = baseDoc({ releases: { self: null, perLink: { lw1: baseLedger } } });
    const local = baseDoc({
      releases: {
        self: null,
        perLink: { lw1: { versions: [], currentVersion: '1.0.0' } },
      },
    });
    const remote = baseDoc({ releases: { self: null, perLink: { lw1: baseLedger } } });
    const d = computeThreeWayDiff(base, local, remote);
    const entry = d.entries.find((e) => e.bucket === 'releasePerLink');
    expect(entry?.status).toBe('local-only');
  });

  it('treats secretCrypto null→populated as a singleton local-only add', () => {
    const base = baseDoc({ secretCrypto: null });
    const local = baseDoc({
      secretCrypto: {
        kdf: 'pbkdf2-sha256-v1',
        salt: 'AAAA',
        iterations: 600_000,
        verifier: 'V',
      },
    });
    const remote = baseDoc({ secretCrypto: null });
    const d = computeThreeWayDiff(base, local, remote);
    const entry = d.entries.find((e) => e.bucket === 'secretCrypto');
    expect(entry?.status).toBe('local-only');
    expect(entry?.label).toBe('Workspace passphrase');
  });

  it('applyMerge writes the remote secretKey when "theirs" is picked', () => {
    const original = { id: 's1', label: 'Original', createdAt: 't', salt: 'AAAA' };
    const base = baseDoc({ secretKeys: { s1: original } });
    const local = baseDoc({ secretKeys: { s1: { ...original, label: 'Mine' } } });
    const remote = baseDoc({ secretKeys: { s1: { ...original, label: 'Theirs' } } });
    const d = computeThreeWayDiff(base, local, remote);
    const merged = applyMerge(local, remote, d, { 'secretKey:s1': 'theirs' });
    expect(merged.secretKeys?.s1.label).toBe('Theirs');
  });

  it('applyMerge adds a root-level remote-only request to tree.children (no orphans)', () => {
    // Regression: pre-fix applyMerge mutated `collections.requests` but
    // left `collections.tree.children` untouched. A remote-only top-level
    // request landed in the dict and stayed invisible in the editor
    // sidebar (which walks the tree) while still surfacing in the
    // unpushed-changes diff. The reconciler now keeps tree.children in
    // lockstep with the dict.
    const base = baseDoc();
    const local = baseDoc();
    const remote = withRequests(req('remote-r1', 'From remote'));
    const d = computeThreeWayDiff(base, local, remote);
    const merged = applyMerge(local, remote, d, {});
    expect(merged.collections.requests['remote-r1']).toBeDefined();
    expect(
      merged.collections.tree.children.some((c) => c.kind === 'request' && c.id === 'remote-r1'),
    ).toBe(true);
  });

  it('applyMerge does NOT add nested requests (folderId !== null) to tree.children', () => {
    // Nested entries are derived via folderId at render time, not from
    // tree.children. Adding them to the root tree would make them appear
    // twice in the sidebar (once at root, once inside the folder).
    const nestedReq = { ...req('nested-r1', 'Nested'), folderId: 'f-1' };
    const base = baseDoc();
    const local = baseDoc();
    const remote = baseDoc({
      collections: {
        tree: { id: 'r', type: 'root', children: [] },
        requests: { 'nested-r1': nestedReq },
        folders: {},
      },
    });
    const d = computeThreeWayDiff(base, local, remote);
    const merged = applyMerge(local, remote, d, {});
    expect(merged.collections.requests['nested-r1']).toBeDefined();
    expect(
      merged.collections.tree.children.some((c) => c.kind === 'request' && c.id === 'nested-r1'),
    ).toBe(false);
  });

  it('applyMerge removes a root-level entry from tree.children when remote deleted it', () => {
    // Conflict where the user picks 'theirs' (delete). The dict drops
    // the entry — tree.children must drop it too, or the sidebar would
    // try to render an id with no backing entry.
    const base = withRequests(req('r-shared', 'Shared'));
    const local = withRequests(req('r-shared', 'Mine renamed'));
    const remote = withRequests(); // remote deleted it
    const d = computeThreeWayDiff(base, local, remote);
    const merged = applyMerge(local, remote, d, { 'request:r-shared': 'theirs' });
    expect(merged.collections.requests['r-shared']).toBeUndefined();
    expect(
      merged.collections.tree.children.some((c) => c.kind === 'request' && c.id === 'r-shared'),
    ).toBe(false);
  });

  it('applyMerge adds a root-level remote-only folder to tree.children', () => {
    const remoteFolder = { id: 'f-remote', name: 'From remote', parentId: null };
    const base = baseDoc();
    const local = baseDoc();
    const remote = baseDoc({
      collections: {
        tree: { id: 'r', type: 'root', children: [{ kind: 'folder', id: 'f-remote' }] },
        requests: {},
        folders: { 'f-remote': remoteFolder },
      },
    });
    const d = computeThreeWayDiff(base, local, remote);
    const merged = applyMerge(local, remote, d, {});
    expect(merged.collections.folders['f-remote']).toBeDefined();
    expect(
      merged.collections.tree.children.some((c) => c.kind === 'folder' && c.id === 'f-remote'),
    ).toBe(true);
  });

  it('applyMerge writes the remote linkedRequestOverride when "theirs" is picked', () => {
    const baseOverride = {
      linkedWorkspaceId: 'lw1',
      itemId: 'r1',
      patch: { url: 'https://base.test' },
      updatedAt: 't',
    };
    const base = baseDoc({
      linkedOverrides: { requests: { 'lw1:r1': baseOverride }, environmentVars: {} },
    });
    const local = baseDoc({
      linkedOverrides: {
        requests: { 'lw1:r1': { ...baseOverride, patch: { url: 'https://mine.test' } } },
        environmentVars: {},
      },
    });
    const remote = baseDoc({
      linkedOverrides: {
        requests: { 'lw1:r1': { ...baseOverride, patch: { url: 'https://theirs.test' } } },
        environmentVars: {},
      },
    });
    const d = computeThreeWayDiff(base, local, remote);
    const merged = applyMerge(local, remote, d, { 'linkedRequestOverride:lw1:r1': 'theirs' });
    expect(merged.linkedOverrides.requests['lw1:r1'].patch.url).toBe('https://theirs.test');
  });
});
