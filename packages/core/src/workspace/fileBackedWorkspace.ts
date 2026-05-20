import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { FONT_SIZE_PERCENT_DEFAULT } from '@apicircle/shared';
import type { WorkspaceLocal, WorkspaceSynced } from '@apicircle/shared';
import lockfile from 'proper-lockfile';
import type { WorkspaceState } from './patches';

// =============================================================================
// fileBackedWorkspace — load/save a `{ synced, local }` pair as two JSON
// files on disk, with a `proper-lockfile` advisory lock so concurrent CLI /
// MCP writers can't corrupt the document.
//
// Layout (relative to the directory passed in):
//   workspace.synced.json   ← matches WorkspaceSynced exactly, push-to-git target
//   workspace.local.json    ← WorkspaceLocal, host-private (CLI/MCP doesn't push)
//
// The lock is held on `workspace.synced.json` because that's the file the
// editor races against. Stale locks are released after 30s.
// =============================================================================

const SYNCED_FILE = 'workspace.synced.json';
const LOCAL_FILE = 'workspace.local.json';

export interface LoadFromFileOptions {
  /** When true, return `null` instead of throwing if the synced file is missing. */
  allowMissing?: boolean;
}

export interface SaveToFileOptions {
  /** Lock timeout (ms). Defaults to 30000. */
  lockTimeoutMs?: number;
}

/**
 * Load both workspace documents from `dir`. The synced file is required;
 * the local file is optional and falls back to a minimal empty shape so a
 * CLI on a fresh machine can still operate (it just won't have history /
 * overrides until the desktop app runs once).
 */
export async function loadFromFile(
  dir: string,
  options: LoadFromFileOptions = {},
): Promise<WorkspaceState | null> {
  const syncedPath = path.join(dir, SYNCED_FILE);
  const localPath = path.join(dir, LOCAL_FILE);

  let syncedRaw: string;
  try {
    syncedRaw = await fs.readFile(syncedPath, 'utf-8');
  } catch (err) {
    if (options.allowMissing && isENOENT(err)) return null;
    throw err;
  }
  const synced = JSON.parse(syncedRaw) as WorkspaceSynced;

  let local: WorkspaceLocal;
  try {
    local = JSON.parse(await fs.readFile(localPath, 'utf-8')) as WorkspaceLocal;
  } catch (err) {
    if (!isENOENT(err)) throw err;
    local = createEmptyLocalForSynced(synced);
  }

  return { synced, local };
}

/**
 * Atomically write both documents back to disk. Acquires an advisory lock
 * on the synced file for the duration of the write so a parallel CLI /
 * MCP / desktop save can't interleave.
 *
 * Both files are written via `<file>.tmp` + rename so a crash mid-write
 * never leaves a partial JSON document on disk.
 */
export async function saveToFile(
  dir: string,
  state: WorkspaceState,
  options: SaveToFileOptions = {},
): Promise<void> {
  await fs.mkdir(dir, { recursive: true });
  const syncedPath = path.join(dir, SYNCED_FILE);
  const localPath = path.join(dir, LOCAL_FILE);

  // proper-lockfile requires the target file to exist. Touch it on first save.
  await ensureFile(syncedPath);

  const release = await lockfile.lock(syncedPath, {
    retries: { retries: 5, minTimeout: 50, maxTimeout: 500 },
    stale: options.lockTimeoutMs ?? 30000,
  });
  try {
    await writeJsonAtomic(syncedPath, state.synced);
    await writeJsonAtomic(localPath, state.local);
  } finally {
    await release();
  }
}

/**
 * Run a load → mutate → save cycle under one lock so a single mutation
 * can't be clobbered by a racing reader-then-writer.
 */
export async function withWorkspace<T>(
  dir: string,
  fn: (state: WorkspaceState) => Promise<{ next: WorkspaceState; result?: T }>,
  options: SaveToFileOptions = {},
): Promise<T | undefined> {
  await fs.mkdir(dir, { recursive: true });
  const syncedPath = path.join(dir, SYNCED_FILE);
  const localPath = path.join(dir, LOCAL_FILE);
  await ensureFile(syncedPath);

  const release = await lockfile.lock(syncedPath, {
    retries: { retries: 5, minTimeout: 50, maxTimeout: 500 },
    stale: options.lockTimeoutMs ?? 30000,
  });
  try {
    const syncedRaw = await fs.readFile(syncedPath, 'utf-8');
    const synced = JSON.parse(syncedRaw) as WorkspaceSynced;
    let local: WorkspaceLocal;
    try {
      local = JSON.parse(await fs.readFile(localPath, 'utf-8')) as WorkspaceLocal;
    } catch (err) {
      if (!isENOENT(err)) throw err;
      local = createEmptyLocalForSynced(synced);
    }
    const out = await fn({ synced, local });
    await writeJsonAtomic(syncedPath, out.next.synced);
    await writeJsonAtomic(localPath, out.next.local);
    return out.result;
  } finally {
    await release();
  }
}

// ---------------------------------------------------------------------------
// internals
// ---------------------------------------------------------------------------

// File mode for workspace JSON: owner read/write only. Default `fs.writeFile`
// uses 0o666 minus umask (typically 0o644 — world-readable). The workspace
// docs carry the synced state (which after redaction is mostly safe to read
// but still includes per-workspace metadata) and the local state (which
// holds the encrypted Secret Vault payload table, session metadata, and the
// vault entries themselves). On multi-user POSIX hosts (CI runners,
// classroom VMs, shared dev servers) the default would leak both. 0o600
// keeps the file owner-only. Windows ignores POSIX modes — the inherited
// per-user ACL under %USERPROFILE% is what protects it there.
const WORKSPACE_FILE_MODE = 0o600;

async function ensureFile(filePath: string): Promise<void> {
  try {
    await fs.access(filePath);
  } catch (err) {
    if (!isENOENT(err)) throw err;
    await fs.writeFile(filePath, '{}', { encoding: 'utf-8', mode: WORKSPACE_FILE_MODE });
  }
}

async function writeJsonAtomic(filePath: string, value: unknown): Promise<void> {
  const tmp = `${filePath}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(value, null, 2) + '\n', {
    encoding: 'utf-8',
    mode: WORKSPACE_FILE_MODE,
  });
  await fs.rename(tmp, filePath);
}

function isENOENT(err: unknown): boolean {
  return typeof err === 'object' && err !== null && 'code' in err && err.code === 'ENOENT';
}

function createEmptyLocalForSynced(synced: WorkspaceSynced): WorkspaceLocal {
  return {
    schemaVersion: 1,
    workspaceId: synced.workspaceId,
    executionPlans: {},
    history: { requestRuns: [], planRuns: [] },
    secretIndex: { entries: {} },
    sessions: { github: { workspace: null, links: {} } },
    connectedRepo: null,
    workingBranch: null,
    seededWorkspaceSha: null,
    retiredBranch: null,
    sync: {
      lastPulledSnapshot: null,
      lastPulledSha: null,
      lastPulledAt: null,
      dirtyKeys: [],
    },
    linkedCollections: {},
    globalContext: {},
    mockRuntime: { active: {} },
    ui: {
      activeRequestId: null,
      sidebarExpandedSections: [],
      themeId: 'studio-dark',
      fontId: 'system-mono',
      fontSizePercent: FONT_SIZE_PERCENT_DEFAULT,
    },
    settings: { validateOnSend: true, monacoConsumesWheel: false },
    snapshots: { entries: [], maxBytes: 50 * 1024 * 1024 },
  };
}
