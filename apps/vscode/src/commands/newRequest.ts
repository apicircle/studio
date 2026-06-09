import * as vscode from 'vscode';
import { generateId } from '@apicircle/shared';
import type { Request as ApiRequest, HttpMethod, RequestAuth } from '@apicircle/shared';
import type { VsCodeBridge } from '../host/vscodeBridge';
import { ApicircleFsProvider } from '../fs/apicircleFsProvider';

// =============================================================================
// `APICircle: New Request` — multi-step QuickPick wizard.
//
// Steps (per the Phase 1 plan):
//   1. Pick HTTP method (default GET)
//   2. Enter URL (validated for non-empty)
//   3. Pick destination folder (top-level or existing)
//   4. Pick auth type (none / bearer / basic / api-key)
//   5. If bearer/basic/api-key: collect minimal credentials
//
// Result: creates the request via applyMutation, sets workspace.local.ui's
// activeRequestId, opens its apicircle:// YAML in the editor.
//
// More elaborate auth (OAuth2, AWS SigV4, NTLM, etc.) is collected via
// dedicated auth wizards — deferred to Phase 6+. The simple cases above
// cover most real-world quick-create flows; for the elaborate auth types
// the user edits the request YAML directly (auth fields ARE present in
// the projection — the wizard is convenience, not a gating dependency).
// =============================================================================

const HTTP_METHODS: HttpMethod[] = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'];

const SIMPLE_AUTH_OPTIONS = [
  { label: 'None', value: 'none' as const },
  { label: 'Bearer token', value: 'bearer' as const },
  { label: 'Basic auth', value: 'basic' as const },
  { label: 'API key (header)', value: 'api-key' as const },
];

export interface NewRequestDeps {
  bridge: VsCodeBridge;
  /** Test-only override hook for the file open at the end. */
  openCreated?: (uri: vscode.Uri) => Promise<void>;
}

/**
 * Optional context-menu argument: when invoked from the Editor view's folder
 * context menu, the folder id is passed so the wizard can skip Step 3
 * (folder picker) and pre-select the chosen folder.
 */
export interface NewRequestContext {
  folderId?: string;
}

export async function newRequestCommand(
  deps: NewRequestDeps,
  ctx?: NewRequestContext,
): Promise<void> {
  const active = deps.bridge.activeWorkspace();
  if (!active) {
    await vscode.window.showWarningMessage('No active APICircle workspace.');
    return;
  }

  // Step 1: Method
  const methodPick = await vscode.window.showQuickPick(
    HTTP_METHODS.map((m) => ({ label: m })),
    { placeHolder: 'HTTP method (step 1 of 5)' },
  );
  if (!methodPick) return;
  const method = methodPick.label;

  // Step 2: URL
  const url = await vscode.window.showInputBox({
    prompt: 'URL (step 2 of 5)',
    placeHolder: 'https://api.example.com/users/:id',
    validateInput: (v) => (v.trim().length === 0 ? 'URL is required' : null),
  });
  if (url === undefined) return;

  // Step 3: Folder — skipped if pre-supplied via context (folder context menu).
  const state = await active.read();
  let folderPick: { label: string; folderId: string | null } | undefined;
  if (ctx?.folderId !== undefined) {
    const folder = state.synced.collections.folders[ctx.folderId];
    if (!folder) {
      await vscode.window.showWarningMessage('Selected folder no longer exists.');
      return;
    }
    folderPick = { label: folder.name, folderId: folder.id };
  } else {
    const folderOptions = [
      { label: '(top level)', folderId: null as string | null },
      ...Object.values(state.synced.collections.folders).map((f) => ({
        label: f.name,
        folderId: f.id,
      })),
    ];
    folderPick = await vscode.window.showQuickPick(folderOptions, {
      placeHolder: 'Destination folder (step 3 of 5)',
    });
    if (!folderPick) return;
  }

  // Step 4: Auth type
  const authPick = await vscode.window.showQuickPick(SIMPLE_AUTH_OPTIONS, {
    placeHolder: 'Auth (step 4 of 5)',
  });
  if (!authPick) return;

  // Step 5: Auth credentials (conditional)
  const auth: RequestAuth = await collectAuth(authPick.value);
  if (auth === null) return;

  // Suggest a name based on the URL's path
  const defaultName = `${method} ${extractPath(url)}`;
  const name = await vscode.window.showInputBox({
    prompt: 'Request name (step 5 of 5)',
    value: defaultName,
    validateInput: (v) => (v.trim().length === 0 ? 'Name is required' : null),
  });
  if (name === undefined) return;

  const now = new Date().toISOString();
  const request: ApiRequest = {
    id: generateId(),
    name: name.trim(),
    folderId: folderPick.folderId,
    method,
    url: url.trim(),
    headers: [],
    query: [],
    body: { type: 'none', content: '' },
    auth,
    contextVars: [],
    extractions: [],
    assertions: [],
    createdAt: now,
    updatedAt: now,
  };

  await active.apply({ kind: 'request.create', request });
  const uri = ApicircleFsProvider.requestUri(active.workspace.id, request.id);
  if (deps.openCreated) await deps.openCreated(uri);
  else await vscode.commands.executeCommand('vscode.open', uri);
}

async function collectAuth(kind: 'none' | 'bearer' | 'basic' | 'api-key'): Promise<RequestAuth> {
  switch (kind) {
    case 'none':
      return { type: 'none' };
    case 'bearer': {
      const token = await vscode.window.showInputBox({
        prompt: 'Bearer token',
        password: true,
      });
      return { type: 'bearer', token: token ?? '' };
    }
    case 'basic': {
      const username = await vscode.window.showInputBox({ prompt: 'Username' });
      const password = await vscode.window.showInputBox({ prompt: 'Password', password: true });
      return { type: 'basic', username: username ?? '', password: password ?? '' };
    }
    case 'api-key': {
      const key = await vscode.window.showInputBox({ prompt: 'Header name (e.g. X-API-Key)' });
      const value = await vscode.window.showInputBox({ prompt: 'API key value', password: true });
      return { type: 'api-key', key: key ?? '', value: value ?? '', addTo: 'header' };
    }
  }
}

function extractPath(url: string): string {
  try {
    return new URL(url).pathname;
  } catch {
    return url;
  }
}
