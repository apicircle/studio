import * as vscode from 'vscode';
import { generateId, type LinkedWorkspace } from '@apicircle/shared';
import {
  fetchRemoteWorkspaceJson,
  parseLinkedWorkspaceJson,
  buildLinkedSnapshot,
  ledgerFromProbe,
  previewLinkedUpdate,
  applyLinkedUpdate,
  type LinkedUpdateResolutionMap,
} from '@apicircle/core';
import { GitHubClient, GitHubError } from '@apicircle/git';
import type { VsCodeBridge, WorkspaceSurface } from '../host/vscodeBridge';
import { ApicircleFsProvider } from '../fs/apicircleFsProvider';
import {
  getGitHubToken,
  getLinkToken,
  linkSessionSecretKey,
  linkedSecretStorageKey,
} from '../host/githubAuth';

// =============================================================================
// Linked-workspace commands. Two halves:
//
//   • Pure-data config (no network): rename, description, pin version, scope,
//     session mode, required keys, unlink, changelog, open YAML — all route
//     through the `linkedWorkspace.*` patches.
//   • Networked: link a repo (or a marketplace result), refresh the cached
//     ledger / snapshot — fetch the source's `.apicircle/registry.json` +
//     `workspace-<id>/workspace.json` over
//     the GitHub API using VS Code's built-in GitHub session, then apply the
//     pure patch. The pure parse + snapshot build come from `@apicircle/core`.
// =============================================================================

export interface LinkActionsDeps {
  bridge: VsCodeBridge;
  fsProvider: ApicircleFsProvider;
  /** VS Code SecretStorage — holds per-link dedicated PATs. */
  secrets: vscode.SecretStorage;
}

export type LinkArg = vscode.Uri | { id?: string } | undefined;

/**
 * Two-step remote workspace.json fetch: reads `.apicircle/registry.json` to
 * find the active workspace ID, then fetches `workspace-<id>/workspace.json`.
 *
 * Returns the workspace content string, or `null` if the registry or
 * workspace.json is missing. Throws on network errors so callers can catch.
 */
async function fetchRemoteWorkspace(
  client: GitHubClient,
  token: string,
  owner: string,
  name: string,
  branch: string,
): Promise<{ content: string; workspaceId: string } | null> {
  const fetcher = async (repoPath: string): Promise<string | null> => {
    const file = await client.getContents(token, owner, name, repoPath, branch);
    return file?.content ?? null;
  };
  const result = await fetchRemoteWorkspaceJson(fetcher);
  if ('error' in result) return null;
  return result;
}

function linkIdFromArg(arg: LinkArg): string | undefined {
  if (!arg) return undefined;
  if ('query' in arg && typeof arg.query === 'string') {
    return new URLSearchParams(arg.query).get('id') ?? undefined;
  }
  if ('id' in arg && typeof arg.id === 'string') return arg.id;
  return undefined;
}

interface ResolvedLink {
  surface: WorkspaceSurface;
  id: string;
  link: LinkedWorkspace;
}

async function resolveLink(deps: LinkActionsDeps, arg: LinkArg): Promise<ResolvedLink | null> {
  const surface = deps.bridge.activeWorkspace();
  if (!surface) {
    await vscode.window.showWarningMessage('No active APICircle workspace.');
    return null;
  }
  const id = linkIdFromArg(arg);
  if (!id) {
    await vscode.window.showWarningMessage('Could not determine which linked workspace.');
    return null;
  }
  const state = await surface.read();
  const link = state.synced.linkedWorkspaces[id];
  if (!link) {
    await vscode.window.showWarningMessage('Linked workspace no longer exists.');
    return null;
  }
  return { surface, id, link };
}

/** Persist an updated link record and re-render its open YAML. */
async function commitLink(deps: LinkActionsDeps, surface: WorkspaceSurface, next: LinkedWorkspace) {
  await surface.apply({ kind: 'linkedWorkspace.upsert', link: next });
  deps.fsProvider.fireChangedExternal(ApicircleFsProvider.linkUri(surface.workspace.id, next));
}

/** A fetch needs a token when the source is private OR uses a dedicated session. */
function tokenRequired(link: LinkedWorkspace): boolean {
  return link.kind === 'private' || link.source.sessionMode === 'dedicated';
}

function tokenMissingMessage(link: LinkedWorkspace): string {
  return link.source.sessionMode === 'dedicated'
    ? `"${link.name}" uses a dedicated session — set its token via "Set Dedicated Session Token" first.`
    : 'GitHub sign-in is required for this private link.';
}

// ---------------------------------------------------------------------------
// Config (pure)
// ---------------------------------------------------------------------------

export async function setLinkNameFieldCommand(deps: LinkActionsDeps, arg: LinkArg): Promise<void> {
  const r = await resolveLink(deps, arg);
  if (!r) return;
  const name = await vscode.window.showInputBox({
    prompt: 'Linked workspace name (local label)',
    value: r.link.name,
    validateInput: (v) => (v.trim().length === 0 ? 'Name is required' : null),
  });
  if (name === undefined) return;
  await commitLink(deps, r.surface, { ...r.link, name: name.trim() });
}

export async function setLinkDescriptionFieldCommand(
  deps: LinkActionsDeps,
  arg: LinkArg,
): Promise<void> {
  const r = await resolveLink(deps, arg);
  if (!r) return;
  const description = await vscode.window.showInputBox({
    prompt: 'Description (optional)',
    value: r.link.description ?? '',
  });
  if (description === undefined) return;
  const next = { ...r.link };
  if (description.trim()) next.description = description;
  else delete next.description;
  await commitLink(deps, r.surface, next);
}

export async function setLinkPinnedVersionFieldCommand(
  deps: LinkActionsDeps,
  arg: LinkArg,
): Promise<void> {
  const r = await resolveLink(deps, arg);
  if (!r) return;
  const state = await r.surface.read();
  const versions = state.synced.releases.perLink[r.id]?.versions ?? [];
  const items: Array<vscode.QuickPickItem & { value: string | null }> = [
    { label: '$(circle-slash) Unpinned', description: 'track the source branch HEAD', value: null },
    ...versions
      .slice()
      .reverse()
      .map((v) => ({
        label: `v${v.version}`,
        description: [v.deprecated ? 'deprecated' : '', v.yanked ? 'withdrawn' : '']
          .filter(Boolean)
          .join(' · '),
        value: v.version,
      })),
  ];
  if (versions.length === 0) {
    items.push({
      label: '$(info) No cached versions',
      description: 'refresh the link to pull its release ledger',
      value: r.link.pinnedVersion,
    });
  }
  const picked = await vscode.window.showQuickPick(items, {
    placeHolder: `Pin "${r.link.name}" to a version`,
  });
  if (!picked) return;
  if (picked.value === r.link.pinnedVersion) return;
  await commitLink(deps, r.surface, { ...r.link, pinnedVersion: picked.value });
}

export async function setLinkScopeFieldCommand(deps: LinkActionsDeps, arg: LinkArg): Promise<void> {
  const r = await resolveLink(deps, arg);
  if (!r) return;
  const picked = await vscode.window.showQuickPick(
    [
      { label: 'collections', picked: r.link.scope.includes('collections') },
      { label: 'environments', picked: r.link.scope.includes('environments') },
    ],
    { canPickMany: true, placeHolder: 'What to consume from the source (pick at least one)' },
  );
  if (!picked) return;
  const scope = picked.map((p) => p.label) as Array<'collections' | 'environments'>;
  if (scope.length === 0) {
    await vscode.window.showWarningMessage('Pick at least one scope (collections / environments).');
    return;
  }
  await commitLink(deps, r.surface, { ...r.link, scope });
}

export async function setLinkSessionModeFieldCommand(
  deps: LinkActionsDeps,
  arg: LinkArg,
): Promise<void> {
  const r = await resolveLink(deps, arg);
  if (!r) return;
  const picked = await vscode.window.showQuickPick(
    [
      {
        label: 'workspace',
        description: "use this workspace's GitHub session",
        value: 'workspace' as const,
      },
      {
        label: 'dedicated',
        description: 'use a per-link session (different account)',
        value: 'dedicated' as const,
      },
    ],
    { placeHolder: 'Which GitHub session fetches this link' },
  );
  if (!picked) return;
  if (picked.value === r.link.source.sessionMode) return;
  await commitLink(deps, r.surface, {
    ...r.link,
    source: { ...r.link.source, sessionMode: picked.value },
  });
}

export async function addLinkRequiredKeyCommand(
  deps: LinkActionsDeps,
  arg: LinkArg,
): Promise<void> {
  const r = await resolveLink(deps, arg);
  if (!r) return;
  const key = await vscode.window.showInputBox({
    prompt: 'Secret-key id the source expects a value for',
    validateInput: (v) => {
      const t = v.trim();
      if (!t) return 'Key id is required';
      if (r.link.requiredSecretKeyIds.includes(t)) return 'Already required';
      return null;
    },
  });
  if (!key?.trim()) return;
  await commitLink(deps, r.surface, {
    ...r.link,
    requiredSecretKeyIds: [...r.link.requiredSecretKeyIds, key.trim()],
  });
}

export async function removeLinkRequiredKeyCommand(
  deps: LinkActionsDeps,
  arg: LinkArg,
  key?: string,
): Promise<void> {
  const r = await resolveLink(deps, arg);
  if (!r || !key) return;
  if (!r.link.requiredSecretKeyIds.includes(key)) return;
  await commitLink(deps, r.surface, {
    ...r.link,
    requiredSecretKeyIds: r.link.requiredSecretKeyIds.filter((k) => k !== key),
  });
}

export async function unlinkWorkspaceCommand(deps: LinkActionsDeps, arg: LinkArg): Promise<void> {
  const r = await resolveLink(deps, arg);
  if (!r) return;
  const confirm = await vscode.window.showWarningMessage(
    `Unlink "${r.link.name}"? Its cached release ledger, local snapshot, and overrides are removed. The source repo (${r.link.source.repoFullName}) is untouched.`,
    { modal: true },
    'Unlink',
  );
  if (confirm !== 'Unlink') return;
  await r.surface.apply({ kind: 'linkedWorkspace.remove', id: r.id });
  // Drop the dedicated PAT + any provisioned required-secret values — the link
  // no longer exists.
  await deps.secrets.delete(linkSessionSecretKey(r.id));
  for (const keyId of r.link.requiredSecretKeyIds) {
    await deps.secrets.delete(linkedSecretStorageKey(r.id, keyId));
  }
  deps.fsProvider.fireChangedExternal(ApicircleFsProvider.linkUri(r.surface.workspace.id, r.link));
}

/** `apicircle.setLinkSessionToken` — store a dedicated PAT for a link. */
export async function setLinkSessionTokenCommand(
  deps: LinkActionsDeps,
  arg: LinkArg,
): Promise<void> {
  const r = await resolveLink(deps, arg);
  if (!r) return;
  const token = await vscode.window.showInputBox({
    prompt: `Dedicated GitHub token for "${r.link.name}" (stored in VS Code SecretStorage)`,
    password: true,
    placeHolder: 'ghp_… or github_pat_…',
    validateInput: (v) => (v.trim().length === 0 ? 'Token is required' : null),
  });
  if (!token?.trim()) return;
  await deps.secrets.store(linkSessionSecretKey(r.id), token.trim());
  // Flip to dedicated mode if it wasn't already, so the token is actually used.
  if (r.link.source.sessionMode !== 'dedicated') {
    await commitLink(deps, r.surface, {
      ...r.link,
      source: { ...r.link.source, sessionMode: 'dedicated' },
    });
  }
  await vscode.window.showInformationMessage(
    `Stored a dedicated session token for "${r.link.name}".`,
  );
}

/** `apicircle.clearLinkSessionToken` — remove a link's stored dedicated PAT. */
export async function clearLinkSessionTokenCommand(
  deps: LinkActionsDeps,
  arg: LinkArg,
): Promise<void> {
  const r = await resolveLink(deps, arg);
  if (!r) return;
  await deps.secrets.delete(linkSessionSecretKey(r.id));
  await vscode.window.showInformationMessage(
    `Cleared the dedicated session token for "${r.link.name}".`,
  );
}

/**
 * `apicircle.provisionLinkedSecret` — store an encrypted value for one of a
 * link's required secret keys (SecretStorage is OS-encrypted at rest). When no
 * key is supplied, prompt to pick one of the link's declared required keys.
 */
export async function provisionLinkedSecretCommand(
  deps: LinkActionsDeps,
  arg: LinkArg,
  keyId?: string,
): Promise<void> {
  const r = await resolveLink(deps, arg);
  if (!r) return;
  let key = keyId;
  if (!key) {
    if (r.link.requiredSecretKeyIds.length === 0) {
      await vscode.window.showInformationMessage(
        `"${r.link.name}" declares no required secret keys.`,
      );
      return;
    }
    const picked = await vscode.window.showQuickPick(
      await Promise.all(
        r.link.requiredSecretKeyIds.map(async (k) => ({
          label: k,
          description: (await deps.secrets.get(linkedSecretStorageKey(r.id, k)))
            ? 'provided'
            : 'missing',
          value: k,
        })),
      ),
      { placeHolder: 'Which required key to provide a value for' },
    );
    if (!picked) return;
    key = picked.value;
  }
  const value = await vscode.window.showInputBox({
    prompt: `Value for "${key}" (stored encrypted in VS Code SecretStorage)`,
    password: true,
    validateInput: (v) => (v.length === 0 ? 'Value is required' : null),
  });
  if (value === undefined || value.length === 0) return;
  await deps.secrets.store(linkedSecretStorageKey(r.id, key), value);
  await vscode.window.showInformationMessage(`Stored a value for "${key}" on "${r.link.name}".`);
}

/** `apicircle.clearLinkedSecret` — remove a provisioned required-secret value. */
export async function clearLinkedSecretCommand(
  deps: LinkActionsDeps,
  arg: LinkArg,
  keyId?: string,
): Promise<void> {
  const r = await resolveLink(deps, arg);
  if (!r) return;
  let key = keyId;
  if (!key) {
    if (r.link.requiredSecretKeyIds.length === 0) return;
    const picked = await vscode.window.showQuickPick(r.link.requiredSecretKeyIds, {
      placeHolder: 'Which provided value to clear',
    });
    if (!picked) return;
    key = picked;
  }
  await deps.secrets.delete(linkedSecretStorageKey(r.id, key));
  await vscode.window.showInformationMessage(`Cleared the value for "${key}".`);
}

export async function showLinkedChangelogCommand(
  deps: LinkActionsDeps,
  arg: LinkArg,
): Promise<void> {
  const r = await resolveLink(deps, arg);
  if (!r) return;
  const state = await r.surface.read();
  const ledger = state.synced.releases.perLink[r.id];
  if (!ledger || ledger.versions.length === 0) {
    await vscode.window.showInformationMessage(
      `No cached release history for "${r.link.name}" — refresh the link to pull it.`,
    );
    return;
  }
  await vscode.window.showQuickPick(
    ledger.versions
      .slice()
      .reverse()
      .map((v) => ({
        label: `v${v.version}${v.version === ledger.currentVersion ? '  (current)' : ''}`,
        description: [v.deprecated ? 'deprecated' : '', v.yanked ? 'withdrawn' : '']
          .filter(Boolean)
          .join(' · '),
        detail: v.notes || undefined,
      })),
    { placeHolder: `Release history for ${r.link.name} (read-only)` },
  );
}

export async function openLinkYamlCommand(deps: LinkActionsDeps, arg: LinkArg): Promise<void> {
  const r = await resolveLink(deps, arg);
  if (!r) return;
  await vscode.commands.executeCommand(
    'vscode.open',
    ApicircleFsProvider.linkUri(r.surface.workspace.id, r.link),
  );
}

/** `apicircle.openLinkedRequest` — open a linked workspace's request (effective). */
export async function openLinkedRequestCommand(
  deps: LinkActionsDeps,
  arg?: { linkId?: string; requestId?: string },
): Promise<void> {
  const surface = deps.bridge.activeWorkspace();
  if (!surface) {
    await vscode.window.showWarningMessage('No active APICircle workspace.');
    return;
  }
  if (!arg?.linkId || !arg?.requestId) return;
  const state = await surface.read();
  const link = state.synced.linkedWorkspaces[arg.linkId];
  const req = state.local.linkedCollections[arg.linkId]?.collections.requests[arg.requestId];
  if (!link || !req) {
    await vscode.window.showWarningMessage(
      'Linked request is no longer cached — refresh the link.',
    );
    return;
  }
  await vscode.commands.executeCommand(
    'vscode.open',
    ApicircleFsProvider.linkedRequestUri(surface.workspace.id, link, req),
  );
}

/** `apicircle.resetLinkedRequest` — drop the override for a linked request (reset to source). */
export async function resetLinkedRequestCommand(
  deps: LinkActionsDeps,
  arg?: { linkId?: string; requestId?: string },
): Promise<void> {
  const surface = deps.bridge.activeWorkspace();
  if (!surface || !arg?.linkId || !arg?.requestId) return;
  const state = await surface.read();
  const link = state.synced.linkedWorkspaces[arg.linkId];
  const req = state.local.linkedCollections[arg.linkId]?.collections.requests[arg.requestId];
  await surface.apply({
    kind: 'linkedOverride.removeRequest',
    linkedWorkspaceId: arg.linkId,
    itemId: arg.requestId,
  });
  if (link && req) {
    deps.fsProvider.fireChangedExternal(
      ApicircleFsProvider.linkedRequestUri(surface.workspace.id, link, req),
    );
  }
  await vscode.window.showInformationMessage('Reset the linked request to its source version.');
}

/**
 * `apicircle.setLinkedEnvVarOverride` — set/replace/remove/inject a linked
 * env-var override (3 modes: replace value, remove from consumer's view, inject
 * a new var the source doesn't declare).
 */
export async function setLinkedEnvVarOverrideCommand(
  deps: LinkActionsDeps,
  arg?: { linkId?: string; envName?: string; varKey?: string },
): Promise<void> {
  const surface = deps.bridge.activeWorkspace();
  if (!surface) return;
  const state = await surface.read();

  // Pick link + env + var if not supplied.
  let linkId = arg?.linkId;
  if (!linkId) {
    const links = Object.values(state.synced.linkedWorkspaces);
    if (links.length === 0) {
      await vscode.window.showInformationMessage('No linked workspaces to override.');
      return;
    }
    const pick = await vscode.window.showQuickPick(
      links.map((l) => ({ label: l.name, description: l.source.repoFullName, id: l.id })),
      { placeHolder: 'Which linked workspace' },
    );
    if (!pick) return;
    linkId = pick.id;
  }
  const snapshot = state.local.linkedCollections[linkId];
  if (!snapshot) {
    await vscode.window.showWarningMessage('No cached snapshot — refresh the link first.');
    return;
  }

  let envName = arg?.envName;
  if (!envName) {
    const envs = Object.keys(snapshot.environments.items);
    const pick = await vscode.window.showQuickPick(envs, { placeHolder: 'Which environment' });
    if (!pick) return;
    envName = pick;
  }
  const env = snapshot.environments.items[envName];
  if (!env) {
    await vscode.window.showWarningMessage(`Environment "${envName}" not in the linked snapshot.`);
    return;
  }

  let varKey = arg?.varKey;
  if (!varKey) {
    const INJECT = '$(plus) Add a new variable…';
    const items: Array<vscode.QuickPickItem & { key?: string; inject?: boolean }> = [
      ...env.variables.map((v) => ({
        label: v.key,
        description: v.encrypted ? 'encrypted' : v.value,
        key: v.key,
      })),
      { label: INJECT, description: 'consumer-only injection', inject: true },
    ];
    const pick = await vscode.window.showQuickPick(items, { placeHolder: 'Which variable' });
    if (!pick) return;
    if (pick.inject) {
      const newKey = await vscode.window.showInputBox({
        prompt: `New variable key (only visible to this consumer)`,
        validateInput: (v) => (v.trim().length === 0 ? 'Key is required' : null),
      });
      if (!newKey?.trim()) return;
      varKey = newKey.trim();
    } else {
      varKey = pick.key;
    }
  }
  if (!varKey) return;

  // Mode pick.
  const mode = await vscode.window.showQuickPick(
    [
      { label: '$(edit) Replace value', value: 'replace' as const },
      { label: '$(eye-closed) Remove from consumer view', value: 'remove' as const },
      { label: '$(discard) Reset (drop override)', value: 'reset' as const },
    ],
    { placeHolder: `Override mode for ${envName}:${varKey}` },
  );
  if (!mode) return;

  if (mode.value === 'reset') {
    await surface.apply({
      kind: 'linkedOverride.removeEnvVar',
      linkedWorkspaceId: linkId,
      envName,
      varKey,
    });
    await vscode.window.showInformationMessage(`Reset ${envName}:${varKey} to source.`);
    return;
  }

  if (mode.value === 'remove') {
    await surface.apply({
      kind: 'linkedOverride.setEnvVar',
      override: {
        linkedWorkspaceId: linkId,
        envName,
        varKey,
        removed: true,
        updatedAt: new Date().toISOString(),
      },
    });
    await vscode.window.showInformationMessage(`${envName}:${varKey} hidden in this consumer.`);
    return;
  }

  const value = await vscode.window.showInputBox({
    prompt: `Override value for ${envName}:${varKey}`,
    placeHolder: "plaintext value (encryption parity will follow source's setting)",
  });
  if (value === undefined) return;
  await surface.apply({
    kind: 'linkedOverride.setEnvVar',
    override: {
      linkedWorkspaceId: linkId,
      envName,
      varKey,
      value,
      updatedAt: new Date().toISOString(),
    },
  });
  await vscode.window.showInformationMessage(`Overrode ${envName}:${varKey}.`);
}

/** `apicircle.discardLinkedMods` — drop every override for a linked workspace. */
export async function discardLinkedModsCommand(deps: LinkActionsDeps, arg: LinkArg): Promise<void> {
  const r = await resolveLink(deps, arg);
  if (!r) return;
  const state = await r.surface.read();
  const count =
    Object.keys(state.synced.linkedOverrides.requests).filter((k) => k.startsWith(`${r.id}:`))
      .length +
    Object.keys(state.synced.linkedOverrides.environmentVars).filter((k) =>
      k.startsWith(`${r.id}:`),
    ).length;
  if (count === 0) {
    await vscode.window.showInformationMessage(`"${r.link.name}" has no local modifications.`);
    return;
  }
  const confirm = await vscode.window.showWarningMessage(
    `Discard ${count} local modification(s) on "${r.link.name}"? Linked requests + env-vars revert to the source.`,
    { modal: true },
    'Discard',
  );
  if (confirm !== 'Discard') return;
  await r.surface.apply({ kind: 'linkedOverride.clearForLink', linkedWorkspaceId: r.id });
  deps.fsProvider.fireChangedExternal(ApicircleFsProvider.linkUri(r.surface.workspace.id, r.link));
}

// ---------------------------------------------------------------------------
// Networked
// ---------------------------------------------------------------------------

/** `apicircle.linkWorkspace` — link a private/public repo by picking it (or manual entry). */
export async function linkWorkspaceCommand(deps: LinkActionsDeps): Promise<void> {
  const surface = deps.bridge.activeWorkspace();
  if (!surface) {
    await vscode.window.showWarningMessage('No active APICircle workspace.');
    return;
  }
  const token = await getGitHubToken(true);
  if (!token) {
    await vscode.window.showWarningMessage('GitHub sign-in is required to link a workspace.');
    return;
  }
  const client = new GitHubClient();

  // Step 1: pick a repo (accessible repos) or manual entry.
  let repoFullName: string;
  let defaultBranch = 'main';
  let isPrivate = true;
  const MANUAL = '$(edit) Enter owner/name manually…';
  let repos: Awaited<ReturnType<GitHubClient['listAccessibleRepos']>> = [];
  try {
    repos = await client.listAccessibleRepos(token);
  } catch (e) {
    // Non-fatal — fall back to manual entry.
    void e;
  }
  const repoPick = await vscode.window.showQuickPick(
    [
      ...repos.map((rp) => ({
        label: rp.fullName,
        description: rp.isPrivate ? 'private' : 'public',
        repo: rp,
      })),
      { label: MANUAL, description: '', repo: undefined as (typeof repos)[number] | undefined },
    ],
    { placeHolder: 'Pick the workspace repo to link (or enter manually)' },
  );
  if (!repoPick) return;
  if (repoPick.repo) {
    repoFullName = repoPick.repo.fullName;
    defaultBranch = repoPick.repo.defaultBranch;
    isPrivate = repoPick.repo.isPrivate;
  } else {
    const manual = await vscode.window.showInputBox({
      prompt: 'Source repo (owner/name)',
      placeHolder: 'octo-org/payments-workspace',
      validateInput: (v) => (v.includes('/') ? null : 'Use owner/name'),
    });
    if (!manual?.trim()) return;
    repoFullName = manual.trim();
  }

  // Step 2: branch.
  const [owner, name] = repoFullName.split('/', 2);
  let branch = defaultBranch;
  try {
    const branches = await client.listBranches(token, owner, name);
    const branchPick = await vscode.window.showQuickPick(
      branches.map((b) => ({
        label: b.name,
        description: b.name === defaultBranch ? 'default' : '',
      })),
      { placeHolder: `Branch on ${repoFullName} (default: ${defaultBranch})` },
    );
    if (!branchPick) return;
    branch = branchPick.label;
  } catch {
    // Can't list (e.g. manual repo, no access) — keep the default and let the
    // fetch below surface a clear error if the branch is wrong.
  }

  await linkFromRepo(deps, surface, client, token, {
    repoFullName,
    branch,
    kind: isPrivate ? 'private' : 'public',
  });
}

/** `apicircle.searchMarketplace` — search public API Circle workspaces + link one. */
export async function searchMarketplaceCommand(deps: LinkActionsDeps): Promise<void> {
  const surface = deps.bridge.activeWorkspace();
  if (!surface) {
    await vscode.window.showWarningMessage('No active APICircle workspace.');
    return;
  }
  const query = await vscode.window.showInputBox({
    prompt: 'Search public API Circle workspaces',
    placeHolder: 'payments, weather, graphql, …',
  });
  if (query === undefined) return;
  const token = await getGitHubToken(false); // anonymous OK; token lifts rate limits
  const client = new GitHubClient();
  let results: Awaited<ReturnType<GitHubClient['searchMarketplaceRepos']>>;
  try {
    results = await client.searchMarketplaceRepos(token, query);
  } catch (e) {
    await vscode.window.showErrorMessage(
      `Marketplace search failed: ${e instanceof Error ? e.message : String(e)}`,
    );
    return;
  }
  if (results.length === 0) {
    await vscode.window.showInformationMessage('No public workspaces matched.');
    return;
  }
  const picked = await vscode.window.showQuickPick(
    results.map((rp) => ({
      label: `$(star) ${rp.stargazers}  ${rp.fullName}`,
      description: rp.topics.join(', '),
      detail: rp.description || undefined,
      repo: rp,
    })),
    { placeHolder: 'Pick a workspace to link (public)' },
  );
  if (!picked) return;

  const linkToken = await getGitHubToken(false);
  await linkFromRepo(deps, surface, client, linkToken ?? '', {
    repoFullName: picked.repo.fullName,
    branch: picked.repo.defaultBranch,
    kind: 'public',
    marketplace: {
      listedAs: picked.repo.name,
      tags: picked.repo.topics,
      summary: picked.repo.description,
    },
  });
}

/** `apicircle.refreshLinkedWorkspace` — re-pull the cached ledger (+ bootstrap snapshot). */
export async function refreshLinkedWorkspaceCommand(
  deps: LinkActionsDeps,
  arg: LinkArg,
): Promise<void> {
  const r = await resolveLink(deps, arg);
  if (!r) return;
  const token = await getLinkToken(deps.secrets, r.link);
  if (!token && tokenRequired(r.link)) {
    await vscode.window.showWarningMessage(tokenMissingMessage(r.link));
    return;
  }
  const client = new GitHubClient();
  const [owner, name] = r.link.source.repoFullName.split('/', 2);
  let remote: { content: string; workspaceId: string } | null;
  try {
    remote = await fetchRemoteWorkspace(client, token ?? '', owner, name, r.link.source.branch);
  } catch (e) {
    await vscode.window.showErrorMessage(
      `Refresh failed: ${e instanceof GitHubError ? e.message : e instanceof Error ? e.message : String(e)}`,
    );
    return;
  }
  if (remote === null) {
    await vscode.window.showErrorMessage(
      `No .apicircle/ workspace found on ${r.link.source.repoFullName}@${r.link.source.branch}.`,
    );
    return;
  }
  const probe = parseLinkedWorkspaceJson(remote.content);
  const ledger = ledgerFromProbe(probe);
  // Steady-state refresh updates the ledger only; bootstrap the snapshot if it
  // was never cached (fresh clone).
  const state = await r.surface.read();
  const needsSnapshot = !state.local.linkedCollections[r.id];
  const snapshot = needsSnapshot ? (buildLinkedSnapshot(probe, r.link) ?? undefined) : undefined;
  await r.surface.apply({
    kind: 'linkedWorkspace.upsert',
    link: r.link,
    ledger,
    ...(snapshot ? { snapshot } : {}),
  });
  deps.fsProvider.fireChangedExternal(ApicircleFsProvider.linkUri(r.surface.workspace.id, r.link));
  await vscode.window.showInformationMessage(
    `Refreshed "${r.link.name}" — ${ledger.versions.length} version(s) cached (current: ${ledger.currentVersion ?? 'none'}).`,
  );
}

/** `apicircle.reviewLinkedUpdate` — three-way review + apply of a newer source version. */
export async function reviewLinkedUpdateCommand(
  deps: LinkActionsDeps,
  arg: LinkArg,
): Promise<void> {
  const r = await resolveLink(deps, arg);
  if (!r) return;
  const token = await getLinkToken(deps.secrets, r.link);
  if (!token && tokenRequired(r.link)) {
    await vscode.window.showWarningMessage(tokenMissingMessage(r.link));
    return;
  }
  const client = new GitHubClient();
  const [owner, name] = r.link.source.repoFullName.split('/', 2);
  let remote: { content: string; workspaceId: string } | null;
  try {
    remote = await fetchRemoteWorkspace(client, token ?? '', owner, name, r.link.source.branch);
  } catch (e) {
    await vscode.window.showErrorMessage(
      `Could not fetch source: ${e instanceof Error ? e.message : String(e)}`,
    );
    return;
  }
  if (remote === null) {
    await vscode.window.showErrorMessage(
      `No .apicircle/ workspace found on ${r.link.source.repoFullName}@${r.link.source.branch}.`,
    );
    return;
  }
  const probe = parseLinkedWorkspaceJson(remote.content);
  const target = buildLinkedSnapshot(probe, r.link);
  if (!target) {
    await vscode.window.showInformationMessage(
      'Source has no collections or environments to update.',
    );
    return;
  }
  const ledger = ledgerFromProbe(probe);
  const toVersion = ledger.currentVersion ?? target.ref;
  const state = await r.surface.read();
  const base = state.local.linkedCollections[r.id] ?? null;
  const requestOverrides = Object.values(state.synced.linkedOverrides.requests).filter(
    (o) => o.linkedWorkspaceId === r.id,
  );
  const envVarOverrides = Object.values(state.synced.linkedOverrides.environmentVars).filter(
    (o) => o.linkedWorkspaceId === r.id,
  );
  const preview = previewLinkedUpdate({
    fromVersion: r.link.pinnedVersion,
    toVersion,
    base,
    target,
    requestOverrides,
    envVarOverrides,
  });

  const newPinned =
    r.link.pinnedVersion === null ? null : (ledger.currentVersion ?? r.link.pinnedVersion);

  if (preview.entries.length === 0) {
    if (newPinned !== r.link.pinnedVersion || base?.ref !== target.ref) {
      await r.surface.apply({
        kind: 'linkedWorkspace.applyUpdate',
        id: r.id,
        pinnedVersion: newPinned,
        snapshot: target,
        ledger,
        requestOverrides,
        envVarOverrides,
      });
      deps.fsProvider.fireChangedExternal(
        ApicircleFsProvider.linkUri(r.surface.workspace.id, r.link),
      );
      await vscode.window.showInformationMessage(
        `"${r.link.name}" is content-identical — updated pin to ${newPinned ? `v${newPinned}` : 'HEAD'}.`,
      );
    } else {
      await vscode.window.showInformationMessage(`"${r.link.name}" is already up to date.`);
    }
    return;
  }

  // Conflicts that genuinely need a decision: overlapping-field both-changed
  // (clean ones auto-merge per the core engine) + removed-in-source orphans.
  // Everything else (source-only, new-in-source, local-only, auto-mergeable
  // both-changed) applies automatically.
  const conflicts = preview.entries.filter(
    (e) =>
      (e.status === 'both-changed' && e.autoMergeable !== true) || e.status === 'removed-in-source',
  );

  const resolutions: LinkedUpdateResolutionMap = {};
  if (conflicts.length > 0) {
    const s = preview.summary;
    const summary = [
      s['source-only'] ? `${s['source-only']} from source` : '',
      s['new-in-source'] ? `${s['new-in-source']} new` : '',
      `${conflicts.length} to resolve`,
      s['local-only'] ? `${s['local-only']} local-only` : '',
    ]
      .filter(Boolean)
      .join(' · ');
    const mode = await vscode.window.showQuickPick(
      [
        {
          label: `$(list-selection) Resolve each (${conflicts.length})`,
          detail: 'Decide per conflicting item',
          value: 'each' as const,
        },
        {
          label: '$(cloud-download) Accept all source',
          detail: 'Take the source version for every conflict',
          value: 'theirs' as const,
        },
        {
          label: '$(account) Keep all mine',
          detail: 'Preserve your local edits everywhere',
          value: 'mine' as const,
        },
      ],
      { placeHolder: `Update ${r.link.name} → ${toVersion}: ${summary}` },
    );
    if (!mode) return;
    if (mode.value === 'each') {
      for (let i = 0; i < conflicts.length; i++) {
        const entry = conflicts[i];
        const verb = entry.status === 'removed-in-source' ? 'removed in source' : 'both changed';
        const pick = await vscode.window.showQuickPick(
          [
            { label: '$(account) Keep mine', value: 'mine' as const },
            { label: '$(cloud-download) Accept source', value: 'theirs' as const },
          ],
          {
            placeHolder: `(${i + 1}/${conflicts.length}) ${entry.bucket} "${entry.label}" — ${verb}`,
          },
        );
        if (!pick) return; // cancel the whole update
        resolutions[`${entry.bucket}:${entry.key}`] = pick.value;
      }
    } else {
      for (const entry of conflicts) {
        resolutions[`${entry.bucket}:${entry.key}`] = mode.value;
      }
    }
  }
  const result = applyLinkedUpdate({
    base,
    target,
    preview,
    resolutions,
    requestOverrides,
    envVarOverrides,
  });
  await r.surface.apply({
    kind: 'linkedWorkspace.applyUpdate',
    id: r.id,
    pinnedVersion: newPinned,
    snapshot: result.nextSnapshot,
    ledger,
    requestOverrides: result.nextRequestOverrides,
    envVarOverrides: result.nextEnvVarOverrides,
  });
  deps.fsProvider.fireChangedExternal(ApicircleFsProvider.linkUri(r.surface.workspace.id, r.link));
  const resolvedCount = Object.keys(resolutions).length;
  await vscode.window.showInformationMessage(
    `Updated "${r.link.name}" → ${newPinned ? `v${newPinned}` : 'HEAD'} (${preview.entries.length} change(s)${resolvedCount ? `, ${resolvedCount} resolved` : ''}).`,
  );
}

/** Shared link-creation path: fetch source workspace.json → build → apply → open. */
async function linkFromRepo(
  deps: LinkActionsDeps,
  surface: WorkspaceSurface,
  client: GitHubClient,
  token: string,
  args: {
    repoFullName: string;
    branch: string;
    kind: 'private' | 'public';
    marketplace?: { listedAs: string; tags: string[]; summary: string };
  },
): Promise<void> {
  const [owner, name] = args.repoFullName.split('/', 2);
  let remote: { content: string; workspaceId: string } | null;
  try {
    remote = await fetchRemoteWorkspace(client, token, owner, name, args.branch);
  } catch (e) {
    await vscode.window.showErrorMessage(
      `Could not read ${args.repoFullName}@${args.branch}: ${
        e instanceof Error ? e.message : String(e)
      }`,
    );
    return;
  }
  if (remote === null) {
    await vscode.window.showErrorMessage(
      `No .apicircle/ workspace found on ${args.repoFullName}@${args.branch}.`,
    );
    return;
  }

  // Guard against linking the same repo+branch twice.
  const state = await surface.read();
  const dup = Object.values(state.synced.linkedWorkspaces).find(
    (l) => l.source.repoFullName === args.repoFullName && l.source.branch === args.branch,
  );
  if (dup) {
    await vscode.window.showWarningMessage(
      `Already linked to ${args.repoFullName}@${args.branch} ("${dup.name}").`,
    );
    return;
  }

  const probe = parseLinkedWorkspaceJson(remote.content);
  const ledger = ledgerFromProbe(probe);

  // Version pick.
  let pinnedVersion: string | null = ledger.currentVersion;
  if (ledger.versions.length > 0) {
    const items: Array<vscode.QuickPickItem & { value: string | null }> = [
      ...(ledger.currentVersion
        ? [
            {
              label: `v${ledger.currentVersion}`,
              description: 'current (recommended)',
              value: ledger.currentVersion,
            },
          ]
        : []),
      ...ledger.versions
        .slice()
        .reverse()
        .filter((v) => v.version !== ledger.currentVersion)
        .map((v) => ({ label: `v${v.version}`, description: '', value: v.version })),
      { label: '$(circle-slash) Unpinned', description: 'track branch HEAD', value: null },
    ];
    const picked = await vscode.window.showQuickPick(items, {
      placeHolder: 'Pin a version to consume',
    });
    if (!picked) return;
    pinnedVersion = picked.value;
  }

  const link: LinkedWorkspace = {
    id: generateId(),
    kind: args.kind,
    name: args.repoFullName,
    sourceWorkspaceId: remote.workspaceId,
    source: {
      provider: 'github',
      repoFullName: args.repoFullName,
      branch: args.branch,
      sessionMode: 'workspace',
    },
    scope: ['collections', 'environments'],
    pinnedVersion,
    updatePolicy: 'manual',
    linkedAt: new Date().toISOString(),
    requiredSecretKeyIds: probe.secretKeys ? Object.keys(probe.secretKeys) : [],
    ...(args.marketplace ? { marketplace: args.marketplace } : {}),
  };
  const snapshot = buildLinkedSnapshot(probe, link) ?? undefined;
  await surface.apply({
    kind: 'linkedWorkspace.upsert',
    link,
    ledger,
    ...(snapshot ? { snapshot } : {}),
  });
  await vscode.commands.executeCommand(
    'vscode.open',
    ApicircleFsProvider.linkUri(surface.workspace.id, link),
  );
  await vscode.window.showInformationMessage(
    `Linked "${args.repoFullName}"${pinnedVersion ? ` @ v${pinnedVersion}` : ' (unpinned)'}.`,
  );
}
