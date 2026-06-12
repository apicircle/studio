import * as vscode from 'vscode';
import { findSectionRange } from './switchRequestSection';

// =============================================================================
// `apicircle.mapContextVarsFromJson` — driven by the CodeLens above
// `contextVars:` in a request YAML. Opens a multi-line input box, the user
// pastes a JSON object, and the result is flattened into dotted-path keys.
//
// Example:
//
//   { "user": { "id": 42, "name": "Ada" }, "items": [ "a", "b" ] }
//
// produces:
//
//   contextVars:
//     - key: 'user.id'
//       value: '42'
//     - key: 'user.name'
//       value: 'Ada'
//     - key: 'items.0'
//       value: 'a'
//     - key: 'items.1'
//       value: 'b'
//
// Existing contextVars rows are REPLACED — the user chose this entry point
// specifically to map fresh data. Confirm with a modal before discarding
// previous rows so a misclick doesn't lose work.
// =============================================================================

export async function mapContextVarsFromJsonCommand(uri?: vscode.Uri): Promise<void> {
  const targetUri = uri ?? vscode.window.activeTextEditor?.document.uri;
  if (!targetUri) {
    await vscode.window.showWarningMessage('No request YAML is active.');
    return;
  }
  if (targetUri.scheme !== 'apicircle' || !targetUri.path.endsWith('.req.yaml')) {
    await vscode.window.showWarningMessage(
      'This command only runs against APICircle request YAML files.',
    );
    return;
  }
  const document = await vscode.workspace.openTextDocument(targetUri);

  const raw = await vscode.window.showInputBox({
    title: 'Map contextVars from JSON',
    prompt: 'Paste a JSON object — keys flatten to dotted paths (e.g. user.id), values stringify.',
    placeHolder: '{ "user": { "id": 42 }, "scope": "read" }',
    ignoreFocusOut: true,
    validateInput: (value) => {
      const trimmed = value.trim();
      if (trimmed.length === 0) return 'Paste a JSON object first.';
      try {
        const parsed: unknown = JSON.parse(trimmed);
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
          return 'Top-level value must be a JSON object (use {...}).';
        }
      } catch (err) {
        return `Invalid JSON: ${err instanceof Error ? err.message : String(err)}`;
      }
      return null;
    },
  });
  if (!raw) return;

  const parsed = JSON.parse(raw.trim()) as Record<string, unknown>;
  const rows = flattenJsonToRows(parsed);
  if (rows.length === 0) {
    await vscode.window.showWarningMessage('The pasted object has no primitive leaves to map.');
    return;
  }

  // If the existing contextVars: section has rows, confirm replacement.
  const existingRange = findSectionRange(document, 'contextVars');
  if (existingRange && existingRange.end.line - existingRange.start.line > 1) {
    const confirm = await vscode.window.showWarningMessage(
      `Replace the existing contextVars (${existingRange.end.line - existingRange.start.line - 1} line(s)) with ${rows.length} mapped row(s)?`,
      { modal: true },
      'Replace',
    );
    if (confirm !== 'Replace') return;
  }

  const block = renderContextVarsBlock(rows);
  const refreshed = await vscode.workspace.openTextDocument(targetUri);
  const editor = await vscode.window.showTextDocument(refreshed);
  const edit = new vscode.WorkspaceEdit();
  const sectionRange = findSectionRange(refreshed, 'contextVars');
  if (sectionRange) {
    edit.replace(refreshed.uri, sectionRange, block);
  } else {
    const endLine = refreshed.lineCount - 1;
    const endPosition = refreshed.lineAt(endLine).range.end;
    const prefix = refreshed.lineAt(endLine).text.trim().length > 0 ? '\n\n' : '\n';
    edit.insert(refreshed.uri, endPosition, prefix + block);
  }
  const ok = await vscode.workspace.applyEdit(edit);
  if (!ok) {
    await vscode.window.showErrorMessage('Failed to write contextVars block.');
    return;
  }
  await vscode.window.showInformationMessage(
    `Mapped ${rows.length} contextVar row(s) from the pasted JSON.`,
  );
  void editor.revealRange(
    new vscode.Range(refreshed.lineCount - 1, 0, refreshed.lineCount - 1, 0),
    vscode.TextEditorRevealType.InCenter,
  );
}

/** Flatten a JSON object into dotted-path key/value rows. Nested objects use
 *  `.` as the separator; arrays use the index. Primitive leaves (string,
 *  number, boolean, null) stringify via String(). null becomes the literal
 *  string "null" so the user can spot it in the YAML output. */
export function flattenJsonToRows(
  obj: unknown,
  prefix = '',
): Array<{ key: string; value: string }> {
  if (obj === null || obj === undefined) {
    return prefix ? [{ key: prefix, value: 'null' }] : [];
  }
  if (typeof obj === 'string' || typeof obj === 'number' || typeof obj === 'boolean') {
    // Primitive at root with no prefix shouldn't happen (the input validator
    // requires a top-level object), but a primitive leaf at depth becomes a
    // row. Splitting the primitive branch out narrows `obj` away from
    // `unknown` so the base-to-string rule is satisfied without a cast.
    return prefix ? [{ key: prefix, value: String(obj) }] : [];
  }
  if (typeof obj !== 'object') {
    // Functions / symbols / bigints — can't appear in valid JSON. Drop the
    // row entirely rather than coerce to a misleading string.
    return [];
  }
  if (Array.isArray(obj)) {
    const out: Array<{ key: string; value: string }> = [];
    obj.forEach((entry, i) => {
      const childPrefix = prefix ? `${prefix}.${i}` : `${i}`;
      out.push(...flattenJsonToRows(entry, childPrefix));
    });
    return out;
  }
  const out: Array<{ key: string; value: string }> = [];
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    const childPrefix = prefix ? `${prefix}.${k}` : k;
    out.push(...flattenJsonToRows(v, childPrefix));
  }
  return out;
}

export function renderContextVarsBlock(rows: Array<{ key: string; value: string }>): string {
  const lines: string[] = ['contextVars:'];
  for (const row of rows) {
    lines.push(`  - key: ${yamlString(row.key)}`);
    lines.push(`    value: ${yamlString(row.value)}`);
  }
  return lines.join('\n') + '\n';
}

function yamlString(value: string): string {
  if (/[:#&*!|>'"%@`]|^[\s-]/.test(value)) {
    return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
  }
  return `'${value.replace(/'/g, "''")}'`;
}
