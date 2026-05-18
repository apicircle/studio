import type { z } from 'zod';
import type { McpToolName } from '@apicircle/shared';
import type { WorkspaceProvider } from '../providers/WorkspaceProvider';
import type { MockController } from '../providers/MockController';

// =============================================================================
// ToolDef — shape every MCP tool implements. The host iterates over the
// registry, registers each tool with `@modelcontextprotocol/sdk`'s `Server`,
// and dispatches incoming `tools/call` messages by `name`.
// =============================================================================

export interface ToolHandlerContext {
  workspace: WorkspaceProvider;
  mock: MockController;
}

export interface ToolDef<S extends z.ZodTypeAny = z.ZodTypeAny> {
  name: McpToolName;
  description: string;
  inputSchema: S;
  handler: (input: z.infer<S>, ctx: ToolHandlerContext) => Promise<unknown>;
}

export type AnyToolDef = ToolDef<z.ZodTypeAny>;
