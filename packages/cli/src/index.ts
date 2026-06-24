import { Command } from 'commander';
import { registerMockCommand } from './commands/mock';
import { registerMocksCommand } from './commands/mocks';
import { registerMcpCommand } from './commands/mcp';
import { registerImportCommand } from './commands/import';
import { registerExportCommand } from './commands/export';
import { registerRunCommand } from './commands/run';
import { registerWorkspacesCommand } from './commands/workspaces';
import { registerLinkedCommand } from './commands/linked';
import { registerReleaseCommand } from './commands/release';
import { registerFolderCommand } from './commands/folder';
import { CLI_PACKAGE_VERSION } from './packageVersion';

// =============================================================================
// `apicircle` — root CLI binary. Sub-commands live under ./commands.
//
// Designed for two audiences:
//   • Power users who want a no-Electron way to run mocks, drive the MCP
//     stdio server, or execute saved plans against a workspace folder.
//   • CI / automation that imports specs into a workspace.json checked into
//     git, or runs an execution plan as a review gate.
// =============================================================================

export function buildProgram(): Command {
  const program = new Command();
  program
    .name('apicircle')
    .description('Command-line companion to API Circle Studio.')
    .version(CLI_PACKAGE_VERSION);

  registerMockCommand(program);
  registerMocksCommand(program);
  registerMcpCommand(program);
  registerImportCommand(program);
  registerExportCommand(program);
  registerRunCommand(program);
  registerWorkspacesCommand(program);
  registerLinkedCommand(program);
  registerReleaseCommand(program);
  registerFolderCommand(program);

  return program;
}

export async function runCli(argv: readonly string[] = process.argv): Promise<void> {
  await buildProgram().parseAsync(argv);
}

// Composition seam: `buildProgram()` returns the full public program, and each
// `register*Command` helper attaches one command group to a `Command` you own.
// An out-of-tree (e.g. Enterprise) CLI can do:
//   const program = buildProgram();      // all public commands
//   registerGenerateCommand(program);    // + its own
//   await program.parseAsync(process.argv);
// …or compose a fresh `new Command()` with only the registrars it wants. The
// program returned by `buildProgram()` can be re-`.name()` / `.version()`'d.
export {
  registerMockCommand,
  registerMocksCommand,
  registerMcpCommand,
  registerImportCommand,
  registerExportCommand,
  registerRunCommand,
  registerWorkspacesCommand,
  registerLinkedCommand,
  registerReleaseCommand,
  registerFolderCommand,
};

// Run when this file is executed as a script. tsup wraps the CJS output
// with a node shebang so this branch is what handles `apicircle <args>`.
// We deliberately do *not* check require.main — works in both CJS and ESM.
// `.ts` is also accepted so the E2E suite can run the source under tsx
// without going through the dist bundle.
const entry = process.argv[1] ?? '';
if (entry.endsWith('apicircle') || entry.endsWith('index.cjs') || entry.endsWith('index.ts')) {
  void runCli();
}
