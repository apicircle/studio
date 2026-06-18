import * as vscode from 'vscode';
import type { HttpMethod } from '@apicircle/shared';
import { getHeaderValues, suggestHeaders } from '@apicircle/core';
import { parseRequestFromYaml, RequestYamlParseError } from '../fs/requestYaml';
import { replaceScalarOnLine, yamlScalar, leadingIndent, reveal } from './mockFieldEdits';
import { pickJsonPath } from '../execute/extractionPicker';
import type { VsCodeBridge } from '../host/vscodeBridge';
import { uriEntityKind } from '../fs/uriKind';

// =============================================================================
// Bridge accessor — `setRequestAssertion*FieldCommand` needs the active
// workspace's latest response to drive the JSON-path / header-value picker
// against real data. Extension activation calls `setRequestFieldEditsBridge`
// once; the commands look it up lazily. A null bridge degrades to free-text
// input — useful in tests and edge cases where no workspace is loaded.
// =============================================================================

let bridgeRef: VsCodeBridge | null = null;
export function setRequestFieldEditsBridge(bridge: VsCodeBridge | null): void {
  bridgeRef = bridge;
}

// =============================================================================
// Line-addressed field editors for collection-request `.yaml` — the
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
  if (targetUri.scheme !== 'apicircle' || uriEntityKind(targetUri) !== 'request') {
    await vscode.window.showWarningMessage(
      'This command only runs against an API Circle request YAML.',
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

// ---------------------------------------------------------------------------
// assertion target + expected — both walk back through the YAML buffer to read
// the entry's `kind:` value, then dispatch to a kind-aware picker. Target slot
// only applies to `header` / `json-path`; expected drives different pickers per
// kind, with the JSON-path variant opening the extractionPicker over the
// latest response for the request id this URI describes.
// ---------------------------------------------------------------------------

const COMMON_STATUSES: ReadonlyArray<{ code: number; label: string }> = [
  { code: 200, label: 'OK' },
  { code: 201, label: 'Created' },
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

/** Walk back from `line` (the assertion's `target:` / `expected:` row) to the
 *  sibling `kind:` row of the same array entry. Pure, no I/O. */
function readAssertionKindFromContext(document: vscode.TextDocument, line: number): string {
  const dashIndent =
    leadingIndent(document.lineAt(line).text) - 2 < 0
      ? 0
      : leadingIndent(document.lineAt(line).text) - 2;
  for (let l = line - 1; l >= 0; l--) {
    const t = document.lineAt(l).text;
    if (t.trim().length === 0) continue;
    const leading = leadingIndent(t);
    // Left this entry — earlier `kind:` belongs to a previous assertion.
    if (leading < dashIndent) break;
    if (/^\s*-\s+/.test(t)) {
      // Hit a previous entry — look only at fields above us within the same
      // entry. Stop walking.
      break;
    }
    const m = /^\s+(?:-\s+)?kind\s*:\s*['"]?([a-z-]+)['"]?/.exec(t);
    if (m) return m[1];
  }
  // Fallback: walk forward in case the kind: row sits below the target/expected
  // row (the user reordered fields).
  for (let l = line + 1; l < document.lineCount; l++) {
    const t = document.lineAt(l).text;
    if (t.trim().length === 0) continue;
    const leading = leadingIndent(t);
    if (leading < dashIndent) break;
    if (/^\s*-\s+/.test(t)) break;
    const m = /^\s+(?:-\s+)?kind\s*:\s*['"]?([a-z-]+)['"]?/.exec(t);
    if (m) return m[1];
  }
  return '';
}

/** Extract the request id this URI points at. The canonical URI carries it in
 *  the `?id=` query; older test fixtures put it in the path slug. */
function requestIdFromUri(uri: vscode.Uri): string | null {
  const q = new URLSearchParams(uri.query || '').get('id');
  if (q) return q;
  const m = /\/requests\/(?:[^/]+\/)*([^.]+)\.yaml$/.exec(uri.path);
  return m ? m[1] : null;
}

export async function setRequestAssertionTargetFieldCommand(
  uri?: vscode.Uri,
  line?: number,
): Promise<void> {
  const loaded = await openLine(uri, line);
  if (!loaded) return;
  const kind = readAssertionKindFromContext(loaded.document, loaded.line);
  if (kind === 'header') {
    type NamePick = vscode.QuickPickItem & { value: string };
    const items: NamePick[] = suggestHeaders('', undefined, 'response').map((h) => ({
      label: h.name,
      description: h.description,
      value: h.name,
    }));
    items.push({ label: '✏ Custom…', description: 'Type any header name.', value: CUSTOM_PICK });
    const picked = await vscode.window.showQuickPick(items, {
      title: 'Header to assert on',
      matchOnDescription: true,
    });
    if (!picked) return;
    let name = picked.value;
    if (name === CUSTOM_PICK) {
      const typed = await vscode.window.showInputBox({ prompt: 'Header name' });
      if (!typed) return;
      name = typed.trim();
    }
    await commitScalar(loaded.document, loaded.line, yamlScalar(name));
    return;
  }
  if (kind === 'json-path') {
    // Try to drive the extractionPicker against the latest response body for
    // this request — same UX as Add Extraction. Falls back to free text when
    // no run is recorded yet.
    const path = await pickJsonPathForRequest(loaded.document.uri);
    if (path !== null) {
      await commitScalar(loaded.document, loaded.line, yamlScalar(path));
      return;
    }
    const typed = await vscode.window.showInputBox({
      prompt: 'JSON path',
      placeHolder: '$.data.token',
      validateInput: (v) => (v.trim().length === 0 ? 'Required.' : null),
    });
    if (typed === undefined) return;
    await commitScalar(loaded.document, loaded.line, yamlScalar(typed.trim()));
    return;
  }
  // Unknown kind / status / duration — fall through to plain text.
  await setRequestTextFieldCommand(uri, line);
}

export async function setRequestAssertionExpectedFieldCommand(
  uri?: vscode.Uri,
  line?: number,
): Promise<void> {
  const loaded = await openLine(uri, line);
  if (!loaded) return;
  const kind = readAssertionKindFromContext(loaded.document, loaded.line);
  if (kind === 'status') {
    type StatusPick = vscode.QuickPickItem & { code: number | null };
    const items: StatusPick[] = COMMON_STATUSES.map((s) => ({
      label: String(s.code),
      description: s.label,
      code: s.code,
    }));
    items.push({ label: '✏ Custom…', description: 'Type any status 100–599.', code: null });
    const picked = await vscode.window.showQuickPick(items, { title: 'Expected status code' });
    if (!picked) return;
    let n = picked.code;
    if (n === null) {
      const typed = await vscode.window.showInputBox({
        prompt: 'Expected status code (100–599)',
        validateInput: (v) => {
          const x = Number(v);
          return Number.isInteger(x) && x >= 100 && x <= 599 ? null : 'Must be 100–599.';
        },
      });
      if (typed === undefined) return;
      n = Number(typed);
    }
    await commitScalar(loaded.document, loaded.line, String(n));
    return;
  }
  if (kind === 'duration') {
    const typed = await vscode.window.showInputBox({
      prompt: 'Expected duration (ms)',
      placeHolder: '500',
      validateInput: (v) => {
        const x = Number(v);
        return Number.isFinite(x) && x >= 0 ? null : 'Must be a non-negative number.';
      },
    });
    if (typed === undefined) return;
    await commitScalar(loaded.document, loaded.line, String(Number(typed)));
    return;
  }
  if (kind === 'header') {
    // Resolve the sibling target: header name from the same entry so we can
    // surface the curated value catalogue.
    const headerName = readSiblingScalar(loaded.document, loaded.line, 'target') ?? '';
    const catalogue = headerName ? getHeaderValues(headerName) : [];
    if (catalogue.length > 0) {
      type ValuePick = vscode.QuickPickItem & { value: string };
      const items: ValuePick[] = catalogue.map((v) => ({ label: v, value: v }));
      items.push({ label: '✏ Custom…', description: 'Type any value.', value: CUSTOM_PICK });
      const picked = await vscode.window.showQuickPick(items, {
        title: `Expected value for ${headerName}`,
      });
      if (!picked) return;
      const value =
        picked.value === CUSTOM_PICK
          ? await vscode.window.showInputBox({ prompt: `Expected ${headerName} value` })
          : picked.value;
      if (value === undefined) return;
      await commitScalar(loaded.document, loaded.line, yamlScalar(value));
      return;
    }
    const typed = await vscode.window.showInputBox({
      prompt: `Expected value for ${headerName || 'header'}`,
    });
    if (typed === undefined) return;
    await commitScalar(loaded.document, loaded.line, yamlScalar(typed));
    return;
  }
  if (kind === 'json-path') {
    // Read the actual value at the assertion's target JSON path from the
    // latest response — that's almost always what the user wants to assert.
    const value = await pickJsonPathValueForRequest(loaded.document.uri);
    if (value !== null) {
      await commitScalar(loaded.document, loaded.line, yamlScalar(value));
      return;
    }
    const typed = await vscode.window.showInputBox({
      prompt: 'Expected value at JSON path',
      placeHolder: 'literal value to compare against',
    });
    if (typed === undefined) return;
    await commitScalar(loaded.document, loaded.line, yamlScalar(typed));
    return;
  }
  // Unknown kind — generic text.
  await setRequestTextFieldCommand(uri, line);
}

/** Read the value of a sibling field (`target`, `op`, …) in the same array
 *  entry as `line`. Returns null when missing. */
function readSiblingScalar(
  document: vscode.TextDocument,
  line: number,
  key: string,
): string | null {
  const myIndent = leadingIndent(document.lineAt(line).text);
  // Walk up to the entry start.
  let start = 0;
  for (let l = line - 1; l >= 0; l--) {
    const t = document.lineAt(l).text;
    if (t.trim().length === 0) continue;
    const lead = leadingIndent(t);
    if (lead < myIndent) {
      start = l + 1;
      break;
    }
    if (/^\s*-\s+/.test(t)) {
      start = l;
      break;
    }
  }
  // Walk down to the next entry / out-of-entry line.
  const re = new RegExp(`^\\s+(?:-\\s+)?${key}\\s*:\\s*['"]?(.*?)['"]?\\s*$`);
  for (let l = start; l < document.lineCount; l++) {
    const t = document.lineAt(l).text;
    if (t.trim().length === 0) continue;
    if (l > start && /^\s*-\s+/.test(t)) break;
    const m = re.exec(t);
    if (m) return m[1];
  }
  return null;
}

/** Open the extractionPicker over the latest response for the request whose
 *  URI this is. Returns the picked path, or null when no run is recorded /
 *  the body isn't JSON / the user cancels. */
async function pickJsonPathForRequest(uri: vscode.Uri): Promise<string | null> {
  if (!bridgeRef) return null;
  const active = bridgeRef.activeWorkspace();
  if (!active) return null;
  const requestId = requestIdFromUri(uri);
  if (!requestId) return null;
  const state = await active.read();
  const latest = state.local.history.requestRuns.find((r) => r.requestId === requestId);
  if (!latest || latest.responseBodyKind !== 'json') return null;
  return pickJsonPath(latest.responseBodyPreview);
}

/** Resolve the LITERAL value at the assertion's target JSON path from the
 *  latest response. Used by the ◆ Expected lens for json-path assertions so
 *  the user can pick "what's actually there" without retyping it. */
async function pickJsonPathValueForRequest(uri: vscode.Uri): Promise<string | null> {
  const path = await pickJsonPathForRequest(uri);
  if (path === null) return null;
  // The picker labels rows by path and shows the value as description, but it
  // returns the path itself. For ◆ Expected we want the value — but we already
  // committed to the path-based picker UX. Best UX: just return the path's
  // description (the value) via a second resolution step.
  if (!bridgeRef) return null;
  const active = bridgeRef.activeWorkspace();
  if (!active) return null;
  const requestId = requestIdFromUri(uri);
  if (!requestId) return null;
  const state = await active.read();
  const latest = state.local.history.requestRuns.find((r) => r.requestId === requestId);
  if (!latest || latest.responseBodyKind !== 'json') return null;
  try {
    const parsed: unknown = JSON.parse(latest.responseBodyPreview);
    return resolveJsonPath(parsed, path);
  } catch {
    return null;
  }
}

/** Minimal $-prefixed JSON-path resolver — supports `.key` and `[n]`
 *  segments. Returns the stringified primitive value at the path, or null. */
function resolveJsonPath(root: unknown, path: string): string | null {
  let cursor: unknown = root;
  if (!path.startsWith('$')) return null;
  const rest = path.slice(1);
  const re = /\.([A-Za-z_][A-Za-z0-9_]*)|\['([^']*)'\]|\[(\d+)\]/g;
  let m: RegExpExecArray | null;
  let consumed = 0;
  while ((m = re.exec(rest)) !== null) {
    if (cursor === null || cursor === undefined) return null;
    if (m[1] !== undefined) cursor = (cursor as Record<string, unknown>)[m[1]];
    else if (m[2] !== undefined) cursor = (cursor as Record<string, unknown>)[m[2]];
    else if (m[3] !== undefined) cursor = (cursor as unknown[])[Number(m[3])];
    consumed = m.index + m[0].length;
  }
  if (consumed !== rest.length) return null;
  if (cursor === null || typeof cursor === 'object') return null;
  // cursor is a primitive (string / number / boolean) at this point; coerce
  // via template literal so eslint's no-base-to-string is satisfied.
  return `${cursor as string | number | boolean}`;
}

// ---------------------------------------------------------------------------
// auth-block enum pickers (clientAuthMethod / codeChallengeMethod / tokenType /
// algorithm). The lens sits on a specific field row and tells us which key it
// is via the row text; we dispatch to the right option set, then commit.
// ---------------------------------------------------------------------------

const TOKEN_TYPES: ReadonlyArray<string> = ['Bearer', 'MAC', 'DPoP'];
const HAWK_ALGORITHMS: ReadonlyArray<string> = ['sha256', 'sha1'];
const JWT_ALGORITHMS: ReadonlyArray<string> = [
  'HS256',
  'HS384',
  'HS512',
  'RS256',
  'RS384',
  'RS512',
  'PS256',
  'PS384',
  'PS512',
  'ES256',
  'ES384',
  'ES512',
  'EdDSA',
];

/** Walk back from `line` to the enclosing `type:` row inside the same auth
 *  block to discover which auth variant the field belongs to. */
function readAuthTypeFromContext(document: vscode.TextDocument, line: number): string {
  for (let l = line - 1; l >= 0; l--) {
    const t = document.lineAt(l).text;
    if (/^[A-Za-z]/.test(t)) break;
    const m = /^\s+type\s*:\s*['"]?([A-Za-z0-9-]+)['"]?/.exec(t);
    if (m) return m[1];
  }
  return '';
}

export async function setRequestAuthFieldCommand(uri?: vscode.Uri, line?: number): Promise<void> {
  const loaded = await openLine(uri, line);
  if (!loaded) return;
  const keyMatch = /^\s+([A-Za-z][A-Za-z0-9_]*)\s*:/.exec(loaded.text);
  if (!keyMatch) return;
  const fieldKey = keyMatch[1];
  const authType = readAuthTypeFromContext(loaded.document, loaded.line);

  let options: ReadonlyArray<string> = [];
  let title: string;
  let allowCustom = false;
  if (fieldKey === 'clientAuthMethod') {
    options = ['header', 'body'];
    title = 'Client authentication method';
  } else if (fieldKey === 'codeChallengeMethod') {
    options = ['S256', 'plain'];
    title = 'PKCE code-challenge method';
  } else if (fieldKey === 'tokenType') {
    options = TOKEN_TYPES;
    title = 'OAuth2 token type';
    allowCustom = true;
  } else if (fieldKey === 'algorithm' && authType === 'hawk') {
    options = HAWK_ALGORITHMS;
    title = 'Hawk MAC algorithm';
  } else if (fieldKey === 'algorithm' && authType === 'jwt-bearer') {
    options = JWT_ALGORITHMS;
    title = 'JWT signing algorithm';
  } else {
    return;
  }

  type Pick = vscode.QuickPickItem & { value: string };
  const items: Pick[] = options.map((v) => ({ label: v, value: v }));
  if (allowCustom) {
    items.push({ label: '✏ Custom…', description: 'Type any token type.', value: '__custom__' });
  }
  const picked = await vscode.window.showQuickPick(items, { title });
  if (!picked) return;
  let value = picked.value;
  if (value === '__custom__') {
    const typed = await vscode.window.showInputBox({ prompt: title });
    if (!typed) return;
    value = typed.trim();
  }
  await commitScalar(loaded.document, loaded.line, yamlScalar(value));
}

// ---------------------------------------------------------------------------
// ✓ Enable / ⊘ Disable on a query/cookie row
// ---------------------------------------------------------------------------

/**
 * Toggle the `enabled:` boolean on the row whose `- key:` row is at `line`.
 * Mirrors `toggleMockHeaderEnabledCommand`: if no explicit `enabled:` field is
 * present, the row was implicitly enabled and we insert `enabled: false`.
 */
export async function toggleRequestRowEnabledCommand(
  uri?: vscode.Uri,
  line?: number,
): Promise<void> {
  const loaded = await openLine(uri, line);
  if (!loaded) return;
  const dashIndent = leadingIndent(loaded.text);
  const fieldIndent = dashIndent + 2;
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
    edit.insert(
      loaded.document.uri,
      new vscode.Position(loaded.line + 1, 0),
      `${' '.repeat(fieldIndent)}enabled: false\n`,
    );
  }
  if (!(await applyAndSaveRequest(loaded.document, edit))) return;
  await reveal(loaded.document.uri, loaded.line);
}
