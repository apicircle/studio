import * as vscode from 'vscode';
import type { HttpMethod, MockResponseBodyType } from '@apicircle/shared';
import {
  generateId,
  makeDefaultMockResponseBody,
  MAX_RESPONSE_RULE_CONDITIONS,
} from '@apicircle/shared';
import { getHeaderValues, suggestHeaders } from '@apicircle/core';
import { parseEndpointFromYaml, EndpointYamlParseError } from '../fs/endpointYaml';
import { conditionValueCandidates } from '../lang/mockValidationKinds';
import { reconcileContentType } from './mockEndpointEdits';

// =============================================================================
// Line-addressed field editors for the per-endpoint `*.endpoint.yaml`.
//
// Each command is driven by a CodeLens that sits on a specific field row and
// passes the (uri, lineNumber) it lives on. The command reads that exact line,
// pops a kind-aware picker, and rewrites just that line's value (or, for body
// type, the body subtree) — deriving indentation from the document itself so
// it stays correct no matter how deep the field is nested (defaultResponse,
// a responseRule.response, or a validationRule.failResponse all share one
// code path).
// =============================================================================

const CUSTOM_PICK = '__custom__';

const HTTP_METHODS: HttpMethod[] = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'];

const COMMON_STATUSES: ReadonlyArray<{ code: number; label: string }> = [
  { code: 200, label: 'OK' },
  { code: 201, label: 'Created' },
  { code: 202, label: 'Accepted' },
  { code: 204, label: 'No Content' },
  { code: 301, label: 'Moved Permanently' },
  { code: 302, label: 'Found' },
  { code: 304, label: 'Not Modified' },
  { code: 400, label: 'Bad Request' },
  { code: 401, label: 'Unauthorized' },
  { code: 403, label: 'Forbidden' },
  { code: 404, label: 'Not Found' },
  { code: 409, label: 'Conflict' },
  { code: 422, label: 'Unprocessable Entity' },
  { code: 429, label: 'Too Many Requests' },
  { code: 500, label: 'Internal Server Error' },
  { code: 502, label: 'Bad Gateway' },
  { code: 503, label: 'Service Unavailable' },
];

const BODY_TYPES: ReadonlyArray<{ value: MockResponseBodyType; label: string }> = [
  { value: 'none', label: '$(circle-slash) None' },
  { value: 'json', label: '$(json) JSON' },
  { value: 'text', label: '$(symbol-text) Text' },
  { value: 'xml', label: '$(symbol-misc) XML' },
  { value: 'urlencoded', label: '$(symbol-string) URL-encoded' },
  { value: 'form-data', label: '$(list-tree) Form Data' },
  { value: 'binary', label: '$(file-binary) Binary' },
];

const CONDITION_SCOPES: ReadonlyArray<{ value: string; label: string }> = [
  { value: 'query', label: 'Query param' },
  { value: 'pathParam', label: 'Path param' },
  { value: 'header', label: 'Header' },
  { value: 'cookie', label: 'Cookie' },
  { value: 'body-json-path', label: 'Body JSON path' },
];

const CONDITION_OPS: ReadonlyArray<{ value: string; label: string }> = [
  { value: 'equals', label: 'equals' },
  { value: 'not-equals', label: 'not-equals' },
  { value: 'matches', label: 'matches (regex)' },
  { value: 'gt', label: '> (greater than)' },
  { value: 'lt', label: '< (less than)' },
  { value: 'gte', label: '>= (at least)' },
  { value: 'lte', label: '<= (at most)' },
  { value: 'present', label: 'present' },
  { value: 'absent', label: 'absent' },
];

const MULTIPLIER_KINDS: ReadonlyArray<{ value: string; label: string }> = [
  { value: 'query', label: 'Query param' },
  { value: 'pathParam', label: 'Path param' },
  { value: 'header', label: 'Header' },
  { value: 'body-json-path', label: 'Body JSON path' },
];

// ---------------------------------------------------------------------------
// Pure helpers (unit-tested)
// ---------------------------------------------------------------------------

/** Replace the scalar value after `key:` on a YAML line, preserving the
 *  leading indent, optional `- ` dash, key, and the colon. `rawValue` is
 *  emitted verbatim — the caller quotes strings via {@link yamlScalar}.
 *  Returns null when the line isn't a `key: value` row. */
export function replaceScalarOnLine(lineText: string, rawValue: string): string | null {
  const m = /^(\s*(?:-\s+)?[A-Za-z0-9_-]+:[ \t]*).*$/.exec(lineText);
  if (!m) return null;
  return m[1] + rawValue;
}

/** Number of leading spaces on a line. */
export function leadingIndent(lineText: string): number {
  return lineText.match(/^ */)?.[0].length ?? 0;
}

/** Quote a YAML scalar the same way the projection does (single-quoted, or
 *  double-quoted when it carries YAML-significant characters). */
export function yamlScalar(value: string): string {
  if (value.length === 0) return `''`;
  if (/[:#&*!|>'"%@`]|^[\s-]/.test(value)) {
    return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
  }
  return `'${value.replace(/'/g, "''")}'`;
}

/** Build a body subtree (`type:` + `content:` [+ `formRows:`]) at the given
 *  child indent (the indent of the `type:` line). Pure. */
export function buildBodySubtree(childIndent: number, type: MockResponseBodyType): string {
  const pad = ' '.repeat(childIndent);
  const body = makeDefaultMockResponseBody(type);
  const lines = [`${pad}type: ${body.type}`, `${pad}content: ${yamlScalar(body.content)}`];
  if (body.type === 'form-data') lines.push(`${pad}formRows: []`);
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Shared command plumbing
// ---------------------------------------------------------------------------

export async function ensureEndpointDocument(
  uri?: vscode.Uri,
): Promise<vscode.TextDocument | null> {
  const targetUri = uri ?? vscode.window.activeTextEditor?.document.uri;
  if (!targetUri) {
    await vscode.window.showWarningMessage('No endpoint YAML is active.');
    return null;
  }
  if (targetUri.scheme !== 'apicircle' || !targetUri.path.endsWith('.endpoint.yaml')) {
    await vscode.window.showWarningMessage(
      'This command only runs against an endpoint YAML (`*.endpoint.yaml`).',
    );
    return null;
  }
  return vscode.workspace.openTextDocument(targetUri);
}

/** Validate the parser still accepts the document, then save (which fires the
 *  FS provider's mock.upsert). Mirrors mockEndpointEdits.commitSave. */
export async function applyAndSave(
  document: vscode.TextDocument,
  edit: vscode.WorkspaceEdit,
): Promise<boolean> {
  const ok = await vscode.workspace.applyEdit(edit);
  if (!ok) {
    await vscode.window.showErrorMessage('Failed to edit the endpoint YAML.');
    return false;
  }
  try {
    parseEndpointFromYaml(document.getText());
  } catch (e) {
    if (e instanceof EndpointYamlParseError) {
      await vscode.window.showErrorMessage(
        `Endpoint YAML would not parse — leaving unsaved so you can fix it. ${e.message}`,
      );
      return false;
    }
    throw e;
  }
  await document.save();
  return true;
}

/** Resolve a fresh document + the text at `line`, guarding the line index. */
async function openLine(
  uri: vscode.Uri | undefined,
  line: number | undefined,
): Promise<{ document: vscode.TextDocument; line: number; text: string } | null> {
  const document = await ensureEndpointDocument(uri);
  if (!document) return null;
  const refreshed = await vscode.workspace.openTextDocument(document.uri);
  if (typeof line !== 'number' || line < 0 || line >= refreshed.lineCount) {
    await vscode.window.showWarningMessage('The targeted field row no longer exists.');
    return null;
  }
  return { document: refreshed, line, text: refreshed.lineAt(line).text };
}

/** Replace one line's scalar value and save. */
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
  if (!(await applyAndSave(document, edit))) return;
  await reveal(document.uri, line);
}

export async function reveal(uri: vscode.Uri, line: number): Promise<void> {
  const document = await vscode.workspace.openTextDocument(uri);
  const editor = await vscode.window.showTextDocument(document);
  const pos = new vscode.Position(Math.min(line, document.lineCount - 1), 0);
  editor.selection = new vscode.Selection(pos, pos);
  editor.revealRange(new vscode.Range(pos, pos), vscode.TextEditorRevealType.InCenter);
}

// ---------------------------------------------------------------------------
// method
// ---------------------------------------------------------------------------

export async function setMockMethodFieldCommand(uri?: vscode.Uri, line?: number): Promise<void> {
  const loaded = await openLine(uri, line);
  if (!loaded) return;
  const picked = await vscode.window.showQuickPick(HTTP_METHODS, {
    title: 'Endpoint method',
    placeHolder: 'Pick the HTTP method this endpoint answers.',
  });
  if (!picked) return;
  await commitScalar(loaded.document, loaded.line, picked);
}

// ---------------------------------------------------------------------------
// status (works for defaultResponse / responseRule.response / failResponse)
// ---------------------------------------------------------------------------

export async function setMockStatusFieldCommand(uri?: vscode.Uri, line?: number): Promise<void> {
  const loaded = await openLine(uri, line);
  if (!loaded) return;
  type StatusPick = vscode.QuickPickItem & { code: number | null };
  const items: StatusPick[] = COMMON_STATUSES.map((s) => ({
    label: String(s.code),
    description: s.label,
    code: s.code,
  }));
  items.push({ label: '✏ Custom…', description: 'Type any status 100–599.', code: null });
  const picked = await vscode.window.showQuickPick(items, { title: 'Response status' });
  if (!picked) return;
  let status = picked.code;
  if (status === null) {
    const current = /:\s*([0-9]+)/.exec(loaded.text)?.[1] ?? '200';
    const raw = await vscode.window.showInputBox({
      prompt: 'Response status (100–599)',
      value: current,
      validateInput: (v) => {
        const n = Number(v);
        return Number.isInteger(n) && n >= 100 && n <= 599 ? null : 'Must be an integer 100–599.';
      },
    });
    if (raw === undefined) return;
    status = Number(raw);
  }
  await commitScalar(loaded.document, loaded.line, String(status));
}

// ---------------------------------------------------------------------------
// header key + value (header-aware)
// ---------------------------------------------------------------------------

export async function setMockHeaderKeyFieldCommand(uri?: vscode.Uri, line?: number): Promise<void> {
  const loaded = await openLine(uri, line);
  if (!loaded) return;
  type NamePick = vscode.QuickPickItem & { value: string };
  const items: NamePick[] = suggestHeaders('', undefined, 'response').map((h) => ({
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

export async function setMockHeaderValueFieldCommand(
  uri?: vscode.Uri,
  line?: number,
): Promise<void> {
  const loaded = await openLine(uri, line);
  if (!loaded) return;
  // The value row's header name is the nearest preceding `- key: <name>` at
  // exactly two spaces less indent (the dash row this value belongs to).
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
// body type (rewrites the body subtree, doc-derived indent)
// ---------------------------------------------------------------------------

export async function setMockBodyTypeFieldCommand(uri?: vscode.Uri, line?: number): Promise<void> {
  const loaded = await openLine(uri, line);
  if (!loaded) return;
  const typeIndent = leadingIndent(loaded.text);
  // The body block runs from the `type:` line through the last sibling field
  // at the same indent (content / formRows). Stop at any line indented ≤ the
  // body parent (typeIndent - 2).
  let endLine = loaded.line + 1;
  for (let l = loaded.line + 1; l < loaded.document.lineCount; l++) {
    const t = loaded.document.lineAt(l).text;
    if (t.trim().length === 0) {
      endLine = l;
      continue;
    }
    if (leadingIndent(t) < typeIndent) break;
    endLine = l + 1;
  }
  const picked = await vscode.window.showQuickPick(
    BODY_TYPES.map((b) => ({ label: b.label, value: b.value })),
    { title: 'Response body type' },
  );
  if (!picked) return;
  const block = buildBodySubtree(typeIndent, picked.value);
  const range = new vscode.Range(
    new vscode.Position(loaded.line, 0),
    new vscode.Position(endLine, 0),
  );
  const edit = new vscode.WorkspaceEdit();
  edit.replace(loaded.document.uri, range, block + '\n');
  // Keep the same config's Content-Type header in sync with the new body type
  // (json → application/json, none → drop the row, …). bodyIndent is the
  // `body:` line indent (typeIndent − 2), which is also the sibling
  // `headers:` line indent.
  const bodyIndent = typeIndent - 2;
  const headersRange = findSiblingHeadersRange(loaded.document, loaded.line, bodyIndent);
  if (headersRange) {
    const newHeaders = reconcileContentType(
      loaded.document,
      headersRange,
      picked.value,
      bodyIndent,
    );
    if (newHeaders !== null) edit.replace(loaded.document.uri, headersRange, newHeaders);
  }
  if (!(await applyAndSave(loaded.document, edit))) return;
  await reveal(loaded.document.uri, loaded.line);
}

/** Find the `headers:` block that is a sibling of the body containing the
 *  `type:` row at `typeLine` (same config). Returns its line range, or null. */
function findSiblingHeadersRange(
  document: vscode.TextDocument,
  typeLine: number,
  bodyIndent: number,
): vscode.Range | null {
  // The config parent is the nearest preceding line indented less than the
  // body (`defaultResponse:` / `response:` / `failResponse:`).
  let parentLine = -1;
  let parentIndent = -1;
  for (let l = typeLine - 1; l >= 0; l--) {
    const t = document.lineAt(l).text;
    if (t.trim().length === 0) continue;
    const ind = leadingIndent(t);
    if (ind < bodyIndent) {
      parentLine = l;
      parentIndent = ind;
      break;
    }
  }
  if (parentLine === -1) return null;
  let configEnd = document.lineCount;
  for (let l = parentLine + 1; l < document.lineCount; l++) {
    const t = document.lineAt(l).text;
    if (t.trim().length === 0) continue;
    if (leadingIndent(t) <= parentIndent) {
      configEnd = l;
      break;
    }
  }
  let headersLine = -1;
  for (let l = parentLine + 1; l < configEnd; l++) {
    const t = document.lineAt(l).text;
    if (leadingIndent(t) === bodyIndent && /^\s*headers\s*:/.test(t)) {
      headersLine = l;
      break;
    }
  }
  if (headersLine === -1) return null;
  let headersEnd = configEnd;
  for (let l = headersLine + 1; l < configEnd; l++) {
    const t = document.lineAt(l).text;
    if (t.trim().length === 0) continue;
    if (leadingIndent(t) <= bodyIndent) {
      headersEnd = l;
      break;
    }
  }
  return new vscode.Range(new vscode.Position(headersLine, 0), new vscode.Position(headersEnd, 0));
}

// ---------------------------------------------------------------------------
// responseRule when-clause: scope / op / target  + add clause
// ---------------------------------------------------------------------------

export async function setMockClauseScopeFieldCommand(
  uri?: vscode.Uri,
  line?: number,
): Promise<void> {
  const loaded = await openLine(uri, line);
  if (!loaded) return;
  const picked = await vscode.window.showQuickPick(
    CONDITION_SCOPES.map((s) => ({ label: s.label, value: s.value })),
    { title: 'Condition scope' },
  );
  if (!picked) return;
  await commitScalar(loaded.document, loaded.line, picked.value);
}

export async function setMockClauseOpFieldCommand(uri?: vscode.Uri, line?: number): Promise<void> {
  const loaded = await openLine(uri, line);
  if (!loaded) return;
  const picked = await vscode.window.showQuickPick(
    CONDITION_OPS.map((o) => ({ label: o.label, value: o.value })),
    { title: 'Comparison operator' },
  );
  if (!picked) return;
  await commitScalar(loaded.document, loaded.line, picked.value);
}

/**
 * ◆ Value on a response-rule when-clause. Reads the clause's `scope:` + `target:`
 * siblings and offers curated values for header scope (e.g. Content-Type media
 * types), falling back to a free-text input for every other scope. Mirrors the
 * back-scan in {@link setMockClauseTargetFieldCommand}.
 */
export async function setMockClauseValueFieldCommand(
  uri?: vscode.Uri,
  line?: number,
): Promise<void> {
  const loaded = await openLine(uri, line);
  if (!loaded) return;
  const fieldIndent = leadingIndent(loaded.text);
  let scope = '';
  let target = '';
  for (let l = loaded.line - 1; l >= 0; l--) {
    const t = loaded.document.lineAt(l).text;
    if (leadingIndent(t) === fieldIndent) {
      const s = /^\s*scope:\s*['"]?([A-Za-z-]+)['"]?/.exec(t);
      if (s && !scope) scope = s[1];
      const tg = /^\s*target:\s*['"]?([^'"\n]*?)['"]?\s*$/.exec(t);
      if (tg && !target) target = tg[1];
    }
    if (t.trim().length > 0 && leadingIndent(t) < fieldIndent) break;
  }
  const current = /:\s*['"]?(.*?)['"]?\s*$/.exec(loaded.text)?.[1] ?? '';
  const catalogue = conditionValueCandidates(scope, target);
  let value: string | undefined;
  if (catalogue.length > 0) {
    type ValuePick = vscode.QuickPickItem & { value: string };
    const items: ValuePick[] = catalogue.map((v) => ({ label: v, value: v }));
    items.push({ label: '✏ Custom…', description: 'Type any value.', value: CUSTOM_PICK });
    const picked = await vscode.window.showQuickPick(items, {
      title: target ? `Value for ${target}` : 'Clause value',
      placeHolder: 'Pick a curated value or type your own.',
    });
    if (!picked) return;
    value =
      picked.value === CUSTOM_PICK
        ? await vscode.window.showInputBox({ title: 'Clause value', value: current })
        : picked.value;
  } else {
    value = await vscode.window.showInputBox({
      title: target ? `Value for ${target}` : 'Clause value',
      value: current,
      placeHolder: 'Free-text value (use {{var}} for env references).',
    });
  }
  if (value === undefined) return;
  await commitScalar(loaded.document, loaded.line, yamlScalar(value));
}

/**
 * Toggle a response/validation header entry's `enabled:` flag. `line` is the
 * entry's `- key:` row; the `enabled:` field is located within the entry. When
 * the entry has no explicit `enabled:` (defaulting to enabled), we insert
 * `enabled: false` after the dash row to disable it.
 */
export async function toggleMockHeaderEnabledCommand(
  uri?: vscode.Uri,
  line?: number,
): Promise<void> {
  const loaded = await openLine(uri, line);
  if (!loaded) return;
  const dashIndent = leadingIndent(loaded.text);
  const fieldIndent = dashIndent + 2;
  // Find the entry's `enabled:` row (deeper than the dash, before the next
  // sibling entry / dedent).
  let enabledLine = -1;
  let enabledValue: boolean | null = null;
  for (let l = loaded.line + 1; l < loaded.document.lineCount; l++) {
    const t = loaded.document.lineAt(l).text;
    if (t.trim().length === 0) continue;
    if (leadingIndent(t) <= dashIndent) break;
    const m = /^\s*enabled\s*:\s*(true|false)\b/.exec(t);
    if (m) {
      enabledLine = l;
      enabledValue = m[1] === 'true';
      break;
    }
  }
  const edit = new vscode.WorkspaceEdit();
  if (enabledLine !== -1) {
    const next = enabledValue === true ? 'false' : 'true';
    const replaced = replaceScalarOnLine(loaded.document.lineAt(enabledLine).text, next);
    if (replaced === null) {
      await vscode.window.showErrorMessage('Could not parse the enabled row.');
      return;
    }
    edit.replace(loaded.document.uri, loaded.document.lineAt(enabledLine).range, replaced);
  } else {
    // No explicit flag → it was enabled by default; disable it.
    edit.insert(
      loaded.document.uri,
      new vscode.Position(loaded.line + 1, 0),
      `${' '.repeat(fieldIndent)}enabled: false\n`,
    );
  }
  if (!(await applyAndSave(loaded.document, edit))) return;
  await reveal(loaded.document.uri, loaded.line);
}

// ---------------------------------------------------------------------------
// Generic scalar editors — free-text (clause value / multiplier name) and
// non-negative integer (multiplier defaultCount / min / max). The lens passes
// the field row; the prompt label is derived from the row's key.
// ---------------------------------------------------------------------------

function rowKey(lineText: string): string {
  return /^\s*(?:-\s+)?([A-Za-z]+)\s*:/.exec(lineText)?.[1] ?? 'value';
}

export async function setMockTextFieldCommand(uri?: vscode.Uri, line?: number): Promise<void> {
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

export async function setMockNumberFieldCommand(uri?: vscode.Uri, line?: number): Promise<void> {
  const loaded = await openLine(uri, line);
  if (!loaded) return;
  const key = rowKey(loaded.text);
  const current = /:\s*(-?\d+)/.exec(loaded.text)?.[1] ?? '';
  const raw = await vscode.window.showInputBox({
    title: `Set ${key}`,
    value: current,
    placeHolder: 'A non-negative integer.',
    validateInput: (v) => {
      const n = Number(v);
      return Number.isInteger(n) && n >= 0 ? null : 'Must be a non-negative integer.';
    },
  });
  if (raw === undefined) return;
  await commitScalar(loaded.document, loaded.line, String(Number(raw)));
}

export async function setMockClauseTargetFieldCommand(
  uri?: vscode.Uri,
  line?: number,
): Promise<void> {
  const loaded = await openLine(uri, line);
  if (!loaded) return;
  // Read this clause's scope (the nearest preceding `scope:` at the same
  // indent) so we can offer the endpoint's declared params for that family.
  const targetIndent = leadingIndent(loaded.text);
  let scope = '';
  for (let l = loaded.line - 1; l >= 0; l--) {
    const t = loaded.document.lineAt(l).text;
    if (leadingIndent(t) === targetIndent) {
      const m = /^\s*scope:\s*['"]?([A-Za-z-]+)['"]?/.exec(t);
      if (m) {
        scope = m[1];
        break;
      }
    }
    if (t.trim().length > 0 && leadingIndent(t) < targetIndent) break;
  }

  type TargetPick = vscode.QuickPickItem & { value: string };
  const items: TargetPick[] = [];
  // body-json-path targets a JSON path, not a declared param.
  if (scope && scope !== 'body-json-path') {
    let parsed;
    try {
      parsed = parseEndpointFromYaml(loaded.document.getText());
    } catch {
      parsed = null;
    }
    if (parsed) {
      const schema = parsed.endpoint.requestSchema;
      const declared =
        scope === 'query'
          ? schema.queryParams
          : scope === 'pathParam'
            ? schema.pathParams
            : scope === 'header'
              ? schema.headers
              : scope === 'cookie'
                ? schema.cookies
                : [];
      for (const p of declared) {
        if (p.name.trim().length === 0) continue;
        items.push({ label: p.name, description: 'declared on this endpoint', value: p.name });
      }
      if (scope === 'header') {
        for (const h of suggestHeaders('', undefined, 'request'))
          if (!items.some((i) => i.value.toLowerCase() === h.name.toLowerCase()))
            items.push({ label: h.name, description: h.description, value: h.name });
      }
    }
  }
  items.push({ label: '✏ Custom…', description: 'Type a name or JSON path.', value: CUSTOM_PICK });
  const picked = await vscode.window.showQuickPick(items, {
    title: 'Condition target',
    matchOnDescription: true,
  });
  if (!picked) return;
  let target = picked.value;
  if (target === CUSTOM_PICK) {
    const current = /:\s*['"]?(.*?)['"]?\s*$/.exec(loaded.text)?.[1] ?? '';
    const typed = await vscode.window.showInputBox({
      prompt: 'Condition target (name or JSON path)',
      value: current,
      validateInput: (v) => (v.trim().length === 0 ? 'Required.' : null),
    });
    if (typed === undefined) return;
    target = typed.trim();
  }
  await commitScalar(loaded.document, loaded.line, yamlScalar(target));
}

// ---------------------------------------------------------------------------
// add a when-clause to a responseRule (lens sits on the `when:` row)
// ---------------------------------------------------------------------------

/** Render a fresh AND-clause at the given dash indent. Pure. */
export function buildConditionClause(dashIndent: number, id: string): string {
  const dash = ' '.repeat(dashIndent);
  const field = ' '.repeat(dashIndent + 2);
  return [
    `${dash}- id: ${yamlScalar(id)}`,
    `${field}scope: query`,
    `${field}target: ''`,
    `${field}op: equals`,
    `${field}value: ''`,
  ].join('\n');
}

export async function addMockConditionClauseCommand(
  uri?: vscode.Uri,
  line?: number,
): Promise<void> {
  const loaded = await openLine(uri, line);
  if (!loaded) return;
  const whenIndent = leadingIndent(loaded.text);
  const dashIndent = whenIndent + 2;
  // Enforce the authoring cap even when invoked from the palette / a keybinding
  // (the lens already hides itself at the cap). Count existing clause dashes.
  let existingClauses = 0;
  for (let l = loaded.line + 1; l < loaded.document.lineCount; l++) {
    const t = loaded.document.lineAt(l).text;
    if (t.trim().length === 0) continue;
    if (leadingIndent(t) <= whenIndent) break;
    if (/^\s*-\s/.test(t)) existingClauses++;
  }
  if (existingClauses >= MAX_RESPONSE_RULE_CONDITIONS) {
    await vscode.window.showInformationMessage(
      `A response rule supports ${MAX_RESPONSE_RULE_CONDITIONS} condition${MAX_RESPONSE_RULE_CONDITIONS === 1 ? '' : 's'} today.`,
    );
    return;
  }
  // Inline-empty shape `when: []` → convert to block form with one entry.
  if (/:\s*\[\s*\]/.test(loaded.text)) {
    const edit = new vscode.WorkspaceEdit();
    edit.replace(
      loaded.document.uri,
      loaded.document.lineAt(loaded.line).range,
      `${' '.repeat(whenIndent)}when:\n${buildConditionClause(dashIndent, generateId())}`,
    );
    if (!(await applyAndSave(loaded.document, edit))) return;
    await reveal(loaded.document.uri, loaded.line + 1);
    return;
  }
  // Otherwise append after the last line that belongs to the when: block.
  let endLine = loaded.line + 1;
  for (let l = loaded.line + 1; l < loaded.document.lineCount; l++) {
    const t = loaded.document.lineAt(l).text;
    if (t.trim().length === 0) continue;
    if (leadingIndent(t) <= whenIndent) break;
    endLine = l + 1;
  }
  const edit = new vscode.WorkspaceEdit();
  edit.insert(
    loaded.document.uri,
    new vscode.Position(endLine, 0),
    buildConditionClause(dashIndent, generateId()) + '\n',
  );
  if (!(await applyAndSave(loaded.document, edit))) return;
  await reveal(loaded.document.uri, endLine);
}

// ---------------------------------------------------------------------------
// multiplier source.kind
// ---------------------------------------------------------------------------

export async function setMockMultiplierKindFieldCommand(
  uri?: vscode.Uri,
  line?: number,
): Promise<void> {
  const loaded = await openLine(uri, line);
  if (!loaded) return;
  const picked = await vscode.window.showQuickPick(
    MULTIPLIER_KINDS.map((k) => ({ label: k.label, value: k.value })),
    { title: 'Multiplier source kind' },
  );
  if (!picked) return;
  await commitScalar(loaded.document, loaded.line, picked.value);
}

// ---------------------------------------------------------------------------
// multiplier source.key + targetJsonPath
// ---------------------------------------------------------------------------

/** Read the multiplier's `source.kind` value (the nearest preceding `kind:`
 *  at the same indent as the `key:` row). */
function readSiblingKind(document: vscode.TextDocument, keyLine: number): string {
  const indent = leadingIndent(document.lineAt(keyLine).text);
  for (let l = keyLine - 1; l >= 0; l--) {
    const t = document.lineAt(l).text;
    if (leadingIndent(t) === indent) {
      const m = /^\s*kind:\s*['"]?([A-Za-z-]+)['"]?/.exec(t);
      if (m) return m[1];
    }
    if (t.trim().length > 0 && leadingIndent(t) < indent) break;
  }
  return '';
}

export async function setMockMultiplierKeyFieldCommand(
  uri?: vscode.Uri,
  line?: number,
): Promise<void> {
  const loaded = await openLine(uri, line);
  if (!loaded) return;
  const kind = readSiblingKind(loaded.document, loaded.line);
  const current = /:\s*['"]?(.*?)['"]?\s*$/.exec(loaded.text)?.[1] ?? '';
  const isJsonPath = kind === 'body-json-path';
  const value = await vscode.window.showInputBox({
    title: isJsonPath
      ? 'Source JSON path (into the request body)'
      : `Source ${kind || 'value'} name`,
    prompt: isJsonPath
      ? 'JSON path read from the incoming request body, e.g. $.page.size'
      : 'Name of the query / path / header value the count is read from.',
    value: current,
    placeHolder: isJsonPath ? '$.page.size' : 'pageSize',
    validateInput: (v) => (v.trim().length === 0 ? 'Required.' : null),
  });
  if (value === undefined) return;
  await commitScalar(loaded.document, loaded.line, yamlScalar(value.trim()));
}

/** Collect JSON paths that point at arrays inside a parsed JSON value — the
 *  candidates a multiplier can repeat. Depth-limited to keep the picker tight.
 *  Pure. */
export function collectJsonArrayPaths(json: unknown, maxDepth = 4): string[] {
  const out: string[] = [];
  const walk = (node: unknown, path: string, depth: number): void => {
    if (depth > maxDepth || node === null || typeof node !== 'object') return;
    if (Array.isArray(node)) {
      out.push(path === '' ? '$' : path);
      // Descend into the first element to surface nested arrays of objects.
      if (node.length > 0) walk(node[0], `${path}[0]`, depth + 1);
      return;
    }
    for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
      if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;
      walk(value, path === '' ? `$.${key}` : `${path}.${key}`, depth + 1);
    }
  };
  walk(json, '', 0);
  return Array.from(new Set(out));
}

export async function setMockMultiplierTargetPathFieldCommand(
  uri?: vscode.Uri,
  line?: number,
): Promise<void> {
  const loaded = await openLine(uri, line);
  if (!loaded) return;
  const current = /:\s*['"]?(.*?)['"]?\s*$/.exec(loaded.text)?.[1] ?? '';

  // Derive candidate array paths from the endpoint's defaultResponse JSON body
  // — those are the arrays a multiplier can actually repeat.
  let candidates: string[] = [];
  try {
    const parsed = parseEndpointFromYaml(loaded.document.getText());
    const body = parsed.endpoint.defaultResponse.body;
    if (body.type === 'json' && body.content.trim().length > 0) {
      candidates = collectJsonArrayPaths(JSON.parse(body.content));
    }
  } catch {
    candidates = [];
  }

  type PathPick = vscode.QuickPickItem & { value: string };
  const items: PathPick[] = candidates.map((p) => ({
    label: p,
    description: 'array in defaultResponse body',
    value: p,
  }));
  items.push({ label: '✏ Custom…', description: 'Type any JSON path.', value: CUSTOM_PICK });
  const picked = await vscode.window.showQuickPick(items, {
    title: 'Target JSON path (array to repeat in the response body)',
    placeHolder:
      candidates.length > 0
        ? 'Pick an array from the default response, or type your own.'
        : 'No JSON arrays found in the default response — type a path.',
  });
  if (!picked) return;
  let target = picked.value;
  if (target === CUSTOM_PICK) {
    const typed = await vscode.window.showInputBox({
      title: 'Target JSON path',
      prompt: 'JSON path into the response body pointing at the array to repeat.',
      value: current,
      placeHolder: '$.items',
      validateInput: (v) => (v.trim().length === 0 ? 'Required.' : null),
    });
    if (typed === undefined) return;
    target = typed.trim();
  }
  await commitScalar(loaded.document, loaded.line, yamlScalar(target));
}
