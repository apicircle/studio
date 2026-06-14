import { afterEach, describe, expect, it, vi } from 'vitest';
import { __setDiskMirrorForTests, getDiskMirror } from './diskMirror';

interface DesktopSurface {
  status: ReturnType<typeof vi.fn>;
  init: ReturnType<typeof vi.fn>;
  readRegistry: ReturnType<typeof vi.fn>;
  writeRegistry: ReturnType<typeof vi.fn>;
  readWorkspace: ReturnType<typeof vi.fn>;
  writeWorkspace: ReturnType<typeof vi.fn>;
  deleteWorkspace: ReturnType<typeof vi.fn>;
  registerWorkspace: ReturnType<typeof vi.fn>;
  setActiveWorkspace: ReturnType<typeof vi.fn>;
  flush: ReturnType<typeof vi.fn>;
}

function installDesktopSurface(): DesktopSurface {
  const surface: DesktopSurface = {
    status: vi.fn().mockResolvedValue({ workspacesRoot: '/fake/workspaces' }),
    init: vi.fn().mockResolvedValue({
      registry: { schemaVersion: 1, activeWorkspaceId: null, workspaces: [] },
    }),
    readRegistry: vi.fn().mockResolvedValue({
      schemaVersion: 1,
      activeWorkspaceId: null,
      workspaces: [],
    }),
    writeRegistry: vi.fn().mockResolvedValue(undefined),
    readWorkspace: vi.fn().mockResolvedValue(null),
    writeWorkspace: vi.fn().mockResolvedValue(undefined),
    deleteWorkspace: vi.fn().mockResolvedValue({
      schemaVersion: 1,
      activeWorkspaceId: null,
      workspaces: [],
    }),
    registerWorkspace: vi.fn().mockResolvedValue({
      schemaVersion: 1,
      activeWorkspaceId: null,
      workspaces: [],
    }),
    setActiveWorkspace: vi.fn().mockResolvedValue({
      schemaVersion: 1,
      activeWorkspaceId: 'ws-a',
      workspaces: [],
    }),
    flush: vi.fn().mockResolvedValue(undefined),
  };
  (globalThis as { apicircleDesktop?: unknown }).apicircleDesktop = {
    workspaceFile: surface,
  };
  __setDiskMirrorForTests(null);
  return surface;
}

function clearDesktopSurface(): void {
  delete (globalThis as { apicircleDesktop?: unknown }).apicircleDesktop;
  __setDiskMirrorForTests(null);
}

afterEach(() => {
  clearDesktopSurface();
});

describe('diskMirror', () => {
  it('reports unavailable + no-ops on web (no desktop bridge)', async () => {
    clearDesktopSurface();
    const mirror = getDiskMirror();
    expect(mirror.isAvailable()).toBe(false);
    expect(await mirror.init()).toBeNull();
    expect(await mirror.readRegistry()).toBeNull();
    expect(await mirror.readWorkspace('ws-a')).toBeNull();
    await expect(
      mirror.writeWorkspace({ workspaceId: 'ws-a', synced: {} as never, local: {} as never }),
    ).resolves.toBeUndefined();
    await expect(mirror.flush()).resolves.toBeUndefined();
    expect(await mirror.workspacesRoot()).toBeNull();
  });

  it('forwards reads / writes to the desktop surface when available', async () => {
    const surface = installDesktopSurface();
    const mirror = getDiskMirror();
    expect(mirror.isAvailable()).toBe(true);
    const payload = {
      workspaceId: 'ws-a',
      synced: { workspaceId: 'ws-a' } as never,
      local: { workspaceId: 'ws-a' } as never,
    };
    await mirror.writeWorkspace(payload);
    expect(surface.writeWorkspace).toHaveBeenCalledWith(payload);
    await mirror.readWorkspace('ws-a');
    expect(surface.readWorkspace).toHaveBeenCalledWith('ws-a');
    await mirror.flush();
    expect(surface.flush).toHaveBeenCalled();
    expect(await mirror.workspacesRoot()).toBe('/fake/workspaces');
  });

  it('forwards registry ops', async () => {
    const surface = installDesktopSurface();
    const mirror = getDiskMirror();
    await mirror.init();
    expect(surface.init).toHaveBeenCalled();
    await mirror.readRegistry();
    expect(surface.readRegistry).toHaveBeenCalled();
    await mirror.registerWorkspace({
      id: 'ws-a',
      name: 'A',
      createdAt: '2026-05-22T00:00:00.000Z',
      lastOpenedAt: '2026-05-22T00:00:00.000Z',
    });
    expect(surface.registerWorkspace).toHaveBeenCalled();
    await mirror.setActiveWorkspace('ws-a');
    expect(surface.setActiveWorkspace).toHaveBeenCalledWith('ws-a');
    await mirror.deleteWorkspace('ws-a');
    expect(surface.deleteWorkspace).toHaveBeenCalledWith('ws-a');
  });

  it('swallows desktop write failures without throwing — IDB stays the source of truth', async () => {
    const surface = installDesktopSurface();
    surface.writeWorkspace.mockRejectedValueOnce(new Error('disk full'));
    const mirror = getDiskMirror();
    await expect(
      mirror.writeWorkspace({
        workspaceId: 'ws-a',
        synced: {} as never,
        local: {} as never,
      }),
    ).resolves.toBeUndefined();
  });

  it('returns null from readWorkspace() when the desktop bridge throws', async () => {
    const surface = installDesktopSurface();
    surface.readWorkspace.mockRejectedValueOnce(new Error('read fail'));
    const mirror = getDiskMirror();
    expect(await mirror.readWorkspace('ws-a')).toBeNull();
  });

  it('__setDiskMirrorForTests installs a custom mirror', async () => {
    const fake = {
      isAvailable: () => true,
      init: vi.fn().mockResolvedValue(null),
      readRegistry: vi.fn().mockResolvedValue({
        schemaVersion: 1,
        activeWorkspaceId: 'ws-x',
        workspaces: [
          {
            id: 'ws-x',
            name: 'x',
            createdAt: '2026-05-22T00:00:00.000Z',
            lastOpenedAt: '2026-05-22T00:00:00.000Z',
          },
        ],
      }),
      writeRegistry: vi.fn().mockResolvedValue(undefined),
      readWorkspace: vi
        .fn()
        .mockResolvedValue({ synced: { workspaceId: 'ws-x' }, local: { workspaceId: 'ws-x' } }),
      writeWorkspace: vi.fn().mockResolvedValue(undefined),
      deleteWorkspace: vi.fn().mockResolvedValue(null),
      registerWorkspace: vi.fn().mockResolvedValue(null),
      setActiveWorkspace: vi.fn().mockResolvedValue(null),
      flush: vi.fn().mockResolvedValue(undefined),
      workspacesRoot: vi.fn().mockResolvedValue('/custom'),
    };
    __setDiskMirrorForTests(fake as never);
    const mirror = getDiskMirror();
    expect(mirror.isAvailable()).toBe(true);
    expect((await mirror.readWorkspace('ws-x'))?.synced.workspaceId).toBe('ws-x');
    expect(await mirror.workspacesRoot()).toBe('/custom');
  });
});
