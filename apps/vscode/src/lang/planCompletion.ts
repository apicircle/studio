import * as vscode from 'vscode';
import type { VsCodeBridge } from '../host/vscodeBridge';

// =============================================================================
// CompletionItemProvider for apicircle-plan YAML documents.
//
// Surfaces:
//   • Top-level field names (name, steps, variables, envPriorityOrder,
//     stopOnAssertionFailure) — only proposed at column 0.
//   • Inside `steps[]`: field names (requestId, enabled, linkedWorkspaceId).
//   • `requestId: <cursor>` values — proposes every request in the workspace
//     (id + name as detail).
//   • `enabled: <cursor>` → boolean enum (true/false).
//   • `local: <cursor>` (env ref) → proposes every env name.
//
// Pragmatic context detection: scan backward for the last non-indented key
// to decide whether we're in the root, inside `steps:`, inside
// `variables:`, or inside `envPriorityOrder:`.
// =============================================================================

const ROOT_FIELDS: Array<{ label: string; insertText: string; detail: string }> = [
  { label: 'name', insertText: 'name: ', detail: 'Plan name (required)' },
  { label: 'steps', insertText: 'steps:\n  - ', detail: 'Steps run sequentially' },
  { label: 'variables', insertText: 'variables:\n  - ', detail: 'Plan-level variables' },
  {
    label: 'envPriorityOrder',
    insertText: 'envPriorityOrder:\n  - ',
    detail: 'Plan-scoped env overlay',
  },
  {
    label: 'stopOnAssertionFailure',
    insertText: 'stopOnAssertionFailure: true',
    detail: 'Halt at first failed assertion',
  },
];

const STEP_FIELDS: Array<{ label: string; insertText: string; detail: string }> = [
  { label: 'requestId', insertText: 'requestId: ', detail: 'ID of the request to execute' },
  { label: 'enabled', insertText: 'enabled: true', detail: 'Skip the step when false' },
  {
    label: 'linkedWorkspaceId',
    insertText: 'linkedWorkspaceId: ',
    detail: 'Phase 8 — linked workspace request',
  },
];

export class PlanCompletionProvider implements vscode.CompletionItemProvider {
  constructor(private readonly bridge: VsCodeBridge) {}

  async provideCompletionItems(
    document: vscode.TextDocument,
    position: vscode.Position,
    _token: vscode.CancellationToken,
    _ctx: vscode.CompletionContext,
  ): Promise<vscode.CompletionItem[]> {
    if (document.uri.scheme !== 'apicircle') return [];
    if (!document.uri.path.endsWith('.plan.yaml')) return [];

    const line = document.lineAt(position.line).text;

    // Value-position completions
    if (/^\s*-?\s*enabled:\s*\S*$/.test(line)) {
      return ['true', 'false'].map((v) => {
        const item = new vscode.CompletionItem(v, vscode.CompletionItemKind.EnumMember);
        item.insertText = v;
        return item;
      });
    }
    if (/^\s*-?\s*requestId:\s*\S*$/.test(line)) {
      return this.requestIdCompletions();
    }
    if (/^\s*-?\s*local:\s*\S*$/.test(line)) {
      return this.envNameCompletions();
    }

    // Key-position completions — column 0 (root) vs indented (step / variable / env-ref).
    const indent = line.match(/^(\s*)/)?.[1].length ?? 0;
    if (indent === 0) {
      return ROOT_FIELDS.map(toItem);
    }
    // Look backward for the last column-0 key to decide context.
    const context = findEnclosingBlock(document, position.line);
    if (context === 'steps') {
      return STEP_FIELDS.map(toItem);
    }
    if (context === 'variables') {
      return [
        { label: 'key', insertText: 'key: ', detail: 'Variable name' },
        { label: 'value', insertText: 'value: ', detail: 'Variable value' },
      ].map(toItem);
    }
    if (context === 'envPriorityOrder') {
      return [
        { label: 'local', insertText: 'local: ', detail: 'Local env reference' },
        {
          label: 'linked',
          insertText: 'linked:\n    workspaceId: \n    envName: ',
          detail: 'Linked workspace env (Phase 8)',
        },
      ].map(toItem);
    }
    return [];
  }

  private async requestIdCompletions(): Promise<vscode.CompletionItem[]> {
    const active = this.bridge.activeWorkspace();
    if (!active) return [];
    const state = await active.read();
    return Object.values(state.synced.collections.requests).map((r) => {
      const item = new vscode.CompletionItem(r.id, vscode.CompletionItemKind.Reference);
      item.insertText = r.id;
      item.detail = `${r.method} ${r.name}`;
      return item;
    });
  }

  private async envNameCompletions(): Promise<vscode.CompletionItem[]> {
    const active = this.bridge.activeWorkspace();
    if (!active) return [];
    const state = await active.read();
    return Object.values(state.synced.environments.items).map((env) => {
      const item = new vscode.CompletionItem(env.name, vscode.CompletionItemKind.EnumMember);
      item.insertText = env.name;
      return item;
    });
  }
}

function toItem(spec: {
  label: string;
  insertText: string;
  detail: string;
}): vscode.CompletionItem {
  const item = new vscode.CompletionItem(spec.label, vscode.CompletionItemKind.Property);
  item.insertText = spec.insertText;
  item.detail = spec.detail;
  return item;
}

/**
 * Look at preceding lines to find the column-0 block this position belongs to.
 * Returns the parent block name (e.g. 'steps') or null when we're at the root.
 */
function findEnclosingBlock(document: vscode.TextDocument, line: number): string | null {
  for (let i = line - 1; i >= 0; i--) {
    const t = document.lineAt(i).text;
    const m = /^([a-zA-Z_][a-zA-Z0-9_]*):/.exec(t);
    if (m) return m[1];
  }
  return null;
}
