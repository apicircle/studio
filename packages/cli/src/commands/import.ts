import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import type { Command } from 'commander';
import kleur from 'kleur';
import { applyMutation, parseApicircleFolderExport } from '@apicircle/core';
import { saveToFile } from '@apicircle/core/workspace/file-backed';
import {
  parseInsomniaToEndpoints,
  parseOpenApiToEndpoints,
  parsePostmanToEndpoints,
} from '@apicircle/mock-server-core';
import { generateId, type Request as ApiRequest } from '@apicircle/shared';
import { ensureWorkspace } from '../util/loadWorkspace';
import { resolveWorkspace, WorkspaceResolutionError } from '../util/resolveWorkspace';

// =============================================================================
// `apicircle import <type> <spec>` — read an external spec, persist one
// request per operation into `<workspace>/workspace.json`.
// =============================================================================

type ImportType = 'curl' | 'openapi' | 'postman' | 'insomnia' | 'apicircle';

interface ImportOptions {
  workspaceName?: string;
  workspacePath?: string;
  format?: 'json' | 'yaml';
}

export function registerImportCommand(program: Command): void {
  program
    .command('import')
    .description('Import a spec into a workspace folder')
    .argument(
      '<type>',
      'Source type: openapi | postman | insomnia | curl | apicircle (the apicircle.folder/v1 envelope produced by `apicircle export folder`)',
    )
    .argument('<input>', 'Path to a spec file, or `-` to read from stdin')
    .option(
      '--workspace-name <name-or-id>',
      'Registry workspace name (case-insensitive) or id. Defaults to the active workspace.',
    )
    .option(
      '-w, --workspace-path <dir>',
      'Filesystem directory containing workspace.json (skips the registry).',
    )
    .option('-f, --format <format>', 'OpenAPI format: json | yaml', 'json')
    .action(async (type: ImportType, input: string, opts: ImportOptions) => {
      let dir: string;
      try {
        const resolved = await resolveWorkspace({
          name: opts.workspaceName,
          path: opts.workspacePath,
          expectExists: false,
        });
        dir = resolved.dir;
        if (resolved.fromRegistry) {
          process.stderr.write(
            `${kleur.dim('workspace')}: ${kleur.cyan(resolved.name ?? resolved.id ?? '')} ${kleur.dim(`(${dir})`)}\n`,
          );
        }
      } catch (err) {
        if (err instanceof WorkspaceResolutionError) {
          process.stderr.write(`${kleur.red('error')}: ${err.message}\n`);
          process.exit(2);
        }
        throw err;
      }
      const raw = await readInput(input);
      const state = await ensureWorkspace(dir);
      let nextSynced = state.synced;
      let nextLocal = state.local;
      const created: string[] = [];

      const append = (req: ApiRequest) => {
        const out = applyMutation(
          { synced: nextSynced, local: nextLocal },
          { kind: 'request.create', request: req },
        );
        nextSynced = out.next.synced;
        nextLocal = out.next.local;
        created.push(req.id);
      };

      if (type === 'curl') {
        const { parseCurl } = await import('@apicircle/core');
        const parsed = parseCurl(raw);
        append(
          blankRequest({
            name: `cURL ${parsed.method} ${parsed.url}`.slice(0, 80),
            method: parsed.method,
            url: parsed.url,
            headers: parsed.headers,
            query: parsed.query,
            body: parsed.body,
            auth: parsed.auth,
          }),
        );
      } else if (type === 'openapi') {
        const parsed = await parseOpenApiToEndpoints(raw, opts.format ?? 'json');
        for (const ep of parsed.endpoints) {
          append(
            blankRequest({
              name: ep.example ?? `${ep.method} ${ep.pathPattern}`,
              method: ep.method,
              url: ep.pathPattern,
            }),
          );
        }
      } else if (type === 'postman') {
        const parsed = parsePostmanToEndpoints(raw);
        for (const ep of parsed.endpoints) {
          append(
            blankRequest({
              name: ep.example ?? `${ep.method} ${ep.pathPattern}`,
              method: ep.method,
              url: ep.pathPattern,
            }),
          );
        }
      } else if (type === 'insomnia') {
        const parsed = parseInsomniaToEndpoints(raw);
        for (const ep of parsed.endpoints) {
          append(
            blankRequest({
              name: ep.example ?? `${ep.method} ${ep.pathPattern}`,
              method: ep.method,
              url: ep.pathPattern,
            }),
          );
        }
      } else if (type === 'apicircle') {
        // API Circle exchange envelope — graft the folder + subtree +
        // dependencies via the same applyMutation patch the UI / MCP use.
        let parsedEnvelope;
        try {
          parsedEnvelope = parseApicircleFolderExport(raw);
        } catch (err) {
          process.stderr.write(
            `${kleur.red('error')}: ${err instanceof Error ? err.message : String(err)}\n`,
          );
          process.exit(2);
        }
        const out = applyMutation(
          { synced: nextSynced, local: nextLocal },
          { kind: 'folder.import_apicircle', parsed: parsedEnvelope, parentFolderId: null },
        );
        nextSynced = out.next.synced;
        nextLocal = out.next.local;
        // `created` only counts requests in the other import branches —
        // mirror that here so the trailing line stays accurate. Folders
        // get reported separately below.
        for (const r of parsedEnvelope.requests) created.push(r.id);
        for (const w of parsedEnvelope.warnings) {
          process.stderr.write(`${kleur.yellow('warning')}: ${w}\n`);
        }
        await saveToFile(dir, { synced: nextSynced, local: nextLocal });
        process.stdout.write(
          `${kleur.green('imported')} folder "${parsedEnvelope.rootFolder.name}" ` +
            `(${parsedEnvelope.subfolders.length + 1} folders, ${parsedEnvelope.requests.length} requests) into ${dir}\n`,
        );
        if (parsedEnvelope.dependencies.files.length > 0) {
          process.stderr.write(
            `${kleur.yellow('note')}: ${parsedEnvelope.dependencies.files.length} file asset${parsedEnvelope.dependencies.files.length === 1 ? '' : 's'} ` +
              `landed without bytes — re-attach them inside Global Assets → Global Files.\n`,
          );
        }
        return;
      } else {
        // The four-branch chain above is exhaustive at the type level, so
        // `type` narrows to `never` here. Cast to string for the error
        // message — at runtime this only fires if a caller bypasses the
        // commander enum and passes garbage like `apicircle import xml ...`.
        process.stderr.write(`${kleur.red('error')}: unknown type '${String(type)}'\n`);
        process.exit(2);
      }

      await saveToFile(dir, { synced: nextSynced, local: nextLocal });
      process.stdout.write(
        `${kleur.green('imported')} ${created.length} request${created.length === 1 ? '' : 's'} into ${dir}\n`,
      );
    });
}

async function readInput(p: string): Promise<string> {
  if (p === '-') {
    return new Promise<string>((resolve, reject) => {
      let data = '';
      process.stdin.setEncoding('utf-8');
      // setEncoding('utf-8') causes `chunk` to arrive as a string at runtime,
      // but Node's types still surface it as `string | Buffer`. Coerce to
      // satisfy `restrict-plus-operands` without changing behaviour.
      process.stdin.on('data', (chunk: string | Buffer) => {
        data += typeof chunk === 'string' ? chunk : chunk.toString('utf-8');
      });
      process.stdin.on('end', () => resolve(data));
      process.stdin.on('error', reject);
    });
  }
  return fs.readFile(path.resolve(p), 'utf-8');
}

function blankRequest(
  partial: Partial<ApiRequest> & {
    name: string;
    method: ApiRequest['method'];
    url: string;
  },
): ApiRequest {
  const now = new Date().toISOString();
  return {
    id: generateId(),
    folderId: null,
    headers: [],
    query: [],
    body: { type: 'none', content: '' },
    auth: { type: 'none' },
    contextVars: [],
    extractions: [],
    assertions: [],
    createdAt: now,
    updatedAt: now,
    ...partial,
  };
}
