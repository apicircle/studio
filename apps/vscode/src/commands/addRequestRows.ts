import * as vscode from 'vscode';
import { findSectionRange } from './switchRequestSection';
import { uriEntityKind } from '../fs/uriKind';

// =============================================================================
// Per-section "+ Add row" commands for request YAML editing. Each command
// finds (or creates) the relevant top-level section and appends a new row
// scaffolded for its shape:
//
//   query / cookies / pathParams      simple key + value input boxes
//   assertions                         kind + op + expected (with op-aware UX)
//   extractions                        variable + source + path (source picker)
//
// Saves are NOT auto-triggered — the user can keep editing the freshly
// inserted row before they hit Ctrl+S. The FS provider parses + applies
// `request.update` on save the same way as any other request YAML edit.
// =============================================================================

interface KVAddDeps {
  sectionKey: 'query' | 'cookies' | 'pathParams';
  rowTitle: string;
  defaultKey: string;
}

const KV_DEFS: Record<KVAddDeps['sectionKey'], KVAddDeps> = {
  query: {
    sectionKey: 'query',
    rowTitle: 'Query param',
    defaultKey: 'param',
  },
  cookies: {
    sectionKey: 'cookies',
    rowTitle: 'Cookie',
    defaultKey: 'name',
  },
  pathParams: {
    sectionKey: 'pathParams',
    rowTitle: 'Path param',
    defaultKey: 'id',
  },
};

async function ensureRequestDocument(uri?: vscode.Uri): Promise<vscode.TextDocument | null> {
  const targetUri = uri ?? vscode.window.activeTextEditor?.document.uri;
  if (!targetUri) {
    await vscode.window.showWarningMessage('No request YAML is active.');
    return null;
  }
  if (targetUri.scheme !== 'apicircle' || uriEntityKind(targetUri) !== 'request') {
    await vscode.window.showWarningMessage(
      'This command only runs against API Circle request YAML files.',
    );
    return null;
  }
  return vscode.workspace.openTextDocument(targetUri);
}

async function addKVRow(
  uri: vscode.Uri | undefined,
  sectionKey: KVAddDeps['sectionKey'],
): Promise<void> {
  const def = KV_DEFS[sectionKey];
  const document = await ensureRequestDocument(uri);
  if (!document) return;

  const key = await vscode.window.showInputBox({
    title: `New ${def.rowTitle}`,
    prompt: 'Key',
    value: def.defaultKey,
    validateInput: (v) => (v.trim().length === 0 ? 'Required.' : null),
  });
  if (!key) return;
  const value = await vscode.window.showInputBox({
    prompt: 'Value (supports {{var}} interpolation)',
    placeHolder: 'leave blank for an empty placeholder',
  });
  if (value === undefined) return;

  // pathParams is a map, not a KV-array. Use a different row shape.
  if (sectionKey === 'pathParams') {
    await insertMapEntry(document, sectionKey, key.trim(), value);
    return;
  }
  await insertKVArrayRow(document, sectionKey, key.trim(), value);
}

async function insertKVArrayRow(
  document: vscode.TextDocument,
  sectionKey: 'query' | 'cookies',
  key: string,
  value: string,
): Promise<void> {
  const rowBlock =
    `  - key: ${yamlString(key)}\n` + `    value: ${yamlString(value)}\n` + `    enabled: true\n`;
  const editor = await vscode.window.showTextDocument(document);
  const edit = new vscode.WorkspaceEdit();
  const range = findSectionRange(document, sectionKey);
  if (range) {
    const headerText = document.lineAt(range.start.line).text;
    if (/:\s*\[\s*\]/.test(headerText)) {
      // Convert inline-empty `query: []` → block form so the first row is
      // well-formed YAML.
      edit.replace(
        document.uri,
        document.lineAt(range.start.line).range,
        `${sectionKey}:\n${rowBlock.replace(/\n$/, '')}`,
      );
    } else {
      edit.insert(document.uri, range.end, rowBlock);
    }
  } else {
    const endLine = document.lineCount - 1;
    const endPosition = document.lineAt(endLine).range.end;
    const prefix = document.lineAt(endLine).text.trim().length > 0 ? '\n\n' : '\n';
    edit.insert(document.uri, endPosition, `${prefix}${sectionKey}:\n${rowBlock}`);
  }
  const ok = await vscode.workspace.applyEdit(edit);
  if (!ok) {
    await vscode.window.showErrorMessage(`Failed to add a row to ${sectionKey}.`);
    return;
  }
  editor.revealRange(
    new vscode.Range(document.lineCount - 1, 0, document.lineCount - 1, 0),
    vscode.TextEditorRevealType.InCenter,
  );
}

async function insertMapEntry(
  document: vscode.TextDocument,
  sectionKey: 'pathParams',
  key: string,
  value: string,
): Promise<void> {
  const rowBlock = `  ${yamlString(key)}: ${yamlString(value)}\n`;
  const editor = await vscode.window.showTextDocument(document);
  const edit = new vscode.WorkspaceEdit();
  const range = findSectionRange(document, sectionKey);
  if (range) {
    const headerText = document.lineAt(range.start.line).text;
    if (/:\s*\{\s*\}/.test(headerText) || /:\s*$/.test(headerText)) {
      // Section header exists with either inline-empty `{}` or block-form.
      // For inline-empty, we replace the header line; for block-form we
      // append before the next top-level key.
      if (/:\s*\{\s*\}/.test(headerText)) {
        edit.replace(
          document.uri,
          document.lineAt(range.start.line).range,
          `${sectionKey}:\n${rowBlock.replace(/\n$/, '')}`,
        );
      } else {
        edit.insert(document.uri, range.end, rowBlock);
      }
    } else {
      edit.insert(document.uri, range.end, rowBlock);
    }
  } else {
    const endLine = document.lineCount - 1;
    const endPosition = document.lineAt(endLine).range.end;
    const prefix = document.lineAt(endLine).text.trim().length > 0 ? '\n\n' : '\n';
    edit.insert(document.uri, endPosition, `${prefix}${sectionKey}:\n${rowBlock}`);
  }
  const ok = await vscode.workspace.applyEdit(edit);
  if (!ok) {
    await vscode.window.showErrorMessage('Failed to add a pathParams entry.');
    return;
  }
  editor.revealRange(
    new vscode.Range(document.lineCount - 1, 0, document.lineCount - 1, 0),
    vscode.TextEditorRevealType.InCenter,
  );
}

export const addQueryRowCommand = (uri?: vscode.Uri) => addKVRow(uri, 'query');
export const addCookieRowCommand = (uri?: vscode.Uri) => addKVRow(uri, 'cookies');
export const addPathParamRowCommand = (uri?: vscode.Uri) => addKVRow(uri, 'pathParams');

// ---------------------------------------------------------------------------
// addAssertionRow
// ---------------------------------------------------------------------------

export async function addAssertionRowCommand(uri?: vscode.Uri): Promise<void> {
  const document = await ensureRequestDocument(uri);
  if (!document) return;
  // Match the mock-server "🛡 Add validation rule" pattern: drop a prefilled
  // block in (kind: status / op: equals / expected: '200') and rely on the
  // per-field ◆ lenses (kind / op / target / expected) to refine. No prompts.
  const lines: string[] = [
    `  - id: ${yamlString(generateLocalId('a'))}`,
    `    kind: status`,
    `    op: equals`,
    `    expected: '200'`,
  ];
  await appendArraySection(document, 'assertions', lines.join('\n') + '\n');
}

// ---------------------------------------------------------------------------
// addExtractionRow
// ---------------------------------------------------------------------------

export async function addExtractionRowCommand(uri?: vscode.Uri): Promise<void> {
  const document = await ensureRequestDocument(uri);
  if (!document) return;

  type Src = vscode.QuickPickItem & { value: 'body' | 'header' | 'cookie' | 'status' };
  const srcPick = await vscode.window.showQuickPick<Src>(
    [
      { label: 'Body (JSON path)', value: 'body' },
      { label: 'Header', value: 'header' },
      { label: 'Cookie', value: 'cookie' },
      { label: 'Status code', value: 'status' },
    ],
    { title: 'New extraction — source' },
  );
  if (!srcPick) return;

  const variable = await vscode.window.showInputBox({
    prompt: 'Variable name (lands in globalContext)',
    placeHolder: 'auth_token',
    validateInput: (v) =>
      v.trim().length === 0 ? 'Required.' : /\s/.test(v) ? 'No whitespace.' : null,
  });
  if (!variable) return;

  let path = '';
  if (srcPick.value !== 'status') {
    const typed = await vscode.window.showInputBox({
      prompt:
        srcPick.value === 'body'
          ? 'JSON path'
          : srcPick.value === 'header'
            ? 'Header name'
            : 'Cookie name',
      placeHolder: srcPick.value === 'body' ? '$.data.token' : 'Authorization',
      validateInput: (v) => (v.trim().length === 0 ? 'Required.' : null),
    });
    if (!typed) return;
    path = typed.trim();
  }

  const lines = [
    `  - id: ${yamlString(generateLocalId('ext'))}`,
    `    variable: ${yamlString(variable.trim())}`,
    `    source: ${yamlString(srcPick.value)}`,
    `    path: ${yamlString(path)}`,
    `    enabled: true`,
  ];
  await appendArraySection(document, 'extractions', lines.join('\n') + '\n');
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

async function appendArraySection(
  document: vscode.TextDocument,
  sectionKey: string,
  rowBlock: string,
): Promise<void> {
  const editor = await vscode.window.showTextDocument(document);
  const edit = new vscode.WorkspaceEdit();
  const range = findSectionRange(document, sectionKey);
  if (range) {
    const headerText = document.lineAt(range.start.line).text;
    if (/:\s*\[\s*\]/.test(headerText)) {
      edit.replace(
        document.uri,
        document.lineAt(range.start.line).range,
        `${sectionKey}:\n${rowBlock.replace(/\n$/, '')}`,
      );
    } else {
      edit.insert(document.uri, range.end, rowBlock);
    }
  } else {
    const endLine = document.lineCount - 1;
    const endPosition = document.lineAt(endLine).range.end;
    const prefix = document.lineAt(endLine).text.trim().length > 0 ? '\n\n' : '\n';
    edit.insert(document.uri, endPosition, `${prefix}${sectionKey}:\n${rowBlock}`);
  }
  const ok = await vscode.workspace.applyEdit(edit);
  if (!ok) {
    await vscode.window.showErrorMessage(`Failed to add a row to ${sectionKey}.`);
    return;
  }
  editor.revealRange(
    new vscode.Range(document.lineCount - 1, 0, document.lineCount - 1, 0),
    vscode.TextEditorRevealType.InCenter,
  );
}

let localIdCounter = 1;
function generateLocalId(prefix: string): string {
  // YAML-side stable enough — the real id round-trips through applyMutation
  // and lands in the workspace as a generated UUID-like string only if the
  // serializer drops this placeholder. For the user's editing convenience,
  // a short readable id is better than a 36-char UUID showing up in YAML.
  // Counter ensures uniqueness within a single command-execution batch.
  return `${prefix}${localIdCounter++}`;
}

function yamlString(value: string): string {
  if (value.length === 0) return `''`;
  if (/[:#&*!|>'"%@`]|^[\s-]/.test(value)) {
    return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
  }
  return `'${value.replace(/'/g, "''")}'`;
}
