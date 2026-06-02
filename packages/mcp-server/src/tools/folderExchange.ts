// MCP tools for the `apicircle.folder/v1` exchange format.
//
//   • `folder.export_json` — collect a self-contained JSON envelope for
//     a folder + its subtree. Embeds Global Asset dependencies (JSON
//     Schemas + GraphQL definitions) and captures file-asset metadata.
//     Auth credentials are REDACTED by default — callers opt in per
//     credential id via `includeCredentialIds`.
//
//   • `folder.import_json` — parse an envelope produced by
//     `folder.export_json` (or the in-app Export Folder modal) and graft
//     it into the active workspace under the requested parent folder.
//     Routes through the `folder.import_apicircle` patch on
//     `WorkspaceProvider.apply`, so the same name-uniquify + dependency
//     dedupe semantics apply to every writer (UI / CLI / MCP).

import { z } from 'zod';
import {
  collectFolderExport,
  parseApicircleFolderExport,
  redactFolderExportCredentials,
  serializeFolderExport,
  suggestFolderExportFilename,
} from '@apicircle/core';
import type { AnyToolDef } from './types';

export const folderExportJsonTool: AnyToolDef = {
  name: 'folder.export_json',
  description:
    'Export an existing folder (and its subtree) to the API Circle exchange JSON format. ' +
    'Embeds JSON Schema + GraphQL dependencies inline. Auth credentials are redacted by ' +
    'default — pass `includeCredentialIds` to keep specific fields verbatim (the report from ' +
    '`collectFolderExport` enumerates the available ids).',
  inputSchema: z.object({
    folderId: z.string().min(1, 'folderId is required'),
    /**
     * Subset of credential ids to KEEP in the output. Anything not in
     * this list (and every detected credential when this is empty)
     * gets blanked. Use the report-side ids surfaced by the export
     * report (`<scope>:<ownerId>.<authType>.<field>`).
     */
    includeCredentialIds: z.array(z.string()).optional(),
  }),
  async handler(input, ctx) {
    const state = await ctx.workspace.read();
    const collected = collectFolderExport({
      synced: state.synced,
      folderId: input.folderId,
    });
    if (!collected) {
      return {
        error: 'folder_not_found',
        message: `No folder with id "${input.folderId}" exists in the active workspace.`,
      };
    }
    const includeIds = new Set<string>(input.includeCredentialIds ?? []);
    const redacted = redactFolderExportCredentials(collected.envelope, includeIds);
    return {
      envelope: redacted,
      json: serializeFolderExport(redacted),
      filename: suggestFolderExportFilename(redacted),
      report: collected.report,
    };
  },
};

export const folderImportJsonTool: AnyToolDef = {
  name: 'folder.import_json',
  description:
    'Import an `apicircle.folder/v1` envelope into the active workspace. Folder + request ' +
    'ids are reminted, dependency references are remapped, and JSON Schema / GraphQL ' +
    'definitions that match an existing global asset (by name + content) are reused.',
  inputSchema: z.object({
    /** Either a JSON string or the already-parsed envelope object. */
    json: z.string().min(1).optional(),
    envelope: z.record(z.unknown()).optional(),
    parentFolderId: z.string().nullable().optional(),
  }),
  async handler(input, ctx) {
    if (!input.json && !input.envelope) {
      return {
        error: 'invalid_input',
        message: 'Pass either `json` (string) or `envelope` (object).',
      };
    }
    const text = input.json !== undefined ? input.json : JSON.stringify(input.envelope);
    let parsed: ReturnType<typeof parseApicircleFolderExport>;
    try {
      parsed = parseApicircleFolderExport(text);
    } catch (err) {
      return {
        error: 'invalid_envelope',
        message: err instanceof Error ? err.message : String(err),
      };
    }
    const out = await ctx.workspace.apply({
      kind: 'folder.import_apicircle',
      parsed,
      parentFolderId: input.parentFolderId ?? null,
    });
    return {
      rootFolderId: parsed.rootFolder.id,
      rootFolderName: parsed.rootFolder.name,
      counts: {
        folders: parsed.subfolders.length + 1,
        requests: parsed.requests.length,
      },
      filesRequiringReattachment: parsed.dependencies.files.map((f) => f.id),
      warnings: parsed.warnings,
      changedIds: out.changedIds,
    };
  },
};
