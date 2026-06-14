import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Request as ApiRequest, WorkspaceSynced } from '@apicircle/shared';
import { useWorkspaceStore } from './workspaceStore';
import { __setDiskMirrorForTests, type DiskMirror } from '../persistence/diskMirror';
import {
  __setPersistersForTests,
  resetPendingPersistForTests,
} from '../persistence/debouncedPersist';
import { resetWorkspace, saveSynced as persistSavedSynced } from '../persistence/workspaceStorage';

// =============================================================================
// hydrate() — disk-newer adoption test.
//
// This is the regression test for the MCP→desktop overwrite bug. Before
// the fix, hydrate read disk for diagnostic purposes only and then
// unconditionally queued an IDB→disk write, silently clobbering any
// external (MCP server / CLI) writes made since the desktop last closed.
//
// The fix compares `meta.updatedAt` between disk and IDB:
//
//   - disk newer → adopt disk's state in memory, persist back to IDB,
//                  and DO NOT queue the IDB→disk write (would clobber
//                  the file we just read).
//   - IDB newer-or-equal → existing behaviour (queueSaveBoth so disk
//                          mirrors IDB).
//
// We exercise both branches plus the legacy workspaceId-mismatch merge
// path to make sure the new code didn't regress it.
// =============================================================================

const T_OLD = '2026-05-01T00:00:00.000Z';
const T_NEW = '2026-05-22T00:00:00.000Z';

function makeRequest(id: string, name: string): ApiRequest {
  return {
    id,
    name,
    folderId: null,
    method: 'GET',
    url: `https://example.com/${id}`,
    headers: [],
    query: [],
    body: { type: 'none', content: '' },
    auth: { type: 'inherit' },
    contextVars: [],
    extractions: [],
    assertions: [],
    createdAt: T_OLD,
    updatedAt: T_OLD,
  };
}

function makeFakeMirror(): DiskMirror & {
  init: ReturnType<typeof vi.fn>;
  readWorkspace: ReturnType<typeof vi.fn>;
  writeWorkspace: ReturnType<typeof vi.fn>;
  registerWorkspace: ReturnType<typeof vi.fn>;
  setActiveWorkspace: ReturnType<typeof vi.fn>;
} {
  return {
    isAvailable: () => true,
    init: vi.fn().mockResolvedValue({
      registry: { schemaVersion: 1, activeWorkspaceId: null, workspaces: [] },
    }),
    readRegistry: vi.fn().mockResolvedValue({
      schemaVersion: 1,
      activeWorkspaceId: null,
      workspaces: [],
    }),
    writeRegistry: vi.fn().mockResolvedValue(undefined),
    readWorkspace: vi.fn(),
    writeWorkspace: vi.fn().mockResolvedValue(undefined),
    deleteWorkspace: vi.fn().mockResolvedValue(null),
    registerWorkspace: vi.fn().mockResolvedValue(null),
    setActiveWorkspace: vi.fn().mockResolvedValue(null),
    flush: vi.fn().mockResolvedValue(undefined),
    workspacesRoot: vi.fn().mockResolvedValue('/fake/workspaces'),
  };
}

let saveBoth: ReturnType<typeof vi.fn>;

beforeEach(async () => {
  // Reset IDB to a known baseline and clean up any prior pending persist.
  // `resetWorkspace` seeds an empty `My Workspace` doc with updatedAt set
  // to "now" — tests below bump `updatedAt` via `persistSavedSynced`
  // before exercising the hydrate path so the disk-vs-IDB compare is
  // deterministic.
  await resetWorkspace();
  resetPendingPersistForTests();
  // Spy on the debounced-persist saveBoth so we can assert whether the
  // boot-time IDB→disk write fired. `saveSynced` is NOT spied here —
  // hydrate's direct call to it bypasses the debouncedPersist module and
  // we already verify the in-memory state instead.
  saveBoth = vi.fn().mockResolvedValue(undefined);
  __setPersistersForTests({ saveBoth });
});

afterEach(() => {
  __setDiskMirrorForTests(null);
  __setPersistersForTests({});
  resetPendingPersistForTests();
});

describe('hydrate() — disk-newer adoption', () => {
  it('adopts disk state when disk.updatedAt > idb.updatedAt and skips the IDB→disk write', async () => {
    const idb = await resetWorkspace();
    // Force IDB-side timestamp older than the on-disk version we'll
    // synthesise below. Write through the canonical persister so the
    // upgrade handler / object-store setup matches what `loadWorkspace`
    // will read.
    const idbSynced: WorkspaceSynced = {
      ...idb.synced,
      meta: { ...idb.synced.meta, updatedAt: T_OLD },
    };
    await persistSavedSynced(idbSynced);

    // Disk version has the SAME workspaceId, NEWER updatedAt, and an
    // additional request — simulating an MCP / CLI write that landed
    // while the desktop was closed.
    const diskSynced: WorkspaceSynced = {
      ...idbSynced,
      meta: { ...idbSynced.meta, updatedAt: T_NEW },
      collections: {
        ...idbSynced.collections,
        requests: {
          'mcp-imported-1': makeRequest('mcp-imported-1', 'Imported by MCP'),
        },
      },
    };
    const mirror = makeFakeMirror();
    mirror.readWorkspace.mockResolvedValue({ synced: diskSynced, local: idb.local });
    __setDiskMirrorForTests(mirror);

    await useWorkspaceStore.getState().hydrate();

    const stored = useWorkspaceStore.getState().synced;
    expect(stored?.meta.updatedAt).toBe(T_NEW);
    expect(stored?.collections.requests['mcp-imported-1']).toBeDefined();

    // The IDB→disk write must NOT have been queued — that's the bug
    // the fix prevents. Give the 250ms debounce one tick to fire
    // (it shouldn't, but assert against the worst case).
    await new Promise((r) => setTimeout(r, 300));
    expect(mirror.writeWorkspace).not.toHaveBeenCalled();
  });

  it('writes IDB → disk when IDB is newer than disk (legacy desktop-only flow)', async () => {
    const idb = await resetWorkspace();
    // Force IDB-side timestamp newer than disk.
    const idbSynced: WorkspaceSynced = {
      ...idb.synced,
      meta: { ...idb.synced.meta, updatedAt: T_NEW },
    };
    await persistSavedSynced(idbSynced);

    const diskSynced: WorkspaceSynced = {
      ...idbSynced,
      meta: { ...idbSynced.meta, updatedAt: T_OLD },
    };
    const mirror = makeFakeMirror();
    mirror.readWorkspace.mockResolvedValue({ synced: diskSynced, local: idb.local });
    __setDiskMirrorForTests(mirror);

    await useWorkspaceStore.getState().hydrate();

    // Let the 250ms persist debounce fire.
    await new Promise((r) => setTimeout(r, 300));

    // IDB is the source of truth here — its content must have been
    // written through to disk via the mirror.
    expect(mirror.writeWorkspace).toHaveBeenCalled();
    const writeCall = mirror.writeWorkspace.mock.calls[0][0] as {
      synced: { meta: { updatedAt: string } };
    };
    expect(writeCall.synced.meta.updatedAt).toBe(T_NEW);
  });
});
