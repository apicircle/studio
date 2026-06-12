import * as vscode from 'vscode';
import type { HttpMethod } from '@apicircle/shared';
import { getHeaderValues, suggestHeaders } from '@apicircle/core';
import { parseRequestFromYaml, RequestYamlParseError } from '../fs/requestYaml';
import { replaceScalarOnLine, yamlScalar, leadingIndent, reveal } from './mockFieldEdits';

// =============================================================================
// Line-addressed field editors for collection-request `*.req.yaml` — the
// request-side mirror of mockFieldEdits. Each command is driven by a ◆ CodeLens
// sitting on a specific field row and passed the (uri, lineNumber) it lives on;
// it pops a kind-aware picker and rewrites just that line's value. Saving
// re-validates through parseRequestFromYaml (so structural drift is blocked the
// same way the FS provider blocks it).
// =============================================================================

const CUSTOM_PICK = '__custom__';
const HTTP_METHODS: HttpMethod[] = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'];

async function ensureRequestDocument(uri?: vscode.Uri): Promise<vscode.TextDocument | null> {
  const targetUri = uri ?? vscode.window.activeTextEditor?.document.uri;
  if (!targetUri) {
    await vscode.window.showWarningMessage('No request YAML is active.');
    return null;
  }
  if (targetUri.scheme !== 'apicircle' || !targetUri.path.endsWith('.req.yaml')) {
    await vscode.window.showWarningMessage(
      'This command only runs against a request YAML (`*.req.yaml`).',
    );
    return null;
  }
  return vscode.workspace.openTextDocument(targetUri);
}

async function applyAndSaveRequest(
  document: vscode.TextDocument,
  edit: vscode.WorkspaceEdit,
): Promise<boolean> {
  const ok = await vscode.workspace.applyEdit(edit);
  if (!ok) {
    await vscode.window.showErrorMessage('Failed to edit the request YAML.');
    return false;
  }
  try {
    parseRequestFromYaml(document.getText());
  } catch (e) {
    if (e instanceof RequestYamlParseError) {
      await vscode.window.showErrorMessage(
        `Request YAML would not parse — leaving unsaved so you can fix it. ${e.message}`,
      );
      return false;
    }
    throw e;
  }
  await document.save();
  return true;
}

async function openLine(
  uri: vscode.Uri | undefined,
  line: number | undefined,
): Promise<{ document: vscode.TextDocument; line: number; text: string } | null> {
  const document = await ensureRequestDocument(uri);
  if (!document) return null;
  const refreshed = await vscode.workspace.openTextDocument(document.uri);
  if (typeof line !== 'number' || line < 0 || line >= refreshed.lineCount) {
    await vscode.window.showWarningMessage('The targeted field row no longer exists.');
    return null;
  }
  return { document: refreshed, line, text: refreshed.lineAt(line).text };
}

async function commitScalar(
  document: vscode.TextDocument,
  line: number,
  rawValue: string,
): Promise<void> {
  const next = replaceScalarOnLine(document.lineAt(line).text, rawValue);
  if (next === null) {
    await vscode.window.showErrorMessage('Could not parse the field row.');
    return;
  }
  const edit = new vscode.WorkspaceEdit();
  edit.replace(document.uri, document.lineAt(line).range, next);
  if (!(await applyAndSaveRequest(document, edit))) return;
  await reveal(document.uri, line);
}

// ---------------------------------------------------------------------------
// method
// ---------------------------------------------------------------------------

export async function setRequestMethodFieldCommand(uri?: vscode.Uri, line?: number): Promise<void> {
  const loaded = await openLine(uri, line);
  if (!loaded) return;
  const picked = await vscode.window.showQuickPick(HTTP_METHODS, {
    title: 'Request method',
    placeHolder: 'Pick the HTTP method.',
  });
  if (!picked) return;
  await commitScalar(loaded.document, loaded.line, picked);
}

// ---------------------------------------------------------------------------
// header key + value (header-aware, request direction)
// ---------------------------------------------------------------------------

export async function setRequestHeaderKeyFieldCommand(
  uri?: vscode.Uri,
  line?: number,
): Promise<void> {
  const loaded = await openLine(uri, line);
  if (!loaded) return;
  type NamePick = vscode.QuickPickItem & { value: string };
  const items: NamePick[] = suggestHeaders('', undefined, 'request').map((h) => ({
    label: h.name,
    description: h.description,
    value: h.name,
  }));
  items.push({ label: '✏ Custom…', description: 'Type any header name.', value: CUSTOM_PICK });
  const picked = await vscode.window.showQuickPick(items, {
    title: 'Header name',
    matchOnDescription: true,
  });
  if (!picked) return;
  let name = picked.value;
  if (name === CUSTOM_PICK) {
    const typed = await vscode.window.showInputBox({
      prompt: 'Header name',
      validateInput: (v) =>
        v.trim().length === 0
          ? 'Required.'
          : /\s/.test(v)
            ? 'No whitespace in header names.'
            : null,
    });
    if (!typed) return;
    name = typed.trim();
  }
  await commitScalar(loaded.document, loaded.line, yamlScalar(name));
}

export async function setRequestHeaderValueFieldCommand(
  uri?: vscode.Uri,
  line?: number,
): Promise<void> {
  const loaded = await openLine(uri, line);
  if (!loaded) return;
  const valueIndent = leadingIndent(loaded.text);
  let headerName = '';
  for (let l = loaded.line - 1; l >= 0; l--) {
    const t = loaded.document.lineAt(l).text;
    const keyMatch = /^(\s*)-\s+key:\s*['"]?([^'"\n]*?)['"]?\s*$/.exec(t);
    if (keyMatch && keyMatch[1].length + 2 === valueIndent) {
      headerName = keyMatch[2];
      break;
    }
    if (t.trim().length > 0 && leadingIndent(t) < valueIndent - 2) break;
  }
  const catalogue = headerName ? getHeaderValues(headerName) : [];
  let value: string | undefined;
  if (catalogue.length > 0) {
    type ValuePick = vscode.QuickPickItem & { value: string };
    const items: ValuePick[] = catalogue.map((v) => ({ label: v, value: v }));
    items.push({ label: '✏ Custom…', description: 'Type any value.', value: CUSTOM_PICK });
    const picked = await vscode.window.showQuickPick(items, {
      title: `Value for ${headerName}`,
      placeHolder: 'Pick a curated value or type your own.',
    });
    if (!picked) return;
    value =
      picked.value === CUSTOM_PICK
        ? await vscode.window.showInputBox({ prompt: `Value for ${headerName}` })
        : picked.value;
  } else {
    value = await vscode.window.showInputBox({
      prompt: `Value for ${headerName || 'header'}`,
      placeHolder: 'Free-text value (use {{var}} for env references).',
    });
  }
  if (value === undefined) return;
  await commitScalar(loaded.document, loaded.line, yamlScalar(value));
}

// ---------------------------------------------------------------------------
// generic free-text editor (url / query + cookie key & value / path param value)
// ---------------------------------------------------------------------------

function rowKey(lineText: string): string {
  return /^\s*(?:-\s+)?([A-Za-z][A-Za-z0-9_-]*)\s*:/.exec(lineText)?.[1] ?? 'value';
}

export async function setRequestTextFieldCommand(uri?: vscode.Uri, line?: number): Promise<void> {
  const loaded = await openLine(uri, line);
  if (!loaded) return;
  const key = rowKey(loaded.text);
  const current = /:\s*['"]?(.*?)['"]?\s*$/.exec(loaded.text)?.[1] ?? '';
  const value = await vscode.window.showInputBox({
    title: `Set ${key}`,
    value: current,
    placeHolder: 'Free-text value (use {{var}} for env references).',
  });
  if (value === undefined) return;
  await commitScalar(loaded.document, loaded.line, yamlScalar(value));
}

// ---------------------------------------------------------------------------
// assertion / extraction enum pickers
// ---------------------------------------------------------------------------

const ASSERTION_KINDS = ['status', 'header', 'json-path', 'duration'] as const;
const ASSERTION_OPS = ['equals', 'not-equals', 'contains', 'lt', 'gt', 'matches'] as const;
const EXTRACTION_SOURCES = ['body', 'header', 'cookie', 'status'] as const;

async function pickRawScalar(
  uri: vscode.Uri | undefined,
  line: number | undefined,
  title: string,
  options: readonly string[],
): Promise<void> {
  const loaded = await openLine(uri, line);
  if (!loaded) return;
  const picked = await vscode.window.showQuickPick([...options], { title });
  if (!picked) return;
  await commitScalar(loaded.document, loaded.line, picked);
}

export async function setRequestAssertionKindFieldCommand(
  uri?: vscode.Uri,
  line?: number,
): Promise<void> {
  await pickRawScalar(uri, line, 'Assertion kind', ASSERTION_KINDS);
}

export async function setRequestAssertionOpFieldCommand(
  uri?: vscode.Uri,
  line?: number,
): Promise<void> {
  await pickRawScalar(uri, line, 'Comparison operator', ASSERTION_OPS);
}

export async function setRequestExtractionSourceFieldCommand(
  uri?: vscode.Uri,
  line?: number,
): Promise<void> {
  await pickRawScalar(uri, line, 'Extraction source', EXTRACTION_SOURCES);
}
