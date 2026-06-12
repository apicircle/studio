import type { Command } from 'commander';
import kleur from 'kleur';
import { saveToFile } from '@apicircle/core/workspace/file-backed';
import type { MockServer, WorkspaceSynced } from '@apicircle/shared';
import { ensureWorkspace } from '../util/loadWorkspace';
import { resolveWorkspace, WorkspaceResolutionError } from '../util/resolveWorkspace';

// =============================================================================
// `apicircle mocks <subcommand>` — manage mock-server definitions in the
// active workspace from the terminal. Headless surface for the same
// `defaultPort` field the Web/Desktop UI, VS Code, and the
// `mock.set_default_port` MCP tool all drive.
//
// Current subcommands:
//   • `list` — alias for `mock list` that focuses on workspace-stored
//     definitions (CRUD), not a running runtime.
//   • `set-port <id-or-name> [port]` — pin a default port (or clear it).
//
// `apicircle mock <spec>` (singular) keeps its existing semantics:
// stream a mock server from a spec file on the fly. The plural `mocks`
// group operates on persisted workspace definitions.
// =============================================================================

interface MocksCommonOptions {
  workspaceName?: string;
  workspacePath?: string;
}

export function registerMocksCommand(program: Command): void {
  const mocks = program
    .command('mocks')
    .description('Manage mock-server definitions in the active workspace');

  mocks
    .command('list')
    .description('List every mock server in the workspace + its default port')
    .option(
      '--workspace-name <name-or-id>',
      'Registry workspace name (case-insensitive) or id. Defaults to the active workspace.',
    )
    .option(
      '-w, --workspace-path <dir>',
      'Filesystem directory containing workspace.synced.json (skips the registry).',
    )
    .option('--json', 'Emit JSON instead of a formatted table')
    .action(async (opts: MocksCommonOptions & { json?: boolean }) => {
      const dir = await resolveDir(opts);
      const state = await ensureWorkspace(dir);
      const mockList = Object.values(state.synced.mockServers);
      if (opts.json) {
        process.stdout.write(
          JSON.stringify(
            mockList.map((m) => ({
              id: m.id,
              name: m.name,
              defaultPort: m.defaultPort,
              endpoints: m.endpoints.length,
            })),
            null,
            2,
          ) + '\n',
        );
        return;
      }
      if (mockList.length === 0) {
        process.stdout.write(`${kleur.dim('No mock servers in this workspace.')}\n`);
        return;
      }
      const nameWidth = Math.max(4, ...mockList.map((m) => m.name.length));
      const idWidth = Math.max(2, ...mockList.map((m) => m.id.length));
      process.stdout.write(
        kleur.bold(
          `  ${'NAME'.padEnd(nameWidth)}  ${'ID'.padEnd(idWidth)}  ${'PORT'.padStart(6)}  ENDPOINTS\n`,
        ),
      );
      for (const m of mockList) {
        const portLabel = m.defaultPort === null ? kleur.dim('auto') : String(m.defaultPort);
        process.stdout.write(
          `  ${m.name.padEnd(nameWidth)}  ${kleur.dim(m.id.padEnd(idWidth))}  ${portLabel.padStart(6)}  ${m.endpoints.length}\n`,
        );
      }
    });

  mocks
    .command('set-port')
    .description('Set (or clear) the default port for a mock server in the active workspace')
    .argument('<selector>', 'Mock server id or case-insensitive name')
    .argument(
      '[port]',
      'Port 1024-65535, or omit / "auto" / "null" to clear back to free-port mode',
    )
    .option(
      '--workspace-name <name-or-id>',
      'Registry workspace name (case-insensitive) or id. Defaults to the active workspace.',
    )
    .option(
      '-w, --workspace-path <dir>',
      'Filesystem directory containing workspace.synced.json (skips the registry).',
    )
    .action(async (selector: string, portArg: string | undefined, opts: MocksCommonOptions) => {
      const dir = await resolveDir(opts);
      const state = await ensureWorkspace(dir);
      const target = findMock(state.synced, selector);
      if (!target) {
        process.stderr.write(
          `${kleur.red('error')}: no mock named "${selector}" in this workspace. ` +
            `Run ${kleur.cyan('apicircle mocks list')} to see what's available.\n`,
        );
        process.exit(2);
        return;
      }
      const nextPort = parsePortArg(portArg);
      if (nextPort === 'invalid') {
        process.stderr.write(
          `${kleur.red('error')}: port must be an integer in 1024-65535, or "auto" / "null" / omitted to clear.\n`,
        );
        process.exit(2);
        return;
      }
      if (target.defaultPort === nextPort) {
        process.stdout.write(
          `${kleur.dim('unchanged')}: "${target.name}" already has defaultPort ${
            nextPort === null ? 'auto' : String(nextPort)
          }.\n`,
        );
        return;
      }
      const now = new Date().toISOString();
      const updated: MockServer = { ...target, defaultPort: nextPort, updatedAt: now };
      const nextSynced: WorkspaceSynced = {
        ...state.synced,
        mockServers: { ...state.synced.mockServers, [target.id]: updated },
        meta: { ...state.synced.meta, updatedAt: now },
      };
      await saveToFile(dir, { synced: nextSynced, local: state.local });
      process.stdout.write(
        `${kleur.green('updated')} "${target.name}" defaultPort = ${
          nextPort === null ? kleur.dim('auto (free port)') : kleur.cyan(String(nextPort))
        }\n`,
      );
    });
}

async function resolveDir(opts: MocksCommonOptions): Promise<string> {
  try {
    const resolved = await resolveWorkspace({
      name: opts.workspaceName,
      path: opts.workspacePath,
      expectExists: false,
    });
    return resolved.dir;
  } catch (err) {
    if (err instanceof WorkspaceResolutionError) {
      process.stderr.write(`${kleur.red('error')}: ${err.message}\n`);
      process.exit(2);
    }
    throw err;
  }
}

function findMock(synced: WorkspaceSynced, selector: string): MockServer | undefined {
  const all = Object.values(synced.mockServers);
  const byId = all.find((m) => m.id === selector);
  if (byId) return byId;
  const lower = selector.toLowerCase();
  return all.find((m) => m.name.toLowerCase() === lower);
}

// Returns:
//   • null   → caller wants to clear the port (auto / null / blank / omitted)
//   • number → a valid 1024-65535 port
//   • 'invalid' sentinel → caller passed something we can't accept
export function parsePortArg(raw: string | undefined): number | null | 'invalid' {
  if (raw === undefined) return null;
  const trimmed = raw.trim();
  if (trimmed === '' || trimmed.toLowerCase() === 'auto' || trimmed.toLowerCase() === 'null') {
    return null;
  }
  const n = Number(trimmed);
  if (!Number.isInteger(n)) return 'invalid';
  if (n < 1024 || n > 65535) return 'invalid';
  return n;
}
