import * as vscode from 'vscode';
import { MCP_PROMPTS } from '@apicircle/mcp-server';
import { PROMPT_CATALOG_SCHEME, promptIdFromAnchorLine } from '../fs/promptCatalog';

// =============================================================================
// CodeLens for apicircle-prompts: catalog documents.
//
//   • Above the H1 title          ↗ Open rendered preview   (markdown.showPreviewToSide)
//   • Above each prompt anchor     ⧉ Copy prompt             (apicircle.copyMcpPrompt)
//
// The copy lens re-uses the existing `apicircle.copyMcpPrompt` command that the
// MCP-view prompt rows used before they were collapsed into this document, so
// per-prompt one-click copy survives the switch to an editor-based catalog.
// =============================================================================

const H1_RE = /^#\s+\S/;

export class PromptCatalogCodeLensProvider implements vscode.CodeLensProvider, vscode.Disposable {
  private readonly _onDidChange = new vscode.EventEmitter<void>();
  readonly onDidChangeCodeLenses: vscode.Event<void> = this._onDidChange.event;

  dispose(): void {
    this._onDidChange.dispose();
  }

  provideCodeLenses(
    document: vscode.TextDocument,
    _token: vscode.CancellationToken,
  ): vscode.CodeLens[] {
    if (document.uri.scheme !== PROMPT_CATALOG_SCHEME) return [];

    const lenses: vscode.CodeLens[] = [];
    let headerDone = false;

    for (let line = 0; line < document.lineCount; line++) {
      const text = document.lineAt(line).text;

      if (!headerDone && H1_RE.test(text)) {
        headerDone = true;
        lenses.push(
          new vscode.CodeLens(new vscode.Range(line, 0, line, text.length), {
            title: '↗ Open rendered preview',
            tooltip: 'Open a formatted, read-only preview of these prompts beside the source.',
            command: 'markdown.showPreviewToSide',
            arguments: [document.uri],
          }),
        );
        continue;
      }

      const id = promptIdFromAnchorLine(text);
      if (!id) continue;
      const prompt = MCP_PROMPTS.find((p) => p.id === id);
      if (!prompt) continue;

      lenses.push(
        new vscode.CodeLens(new vscode.Range(line, 0, line, text.length), {
          title: '⧉ Copy prompt',
          tooltip: 'Copy this prompt to the clipboard, ready to paste into your AI client.',
          command: 'apicircle.copyMcpPrompt',
          arguments: [prompt],
        }),
      );
    }

    return lenses;
  }
}
