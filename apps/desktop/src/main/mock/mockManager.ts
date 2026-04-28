import {
  startMockServer,
  stopMockServer,
  type MockServerHandle,
} from '@apicircle/mock-server-core';
import type { MockServer, MockRuntimeEntry } from '@apicircle/shared';

// =============================================================================
// MockManager — owns a Map<mockServerId, MockServerHandle> for the Electron
// main process. Each `start` boots a Hono server in-process; `stop` tears it
// down. Renderer talks to this via IPC (`apicircle:mock:*`) — see
// `apps/desktop/src/main/ipc/mockBridge.ts`.
//
// Living in the main process keeps the mock alive across renderer reloads
// (e.g. when the user opens DevTools). On `window-all-closed`, main.ts calls
// `stopAll()` so we don't leak ports between app sessions.
// =============================================================================

export interface MockManagerEntry {
  serverId: string;
  runtime: MockRuntimeEntry;
}

export class MockManager {
  private readonly handles = new Map<string, MockServerHandle>();
  private readonly meta = new Map<string, MockRuntimeEntry>();

  async start(server: MockServer, opts: { port?: number } = {}): Promise<MockRuntimeEntry> {
    if (this.handles.has(server.id)) {
      throw new Error(`Mock '${server.id}' is already running`);
    }
    const handle = await startMockServer(server, {
      port: opts.port ?? server.defaultPort ?? undefined,
    });
    const runtime: MockRuntimeEntry = {
      port: handle.port,
      pid: process.pid,
      startedAt: new Date().toISOString(),
      lastError: null,
      requestCount: 0,
    };
    this.handles.set(server.id, handle);
    this.meta.set(server.id, runtime);
    return runtime;
  }

  async stop(serverId: string): Promise<void> {
    const handle = this.handles.get(serverId);
    if (!handle) return;
    await stopMockServer(handle);
    this.handles.delete(serverId);
    this.meta.delete(serverId);
  }

  async stopAll(): Promise<void> {
    const ids = Array.from(this.handles.keys());
    for (const id of ids) {
      await this.stop(id);
    }
  }

  list(): MockManagerEntry[] {
    return Array.from(this.meta.entries()).map(([serverId, runtime]) => ({
      serverId,
      runtime,
    }));
  }

  getRuntime(serverId: string): MockRuntimeEntry | null {
    return this.meta.get(serverId) ?? null;
  }
}
