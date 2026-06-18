import * as vscode from 'vscode';
import * as YAML from 'yaml';

// =============================================================================
// `apicircle.formatJson` — reflow a stringified JSON `content:` scalar into
// pretty, indented JSON in place.
//
// Driven by the ⟳ Format JSON CodeLens that sits on a JSON body's `content:`
// row (endpoint YAML default/rule responses + request YAML json / graphql
// bodies). The command reads the scalar at that line — whether it's an inline
// quoted string (`content: '{"a":1}'`) or a block scalar (`content: |-` + body)
// — JSON.parses it, re-stringifies with 2-space indent, and rewrites the scalar
// as a block literal. Invalid JSON is left untouched with a warning, so the
// command is always safe to run.
// =============================================================================

// Any single YAML key (content / variables / payload / jwtHeaders / …). The
// object/array-only guard below keeps this from ever touching a scalar like
// `status: 200` (a JSON-valid number that should NOT be reflowed).
const KEY_SCALAR_RE = /^(\s*)([A-Za-z_][A-Za-z0-9_]*)\s*:\s*(.*)$/;
const BLOCK_INDICATOR_RE = /^[|>][+-]?\d*$/;

export interface JsonReformat {
  /** First line of the rewritten range (the `content:` row). */
  startLine: number;
  /** Last line of the rewritten range (inclusive). */
  endLine: number;
  /** Full replacement text for lines [startLine..endLine]. */
  replacement: string;
}

/**
 * Result of {@link reformatJsonContentAt}:
 *   - `JsonReformat` — a valid JSON object/array to reflow;
 *   - `{ empty: true }` — the scalar is empty / whitespace → caller silently
 *     skips (formatting an empty body is a no-op, not an error);
 *   - `null` — not a scalar row, or the value isn't valid JSON object/array →
 *     caller surfaces a "not valid JSON" message.
 */
export type JsonReformatResult = JsonReformat | { empty: true } | null;

/**
 * Reformat the JSON string held in the scalar at `contentLine` (any key —
 * content / variables / payload / jwtHeaders). Handles inline (quoted / plain)
 * and block (`|`, `|-`, `>`) scalars, including multi-line block scalars.
 * Pure — the caller turns the result into a WorkspaceEdit.
 */
export function reformatJsonContentAt(text: string, contentLine: number): JsonReformatResult {
  const lines = text.split('\n');
  const line = lines[contentLine];
  if (line === undefined) return null;
  const m = KEY_SCALAR_RE.exec(line);
  if (!m) return null;
  const indent = m[1].length;
  const key = m[2];
  const inlineRest = m[3].trim();

  let raw: string;
  let endLine = contentLine;
  const isBlock = inlineRest.length > 0 && BLOCK_INDICATOR_RE.test(inlineRest);

  if (isBlock) {
    // Block scalar — collect lines indented deeper than `content:`.
    let blockIndent = -1;
    const collected: string[] = [];
    for (let l = contentLine + 1; l < lines.length; l++) {
      const t = lines[l];
      if (t.trim().length === 0) {
        collected.push('');
        continue;
      }
      const ind = t.match(/^ */)?.[0].length ?? 0;
      if (ind <= indent) break;
      if (blockIndent === -1) blockIndent = ind;
      collected.push(t.slice(blockIndent));
      endLine = l;
    }
    // Drop blank lines we over-collected past the last real content row.
    while (collected.length > 0 && collected[collected.length - 1] === '') collected.pop();
    raw = collected.join('\n');
  } else if (inlineRest.length === 0) {
    raw = ''; // bare `content:` with no value — handled as empty below
  } else {
    // Inline scalar — let YAML decode any quoting back to the raw string.
    try {
      const decoded = YAML.parse(`v: ${inlineRest}`) as { v: unknown };
      if (typeof decoded.v !== 'string') return null;
      raw = decoded.v;
    } catch {
      return null;
    }
  }

  // Empty / whitespace-only content → nothing to format. Signal the caller to
  // skip silently rather than raise a "not valid JSON" error.
  if (raw.trim().length === 0) return { empty: true };

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  // Only reflow JSON objects / arrays — never a bare scalar (a `status: 200`
  // value is valid JSON but must not become a block scalar).
  if (parsed === null || typeof parsed !== 'object') return null;
  const pretty = JSON.stringify(parsed, null, 2);
  const childIndent = ' '.repeat(indent + 2);
  const body = pretty
    .split('\n')
    .map((ln) => (ln.length > 0 ? childIndent + ln : ln))
    .join('\n');
  const replacement = `${' '.repeat(indent)}${key}: |-\n${body}`;
  return { startLine: contentLine, endLine, replacement };
}

/**
 * Command handler. `line` is the `content:` row the lens sits on. Reformats the
 * scalar and saves (the FS provider re-commits the YAML through the normal
 * upsert path). No-op with a warning when the value isn't valid JSON.
 */
export async function formatJsonCommand(uri?: vscode.Uri, line?: number): Promise<void> {
  const targetUri = uri ?? vscode.window.activeTextEditor?.document.uri;
  if (!targetUri || targetUri.scheme !== 'apicircle') {
    await vscode.window.showWarningMessage('Open an API Circle YAML document first.');
    return;
  }
  const document = await vscode.workspace.openTextDocument(targetUri);
  if (typeof line !== 'number' || line < 0 || line >= document.lineCount) {
    await vscode.window.showWarningMessage('The JSON body row no longer exists.');
    return;
  }
  const result = reformatJsonContentAt(document.getText(), line);
  if (result === null) {
    await vscode.window.showWarningMessage(
      'Could not format — the body content is not valid JSON.',
    );
    return;
  }
  // Empty body → nothing to format; skip silently (no toast).
  if ('empty' in result) return;
  // Already-formatted → the replacement equals the existing text; skip the
  // edit so the document isn't needlessly marked dirty.
  const existingLines: string[] = [];
  for (let l = result.startLine; l <= result.endLine; l++)
    existingLines.push(document.lineAt(l).text);
  if (existingLines.join('\n') === result.replacement) return;
  const range = new vscode.Range(
    new vscode.Position(result.startLine, 0),
    new vscode.Position(result.endLine, document.lineAt(result.endLine).text.length),
  );
  const edit = new vscode.WorkspaceEdit();
  edit.replace(targetUri, range, result.replacement);
  const ok = await vscode.workspace.applyEdit(edit);
  if (!ok) {
    await vscode.window.showErrorMessage('Failed to format the JSON body.');
    return;
  }
  await document.save();
}
