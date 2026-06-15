import type { Command } from 'commander';
import kleur from 'kleur';
import {
  fetchRemoteWorkspaceJson,
  applyMutation,
  buildLinkedSnapshot,
  ledgerFromProbe,
  parseLinkedWorkspaceJson,
} from '@apicircle/core';
import { saveToFile } from '@apicircle/core/workspace/file-backed';
import { generateId, type LinkedWorkspace } from '@apicircle/shared';
import { GitHubClient } from '@apicircle/git';
import { ensureWorkspace } from '../util/loadWorkspace';
import { resolveWorkspace, WorkspaceResolutionError } from '../util/resolveWorkspace';

// =============================================================================
// `apicircle linked` — sub-commands for managing linked workspaces from the CLI.
//
//   apicircle linked link <repo> [--branch] [--pinned-version] [--kind]
//   apicircle linked refresh <id>
//   apicircle linked list
//   apicircle linked unlink <id>
//
// Tokens come from `--token <tok>` or the `GITHUB_TOKEN` env var. Public-kind
// links can fetch anonymously; private-kind requires a token.
// =============================================================================

interface SharedOptions {
  workspaceName?: string;
  workspacePath?: string;
  token?: string;
}

function resolveToken(opts: SharedOptions): string {
  return (opts.token ?? process.env.GITHUB_TOKEN ?? '').trim();
}

async function resolveDir(opts: SharedOptions): Promise<string> {
  try {
    const resolved = await resolveWorkspace({
      name: opts.workspaceName,
      path: opts.workspacePath,
      expectExists: false,
    });
    if (resolved.fromRegistry) {
      process.stderr.write(
        `${kleur.dim('workspace')}: ${kleur.cyan(resolved.name ?? resolved.id ?? '')} ${kleur.dim(`(${resolved.dir})`)}\n`,
      );
    }
    return resolved.dir;
  } catch (err) {
    if (err instanceof WorkspaceResolutionError) {
      process.stderr.write(`${kleur.red('error')}: ${err.message}\n`);
      process.exit(2);
    }
    throw err;
  }
}

export function registerLinkedCommand(program: Command): void {
  const linked = program
    .command('linked')
    .description('Manage linked workspaces (the workspaces this one consumes).');

  linked
    .command('list')
    .description('List linked workspaces in the active workspace.')
    .option('--workspace-name <name-or-id>', 'Workspace name or id.')
    .option('-w, --workspace-path <dir>', 'Workspace folder path.')
    .action(async (opts: SharedOptions) => {
      const dir = await resolveDir(opts);
      const state = await ensureWorkspace(dir);
      const links = Object.values(state.synced.linkedWorkspaces);
      if (links.length === 0) {
        process.stdout.write(`${kleur.dim('No linked workspaces.')}\n`);
        return;
      }
      for (const l of links) {
        const pin = l.pinnedVersion ? `v${l.pinnedVersion}` : 'unpinned';
        const ledger = state.synced.releases.perLink[l.id];
        const cur = ledger?.currentVersion ? ` · cached current v${ledger.currentVersion}` : '';
        process.stdout.write(
          `${kleur.cyan(l.id)}  ${kleur.bold(l.name)}  ${kleur.dim(`${l.kind} · ${l.source.repoFullName}@${l.source.branch} · ${pin}${cur}`)}\n`,
        );
      }
    });

  linked
    .command('link <repo>')
    .description('Link a source workspace repo (owner/name).')
    .option('-b, --branch <branch>', 'Source branch.', 'main')
    .option('--pinned-version <version>', 'Pin a specific version (defaults to source current).')
    .option('--kind <kind>', 'private | public', 'private')
    .option('--workspace-name <name-or-id>', 'Workspace name or id.')
    .option('-w, --workspace-path <dir>', 'Workspace folder path.')
    .option('--token <token>', 'GitHub token (or set GITHUB_TOKEN).')
    .action(
      async (
        repo: string,
        opts: SharedOptions & {
          branch: string;
          pinnedVersion?: string;
          kind: 'private' | 'public';
        },
      ) => {
        if (!repo.includes('/')) {
          process.stderr.write(`${kleur.red('error')}: repo must be owner/name\n`);
          process.exit(2);
        }
        if (opts.kind !== 'public' && opts.kind !== 'private') {
          process.stderr.write(`${kleur.red('error')}: --kind must be private or public\n`);
          process.exit(2);
        }
        const token = resolveToken(opts);
        if (opts.kind === 'private' && !token) {
          process.stderr.write(
            `${kleur.red('error')}: a token is required for private repos (--token or GITHUB_TOKEN)\n`,
          );
          process.exit(2);
        }
        const dir = await resolveDir(opts);
        const state = await ensureWorkspace(dir);
        const dup = Object.values(state.synced.linkedWorkspaces).find(
          (l) => l.source.repoFullName === repo && l.source.branch === opts.branch,
        );
        if (dup) {
          process.stderr.write(
            `${kleur.red('error')}: already linked to ${repo}@${opts.branch} (${dup.id})\n`,
          );
          process.exit(2);
        }

        const [owner, name] = repo.split('/', 2);
        const client = new GitHubClient();
        const result = await fetchRemoteWorkspaceJson(async (p) => {
          const f = await client.getContents(token, owner, name, p, opts.branch);
          return f?.content ?? null;
        });
        if ('error' in result) {
          process.stderr.write(`${kleur.red('error')}: ${repo}@${opts.branch}: ${result.error}\n`);
          process.exit(2);
        }
        const probe = parseLinkedWorkspaceJson(result.content);
        const ledger = ledgerFromProbe(probe);
        const link: LinkedWorkspace = {
          id: generateId(),
          kind: opts.kind,
          name: repo,
          sourceWorkspaceId: result.workspaceId,
          source: {
            provider: 'github',
            repoFullName: repo,
            branch: opts.branch,
            sessionMode: 'workspace',
          },
          scope: ['collections', 'environments'],
          pinnedVersion: opts.pinnedVersion ?? ledger.currentVersion,
          updatePolicy: 'manual',
          linkedAt: new Date().toISOString(),
          requiredSecretKeyIds: probe.secretKeys ? Object.keys(probe.secretKeys) : [],
        };
        const snapshot = buildLinkedSnapshot(probe, link) ?? undefined;
        const out = applyMutation(state, {
          kind: 'linkedWorkspace.upsert',
          link,
          ledger,
          ...(snapshot ? { snapshot } : {}),
        });
        await saveToFile(dir, out.next);
        process.stdout.write(
          `${kleur.green('linked')} ${kleur.bold(repo)} ${kleur.dim(`(id ${link.id}, ${link.pinnedVersion ? `v${link.pinnedVersion}` : 'unpinned'})`)}\n`,
        );
      },
    );

  linked
    .command('refresh <id>')
    .description("Re-pull a linked workspace's cached release ledger.")
    .option('--workspace-name <name-or-id>', 'Workspace name or id.')
    .option('-w, --workspace-path <dir>', 'Workspace folder path.')
    .option('--token <token>', 'GitHub token (or set GITHUB_TOKEN).')
    .action(async (id: string, opts: SharedOptions) => {
      const dir = await resolveDir(opts);
      const state = await ensureWorkspace(dir);
      const link = state.synced.linkedWorkspaces[id];
      if (!link) {
        process.stderr.write(`${kleur.red('error')}: linked workspace ${id} not found\n`);
        process.exit(2);
      }
      const token = resolveToken(opts);
      if (link.kind === 'private' && !token) {
        process.stderr.write(
          `${kleur.red('error')}: a token is required for private links (--token or GITHUB_TOKEN)\n`,
        );
        process.exit(2);
      }
      const [owner, name] = link.source.repoFullName.split('/', 2);
      const client = new GitHubClient();
      const result = await fetchRemoteWorkspaceJson(async (p) => {
        const f = await client.getContents(token, owner, name, p, link.source.branch);
        return f?.content ?? null;
      });
      if ('error' in result) {
        process.stderr.write(
          `${kleur.red('error')}: ${link.source.repoFullName}@${link.source.branch}: ${result.error}\n`,
        );
        process.exit(2);
      }
      const probe = parseLinkedWorkspaceJson(result.content);
      const ledger = ledgerFromProbe(probe);
      const needsSnapshot = !state.local.linkedCollections[id];
      const snapshot = needsSnapshot ? (buildLinkedSnapshot(probe, link) ?? undefined) : undefined;
      const out = applyMutation(state, {
        kind: 'linkedWorkspace.upsert',
        link,
        ledger,
        ...(snapshot ? { snapshot } : {}),
      });
      await saveToFile(dir, out.next);
      process.stdout.write(
        `${kleur.green('refreshed')} ${kleur.bold(link.name)} ${kleur.dim(`(${ledger.versions.length} version(s), current ${ledger.currentVersion ?? 'none'})`)}\n`,
      );
    });

  linked
    .command('unlink <id>')
    .description('Unlink a workspace (drops cached ledger + overrides + snapshot).')
    .option('--workspace-name <name-or-id>', 'Workspace name or id.')
    .option('-w, --workspace-path <dir>', 'Workspace folder path.')
    .action(async (id: string, opts: SharedOptions) => {
      const dir = await resolveDir(opts);
      const state = await ensureWorkspace(dir);
      if (!state.synced.linkedWorkspaces[id]) {
        process.stderr.write(`${kleur.red('error')}: linked workspace ${id} not found\n`);
        process.exit(2);
      }
      const out = applyMutation(state, { kind: 'linkedWorkspace.remove', id });
      await saveToFile(dir, out.next);
      process.stdout.write(`${kleur.green('unlinked')} ${kleur.dim(id)}\n`);
    });
}
