import * as path from 'node:path';
import { promises as fs } from 'node:fs';
import { formatHelp, hasHelpFlag, hasVersionFlag } from './args';
import { MCP_PACKAGE_VERSION } from '../packageVersion';

// =============================================================================
// stdio entry point — published as the `apicircle-mcp` bin. Reads the
// workspace path from `--workspace <dir>` (or the `APICIRCLE_WORKSPACE` env
// var) and connects to stdio so the parent AI client (Claude Desktop, ChatGPT,
// Cursor, Codex, etc) can drive the tool catalog.
//
// The `<dir>` can be any of:
//
//   • a **registry root** (contains `registry.json`) — multi-workspace mode;
//     the server exposes every workspace via `workspace.list` and defaults
//     reads/writes to the active workspace.
//   • a **single-workspace dir** (contains `workspace.json`) — for Git-backed
//     `.apicircle/` directories or standalone workspace dirs.
//
// Errors during boot are written to stderr and exit with a non-zero code;
// errors during tool calls are returned in-protocol as `isError: true` so
// the AI client can surface them without losing the connection.
// =============================================================================

function getWorkspaceDir(): string {
  const argIdx = process.argv.indexOf('--workspace');
  if (argIdx !== -1 && process.argv[argIdx + 1]) {
    return path.resolve(process.argv[argIdx + 1]);
  }
  const env = process.env.APICIRCLE_WORKSPACE;
  if (env) return path.resolve(env);
  return path.resolve(process.cwd());
}

async function fileExists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (hasVersionFlag(args)) {
    process.stdout.write(`${MCP_PACKAGE_VERSION}\n`);
    return;
  }
  if (hasHelpFlag(args)) {
    process.stdout.write(formatHelp());
    return;
  }

  const [
    { createMcpServer },
    { FileBackedWorkspaceProvider },
    { MultiWorkspaceProvider },
    { InProcessMockController },
    { SingleWorkspaceAdapter },
  ] = await Promise.all([
    import('../index'),
    import('../providers/FileBackedWorkspaceProvider'),
    import('../providers/MultiWorkspaceProvider'),
    import('../providers/InProcessMockController'),
    import('../providers/Workspaces'),
  ]);

  const dir = getWorkspaceDir();

  const [hasRegistry, hasWorkspaceJson] = await Promise.all([
    fileExists(path.join(dir, 'registry.json')),
    fileExists(path.join(dir, 'workspace.json')),
  ]);

  const mock = new InProcessMockController();

  // Path 1: registry root → multi-workspace (desktop/CLI registry at ~/.apicircle/).
  if (hasRegistry) {
    const workspaces = new MultiWorkspaceProvider(dir);
    const registry = await workspaces.init();
    if (!registry.activeWorkspaceId) {
      process.stderr.write(
        `apicircle-mcp: registry at ${dir} has no active workspace. ` +
          'Open the desktop app once, or run `apicircle workspaces create <name>`.\n',
      );
      process.exit(1);
    }
    const workspace = workspaces.activeProvider();
    const host = createMcpServer({ workspace, workspaces, mock });
    process.stderr.write(
      `apicircle-mcp: multi-workspace mode · ${registry.workspaces.length} workspace(s) · active=${registry.activeWorkspaceId}\n`,
    );
    await host.connect();
    return;
  }

  // Path 2: workspace.json present → single-workspace (Git-backed .apicircle/
  // directory or standalone workspace dir).
  if (hasWorkspaceJson) {
    const workspace = new FileBackedWorkspaceProvider(dir);
    const workspaces = new SingleWorkspaceAdapter(workspace, null);
    const host = createMcpServer({ workspace, workspaces, mock });
    process.stderr.write(`apicircle-mcp: single-workspace mode · ${dir}\n`);
    await host.connect();
    return;
  }

  // No recognized layout.
  process.stderr.write(
    `apicircle-mcp: no workspace found at ${dir}.\n` +
      'Expected one of:\n' +
      '  • registry.json   (multi-workspace registry root, e.g. ~/.apicircle/)\n' +
      '  • workspace.json  (single workspace or Git-backed .apicircle/ directory)\n' +
      'Point --workspace at the correct directory, or set APICIRCLE_WORKSPACE.\n',
  );
  process.exit(1);
}

main().catch((err) => {
  process.stderr.write(
    `apicircle-mcp boot error: ${err instanceof Error ? err.message : String(err)}\n`,
  );
  process.exit(1);
});
