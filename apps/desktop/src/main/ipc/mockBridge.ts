import { ipcMain } from 'electron';
import type { MockServer } from '@apicircle/shared';
import type { MockManager } from '../mock/mockManager';

// =============================================================================
// IPC bridge for the mock manager. Renderer calls these via the contextBridge
// `apicircleDesktop.mock.*` namespace defined in preload.ts.
// =============================================================================

const CHANNEL = {
  start: 'apicircle:mock:start',
  stop: 'apicircle:mock:stop',
  list: 'apicircle:mock:list',
  getRuntime: 'apicircle:mock:getRuntime',
  stopAll: 'apicircle:mock:stopAll',
} as const;

export function registerMockBridge(manager: MockManager): void {
  ipcMain.handle(CHANNEL.start, async (_event, server: MockServer, opts?: { port?: number }) => {
    return manager.start(server, opts ?? {});
  });
  ipcMain.handle(CHANNEL.stop, async (_event, serverId: string) => {
    await manager.stop(serverId);
    return { ok: true };
  });
  ipcMain.handle(CHANNEL.list, () => manager.list());
  ipcMain.handle(CHANNEL.getRuntime, (_event, serverId: string) => manager.getRuntime(serverId));
  ipcMain.handle(CHANNEL.stopAll, async () => {
    await manager.stopAll();
    return { ok: true };
  });
}

export const MOCK_CHANNELS = CHANNEL;
