import { ipcMain } from 'electron';
import type { MockServer, MockServerSource } from '@apicircle/shared';
import { parseSourceToEndpoints } from '@apicircle/mock-server-core';
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
  parse: 'apicircle:mock:parse',
} as const;

export function registerMockBridge(manager: MockManager): void {
  // Parse a spec-blob source into an endpoint table in the Node main process,
  // where swagger-parser can resolve external `$ref`s (the browser build can
  // only resolve in-document refs). Stateless — doesn't touch the manager.
  ipcMain.handle(CHANNEL.parse, async (event, source: MockServerSource) => {
    assertTrustedSender(event);
    return parseSourceToEndpoints(source);
  });
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
