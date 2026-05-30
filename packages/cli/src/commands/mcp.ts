import type { Command } from 'commander';
import kleur from 'kleur';
import {
  createMcpServer,
  FileBackedWorkspaceProvider,
  InProcessMockController,
} from '@apicircle/mcp-server';
import { ensureWorkspace } from '../util/loadWorkspace';
import { resolveWorkspace, WorkspaceResolutionError } from '../util/resolveWorkspace';

// =============================================================================
// `apicircle mcp` — boot the MCP stdio server against a workspace directory.
// Mirrors `@apicircle/mcp-server`'s `bin/mcp-server.ts` but with friendlier
// CLI ergonomics (default workspace = cwd, friendly error messages, etc).
// =============================================================================

interface McpOptions {
  workspaceName?: string;
  workspacePath?: string;
}

export function registerMcpCommand(program: Command): void {
  program
    .command('mcp')
    .description('Run the API Circle MCP server (stdio transport)')
    .option(
      '--workspace-name <name-or-id>',
      'Registry workspace name (case-insensitive) or id. Defaults to the active workspace.',
    )
    .option(
      '-w, --workspace-path <dir>',
      'Filesystem directory containing workspace.synced.json (skips the registry).',
    )
    .action(async (opts: McpOptions) => {
      let dir: string;
      let label: string;
      try {
        const resolved = await resolveWorkspace({
          name: opts.workspaceName,
          path: opts.workspacePath,
          expectExists: false,
        });
        dir = resolved.dir;
        label = resolved.fromRegistry ? `${resolved.name ?? resolved.id} (${dir})` : dir;
      } catch (err) {
        if (err instanceof WorkspaceResolutionError) {
          process.stderr.write(`${kleur.red('error')}: ${err.message}\n`);
          process.exit(2);
        }
        throw err;
      }
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
      process.stderr.write(`${kleur.green('apicircle-mcp')} ready · workspace=${label}\n`);
      await host.connect();
    });
}
