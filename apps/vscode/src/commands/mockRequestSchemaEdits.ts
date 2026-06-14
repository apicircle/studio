import * as vscode from 'vscode';
import { generateId } from '@apicircle/shared';
import { parseEndpointFromYaml } from '../fs/endpointYaml';
import {
  ensureEndpointDocument,
  applyAndSave,
  reveal,
  replaceScalarOnLine,
  yamlScalar,
  leadingIndent,
} from './mockFieldEdits';

// =============================================================================
// requestSchema authoring for the per-endpoint `.yaml`.
//
// A mock endpoint's `requestSchema` declares the inputs it expects — path /
// query / header / cookie params + a body-shape doc. It round-trips through
// `.apicircle/workspace.json` and is honored by the Web/Desktop apps, the
// OpenAPI export, and the mock-server docs. The projection hides an empty
// requestSchema, so these commands also CREATE the block on first use.
//
// Authoring follows the "🛡 Add validation rule" pattern: a click inserts a
// prefilled row (no prompts), then the per-field ◆ lenses refine it. Path
// params prefill the next undeclared `{slot}` from the pathPattern; headers
// suggest a common name.
// =============================================================================

export type RequestSchemaParamKind = 'pathParams' | 'queryParams' | 'headers' | 'cookies';

const PARAM_TYPE_HINTS: readonly string[] = [
  'string',
  'integer',
  'number',
  'boolean',
  'array',
  'object',
  'uuid',
  'date-time',
  'email',
];

const REQUEST_SCHEMA_RE = /^requestSchema\s*:/;
const TOP_LEVEL_RE = /^[A-Za-z]/;

interface ParamSeed {
  name: string;
  typeHint: string;
  required: boolean;
}

/** Extract `{slot}` segment names from an OpenAPI-style path pattern. Pure. */
export function pathSlots(pathPattern: string): string[] {
  const out: string[] = [];
  const re = /\{([^}]+)\}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(pathPattern)) !== null) out.push(m[1]);
  return out;
}

/** Render a single requestSchema param entry at the given dash indent. Pure. */
export function buildParamEntry(dashIndent: number, seed: ParamSeed): string {
  const dash = ' '.repeat(dashIndent);
  const field = ' '.repeat(dashIndent + 2);
  return [
    `${dash}- id: ${yamlScalar(generateId())}`,
    `${field}name: ${yamlScalar(seed.name)}`,
    `${field}typeHint: ${yamlScalar(seed.typeHint)}`,
    `${field}required: ${seed.required ? 'true' : 'false'}`,
    `${field}example: ''`,
  ].join('\n');
}

/** Render a fresh requestSchema block (path params seeded from `slots`). Pure. */
export function buildRequestSchemaBlock(slots: string[]): string {
  const lines = ['requestSchema:'];
  const renderList = (key: string, seeds: ParamSeed[]): void => {
    if (seeds.length === 0) {
      lines.push(`  ${key}: []`);
      return;
    }
    lines.push(`  ${key}:`);
    for (const seed of seeds) lines.push(buildParamEntry(4, seed));
  };
  renderList(
    'pathParams',
    slots.map((name) => ({ name, typeHint: 'string', required: true })),
  );
  renderList('queryParams', []);
  renderList('headers', []);
  renderList('cookies', []);
  return lines.join('\n');
}

const DEFAULT_SEED: Record<RequestSchemaParamKind, ParamSeed> = {
  pathParams: { name: 'param', typeHint: 'string', required: true },
  queryParams: { name: 'param', typeHint: 'string', required: false },
  headers: { name: 'X-Custom-Header', typeHint: 'string', required: false },
  cookies: { name: 'session', typeHint: 'string', required: false },
};

/** Find the top-level `requestSchema:` line, or -1 if absent. */
function findRequestSchemaLine(document: vscode.TextDocument): number {
  for (let line = 0; line < document.lineCount; line++) {
    if (REQUEST_SCHEMA_RE.test(document.lineAt(line).text)) return line;
  }
  return -1;
}

/** Line index of the next top-level key after `from`, or lineCount. */
function nextTopLevel(document: vscode.TextDocument, from: number): number {
  for (let line = from; line < document.lineCount; line++) {
    if (TOP_LEVEL_RE.test(document.lineAt(line).text)) return line;
  }
  return document.lineCount;
}

/** Line index of the `requestValidation:` (or `defaultResponse:`) anchor the
 *  requestSchema block is inserted before. */
function requestSchemaInsertAnchor(document: vscode.TextDocument): number {
  for (let line = 0; line < document.lineCount; line++) {
    const t = document.lineAt(line).text;
    if (/^requestValidation\s*:/.test(t) || /^defaultResponse\s*:/.test(t)) return line;
  }
  return document.lineCount;
}

// ---------------------------------------------------------------------------
// Create the block (seeded from pathPattern slots)
// ---------------------------------------------------------------------------

export async function addMockRequestSchemaCommand(uri?: vscode.Uri): Promise<void> {
  const document = await ensureEndpointDocument(uri);
  if (!document) return;
  const fresh = await vscode.workspace.openTextDocument(document.uri);
  if (findRequestSchemaLine(fresh) !== -1) {
    await vscode.window.showInformationMessage('This endpoint already has a request schema.');
    return;
  }
  let slots: string[] = [];
  try {
    const parsed = parseEndpointFromYaml(fresh.getText());
    slots = pathSlots(parsed.endpoint.pathPattern);
  } catch {
    slots = [];
  }
  const anchor = requestSchemaInsertAnchor(fresh);
  const edit = new vscode.WorkspaceEdit();
  edit.insert(fresh.uri, new vscode.Position(anchor, 0), buildRequestSchemaBlock(slots) + '\n');
  if (!(await applyAndSave(fresh, edit))) return;
  await reveal(fresh.uri, anchor);
}

// ---------------------------------------------------------------------------
// Add a param to a list (creating the block if absent)
// ---------------------------------------------------------------------------

export async function addMockRequestSchemaParamCommand(
  uri?: vscode.Uri,
  kind?: RequestSchemaParamKind,
): Promise<void> {
  if (!kind) return;
  const document = await ensureEndpointDocument(uri);
  if (!document) return;
  const fresh = await vscode.workspace.openTextDocument(document.uri);

  const schemaLine = findRequestSchemaLine(fresh);
  // No requestSchema yet → create it with this one param seeded.
  if (schemaLine === -1) {
    const seed = seedFor(fresh, kind);
    const block = ['requestSchema:'];
    for (const key of ['pathParams', 'queryParams', 'headers', 'cookies'] as const) {
      if (key === kind) {
        block.push(`  ${key}:`, buildParamEntry(4, seed));
      } else {
        block.push(`  ${key}: []`);
      }
    }
    const anchor = requestSchemaInsertAnchor(fresh);
    const edit = new vscode.WorkspaceEdit();
    edit.insert(fresh.uri, new vscode.Position(anchor, 0), block.join('\n') + '\n');
    if (!(await applyAndSave(fresh, edit))) return;
    await reveal(fresh.uri, anchor);
    return;
  }

  // requestSchema present → find the `  <kind>:` list within its block.
  const blockEnd = nextTopLevel(fresh, schemaLine + 1);
  let listLine = -1;
  for (let line = schemaLine + 1; line < blockEnd; line++) {
    if (new RegExp(`^\\s{2}${kind}\\s*:`).test(fresh.lineAt(line).text)) {
      listLine = line;
      break;
    }
  }
  const seed = seedFor(fresh, kind);
  const edit = new vscode.WorkspaceEdit();
  if (listLine === -1) {
    // The list key is missing (hand-edited) — append it at the block end.
    edit.insert(
      fresh.uri,
      new vscode.Position(blockEnd, 0),
      `  ${kind}:\n${buildParamEntry(4, seed)}\n`,
    );
    if (!(await applyAndSave(fresh, edit))) return;
    await reveal(fresh.uri, blockEnd);
    return;
  }
  const listText = fresh.lineAt(listLine).text;
  if (/:\s*\[\s*\]/.test(listText)) {
    // Inline-empty `<kind>: []` → block form with one entry.
    edit.replace(
      fresh.uri,
      fresh.lineAt(listLine).range,
      `  ${kind}:\n${buildParamEntry(4, seed)}`,
    );
    if (!(await applyAndSave(fresh, edit))) return;
    await reveal(fresh.uri, listLine + 1);
    return;
  }
  // Block list with entries → append after the last line belonging to it.
  let insertAt = listLine + 1;
  for (let line = listLine + 1; line < blockEnd; line++) {
    const t = fresh.lineAt(line).text;
    if (t.trim().length === 0) continue;
    if (leadingIndent(t) <= 2) break; // next list key / block end
    insertAt = line + 1;
  }
  edit.insert(fresh.uri, new vscode.Position(insertAt, 0), buildParamEntry(4, seed) + '\n');
  if (!(await applyAndSave(fresh, edit))) return;
  await reveal(fresh.uri, insertAt);
}

/** Build the prefilled seed for `kind`, prefilling the next undeclared
 *  `{slot}` for path params. */
function seedFor(document: vscode.TextDocument, kind: RequestSchemaParamKind): ParamSeed {
  const base = { ...DEFAULT_SEED[kind] };
  if (kind === 'pathParams') {
    try {
      const parsed = parseEndpointFromYaml(document.getText());
      const declared = new Set(parsed.endpoint.requestSchema.pathParams.map((p) => p.name));
      const next = pathSlots(parsed.endpoint.pathPattern).find((s) => !declared.has(s));
      if (next) base.name = next;
    } catch {
      /* keep default */
    }
  }
  return base;
}

// ---------------------------------------------------------------------------
// Add the body-shape docs (description + example)
// ---------------------------------------------------------------------------

export async function addMockRequestSchemaBodyExampleCommand(uri?: vscode.Uri): Promise<void> {
  const document = await ensureEndpointDocument(uri);
  if (!document) return;
  const fresh = await vscode.workspace.openTextDocument(document.uri);
  const schemaLine = findRequestSchemaLine(fresh);
  const bodyBlock = [
    '  body:',
    "    description: 'Expected request body shape.'",
    "    example: '{}'",
  ].join('\n');

  const edit = new vscode.WorkspaceEdit();
  if (schemaLine === -1) {
    // Create requestSchema with empty lists + the body docs.
    const block = [
      'requestSchema:',
      '  pathParams: []',
      '  queryParams: []',
      '  headers: []',
      '  cookies: []',
      bodyBlock,
    ].join('\n');
    const anchor = requestSchemaInsertAnchor(fresh);
    edit.insert(fresh.uri, new vscode.Position(anchor, 0), block + '\n');
    if (!(await applyAndSave(fresh, edit))) return;
    await reveal(fresh.uri, anchor);
    return;
  }
  const blockEnd = nextTopLevel(fresh, schemaLine + 1);
  // Already has a body: doc?
  for (let line = schemaLine + 1; line < blockEnd; line++) {
    if (/^\s{2}body\s*:/.test(fresh.lineAt(line).text)) {
      await vscode.window.showInformationMessage('This request schema already documents a body.');
      return;
    }
  }
  edit.insert(fresh.uri, new vscode.Position(blockEnd, 0), bodyBlock + '\n');
  if (!(await applyAndSave(fresh, edit))) return;
  await reveal(fresh.uri, blockEnd);
}

// ---------------------------------------------------------------------------
// ◆ Type (quick-pick) + ◆ Required (toggle) on a param row
// ---------------------------------------------------------------------------

async function commitLineScalar(uri: vscode.Uri, line: number, rawValue: string): Promise<void> {
  const document = await ensureEndpointDocument(uri);
  if (!document) return;
  const fresh = await vscode.workspace.openTextDocument(document.uri);
  if (line < 0 || line >= fresh.lineCount) return;
  const next = replaceScalarOnLine(fresh.lineAt(line).text, rawValue);
  if (next === null) {
    await vscode.window.showErrorMessage('Could not parse the field row.');
    return;
  }
  const edit = new vscode.WorkspaceEdit();
  edit.replace(fresh.uri, fresh.lineAt(line).range, next);
  if (!(await applyAndSave(fresh, edit))) return;
  await reveal(fresh.uri, line);
}

export async function setMockParamTypeFieldCommand(uri?: vscode.Uri, line?: number): Promise<void> {
  if (!uri || typeof line !== 'number') return;
  const picked = await vscode.window.showQuickPick([...PARAM_TYPE_HINTS], {
    title: 'Parameter type hint',
    placeHolder: 'Documentation-only hint (drives the OpenAPI export).',
  });
  if (!picked) return;
  await commitLineScalar(uri, line, yamlScalar(picked));
}
