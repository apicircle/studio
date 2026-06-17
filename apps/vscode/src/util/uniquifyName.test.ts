import { describe, it, expect } from 'vitest';
import type { WorkspaceSynced } from '@apicircle/shared';
import { uniquifyName } from './uniquifyName';

function makeSynced(
  requests: Array<{ id: string; name: string; folderId: string | null }>,
  folders: Array<{ id: string; name: string; parentId: string | null }> = [],
): WorkspaceSynced {
  const reqs: Record<string, (typeof requests)[0]> = {};
  for (const r of requests)
    reqs[r.id] = {
      ...r,
      method: 'GET',
      url: '',
      headers: [],
      query: [],
      body: { type: 'none', content: '' },
      auth: { type: 'none' },
      contextVars: [],
      extractions: [],
      assertions: [],
      createdAt: '',
      updatedAt: '',
    } as never;
  const folds: Record<string, (typeof folders)[0]> = {};
  for (const f of folders) folds[f.id] = f as never;
  return { collections: { requests: reqs, folders: folds } } as unknown as WorkspaceSynced;
}

describe('uniquifyName', () => {
  it('returns the base name when no collision', () => {
    const synced = makeSynced([]);
    expect(uniquifyName(synced, null, 'request', 'New Request')).toBe('New Request');
  });

  it('appends (2) on first collision', () => {
    const synced = makeSynced([{ id: 'r1', name: 'New Request', folderId: null }]);
    expect(uniquifyName(synced, null, 'request', 'New Request')).toBe('New Request (2)');
  });

  it('appends (3) when (2) also exists', () => {
    const synced = makeSynced([
      { id: 'r1', name: 'New Request', folderId: null },
      { id: 'r2', name: 'New Request (2)', folderId: null },
    ]);
    expect(uniquifyName(synced, null, 'request', 'New Request')).toBe('New Request (3)');
  });

  it('is case-insensitive', () => {
    const synced = makeSynced([{ id: 'r1', name: 'new request', folderId: null }]);
    expect(uniquifyName(synced, null, 'request', 'New Request')).toBe('New Request (2)');
  });

  it('scopes to the target folder — same name in different folder is fine', () => {
    const synced = makeSynced([{ id: 'r1', name: 'New Request', folderId: 'f1' }]);
    expect(uniquifyName(synced, 'f2', 'request', 'New Request')).toBe('New Request');
  });

  it('works for folders', () => {
    const synced = makeSynced([], [{ id: 'f1', name: 'Auth', parentId: null }]);
    expect(uniquifyName(synced, null, 'folder', 'Auth')).toBe('Auth (2)');
  });
});
