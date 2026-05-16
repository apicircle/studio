import { Command } from 'commander';
import { registerMockCommand } from './commands/mock';
import { registerMcpCommand } from './commands/mcp';
import { registerImportCommand } from './commands/import';

// =============================================================================
// `apicircle` — root CLI binary. Sub-commands live under ./commands.
//
// Designed for two audiences:
//   • Power users who want a no-Electron way to run mocks or drive the MCP
//     stdio server against a workspace folder.
//   • CI / automation that imports specs into a workspace.json checked into
//     git (so the desktop app picks them up on next pull).
// =============================================================================

export function buildProgram(): Command {
  const program = new Command();
  program
    .name('apicircle')
    .description('Command-line companion to APICircle Studio.')
    .version('0.1.0');

  registerMockCommand(program);
  registerMcpCommand(program);
  registerImportCommand(program);

  return program;
}

export async function runCli(argv: readonly string[] = process.argv): Promise<void> {
  await buildProgram().parseAsync(argv);
}

// Run when this file is executed as a script. tsup wraps the CJS output
// with a node shebang so this branch is what handles `apicircle <args>`.
// We deliberately do *not* check require.main — works in both CJS and ESM.
// `.ts` is also accepted so the E2E suite can run the source under tsx
// without going through the dist bundle.
const entry = process.argv[1] ?? '';
if (entry.endsWith('apicircle') || entry.endsWith('index.cjs') || entry.endsWith('index.ts')) {
  void runCli();
}
