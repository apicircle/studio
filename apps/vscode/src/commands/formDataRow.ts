import * as vscode from 'vscode';
import type { GlobalFileAsset } from '@apicircle/shared';
import { findSectionRange, readSectionType } from './switchRequestSection';
import { pickGlobalFileAsset, type FileAssetPickerDeps } from './fileAssetPicker';
import { uriEntityKind } from '../fs/uriKind';

// =============================================================================
// Form-data row affordances. Three commands surface from the CodeLens row
// above each `- kind:` entry in a `formRows:` list:
//
//   apicircle.addFormDataRow(uri, kind)
//     Append a text or file row to the formRows list. For 'file' the picker
//     opens immediately so the new row already has a slotId / globalFileAssetId.
//
//   apicircle.switchFormDataRowKind(uri, rowIndex)
//     Toggle row N between { kind: text } and { kind: file }. Switching to
//     file opens the picker; switching to text strips the file fields and
//     preserves key + enabled.
//
//   apicircle.pickFormDataRowFile(uri, rowIndex)
//     Re-pick (or first-pick) the file for an existing `kind: file` row.
//
// Each YAML rewrite goes through a single `WorkspaceEdit` so undo / redo
// behaves as a single user action.
// =============================================================================

const FORM_ROWS_RE = /^\s+formRows\s*:/;
const FORM_ROW_KIND_RE = /^\s+-\s+kind:\s*['"]?(text|file)['"]?/;
const FORM_ROW_KEY_RE = /^\s+key:\s*['"]?([^'"\n]+)['"]?/;
const FORM_ROW_VALUE_RE = /^\s+value:\s*['"]?([^'"\n]+)['"]?/;

export interface FormDataRowDeps extends FileAssetPickerDeps {
  /** Test-only hook: skip the file picker and use the supplied asset directly. */
  resolveAsset?: () => Promise<GlobalFileAsset | undefined>;
  /** Test-only override for the row-index quick-pick. */
  pickRowIndex?: (rows: ParsedFormRow[], placeholder: string) => Promise<number | undefined>;
}

export interface ParsedFormRow {
  index: number;
  /** Document line where the `- kind:` token sits. */
  headerLine: number;
  /** Document line of the next sibling row (or end of formRows). Exclusive. */
  endLine: number;
  kind: 'text' | 'file';
  key: string;
  value: string;
  /** Raw lines of this row for verbatim re-render when only the kind toggles. */
  rawLines: string[];
}

// ---------------------------------------------------------------------------
// addFormDataRow
// ---------------------------------------------------------------------------

export async function addFormDataRowCommand(
  deps: FormDataRowDeps,
  uri: vscode.Uri | undefined,
  kind: 'text' | 'file',
): Promise<void> {
  const document = await ensureFormDataDocument(uri);
  if (!document) return;

  let file: GlobalFileAsset | undefined;
  if (kind === 'file') {
    file = await (deps.resolveAsset ? deps.resolveAsset() : pickGlobalFileAsset(deps));
    if (!file) return;
  }

  // Reopen after the picker because picking a fresh file applies a
  // globalAsset.upsertFile patch through the workspace mirror, and the
  // refreshed text reflects the updated synced doc.
  const refreshed = await vscode.workspace.openTextDocument(document.uri);
  const editor = await vscode.window.showTextDocument(refreshed);

  const block = renderFormDataRow(kind, file);
  const edit = new vscode.WorkspaceEdit();
  const formRowsRange = findFormRowsRange(refreshed);
  if (!formRowsRange) {
    // No formRows: key yet — append the key + the row to the body section.
    const bodyRange = findSectionRange(refreshed, 'body');
    if (!bodyRange) {
      await vscode.window.showErrorMessage('body: section not found.');
      return;
    }
    const insertion = `  formRows:\n${block}`;
    edit.insert(refreshed.uri, bodyRange.end, insertion);
  } else {
    edit.insert(refreshed.uri, formRowsRange.end, block);
  }
  const ok = await vscode.workspace.applyEdit(edit);
  if (!ok) {
    await vscode.window.showErrorMessage('Failed to add the form row.');
    return;
  }
  void editor.revealRange(
    new vscode.Range(refreshed.lineCount - 1, 0, refreshed.lineCount - 1, 0),
    vscode.TextEditorRevealType.InCenter,
  );
}

// ---------------------------------------------------------------------------
// switchFormDataRowKind
// ---------------------------------------------------------------------------

export async function switchFormDataRowKindCommand(
  deps: FormDataRowDeps,
  uri: vscode.Uri | undefined,
  rowIndex?: number,
): Promise<void> {
  const document = await ensureFormDataDocument(uri);
  if (!document) return;
  const rows = parseFormRows(document);
  if (rows.length === 0) {
    await vscode.window.showWarningMessage('No formRows entries to switch.');
    return;
  }

  const target = await resolveRow(rows, rowIndex, 'Pick a row to switch', deps.pickRowIndex);
  if (target === null) return;

  const nextKind: 'text' | 'file' = target.kind === 'text' ? 'file' : 'text';
  let file: GlobalFileAsset | undefined;
  if (nextKind === 'file') {
    file = await (deps.resolveAsset ? deps.resolveAsset() : pickGlobalFileAsset(deps));
    if (!file) return;
  }

  await replaceRow(document, target, renderFormDataRow(nextKind, file, target.key));
}

// ---------------------------------------------------------------------------
// pickFormDataRowFile
// ---------------------------------------------------------------------------

export async function pickFormDataRowFileCommand(
  deps: FormDataRowDeps,
  uri: vscode.Uri | undefined,
  rowIndex?: number,
): Promise<void> {
  const document = await ensureFormDataDocument(uri);
  if (!document) return;
  const rows = parseFormRows(document).filter((r) => r.kind === 'file');
  if (rows.length === 0) {
    await vscode.window.showWarningMessage(
      'No `kind: file` rows in formRows — add one via the "+ Add file row" lens first.',
    );
    return;
  }
  const target = await resolveRow(rows, rowIndex, 'Pick the file row to bind', deps.pickRowIndex);
  if (target === null) return;

  const file = await (deps.resolveAsset ? deps.resolveAsset() : pickGlobalFileAsset(deps));
  if (!file) return;

  await replaceRow(document, target, renderFormDataRow('file', file, target.key));
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

async function ensureFormDataDocument(
  uri: vscode.Uri | undefined,
): Promise<vscode.TextDocument | null> {
  const targetUri = uri ?? vscode.window.activeTextEditor?.document.uri;
  if (!targetUri) {
    await vscode.window.showWarningMessage('No request YAML is active.');
    return null;
  }
  if (targetUri.scheme !== 'apicircle' || uriEntityKind(targetUri) !== 'request') {
    await vscode.window.showWarningMessage(
      'This command only runs against APICircle request YAML files.',
    );
    return null;
  }
  const document = await vscode.workspace.openTextDocument(targetUri);
  const bodyType = readSectionType(document.getText(), 'body');
  if (bodyType !== 'form-data') {
    await vscode.window.showWarningMessage(
      `body.type is "${bodyType ?? 'none'}", not "form-data". Switch the body type to form-data first.`,
    );
    return null;
  }
  return document;
}

async function resolveRow(
  rows: ParsedFormRow[],
  rowIndex: number | undefined,
  placeholder: string,
  pickHook?: FormDataRowDeps['pickRowIndex'],
): Promise<ParsedFormRow | null> {
  if (rowIndex !== undefined) {
    const row = rows.find((r) => r.index === rowIndex);
    if (!row) {
      await vscode.window.showWarningMessage(`Row #${rowIndex} not found.`);
      return null;
    }
    return row;
  }
  if (rows.length === 1) return rows[0];
  const picker = pickHook ?? defaultRowPicker;
  const picked = await picker(rows, placeholder);
  if (picked === undefined) return null;
  const row = rows.find((r) => r.index === picked);
  return row ?? null;
}

async function defaultRowPicker(
  rows: ParsedFormRow[],
  placeholder: string,
): Promise<number | undefined> {
  const items = rows.map((r) => ({
    label: `#${r.index} · ${r.key || '(no key)'}`,
    description: `kind: ${r.kind}${r.value ? ` · ${r.value}` : ''}`,
    value: r.index,
  }));
  const pick = await vscode.window.showQuickPick(items, { placeHolder: placeholder });
  return pick?.value;
}

async function replaceRow(
  document: vscode.TextDocument,
  row: ParsedFormRow,
  rendered: string,
): Promise<void> {
  const refreshed = await vscode.workspace.openTextDocument(document.uri);
  // Re-parse against the refreshed text so the picker's mutation doesn't
  // desync the line range.
  const refreshedRows = parseFormRows(refreshed);
  const fresh = refreshedRows.find((r) => r.index === row.index);
  if (!fresh) {
    await vscode.window.showErrorMessage(`Row #${row.index} no longer exists.`);
    return;
  }
  const editor = await vscode.window.showTextDocument(refreshed);
  const start = new vscode.Position(fresh.headerLine, 0);
  const end =
    fresh.endLine < refreshed.lineCount
      ? new vscode.Position(fresh.endLine, 0)
      : refreshed.lineAt(refreshed.lineCount - 1).range.end;
  const edit = new vscode.WorkspaceEdit();
  edit.replace(refreshed.uri, new vscode.Range(start, end), rendered);
  const ok = await vscode.workspace.applyEdit(edit);
  if (!ok) {
    await vscode.window.showErrorMessage('Failed to rewrite the form row.');
    return;
  }
  editor.selection = new vscode.Selection(start, start);
  editor.revealRange(new vscode.Range(start, start), vscode.TextEditorRevealType.InCenter);
}

/** Render a single `- kind: text|file` row block. Returns text including the
 *  trailing newline so it slots cleanly between sibling rows. */
export function renderFormDataRow(
  kind: 'text' | 'file',
  file?: GlobalFileAsset,
  preservedKey?: string,
): string {
  const key = preservedKey && preservedKey.trim().length > 0 ? preservedKey : 'field';
  if (kind === 'text') {
    return (
      [
        '    - kind: text',
        `      key: ${yamlString(key)}`,
        `      value: ${yamlString('value')}`,
        '      enabled: true',
      ].join('\n') + '\n'
    );
  }
  // file row
  const lines: string[] = ['    - kind: file', `      key: ${yamlString(key)}`];
  if (file) {
    lines.push(`      slotId: ${yamlString(file.slotId)}`);
    lines.push(`      globalFileAssetId: ${yamlString(file.id)}`);
    lines.push(`      filename: ${yamlString(file.filename)}`);
    lines.push(`      size: ${file.size}`);
    lines.push(`      mimeType: ${yamlString(file.mimeType)}`);
    if (file.sha256) lines.push(`      sha256: ${yamlString(file.sha256)}`);
  } else {
    lines.push('      slotId: null');
  }
  lines.push('      enabled: true');
  return lines.join('\n') + '\n';
}

export function findFormRowsRange(document: vscode.TextDocument): vscode.Range | null {
  const bodyRange = findSectionRange(document, 'body');
  if (!bodyRange) return null;
  let startLine = -1;
  for (let i = bodyRange.start.line + 1; i < bodyRange.end.line; i++) {
    if (FORM_ROWS_RE.test(document.lineAt(i).text)) {
      startLine = i;
      break;
    }
  }
  if (startLine === -1) return null;
  let endLine = bodyRange.end.line - 1;
  for (let i = startLine + 1; i < bodyRange.end.line; i++) {
    const text = document.lineAt(i).text;
    if (/^\s{0,3}[A-Za-z]/.test(text)) {
      endLine = i - 1;
      break;
    }
  }
  const start = new vscode.Position(startLine, 0);
  const end =
    endLine + 1 < document.lineCount
      ? new vscode.Position(endLine + 1, 0)
      : document.lineAt(endLine).range.end;
  return new vscode.Range(start, end);
}

export function parseFormRows(document: vscode.TextDocument): ParsedFormRow[] {
  const range = findFormRowsRange(document);
  if (!range) return [];
  const rows: ParsedFormRow[] = [];
  for (let i = range.start.line + 1; i < range.end.line; i++) {
    const text = document.lineAt(i).text;
    const match = FORM_ROW_KIND_RE.exec(text);
    if (!match) continue;
    const kind = match[1] as 'text' | 'file';
    let endLine = range.end.line;
    for (let j = i + 1; j < range.end.line; j++) {
      if (FORM_ROW_KIND_RE.test(document.lineAt(j).text)) {
        endLine = j;
        break;
      }
    }
    let key = '';
    let value = '';
    const rawLines: string[] = [];
    for (let j = i; j < endLine; j++) {
      const lineText = document.lineAt(j).text;
      rawLines.push(lineText);
      const keyMatch = FORM_ROW_KEY_RE.exec(lineText);
      if (keyMatch) key = keyMatch[1];
      const valueMatch = FORM_ROW_VALUE_RE.exec(lineText);
      if (valueMatch) value = valueMatch[1];
    }
    rows.push({
      index: rows.length,
      headerLine: i,
      endLine,
      kind,
      key,
      value,
      rawLines,
    });
  }
  return rows;
}

function yamlString(value: string): string {
  if (/[:#&*!|>'"%@`]|^[\s-]/.test(value)) {
    return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
  }
  return `'${value.replace(/'/g, "''")}'`;
}
