import type { Command } from 'commander';
import kleur from 'kleur';
import type { Folder, RequestAuth } from '@apicircle/shared';
import { generateId } from '@apicircle/shared';
import { FileBackedWorkspaceProvider } from '@apicircle/core/providers';
import { ensureWorkspace } from '../util/loadWorkspace';
import { resolveWorkspace, WorkspaceResolutionError } from '../util/resolveWorkspace';

// =============================================================================
// `apicircle folder <list | create | rename | set-auth | clear-auth | move |
// delete>` — manage the workspace's folder tree from the terminal. Every
// subcommand routes through applyMutation (via FileBackedWorkspaceProvider),
// so semantics match the MCP / VS Code / UI surfaces exactly.
//
// Folder-level auth uses the same LLM-friendly subset MCP exposes
// (`bearer`, `basic`, `api-key`, `custom-header`, `none`, `inherit`). For
// OAuth2 / AWS / Hawk / NTLM / JWT folder-auth, edit the folder via the
// VS Code YAML editor or the web/desktop UI — those grants require runtime
// state the CLI doesn't have.
// =============================================================================

interface BaseOptions {
  workspaceName?: string;
  workspacePath?: string;
}

interface CreateOptions extends BaseOptions {
  name?: string;
  parent?: string | null;
  type?: string;
  token?: string;
  username?: string;
  password?: string;
  key?: string;
  value?: string;
  addTo?: string;
}

interface RenameOptions extends BaseOptions {
  name: string;
}

interface SetAuthOptions extends BaseOptions {
  type: string;
  token?: string;
  username?: string;
  password?: string;
  key?: string;
  value?: string;
  addTo?: string;
}

interface MoveOptions extends BaseOptions {
  parent?: string | null;
}

interface ListOptions extends BaseOptions {
  json?: boolean;
}

const COMMON_OPTS = (cmd: Command): Command =>
  cmd
    .option(
      '--workspace-name <name-or-id>',
      'Registry workspace name (case-insensitive) or id. Defaults to the active workspace.',
    )
    .option(
      '-w, --workspace-path <dir>',
      'Filesystem directory containing the .apicircle/ workspace (skips the registry).',
    );

async function openWorkspace(
  opts: BaseOptions,
): Promise<{ provider: FileBackedWorkspaceProvider; dir: string }> {
  let dir: string;
  try {
    const resolved = await resolveWorkspace({
      name: opts.workspaceName,
      path: opts.workspacePath,
      expectExists: true,
    });
    dir = resolved.dir;
  } catch (err) {
    if (err instanceof WorkspaceResolutionError) {
      process.stderr.write(`${kleur.red('error')}: ${err.message}\n`);
      process.exit(2);
    }
    throw err;
  }
  await ensureWorkspace(dir);
  return { provider: new FileBackedWorkspaceProvider(dir), dir };
}

export function registerFolderCommand(program: Command): void {
  const folder = program
    .command('folder')
    .description('List, create, rename, move, set auth, or delete folders.');

  COMMON_OPTS(
    folder
      .command('list')
      .description('Print the folder tree (with auth markers).')
      .option('--json', 'Emit JSON instead of a formatted tree'),
  ).action(async (opts: ListOptions) => {
    const { provider } = await openWorkspace(opts);
    const state = await provider.read();
    const folders = state.synced.collections.folders;
    if (opts.json) {
      process.stdout.write(JSON.stringify(Object.values(folders), null, 2) + '\n');
      return;
    }
    if (Object.keys(folders).length === 0) {
      process.stdout.write(`${kleur.dim('No folders in this workspace.')}\n`);
      return;
    }
    const roots = Object.values(folders).filter((f) => f.parentId === null);
    roots.sort((a, b) => a.name.localeCompare(b.name));
    for (const root of roots) printTree(root, folders, 0);
  });

  COMMON_OPTS(
    folder
      .command('create')
      .description(
        'Create a new folder. Optionally seed folder-level auth in the same call (saves a follow-up `folder set-auth` round-trip). Prints the new id.',
      )
      .requiredOption('--name <name>', 'Folder name (must be unique among siblings)')
      .option('--parent <id>', 'Parent folder id (omit for top level)')
      .option(
        '--type <type>',
        'Initial auth type: bearer | basic | api-key | custom-header | none | inherit',
      )
      .option('--token <token>', 'Token (bearer)')
      .option('--username <user>', 'Username (basic)')
      .option('--password <pass>', 'Password (basic)')
      .option('--key <key>', 'Key (api-key / custom-header)')
      .option('--value <value>', 'Value (api-key / custom-header)')
      .option('--add-to <where>', 'Where to inject api-key: header | query | cookie', 'header'),
  ).action(async (opts: CreateOptions) => {
    const initialAuth = opts.type ? buildAuthFromCli({ ...opts, type: opts.type }) : undefined;
    const { provider } = await openWorkspace(opts);
    const f: Folder = {
      id: generateId(),
      name: opts.name!.trim(),
      parentId: opts.parent ?? null,
      ...(initialAuth ? { auth: initialAuth } : {}),
    };
    const result = await provider.apply({ kind: 'folder.create', folder: f });
    if ((result.changedIds.length ?? 0) === 0) {
      process.stderr.write(`${kleur.red('error')}: folder.create no-op (duplicate id?)\n`);
      process.exit(1);
    }
    const authNote = initialAuth ? `  auth=${initialAuth.type}` : '';
    process.stdout.write(`${kleur.green('created')} ${f.id}  ${f.name}${authNote}\n`);
  });

  COMMON_OPTS(
    folder
      .command('rename')
      .description('Rename a folder. Fails if a sibling already has the new name.')
      .argument('<id>', 'Folder id')
      .requiredOption('--name <name>', 'New name'),
  ).action(async (id: string, opts: RenameOptions) => {
    const { provider } = await openWorkspace(opts);
    const result = await provider.apply({
      kind: 'folder.update',
      id,
      patch: { name: opts.name.trim() },
    });
    if (result.changedIds.length === 0) {
      process.stderr.write(
        `${kleur.red('error')}: rename rejected — folder not found, or a sibling already has the name "${opts.name}".\n`,
      );
      process.exit(1);
    }
    process.stdout.write(`${kleur.green('renamed')} ${id}  ${opts.name}\n`);
  });

  COMMON_OPTS(
    folder
      .command('set-auth')
      .description('Set folder-level auth. Descendants with `auth.type: inherit` will pick it up.')
      .argument('<id>', 'Folder id')
      .requiredOption(
        '--type <type>',
        'Auth type: bearer | basic | api-key | custom-header | none | inherit',
      )
      .option('--token <token>', 'Token (bearer)')
      .option('--username <user>', 'Username (basic)')
      .option('--password <pass>', 'Password (basic)')
      .option('--key <key>', 'Key (api-key / custom-header)')
      .option('--value <value>', 'Value (api-key / custom-header)')
      .option('--add-to <where>', 'Where to inject api-key: header | query | cookie', 'header'),
  ).action(async (id: string, opts: SetAuthOptions) => {
    const auth = buildAuthFromCli(opts);
    const { provider } = await openWorkspace(opts);
    const result = await provider.apply({
      kind: 'folder.update',
      id,
      patch: { auth },
    });
    if (result.changedIds.length === 0) {
      process.stderr.write(`${kleur.red('error')}: folder ${id} not found.\n`);
      process.exit(1);
    }
    process.stdout.write(`${kleur.green('updated')} ${id}  auth.type=${auth.type}\n`);
  });

  COMMON_OPTS(
    folder
      .command('clear-auth')
      .description('Clear folder-level auth. Descendants `inherit` walks further up.')
      .argument('<id>', 'Folder id'),
  ).action(async (id: string, opts: BaseOptions) => {
    const { provider } = await openWorkspace(opts);
    const result = await provider.apply({
      kind: 'folder.update',
      id,
      patch: { auth: undefined },
    });
    if (result.changedIds.length === 0) {
      process.stderr.write(`${kleur.red('error')}: folder ${id} not found.\n`);
      process.exit(1);
    }
    process.stdout.write(`${kleur.green('cleared auth')} ${id}\n`);
  });

  COMMON_OPTS(
    folder
      .command('move')
      .description('Reparent a folder. Cycles + self-parenting are rejected.')
      .argument('<id>', 'Folder id')
      .option('--parent <id>', 'New parent id (omit for top level)'),
  ).action(async (id: string, opts: MoveOptions) => {
    const { provider } = await openWorkspace(opts);
    const result = await provider.apply({
      kind: 'folder.move',
      id,
      newParentId: opts.parent ?? null,
    });
    if (result.changedIds.length === 0) {
      process.stderr.write(
        `${kleur.red('error')}: move rejected — folder not found, same parent, self-parent, or cycle.\n`,
      );
      process.exit(1);
    }
    process.stdout.write(`${kleur.green('moved')} ${id}  parent=${opts.parent ?? '(root)'}\n`);
  });

  COMMON_OPTS(
    folder
      .command('delete')
      .description('Delete a folder. Direct children reparent to its parent.')
      .argument('<id>', 'Folder id'),
  ).action(async (id: string, opts: BaseOptions) => {
    const { provider } = await openWorkspace(opts);
    const result = await provider.apply({ kind: 'folder.delete', id });
    if (result.changedIds.length === 0) {
      process.stderr.write(`${kleur.red('error')}: folder ${id} not found.\n`);
      process.exit(1);
    }
    process.stdout.write(`${kleur.green('deleted')} ${id}\n`);
  });
}

function buildAuthFromCli(opts: SetAuthOptions): RequestAuth {
  switch (opts.type) {
    case 'none':
      return { type: 'none' };
    case 'inherit':
      return { type: 'inherit' };
    case 'bearer':
      return { type: 'bearer', token: opts.token ?? '' };
    case 'basic':
      return { type: 'basic', username: opts.username ?? '', password: opts.password ?? '' };
    case 'api-key':
      return {
        type: 'api-key',
        key: opts.key ?? '',
        value: opts.value ?? '',
        addTo: opts.addTo === 'query' || opts.addTo === 'cookie' ? opts.addTo : 'header',
      };
    case 'custom-header':
      return { type: 'custom-header', key: opts.key ?? '', value: opts.value ?? '' };
    default:
      process.stderr.write(
        `${kleur.red('error')}: --type "${opts.type}" not supported by the CLI. Use bearer | basic | api-key | custom-header | none | inherit. For OAuth2 / AWS / Hawk / NTLM / JWT, edit the folder YAML in VS Code or the web/desktop app.\n`,
      );
      process.exit(2);
  }
}

function printTree(folder: Folder, all: Record<string, Folder>, depth: number): void {
  const indent = '  '.repeat(depth);
  const authTag =
    folder.auth && folder.auth.type !== 'none' && folder.auth.type !== 'inherit'
      ? `  ${kleur.cyan(`[auth: ${folder.auth.type}]`)}`
      : '';
  process.stdout.write(`${indent}${kleur.bold(folder.name)}  ${kleur.dim(folder.id)}${authTag}\n`);
  const children = Object.values(all)
    .filter((f) => f.parentId === folder.id)
    .sort((a, b) => a.name.localeCompare(b.name));
  for (const c of children) printTree(c, all, depth + 1);
}
