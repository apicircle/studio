import * as vscode from 'vscode';
import { generateId } from '@apicircle/shared';
import type { Request as ApiRequest, Folder } from '@apicircle/shared';
import type { VsCodeBridge, WorkspaceSurface } from '../host/vscodeBridge';
import { ApicircleFsProvider } from '../fs/apicircleFsProvider';
import { uniquifyName } from '../util/uniquifyName';

// =============================================================================
// `API Circle: New Request` — folder-pick + direct file creation.
//
// Earlier this was a 5-step wizard (method → URL → folder → auth → name). The
// step-wise prompts duplicated what the request YAML already lets you edit, so
// the flow is now a single decision: WHERE does the request live? Pick an
// existing folder, the top level, or create a new folder inline. Everything
// else lands as a ready-to-edit GET scaffold (method, placeholder URL, sample
// header/query, no auth) that the user tweaks directly in the opened YAML and
// then sends with ▶ Send / Ctrl+Enter.
//
// Invoked from the folder context menu, the folder id is passed via ctx so the
// pick step is skipped and the request drops straight into that folder.
// =============================================================================

export interface NewRequestDeps {
  bridge: VsCodeBridge;
  /** Test-only override hook for the file open at the end. */
  openCreated?: (uri: vscode.Uri) => Promise<void>;
}

/**
 * Optional context-menu argument: when invoked from the Editor view's folder
 * context menu, the folder id is passed so the command skips the folder picker
 * and drops the request straight into the chosen folder.
 */
export interface NewRequestContext {
  folderId?: string;
}

const NEW_FOLDER_PICK = '__new_folder__';

export async function newRequestCommand(
  deps: NewRequestDeps,
  ctx?: NewRequestContext,
): Promise<void> {
  const active = deps.bridge.activeWorkspace();
  if (!active) {
    await vscode.window.showWarningMessage('No active API Circle workspace.');
    return;
  }

  const state = await active.read();

  // Resolve the destination folder. Context-menu invocation pre-supplies it;
  // otherwise the user picks an existing folder / top level / a new folder.
  let folderId: string | null;
  if (ctx?.folderId !== undefined) {
    const folder = state.synced.collections.folders[ctx.folderId];
    if (!folder) {
      await vscode.window.showWarningMessage('Selected folder no longer exists.');
      return;
    }
    folderId = folder.id;
  } else {
    const picked = await pickOrCreateFolder(active, state);
    if (picked === undefined) return; // user cancelled
    folderId = picked;
  }

  const now = new Date().toISOString();
  const scaffold = getRequestScaffold();
  const name = uniquifyName(state.synced, folderId, 'request', 'New Request');
  const request: ApiRequest = {
    id: generateId(),
    name,
    folderId,
    method: 'GET',
    url: 'https://api.example.com/endpoint',
    headers: scaffold.headers,
    query: scaffold.query,
    body: scaffold.body,
    auth: { type: 'none' },
    contextVars: [],
    extractions: [],
    assertions: [],
    createdAt: now,
    updatedAt: now,
  };

  await active.apply({ kind: 'request.create', request });
  const stateAfterCreate = await active.read();
  const uri = ApicircleFsProvider.requestUri(
    active.workspace.id,
    request,
    stateAfterCreate.synced.collections.folders,
    stateAfterCreate.synced.collections.requests,
  );
  if (deps.openCreated) await deps.openCreated(uri);
  else await vscode.commands.executeCommand('vscode.open', uri);
}

/**
 * Folder picker for the destination. Returns:
 *   - a folder id (string) for an existing or newly-created folder,
 *   - `null` for the top level,
 *   - `undefined` when the user cancels.
 * Creating a new folder routes through `applyMutation` (folder.create) so the
 * new folder is persisted before the request is parented to it.
 */
async function pickOrCreateFolder(
  active: WorkspaceSurface,
  state: Awaited<ReturnType<WorkspaceSurface['read']>>,
): Promise<string | null | undefined> {
  type FolderPick = vscode.QuickPickItem & { folderId: string | null };
  const folders = state.synced.collections.folders;
  const options: FolderPick[] = [
    { label: '$(home) (top level)', folderId: null },
    ...Object.values(folders).map((f) => ({
      label: `$(folder) ${folderPath(f, folders)}`,
      folderId: f.id,
    })),
    {
      label: '$(new-folder) New folder…',
      description: 'Create a new top-level folder for this request.',
      folderId: NEW_FOLDER_PICK,
    },
  ];
  const pick = await vscode.window.showQuickPick(options, {
    title: 'New Request',
    placeHolder: 'Where should the request live? Pick a folder, top level, or create one.',
  });
  if (!pick) return undefined;

  if (pick.folderId === NEW_FOLDER_PICK) {
    const name = await vscode.window.showInputBox({
      title: 'New folder',
      prompt: 'Folder name',
      validateInput: (v) => (v.trim().length === 0 ? 'Folder name is required' : null),
    });
    if (name === undefined) return undefined;
    const folder: Folder = { id: generateId(), name: name.trim(), parentId: null };
    await active.apply({ kind: 'folder.create', folder });
    return folder.id;
  }
  return pick.folderId;
}

/** Build a `Parent / Child` breadcrumb label for a folder so nested folders are
 *  distinguishable in the picker. Walks up the parent chain. */
function folderPath(folder: Folder, folders: Record<string, Folder>): string {
  const segments: string[] = [folder.name];
  let parentId = folder.parentId;
  // Guard against cycles with a visited set — corrupted data shouldn't hang.
  const seen = new Set<string>([folder.id]);
  while (parentId && !seen.has(parentId)) {
    const parent = folders[parentId];
    if (!parent) break;
    segments.unshift(parent.name);
    seen.add(parent.id);
    parentId = parent.parentId;
  }
  return segments.join(' / ');
}

/**
 * Starter content so the new request opens with a usable shape the user edits,
 * not an empty shell. The request is created as a GET, so the scaffold carries
 * an Accept header + a sample `page` query param to show the structure; the
 * user switches method / body / auth directly in the YAML.
 */
function getRequestScaffold(): Pick<ApiRequest, 'headers' | 'query' | 'body'> {
  return {
    headers: [{ key: 'Accept', value: 'application/json', enabled: true }],
    query: [{ key: 'page', value: '1', enabled: true }],
    body: { type: 'none', content: '' },
  };
}
