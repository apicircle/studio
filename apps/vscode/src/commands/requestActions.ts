import * as vscode from 'vscode';
import { generateId } from '@apicircle/shared';
import type { Request as ApiRequest } from '@apicircle/shared';
import type { VsCodeBridge } from '../host/vscodeBridge';
import { ApicircleFsProvider } from '../fs/apicircleFsProvider';

// =============================================================================
// Per-request TreeView context-menu actions:
//   • Delete Request
//   • Duplicate Request
//   • Reveal in workspace.json
//
// Each accepts either an EditorNode argument (from the context menu) or no
// argument (palette invocation — uses the active apicircle: editor's request
// id). Errors surface as toasts; no silent failures.
// =============================================================================

export interface RequestActionsDeps {
  bridge: VsCodeBridge;
}

export async function deleteRequestCommand(
  deps: RequestActionsDeps,
  node?: { kind: 'request'; id: string },
): Promise<void> {
  const { bridge } = deps;
  const active = bridge.activeWorkspace();
  if (!active) {
    await vscode.window.showWarningMessage('No active APICircle workspace.');
    return;
  }

  const requestId = await resolveRequestId(node);
  if (!requestId) return;

  const state = await active.read();
  const req = state.synced.collections.requests[requestId];
  if (!req) {
    await vscode.window.showWarningMessage('Request no longer exists.');
    return;
  }

  const confirm = await vscode.window.showWarningMessage(
    `Delete "${req.name}"? This is reflected in workspace.json and can be reverted via Git.`,
    { modal: true },
    'Delete',
  );
  if (confirm !== 'Delete') return;

  await active.apply({ kind: 'request.delete', id: requestId });
}

export async function duplicateRequestCommand(
  deps: RequestActionsDeps,
  node?: { kind: 'request'; id: string },
): Promise<void> {
  const { bridge } = deps;
  const active = bridge.activeWorkspace();
  if (!active) {
    await vscode.window.showWarningMessage('No active APICircle workspace.');
    return;
  }
  const requestId = await resolveRequestId(node);
  if (!requestId) return;

  const state = await active.read();
  const source = state.synced.collections.requests[requestId];
  if (!source) {
    await vscode.window.showWarningMessage('Request no longer exists.');
    return;
  }

  const now = new Date().toISOString();
  const copy: ApiRequest = {
    ...source,
    id: generateId(),
    name: `${source.name} (copy)`,
    createdAt: now,
    updatedAt: now,
  };

  await active.apply({ kind: 'request.create', request: copy });
  const stateAfterCreate = await active.read();
  const uri = ApicircleFsProvider.requestUri(
    active.workspace.id,
    copy,
    stateAfterCreate.synced.collections.folders,
    stateAfterCreate.synced.collections.requests,
  );
  await vscode.commands.executeCommand('vscode.open', uri);
}

export async function revealInSourceCommand(
  deps: RequestActionsDeps,
  node?: { kind: 'request'; id: string },
): Promise<void> {
  const { bridge } = deps;
  const active = bridge.activeWorkspace();
  if (!active) {
    await vscode.window.showWarningMessage('No active APICircle workspace.');
    return;
  }
  const requestId = await resolveRequestId(node);
  if (!requestId) return;

  // Open workspace.json and scroll to the request's line. We can't reliably
  // map an id to a line range without re-parsing the JSON; use VS Code's
  // built-in symbol search to land near the id.
  const uri = vscode.Uri.file(active.workspace.workspaceJsonPath);
  const doc = await vscode.workspace.openTextDocument(uri);
  const editor = await vscode.window.showTextDocument(doc);
  const text = doc.getText();
  const offset = text.indexOf(`"${requestId}"`);
  if (offset === -1) return;
  const pos = doc.positionAt(offset);
  editor.revealRange(new vscode.Range(pos, pos), vscode.TextEditorRevealType.InCenter);
  editor.selection = new vscode.Selection(pos, pos);
}

async function resolveRequestId(node?: { kind: 'request'; id: string }): Promise<string | null> {
  if (node?.kind === 'request') return node.id;
  // Fallback: active editor must be an apicircle: request URI
  const editor = vscode.window.activeTextEditor;
  if (!editor || editor.document.uri.scheme !== 'apicircle') {
    await vscode.window.showInformationMessage(
      'Open a request from the Editor view first, then re-run this command.',
    );
    return null;
  }
  const match = editor.document.uri.path.match(/\/requests\/([^.]+)/);
  return match ? match[1] : null;
}
