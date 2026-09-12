// Canonical repo paths for everything API Circle Studio writes into a
// user's GitHub repo. Every file lives under a single `.apicircle/`
// dotfolder at the repo root so the repo can also host READMEs, CI
// configs, and unrelated tooling at the root without colliding with our
// payload.
//
// Layout:
//   .apicircle/
//     registry.json
//     workspace-<id>/
//       workspace.json
//       attachments/
//         <slotId>
//
// The `workspace-<id>/` directory is SHARED space. API Circle owns
// `workspace.json`, `workspace.local.json`, and `attachments/`, but external
// tools may store their own sibling files/subdirs there — every writer must
// preserve files it doesn't own (surgical disk writes + `base_tree` Git push).
// See docs/architecture/open-core-and-editions.md (sidecar contract).

import { assertSafePathId, isSafePathId, unsafePathIdMessage } from './safePathId';

/** The dotfolder under the repo root that owns every API-Circle-managed
 *  file in a Git-backed workspace. */
export const WORKSPACE_DIR = '.apicircle';

/** Path to the workspace registry inside a repo / root. */
export const REGISTRY_JSON_PATH = `${WORKSPACE_DIR}/registry.json`;

/** How a registry id is named when one is refused. */
const REGISTRY_ID_KIND = 'workspace id in registry.json';

// Every builder below throws for an id that is not a single safe path
// segment (see `safePathId.ts`). The ids arrive from remote `registry.json`
// and `workspace.json` files, and the paths become GitHub Contents API URLs
// sent with the user's token — this is the one place every caller shares.

/** On-disk path for the synced workspace document inside a Git repo. */
export function workspaceJsonPath(workspaceId: string): string {
  return `${workspaceDirPath(workspaceId)}/workspace.json`;
}

/** Directory holding per-attachment blob files (`<slotId>`). */
export function attachmentsDir(workspaceId: string): string {
  return `${workspaceDirPath(workspaceId)}/attachments`;
}

/** Build the on-disk path for a single attachment slot. Caller is
 *  responsible for URL-encoding when this is passed to the GitHub
 *  Contents API. */
export function attachmentPath(workspaceId: string, slotId: string): string {
  return `${attachmentsDir(workspaceId)}/${assertSafePathId(slotId, 'attachment slot id')}`;
}

function workspaceDirPath(workspaceId: string): string {
  return `${WORKSPACE_DIR}/workspace-${assertSafePathId(workspaceId, 'workspace id')}`;
}

/**
 * Parse a registry JSON string (fetched from a remote repo's
 * `.apicircle/registry.json`) and return the active workspace ID.
 * Falls back to the first entry when `activeWorkspaceId` is null.
 * Returns `null` if the registry is empty or unparseable, and throws when
 * the id it would return is not a safe path segment — the registry is
 * whatever a collaborator pushed, and callers build repo paths from the id.
 */
export function parseRegistryActiveId(registryJsonContent: string): string | null {
  const id = registryActiveIdOf(registryJsonContent);
  return id ? assertSafePathId(id, REGISTRY_ID_KIND) : null;
}

/** The raw active id a registry names, unvetted; `null` when there is none. */
function registryActiveIdOf(registryJsonContent: string): unknown {
  try {
    const parsed = JSON.parse(registryJsonContent) as {
      activeWorkspaceId?: unknown;
      workspaces?: Array<{ id?: unknown }>;
    };
    return parsed.activeWorkspaceId ?? parsed.workspaces?.[0]?.id ?? null;
  } catch {
    return null;
  }
}

/**
 * Two-step resolution of a remote workspace.json path. Pass a generic
 * file-fetcher so this stays decoupled from any particular API client.
 *
 * 1. Fetches `registry.json` from the remote `.apicircle/` dir.
 * 2. Parses it to find the active workspace ID.
 * 3. Fetches `workspace-<id>/workspace.json`.
 *
 * Returns `{ workspaceId, content }` on success, or `{ error }` on failure.
 */
export async function fetchRemoteWorkspaceJson(
  fetchFile: (repoPath: string) => Promise<string | null>,
): Promise<{ workspaceId: string; content: string } | { error: string }> {
  const registryContent = await fetchFile(REGISTRY_JSON_PATH);
  if (registryContent === null) return { error: 'No .apicircle/registry.json found in repo' };
  const wsId = registryActiveIdOf(registryContent);
  if (!wsId) return { error: 'Registry is empty — no workspaces found' };
  if (!isSafePathId(wsId)) return { error: unsafePathIdMessage(REGISTRY_ID_KIND, wsId) };
  const wsContent = await fetchFile(workspaceJsonPath(wsId));
  if (wsContent === null) return { error: `No workspace.json at .apicircle/workspace-${wsId}/` };
  return { workspaceId: wsId, content: wsContent };
}
