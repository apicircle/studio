import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import type { Command } from 'commander';
import kleur from 'kleur';
import {
  collectFolderExport,
  redactFolderExportCredentials,
  serializeFolderExport,
  suggestFolderExportFilename,
} from '@apicircle/core';
import type { Folder } from '@apicircle/shared';
import { ensureWorkspace } from '../util/loadWorkspace';
import { resolveWorkspace, WorkspaceResolutionError } from '../util/resolveWorkspace';

// =============================================================================
// `apicircle export folder <name-or-id> [--out file]` — write a single folder's
// `apicircle.folder/v1` JSON envelope. Suitable for sharing one collection
// with another teammate or workspace without round-tripping through Git.
//
// Auth credentials are REDACTED by default (matches the in-app modal's
// safe default). Pass `--include-credential <id> [--include-credential ...]`
// to opt specific fields IN; ids follow the report-side format
// `<scope>:<ownerId>.<authType>.<field>` — surface them with
// `apicircle export folder --list-credentials`.
// =============================================================================

interface ExportFolderOptions {
  workspaceName?: string;
  workspacePath?: string;
  out?: string;
  includeCredential?: string[];
  listCredentials?: boolean;
}

export function registerExportCommand(program: Command): void {
  const exportCmd = program
    .command('export')
    .description('Export workspace entities to portable JSON.');

  exportCmd
    .command('folder')
    .description('Export a folder (and its subtree) as an apicircle.folder/v1 JSON envelope.')
    .argument(
      '<folder>',
      'Folder id, or display name (case-insensitive). Unique within the workspace.',
    )
    .option('-o, --out <path>', 'Write the JSON to this file. Defaults to stdout.')
    .option(
      '--include-credential <id>',
      'Keep the credential field with this id (repeatable). Use --list-credentials to see ids.',
      (value: string, prev: string[] = []) => [...prev, value],
      [] as string[],
    )
    .option(
      '--list-credentials',
      'Print the detected credentials + their ids and exit without writing anything.',
    )
    .option(
      '--workspace-name <name-or-id>',
      'Registry workspace name (case-insensitive) or id. Defaults to the active workspace.',
    )
    .option(
      '-w, --workspace-path <dir>',
      'Filesystem directory containing workspace.synced.json (skips the registry).',
    )
    .action(async (folder: string, opts: ExportFolderOptions) => {
      let dir: string;
      try {
        const resolved = await resolveWorkspace({
          name: opts.workspaceName,
          path: opts.workspacePath,
        });
        dir = resolved.dir;
      } catch (err) {
        if (err instanceof WorkspaceResolutionError) {
          process.stderr.write(`${kleur.red('error')}: ${err.message}\n`);
          process.exit(2);
        }
        throw err;
      }
      const state = await ensureWorkspace(dir);
      const folderId = resolveFolderId(state.synced.collections.folders, folder);
      if (!folderId) {
        process.stderr.write(`${kleur.red('error')}: no folder matches "${folder}" in ${dir}\n`);
        process.exit(2);
      }
      const collected = collectFolderExport({ synced: state.synced, folderId });
      if (!collected) {
        // Should not happen — resolveFolderId already proved it exists.
        process.stderr.write(`${kleur.red('error')}: folder "${folder}" no longer exists\n`);
        process.exit(2);
      }
      if (opts.listCredentials) {
        if (collected.report.credentials.length === 0) {
          process.stdout.write('No credential-bearing auth fields detected.\n');
          return;
        }
        for (const cred of collected.report.credentials) {
          process.stdout.write(`${cred.id}\t${cred.label}\t${cred.ownerName}\n`);
        }
        return;
      }
      const includeIds = new Set<string>(opts.includeCredential ?? []);
      const envelope = redactFolderExportCredentials(collected.envelope, includeIds);
      const json = serializeFolderExport(envelope);
      if (opts.out) {
        const outPath = path.resolve(opts.out);
        await fs.writeFile(outPath, json, 'utf-8');
        process.stderr.write(
          `${kleur.green('exported')} folder "${collected.report.folderName}" → ${outPath}\n`,
        );
      } else {
        process.stdout.write(json);
        process.stdout.write('\n');
        process.stderr.write(
          `${kleur.green('exported')} folder "${collected.report.folderName}" ` +
            `(${collected.report.totalFolderCount} folders, ${collected.report.requestCount} requests, ` +
            `${collected.report.credentials.length - includeIds.size} credentials redacted)\n`,
        );
      }
      // Surface a suggested filename in the trailing message even when
      // streaming to stdout so consumers piping into a tool have a
      // sensible name to suggest.
      if (!opts.out) {
        process.stderr.write(
          `${kleur.dim('hint')}: save with .apicircle.json, e.g. ${suggestFolderExportFilename(envelope)}\n`,
        );
      }
    });
}

function resolveFolderId(folders: Record<string, Folder>, query: string): string | null {
  // Direct id match first.
  if (folders[query]) return query;
  // Case-insensitive unique name match — same trimming the editor uses.
  const norm = query.trim().toLowerCase();
  const matches = Object.values(folders).filter((f) => f.name.trim().toLowerCase() === norm);
  if (matches.length === 1) return matches[0].id;
  return null;
}
