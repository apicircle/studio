// Mock-server schema. Two halves:
//
//   • `MockServer` lives in WorkspaceSynced — definitions push to git so
//     teams share their mock libraries.
//   • `MockRuntime` lives in WorkspaceLocal — runtime status (port, pid,
//     request count) is per-host and never round-trips through git.
//
// Sources are tagged unions over the formats we ingest. `kind: 'manual'`
// is the lowest-friction path: the user defines endpoints in the editor
// directly. The other kinds carry the verbatim raw spec; the parser in
// `@apicircle/mock-server-core` derives a `MockEndpoint[]` from it.

import type { HttpMethod } from './types';

export interface MockEndpoint {
  /** Stable id; survives spec re-parses so per-endpoint overrides keep matching. */
  id: string;
  method: HttpMethod;
  /** OpenAPI-style path template, e.g. `/pets/{id}`. Hono routes get derived from this. */
  pathPattern: string;
  status: number;
  headers: Array<{ key: string; value: string }>;
  /** Verbatim body payload sent on match (JSON / text / XML). */
  body: string;
  /** Optional artificial latency before responding. */
  delayMs?: number;
  /** Optional: name of the OpenAPI example chosen when multiple were present. */
  example?: string;
}

export interface MockEndpointOverride {
  status?: number;
  headers?: Array<{ key: string; value: string }>;
  body?: string;
  delayMs?: number;
}

export type MockServerSource =
  | { kind: 'openapi'; spec: string; format: 'json' | 'yaml' }
  | { kind: 'postman'; collection: string }
  | { kind: 'insomnia'; export: string }
  | { kind: 'manual'; endpoints: MockEndpoint[] };

export interface MockServer {
  id: string;
  name: string;
  source: MockServerSource;
  /**
   * Resolved endpoint table — populated when the source is parsed; persisted
   * so the desktop app doesn't re-parse on every start. Empty array for
   * `kind: 'manual'`.
   */
  endpoints: MockEndpoint[];
  /**
   * User-supplied per-endpoint overrides (status / body / delay) layered on
   * top of source endpoints at runtime, keyed by `MockEndpoint.id`.
   */
  overrides: Record<string, MockEndpointOverride>;
  /** Default port used when starting; null = pick a free port at start. */
  defaultPort: number | null;
  cors: { enabled: boolean; origins: string[] };
  createdAt: string;
  updatedAt: string;
}

/** Lives in WorkspaceLocal — never pushed to git. */
export interface MockRuntime {
  /** Keyed by mockServerId. Absent = not running. */
  active: Record<string, MockRuntimeEntry>;
}

export interface MockRuntimeEntry {
  port: number;
  /** null in browser-preview mode where there's no OS process. */
  pid: number | null;
  startedAt: string;
  lastError: string | null;
  requestCount: number;
}
