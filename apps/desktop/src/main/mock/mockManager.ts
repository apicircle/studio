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
    // Drop the bookkeeping FIRST so a hanging close() can't keep us in a
    // half-stopped state. The Hono adapter already force-drops sockets and
    // hard-times-out after CLOSE_TIMEOUT_MS, but if it ever throws here we
    // still want the renderer's `list()` to stop reporting this mock as
    // running — otherwise the UI's Stop button stays jammed.
    this.handles.delete(serverId);
    this.meta.delete(serverId);
    try {
      await stopMockServer(handle);
    } catch (err) {
      console.error(`[MockManager] stopMockServer(${serverId}) threw:`, err);
    }
  }

  async stopAll(): Promise<void> {
    // Parallelise: a single slow mock shouldn't block the others on quit.
    const ids = Array.from(this.handles.keys());
    await Promise.all(ids.map((id) => this.stop(id)));
  }

  /**
   * Like `stopAll`, but yields a `(completed, total)` callback after each
   * mock finishes shutting down. Used by the app-quit confirmation flow so
   * the renderer can render an X-of-N progress bar while the listeners
   * drain in the background. Stops in parallel — `completed` increments in
   * whichever order each `stop()` resolves.
   *
   * Always fires the callback at least once with `(0, total)` so the
   * renderer can size its progress bar before any stop completes (useful
   * when N is large and the first stop has noticeable latency).
   */
  async stopAllWithProgress(onProgress: (completed: number, total: number) => void): Promise<void> {
    const ids = Array.from(this.handles.keys());
    const total = ids.length;
    onProgress(0, total);
    if (total === 0) return;
    let completed = 0;
    await Promise.all(
      ids.map(async (id) => {
        await this.stop(id);
        completed += 1;
        try {
          onProgress(completed, total);
        } catch (err) {
          // Renderer callback shouldn't fail (it's a webContents.send),
          // but if it does we don't want one stuck IPC to block quit.
          console.error('[MockManager] stopAllWithProgress callback threw:', err);
        }
      }),
    );
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
