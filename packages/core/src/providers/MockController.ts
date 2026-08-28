import type { MockServer, MockRuntimeEntry } from '@apicircle/shared';

// =============================================================================
// MockController — abstraction over the actual mock-server runtime so the MCP
// tool handlers don't have to know whether they're running in Electron (where
// the desktop main process owns the lifecycle), CLI (where this process owns
// it directly via @apicircle/mock-server-core), or a future hosted service.
// =============================================================================

export interface StartMockResult {
  port: number;
  pid: number | null;
  startedAt: string;
}

export interface MockController {
  start(server: MockServer, opts?: { port?: number }): Promise<StartMockResult>;
  stop(serverId: string): Promise<void>;
  /** Snapshot of currently running mocks. */
  list(): Promise<Array<{ serverId: string; runtime: MockRuntimeEntry }>>;
}
