import { describe, it, expect, vi, beforeEach } from 'vitest';
import { workspace } from '../../test/mocks/vscode';
import { registerWorkspaceWatchers } from './workspaceWatcher';

describe('registerWorkspaceWatchers', () => {
  beforeEach(() => {
    (workspace.createFileSystemWatcher as ReturnType<typeof vi.fn>).mockReset();
  });

  it('creates one watcher per glob (synced + local)', () => {
    const watcherFactory = vi.fn(() => ({
      onDidChange: vi.fn(() => ({ dispose: vi.fn() })),
      onDidCreate: vi.fn(() => ({ dispose: vi.fn() })),
      onDidDelete: vi.fn(() => ({ dispose: vi.fn() })),
      dispose: vi.fn(),
    }));
    (workspace.createFileSystemWatcher as ReturnType<typeof vi.fn>).mockImplementation(
      watcherFactory,
    );

    const handle = registerWorkspaceWatchers({
      syncedGlob: '**/.apicircle/workspace-*/workspace.json',
      localGlob: '**/workspace.local.json',
      onAnyChange: vi.fn(),
    });

    expect(workspace.createFileSystemWatcher).toHaveBeenCalledTimes(2);
    expect(workspace.createFileSystemWatcher).toHaveBeenNthCalledWith(
      1,
      '**/.apicircle/workspace-*/workspace.json',
    );
    expect(workspace.createFileSystemWatcher).toHaveBeenNthCalledWith(2, '**/workspace.local.json');
    expect(handle.watchers).toHaveLength(2);
    handle.dispose();
  });

  it('fires onAnyChange when synced.onDidChange fires', () => {
    let syncedChangeHandler: (() => void) | undefined;
    const watcherFactory = vi.fn(() => {
      const w = {
        onDidChange: vi.fn((cb: () => void) => {
          if (!syncedChangeHandler) syncedChangeHandler = cb;
          return { dispose: vi.fn() };
        }),
        onDidCreate: vi.fn(() => ({ dispose: vi.fn() })),
        onDidDelete: vi.fn(() => ({ dispose: vi.fn() })),
        dispose: vi.fn(),
      };
      return w;
    });
    (workspace.createFileSystemWatcher as ReturnType<typeof vi.fn>).mockImplementation(
      watcherFactory,
    );

    const cb = vi.fn();
    const handle = registerWorkspaceWatchers({
      syncedGlob: 'a',
      localGlob: 'b',
      onAnyChange: cb,
    });

    expect(syncedChangeHandler).toBeDefined();
    syncedChangeHandler!();
    expect(cb).toHaveBeenCalledTimes(1);
    handle.dispose();
  });

  it('fires onAnyChange when local.onDidChange fires', () => {
    const handlers: Array<() => void> = [];
    const watcherFactory = vi.fn(() => ({
      onDidChange: vi.fn((cb: () => void) => {
        handlers.push(cb);
        return { dispose: vi.fn() };
      }),
      onDidCreate: vi.fn(() => ({ dispose: vi.fn() })),
      onDidDelete: vi.fn(() => ({ dispose: vi.fn() })),
      dispose: vi.fn(),
    }));
    (workspace.createFileSystemWatcher as ReturnType<typeof vi.fn>).mockImplementation(
      watcherFactory,
    );

    const cb = vi.fn();
    registerWorkspaceWatchers({ syncedGlob: 'a', localGlob: 'b', onAnyChange: cb });

    // Two watchers → two onDidChange handlers registered
    expect(handlers).toHaveLength(2);
    // Fire the SECOND one (local)
    handlers[1]();
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it('fires onAnyChange for create + delete events too', () => {
    const eventHandlers: { create: Array<() => void>; del: Array<() => void> } = {
      create: [],
      del: [],
    };
    const watcherFactory = vi.fn(() => ({
      onDidChange: vi.fn(() => ({ dispose: vi.fn() })),
      onDidCreate: vi.fn((cb: () => void) => {
        eventHandlers.create.push(cb);
        return { dispose: vi.fn() };
      }),
      onDidDelete: vi.fn((cb: () => void) => {
        eventHandlers.del.push(cb);
        return { dispose: vi.fn() };
      }),
      dispose: vi.fn(),
    }));
    (workspace.createFileSystemWatcher as ReturnType<typeof vi.fn>).mockImplementation(
      watcherFactory,
    );

    const cb = vi.fn();
    registerWorkspaceWatchers({ syncedGlob: 'a', localGlob: 'b', onAnyChange: cb });

    eventHandlers.create[0]();
    eventHandlers.del[0]();
    expect(cb).toHaveBeenCalledTimes(2);
  });

  it('dispose() disposes both watchers and all subscriptions', () => {
    const disposeMocks: ReturnType<typeof vi.fn>[] = [];
    const watcherFactory = vi.fn(() => {
      const disp = vi.fn();
      disposeMocks.push(disp);
      return {
        onDidChange: vi.fn(() => ({ dispose: vi.fn() })),
        onDidCreate: vi.fn(() => ({ dispose: vi.fn() })),
        onDidDelete: vi.fn(() => ({ dispose: vi.fn() })),
        dispose: disp,
      };
    });
    (workspace.createFileSystemWatcher as ReturnType<typeof vi.fn>).mockImplementation(
      watcherFactory,
    );

    const handle = registerWorkspaceWatchers({
      syncedGlob: 'a',
      localGlob: 'b',
      onAnyChange: vi.fn(),
    });
    handle.dispose();
    expect(disposeMocks[0]).toHaveBeenCalled();
    expect(disposeMocks[1]).toHaveBeenCalled();
  });
});
