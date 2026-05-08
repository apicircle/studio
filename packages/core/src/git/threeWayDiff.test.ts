import { describe, expect, it } from 'vitest';
import type { Request as ApiRequest, WorkspaceSynced } from '@apicircle/shared';
import { applyMerge, computeThreeWayDiff } from './threeWayDiff';

const baseDoc = (overrides: Partial<WorkspaceSynced> = {}): WorkspaceSynced => ({
  schemaVersion: 1,
  workspaceId: 'ws-1',
  workspaceName: 'W',
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

  it('detects singleton conflicts (workspaceName)', () => {
    const base = baseDoc({ workspaceName: 'A' });
    const local = baseDoc({ workspaceName: 'B' });
    const remote = baseDoc({ workspaceName: 'C' });
    const d = computeThreeWayDiff(base, local, remote);
    expect(d.conflicts.find((e) => e.bucket === 'workspaceName')).toBeDefined();
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
    const base = baseDoc({ workspaceName: 'A' });
    const local = baseDoc({ workspaceName: 'B' });
    const remote = baseDoc({ workspaceName: 'C' });
    const d = computeThreeWayDiff(base, local, remote);
    const merged = applyMerge(local, remote, d, { 'workspaceName:': 'theirs' });
    expect(merged.workspaceName).toBe('C');
  });
});
