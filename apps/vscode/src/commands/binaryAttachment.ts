import * as vscode from 'vscode';
import type { GlobalFileAsset } from '@apicircle/shared';
import { findSectionRange, readSectionType } from './switchRequestSection';
import { pickGlobalFileAsset, type FileAssetPickerDeps } from './fileAssetPicker';
import { uriEntityKind } from '../fs/uriKind';

// =============================================================================
// `apicircle.pickBinaryAttachment` — driven by the CodeLens above a binary
// body. Pops the shared Global Assets picker, then rewrites the whole body:
// section so the result is a clean `type: binary` + `attachment:` block.
//
// We rewrite the WHOLE body section, not just the attachment sub-block, so any
// leftover `content: ""` placeholder from the binary scaffold (or scaffold
// comments) disappears — the runner reads the bytes from `attachment.slotId`
// for binary bodies, so keeping a `content` field would just be noise the
// user has to clean up by hand.
// =============================================================================

const ATTACHMENT_KEY_RE = /^\s+attachment\s*:/;

export interface BinaryAttachmentDeps extends FileAssetPickerDeps {
  /** Test-only hook: skip the picker and use the supplied asset directly. */
  resolveAsset?: () => Promise<GlobalFileAsset | undefined>;
}

export async function pickBinaryAttachmentCommand(
  deps: BinaryAttachmentDeps,
  uri?: vscode.Uri,
): Promise<void> {
  const targetUri = uri ?? vscode.window.activeTextEditor?.document.uri;
  if (!targetUri) {
    await vscode.window.showWarningMessage('No request YAML is active.');
    return;
  }
  if (targetUri.scheme !== 'apicircle' || uriEntityKind(targetUri) !== 'request') {
    await vscode.window.showWarningMessage(
      'This command only runs against APICircle request YAML files.',
    );
    return;
  }
  const document = await vscode.workspace.openTextDocument(targetUri);
  const text = document.getText();
  const bodyType = readSectionType(text, 'body');
  if (bodyType !== 'binary') {
    await vscode.window.showWarningMessage(
      `body.type is "${bodyType ?? 'none'}", not "binary". Use the Switch body type lens to flip to binary first.`,
    );
    return;
  }

  const file = await (deps.resolveAsset ? deps.resolveAsset() : pickGlobalFileAsset(deps));
  if (!file) return;

  // Reopen the document — applyMutation may have written to workspace.json
  // (when the user uploaded a new file) and we want the freshest text.
  const refreshed = await vscode.workspace.openTextDocument(targetUri);
  const editor = await vscode.window.showTextDocument(refreshed);

  const block = renderBinaryBodyBlock(file);
  const bodyRange = findSectionRange(refreshed, 'body');
  if (!bodyRange) {
    await vscode.window.showErrorMessage('body: section not found — cannot attach.');
    return;
  }
  const edit = new vscode.WorkspaceEdit();
  edit.replace(refreshed.uri, bodyRange, block);
  const ok = await vscode.workspace.applyEdit(edit);
  if (!ok) {
    await vscode.window.showErrorMessage('Failed to write attachment back to the request YAML.');
    return;
  }
  // Move cursor to the freshly-written attachment so the user sees the link.
  const final = await vscode.workspace.openTextDocument(targetUri);
  const finalRange = findExistingAttachmentRange(final);
  if (finalRange) {
    editor.selection = new vscode.Selection(finalRange.start, finalRange.start);
    editor.revealRange(finalRange, vscode.TextEditorRevealType.InCenter);
  }
  await vscode.window.showInformationMessage(
    `Attached ${file.filename} (${formatBytes(file.size)}) to the request body.`,
  );
}

/** YAML for a complete binary `body:` section with the picked attachment.
 *  Replaces the whole body block — drops any leftover `content: ""` /
 *  scaffold comments so the result reads cleanly. Ends with a trailing
 *  newline so a `findSectionRange` replacement leaves the document tidy. */
export function renderBinaryBodyBlock(file: GlobalFileAsset): string {
  return `body:\n  type: binary\n${renderAttachmentBlock(file)}`;
}

/** YAML block representing just `attachment:` and its child fields (no
 *  surrounding `body:`). Used by `renderBinaryBodyBlock` and the test suite. */
export function renderAttachmentBlock(file: GlobalFileAsset): string {
  const lines: string[] = ['  attachment:'];
  lines.push(`    slotId: ${yamlString(file.slotId)}`);
  lines.push(`    globalFileAssetId: ${yamlString(file.id)}`);
  lines.push(`    filename: ${yamlString(file.filename)}`);
  lines.push(`    size: ${file.size}`);
  lines.push(`    mimeType: ${yamlString(file.mimeType)}`);
  if (file.sha256) {
    lines.push(`    sha256: ${yamlString(file.sha256)}`);
  }
  return `${lines.join('\n')}\n`;
}

/** Find the line range of the inner `attachment:` block inside body:. Returns
 *  null when absent. Kept for test-suite assertions + cursor-positioning. */
export function findExistingAttachmentRange(document: vscode.TextDocument): vscode.Range | null {
  const bodyRange = findSectionRange(document, 'body');
  if (!bodyRange) return null;
  let attachStartLine = -1;
  for (let i = bodyRange.start.line + 1; i < bodyRange.end.line; i++) {
    const text = document.lineAt(i).text;
    if (ATTACHMENT_KEY_RE.test(text)) {
      attachStartLine = i;
      break;
    }
  }
  if (attachStartLine === -1) return null;
  let attachEndLine = bodyRange.end.line - 1;
  for (let i = attachStartLine + 1; i < bodyRange.end.line; i++) {
    const text = document.lineAt(i).text;
    // The attachment block runs while lines are indented deeper than the
    // outer `attachment:` row (two-space child indent inside `body:`).
    if (/^\s{0,3}[A-Za-z]/.test(text)) {
      attachEndLine = i - 1;
      break;
    }
  }
  const start = new vscode.Position(attachStartLine, 0);
  const end =
    attachEndLine + 1 < document.lineCount
      ? new vscode.Position(attachEndLine + 1, 0)
      : document.lineAt(attachEndLine).range.end;
  return new vscode.Range(start, end);
}

function yamlString(value: string): string {
  // Quoting rule: anything containing a colon, leading whitespace, or YAML
  // special characters needs double-quoting. Default to single quotes
  // otherwise so we don't have to escape backslashes in sha256 / paths.
  if (/[:#&*!|>'"%@`]|^[\s-]/.test(value)) {
    return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
  }
  return `'${value.replace(/'/g, "''")}'`;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
