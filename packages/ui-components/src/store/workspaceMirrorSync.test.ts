import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useWorkspaceStore } from './workspaceStore';
import {
  __setDiskMirrorForTests,
  type DiskMirror,
  type DiskWorkspaceRegistry,
} from '../persistence/diskMirror';
import { resetPendingPersistForTests } from '../persistence/debouncedPersist';
import { resetWorkspace } from '../persistence/workspaceStorage';

// =============================================================================
// workspaceStore disk-mirror sync tests.
//
// These assert that the store's CRUD-on-workspaces actions (create, switch,
// delete) fan out to the on-disk mirror so the CLI / MCP / external file
// watchers stay in lockstep with IndexedDB. The mirror is mocked end-to-end
// here — actual disk writes live in the desktop-side `workspaceFileManager`
// tests; this file checks the renderer-side contract.
// =============================================================================

function makeFakeMirror(): DiskMirror & {
  registerWorkspace: ReturnType<typeof vi.fn>;
  writeWorkspace: ReturnType<typeof vi.fn>;
  setActiveWorkspace: ReturnType<typeof vi.fn>;
  deleteWorkspace: ReturnType<typeof vi.fn>;
  init: ReturnType<typeof vi.fn>;
  readWorkspace: ReturnType<typeof vi.fn>;
} {
  const emptyRegistry: DiskWorkspaceRegistry = {
    schemaVersion: 1,
    activeWorkspaceId: null,
    workspaces: [],
  };
  return {
    isAvailable: () => true,
    init: vi.fn().mockResolvedValue({ registry: emptyRegistry, migrated: false }),
    readRegistry: vi.fn().mockResolvedValue(emptyRegistry),
    writeRegistry: vi.fn().mockResolvedValue(undefined),
    readWorkspace: vi.fn().mockResolvedValue(null),
    writeWorkspace: vi.fn().mockResolvedValue(undefined),
    deleteWorkspace: vi.fn().mockResolvedValue(emptyRegistry),
    registerWorkspace: vi.fn().mockResolvedValue(emptyRegistry),
    setActiveWorkspace: vi.fn().mockResolvedValue(emptyRegistry),
    flush: vi.fn().mockResolvedValue(undefined),
    workspacesRoot: vi.fn().mockResolvedValue('/fake/workspaces'),
  };
}

let mirror: ReturnType<typeof makeFakeMirror>;

beforeEach(async () => {
  // Seed a clean IDB-backed workspace + install the fake mirror. resetWorkspaceStorage
  // both clears IDB and seeds a fresh registry record so the store can hydrate.
  const seeded = await resetWorkspace();
  mirror = makeFakeMirror();
  __setDiskMirrorForTests(mirror);
  useWorkspaceStore.setState({
    synced: seeded.synced,
    local: seeded.local,
    workspaceRegistry: seeded.registry,
    ready: true,
  });
});

afterEach(() => {
  __setDiskMirrorForTests(null);
  resetPendingPersistForTests();
});

describe('createNewWorkspace mirrors to disk', () => {
  it('writes the new workspace + registers it + sets it active in the mirror', async () => {
    await useWorkspaceStore.getState().createNewWorkspace('Petstore');
    expect(mirror.writeWorkspace).toHaveBeenCalledTimes(1);
    const writeCall = mirror.writeWorkspace.mock.calls[0][0] as {
      workspaceId: string;
      synced: { workspaceId: string };
    };
    expect(writeCall.workspaceId).toBe(writeCall.synced.workspaceId);

    expect(mirror.registerWorkspace).toHaveBeenCalledTimes(1);
    const regCall = mirror.registerWorkspace.mock.calls[0][0] as { name: string };
    expect(regCall.name).toBe('Petstore');

    expect(mirror.setActiveWorkspace).toHaveBeenCalledWith(writeCall.workspaceId);
  });
});

describe('switchWorkspace mirrors the active-id flip', () => {
  it('calls mirror.setActiveWorkspace with the incoming id', async () => {
    // Create two workspaces so we can switch between them.
    await useWorkspaceStore.getState().createNewWorkspace('Alpha');
    mirror.setActiveWorkspace.mockClear();
    const betaId = await useWorkspaceStore.getState().createNewWorkspace('Beta');
    // createNewWorkspace itself sets active; the next setActive call after
    // a switch is what we want to assert on.
    mirror.setActiveWorkspace.mockClear();

    // Switch back to Alpha — capture which id flowed to the mirror.
    const registry = useWorkspaceStore.getState().workspaceRegistry;
    const alphaId = registry!.workspaces.find((w) => w.name === 'Alpha')!.id;
    expect(alphaId).not.toBe(betaId);
    await useWorkspaceStore.getState().switchWorkspace(alphaId);
    expect(mirror.setActiveWorkspace).toHaveBeenCalledWith(alphaId);
  });

  it('does NOT call setActiveWorkspace when switching to the already-active workspace', async () => {
    await useWorkspaceStore.getState().createNewWorkspace('Alpha');
    const active = useWorkspaceStore.getState().workspaceRegistry!.activeWorkspaceId!;
    mirror.setActiveWorkspace.mockClear();
    await useWorkspaceStore.getState().switchWorkspace(active);
    expect(mirror.setActiveWorkspace).not.toHaveBeenCalled();
  });
});

describe('deleteWorkspaceById mirrors the delete', () => {
  it('calls mirror.deleteWorkspace with the deleted id', async () => {
    await useWorkspaceStore.getState().createNewWorkspace('Alpha');
    const idToDelete = useWorkspaceStore.getState().synced!.workspaceId;
    await useWorkspaceStore.getState().createNewWorkspace('Beta');
    mirror.deleteWorkspace.mockClear();
    await useWorkspaceStore.getState().deleteWorkspaceById(idToDelete);
    expect(mirror.deleteWorkspace).toHaveBeenCalledWith(idToDelete);
  });
});

describe('mirror unavailability is safe', () => {
  it('createNewWorkspace still completes when the mirror is unavailable (web)', async () => {
    __setDiskMirrorForTests({
      ...makeFakeMirror(),
      isAvailable: () => false,
    });
    // Should not throw; should not call the mirror's writeWorkspace.
    await expect(useWorkspaceStore.getState().createNewWorkspace('Solo')).resolves.toBeTruthy();
  });
});
