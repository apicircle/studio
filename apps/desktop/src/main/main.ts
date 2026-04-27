// Electron main process. Mounts a single BrowserWindow that loads the
// web app's prebuilt index.html (resolved relative to this script's
// dist location). The renderer uses a contextBridge-exposed
// `apicircleDesktop` API to wrap secrets with the OS keychain — see
// preload.ts.

import { app, BrowserWindow, safeStorage } from 'electron';
import * as path from 'path';
import { ipcMain } from 'electron';

const WEB_DIST_INDEX = path.resolve(__dirname, '../../../web/dist/index.html');

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1280,
    height: 820,
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

void app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  // macOS apps stay alive when the last window closes; everywhere else
  // we shut down so the dock / taskbar icon disappears.
  if (process.platform !== 'darwin') app.quit();
});
