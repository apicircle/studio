import * as vscode from 'vscode';

// =============================================================================
// JSON-path extraction picker.
//
// Given a JSON response body, walk every (path → primitive value) pair and
// present them in a QuickPick. The user picks a leaf and we return the
// canonical $.dot.path that the variable resolver / runAssertions consume.
//
// Used by the "Add extraction" command (Phase 2 round 1) — opens the picker
// against the most-recent RequestRun's responseBodyPreview and writes the
// chosen path + a variable name into the source request's `extractions`.
// =============================================================================

export interface JsonLeaf {
  path: string;
  value: string;
}

const MAX_LEAVES = 500;

export function walkJsonPaths(value: unknown, prefix = '$'): JsonLeaf[] {
  const out: JsonLeaf[] = [];
  walk(value, prefix, out);
  return out.slice(0, MAX_LEAVES);
}

function walk(value: unknown, path: string, out: JsonLeaf[]): void {
  if (out.length >= MAX_LEAVES) return;
  if (value === null) {
    out.push({ path, value: 'null' });
    return;
  }
  if (typeof value !== 'object') {
    // primitive
    out.push({ path, value: stringifyPrimitive(value) });
    return;
  }
  if (Array.isArray(value)) {
    if (value.length === 0) {
      out.push({ path, value: '[]' });
      return;
    }
    for (let i = 0; i < value.length; i++) {
      walk(value[i], `${path}[${i}]`, out);
    }
    return;
  }
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj);
  if (keys.length === 0) {
    out.push({ path, value: '{}' });
    return;
  }
  for (const k of keys) {
    const segment = /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(k) ? `.${k}` : `['${k}']`;
    walk(obj[k], `${path}${segment}`, out);
  }
}

function stringifyPrimitive(v: unknown): string {
  if (typeof v === 'string') {
    return v.length > 60 ? `"${v.slice(0, 57)}…"` : `"${v}"`;
  }
  return String(v);
}

/** Open a QuickPick over every JSON-path leaf in `body`. Returns the picked path or null. */
export async function pickJsonPath(body: string): Promise<string | null> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    await vscode.window.showWarningMessage(
      'Cannot pick extraction path — response body is not valid JSON.',
    );
    return null;
  }

  const leaves = walkJsonPaths(parsed);
  if (leaves.length === 0) {
    await vscode.window.showInformationMessage('Response body has no extractable leaves.');
    return null;
  }

  const items = leaves.map((leaf) => ({
    label: leaf.path,
    description: leaf.value,
  }));
  const picked = await vscode.window.showQuickPick(items, {
    placeHolder: 'Pick a JSON path to extract',
    matchOnDescription: true,
  });
  return picked?.label ?? null;
}
