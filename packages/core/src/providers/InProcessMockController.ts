import type { MockServer, MockRuntimeEntry } from '@apicircle/shared';
import {
  startMockServer,
  stopMockServer,
  type MockServerHandle,
} from '@apicircle/mock-server-core';
import type { MockController, StartMockResult } from './MockController';

/**
 * MockController implementation that owns its mock processes directly via
 * `@apicircle/mock-server-core`. Used by the CLI and any embedder that
 * wants the simplest possible setup. The desktop app supplies a
 * different controller (process-bridge to its main process) so renderer-
 * side state stays consistent.
 */
export class InProcessMockController implements MockController {
  private readonly handles = new Map<string, MockServerHandle>();
  private readonly meta = new Map<string, MockRuntimeEntry>();

  async start(server: MockServer, opts: { port?: number } = {}): Promise<StartMockResult> {
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
    return { port: handle.port, pid: runtime.pid, startedAt: runtime.startedAt };
  }

  async stop(serverId: string): Promise<void> {
    const handle = this.handles.get(serverId);
    if (!handle) return;
    await stopMockServer(handle);
    this.handles.delete(serverId);
    this.meta.delete(serverId);
  }

  async list(): Promise<Array<{ serverId: string; runtime: MockRuntimeEntry }>> {
    return Array.from(this.meta.entries()).map(([serverId, runtime]) => ({
      serverId,
      runtime,
    }));
  }
}
