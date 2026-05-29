import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import { z } from 'zod';
import type { AnyToolDef, ToolHandlerContext } from '../tools/types';
import { MCP_PACKAGE_VERSION } from '../packageVersion';

// =============================================================================
// McpHost — wraps `@modelcontextprotocol/sdk`'s `McpServer`. The thin layer
// here exists so we can swap SDK versions or transports without touching
// every tool. Each ToolDef is registered with the SDK's high-level
// `registerTool(name, { description, inputSchema }, cb)` API.
//
// `inputSchema` is a Zod object on our side; the SDK wants a raw shape
// (object of fields → schema), so we extract `.shape` when registering.
// =============================================================================

const PACKAGE_NAME = 'apicircle-mcp';

export interface McpHostOptions {
  serverInfo?: { name: string; version: string };
  context: ToolHandlerContext;
  tools: AnyToolDef[];
}

export class McpHost {
  readonly server: McpServer;
  private readonly tools: AnyToolDef[];
  private readonly context: ToolHandlerContext;

  constructor(options: McpHostOptions) {
    this.server = new McpServer({
      name: options.serverInfo?.name ?? PACKAGE_NAME,
      version: options.serverInfo?.version ?? MCP_PACKAGE_VERSION,
    });
    this.tools = options.tools;
    this.context = options.context;
    this.registerAll();
  }

  private registerAll(): void {
    for (const tool of this.tools) {
      const shape = isZodObject(tool.inputSchema) ? tool.inputSchema.shape : undefined;
      this.server.registerTool(
        tool.name,
        {
          description: tool.description,
          ...(shape ? { inputSchema: shape } : {}),
        },
        async (args: unknown) => {
          try {
            const parsed = tool.inputSchema.parse(args ?? {});
            const result = await tool.handler(parsed, this.context);
            return {
              content: [
                {
                  type: 'text' as const,
                  text: JSON.stringify(result, null, 2),
                },
              ],
            };
          } catch (err) {
            return {
              isError: true,
              content: [
                {
                  type: 'text' as const,
                  text: formatError(err),
                },
              ],
            };
          }
        },
      );
    }
  }

  /** Connect the underlying server to a transport (defaults to stdio). */
  async connect(transport?: Transport): Promise<void> {
    await this.server.connect(transport ?? new StdioServerTransport());
  }

  async close(): Promise<void> {
    await this.server.close();
  }
}

function isZodObject(schema: unknown): schema is z.ZodObject<z.ZodRawShape> {
  return schema instanceof z.ZodObject;
}

function formatError(err: unknown): string {
  if (err instanceof z.ZodError) {
    return `Validation failed: ${err.issues
      .map((i) => `${i.path.join('.') || '<root>'}: ${i.message}`)
      .join('; ')}`;
  }
  if (err instanceof Error) return err.message;
  return String(err);
}
