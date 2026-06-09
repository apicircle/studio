import * as vscode from 'vscode';

// =============================================================================
// CompletionItemProvider for apicircle-mock YAML documents.
//
// Mock YAML is mostly metadata + read-only source/endpoints, so completion
// is narrow:
//   • Root field names at column 0 (name, defaultPort, cors)
//   • cors.enabled → boolean enum (true / false)
//
// `source` and `endpoints` deliberately NOT in the completion list — they
// are read-only annotations.
// =============================================================================

const ROOT_FIELDS: Array<{ label: string; insertText: string; detail: string }> = [
  { label: 'name', insertText: 'name: ', detail: 'Mock-server display name (required)' },
  {
    label: 'defaultPort',
    insertText: 'defaultPort: ',
    detail: 'null = pick a free port; or 1024-65535',
  },
  { label: 'cors', insertText: 'cors:\n  enabled: false', detail: 'CORS settings' },
];

/**
 * Read-only annotations — surfaced as completion items so users see they
 * exist but with a clear "(read-only)" detail. Selecting them inserts a
 * YAML comment marker explaining why, so the user gets immediate feedback
 * instead of a silent no-op. P3R1-G12 / P3R2-G8 / P3R2-G9.
 */
const READONLY_FIELDS: Array<{
  label: string;
  detail: string;
  commentInsert: string;
  documentation: string;
}> = [
  {
    label: 'source',
    detail: '(read-only) Re-import the spec via "APICircle: New Mock"',
    commentInsert: '# source: <read-only — re-import via "APICircle: New Mock" to change>',
    documentation:
      "**Read-only field.**\n\nThe mock's spec source (OpenAPI / Postman / Insomnia / manual).\nChanging this here has no effect on save — the YAML projection drops the field with a warning.\n\nTo change the source, run **APICircle: New Mock** to re-import — this replaces the existing mock's source + endpoints in place while keeping its id.",
  },
  {
    label: 'endpoints',
    detail: '(read-only) Derived from source — edit in the desktop app',
    commentInsert:
      '# endpoints: <read-only — derived from source; edit per-endpoint behavior in the desktop app>',
    documentation:
      "**Read-only field.**\n\nThe parsed endpoint table — derived from the mock's `source` and rebuilt on every spec import.\n\nPer-endpoint editing (response rules, request validation, multipliers) lives in the desktop app's mock editor. The VS Code YAML projection shows endpoints for context only.",
  },
];

export class MockCompletionProvider implements vscode.CompletionItemProvider {
  provideCompletionItems(
    document: vscode.TextDocument,
    position: vscode.Position,
    _token: vscode.CancellationToken,
    _ctx: vscode.CompletionContext,
  ): vscode.CompletionItem[] {
    if (document.uri.scheme !== 'apicircle') return [];
    if (!document.uri.path.endsWith('.mock.yaml')) return [];

    const line = document.lineAt(position.line).text;
    if (/^\s+enabled:\s*\S*$/.test(line)) {
      return ['true', 'false'].map((v) => {
        const item = new vscode.CompletionItem(v, vscode.CompletionItemKind.EnumMember);
        item.insertText = v;
        return item;
      });
    }
    const indent = line.match(/^(\s*)/)?.[1].length ?? 0;
    if (indent === 0) {
      const items = ROOT_FIELDS.map((spec) => {
        const item = new vscode.CompletionItem(spec.label, vscode.CompletionItemKind.Property);
        item.insertText = spec.insertText;
        item.detail = spec.detail;
        return item;
      });
      // P3R2-G8/G9: include read-only annotations as documented completions
      // so users see they exist; selecting one inserts a YAML comment
      // explaining why the field is read-only AND a documentation popup
      // is attached so hovering on the completion shows the full context.
      for (const spec of READONLY_FIELDS) {
        const item = new vscode.CompletionItem(spec.label, vscode.CompletionItemKind.Keyword);
        item.insertText = spec.commentInsert;
        item.detail = spec.detail;
        item.documentation = new vscode.MarkdownString(spec.documentation);
        item.sortText = `zz_${spec.label}`; // sort to the bottom
        items.push(item);
      }
      return items;
    }
    // Inside cors block — only `enabled` / `origins` apply.
    return [
      { label: 'enabled', insertText: 'enabled: false', detail: 'Toggle CORS responses' },
      {
        label: 'origins',
        insertText: 'origins:\n    - ',
        detail: 'Allowed origins (empty + enabled = reflect any)',
      },
    ].map((spec) => {
      const item = new vscode.CompletionItem(spec.label, vscode.CompletionItemKind.Property);
      item.insertText = spec.insertText;
      item.detail = spec.detail;
      return item;
    });
  }
}
