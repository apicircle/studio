// Electron main process. Mounts a single BrowserWindow that loads the
// web app's prebuilt index.html (resolved relative to this script's
// dist location). The renderer uses a contextBridge-exposed
// `apicircleDesktop` API to wrap secrets with the OS keychain — see
// preload.ts.

import { app, BrowserWindow, nativeImage, safeStorage, session, shell } from 'electron';
import * as path from 'path';
import { ipcMain } from 'electron';
import { MockManager } from './mock/mockManager';
import { McpManager } from './mcp/mcpManager';
import { WorkspaceFileManager } from './workspaceFile/workspaceFileManager';
import { registerMockBridge } from './ipc/mockBridge';
import { registerMcpBridge } from './ipc/mcpBridge';
import { registerWorkspaceFileBridge } from './ipc/workspaceFileBridge';
import {
  findFreePort,
  openInBrowser,
  startCallbackServer,
  type CallbackResult,
} from './oauth2Server';
import { readWindowBounds, writeWindowBounds } from './windowState';
import { registerAutoUpdater } from './autoUpdater';
import { assertTrustedSender } from './security/assertTrustedSender';

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

// Hard cap on plaintext / ciphertext we'll accept from the renderer over IPC.
// The renderer should never need to encrypt a value larger than this; bound
// it so a compromised renderer can't OOM the main process with a 1GB string.
const MAX_SECRET_PAYLOAD_BYTES = 1_048_576; // 1 MiB

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

// Only these schemes are safe to hand to shell.openExternal — anything else
// can be a registered OS protocol handler (smb:, ms-msdt:, file:, etc.) and
// becomes an RCE vector when the renderer or workspace data is compromised.
function assertHttpUrl(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 8192) {
    throw new Error(`${label} must be a non-empty string under 8192 chars`);
  }
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`${label} is not a valid URL`);
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    throw new Error(`${label} must use https: or http: (got ${parsed.protocol})`);
  }
  // http: is only allowed for explicit localhost dev IdPs — everywhere else
  // we require https: so a malicious workspace can't downgrade transports.
  if (parsed.protocol === 'http:') {
    const host = parsed.hostname;
    const isLoopback =
      host === 'localhost' || host === '127.0.0.1' || host === '[::1]' || host === '::1';
    if (!isLoopback) {
      throw new Error(`${label} http: is only permitted for localhost (got ${host})`);
    }
  }
  return parsed.toString();
}

const mockManager = new MockManager();
let mcpManager: McpManager | null = null;
let workspaceFileManager: WorkspaceFileManager | null = null;
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

// IPC handlers — the preload's contextBridge proxies to these. We do
// the actual safeStorage calls in the main process because the API
// isn't available in sandboxed renderer / preload.
ipcMain.handle('apicircle:secret:isAvailable', (event) => {
  assertTrustedSender(event);
  return safeStorage.isEncryptionAvailable();
});

ipcMain.handle('apicircle:secret:encrypt', (event, plaintext: unknown) => {
  assertTrustedSender(event);
  if (typeof plaintext !== 'string') {
    throw new Error('plaintext must be a string');
  }
  if (plaintext.length > MAX_SECRET_PAYLOAD_BYTES) {
    throw new Error('plaintext exceeds MAX_SECRET_PAYLOAD_BYTES');
  }
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('OS keychain not available on this platform');
  }
  const buffer = safeStorage.encryptString(plaintext);
  return buffer.toString('base64');
});

ipcMain.handle('apicircle:secret:decrypt', (event, ciphertextBase64: unknown) => {
  assertTrustedSender(event);
  if (typeof ciphertextBase64 !== 'string') {
    throw new Error('ciphertext must be a base64 string');
  }
  if (ciphertextBase64.length > MAX_SECRET_PAYLOAD_BYTES * 2) {
    // base64 inflates by ~4/3; allow a margin then hard-cap.
    throw new Error('ciphertext exceeds MAX_SECRET_PAYLOAD_BYTES');
  }
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('OS keychain not available on this platform');
  }
  const buffer = Buffer.from(ciphertextBase64, 'base64');
  return safeStorage.decryptString(buffer);
});

// OAuth2 callback bridge — see oauth2Server.ts for the full flow.
ipcMain.handle('apicircle:oauth2:findFreePort', async (event, preferred: unknown) => {
  assertTrustedSender(event);
  // Clamp the preferred port to the unprivileged range. A compromised renderer
  // could otherwise probe privileged ports (22, 80, 443) or coerce us into
  // binding ephemeral and reading the result, both of which we should reject.
  if (typeof preferred !== 'number' || !Number.isInteger(preferred)) {
    throw new Error('preferred must be an integer');
  }
  if (preferred < 1024 || preferred > 65535) {
    throw new Error('preferred must be in 1024..65535');
  }
  return findFreePort(preferred);
});

ipcMain.handle(
  'apicircle:oauth2:startFlow',
  async (
    event,
    args: {
      authorizeUrl: string;
      port: number;
      mode: 'code' | 'token';
      callbackPath?: string;
      timeoutMs?: number;
    },
  ): Promise<CallbackResult> => {
    assertTrustedSender(event);
    // Sanity-check the timeout. Sub-5-second timeouts are guaranteed to
    // fire before the user even sees the IdP consent screen — there's no
    // realistic flow that completes that fast. Reject up-front so a bad
    // caller can't burn ports on doomed flows.
    if (args.timeoutMs !== undefined && args.timeoutMs < 5000) {
      throw new Error('timeoutMs must be at least 5000ms');
    }
    // Scheme allowlist: an unvalidated URL handed to shell.openExternal is an
    // RCE vector on Windows (ms-msdt:, smb:, file:, custom protocol handlers).
    // The renderer should only ever feed us https: IdP authorize URLs, with
    // a narrow http:+loopback escape hatch for local-IdP testing.
    const safeAuthorizeUrl = assertHttpUrl(args.authorizeUrl, 'authorizeUrl');
    // Validate callbackPath shape — we string-compare it inside the http
    // handler, and a renderer-controlled value should look like a path.
    if (args.callbackPath !== undefined) {
      if (
        typeof args.callbackPath !== 'string' ||
        !/^\/[A-Za-z0-9_\-./]{0,128}$/.test(args.callbackPath)
      ) {
        throw new Error('callbackPath must match /^\\/[A-Za-z0-9_\\-./]{0,128}$/');
      }
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
      await openInBrowser(safeAuthorizeUrl);
    } catch (err) {
      // Don't reject the callback yet — user might paste the URL
      // manually. Log + continue waiting for the redirect.
      console.error('[oauth2] failed to open authorize URL in browser:', err);
    }
    return callbackPromise;
  },
);

void app.whenReady().then(() => {
  // Lock down the default session before any window opens. We deny every
  // optional permission (notifications, camera, microphone, geolocation,
  // clipboard-read, etc.) because Studio is a developer tools app and
  // genuinely needs none of them. Electron's defaults grant some silently.
  session.defaultSession.setPermissionRequestHandler((_wc, _permission, cb) => cb(false));
  session.defaultSession.setPermissionCheckHandler(() => false);
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
  // McpManager + WorkspaceFileManager are constructed after `app` is ready
  // because they read `app.getPath('userData')`, which is only valid
  // post-ready. The file manager owns `userData/workspaces/` (multi-workspace
  // registry + per-id subdirectories); McpManager points AI clients at the
  // same root. `init()` runs the legacy-layout migration once.
  mcpManager = new McpManager();
  workspaceFileManager = new WorkspaceFileManager();
  void workspaceFileManager.init().catch((err) => {
    console.error('[main] workspace file manager init failed:', err);
  });
  registerMockBridge(mockManager);
  registerMcpBridge(mcpManager);
  registerWorkspaceFileBridge(workspaceFileManager);
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
