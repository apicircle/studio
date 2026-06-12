import type * as vscode from 'vscode';
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { WorkspaceState, WorkspacePatch, ApplyMutationResult } from '@apicircle/core';
import type { WorkspaceSynced, WorkspaceLocal } from '@apicircle/shared';
import { WORKSPACE_DIR, WORKSPACE_JSON_PATH } from '@apicircle/core';
import type { DiscoveredWorkspace } from '../util/workspaceDiscovery';
import { deviceLocalPath } from '../util/workspaceDiscovery';
import { GitWorkspaceProvider } from './gitWorkspaceProvider';

// =============================================================================
// VsCodeBridge — the in-process host façade for the VS Code extension.
//
// Analogous to the desktop app's Electron main process: it owns the disk-
// backed workspace provider, the mock-server controller (Phase 3 wired),
// the vault manager (Phase 4 wired — passphrase-derived AES-GCM key in
// memory), and the MCP host config surface (Phase 5 wired — per-client
// snippet generation).
//
// Phase 1 wired the workspace surface only; subsequent phases added their
// sub-bridges here without changing this file's consumers.
//
// NOTE: the VS Code build does NOT expose `window.apicircleDesktop` to a
// renderer — there is no renderer in the all-native model. The
// `DesktopBridgeContract` from `@apicircle/ui-components/desktop/bridge`
// becomes relevant only when the visual-editor webview lands in Phase 6.
// =============================================================================

export interface WorkspaceSurface {
  /** Read the current synced + local state. */
  read(): Promise<WorkspaceState>;
  /** Apply a single patch via the canonical `applyMutation` choke point. */
  apply(patch: WorkspacePatch): Promise<ApplyMutationResult>;
  /**
   * Direct write — bypasses `applyMutation`. Use ONLY for state that doesn't
   * have a `WorkspacePatch` variant yet (Phase 2: history append, snapshot
   * capture). Headless writers (MCP / CLI) must still go through `apply`.
   */
  write(next: { synced?: WorkspaceSynced; local?: WorkspaceLocal }): Promise<WorkspaceState>;
  /** The discovered workspace this surface is bound to. */
  workspace: DiscoveredWorkspace;
}

/** Lightweight subscription returned by `onDidChangeActiveWorkspace`. */
export interface BridgeSubscription {
  dispose: () => void;
}

export class VsCodeBridge implements vscode.Disposable {
  private workspaces = new Map<string, WorkspaceSurface>();
  private activeId: string | null = null;
  private disposables: vscode.Disposable[] = [];
  /**
   * F-G9: listeners notified whenever `setActive` changes the active
   * workspace. Status bar + CodeLens + Mock view subscribe so multi-root
   * switches refresh instantly instead of waiting for the next watcher tick.
   */
  private readonly activeChangeListeners: Array<() => void> = [];

  constructor(private readonly context: vscode.ExtensionContext) {}

  /**
   * Register a discovered workspace with the bridge. Idempotent — re-registering
   * the same id is a no-op.
   */
  registerWorkspace(ws: DiscoveredWorkspace): WorkspaceSurface {
    const existing = this.workspaces.get(ws.id);
    if (existing) return existing;

    const localDir = deviceLocalPath(this.context.globalStorageUri, ws);
    const provider = new GitWorkspaceProvider({
      syncedDir: ws.apicircleDir,
      localDir,
    });
    const surface: WorkspaceSurface = {
      workspace: ws,
      read: () => provider.read(),
      apply: async (patch) => {
        const out = await provider.apply(patch);
        return { next: out.state, changedIds: out.changedIds };
      },
      write: (next) => provider.write(next),
    };
    this.workspaces.set(ws.id, surface);
    return surface;
  }

  /** The currently-active workspace, if one is set. */
  activeWorkspace(): WorkspaceSurface | null {
    if (!this.activeId) return null;
    return this.workspaces.get(this.activeId) ?? null;
  }

  /** Set the active workspace (by id, e.g. the .apicircle dir absolute path). */
  setActive(id: string): void {
    if (!this.workspaces.has(id)) {
      throw new Error(`VsCodeBridge.setActive: unknown workspace id ${id}`);
    }
    const changed = this.activeId !== id;
    this.activeId = id;
    void this.context.globalState.update('apicircle.activeWorkspaceId', id);
    if (changed) this.fireActiveChange();
  }

  /**
   * F-G9: subscribe to active-workspace changes. Snapshots the listener
   * array before iterating (same pattern as VsCodeMockController.fireChange)
   * so a listener disposing itself mid-fire doesn't skip adjacent listeners.
   */
  onDidChangeActiveWorkspace(listener: () => void): BridgeSubscription {
    this.activeChangeListeners.push(listener);
    return {
      dispose: () => {
        const i = this.activeChangeListeners.indexOf(listener);
        if (i >= 0) this.activeChangeListeners.splice(i, 1);
      },
    };
  }

  private fireActiveChange(): void {
    const snapshot = [...this.activeChangeListeners];
    for (const l of snapshot) {
      try {
        l();
      } catch {
        // never let a listener crash setActive
      }
    }
  }

  /** List all registered workspaces. */
  listWorkspaces(): WorkspaceSurface[] {
    return Array.from(this.workspaces.values());
  }

  /**
   * Create a brand-new `.apicircle/workspace.json` inside the given VS Code
   * workspace folder. Returns the discovered workspace ready to register.
   * Used by `APICircle: Create New Workspace`.
   */
  async createWorkspaceScaffold(
    folder: vscode.WorkspaceFolder,
    seedSynced: object,
    seedLocal: object,
  ): Promise<{ apicircleDir: string; workspaceJsonPath: string }> {
    const apicircleDir = path.join(folder.uri.fsPath, WORKSPACE_DIR);
    const workspaceJsonPath = path.join(folder.uri.fsPath, WORKSPACE_JSON_PATH);

    if (fs.existsSync(workspaceJsonPath)) {
      throw new Error(`Workspace already exists at ${workspaceJsonPath}`);
    }
    await fs.promises.mkdir(apicircleDir, { recursive: true });
    await fs.promises.mkdir(path.join(apicircleDir, 'attachments'), { recursive: true });

    // Write workspace.json and workspace.local.json (the local file is written
    // into the device-local globalStorage path by the caller; here we only
    // scaffold the synced half on disk).
    const synced = JSON.stringify(seedSynced, null, 2);
    await fs.promises.writeFile(workspaceJsonPath, synced, 'utf8');

    // Auto-generated README explaining the .apicircle/ folder to teammates.
    const readmePath = path.join(apicircleDir, 'README.md');
    if (!fs.existsSync(readmePath)) {
      await fs.promises.writeFile(readmePath, README_TEMPLATE, 'utf8');
    }

    // Touch .gitignore at the repo root to ensure workspace.local.json never
    // accidentally gets committed if someone moves it here. Idempotent —
    // skipped if the entry already exists.
    await ensureGitignore(folder.uri.fsPath);

    void seedLocal; // Phase 1: caller writes this to device-local path
    return { apicircleDir, workspaceJsonPath };
  }

  dispose(): void {
    for (const d of this.disposables) d.dispose();
    this.disposables = [];
    this.workspaces.clear();
    this.activeId = null;
  }
}

const README_TEMPLATE = `# .apicircle/

This folder is managed by **API Circle Studio**.

- \`workspace.json\` — the team-shared workspace (collections, environments, mocks, etc.).
  Edit it in the [Web App](https://studio.apicircle.dev), the [Desktop App](https://github.com/apicircle/studio), or the [VS Code extension](https://github.com/apicircle/studio/tree/main/apps/vscode) — all three produce byte-identical commits.
- \`attachments/\` — binary file assets referenced from the workspace.

**Never commit** \`workspace.local.json\` or any file under \`.apicircle/.local/\` — those contain device-local data including encrypted secrets, tokens, and history. The root \`.gitignore\` should already cover this.
`;

async function ensureGitignore(repoRoot: string): Promise<void> {
  const gitignorePath = path.join(repoRoot, '.gitignore');
  const entries = [
    '# APICircle device-local — never commit',
    'workspace.local.json',
    '.apicircle/.local/',
    '.apicircle/.lock',
    '',
  ];
  let current = '';
  if (fs.existsSync(gitignorePath)) {
    current = await fs.promises.readFile(gitignorePath, 'utf8');
  }
  const missing = entries.filter((e) => e && !current.includes(e));
  if (missing.length === 0) return;
  const appended =
    (current.endsWith('\n') || current === '' ? current : current + '\n') + entries.join('\n');
  await fs.promises.writeFile(gitignorePath, appended, 'utf8');
}
