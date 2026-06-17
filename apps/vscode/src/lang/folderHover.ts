import * as vscode from 'vscode';
import type { Folder } from '@apicircle/shared';
import { resolveInheritedAuth } from '@apicircle/core';
import type { VsCodeBridge } from '../host/vscodeBridge';
import { uriEntityKind } from '../fs/uriKind';

// =============================================================================
// HoverProvider for apicircle:// folder and request YAML documents — focused
// on the `auth:` / `auth: { type: inherit }` rows.
//
// On a request YAML's `auth:` line whose `type:` is `inherit`, the hover
// resolves the upward walk via `resolveInheritedAuth` and shows which
// ancestor folder supplies the effective auth (or `→ none`).
//
// On a folder YAML's `auth:` line, the hover shows:
//   - what descendants WOULD resolve to (the folder's own auth.type, OR a
//     preview of what its `inherit` walk lands on if the folder declares
//     `inherit` or omits auth);
//   - which descendant requests reference this folder via `auth: inherit`
//     (best-effort count so the user knows what they're affecting).
// =============================================================================

const AUTH_LINE_RE = /^auth:\s*$/;

export class InheritAuthHoverProvider implements vscode.HoverProvider {
  constructor(private readonly bridge: VsCodeBridge) {}

  async provideHover(
    document: vscode.TextDocument,
    position: vscode.Position,
  ): Promise<vscode.Hover | null> {
    if (document.uri.scheme !== 'apicircle') return null;
    const isReq = uriEntityKind(document.uri) === 'request';
    const isFolder = uriEntityKind(document.uri) === 'folder';
    if (!isReq && !isFolder) return null;

    const lineText = document.lineAt(position.line).text;
    if (!AUTH_LINE_RE.test(lineText)) return null;

    const id = new URLSearchParams(document.uri.query || '').get('id');
    if (!id) return null;
    const decoded = decodeHex(document.uri.authority);
    const surface = this.bridge
      .listWorkspaces()
      .find((w) => w.workspace.id === decoded || w.workspace.id === document.uri.authority);
    if (!surface) return null;
    let state;
    try {
      state = await surface.read();
    } catch {
      return null;
    }
    const folders = state.synced.collections.folders;

    if (isReq) {
      const req = state.synced.collections.requests[id];
      if (!req) return null;
      const declared = readSectionType(document, position.line);
      // Only meaningful for `inherit` — for other types the YAML is self-describing.
      if (declared !== 'inherit') return null;
      const resolved = resolveInheritedAuth({
        requestAuth: { type: 'inherit' },
        folderId: req.folderId,
        folders,
      });
      const source = findInheritSource(req.folderId, folders);
      const md = new vscode.MarkdownString();
      md.appendMarkdown(`**Inherits → \`${resolved.type}\`**\n\n`);
      if (source) {
        md.appendMarkdown(`Resolved from folder **${source.name}**.\n\n`);
        md.appendMarkdown(`_Click the ◆ CodeLens above this line to open the source folder YAML._`);
      } else {
        md.appendMarkdown(
          `_No ancestor folder sets explicit auth. The request will send unauthenticated._`,
        );
      }
      return new vscode.Hover(md, document.lineAt(position.line).range);
    }

    // Folder YAML
    const folder = folders[id];
    if (!folder) return null;
    const md = new vscode.MarkdownString();
    const declared = folder.auth?.type ?? 'none';
    if (declared !== 'inherit' && declared !== 'none') {
      md.appendMarkdown(`**Descendants resolve to \`${declared}\`** at this folder.\n\n`);
    } else {
      // Walk up from THIS folder's parent (skipping self) to preview the
      // effective auth when a descendant `inherit` request bubbles past it.
      const upstream = resolveInheritedAuth({
        requestAuth: { type: 'inherit' },
        folderId: folder.parentId,
        folders,
      });
      const source = findInheritSource(folder.parentId, folders);
      md.appendMarkdown(`**This folder declares \`${declared}\`.**\n\n`);
      if (source) {
        md.appendMarkdown(
          `Descendant requests with \`auth: inherit\` resolve past this folder to **${source.name}** (\`${upstream.type}\`).`,
        );
      } else {
        md.appendMarkdown(
          `Descendant requests with \`auth: inherit\` resolve to **none** — no ancestor folder sets explicit auth.`,
        );
      }
    }
    const descendantsCount = countInheritDescendants(folder.id, state, folders);
    if (descendantsCount > 0) {
      md.appendMarkdown(
        `\n\n_${descendantsCount} descendant request${descendantsCount === 1 ? '' : 's'} resolve via \`inherit\` through this folder._`,
      );
    }
    return new vscode.Hover(md, document.lineAt(position.line).range);
  }
}

function findInheritSource(
  folderId: string | null,
  folders: Record<string, Folder>,
): Folder | null {
  let cursor = folderId;
  const visited = new Set<string>();
  while (cursor !== null) {
    if (visited.has(cursor)) break;
    visited.add(cursor);
    const f = folders[cursor];
    if (!f) break;
    if (f.auth && f.auth.type !== 'inherit' && f.auth.type !== 'none') return f;
    cursor = f.parentId;
  }
  return null;
}

function isDescendant(
  candidateFolderId: string | null,
  ancestorId: string,
  folders: Record<string, Folder>,
): boolean {
  let cursor = candidateFolderId;
  const visited = new Set<string>();
  while (cursor !== null) {
    if (visited.has(cursor)) break;
    visited.add(cursor);
    if (cursor === ancestorId) return true;
    cursor = folders[cursor]?.parentId ?? null;
  }
  return false;
}

function countInheritDescendants(
  folderId: string,
  state: {
    synced: {
      collections: {
        requests: Record<string, { folderId: string | null; auth: { type: string } }>;
      };
    };
  },
  folders: Record<string, Folder>,
): number {
  let n = 0;
  for (const r of Object.values(state.synced.collections.requests)) {
    if (r.auth.type !== 'inherit') continue;
    if (isDescendant(r.folderId, folderId, folders)) n += 1;
  }
  return n;
}

function readSectionType(document: vscode.TextDocument, headerLine: number): string | null {
  for (let i = headerLine + 1; i < document.lineCount; i++) {
    const text = document.lineAt(i).text;
    if (/^[A-Za-z]/.test(text)) break;
    const m = /^\s+type:\s*['"]?([A-Za-z0-9-]+)['"]?/.exec(text);
    if (m) return m[1];
  }
  return null;
}

function decodeHex(authority: string): string {
  try {
    return Buffer.from(authority, 'hex').toString('utf8');
  } catch {
    return authority;
  }
}
