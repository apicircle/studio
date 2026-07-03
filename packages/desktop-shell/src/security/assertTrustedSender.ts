// IPC sender validation helper.
//
// Every `ipcMain.handle` accepts messages from any frame inside the
// BrowserWindow's webContents — including child frames, iframes (which we
// currently block via setWindowOpenHandler) and any future popup. The
// renderer is only ever the bundled web dist loaded over `file://`. If
// `event.senderFrame.url` ever points anywhere else, something has gone
// wrong (sub-frame spawn, navigation we didn't expect, malicious extension
// in dev) and the handler should refuse.
//
// We deliberately use a prefix check on `file://` rather than an exact-URL
// match because the bundled path differs by OS / install location and the
// renderer can legitimately use fragment / query for client-side routing.
//
// Combined with the navigation lockdown in createWindow (will-navigate /
// will-redirect / setWindowOpenHandler), this is belt-and-braces — but
// cheap enough that we apply it to every handler.

import type { IpcMainInvokeEvent } from 'electron';

/** Throws if the IPC sender frame is not the bundled file:// renderer. */
export function assertTrustedSender(event: IpcMainInvokeEvent): void {
  const url = event.senderFrame?.url ?? '';
  if (!url.startsWith('file://')) {
    throw new Error(`Untrusted IPC sender: ${url || '(unknown)'}`);
  }
}
