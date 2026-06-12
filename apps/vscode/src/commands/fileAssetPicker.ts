import * as vscode from 'vscode';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as crypto from 'node:crypto';
import { generateId } from '@apicircle/shared';
import type { GlobalFileAsset } from '@apicircle/shared';
import type { VsCodeBridge } from '../host/vscodeBridge';

// =============================================================================
// pickGlobalFileAsset — shared Global Assets picker for the binary-body
// attachment and the form-data file-row flows. Mirrors the desktop / web app's
// "pick an existing library file or upload a new one" UX in a quick-pick:
//
//   📚 Choose from library
//     <existing GlobalFileAsset>     <size · mime>
//     <existing GlobalFileAsset>     <size · mime>
//   ─────────
//   📤 Upload a new file…
//
// On "Upload a new file…" the native file-open dialog opens, the bytes are
// copied to `<apicircleDir>/attachments/<slotId>`, a sha256 + size + mime
// triple is computed, and a fresh GlobalFileAsset is registered via the
// `globalAsset.upsertFile` patch so the shared library shows it on every
// surface (desktop, web, CLI, MCP) the moment they re-read the workspace.
//
// Returns the resolved GlobalFileAsset (existing or freshly created), or
// `undefined` when the user cancels.
// =============================================================================

export interface FileAssetPickerDeps {
  bridge: VsCodeBridge;
  /** Test-only override hook for the file-open dialog. */
  showOpenDialog?: typeof vscode.window.showOpenDialog;
  /** Test-only override hook for computing the attachment-on-disk path. */
  attachmentPathFor?: (apicircleDir: string, slotId: string) => string;
  /** Test-only override hook for the on-disk copy step. */
  writeAttachment?: (dest: string, bytes: Buffer) => Promise<void>;
}

export async function pickGlobalFileAsset(
  deps: FileAssetPickerDeps,
): Promise<GlobalFileAsset | undefined> {
  const active = deps.bridge.activeWorkspace();
  if (!active) {
    await vscode.window.showWarningMessage('No active APICircle workspace.');
    return undefined;
  }
  const state = await active.read();
  const files = Object.values(state.synced.globalAssets.files ?? {}).sort((a, b) =>
    a.filename.localeCompare(b.filename, undefined, { sensitivity: 'base' }),
  );

  const UPLOAD_VALUE = '__upload__';
  type PickItem = vscode.QuickPickItem & { value: string };
  const items: PickItem[] = [];
  if (files.length > 0) {
    items.push({
      label: '📚 Choose from library',
      kind: vscode.QuickPickItemKind.Separator,
      value: '',
    });
    for (const f of files) {
      items.push({
        label: f.filename,
        description: `${formatBytes(f.size)} · ${f.mimeType || 'application/octet-stream'}`,
        detail: f.description,
        value: f.id,
      });
    }
    items.push({
      label: '',
      kind: vscode.QuickPickItemKind.Separator,
      value: '',
    });
  }
  items.push({
    label: '📤 Upload a new file…',
    description: 'Native file picker. Copies bytes to .apicircle/attachments/<slotId>.',
    value: UPLOAD_VALUE,
  });

  const pick = await vscode.window.showQuickPick(items, {
    title: 'Pick a file asset',
    placeHolder:
      files.length === 0
        ? 'No files in the library yet — upload one to add it to the shared library.'
        : 'Pick an existing file or upload a new one.',
    matchOnDescription: true,
  });
  if (!pick) return undefined;

  if (pick.value !== UPLOAD_VALUE) {
    return files.find((f) => f.id === pick.value);
  }

  // ---- Upload flow ----
  const showOpenDialog = deps.showOpenDialog ?? vscode.window.showOpenDialog;
  const uris = await showOpenDialog({
    canSelectFiles: true,
    canSelectFolders: false,
    canSelectMany: false,
    openLabel: 'Add to API Circle Library',
  });
  if (!uris || uris.length === 0) return undefined;

  const source = uris[0].fsPath;
  let bytes: Buffer;
  let stat: fs.Stats;
  try {
    bytes = await fs.promises.readFile(source);
    stat = await fs.promises.stat(source);
  } catch (err) {
    await vscode.window.showErrorMessage(
      `Failed to read ${source}: ${err instanceof Error ? err.message : String(err)}`,
    );
    return undefined;
  }

  const slotId = generateId();
  const filename = path.basename(source);
  const mimeType = guessMimeType(filename);
  const sha256 = crypto.createHash('sha256').update(bytes).digest('hex');
  const apicircleDir = active.workspace.apicircleDir;
  const destPath = (deps.attachmentPathFor ?? defaultAttachmentPath)(apicircleDir, slotId);

  try {
    await fs.promises.mkdir(path.dirname(destPath), { recursive: true });
    if (deps.writeAttachment) {
      await deps.writeAttachment(destPath, bytes);
    } else {
      await fs.promises.writeFile(destPath, bytes);
    }
  } catch (err) {
    await vscode.window.showErrorMessage(
      `Failed to write attachment to ${destPath}: ${err instanceof Error ? err.message : String(err)}`,
    );
    return undefined;
  }

  const now = new Date().toISOString();
  const file: GlobalFileAsset = {
    id: generateId(),
    name: filename,
    slotId,
    filename,
    size: stat.size,
    mimeType,
    sha256,
    createdAt: now,
    updatedAt: now,
  };
  await active.apply({ kind: 'globalAsset.upsertFile', file });
  return file;
}

/** Recognise common file types from their extension. Falls back to
 *  `application/octet-stream` so unknown extensions still produce a valid
 *  GlobalFileAsset. Extracted so the binary + form-data flows pick the
 *  same mime even when the OS file dialog doesn't supply one. */
export function guessMimeType(filename: string): string {
  const ext = path.extname(filename).toLowerCase();
  switch (ext) {
    case '.json':
      return 'application/json';
    case '.xml':
      return 'application/xml';
    case '.yaml':
    case '.yml':
      return 'application/yaml';
    case '.txt':
      return 'text/plain';
    case '.csv':
      return 'text/csv';
    case '.html':
    case '.htm':
      return 'text/html';
    case '.md':
      return 'text/markdown';
    case '.pdf':
      return 'application/pdf';
    case '.png':
      return 'image/png';
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg';
    case '.gif':
      return 'image/gif';
    case '.svg':
      return 'image/svg+xml';
    case '.webp':
      return 'image/webp';
    case '.zip':
      return 'application/zip';
    case '.gz':
      return 'application/gzip';
    default:
      return 'application/octet-stream';
  }
}

function defaultAttachmentPath(apicircleDir: string, slotId: string): string {
  return path.join(apicircleDir, 'attachments', slotId);
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
