import type { Command } from 'commander';
import kleur from 'kleur';
import {
  createWorkspaceOnDisk,
  defaultWorkspacesRoot,
  listWorkspacesOnDisk,
  saveRegistryToDisk,
} from '../util/resolveWorkspace';
import { findWorkspaceEntry, setActiveWorkspace } from '@apicircle/core/workspace/registry';

// =============================================================================
// `apicircle workspaces <list | create | use | path>` — manage the
// multi-workspace registry from the terminal. Every other command
// (`import`, `mcp`, `run`) resolves `--workspace-name` or `--workspace-path` against this
// registry, so this is the CLI surface for seeing, creating, and switching
// between the workspaces the desktop app + AI clients share.
// =============================================================================

interface WorkspacesOptions {
  json?: boolean;
}

export function registerWorkspacesCommand(program: Command): void {
  const ws = program
    .command('workspaces')
    .description('List, create, or switch the active workspace');

  ws.command('list')
    .description('List every workspace registered on this machine')
    .option('--json', 'Emit JSON instead of a formatted table')
    .action(async (opts: WorkspacesOptions) => {
      const { registry, root } = await listWorkspacesOnDisk();
      if (opts.json) {
        process.stdout.write(JSON.stringify({ root, registry }, null, 2) + '\n');
        return;
      }
      if (registry.workspaces.length === 0) {
        process.stdout.write(
          `${kleur.dim('No workspaces registered yet at')} ${root}\n` +
            `${kleur.dim('Run')} ${kleur.cyan('apicircle workspaces create <name>')} ${kleur.dim(
              'or open the desktop app to seed one.',
            )}\n`,
        );
        return;
      }
      process.stdout.write(`${kleur.dim('registry')}: ${root}\n\n`);
      // Sort by lastOpenedAt desc so the most recent shows first.
      const rows = [...registry.workspaces].sort((a, b) =>
        b.lastOpenedAt.localeCompare(a.lastOpenedAt),
      );
      const nameWidth = Math.max(4, ...rows.map((r) => r.name.length));
      const idWidth = Math.max(2, ...rows.map((r) => r.id.length));
      process.stdout.write(
        kleur.bold(
          `  ${''.padEnd(1)} ${'NAME'.padEnd(nameWidth)}  ${'ID'.padEnd(idWidth)}  LAST OPENED\n`,
        ),
      );
      for (const w of rows) {
        const mark = w.id === registry.activeWorkspaceId ? kleur.green('●') : ' ';
        process.stdout.write(
          `  ${mark} ${w.name.padEnd(nameWidth)}  ${kleur.dim(
            w.id.padEnd(idWidth),
          )}  ${kleur.dim(w.lastOpenedAt)}\n`,
        );
      }
      process.stdout.write(`\n${kleur.dim('● = active')}\n`);
    });

  ws.command('create')
    .description('Create a new workspace and add it to the registry')
    .argument('<name>', 'Human-readable label for the workspace')
    .option('--sample', 'Seed the workspace with one sample request', false)
    .action(async (name: string, opts: { sample?: boolean }) => {
      try {
        const { entry, dir, registry } = await createWorkspaceOnDisk({
          name,
          sampleRequest: opts.sample ?? false,
        });
        process.stdout.write(
          `${kleur.green('created')} workspace ${kleur.cyan(entry.name)} ${kleur.dim(`(${entry.id})`)}\n` +
            `  at ${dir}\n`,
        );
        if (registry.activeWorkspaceId === entry.id) {
          process.stdout.write(`${kleur.dim('marked as active')}\n`);
        }
      } catch (err) {
        process.stderr.write(
          `${kleur.red('error')}: ${err instanceof Error ? err.message : String(err)}\n`,
        );
        process.exit(2);
      }
    });

  ws.command('use')
    .description('Set the active workspace by id or name')
    .argument('<selector>', 'Workspace id or name')
    .action(async (selector: string) => {
      const { registry, root } = await listWorkspacesOnDisk();
      const entry = findWorkspaceEntry(registry, selector);
      if (!entry) {
        process.stderr.write(
          `${kleur.red('error')}: no workspace named "${selector}" in the registry at ${root}.\n` +
            `${kleur.dim('Run')} ${kleur.cyan('apicircle workspaces list')} ${kleur.dim('to see what is available.')}\n`,
        );
        process.exit(2);
        return;
      }
      const next = await setActiveWorkspace(root, entry.id);
      void next; // saveRegistry inside setActiveWorkspace already persisted it
      process.stdout.write(
        `${kleur.green('active')} workspace is now ${kleur.cyan(entry.name)} ${kleur.dim(`(${entry.id})`)}\n`,
      );
    });

  ws.command('path')
    .description('Print the on-disk path for a workspace (or the workspaces root)')
    .argument('[selector]', 'Optional workspace id or name; prints the root when omitted')
    .action(async (selector?: string) => {
      if (!selector) {
        process.stdout.write(defaultWorkspacesRoot() + '\n');
        return;
      }
      const { registry, root } = await listWorkspacesOnDisk();
      const entry = findWorkspaceEntry(registry, selector);
      if (!entry) {
        process.stderr.write(
          `${kleur.red('error')}: no workspace named "${selector}" in the registry at ${root}.\n`,
        );
        process.exit(2);
        return;
      }
      // workspaceDirFor would re-import; the simplest computation is just root + id.
      // We use `saveRegistryToDisk` only to assert the import wiring is alive.
      void saveRegistryToDisk;
      const { workspaceDirFor } = await import('@apicircle/core/workspace/registry');
      process.stdout.write(workspaceDirFor(root, entry.id) + '\n');
    });
}
