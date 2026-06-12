import * as vscode from 'vscode';
import { findSectionRange } from './switchRequestSection';

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
  if (targetUri.scheme !== 'apicircle' || !targetUri.path.endsWith('.req.yaml')) {
    await vscode.window.showWarningMessage(
      'This command only runs against APICircle request YAML files.',
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

const ASSERTION_KINDS: ReadonlyArray<{
  kind: 'status' | 'header' | 'json-path' | 'response-time';
  label: string;
  description: string;
}> = [
  { kind: 'status', label: 'Status', description: 'Compare the HTTP status code.' },
  { kind: 'header', label: 'Header', description: 'Compare a response header value.' },
  {
    kind: 'json-path',
    label: 'JSON path',
    description: 'Compare a JSON-path slice of the response body.',
  },
  {
    kind: 'response-time',
    label: 'Response time',
    description: 'Compare wall-clock latency in ms.',
  },
];

const ASSERTION_OPS: ReadonlyArray<{ value: string; label: string }> = [
  { value: 'equals', label: 'equals' },
  { value: 'not-equals', label: 'not-equals' },
  { value: 'contains', label: 'contains' },
  { value: 'matches', label: 'matches (regex)' },
  { value: 'gt', label: '>' },
  { value: 'lt', label: '<' },
  { value: 'gte', label: '>=' },
  { value: 'lte', label: '<=' },
];

export async function addAssertionRowCommand(uri?: vscode.Uri): Promise<void> {
  const document = await ensureRequestDocument(uri);
  if (!document) return;

  const kindPick = await vscode.window.showQuickPick(
    ASSERTION_KINDS.map((k) => ({ label: k.label, description: k.description, value: k.kind })),
    { title: 'New assertion', placeHolder: 'What is being asserted?' },
  );
  if (!kindPick) return;

  let target = '';
  if (kindPick.value === 'header') {
    const typed = await vscode.window.showInputBox({
      prompt: 'Header name',
      placeHolder: 'Content-Type',
      validateInput: (v) => (v.trim().length === 0 ? 'Required.' : null),
    });
    if (!typed) return;
    target = typed.trim();
  } else if (kindPick.value === 'json-path') {
    const typed = await vscode.window.showInputBox({
      prompt: 'JSON path',
      placeHolder: '$.data.token',
      validateInput: (v) => (v.trim().length === 0 ? 'Required.' : null),
    });
    if (!typed) return;
    target = typed.trim();
  }

  const opPick = await vscode.window.showQuickPick(
    ASSERTION_OPS.map((o) => ({ label: o.label, value: o.value })),
    { title: 'Comparison op' },
  );
  if (!opPick) return;

  const expected = await vscode.window.showInputBox({
    prompt: 'Expected value',
    placeHolder:
      kindPick.value === 'status'
        ? '200'
        : kindPick.value === 'response-time'
          ? '500'
          : 'application/json',
    validateInput: (v) => (v.trim().length === 0 ? 'Required.' : null),
  });
  if (expected === undefined) return;

  const name = await vscode.window.showInputBox({
    prompt: 'Assertion name (optional)',
    placeHolder: `e.g. ${kindPick.value} ${opPick.value} ${expected}`,
  });
  if (name === undefined) return;

  const lines: string[] = [
    `  - id: ${yamlString(generateLocalId('a'))}`,
    `    name: ${yamlString(name.trim().length > 0 ? name.trim() : `${kindPick.value} ${opPick.value} ${expected}`)}`,
    `    kind: ${yamlString(kindPick.value)}`,
    ...(target.length > 0 ? [`    target: ${yamlString(target)}`] : []),
    `    op: ${yamlString(opPick.value)}`,
    `    expected: ${yamlString(expected)}`,
    `    enabled: true`,
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
