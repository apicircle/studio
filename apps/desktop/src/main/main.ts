// Electron main process. Mounts a single BrowserWindow that loads the
// web app's prebuilt index.html (resolved relative to this script's
// dist location). The renderer uses a contextBridge-exposed
// `apicircleDesktop` API to wrap secrets with the OS keychain — see
// preload.ts.

import { app, BrowserWindow, nativeImage, session, shell } from 'electron';
import * as path from 'path';
import { ipcMain } from 'electron';
import {
  MockManager,
  McpManager,
  WorkspaceFileManager,
  type WorkspaceWatcher,
  registerMockBridge,
  registerMcpBridge,
  registerWorkspaceFileBridge,
  startWorkspaceFileWatcher,
  registerSecretsBridge,
  registerOAuth2Bridge,
  readWindowBounds,
  writeWindowBounds,
  assertTrustedSender,
  assertHttpUrl,
} from '@apicircle/desktop-shell';
import { registerAutoUpdater } from './autoUpdater';

const WEB_DIST_INDEX = path.resolve(__dirname, '../../../web/dist/index.html');

// Brand mark resolution. The OS launcher icon (Windows EXE .ico, macOS .app
// .icns, Linux .desktop hicolor PNGs) is wired by electron-builder at package
// time. BrowserWindow.icon below is the WINDOW-FRAME icon (Win + Linux) and
// the in-dev dock icon (macOS), so the running app shows the brand even
// before the bundle is signed/installed.
//
// Path layout works in dev AND packaged builds because the `build/`
// directory is whitelisted in electron-builder.yml's `files:` list, so it
// lands inside `app.asar/build/` with the same relative path as the dev
// tree (`apps/desktop/dist/main/main.js` → `../../build/icon.*`).
const APP_ICON_DIR = path.resolve(__dirname, '../../build');
function resolveAppIcon(): string {
  if (process.platform === 'win32') return path.join(APP_ICON_DIR, 'icon.ico');
  if (process.platform === 'darwin') return path.join(APP_ICON_DIR, 'icon.icns');
  return path.join(APP_ICON_DIR, 'icon.png');
}

// Renderer is only ever the bundled file:// origin. We block window.open() to
// any other URL and route http(s) through the system browser instead.
const ALLOWED_RENDERER_ORIGIN_PREFIX = 'file://';

// Content-Security-Policy for the renderer. Kept in sync with the meta tag in
// apps/web/index.html — duplicated deliberately so the policy applies even if
// the meta tag is somehow stripped (build pipeline regression, hostile
// preload swap). For semantics see the comment block in index.html.
const RENDERER_CSP =
  "default-src 'self'; " +
  "script-src 'self'; " +
  "style-src 'self' 'unsafe-inline'; " +
  "img-src 'self' data: blob:; " +
  "font-src 'self' data:; " +
  "connect-src 'self' https: http: ws: wss: blob: data:; " +
  "worker-src 'self' blob:; " +
  "object-src 'none'; " +
  "frame-src 'none'; " +
  "frame-ancestors 'none'; " +
  "base-uri 'self'; " +
  "form-action 'none'";

const mockManager = new MockManager();
let mcpManager: McpManager | null = null;
let workspaceFileManager: WorkspaceFileManager | null = null;
let workspaceWatcher: WorkspaceWatcher | null = null;
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
    icon: resolveAppIcon(),
    // Every flag is spelled out — Electron defaults are safe today, but an
    // upstream default flip would silently regress the app. Defense in depth.
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      experimentalFeatures: false,
      nodeIntegrationInWorker: false,
      nodeIntegrationInSubFrames: false,
    },
  });
  // Block window.open() from the renderer entirely. Any URL the renderer
  // would have opened in a new BrowserWindow (which would inherit our
  // preload!) is routed through the system browser after scheme validation.
  win.webContents.setWindowOpenHandler(({ url }) => {
    try {
      const validated = assertHttpUrl(url, 'window.open url');
      void shell.openExternal(validated);
    } catch (err) {
      console.error('[main] refused window.open:', err);
    }
    return { action: 'deny' };
  });
  // Block in-place navigation away from the bundled file:// renderer. The
  // renderer should never need to leave its bundled origin; if it tries, we
  // assume hostile input and cancel.
  win.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith(ALLOWED_RENDERER_ORIGIN_PREFIX)) {
      event.preventDefault();
      console.error('[main] blocked will-navigate to', url);
    }
  });
  win.webContents.on('will-redirect', (event, url) => {
    if (!url.startsWith(ALLOWED_RENDERER_ORIGIN_PREFIX)) {
      event.preventDefault();
      console.error('[main] blocked will-redirect to', url);
    }
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
  // Intercept the close BEFORE the window is destroyed. On Windows clicking
  // the X destroys the window before `before-quit` fires, so any prompt we
  // tried to show from before-quit would have no webContents to send to.
  // Holding the close here lets the confirm modal render against a live
  // window; once the drain completes we set `quitState = 'complete'` and
  // re-issue close, which falls through this handler the second time.
  win.on('close', (event) => {
    persist();
    if (quitState === 'complete') return;
    const running = snapshotRunningMocks();
    if (running.length === 0) {
      // Nothing to drain — let the close proceed. `before-quit` will still
      // run the (no-op) drainAndQuit path on non-darwin via window-all-closed.
      return;
    }
    // Mocks running: hold the close, prompt the renderer.
    event.preventDefault();
    if (quitState === 'awaiting-user' || quitState === 'shutting-down') return;
    quitState = 'awaiting-user';
    safeSendToRenderer('apicircle:lifecycle:prompt-close', { runningMocks: running });
  });
  void win.loadFile(WEB_DIST_INDEX);
  return win;
}

// OS-keychain secret bridge (safeStorage encrypt/decrypt) and OAuth2 callback
// bridge — both extracted to @apicircle/desktop-shell. Registered at load so
// their handlers exist before the renderer can invoke them.
registerSecretsBridge();
registerOAuth2Bridge();

void app.whenReady().then(() => {
  // Lock down the default session before any window opens. We deny every
  // optional permission (notifications, camera, microphone, geolocation,
  // etc.) because Studio is a developer tools app and genuinely needs none
  // of them. Electron's defaults grant some silently.
  // Clipboard read/write are exempted — safeCopyToClipboard and paste flows
  // need them, and they carry no security risk in a local-first dev tool.
  const clipboardPermissions = new Set([
    'clipboard-read',
    'clipboard-write',
    'clipboard-sanitized-write',
  ]);
  session.defaultSession.setPermissionRequestHandler((_wc, permission, cb) =>
    cb(clipboardPermissions.has(permission)),
  );
  session.defaultSession.setPermissionCheckHandler((_wc, permission) =>
    clipboardPermissions.has(permission),
  );
  // Inject CSP + X-Frame-Options into every response served to the renderer.
  // For file:// loads the meta tag in index.html is the primary mechanism;
  // this header-injection path is what protects us if Studio is ever served
  // over http(s) (web deploy, dev-mode hosted preview, etc.). Kept in sync
  // with index.html — see RENDERER_CSP comment for semantics.
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [RENDERER_CSP],
        'X-Content-Type-Options': ['nosniff'],
        'X-Frame-Options': ['DENY'],
        'Referrer-Policy': ['no-referrer'],
      },
    });
  });
  // macOS dock icon. Packaged .app bundles get this from Info.plist via
  // electron-builder; setting it explicitly here covers `pnpm dev` runs
  // (Electron-the-binary's default would otherwise stamp the generic
  // Electron mark on the dock).
  if (process.platform === 'darwin' && app.dock) {
    try {
      const dockImage = nativeImage.createFromPath(resolveAppIcon());
      if (!dockImage.isEmpty()) app.dock.setIcon(dockImage);
    } catch (err) {
      console.warn('[main] dock.setIcon failed:', err);
    }
  }
  // McpManager + WorkspaceFileManager are constructed after `app` is ready.
  // The file manager owns `~/.apicircle/` (multi-workspace registry +
  // per-id subdirectories); McpManager points AI clients at the same root.
  mcpManager = new McpManager();
  workspaceFileManager = new WorkspaceFileManager({
    workspacesRoot: process.env.APICIRCLE_WORKSPACES_ROOT || undefined,
  });
  void workspaceFileManager.init().catch((err) => {
    console.error('[main] workspace file manager init failed:', err);
  });
  registerMockBridge(mockManager);
  registerMcpBridge(mcpManager);
  registerWorkspaceFileBridge(workspaceFileManager);
  // Start the file watcher BEFORE the main window so any boot-time
  // renderer writes (the hydrate path's initial IDB→disk mirror write)
  // already have `markSelfWrite` wired into the manager. The watcher's
  // `getMainWindow` closure captures the `mainWindow` let binding so it
  // resolves correctly when the window is set a moment later — events
  // fired before then no-op via the `!win` guard in
  // startWorkspaceFileWatcher.
  workspaceWatcher = startWorkspaceFileWatcher(workspaceFileManager, () => mainWindow);
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

// =============================================================================
// Quit-lifecycle state machine.
//
//   idle           → no quit in progress
//   awaiting-user  → renderer modal asking "you have N mocks running, proceed?"
//   shutting-down  → user confirmed; draining mocks + emitting progress
//   complete       → drains done; the next before-quit fires through to exit
//
// `before-quit` fires for X-button on Win/Linux, app menu Quit, Cmd-Q on macOS,
// and our own `app.quit()` calls. We `event.preventDefault()` it on the first
// pass when mocks are running, ask the renderer, then re-quit once the user
// confirms and the drain completes. The `complete` sentinel lets the re-entry
// through without re-prompting.
// =============================================================================
type QuitState = 'idle' | 'awaiting-user' | 'shutting-down' | 'complete';
let quitState: QuitState = 'idle';

interface RunningMockSnapshot {
  serverId: string;
  port: number;
}

function snapshotRunningMocks(): RunningMockSnapshot[] {
  return mockManager.list().map((e) => ({ serverId: e.serverId, port: e.runtime.port }));
}

// Safe webContents.send — no-ops cleanly if the BrowserWindow has been
// destroyed since we last looked. The optional-chain `?.` covers the case
// where mainWindow was never assigned, but a window that has been
// destroyed remains truthy while `webContents.send` throws "Object has
// been destroyed". On Windows the close-X destroys the window before
// `before-quit` fires, so by the time the drain progress events come back
// the window is gone — sending in that state is harmless to skip; the
// drain still needs to complete on the main process side.
function safeSendToRenderer(channel: string, payload?: unknown): void {
  const win = mainWindow;
  if (!win || win.isDestroyed()) return;
  try {
    if (payload === undefined) {
      win.webContents.send(channel);
    } else {
      win.webContents.send(channel, payload);
    }
  } catch (err) {
    // webContents can also be destroyed independently of the BrowserWindow
    // (rare, but seen during fast quit + DevTools-detached races). Don't
    // let the IPC blip abort the shutdown.
    console.warn(`[main] safeSendToRenderer(${channel}) suppressed:`, err);
  }
}

// Drain mocks (with no UI prompt) then quit. Used both when zero mocks are
// running and when the user dismisses the prompt by choosing "Stop & close".
// Sends shutdown-progress events to the renderer so the modal can render an
// X-of-N progress bar. Always ends by setting state to 'complete' and
// calling app.quit() so the next before-quit pass exits cleanly.
async function drainAndQuit(): Promise<void> {
  quitState = 'shutting-down';
  try {
    await mockManager.stopAllWithProgress((completed, total) => {
      safeSendToRenderer('apicircle:lifecycle:shutdown-progress', { completed, total });
    });
  } catch (err) {
    console.error('[main] drainAndQuit failed:', err);
  }
  // Drain any in-flight workspace mirror write so the on-disk file matches
  // whatever the renderer last queued. Renderer would have called its own
  // flush on `beforeunload`, but the IPC handler may still be settling
  // here; this awaits it so the next CLI / MCP read sees the latest state.
  if (workspaceFileManager) {
    try {
      await workspaceFileManager.flush();
    } catch (err) {
      console.error('[main] workspace mirror flush failed:', err);
    }
  }
  // Stop the file watcher AFTER the final flush so any self-writes
  // generated by the flush stay suppressed up to the moment we shut
  // down. (Closing watchers throws on already-closed handles; the
  // method is defensive against that.)
  if (workspaceWatcher) {
    try {
      workspaceWatcher.stop();
    } catch (err) {
      console.error('[main] workspace watcher stop failed:', err);
    }
    workspaceWatcher = null;
  }
  safeSendToRenderer('apicircle:lifecycle:shutdown-complete');
  quitState = 'complete';
  app.quit();
}

ipcMain.handle('apicircle:lifecycle:cancel-close', (event) => {
  assertTrustedSender(event);
  // User dismissed the modal — abort the pending quit. Subsequent close
  // attempts will re-prompt (we reset back to 'idle').
  if (quitState === 'awaiting-user') {
    quitState = 'idle';
  }
});

ipcMain.handle('apicircle:lifecycle:confirm-close', (event) => {
  assertTrustedSender(event);
  // Renderer's modal pressed "Stop & close". Only proceed if we're actually
  // waiting for that answer — defends against a stale modal firing after a
  // cancel, or against a hostile renderer issuing the call out of band.
  if (quitState !== 'awaiting-user') return;
  void drainAndQuit();
});

app.on('window-all-closed', () => {
  // macOS keeps the app alive after the last window closes; everywhere
  // else we exit. By the time we get here the BrowserWindow's `close`
  // handler has either let the close through (no mocks running, or
  // drain completed) — in both cases we're safe to quit.
  if (process.platform === 'darwin') return;
  app.quit();
});

app.on('before-quit', (event) => {
  // Re-entry after drainAndQuit's app.quit(): let the quit proceed.
  if (quitState === 'complete') return;
  // The user-facing prompt is handled in the BrowserWindow `close`
  // handler (it fires before the window is destroyed, which is the only
  // moment we can still show a modal). This path covers quit attempts
  // that bypass `close` — Cmd-Q on macOS with the dock kept open, an
  // explicit `app.quit()` from code, or a `before-quit` from a context
  // where no window exists. In those cases we silently drain so we
  // don't leak listening sockets.
  if (quitState === 'shutting-down' || quitState === 'awaiting-user') {
    // Drain (or the user prompt) is already running. Hold the quit until
    // drainAndQuit re-issues it.
    event.preventDefault();
    return;
  }
  event.preventDefault();
  void drainAndQuit();
});

// Last-resort guards so a stray error in an IPC handler or mock callback
// doesn't crash the main process silently. We log and keep running — quitting
// here turns any renderer-induced exception into a DoS oracle. Truly fatal
// errors will surface elsewhere; Electron itself will terminate on
// unrecoverable conditions.
process.on('uncaughtException', (err) => {
  console.error('[main] uncaught exception:', err);
});
process.on('unhandledRejection', (reason) => {
  console.error('[main] unhandled rejection:', reason);
});
