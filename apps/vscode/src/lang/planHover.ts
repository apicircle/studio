import * as vscode from 'vscode';
import type { VsCodeBridge } from '../host/vscodeBridge';
import { uriEntityKind } from '../fs/uriKind';
import { markdownCode, markdownText } from '../util/markdownText';

// =============================================================================
// HoverProvider for apicircle-plan YAML documents.
//
// Surfaces:
//   • Hovering on a `requestId: <id>` value → shows the request's name,
//     method, URL, and an open-in-source link.
//   • Hovering on a `linkedWorkspaceId: <id>` value → shows the linked
//     workspace label (or "(not linked — orphan reference)" warning).
//
// Useful when a plan references many requests by id and the user wants to
// know what each id maps to without jumping back to the Editor view.
//
// Request names, URLs and linked-workspace names come from imports and
// git-synced workspaces, so these hovers are plain markdown: untrusted (no
// command links) and without theme icons, with every value rendered through
// the markdownText helpers. A link that ever needs a command belongs in
// `isTrusted: { enabledCommands: [...] }` built from our own ids, never in
// boolean trust.
// =============================================================================

const REQUEST_ID_LINE_RE = /^\s*-?\s*requestId:\s*(\S+)\s*$/;
const LINKED_ID_LINE_RE = /^\s*-?\s*linkedWorkspaceId:\s*(\S+)\s*$/;

export class PlanHoverProvider implements vscode.HoverProvider {
  constructor(private readonly bridge: VsCodeBridge) {}

  async provideHover(
    document: vscode.TextDocument,
    position: vscode.Position,
    _token: vscode.CancellationToken,
  ): Promise<vscode.Hover | undefined> {
    if (document.uri.scheme !== 'apicircle') return undefined;
    if (uriEntityKind(document.uri) !== 'plan') return undefined;

    const lineText = document.lineAt(position.line).text;
    const surface = this.bridge.activeWorkspace();
    if (!surface) return undefined;
    const state = await surface.read();

    const reqMatch = REQUEST_ID_LINE_RE.exec(lineText);
    if (reqMatch) {
      const id = reqMatch[1];
      const md = new vscode.MarkdownString();
      const req = state.synced.collections.requests[id];
      if (!req) {
        md.appendMarkdown(
          `⚠️ **Unknown request id** ${markdownCode(id)} — saving the plan will fail until you fix or remove this step.\n`,
        );
      } else {
        md.appendMarkdown(`📩 **${markdownText(req.name)}**\n\n`);
        md.appendMarkdown(
          `${markdownCode(req.method)} ${markdownCode(truncate(req.url, 100))}\n\n`,
        );
        md.appendMarkdown(`*Plan step references this request — runPlan executes it inline.*`);
      }
      return new vscode.Hover(md, document.lineAt(position.line).range);
    }

    const linkedMatch = LINKED_ID_LINE_RE.exec(lineText);
    if (linkedMatch) {
      const id = linkedMatch[1];
      const md = new vscode.MarkdownString();
      const link = state.synced.linkedWorkspaces[id];
      if (link) {
        md.appendMarkdown(`🔗 **Linked workspace** ${markdownCode(link.name ?? id)}\n\n`);
        md.appendMarkdown(
          `Step executes against the linked workspace's request rather than the local one. *Phase 8 wires this.*`,
        );
      } else {
        md.appendMarkdown(
          `⚠️ **Unknown linked workspace** ${markdownCode(id)} — orphan reference.`,
        );
      }
      return new vscode.Hover(md, document.lineAt(position.line).range);
    }
    return undefined;
  }
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max - 1) + '…';
}
