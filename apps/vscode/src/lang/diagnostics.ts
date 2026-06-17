import * as vscode from 'vscode';
import { parseEndpointFromYaml, EndpointYamlParseError } from '../fs/endpointYaml';
import { parseMockFromYaml, MockYamlParseError } from '../fs/mockYaml';
import { parseRequestFromYaml, RequestYamlParseError } from '../fs/requestYaml';
import { parseFolderFromYaml, FolderYamlParseError } from '../fs/folderYaml';
import { uriEntityKind } from '../fs/uriKind';

// =============================================================================
// Live diagnostics for apicircle:// YAML documents.
//
// Re-runs the same parser the FS provider uses on save, so the user sees the
// problem BEFORE pressing Ctrl+S:
//   • a structural error (unknown / mistyped key, wrong type for a section)
//     surfaces as a red Error — and the save is blocked by the FS provider for
//     the same reason;
//   • coercible issues (a malformed row, a read-only field edit) surface as
//     yellow Warnings — the save still goes through.
//
// Covers the three hand-editable collection surfaces: per-endpoint mock YAML,
// the mock summary YAML, and collection-request YAML.
// =============================================================================

type DocKind = 'endpoint' | 'mock' | 'request' | 'folder';

function classify(uri: vscode.Uri): DocKind | null {
  if (uri.scheme !== 'apicircle') return null;
  const kind = uriEntityKind(uri);
  if (kind === 'endpoint' || kind === 'mock' || kind === 'request' || kind === 'folder')
    return kind;
  return null;
}

interface ParseOutcome {
  error: string | null;
  warnings: string[];
}

function runParser(kind: DocKind, text: string): ParseOutcome {
  try {
    if (kind === 'endpoint') return { error: null, warnings: parseEndpointFromYaml(text).warnings };
    if (kind === 'mock') return { error: null, warnings: parseMockFromYaml(text).warnings };
    if (kind === 'folder') return { error: null, warnings: parseFolderFromYaml(text).warnings };
    return { error: null, warnings: parseRequestFromYaml(text).warnings };
  } catch (e) {
    if (
      e instanceof EndpointYamlParseError ||
      e instanceof MockYamlParseError ||
      e instanceof RequestYamlParseError ||
      e instanceof FolderYamlParseError
    ) {
      return { error: e.message, warnings: [] };
    }
    throw e;
  }
}

const FIELD_TOKEN_RE = /`([^`]+)`/g;
const UNKNOWN_LIST_RE = /Unknown field\(s\): ([^.]+)/;

/** Best-effort line for a diagnostic: the first row whose key matches a field
 *  name mentioned in `message`. Falls back to line 0. */
function locateLine(document: vscode.TextDocument, message: string): number {
  const tokens: string[] = [];
  for (const m of message.matchAll(FIELD_TOKEN_RE)) tokens.push(m[1]);
  const unk = UNKNOWN_LIST_RE.exec(message);
  if (unk) for (const t of unk[1].split(',')) tokens.push(t.trim());
  const clean = tokens.map((t) => t.trim()).filter((t) => /^[A-Za-z][A-Za-z0-9_-]*$/.test(t));
  for (let i = 0; i < document.lineCount; i++) {
    const text = document.lineAt(i).text;
    for (const t of clean) {
      if (new RegExp(`^\\s*${t}\\s*:`).test(text)) return i;
    }
  }
  return 0;
}

function lineDiagnostic(
  document: vscode.TextDocument,
  line: number,
  message: string,
  severity: vscode.DiagnosticSeverity,
): vscode.Diagnostic {
  const text = document.lineAt(Math.min(line, Math.max(0, document.lineCount - 1))).text;
  const range = new vscode.Range(line, 0, line, Math.max(1, text.length));
  const diag = new vscode.Diagnostic(range, message, severity);
  diag.source = 'APICircle';
  return diag;
}

/** Compute the diagnostics for one document (pure-ish — only reads the doc). */
export function computeDiagnostics(document: vscode.TextDocument): vscode.Diagnostic[] {
  const kind = classify(document.uri);
  if (!kind) return [];
  const outcome = runParser(kind, document.getText());
  const diags: vscode.Diagnostic[] = [];
  if (outcome.error) {
    diags.push(
      lineDiagnostic(
        document,
        locateLine(document, outcome.error),
        `${outcome.error} (saving is blocked until this is fixed)`,
        vscode.DiagnosticSeverity.Error,
      ),
    );
  }
  for (const w of outcome.warnings) {
    diags.push(
      lineDiagnostic(document, locateLine(document, w), w, vscode.DiagnosticSeverity.Warning),
    );
  }
  return diags;
}

/**
 * Register the apicircle diagnostics collection + the open/change/close
 * listeners. Returns the collection so callers can dispose it; the listeners
 * are pushed onto the extension subscriptions.
 */
export function registerApicircleDiagnostics(
  context: vscode.ExtensionContext,
): vscode.DiagnosticCollection {
  const collection = vscode.languages.createDiagnosticCollection('apicircle');
  context.subscriptions.push(collection);

  const refresh = (document: vscode.TextDocument): void => {
    if (classify(document.uri) === null) return;
    collection.set(document.uri, computeDiagnostics(document));
  };

  for (const doc of vscode.workspace.textDocuments) refresh(doc);

  context.subscriptions.push(
    vscode.workspace.onDidOpenTextDocument((doc) => refresh(doc)),
    vscode.workspace.onDidChangeTextDocument((e) => refresh(e.document)),
    vscode.workspace.onDidCloseTextDocument((doc) => collection.delete(doc.uri)),
  );

  return collection;
}
