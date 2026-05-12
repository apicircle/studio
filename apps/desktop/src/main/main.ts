// Electron main process. Mounts a single BrowserWindow that loads the
// web app's prebuilt index.html (resolved relative to this script's
// dist location). The renderer uses a contextBridge-exposed
// `apicircleDesktop` API to wrap secrets with the OS keychain — see
// preload.ts.

import { app, BrowserWindow, safeStorage } from 'electron';
import * as path from 'path';
import { ipcMain } from 'electron';
import { MockManager } from './mock/mockManager';
import { McpManager } from './mcp/mcpManager';
import { registerMockBridge } from './ipc/mockBridge';
import { registerMcpBridge } from './ipc/mcpBridge';
import {
  findFreePort,
  openInBrowser,
  startCallbackServer,
  type CallbackResult,
} from './oauth2Server';
import { readWindowBounds, writeWindowBounds } from './windowState';
import { registerAutoUpdater } from './autoUpdater';

const WEB_DIST_INDEX = path.resolve(__dirname, '../../../web/dist/index.html');

const mockManager = new MockManager();
let mcpManager: McpManager | null = null;
let mainWindow: BrowserWindow | null = null;

function createWindow(): BrowserWindow {
  // Restore the user's last frame if it's still on-screen; fall back to a
  // sensible default otherwise. `readWindowBounds` clamps to a real
  // display so a disconnected monitor doesn't strand the window.
  const restored = readWindowBounds();
  const win = new BrowserWindow({
    ...(restored ?? { width: 1280, height: 820 }),
    minWidth: 960,
    minHeight: 600,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  // Save bounds on resize / move (debounced via the OS event coalescing —
  // these fire at end-of-drag on Windows / macOS) and on graceful close.
  const persist = () => {
    if (!win.isDestroyed() && !win.isMinimized() && !win.isMaximized()) {
      writeWindowBounds(win.getBounds());
    }
  };
  win.on('resize', persist);
  win.on('move', persist);
  win.on('close', persist);
  void win.loadFile(WEB_DIST_INDEX);
  return win;
}

// IPC handlers — the preload's contextBridge proxies to these. We do
// the actual safeStorage calls in the main process because the API
// isn't available in sandboxed renderer / preload.
ipcMain.handle('apicircle:secret:isAvailable', () => safeStorage.isEncryptionAvailable());

ipcMain.handle('apicircle:secret:encrypt', (_event, plaintext: string) => {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('OS keychain not available on this platform');
  }
  const buffer = safeStorage.encryptString(plaintext);
  return buffer.toString('base64');
});

ipcMain.handle('apicircle:secret:decrypt', (_event, ciphertextBase64: string) => {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('OS keychain not available on this platform');
  }
  const buffer = Buffer.from(ciphertextBase64, 'base64');
  return safeStorage.decryptString(buffer);
});

// OAuth2 callback bridge — see oauth2Server.ts for the full flow.
ipcMain.handle('apicircle:oauth2:findFreePort', async (_event, preferred: number) => {
  return findFreePort(preferred);
});

ipcMain.handle(
  'apicircle:oauth2:startFlow',
  async (
    _event,
    args: {
      authorizeUrl: string;
      port: number;
      mode: 'code' | 'token';
      callbackPath?: string;
      timeoutMs?: number;
    },
  ): Promise<CallbackResult> => {
    // Sanity-check the timeout. Sub-5-second timeouts are guaranteed to
    // fire before the user even sees the IdP consent screen — there's no
    // realistic flow that completes that fast. Reject up-front so a bad
    // caller can't burn ports on doomed flows.
    if (args.timeoutMs !== undefined && args.timeoutMs < 5000) {
      throw new Error('timeoutMs must be at least 5000ms');
    }
    // Race the callback promise with the browser-open call. If the
    // browser fails to open, the user can still complete the flow by
    // pasting the URL — but we surface the failure for diagnostics.
    const callbackPromise = startCallbackServer({
      port: args.port,
      mode: args.mode,
      callbackPath: args.callbackPath,
      timeoutMs: args.timeoutMs,
    });
    try {
      await openInBrowser(args.authorizeUrl);
    } catch (err) {
      // Don't reject the callback yet — user might paste the URL
      // manually. Log + continue waiting for the redirect.
      console.error('[oauth2] failed to open authorize URL in browser:', err);
    }
    return callbackPromise;
  },
);

void app.whenReady().then(() => {
  // McpManager is constructed after `app` is ready because it reads
  // `app.getPath('userData')`, which is only valid post-ready.
  mcpManager = new McpManager();
  registerMockBridge(mockManager);
  registerMcpBridge(mcpManager);
  mainWindow = createWindow();
  // Auto-update bridge — emits `apicircle:update:available` to the
  // renderer once an update has been downloaded. No-ops cleanly when
  // electron-updater isn't installed (e.g. fresh clone) so the rest of
  // the app keeps working.
  void registerAutoUpdater(() => mainWindow);
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) mainWindow = createWindow();
  });
});

app.on('window-all-closed', () => {
  // macOS apps stay alive when the last window closes; everywhere else
  // we shut down so the dock / taskbar icon disappears.
  void mockManager.stopAll();
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  // Belt-and-braces: if the user quits via the app menu / Cmd-Q, ensure
  // every spawned mock server is torn down before the process exits.
  void mockManager.stopAll();
});

// Last-resort guards so a stray error in an IPC handler or mock callback
// doesn't crash the main process silently. We log + tear down spawned
// children + quit cleanly — better than zombie processes hanging around.
process.on('uncaughtException', (err) => {
  console.error('[main] uncaught exception:', err);
  void mockManager.stopAll();
  app.quit();
});
process.on('unhandledRejection', (reason) => {
  console.error('[main] unhandled rejection:', reason);
});
