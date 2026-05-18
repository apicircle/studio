import * as path from 'node:path';
import type { Command } from 'commander';
import kleur from 'kleur';
import {
  createMcpServer,
  FileBackedWorkspaceProvider,
  InProcessMockController,
} from '@apicircle/mcp-server';
import { ensureWorkspace } from '../util/loadWorkspace';

// =============================================================================
// `apicircle mcp` — boot the MCP stdio server against a workspace directory.
// Mirrors `@apicircle/mcp-server`'s `bin/mcp-server.ts` but with friendlier
// CLI ergonomics (default workspace = cwd, friendly error messages, etc).
// =============================================================================

interface McpOptions {
  workspace?: string;
}

export function registerMcpCommand(program: Command): void {
  program
    .command('mcp')
    .description('Run the APICircle MCP server (stdio transport)')
    .option('-w, --workspace <dir>', 'Workspace directory (defaults to current directory)')
    .action(async (opts: McpOptions) => {
      const dir = path.resolve(opts.workspace ?? process.cwd());
      // Touch the workspace so subsequent reads don't fail. Errors here
      // surface to stderr and exit non-zero — the AI client wouldn't be
      // able to use a half-initialised workspace anyway.
      try {
        await ensureWorkspace(dir);
      } catch (err) {
        process.stderr.write(
          `${kleur.red('failed to initialise workspace')} at ${dir}: ${
            err instanceof Error ? err.message : String(err)
          }\n`,
        );
        process.exit(1);
      }

      const workspace = new FileBackedWorkspaceProvider(dir);
      const mock = new InProcessMockController();
      const host = createMcpServer({ workspace, mock });
      process.stderr.write(`${kleur.green('apicircle-mcp')} ready · workspace=${dir}\n`);
      await host.connect();
    });
}
