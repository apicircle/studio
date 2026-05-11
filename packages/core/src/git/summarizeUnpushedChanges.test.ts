import { describe, expect, it } from 'vitest';
import type { Request as ApiRequest, WorkspaceSynced } from '@apicircle/shared';
import { hasUnpushedChanges, summarizeUnpushedChanges } from './summarizeUnpushedChanges';

const T0 = '2026-04-27T00:00:00.000Z';
const NOW = () => new Date(T0);

function emptyDoc(overrides: Partial<WorkspaceSynced> = {}): WorkspaceSynced {
  return {
    schemaVersion: 1,
    workspaceId: 'ws-1',
    workspaceName: 'My Workspace',
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

  it('skips the workspaceName singleton when it equals the default', () => {
    // Default workspaceName "My Workspace" → not counted as added.
    const summary = summarizeUnpushedChanges(null, emptyDoc(), { now: NOW });
    expect(summary.changes.find((c) => c.bucket === 'workspaceName')).toBeUndefined();
  });

  it('counts a renamed workspaceName as added', () => {
    const summary = summarizeUnpushedChanges(null, emptyDoc({ workspaceName: 'Custom name' }), {
      now: NOW,
    });
    const workspaceNameChange = summary.changes.find((c) => c.bucket === 'workspaceName');
    expect(workspaceNameChange?.kind).toBe('added');
    expect(workspaceNameChange?.local).toBe('Custom name');
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

  it('sorts changes by BUCKET_ORDER (singletons → requests → folders → environments → linked → releases)', () => {
    const r1 = req('r1');
    const base = emptyDoc();
    const current = emptyDoc({
      workspaceName: 'Renamed',
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
    // workspaceName comes before tree comes before request comes before
    // environment comes before linkedWorkspace.
    expect(buckets.indexOf('workspaceName')).toBeLessThan(buckets.indexOf('tree'));
    expect(buckets.indexOf('tree')).toBeLessThan(buckets.indexOf('request'));
    expect(buckets.indexOf('request')).toBeLessThan(buckets.indexOf('environment'));
    expect(buckets.indexOf('environment')).toBeLessThan(buckets.indexOf('linkedWorkspace'));
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
});
