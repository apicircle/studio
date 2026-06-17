import * as os from 'node:os';
import * as path from 'node:path';
import { promises as fs } from 'node:fs';
import {
  defaultApicircleRoot,
  findWorkspaceEntry,
  loadRegistry,
  registerWorkspace,
  saveRegistry,
  workspaceDirFor,
  type WorkspaceRegistry,
  type WorkspaceRegistryEntry,
} from '@apicircle/core/workspace/registry';
import { saveToFile } from '@apicircle/core/workspace/file-backed';
import { generateId, type Folder, type Request as ApiRequest } from '@apicircle/shared';
import type { WorkspaceState } from '@apicircle/core';

// =============================================================================
// CLI workspace selector — two explicit flags, no ambiguity.
//
// Every command that touches workspace state accepts two mutually-exclusive
// flags:
//
//   --workspace-name <name-or-id>
//     A logical handle — case-insensitive name match against the registry,
//     falling back to id match. The common case for humans:
//     `--workspace-name Petstore`. Scripts that need to survive renames
//     can pass the long-form id here too.
//
//   --workspace-path <dir>
//     A filesystem directory containing `workspace.json`. For CI / one-off
//     flows that aren't registered (e.g. a freshly git-cloned workspace).
//
// Passing both is an error. When NEITHER is passed:
//
//   • A registry exists at ~/.apicircle/   → use the active workspace.
//   • No registry exists                   → fall back to cwd.
//
// `APICIRCLE_WORKSPACES_ROOT` overrides the root for CI / tests.
// =============================================================================

export interface ResolvedWorkspace {
  /** Absolute directory containing workspace.json + workspace.local.json. */
  dir: string;
  /** Workspace id when resolved via registry; null when resolved by raw path. */
  id: string | null;
  /** Display name when resolved via registry; null otherwise. */
  name: string | null;
  /** Whether the resolver looked at the registry to find this dir. */
  fromRegistry: boolean;
  /** The registry root that was consulted (or null when resolving raw paths). */
  registryRoot: string | null;
}

export interface ResolveOptions {
  /** Raw value from `--workspace-name <name-or-id>`. */
  name?: string;
  /** Raw value from `--workspace-path <dir>`. */
  path?: string;
  /** Override for `~/.apicircle/` (CI / tests). */
  workspacesRoot?: string;
  /** When true (the default), missing target dirs raise. Set false for create paths. */
  expectExists?: boolean;
}

/**
 * The root directory the CLI consults for registry-based workspace resolution.
 * Honors `APICIRCLE_WORKSPACES_ROOT` first, then falls back to `~/.apicircle/`.
 */
export function defaultWorkspacesRoot(): string {
  const override = process.env.APICIRCLE_WORKSPACES_ROOT;
  if (override && override.length > 0) return path.resolve(override);
  return defaultApicircleRoot();
}

/**
 * Resolve `--workspace-name` / `--workspace-path` into a concrete on-disk
 * directory. Throws a `WorkspaceResolutionError` with a readable message
 * when no match is found, so callers can surface the failure to the user
 * without an opaque stack trace.
 *
 * Precedence rules:
 *
 *   1. Passing both flags is an error — they're mutually exclusive.
 *   2. `path` (when given) is treated as a literal filesystem directory.
 *      The registry isn't consulted; the dir must exist (unless
 *      `expectExists: false`).
 *   3. `name` (when given) is matched against the registry: exact id
 *      first, then case-insensitive name. Errors with a "did you run
 *      `workspaces list`?" hint when nothing matches.
 *   4. Neither given → active workspace from the registry, or cwd when
 *      no registry exists.
 */
export async function resolveWorkspace(opts: ResolveOptions = {}): Promise<ResolvedWorkspace> {
  const root = opts.workspacesRoot ?? defaultWorkspacesRoot();
  const nameSelector = opts.name?.trim();
  const pathSelector = opts.path?.trim();
  const expectExists = opts.expectExists ?? true;

  if (nameSelector && pathSelector) {
    throw new WorkspaceResolutionError(
      '--workspace-name and --workspace-path are mutually exclusive. Pass one or neither.',
      'both-flags',
    );
  }

  // Explicit path selector: skip the registry entirely.
  if (pathSelector) {
    const expanded = expandTilde(pathSelector);
    const dir = path.resolve(expanded);
    if (expectExists && !(await dirExists(dir))) {
      throw new WorkspaceResolutionError(`Workspace directory not found: ${dir}`, 'path-missing');
    }
    return { dir, id: null, name: null, fromRegistry: false, registryRoot: null };
  }

  const registry = await loadRegistry(root);

  if (nameSelector) {
    if (!registry) {
      throw new WorkspaceResolutionError(
        `No workspaces are registered at ${root}. Open the desktop app once to seed the registry, ` +
          `or pass --workspace-path <dir> to point at a workspace directory directly.`,
        'no-registry',
      );
    }
    const entry = findWorkspaceEntry(registry, nameSelector);
    if (!entry) {
      throw new WorkspaceResolutionError(
        `No workspace named "${nameSelector}" in the registry at ${root}. ` +
          `Run \`apicircle workspaces list\` to see what's available.`,
        'not-found',
      );
    }
    return {
      dir: workspaceDirFor(root, entry.id),
      id: entry.id,
      name: entry.name,
      fromRegistry: true,
      registryRoot: root,
    };
  }

  // No selector — pick active workspace, or fall back to cwd if no registry.
  if (registry && registry.activeWorkspaceId) {
    const active = registry.workspaces.find((w) => w.id === registry.activeWorkspaceId);
    if (active) {
      return {
        dir: workspaceDirFor(root, active.id),
        id: active.id,
        name: active.name,
        fromRegistry: true,
        registryRoot: root,
      };
    }
  }
  // Cwd fallback — preserves the pre-registry CLI flow for users who
  // organise their own workspace directories outside the desktop app.
  return {
    dir: path.resolve(process.cwd()),
    id: null,
    name: null,
    fromRegistry: false,
    registryRoot: null,
  };
}

/**
 * Create a new workspace on disk + add it to the registry. Returns the
 * fresh state + its registry entry. Idempotent against the id — if the
 * id is already in the registry, the existing entry is returned and the
 * on-disk files are NOT overwritten.
 */
export async function createWorkspaceOnDisk(args: {
  name: string;
  workspacesRoot?: string;
  sampleRequest?: boolean;
}): Promise<{
  registry: WorkspaceRegistry;
  entry: WorkspaceRegistryEntry;
  state: WorkspaceState;
  dir: string;
}> {
  const root = args.workspacesRoot ?? defaultWorkspacesRoot();
  const trimmed = args.name.trim();
  if (!trimmed) throw new Error('Workspace name is required');
  const existing = await loadRegistry(root);
  if (existing && existing.workspaces.some((w) => w.name.toLowerCase() === trimmed.toLowerCase())) {
    throw new Error(`A workspace named "${trimmed}" already exists`);
  }
  const workspaceId = generateId();
  const now = new Date().toISOString();
  const state = buildEmptyState(workspaceId, now, args.sampleRequest ?? false);
  const dir = workspaceDirFor(root, workspaceId);
  await saveToFile(dir, state);
  const entry: WorkspaceRegistryEntry = {
    id: workspaceId,
    name: trimmed,
    createdAt: now,
    lastOpenedAt: now,
  };
  const registry = await registerWorkspace(root, entry);
  return { registry, entry, state, dir };
}

/**
 * List every workspace registered on this machine. CLI consumers can call
 * this directly; it returns the empty list (not null) when no registry
 * exists yet, so callers can avoid null-checking.
 */
export async function listWorkspacesOnDisk(
  args: {
    workspacesRoot?: string;
  } = {},
): Promise<{ registry: WorkspaceRegistry; root: string }> {
  const root = args.workspacesRoot ?? defaultWorkspacesRoot();
  const registry = (await loadRegistry(root)) ?? {
    schemaVersion: 1 as const,
    activeWorkspaceId: null,
    workspaces: [],
  };
  return { registry, root };
}

/**
 * Save the registry. Exposed so CLI commands that mutate the registry
 * (e.g. `workspaces switch`) can persist their changes without each one
 * re-importing from `@apicircle/core/workspace/registry`.
 */
export async function saveRegistryToDisk(
  registry: WorkspaceRegistry,
  workspacesRoot?: string,
): Promise<void> {
  await saveRegistry(workspacesRoot ?? defaultWorkspacesRoot(), registry);
}

export type WorkspaceResolutionCode = 'path-missing' | 'no-registry' | 'not-found' | 'both-flags';

export class WorkspaceResolutionError extends Error {
  readonly code: WorkspaceResolutionCode;
  constructor(message: string, code: WorkspaceResolutionCode) {
    super(message);
    this.name = 'WorkspaceResolutionError';
    this.code = code;
  }
}

// ---------------------------------------------------------------------------
// internals
// ---------------------------------------------------------------------------

function expandTilde(value: string): string {
  if (value === '~') return os.homedir();
  if (value.startsWith('~/') || value.startsWith('~\\')) {
    return path.join(os.homedir(), value.slice(2));
  }
  return value;
}

async function dirExists(p: string): Promise<boolean> {
  try {
    const st = await fs.stat(p);
    return st.isDirectory();
  } catch {
    return false;
  }
}

function buildEmptyState(workspaceId: string, now: string, withSample: boolean): WorkspaceState {
  const sample: ApiRequest | null = withSample
    ? {
        id: generateId(),
        name: 'Sample: GET /anything',
        folderId: null,
        method: 'GET',
        url: 'https://httpbin.org/anything',
        headers: [{ key: 'Accept', value: 'application/json', enabled: true }],
        query: [],
        body: { type: 'none', content: '' },
        auth: { type: 'inherit' },
        contextVars: [],
        extractions: [],
        assertions: [],
        createdAt: now,
        updatedAt: now,
      }
    : null;
  const folders: Record<string, Folder> = {};
  const requests: Record<string, ApiRequest> = sample ? { [sample.id]: sample } : {};
  return {
    synced: {
      schemaVersion: 1,
      workspaceId,
      collections: {
        tree: {
          id: generateId(),
          type: 'root',
          children: sample ? [{ kind: 'request', id: sample.id }] : [],
        },
        requests,
        folders,
      },
      environments: { items: {}, activeName: null, priorityOrder: [] },
      linkedWorkspaces: {},
      linkedOverrides: { requests: {}, environmentVars: {} },
      releases: { self: null, perLink: {} },
      globalAssets: { schemas: {}, graphql: {}, files: {} },
      mockServers: {},
      meta: { createdAt: now, updatedAt: now, appVersion: '1.0.0' },
    },
    local: {
      schemaVersion: 1,
      workspaceId,
      executionPlans: {},
      history: { requestRuns: [], planRuns: [] },
      secretIndex: { entries: {} },
      sessions: { github: { workspace: null, links: {} } },
      connectedRepo: null,
      workingBranch: null,
      seededWorkspaceSha: null,
      retiredBranch: null,
      sync: { lastPulledSnapshot: null, lastPulledSha: null, lastPulledAt: null, dirtyKeys: [] },
      linkedCollections: {},
      attachmentCache: {},
      globalContext: {},
      mockRuntime: { active: {} },
      ui: {
        activeRequestId: sample?.id ?? null,
        sidebarExpandedSections: [],
        themeId: 'one-dark-pro',
        fontId: 'system-sans',
        fontSizePercent: 100,
      },
      settings: { validateOnSend: true, monacoConsumesWheel: false },
      snapshots: { entries: [], maxBytes: 50 * 1024 * 1024 },
    },
  };
}
