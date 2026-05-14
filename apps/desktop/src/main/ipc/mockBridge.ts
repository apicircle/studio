import { ipcMain } from 'electron';
import type { MockServer } from '@apicircle/shared';
import type { MockManager } from '../mock/mockManager';
import { assertTrustedSender } from '../security/assertTrustedSender';

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
  ipcMain.handle(CHANNEL.start, async (event, server: MockServer, opts?: { port?: number }) => {
    assertTrustedSender(event);
    return manager.start(server, opts ?? {});
  });
  ipcMain.handle(CHANNEL.stop, async (event, serverId: string) => {
    assertTrustedSender(event);
    await manager.stop(serverId);
    return { ok: true };
  });
  ipcMain.handle(CHANNEL.list, (event) => {
    assertTrustedSender(event);
    return manager.list();
  });
  ipcMain.handle(CHANNEL.getRuntime, (event, serverId: string) => {
    assertTrustedSender(event);
    return manager.getRuntime(serverId);
  });
  ipcMain.handle(CHANNEL.stopAll, async (event) => {
    assertTrustedSender(event);
    await manager.stopAll();
    return { ok: true };
  });
}

export const MOCK_CHANNELS = CHANNEL;
