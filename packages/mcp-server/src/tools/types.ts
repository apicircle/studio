import type { z } from 'zod';
import type { McpToolName } from '@apicircle/shared';
import type { WorkspaceProvider } from '@apicircle/core/providers';
import type { MockController } from '@apicircle/core/providers';
import type { Workspaces } from '@apicircle/core/providers';

// =============================================================================
// ToolDef — shape every MCP tool implements. The host iterates over the
// registry, registers each tool with `@modelcontextprotocol/sdk`'s `Server`,
// and dispatches incoming `tools/call` messages by `name`.
//
// `workspace` is the ACTIVE workspace's provider (legacy tools consume this
// transparently). `workspaces` is the multi-workspace surface — tools that
// need to enumerate or drill into a specific workspace use it. Single-
// workspace hosts wrap the lone provider in `SingleWorkspaceAdapter` so
// the field is always present.
// =============================================================================

export interface ToolHandlerContext {
  workspace: WorkspaceProvider;
  workspaces: Workspaces;
  mock: MockController;
}

/**
 * Namespaced name for an out-of-tree (Enterprise) tool. The `ee.` prefix keeps
 * it clear of the 94 public `McpToolName` values, so an injected tool never
 * collides with — or is mistaken for — a tool in the published catalog.
 */
export type EnterpriseToolName = `ee.${string}`;

/**
 * Any name a `ToolDef` may carry: a public catalog `McpToolName`, or an
 * out-of-tree extension tool's namespaced `<namespace>.<tool>` name. The core is
 * edition-agnostic — it does NOT hardcode any downstream edition's prefix; an
 * injected tool (via `createMcpServer({ tools })`) picks its own reserved
 * namespace (e.g. `ee.*`) and keeps it clear of the public catalog.
 */
export type ExtensionToolName = McpToolName | `${string}.${string}`;

export interface ToolDef<S extends z.ZodTypeAny = z.ZodTypeAny> {
  name: ExtensionToolName;
  description: string;
  inputSchema: S;
  handler: (input: z.infer<S>, ctx: ToolHandlerContext) => Promise<unknown>;
}

export type AnyToolDef = ToolDef<z.ZodTypeAny>;
