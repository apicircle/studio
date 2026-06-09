import * as vscode from 'vscode';
import type { VsCodeBridge } from '../host/vscodeBridge';

// =============================================================================
// CompletionItemProvider for apicircle-environment YAML documents.
//
// Two completion surfaces:
//   • `encrypted: <cursor>` → boolean enum (true/false)
//   • `secretKeyId: <cursor>` → registered SecretKeyMeta slot ids from
//     `synced.secretKeys` of the active workspace
//
// Variable-key completions are intentionally not provided (any string is a
// valid key); duplicate-key validation is the resolver's job at send time.
// =============================================================================

export class EnvironmentCompletionProvider implements vscode.CompletionItemProvider {
  constructor(private readonly bridge: VsCodeBridge) {}

  async provideCompletionItems(
    document: vscode.TextDocument,
    position: vscode.Position,
    _token: vscode.CancellationToken,
    _ctx: vscode.CompletionContext,
  ): Promise<vscode.CompletionItem[]> {
    if (document.uri.scheme !== 'apicircle') return [];
    if (!document.uri.path.endsWith('.env.yaml')) return [];

    const line = document.lineAt(position.line).text;

    if (/^\s*-?\s*encrypted:\s*\S*$/.test(line)) {
      return [
        completion('true', 'encrypt value with workspace passphrase'),
        completion('false', 'plaintext'),
      ];
    }

    if (/^\s*-?\s*secretKeyId:\s*\S*$/.test(line)) {
      const active = this.bridge.activeWorkspace();
      if (!active) return [];
      const state = await active.read();
      const slots = state.synced.secretKeys ?? {};
      return Object.values(slots).map((slot) =>
        completion(slot.id, `${slot.label} (created ${slot.createdAt})`),
      );
    }

    return [];
  }
}

function completion(value: string, detail: string): vscode.CompletionItem {
  const item = new vscode.CompletionItem(value, vscode.CompletionItemKind.EnumMember);
  item.detail = detail;
  item.insertText = value;
  return item;
}
