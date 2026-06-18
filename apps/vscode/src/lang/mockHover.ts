import * as vscode from 'vscode';
import type { VsCodeBridge } from '../host/vscodeBridge';
import type { VsCodeMockController } from '../host/vscodeMockController';
import { uriEntityKind } from '../fs/uriKind';

// =============================================================================
// HoverProvider for apicircle-mock YAML documents.
//
// Surfaces:
//   • Hover on `name:` → mock status (idle / running on port :N) +
//     "click ▶ Start Mock at top to launch".
//   • Hover on `defaultPort: <n>` → "Will bind to localhost:<n>; null
//     picks a free port at start".
//   • Hover on an endpoint summary `pathPattern: /pets` → endpoint's
//     name + default status + responseRules count.
// =============================================================================

export class MockHoverProvider implements vscode.HoverProvider {
  constructor(
    private readonly bridge: VsCodeBridge,
    private readonly controller: VsCodeMockController,
  ) {}

  async provideHover(
    document: vscode.TextDocument,
    position: vscode.Position,
    _token: vscode.CancellationToken,
  ): Promise<vscode.Hover | undefined> {
    if (document.uri.scheme !== 'apicircle') return undefined;
    if (uriEntityKind(document.uri) !== 'mock') return undefined;

    const lineText = document.lineAt(position.line).text;
    const mockId = extractMockId(document.uri.path);
    if (!mockId) return undefined;

    // name: <value>  → status panel
    if (/^name:\s*\S/.test(lineText)) {
      const md = new vscode.MarkdownString(undefined, true);
      md.isTrusted = true;
      const surface = this.bridge.activeWorkspace();
      if (!surface) return undefined;
      const state = await surface.read();
      const server = state.synced.mockServers[mockId];
      if (!server) return undefined;
      const rt = await this.controller.runtime(mockId);
      md.appendMarkdown(
        `🧪 **${server.name}** · ${server.endpoints.length} endpoint${server.endpoints.length === 1 ? '' : 's'}\n\n`,
      );
      if (rt) {
        md.appendMarkdown(`▶ Running on \`http://localhost:${rt.port}\` (since ${rt.startedAt})\n`);
      } else {
        md.appendMarkdown(`◦ Idle — use the **▶ Start Mock** CodeLens above to launch.\n`);
      }
      return new vscode.Hover(md, document.lineAt(position.line).range);
    }

    // cors.enabled / cors.origins  → CORS semantics (F-G8)
    if (
      /^\s+enabled:\s*(true|false)\s*$/.test(lineText) &&
      isInsideCorsBlock(document, position.line)
    ) {
      const md = new vscode.MarkdownString(undefined, true);
      md.appendMarkdown(`🌐 **CORS** — controls cross-origin requests against this mock.\n\n`);
      md.appendMarkdown(
        `When \`true\`, the mock responds with \`Access-Control-Allow-Origin\` based on \`origins\`. When \`false\`, no CORS headers are emitted (browser-driven cross-origin clients will be blocked).\n\n`,
      );
      md.appendMarkdown(
        `The runtime engine is Hono — see \`@apicircle/mock-server-core\` for the CORS middleware.`,
      );
      return new vscode.Hover(md, document.lineAt(position.line).range);
    }
    if (/^\s+(?:origins|-)\s*[:-]/.test(lineText) && isInsideCorsBlock(document, position.line)) {
      const md = new vscode.MarkdownString(undefined, true);
      md.appendMarkdown(`🌐 **CORS origins** — allowed \`Origin\` header values.\n\n`);
      md.appendMarkdown(
        `Empty list **with** \`enabled: true\` → reflect any Origin header (permissive). Non-empty list → only those Origins receive CORS headers. Empty list **with** \`enabled: false\` → no CORS at all.`,
      );
      return new vscode.Hover(md, document.lineAt(position.line).range);
    }

    // bytes: <n>  → secret-safety projection note (P3R6-G3)
    const bytesMatch = /^\s+bytes:\s*(\d+)\s*$/.exec(lineText);
    if (bytesMatch) {
      const md = new vscode.MarkdownString(undefined, true);
      const n = Number(bytesMatch[1]);
      md.appendMarkdown(`📏 **Source spec size**: ${n.toLocaleString()} bytes\n\n`);
      md.appendMarkdown(
        `The raw spec lives in \`workspace.json\` under \`mockServers.source\` and is read by the mock-server runtime directly. It is **deliberately omitted** from this YAML projection because OpenAPI / Postman / Insomnia specs can contain bearer tokens or API keys in \`security.example\` blocks — emitting them here would leak secrets into Git.\n\n`,
      );
      md.appendMarkdown(`To change the spec, re-import via **API Circle: New Mock**.`);
      return new vscode.Hover(md, document.lineAt(position.line).range);
    }

    // defaultPort: <n>  → port semantics
    const portMatch = /^defaultPort:\s*(\S+)/.exec(lineText);
    if (portMatch) {
      const md = new vscode.MarkdownString(undefined, true);
      const v = portMatch[1];
      if (v === 'null') {
        md.appendMarkdown(
          `🔢 **Port** — \`null\` means "pick a free port at start". The actual port shows up in the status bar + mock view.`,
        );
      } else {
        md.appendMarkdown(
          `🔢 **Port** — start will bind to \`http://localhost:${v}\`. Conflict on an in-use port throws on start.`,
        );
      }
      return new vscode.Hover(md, document.lineAt(position.line).range);
    }

    // pathPattern: <path>  → endpoint summary.
    //
    // P3R1-G1: disambiguate duplicate paths by looking at the preceding
    // method: line in the same endpoint block. The mock YAML emits keys in
    // the order { id, method, pathPattern, ... }, so the method: line is
    // typically position.line - 1. Walk back up to 5 lines for safety in
    // case the user reordered or added intermediate fields.
    const pathMatch = /^\s*pathPattern:\s*(\S.*)$/.exec(lineText);
    if (pathMatch) {
      const surface = this.bridge.activeWorkspace();
      if (!surface) return undefined;
      const state = await surface.read();
      const server = state.synced.mockServers[mockId];
      if (!server) return undefined;
      const expectedMethod = findEnclosingMethod(document, position.line);
      const candidates = server.endpoints.filter((e) => e.pathPattern === pathMatch[1]);
      const ep = expectedMethod
        ? (candidates.find((e) => e.method === expectedMethod) ?? candidates[0])
        : candidates[0];
      if (!ep) return undefined;
      const md = new vscode.MarkdownString(undefined, true);
      md.appendMarkdown(`📍 **${ep.method}** \`${ep.pathPattern}\` · ${ep.name}\n\n`);
      if (ep.description) md.appendMarkdown(`${ep.description}\n\n`);
      md.appendMarkdown(`Default response: **${ep.defaultResponse.status}**\n\n`);
      if (ep.responseRules.length > 0) {
        md.appendMarkdown(`Response rules: ${ep.responseRules.length} (edit in the desktop app)\n`);
      }
      return new vscode.Hover(md, document.lineAt(position.line).range);
    }
    return undefined;
  }
}

function extractMockId(uriPath: string): string | undefined {
  const m = /\/mocks\/([^/]+)\.yaml$/.exec(uriPath);
  return m ? m[1] : undefined;
}

/**
 * Returns true when `line` is indented under a `cors:` block earlier in
 * the document. Walks back to find the nearest column-0 key.
 */
function isInsideCorsBlock(document: vscode.TextDocument, line: number): boolean {
  for (let i = line - 1; i >= 0; i--) {
    const t = document.lineAt(i).text;
    const m = /^([a-zA-Z_][a-zA-Z0-9_]*):/.exec(t);
    if (m) return m[1] === 'cors';
  }
  return false;
}

/**
 * Walk back from the cursor line looking for the nearest `method: X` line in
 * the same endpoint block (i.e. before we hit a less-indented line, signaling
 * we left the endpoint). Returns the matched method or undefined.
 */
function findEnclosingMethod(document: vscode.TextDocument, startLine: number): string | undefined {
  const startIndent = leadingSpaces(document.lineAt(startLine).text);
  for (let i = startLine - 1; i >= Math.max(0, startLine - 10); i--) {
    const text = document.lineAt(i).text;
    const indent = leadingSpaces(text);
    if (indent < startIndent && !/^\s*$/.test(text)) {
      // Walked out of the endpoint block before finding a method:
      return undefined;
    }
    const m = /^\s*method:\s*([A-Za-z]+)\s*$/.exec(text);
    if (m) return m[1].toUpperCase();
  }
  return undefined;
}

function leadingSpaces(line: string): number {
  const m = /^(\s*)/.exec(line);
  return m ? m[1].length : 0;
}
