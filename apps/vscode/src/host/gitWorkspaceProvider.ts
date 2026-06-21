import { promises as fs, existsSync } from 'node:fs';
import * as path from 'node:path';
import lockfile from 'proper-lockfile';
import { applyMutation, type WorkspacePatch, type WorkspaceState } from '@apicircle/core';
import { liftLegacyExecutionPlans } from '@apicircle/core/workspace/file-backed';
import type { WorkspaceSynced, WorkspaceLocal } from '@apicircle/shared';
import { FONT_SIZE_PERCENT_DEFAULT } from '@apicircle/shared';
import type { WorkspaceProvider } from '@apicircle/mcp-server';

// =============================================================================
// GitWorkspaceProvider — VS Code-specific WorkspaceProvider implementation.
//
// Differs from `FileBackedWorkspaceProvider` (the disk-mirror provider used
// by the ~/.apicircle/workspaces/<id>/ pattern) in three ways:
//
//   1. The synced file is `.apicircle/workspace-<id>/workspace.json` (the
//      canonical Git-tracked path), not the legacy `workspace.synced.json`.
//   2. The local file lives in a SEPARATE directory under VS Code's
//      `globalStorageUri/<workspaceId>/workspace.local.json`, never in the
//      Git repo.
//   3. Both files use a proper-lockfile advisory lock on the synced file —
//      external MCP / CLI writers via the same `.apicircle/` directory are
//      serialized cleanly with the extension's writes.
//
// This mirrors what the desktop app does at a different on-disk layout, and
// satisfies the same `WorkspaceProvider` contract so every consumer
// (FileSystemProvider, MCP host, command handlers) stays uniform.
//
// Unification with `FileBackedWorkspaceProvider`: a worthwhile refactor
// deferred from Phase 2 — both providers have grown through P3 / P4 / P5
// without consolidating. The shared logic (lock semantics, atomic JSON
// writes, default-local synthesis) is a known drift risk, but the
// three-surface compat tests catch divergence today (every patch kind
// passes through both providers in `threeSurfaceCompat.test.ts` +
// `secretCryptoCompat.test.ts`). The refactor still isn't load-bearing;
// keep it as a Phase 7+ cleanup candidate.
// =============================================================================

const SYNCED_FILENAME = 'workspace.json';
const LOCAL_FILENAME = 'workspace.local.json';

export interface GitWorkspaceProviderOptions {
  /** Absolute path to `<repo>/.apicircle/`. */
  syncedDir: string;
  /** Absolute path to the per-workspace device-local folder. */
  localDir: string;
}

export class GitWorkspaceProvider implements WorkspaceProvider {
  constructor(private readonly opts: GitWorkspaceProviderOptions) {}

  async read(): Promise<WorkspaceState> {
    const syncedPath = this.syncedPath();
    if (!existsSync(syncedPath)) {
      throw new Error(`No workspace found at ${syncedPath}`);
    }
    const syncedRaw = await fs.readFile(syncedPath, 'utf-8');
    const synced = JSON.parse(syncedRaw) as WorkspaceSynced;

    let local: WorkspaceLocal;
    const localPath = this.localPath();
    if (existsSync(localPath)) {
      local = JSON.parse(await fs.readFile(localPath, 'utf-8')) as WorkspaceLocal;
      local = { ...local, attachmentCache: local.attachmentCache ?? {} };
    } else {
      local = createEmptyLocalForSynced(synced);
    }
    // Forward-only migration: plans authored by the pre-1.1.4 VS Code / MCP
    // write path landed in `local.executionPlans`. Surface them on synced so
    // they don't vanish after upgrade (the next write persists the lift).
    return liftLegacyExecutionPlans({ synced, local });
  }

  async apply(patch: WorkspacePatch): Promise<{ state: WorkspaceState; changedIds: string[] }> {
    await this.ensureSyncedDir();
    await this.ensureLocalDir();
    const syncedPath = this.syncedPath();
    await ensureFile(syncedPath);

    const release = await lockfile.lock(syncedPath, {
      // Generous retry budget — handles rapid keystrokes during typing, the
      // extension + CLI racing on the same workspace, and the watcher
      // refresh firing mid-write. proper-lockfile uses exponential backoff,
      // so the wall-clock budget is bounded by `maxTimeout * retries`.
      retries: { retries: 30, minTimeout: 50, maxTimeout: 500, factor: 1.5 },
      stale: 30000,
    });
    try {
      const state = await this.read();
      const result = applyMutation(state, patch);
      await writeJsonAtomic(syncedPath, result.next.synced);
      await writeJsonAtomic(this.localPath(), result.next.local);
      return { state: result.next, changedIds: result.changedIds };
    } finally {
      await release();
    }
  }

  async write(next: { synced?: WorkspaceSynced; local?: WorkspaceLocal }): Promise<WorkspaceState> {
    await this.ensureSyncedDir();
    await this.ensureLocalDir();
    const current = await this.read();
    const merged: WorkspaceState = {
      synced: next.synced ?? current.synced,
      local: next.local ?? current.local,
    };
    await writeJsonAtomic(this.syncedPath(), merged.synced);
    await writeJsonAtomic(this.localPath(), merged.local);
    return merged;
  }

  private syncedPath(): string {
    return path.join(this.opts.syncedDir, SYNCED_FILENAME);
  }

  private localPath(): string {
    return path.join(this.opts.localDir, LOCAL_FILENAME);
  }

  private async ensureSyncedDir(): Promise<void> {
    await fs.mkdir(this.opts.syncedDir, { recursive: true });
  }

  private async ensureLocalDir(): Promise<void> {
    await fs.mkdir(this.opts.localDir, { recursive: true });
  }
}

// -----------------------------------------------------------------------------
// internals (mirror of the helpers in fileBackedWorkspace.ts)
// -----------------------------------------------------------------------------

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
    sync: { lastPulledSnapshot: null, lastPulledSha: null, lastPulledAt: null, dirtyKeys: [] },
    linkedCollections: {},
    attachmentCache: {},
    globalContext: {},
    mockRuntime: { active: {} },
    ui: {
      activeRequestId: null,
      sidebarExpandedSections: [],
      themeId: 'one-dark-pro',
      fontId: 'system-mono',
      fontSizePercent: FONT_SIZE_PERCENT_DEFAULT,
    },
    settings: { validateOnSend: true, monacoConsumesWheel: false },
    snapshots: { entries: [], maxBytes: 50 * 1024 * 1024 },
  };
}
