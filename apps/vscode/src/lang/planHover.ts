import * as vscode from 'vscode';
import type { VsCodeBridge } from '../host/vscodeBridge';
import { uriEntityKind } from '../fs/uriKind';

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
      const md = new vscode.MarkdownString(undefined, true);
      md.isTrusted = true;
      const req = state.synced.collections.requests[id];
      if (!req) {
        md.appendMarkdown(
          `⚠️ **Unknown request id** \`${id}\` — saving the plan will fail until you fix or remove this step.\n`,
        );
      } else {
        md.appendMarkdown(`📩 **${req.name}**\n\n`);
        md.appendMarkdown(`\`${req.method}\` \`${truncate(req.url, 100)}\`\n\n`);
        md.appendMarkdown(`*Plan step references this request — runPlan executes it inline.*`);
      }
      return new vscode.Hover(md, document.lineAt(position.line).range);
    }

    const linkedMatch = LINKED_ID_LINE_RE.exec(lineText);
    if (linkedMatch) {
      const id = linkedMatch[1];
      const md = new vscode.MarkdownString(undefined, true);
      const link = state.synced.linkedWorkspaces[id];
      if (link) {
        md.appendMarkdown(`🔗 **Linked workspace** \`${link.name ?? id}\`\n\n`);
        md.appendMarkdown(
          `Step executes against the linked workspace's request rather than the local one. *Phase 8 wires this.*`,
        );
      } else {
        md.appendMarkdown(`⚠️ **Unknown linked workspace** \`${id}\` — orphan reference.`);
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
