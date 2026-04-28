import * as path from 'node:path';
import { createMcpServer } from '../index';
import { FileBackedWorkspaceProvider } from '../providers/FileBackedWorkspaceProvider';
import { InProcessMockController } from '../providers/InProcessMockController';

// =============================================================================
// stdio entry point — published as the `apicircle-mcp` bin. Reads the
// workspace path from `--workspace <dir>` (or the `APICIRCLE_WORKSPACE` env
// var) and connects to stdio so the parent AI client (Claude Desktop, ChatGPT,
// Cursor, etc) can drive the tool catalog.
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

async function main(): Promise<void> {
  const dir = getWorkspaceDir();
  const workspace = new FileBackedWorkspaceProvider(dir);
  const mock = new InProcessMockController();
  const host = createMcpServer({ workspace, mock });
  await host.connect();
  // Stdio transport keeps the process alive until the client disconnects.
}

main().catch((err) => {
  process.stderr.write(
    `apicircle-mcp boot error: ${err instanceof Error ? err.message : String(err)}\n`,
  );
  process.exit(1);
});
