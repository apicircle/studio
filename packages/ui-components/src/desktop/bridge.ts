// =============================================================================
// Canonical type contract for the `window.apicircleDesktop` bridge exposed by
// `apps/desktop/src/main/preload.ts`. Before this file existed each consumer
// redeclared its own ad-hoc interface for the surface it cared about, and one
// of those duplicates drifted (renderer expected `workspaceDir`, main returned
// `workspacesRoot`) — the Workspace Mirror row hung on "Loading…" forever
// because the destructure resolved to `undefined`.
//
// To make that class of drift impossible:
//   1. This file owns the renderer-facing shape of every bridge surface the
//      renderer actually consumes.
//   2. `preload.ts` writes its bridge object with `satisfies DesktopBridge` —
//      missing or mistyped fields fail `pnpm check`.
//   3. Consumers call the typed accessors below (`getDesktopMcpBridge`,
//      `getDesktopWorkspaceFileSurface`, …) instead of casting `window` ad-hoc.
//
// Add surfaces here as new consumers need them; do not redeclare locally.
// =============================================================================

import type {
  McpToolName,
  MockRuntimeEntry,
  MockServer,
  WorkspaceLocal,
  WorkspaceSynced,
} from '@apicircle/shared';
import type { WorkspaceRegistry, WorkspaceRegistryEntry } from '@apicircle/core/workspace/registry';

// ---------- MCP surface --------------------------------------------------

/**
 * Two valid-JSON renderings of the same MCP config snippet, differing only in
 * how the Windows workspace path is encoded inside JSON strings.
 *
 * - `forwardSlash`: `"C:/Users/.../workspaces"` — no escapes, easier to read.
 *   Node.js, Electron, and Windows file APIs all accept forward slashes, so
 *   this works as-is when pasted into any AI client config.
 * - `escaped`: `"C:\\Users\\...\\workspaces"` — the literal OS path with JSON
 *   string escapes. What `JSON.stringify` produces by default.
 * - `identical`: true on macOS/Linux where paths have no backslashes; the UI
 *   uses this to hide the picker on platforms where there's only one form.
 */
export interface ConfigSnippetVariants {
  forwardSlash: string;
  escaped: string;
  identical: boolean;
}

export interface DesktopMcpBridge {
  status(): Promise<{ workspaceDir: string; binary: string }>;
  getConfigSnippet(client: string): Promise<ConfigSnippetVariants>;
  getConfigPath(client: string): Promise<string | null>;
  toolCatalog(): Promise<readonly McpToolName[]>;
}

// ---------- WorkspaceFile (mirror) surface -------------------------------

/**
 * Reserved discriminator the watcher uses to signal a `registry.json`
 * change (vs a per-workspace `workspace.json` change). Exported so
 * consumers don't hardcode the string literal.
 */
export const WORKSPACE_FILE_REGISTRY_CHANGE = 'registry';

/**
 * Payload of the `externalChange` event the main process emits when the
 * file watcher detects a write the desktop didn't make (MCP server, CLI,
 * user editing JSON by hand). The renderer listens and calls
 * `refreshFromDisk` automatically so external writes appear without the
 * user clicking Refresh.
 *
 * `workspaceId === WORKSPACE_FILE_REGISTRY_CHANGE` (the literal
 * `'registry'`) means `registry.json` changed; any other value is a
 * per-workspace id whose `workspace.json` changed.
 */
export interface WorkspaceFileExternalChange {
  workspaceId: string;
}

export interface DesktopWorkspaceFileBridge {
  status(): Promise<{ workspacesRoot: string }>;
  init(): Promise<{ registry: WorkspaceRegistry }>;
  readRegistry(): Promise<WorkspaceRegistry>;
  writeRegistry(registry: WorkspaceRegistry): Promise<void>;
  readWorkspace(
    workspaceId: string,
  ): Promise<{ synced: WorkspaceSynced; local: WorkspaceLocal } | null>;
  writeWorkspace(payload: {
    workspaceId: string;
    synced: WorkspaceSynced;
    local: WorkspaceLocal;
  }): Promise<void>;
  deleteWorkspace(workspaceId: string): Promise<WorkspaceRegistry>;
  registerWorkspace(entry: WorkspaceRegistryEntry): Promise<WorkspaceRegistry>;
  setActiveWorkspace(workspaceId: string): Promise<WorkspaceRegistry>;
  flush(): Promise<void>;
  /**
   * Subscribe to external-write events. Returns an unsubscribe fn.
   * Optional so older preload builds (without the watcher) don't break
   * compile-time checks during a staged rollout.
   */
  onExternalChange?(listener: (event: WorkspaceFileExternalChange) => void): () => void;
}

// ---------- Mock-server surface ------------------------------------------

export interface DesktopMockBridge {
  start(server: MockServer, opts?: { port?: number }): Promise<MockRuntimeEntry>;
  stop(serverId: string): Promise<{ ok: boolean }>;
  list(): Promise<Array<{ serverId: string; runtime: MockRuntimeEntry }>>;
  getRuntime(serverId: string): Promise<MockRuntimeEntry | null>;
  stopAll(): Promise<{ ok: boolean }>;
}

// ---------- Bridge contract ----------------------------------------------

/**
 * The subset of the `apicircleDesktop` surface that the renderer's typed
 * accessors below depend on. Preload should `satisfies` this so adding or
 * renaming a field on either side becomes a typecheck error, not a runtime
 * "Loading…" forever.
 *
 * This is intentionally a partial of the full preload surface — other
 * sub-bridges (oauth2, lifecycle, update, secret) keep their existing
 * ad-hoc shapes for now; migrate them here when you next touch them.
 */
export interface DesktopBridgeContract {
  mcp: DesktopMcpBridge;
  workspaceFile: DesktopWorkspaceFileBridge;
  mock: DesktopMockBridge;
}

// ---------- Typed accessors ----------------------------------------------

interface BridgeWindow {
  apicircleDesktop?: Partial<DesktopBridgeContract>;
}

function getBridgeRoot(): Partial<DesktopBridgeContract> | null {
  if (typeof globalThis === 'undefined') return null;
  return (globalThis as unknown as BridgeWindow).apicircleDesktop ?? null;
}

export function getDesktopMcpBridge(): DesktopMcpBridge | null {
  return getBridgeRoot()?.mcp ?? null;
}

export function getDesktopWorkspaceFileBridge(): DesktopWorkspaceFileBridge | null {
  return getBridgeRoot()?.workspaceFile ?? null;
}

export function getDesktopMockBridge(): DesktopMockBridge | null {
  return getBridgeRoot()?.mock ?? null;
}
