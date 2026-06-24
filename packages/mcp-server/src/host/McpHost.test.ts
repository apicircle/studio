import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import type { JSONRPCMessage } from '@modelcontextprotocol/sdk/types.js';
import { McpHost } from './McpHost';
import { MCP_PACKAGE_VERSION } from '../packageVersion';
import type { AnyToolDef, ToolHandlerContext } from '../tools/types';

// Trivial paired transport — the host and client each get a Transport whose
// `send` calls into the other's `onmessage`. Lets us exercise the whole
// JSON-RPC round-trip in-process without spawning child processes.
class PairedTransport implements Transport {
  onclose?: () => void;
  onerror?: (err: Error) => void;
  onmessage?: (msg: JSONRPCMessage) => void;
  partner?: PairedTransport;

  async start(): Promise<void> {}

  async send(msg: JSONRPCMessage): Promise<void> {
    queueMicrotask(() => this.partner?.onmessage?.(msg));
  }

  async close(): Promise<void> {
    this.onclose?.();
  }
}

function pair(): { server: PairedTransport; client: PairedTransport } {
  const server = new PairedTransport();
  const client = new PairedTransport();
  server.partner = client;
  client.partner = server;
  return { server, client };
}

const echoTool: AnyToolDef = {
  name: 'request.create',
  description: 'echo',
  inputSchema: z.object({ message: z.string() }),
  async handler(input) {
    return { echoed: input.message };
  },
};

const failingTool: AnyToolDef = {
  name: 'request.read',
  description: 'always fails',
  inputSchema: z.object({}),
  async handler() {
    throw new Error('boom');
  },
};

// An out-of-tree (Enterprise) tool: a name in the `ee.*` namespace, injected
// via `tools` rather than living in the public TOOL_REGISTRY. The `ee.demo`
// name only type-checks because `ToolDef.name` widened to `ExtensionToolName`.
const enterpriseTool: AnyToolDef = {
  name: 'ee.demo',
  description: 'enterprise-injected tool (ee.* namespace)',
  inputSchema: z.object({ value: z.number() }),
  async handler(input) {
    return { doubled: input.value * 2 };
  },
};

function makeContext(): ToolHandlerContext {
  const workspace = {
    async read(): Promise<never> {
      throw new Error('not used');
    },
    async apply(): Promise<never> {
      throw new Error('not used');
    },
    async write(): Promise<never> {
      throw new Error('not used');
    },
  };
  return {
    workspace,
    workspaces: {
      list: () => Promise.resolve([]),
      for: () => workspace,
      activeId: () => null,
      setActive: () => Promise.resolve(),
    },
    mock: {
      async start() {
        throw new Error('not used');
      },
      async stop() {},
      async list() {
        return [];
      },
    },
  };
}

describe('McpHost', () => {
  it('reports the package version during protocol initialization', async () => {
    const host = new McpHost({ context: makeContext(), tools: [] });
    const { server, client } = pair();
    await host.connect(server);

    const c = new Client({ name: 'test', version: '0.0.0' });
    await c.connect(client);
    expect(c.getServerVersion()).toEqual({
      name: 'apicircle-mcp',
      version: MCP_PACKAGE_VERSION,
    });

    await c.close();
    await host.close();
  });

  it('lists registered tools over the protocol', async () => {
    const host = new McpHost({ context: makeContext(), tools: [echoTool] });
    const { server, client } = pair();
    await host.connect(server);

    const c = new Client({ name: 'test', version: '0.0.0' });
    await c.connect(client);
    const tools = await c.listTools();
    expect(tools.tools.find((t) => t.name === 'request.create')?.description).toBe('echo');

    await c.close();
    await host.close();
  });

  it('dispatches a successful tool call', async () => {
    const host = new McpHost({ context: makeContext(), tools: [echoTool] });
    const { server, client } = pair();
    await host.connect(server);

    const c = new Client({ name: 'test', version: '0.0.0' });
    await c.connect(client);
    const result = await c.callTool({
      name: 'request.create',
      arguments: { message: 'hi' },
    });
    expect(result.isError).toBeFalsy();
    const text = (result.content as Array<{ type: string; text: string }>)[0].text;
    expect(JSON.parse(text)).toEqual({ echoed: 'hi' });

    await c.close();
    await host.close();
  });

  it('returns isError on validation failure', async () => {
    const host = new McpHost({ context: makeContext(), tools: [echoTool] });
    const { server, client } = pair();
    await host.connect(server);

    const c = new Client({ name: 'test', version: '0.0.0' });
    await c.connect(client);
    const result = await c.callTool({
      name: 'request.create',
      arguments: {},
    });
    expect(result.isError).toBe(true);

    await c.close();
    await host.close();
  });

  it('returns isError when the handler throws', async () => {
    const host = new McpHost({ context: makeContext(), tools: [failingTool] });
    const { server, client } = pair();
    await host.connect(server);

    const c = new Client({ name: 'test', version: '0.0.0' });
    await c.connect(client);
    const result = await c.callTool({ name: 'request.read', arguments: {} });
    expect(result.isError).toBe(true);
    const text = (result.content as Array<{ type: string; text: string }>)[0].text;
    expect(text).toContain('boom');

    await c.close();
    await host.close();
  });

  it('registers and dispatches an injected ee.* (Enterprise) tool', async () => {
    const host = new McpHost({ context: makeContext(), tools: [enterpriseTool] });
    const { server, client } = pair();
    await host.connect(server);

    const c = new Client({ name: 'test', version: '0.0.0' });
    await c.connect(client);

    const tools = await c.listTools();
    expect(tools.tools.find((t) => t.name === 'ee.demo')?.description).toContain('ee.*');

    const result = await c.callTool({ name: 'ee.demo', arguments: { value: 21 } });
    expect(result.isError).toBeFalsy();
    const text = (result.content as Array<{ type: string; text: string }>)[0].text;
    expect(JSON.parse(text)).toEqual({ doubled: 42 });

    await c.close();
    await host.close();
  });
});
