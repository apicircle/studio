import { beforeEach, describe, expect, it, vi } from 'vitest';

// `electron` is a runtime-only dependency we don't have in unit tests, so we
// stub the surface autoUpdater.ts touches: `ipcMain.handle(channel, fn)` and
// the `BrowserWindow` *type* (autoUpdater.ts only uses it as a generic in
// the `getWindow` callback signature, so a structural mock is enough).
const ipcHandlers = new Map<string, (...args: unknown[]) => unknown>();
vi.mock('electron', () => ({
  ipcMain: {
    handle: vi.fn((channel: string, fn: (...args: unknown[]) => unknown) => {
      ipcHandlers.set(channel, fn);
    }),
  },
}));

interface UpdateInfoShape {
  version?: string;
  releaseDate?: string;
  releaseNotes?: unknown;
}

interface MockAutoUpdater {
  autoDownload: boolean;
  autoInstallOnAppQuit: boolean;
  on: ReturnType<typeof vi.fn>;
  checkForUpdatesAndNotify: ReturnType<typeof vi.fn>;
  checkForUpdates: ReturnType<typeof vi.fn>;
  quitAndInstall: ReturnType<typeof vi.fn>;
  __emit: (event: string, payload?: unknown) => void;
}

function makeMockUpdater(): MockAutoUpdater {
  const listeners = new Map<string, (p: unknown) => void>();
  return {
    autoDownload: false,
    autoInstallOnAppQuit: false,
    on: vi.fn((event: string, cb: (p: unknown) => void) => {
      listeners.set(event, cb);
    }),
    checkForUpdatesAndNotify: vi.fn().mockResolvedValue(undefined),
    checkForUpdates: vi.fn().mockResolvedValue(undefined),
    quitAndInstall: vi.fn(),
    __emit: (event: string, payload?: unknown) => {
      const cb = listeners.get(event);
      if (cb) cb(payload);
    },
  };
}

let mockUpdater: MockAutoUpdater;

// Stand-in for an IpcMainInvokeEvent from the bundled file:// renderer. The
// assertTrustedSender helper checks `event.senderFrame.url`; any file:// URL
// is accepted as trusted.
const trustedEvent = { senderFrame: { url: 'file:///dist/index.html' } };

// `electron-updater` is dynamically imported inside autoUpdater.ts so a
// vi.mock returns the stub before the import is awaited.
vi.mock('electron-updater', () => ({
  get autoUpdater() {
    return mockUpdater;
  },
}));

describe('registerAutoUpdater', () => {
  beforeEach(() => {
    ipcHandlers.clear();
    mockUpdater = makeMockUpdater();
    vi.useFakeTimers();
  });

  it('registers the apply + checkNow IPC handlers when electron-updater is available', async () => {
    const { registerAutoUpdater } = await import('./autoUpdater');
    await registerAutoUpdater(() => null);
    expect(ipcHandlers.has('apicircle:update:apply')).toBe(true);
    expect(ipcHandlers.has('apicircle:update:checkNow')).toBe(true);
  });

  it('configures autoDownload=true and autoInstallOnAppQuit=false', async () => {
    const { registerAutoUpdater } = await import('./autoUpdater');
    await registerAutoUpdater(() => null);
    expect(mockUpdater.autoDownload).toBe(true);
    // Early Access: never silently install — the renderer banner is the gate.
    expect(mockUpdater.autoInstallOnAppQuit).toBe(false);
  });

  it('schedules the initial check 5s after registration', async () => {
    const { registerAutoUpdater } = await import('./autoUpdater');
    await registerAutoUpdater(() => null);
    expect(mockUpdater.checkForUpdatesAndNotify).not.toHaveBeenCalled();
    vi.advanceTimersByTime(5000);
    expect(mockUpdater.checkForUpdatesAndNotify).toHaveBeenCalledOnce();
  });

  it('emits update-available payload to the renderer when update-downloaded fires', async () => {
    const send = vi.fn();
    const fakeWin = {
      isDestroyed: () => false,
      webContents: { send },
    } as unknown as Electron.BrowserWindow;

    const { registerAutoUpdater } = await import('./autoUpdater');
    await registerAutoUpdater(() => fakeWin);

    const info: UpdateInfoShape = {
      version: '0.1.1',
      releaseDate: '2026-05-13T00:00:00Z',
    };
    mockUpdater.__emit('update-downloaded', info);

    expect(send).toHaveBeenCalledWith(
      'apicircle:update:available',
      expect.objectContaining({
        version: '0.1.1',
        releaseNotesUrl: 'https://github.com/apicircle/studio/releases/tag/v0.1.1',
        releaseDate: '2026-05-13T00:00:00Z',
      }),
    );
  });

  it('does not crash when update-downloaded fires after the window is gone', async () => {
    const { registerAutoUpdater } = await import('./autoUpdater');
    await registerAutoUpdater(() => null);
    expect(() => mockUpdater.__emit('update-downloaded', { version: '0.1.1' })).not.toThrow();
  });

  it('apply IPC throws when no update has been downloaded', async () => {
    const { registerAutoUpdater } = await import('./autoUpdater');
    await registerAutoUpdater(() => null);
    const apply = ipcHandlers.get('apicircle:update:apply')!;
    expect(() => apply(trustedEvent)).toThrow(/No update has been downloaded/);
  });

  it('apply IPC calls quitAndInstall after an update was downloaded', async () => {
    const { registerAutoUpdater } = await import('./autoUpdater');
    await registerAutoUpdater(() => null);
    mockUpdater.__emit('update-downloaded', { version: '0.1.1' });
    const apply = ipcHandlers.get('apicircle:update:apply')!;
    apply(trustedEvent);
    expect(mockUpdater.quitAndInstall).toHaveBeenCalledOnce();
  });

  it('checkNow IPC returns {checked: true} on success', async () => {
    const { registerAutoUpdater } = await import('./autoUpdater');
    await registerAutoUpdater(() => null);
    const checkNow = ipcHandlers.get('apicircle:update:checkNow')!;
    const result = await checkNow(trustedEvent);
    expect(result).toEqual({ checked: true });
  });

  it('checkNow IPC returns {checked: false, reason} when checkForUpdates rejects', async () => {
    mockUpdater.checkForUpdates.mockRejectedValueOnce(new Error('network down'));
    const { registerAutoUpdater } = await import('./autoUpdater');
    await registerAutoUpdater(() => null);
    const checkNow = ipcHandlers.get('apicircle:update:checkNow')!;
    const result = await checkNow(trustedEvent);
    expect(result).toEqual({ checked: false, reason: 'network down' });
  });

  it('apply IPC rejects an untrusted sender frame', async () => {
    const { registerAutoUpdater } = await import('./autoUpdater');
    await registerAutoUpdater(() => null);
    const apply = ipcHandlers.get('apicircle:update:apply')!;
    expect(() => apply({ senderFrame: { url: 'https://attacker.example/' } })).toThrow(
      /Untrusted IPC sender/,
    );
  });

  it('registers stable no-op handlers when electron-updater is unavailable', async () => {
    // Getter yields no autoUpdater → `resolved` is undefined → the try throws
    // and the catch installs the no-op IPC contract so the renderer still works.
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    mockUpdater = undefined as unknown as MockAutoUpdater;
    const { registerAutoUpdater } = await import('./autoUpdater');
    await registerAutoUpdater(() => null);
    const apply = ipcHandlers.get('apicircle:update:apply')!;
    const checkNow = ipcHandlers.get('apicircle:update:checkNow')!;
    expect(apply(trustedEvent)).toBeUndefined();
    expect(await checkNow(trustedEvent)).toEqual({
      checked: false,
      reason: 'electron-updater not installed',
    });
    warn.mockRestore();
  });

  it('logs and does not throw when the updater emits an error', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { registerAutoUpdater } = await import('./autoUpdater');
    await registerAutoUpdater(() => null);
    expect(() => mockUpdater.__emit('error', new Error('flaky network'))).not.toThrow();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('swallows a rejected initial update check', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    mockUpdater.checkForUpdatesAndNotify.mockRejectedValueOnce(new Error('offline'));
    const { registerAutoUpdater } = await import('./autoUpdater');
    await registerAutoUpdater(() => null);
    await vi.advanceTimersByTimeAsync(5000);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('falls back to unknown version + null release notes when version is absent', async () => {
    const send = vi.fn();
    const fakeWin = {
      isDestroyed: () => false,
      webContents: { send },
    } as unknown as Electron.BrowserWindow;
    const { registerAutoUpdater } = await import('./autoUpdater');
    await registerAutoUpdater(() => fakeWin);
    mockUpdater.__emit('update-downloaded', {}); // no version, no releaseDate
    expect(send).toHaveBeenCalledWith('apicircle:update:available', {
      version: 'unknown',
      releaseNotesUrl: null,
      releaseDate: null,
    });
  });

  it('checkNow stringifies a non-Error rejection reason', async () => {
    mockUpdater.checkForUpdates.mockRejectedValueOnce('string blowup');
    const { registerAutoUpdater } = await import('./autoUpdater');
    await registerAutoUpdater(() => null);
    const checkNow = ipcHandlers.get('apicircle:update:checkNow')!;
    expect(await checkNow(trustedEvent)).toEqual({ checked: false, reason: 'string blowup' });
  });
});
