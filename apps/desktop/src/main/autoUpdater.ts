// Auto-update wiring. Reads release metadata from
// https://github.com/apicircle/studio/releases via electron-updater
// (publish config lives in electron-builder.yml). On `update-downloaded`
// we emit `apicircle:update:available` to the renderer so the UI can
// surface a "Restart to install" banner.
//
// Early Access caveat: binaries are NOT code-signed yet. macOS Gatekeeper
// and Windows SmartScreen will warn on first launch / on each update.
// docs/installing.md walks the user through the right-click → Open path.
//
// Defensive shape: electron-updater is dynamically imported because:
//   (1) it has no behaviour in dev mode (skips actual update checks), and
//   (2) the TS build needs to compile even if the dep isn't installed yet
//       (typical right after a fresh clone, pre-`pnpm install`).
// If the import fails or the module is missing, we log and no-op.

import { ipcMain, type BrowserWindow } from 'electron';
import { assertTrustedSender } from '@apicircle/desktop-shell';

/** Payload the renderer receives on `apicircle:update:available`. */
export interface UpdateAvailablePayload {
  version: string;
  releaseNotesUrl: string | null;
  releaseDate: string | null;
}

interface AutoUpdaterShape {
  autoDownload: boolean;
  autoInstallOnAppQuit: boolean;
  on(event: 'update-downloaded', cb: (info: UpdateInfoShape) => void): void;
  on(event: 'error', cb: (err: Error) => void): void;
  on(event: 'checking-for-update', cb: () => void): void;
  on(event: 'update-available', cb: (info: UpdateInfoShape) => void): void;
  on(event: 'update-not-available', cb: (info: UpdateInfoShape) => void): void;
  checkForUpdatesAndNotify(): Promise<unknown>;
  checkForUpdates(): Promise<unknown>;
  quitAndInstall(): void;
}

interface UpdateInfoShape {
  version?: string;
  releaseDate?: string;
  releaseNotes?: unknown;
}

/**
 * Wire the updater. Idempotent — calling twice is a no-op past the first
 * registration. Pass the main window so the IPC notification can be
 * routed to the right webContents.
 */
export async function registerAutoUpdater(getWindow: () => BrowserWindow | null): Promise<void> {
  let updater: AutoUpdaterShape;
  try {
    // Dynamic import keeps the TS build from breaking if the dep is not
    // yet installed (fresh clone). `electron-updater` ships CommonJS, so
    // under tsup's ESM-interop the named export lands on either the
    // namespace root OR under `.default` depending on host bundler /
    // Node version. Probe both before declaring the module unusable.
    const mod = (await import('electron-updater')) as unknown as {
      autoUpdater?: AutoUpdaterShape;
      default?: { autoUpdater?: AutoUpdaterShape };
    };
    const resolved = mod.autoUpdater ?? mod.default?.autoUpdater;
    if (!resolved) {
      throw new Error(
        'electron-updater loaded but did not expose `autoUpdater` on the namespace or default export',
      );
    }
    updater = resolved;
  } catch (err) {
    console.warn('[autoUpdater] electron-updater is not installed; auto-update is disabled.', err);
    // Register no-op handlers so the renderer-side IPC contract is stable.
    ipcMain.handle('apicircle:update:apply', (event) => {
      assertTrustedSender(event);
      return undefined;
    });
    ipcMain.handle('apicircle:update:checkNow', (event) => {
      assertTrustedSender(event);
      return { checked: false, reason: 'electron-updater not installed' };
    });
    return;
  }

  // We download in the background and notify the renderer on completion;
  // we do not install on quit silently because Early Access binaries are
  // unsigned and we want the user explicitly informed before relaunch.
  updater.autoDownload = true;
  updater.autoInstallOnAppQuit = false;

  let lastDownloaded: UpdateInfoShape | null = null;

  updater.on('update-downloaded', (info) => {
    lastDownloaded = info;
    const payload: UpdateAvailablePayload = {
      version: info.version ?? 'unknown',
      releaseNotesUrl: buildReleaseNotesUrl(info.version),
      releaseDate: info.releaseDate ?? null,
    };
    const win = getWindow();
    if (win && !win.isDestroyed()) {
      win.webContents.send('apicircle:update:available', payload);
    } else {
      console.warn('[autoUpdater] update downloaded but no window to notify');
    }
  });

  updater.on('error', (err) => {
    // Don't surface every network blip — these are noisy on flaky
    // connections. Logging is enough; the next launch will retry.
    console.warn('[autoUpdater] error:', err.message);
  });

  // Renderer-driven "apply now" — calls quitAndInstall, which relaunches
  // into the installer with the downloaded artifact.
  ipcMain.handle('apicircle:update:apply', (event) => {
    assertTrustedSender(event);
    if (!lastDownloaded) {
      throw new Error('No update has been downloaded yet.');
    }
    updater.quitAndInstall();
  });

  // Renderer-driven "check now" for the About modal / settings.
  ipcMain.handle('apicircle:update:checkNow', async (event) => {
    assertTrustedSender(event);
    try {
      await updater.checkForUpdates();
      return { checked: true };
    } catch (err) {
      return { checked: false, reason: err instanceof Error ? err.message : String(err) };
    }
  });

  // Kick the first check shortly after launch so we don't compete with
  // initial paint. checkForUpdatesAndNotify swallows "no update" silently.
  setTimeout(() => {
    void updater.checkForUpdatesAndNotify().catch((err: unknown) => {
      console.warn('[autoUpdater] initial check failed:', err instanceof Error ? err.message : err);
    });
  }, 5000);
}

function buildReleaseNotesUrl(version: string | undefined): string | null {
  if (!version) return null;
  return `https://github.com/apicircle/studio/releases/tag/v${version}`;
}
