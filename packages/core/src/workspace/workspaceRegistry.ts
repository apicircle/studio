import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import lockfile from 'proper-lockfile';
import type { WorkspaceLocal, WorkspaceSynced } from '@apicircle/shared';
import { loadFromFile, saveToFile } from './fileBackedWorkspace';
import type { WorkspaceState } from './patches';

// =============================================================================
// On-disk multi-workspace registry. Mirrors the IDB-side `WorkspaceRegistry`
// shape (`packages/ui-components/src/persistence/db.ts`) so the desktop app,
// the CLI, and the MCP server all read the same JSON file format.
//
// Layout under `<root>/`:
//
//   registry.json                       ← this module's source of truth
//   <workspace-id-1>/
//     workspace.synced.json
//     workspace.local.json
//   <workspace-id-2>/
//     ...
//
// Each workspace lives in its own subdirectory so concurrent writers (the
// desktop's mirror + a CLI invocation against a different workspace) can't
// step on each other. `proper-lockfile` still guards the registry file
// itself when readers / writers race.
// =============================================================================

export const REGISTRY_FILE = 'registry.json';

export interface WorkspaceRegistryEntry {
  /** Matches the in-workspace `synced.workspaceId`. */
  id: string;
  /** Human-readable label. Local to this device — never pushed to git. */
  name: string;
  /** ISO timestamp; bumped every time this workspace is opened or written. */
  lastOpenedAt: string;
  /** ISO timestamp; set when the workspace was first registered. */
  createdAt: string;
}

export interface WorkspaceRegistry {
  schemaVersion: 1;
  /** id of the workspace the desktop UI should boot into. `null` only on
   *  an empty registry (no workspaces have been seeded yet). */
  activeWorkspaceId: string | null;
  workspaces: WorkspaceRegistryEntry[];
}

/** Default empty registry. */
export function emptyRegistry(): WorkspaceRegistry {
  return { schemaVersion: 1, activeWorkspaceId: null, workspaces: [] };
}

/** Compute the directory inside `<root>/` that holds a workspace's JSON pair. */
export function workspaceDirFor(root: string, workspaceId: string): string {
  return path.join(root, workspaceId);
}

/** Load the registry from disk; returns `null` if the file is missing. */
export async function loadRegistry(root: string): Promise<WorkspaceRegistry | null> {
  const filePath = path.join(root, REGISTRY_FILE);
  try {
    const raw = await fs.readFile(filePath, 'utf-8');
    const parsed = JSON.parse(raw) as WorkspaceRegistry;
    return normalizeRegistry(parsed);
  } catch (err) {
    if (isENOENT(err)) return null;
    throw err;
  }
}

/** Save the registry atomically (`<file>.tmp` + rename). */
export async function saveRegistry(root: string, registry: WorkspaceRegistry): Promise<void> {
  await fs.mkdir(root, { recursive: true });
  const filePath = path.join(root, REGISTRY_FILE);
  const tmp = `${filePath}.tmp`;
  await ensureFile(filePath);
  // Lock the registry file itself so two writers can't tear-write the JSON.
  const release = await lockfile.lock(filePath, {
    retries: { retries: 5, minTimeout: 50, maxTimeout: 500 },
    stale: 30000,
  });
  try {
    await fs.writeFile(tmp, JSON.stringify(registry, null, 2) + '\n', {
      encoding: 'utf-8',
      mode: 0o600,
    });
    await fs.rename(tmp, filePath);
  } finally {
    await release();
  }
}

/**
 * Read a workspace's `{synced, local}` pair by id. Returns `null` if the
 * workspace subdirectory is missing OR its `workspace.synced.json` is
 * missing. Used by the CLI / MCP / desktop reader.
 */
export async function loadWorkspaceById(
  root: string,
  workspaceId: string,
): Promise<WorkspaceState | null> {
  return loadFromFile(workspaceDirFor(root, workspaceId), { allowMissing: true });
}

/**
 * Write a workspace's pair under `<root>/<id>/`. Idempotent; the directory
 * is created on first write. Bumps the registry entry's `lastOpenedAt`
 * and writes the registry back if the entry exists.
 */
export async function saveWorkspaceById(
  root: string,
  workspaceId: string,
  state: WorkspaceState,
): Promise<void> {
  await saveToFile(workspaceDirFor(root, workspaceId), state);
}

/**
 * Remove a workspace from disk: deletes its directory, drops it from the
 * registry. If it was the active workspace, the next-most-recent remaining
 * workspace becomes active. If no workspaces remain, `activeWorkspaceId`
 * goes to `null` and the caller should seed a fresh workspace.
 */
export async function deleteWorkspaceById(
  root: string,
  workspaceId: string,
): Promise<WorkspaceRegistry> {
  const registry = (await loadRegistry(root)) ?? emptyRegistry();
  const remaining = registry.workspaces.filter((w) => w.id !== workspaceId);
  await fs.rm(workspaceDirFor(root, workspaceId), { recursive: true, force: true });
  let nextActive = registry.activeWorkspaceId;
  if (nextActive === workspaceId) {
    nextActive =
      [...remaining].sort((a, b) => b.lastOpenedAt.localeCompare(a.lastOpenedAt))[0]?.id ?? null;
  }
  const next: WorkspaceRegistry = {
    ...registry,
    activeWorkspaceId: nextActive,
    workspaces: remaining,
  };
  await saveRegistry(root, next);
  return next;
}

/**
 * Add a workspace to the registry. Caller is responsible for having
 * written `workspace.synced.json` first. Existing entry with the same id
 * is replaced (idempotent update). Newly-registered workspaces become
 * the active one when there is no prior active.
 */
export async function registerWorkspace(
  root: string,
  entry: WorkspaceRegistryEntry,
): Promise<WorkspaceRegistry> {
  const registry = (await loadRegistry(root)) ?? emptyRegistry();
  const otherEntries = registry.workspaces.filter((w) => w.id !== entry.id);
  const next: WorkspaceRegistry = {
    schemaVersion: 1,
    activeWorkspaceId: registry.activeWorkspaceId ?? entry.id,
    workspaces: [...otherEntries, entry],
  };
  await saveRegistry(root, next);
  return next;
}

/** Set the active workspace id. Throws if the id isn't in the registry. */
export async function setActiveWorkspace(
  root: string,
  workspaceId: string,
): Promise<WorkspaceRegistry> {
  const registry = (await loadRegistry(root)) ?? emptyRegistry();
  if (!registry.workspaces.some((w) => w.id === workspaceId)) {
    throw new Error(`workspace ${workspaceId} is not in the registry at ${root}`);
  }
  const now = new Date().toISOString();
  const next: WorkspaceRegistry = {
    ...registry,
    activeWorkspaceId: workspaceId,
    workspaces: registry.workspaces.map((w) =>
      w.id === workspaceId ? { ...w, lastOpenedAt: now } : w,
    ),
  };
  await saveRegistry(root, next);
  return next;
}

/**
 * Look up a workspace registry entry by id OR by name (case-insensitive).
 * Used by the CLI's `--workspace <selector>` resolver — accepts both forms.
 * Returns `null` if no entry matches.
 */
export function findWorkspaceEntry(
  registry: WorkspaceRegistry,
  idOrName: string,
): WorkspaceRegistryEntry | null {
  const exactId = registry.workspaces.find((w) => w.id === idOrName);
  if (exactId) return exactId;
  const lower = idOrName.toLowerCase();
  const byName = registry.workspaces.find((w) => w.name.toLowerCase() === lower);
  return byName ?? null;
}

/**
 * One-time migration from the legacy single-workspace layout
 * (`<root>/workspace.synced.json` written next to the registry root) into
 * per-workspace subdirectories. Runs on first boot after the multi-workspace
 * rollout. No-op when the registry already exists.
 *
 * The legacy layout was: the desktop's userData/workspace/ directly held
 * `workspace.synced.json` + `workspace.local.json`. The new layout puts
 * those under `userData/workspaces/<id>/`. We read the legacy pair, write
 * it under the new layout keyed on its `synced.workspaceId`, then unlink
 * the legacy files so re-migration is impossible.
 */
export async function migrateLegacyWorkspace(args: {
  legacyDir: string;
  registryRoot: string;
  defaultName?: string;
}): Promise<{ migrated: boolean; registry: WorkspaceRegistry }> {
  const { legacyDir, registryRoot, defaultName = 'Workspace' } = args;
  const existing = await loadRegistry(registryRoot);
  if (existing) return { migrated: false, registry: existing };
  const legacyState = await loadFromFile(legacyDir, { allowMissing: true });
  if (!legacyState) {
    return { migrated: false, registry: emptyRegistry() };
  }
  const id = legacyState.synced.workspaceId;
  await saveToFile(workspaceDirFor(registryRoot, id), legacyState);
  const now = new Date().toISOString();
  const entry: WorkspaceRegistryEntry = {
    id,
    name: defaultName,
    createdAt: legacyState.synced.meta.createdAt ?? now,
    lastOpenedAt: now,
  };
  const registry: WorkspaceRegistry = {
    schemaVersion: 1,
    activeWorkspaceId: id,
    workspaces: [entry],
  };
  await saveRegistry(registryRoot, registry);
  // Remove the legacy files so subsequent boots don't re-migrate (and so
  // the CLI / MCP don't accidentally read the stale copy).
  await fs.rm(path.join(legacyDir, 'workspace.synced.json'), { force: true });
  await fs.rm(path.join(legacyDir, 'workspace.local.json'), { force: true });
  return { migrated: true, registry };
}

/** Normalize a parsed registry so downstream code can rely on its shape. */
function normalizeRegistry(raw: WorkspaceRegistry): WorkspaceRegistry {
  return {
    schemaVersion: 1,
    activeWorkspaceId: raw.activeWorkspaceId ?? null,
    workspaces: Array.isArray(raw.workspaces) ? raw.workspaces : [],
  };
}

async function ensureFile(filePath: string): Promise<void> {
  try {
    await fs.access(filePath);
  } catch (err) {
    if (!isENOENT(err)) throw err;
    await fs.writeFile(filePath, '{}', { encoding: 'utf-8', mode: 0o600 });
  }
}

function isENOENT(err: unknown): boolean {
  return typeof err === 'object' && err !== null && 'code' in err && err.code === 'ENOENT';
}

// Re-export commonly-used helpers so consumers can import from one place.
export type { WorkspaceLocal, WorkspaceSynced };
