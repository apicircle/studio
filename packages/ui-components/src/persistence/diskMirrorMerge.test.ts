import { describe, expect, it } from 'vitest';
import type { Folder, Request as ApiRequest, WorkspaceSynced } from '@apicircle/shared';
import { mergeSyncedFromDisk } from './diskMirrorMerge';

const T0 = '2026-05-22T00:00:00.000Z';

function makeRequest(id: string, folderId: string | null = null): ApiRequest {
  return {
    id,
    name: `req-${id}`,
    folderId,
    method: 'GET',
    url: `https://example.com/${id}`,
    headers: [],
    query: [],
    body: { type: 'none', content: '' },
    auth: { type: 'inherit' },
    contextVars: [],
    extractions: [],
    assertions: [],
    createdAt: T0,
    updatedAt: T0,
  };
}

function makeFolder(id: string, parentId: string | null = null): Folder {
  return { id, name: `folder-${id}`, parentId };
}

function makeSynced(opts: {
  workspaceId: string;
  requests?: ApiRequest[];
  folders?: Folder[];
  treeChildren?: Array<{ kind: 'folder' | 'request'; id: string }>;
}): WorkspaceSynced {
  const requests: Record<string, ApiRequest> = {};
  for (const r of opts.requests ?? []) requests[r.id] = r;
  const folders: Record<string, Folder> = {};
  for (const f of opts.folders ?? []) folders[f.id] = f;
  return {
    schemaVersion: 1,
    workspaceId: opts.workspaceId,
    collections: {
      tree: { id: 'root', type: 'root', children: opts.treeChildren ?? [] },
      requests,
      folders,
    },
    environments: { items: {}, activeName: null, priorityOrder: [] },
    linkedWorkspaces: {},
    linkedOverrides: { requests: {}, environmentVars: {} },
    releases: { self: null, perLink: {} },
    globalAssets: { schemas: {}, graphql: {} },
    mockServers: {},
    meta: { createdAt: T0, updatedAt: T0, appVersion: '1.0.0' },
  };
}

describe('mergeSyncedFromDisk', () => {
  it('returns IDB unchanged when disk has no extra content', () => {
    const idb = makeSynced({
      workspaceId: 'idb',
      requests: [makeRequest('r1')],
      treeChildren: [{ kind: 'request', id: 'r1' }],
    });
    const disk = makeSynced({ workspaceId: 'disk' });
    const { merged, importedRequestIds, importedFolderIds } = mergeSyncedFromDisk(idb, disk);
    expect(importedRequestIds).toEqual([]);
    expect(importedFolderIds).toEqual([]);
    expect(merged.collections.requests.r1).toBeDefined();
    // No wrapper folder when nothing was imported.
    expect(merged.collections.tree.children).toEqual([{ kind: 'request', id: 'r1' }]);
  });

  it('keeps the IDB workspaceId in the merged doc', () => {
    const idb = makeSynced({ workspaceId: 'idb-id' });
    const disk = makeSynced({
      workspaceId: 'disk-id',
      requests: [makeRequest('r-only-disk')],
    });
    const { merged } = mergeSyncedFromDisk(idb, disk);
    expect(merged.workspaceId).toBe('idb-id');
  });

  it('imports disk-only requests under a wrapper folder at root', () => {
    const idb = makeSynced({
      workspaceId: 'idb',
      requests: [makeRequest('r-idb')],
      treeChildren: [{ kind: 'request', id: 'r-idb' }],
    });
    const disk = makeSynced({
      workspaceId: 'disk',
      requests: [makeRequest('r-disk-1'), makeRequest('r-disk-2')],
    });
    const { merged, importedRequestIds } = mergeSyncedFromDisk(idb, disk);
    expect(importedRequestIds.sort()).toEqual(['r-disk-1', 'r-disk-2']);
    // Original IDB request kept, both disk requests imported.
    expect(Object.keys(merged.collections.requests).sort()).toEqual([
      'r-disk-1',
      'r-disk-2',
      'r-idb',
    ]);
    // Wrapper folder exists and is at root.
    const rootChildren = merged.collections.tree.children;
    expect(rootChildren.length).toBe(2);
    expect(rootChildren[0]).toEqual({ kind: 'request', id: 'r-idb' });
    const wrapperRef = rootChildren[1];
    expect(wrapperRef.kind).toBe('folder');
    const wrapperId = wrapperRef.id;
    const wrapper = merged.collections.folders[wrapperId];
    expect(wrapper.parentId).toBeNull();
    expect(wrapper.name).toMatch(/Imported from disk/i);
    // Imported requests are reparented to the wrapper.
    expect(merged.collections.requests['r-disk-1'].folderId).toBe(wrapperId);
    expect(merged.collections.requests['r-disk-2'].folderId).toBe(wrapperId);
  });

  it('IDB wins on ID collision (disk version is dropped)', () => {
    const idb = makeSynced({
      workspaceId: 'idb',
      requests: [makeRequest('shared')],
    });
    idb.collections.requests.shared = {
      ...idb.collections.requests.shared,
      url: 'https://idb.example/shared',
    };
    const disk = makeSynced({
      workspaceId: 'disk',
      requests: [makeRequest('shared')],
    });
    disk.collections.requests.shared = {
      ...disk.collections.requests.shared,
      url: 'https://disk.example/shared',
    };
    const { merged, importedRequestIds } = mergeSyncedFromDisk(idb, disk);
    expect(importedRequestIds).toEqual([]);
    expect(merged.collections.requests.shared.url).toBe('https://idb.example/shared');
  });

  it('preserves disk-side folder hierarchy for nested imports', () => {
    // Disk has folder F1 → folder F2 → request R1
    const f1 = makeFolder('f1', null);
    const f2 = makeFolder('f2', 'f1');
    const r1 = makeRequest('r1', 'f2');
    const idb = makeSynced({ workspaceId: 'idb' });
    const disk = makeSynced({
      workspaceId: 'disk',
      folders: [f1, f2],
      requests: [r1],
    });
    const { merged, importedFolderIds, importedRequestIds } = mergeSyncedFromDisk(idb, disk);
    expect(importedFolderIds.sort()).toEqual(['f1', 'f2']);
    expect(importedRequestIds).toEqual(['r1']);
    // f1 is the top-level import → reparented to the wrapper.
    // f2 stays nested under f1; r1 stays nested under f2.
    const wrapperRef = merged.collections.tree.children[0];
    expect(wrapperRef.kind).toBe('folder');
    const wrapperId = wrapperRef.id;
    expect(merged.collections.folders.f1.parentId).toBe(wrapperId);
    expect(merged.collections.folders.f2.parentId).toBe('f1');
    expect(merged.collections.requests.r1.folderId).toBe('f2');
  });

  it('unions environments by name with IDB winning on conflict', () => {
    const idb = makeSynced({ workspaceId: 'idb' });
    idb.environments.items = {
      dev: { name: 'dev', variables: [{ key: 'A', value: 'idb-A', encrypted: false }] },
    };
    const disk = makeSynced({ workspaceId: 'disk' });
    disk.environments.items = {
      dev: { name: 'dev', variables: [{ key: 'A', value: 'disk-A', encrypted: false }] },
      prod: { name: 'prod', variables: [{ key: 'B', value: 'disk-B', encrypted: false }] },
    };
    const { merged } = mergeSyncedFromDisk(idb, disk);
    // IDB's `dev` is preserved; `prod` is imported.
    expect(merged.environments.items.dev.variables[0].value).toBe('idb-A');
    expect(merged.environments.items.prod.variables[0].value).toBe('disk-B');
  });

  it('updates meta.updatedAt to reflect the merge moment', () => {
    const idb = makeSynced({ workspaceId: 'idb' });
    const disk = makeSynced({
      workspaceId: 'disk',
      requests: [makeRequest('r1')],
    });
    const before = Date.now();
    const { merged } = mergeSyncedFromDisk(idb, disk);
    const mergedAt = Date.parse(merged.meta.updatedAt);
    expect(mergedAt).toBeGreaterThanOrEqual(before);
  });
});
