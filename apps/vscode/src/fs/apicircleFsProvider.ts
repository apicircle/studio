import * as vscode from 'vscode';
import * as path from 'node:path';
import type { VsCodeBridge, WorkspaceSurface } from '../host/vscodeBridge';
import { serializeRequestToYaml, parseRequestFromYaml, RequestYamlParseError } from './requestYaml';
import { serializeEnvironmentToYaml, parseEnvironmentFromYaml, EnvYamlParseError } from './envYaml';
import { serializePlanToYaml, parsePlanFromYaml, PlanYamlParseError } from './planYaml';
import { serializeMockToYaml, parseMockFromYaml, MockYamlParseError } from './mockYaml';
import { formatRequestRunDocument, formatPlanRunDocument } from '../execute/historyDocument';

// =============================================================================
// apicircle: FileSystemProvider
//
// Projects entities from each registered workspace as virtual YAML documents.
//
//   apicircle://<workspaceId>/requests/<requestId>.req.yaml
//
// On readFile: serializes the entity to YAML.
// On writeFile: parses YAML → WorkspacePatch → applyMutation through the
//   bridge's per-workspace FileBackedWorkspaceProvider.
//
// Phase 1 day-1 scope: requests only. Environments (Phase 2), mocks (Phase 3),
// plans (Phase 2 as Notebooks), assets (Phase 3) all add their own URI shapes
// here without changing the provider contract.
// =============================================================================

const SCHEME = 'apicircle';

interface ParsedUri {
  workspaceId: string;
  kind: 'requests' | 'responses' | 'environments' | 'history' | 'plans' | 'mocks';
  id: string;
}

export class ApicircleFsProvider implements vscode.FileSystemProvider {
  private readonly _onDidChangeFile = new vscode.EventEmitter<vscode.FileChangeEvent[]>();
  readonly onDidChangeFile: vscode.Event<vscode.FileChangeEvent[]> = this._onDidChangeFile.event;

  // In-memory store of response YAML documents keyed by runId. Responses are
  // ephemeral by design — they don't persist across extension restarts since
  // the on-disk record lives in WorkspaceLocal.history.requestRuns.
  private readonly responseStore = new Map<string, string>();

  // In-memory store of formatted history run-detail documents keyed by runId.
  // Backing data is the canonical RequestRun in WorkspaceLocal.history — the
  // store just caches the formatted YAML so HistoryView clicks open instantly.
  private readonly historyStore = new Map<string, string>();

  constructor(private readonly bridge: VsCodeBridge) {}

  /** Stash a response body for later retrieval via the FS provider URI. */
  storeResponse(runId: string, content: string): void {
    this.responseStore.set(runId, content);
  }

  /** Stash a history run-detail YAML for later retrieval. */
  storeHistoryRun(runId: string, content: string): void {
    this.historyStore.set(runId, content);
  }

  // -------------------------------------------------------------------------
  // FileSystemProvider contract
  // -------------------------------------------------------------------------

  watch(_uri: vscode.Uri): vscode.Disposable {
    // No-op: we emit events ourselves from writeFile and from the
    // FileSystemWatcher hooked to `.apicircle/workspace.json` externally.
    return { dispose: () => undefined };
  }

  async stat(uri: vscode.Uri): Promise<vscode.FileStat> {
    const parsed = parseUri(uri);
    if (parsed.kind === 'responses') {
      const content = this.responseStore.get(parsed.id);
      if (content === undefined) throw vscode.FileSystemError.FileNotFound(uri);
      return { type: vscode.FileType.File, ctime: 0, mtime: 0, size: content.length };
    }
    if (parsed.kind === 'history') {
      const content = this.historyStore.get(parsed.id);
      if (content === undefined) throw vscode.FileSystemError.FileNotFound(uri);
      return { type: vscode.FileType.File, ctime: 0, mtime: 0, size: content.length };
    }
    const surface = this.requireWorkspace(parsed.workspaceId);
    const state = await surface.read();
    let exists: boolean;
    if (parsed.kind === 'requests') {
      exists = state.synced.collections.requests[parsed.id] !== undefined;
    } else if (parsed.kind === 'environments') {
      exists = state.synced.environments.items[parsed.id] !== undefined;
    } else if (parsed.kind === 'plans') {
      exists = state.local.executionPlans[parsed.id] !== undefined;
    } else {
      // mocks
      exists = state.synced.mockServers[parsed.id] !== undefined;
    }
    if (!exists) {
      throw vscode.FileSystemError.FileNotFound(uri);
    }
    return {
      type: vscode.FileType.File,
      ctime: 0,
      mtime: Date.now(),
      size: 0,
    };
  }

  readDirectory(_uri: vscode.Uri): Promise<[string, vscode.FileType][]> {
    // Phase 1 doesn't expose directory listings on apicircle:// URIs — the
    // TreeView is the navigation surface. Returning [] keeps Code's
    // "open folder" workflows from confusing the virtual scheme.
    return Promise.resolve([]);
  }

  createDirectory(_uri: vscode.Uri): void | Thenable<void> {
    // Folders are conceptual (collections.tree); creating one happens through
    // `folder.create` patches, not through the FS.
    throw vscode.FileSystemError.NoPermissions(
      'Use the Editor TreeView "New Folder" command to create folders.',
    );
  }

  async readFile(uri: vscode.Uri): Promise<Uint8Array> {
    const parsed = parseUri(uri);

    if (parsed.kind === 'responses') {
      const content = this.responseStore.get(parsed.id);
      if (content === undefined) throw vscode.FileSystemError.FileNotFound(uri);
      return Buffer.from(content, 'utf8');
    }
    if (parsed.kind === 'history') {
      // Gap #16 fix: lazy-populate the historyStore from canonical
      // WorkspaceLocal.history on first read, not only on tree render.
      // This means clicking a history URI from anywhere (palette, MRU,
      // a saved link) opens correctly even if the HistoryView hasn't
      // rendered yet.
      let content = this.historyStore.get(parsed.id);
      if (content === undefined) {
        const surface = this.requireWorkspace(parsed.workspaceId);
        const state = await surface.read();
        const requestRun = state.local.history.requestRuns.find((r) => r.id === parsed.id);
        if (requestRun) {
          content = formatRequestRunDocument(requestRun);
        } else {
          const planRun = state.local.history.planRuns.find((r) => r.id === parsed.id);
          if (planRun) {
            content = formatPlanRunDocument(planRun, state.local.history.requestRuns);
          }
        }
        if (content !== undefined) this.historyStore.set(parsed.id, content);
      }
      if (content === undefined) throw vscode.FileSystemError.FileNotFound(uri);
      return Buffer.from(content, 'utf8');
    }

    const surface = this.requireWorkspace(parsed.workspaceId);
    const state = await surface.read();
    if (parsed.kind === 'environments') {
      const env = state.synced.environments.items[parsed.id];
      if (!env) throw vscode.FileSystemError.FileNotFound(uri);
      return Buffer.from(serializeEnvironmentToYaml(env), 'utf8');
    }
    if (parsed.kind === 'plans') {
      const plan = state.local.executionPlans[parsed.id];
      if (!plan) throw vscode.FileSystemError.FileNotFound(uri);
      return Buffer.from(serializePlanToYaml(plan), 'utf8');
    }
    if (parsed.kind === 'mocks') {
      const mock = state.synced.mockServers[parsed.id];
      if (!mock) throw vscode.FileSystemError.FileNotFound(uri);
      return Buffer.from(serializeMockToYaml(mock), 'utf8');
    }
    const request = state.synced.collections.requests[parsed.id];
    if (!request) throw vscode.FileSystemError.FileNotFound(uri);
    return Buffer.from(serializeRequestToYaml(request), 'utf8');
  }

  async writeFile(
    uri: vscode.Uri,
    content: Uint8Array,
    options: { create: boolean; overwrite: boolean },
  ): Promise<void> {
    void options;
    const parsed = parseUri(uri);
    if (parsed.kind === 'responses' || parsed.kind === 'history') {
      // Response + history are read-only — writes are accepted but only update
      // the in-memory store so VS Code doesn't show a save error when the user
      // makes a transient edit.
      const store = parsed.kind === 'responses' ? this.responseStore : this.historyStore;
      store.set(parsed.id, Buffer.from(content).toString('utf8'));
      this._onDidChangeFile.fire([{ type: vscode.FileChangeType.Changed, uri }]);
      return;
    }
    const surface = this.requireWorkspace(parsed.workspaceId);
    const text = Buffer.from(content).toString('utf8');

    if (parsed.kind === 'environments') {
      let parsedYaml: ReturnType<typeof parseEnvironmentFromYaml>;
      try {
        parsedYaml = parseEnvironmentFromYaml(text);
      } catch (e) {
        if (e instanceof EnvYamlParseError) {
          throw vscode.FileSystemError.NoPermissions(e.message);
        }
        throw e;
      }
      await surface.apply({ kind: 'environment.upsert', environment: parsedYaml.environment });
      this._onDidChangeFile.fire([{ type: vscode.FileChangeType.Changed, uri }]);
      return;
    }

    if (parsed.kind === 'requests') {
      let parsedYaml: ReturnType<typeof parseRequestFromYaml>;
      try {
        parsedYaml = parseRequestFromYaml(text);
      } catch (e) {
        if (e instanceof RequestYamlParseError) {
          throw vscode.FileSystemError.NoPermissions(e.message);
        }
        throw e;
      }
      await surface.apply({ kind: 'request.update', id: parsed.id, patch: parsedYaml.patch });
      this._onDidChangeFile.fire([{ type: vscode.FileChangeType.Changed, uri }]);
      return;
    }
    if (parsed.kind === 'mocks') {
      let parsedYaml: ReturnType<typeof parseMockFromYaml>;
      try {
        parsedYaml = parseMockFromYaml(text);
      } catch (e) {
        if (e instanceof MockYamlParseError) {
          throw vscode.FileSystemError.NoPermissions(e.message);
        }
        throw e;
      }
      const state = await surface.read();
      const existing = state.synced.mockServers[parsed.id];
      if (!existing) {
        throw vscode.FileSystemError.FileNotFound(
          'Mock no longer exists — re-create it via "APICircle: New Mock".',
        );
      }
      // Editable fields only — source + endpoints stay as the existing
      // server's values (parseMockFromYaml warns the user about edits there).
      await surface.apply({
        kind: 'mock.upsert',
        mock: {
          ...existing,
          ...parsedYaml.patch,
          updatedAt: new Date().toISOString(),
        },
      });
      this._onDidChangeFile.fire([{ type: vscode.FileChangeType.Changed, uri }]);
      return;
    }
    if (parsed.kind === 'plans') {
      let parsedYaml: ReturnType<typeof parsePlanFromYaml>;
      try {
        parsedYaml = parsePlanFromYaml(text);
      } catch (e) {
        if (e instanceof PlanYamlParseError) {
          throw vscode.FileSystemError.NoPermissions(e.message);
        }
        throw e;
      }
      const state = await surface.read();
      // R5-G4: validate that every step's requestId references an existing
      // request in the workspace. Saving a plan with a dangling reference
      // would otherwise silently survive — ExecutionView handles missing
      // requests at render time, but the save-time guard catches typos.
      const dangling = parsedYaml.plan.steps
        .map((s) => s.requestId)
        .filter((rid) => !state.synced.collections.requests[rid]);
      if (dangling.length > 0) {
        const unique = Array.from(new Set(dangling)).slice(0, 3);
        throw vscode.FileSystemError.NoPermissions(
          `Plan references unknown request id(s): ${unique.join(', ')}${dangling.length > 3 ? ', …' : ''}. Fix the requestId field or remove the step before saving.`,
        );
      }
      const existing = state.local.executionPlans[parsed.id];
      const now = new Date().toISOString();
      await surface.apply({
        kind: 'plan.upsert',
        plan: {
          id: parsed.id,
          createdAt: existing?.createdAt ?? now,
          updatedAt: now,
          ...parsedYaml.plan,
        },
      });
      this._onDidChangeFile.fire([{ type: vscode.FileChangeType.Changed, uri }]);
      return;
    }
    throw vscode.FileSystemError.NoPermissions(`Unsupported URI kind: ${String(parsed.kind)}`);
  }

  delete(uri: vscode.Uri, _options: { recursive: boolean }): void | Thenable<void> {
    const parsed = parseUri(uri);
    const surface = this.requireWorkspace(parsed.workspaceId);
    if (parsed.kind === 'requests') {
      return surface.apply({ kind: 'request.delete', id: parsed.id }).then(() => {
        this._onDidChangeFile.fire([{ type: vscode.FileChangeType.Deleted, uri }]);
      });
    }
    if (parsed.kind === 'plans') {
      // R5-G5: deleting plans/<id>.plan.yaml fires plan.delete so the
      // Execution view + on-disk record stay in sync with the FS view.
      return surface.apply({ kind: 'plan.delete', id: parsed.id }).then(() => {
        this._onDidChangeFile.fire([{ type: vscode.FileChangeType.Deleted, uri }]);
      });
    }
    if (parsed.kind === 'environments') {
      // R5-G5: deleting environments/<name>.env.yaml fires environment.delete.
      return surface.apply({ kind: 'environment.delete', name: parsed.id }).then(() => {
        this._onDidChangeFile.fire([{ type: vscode.FileChangeType.Deleted, uri }]);
      });
    }
    if (parsed.kind === 'mocks') {
      // Phase 3: deleting mocks/<id>.mock.yaml fires mock.delete.
      return surface.apply({ kind: 'mock.delete', id: parsed.id }).then(() => {
        this._onDidChangeFile.fire([{ type: vscode.FileChangeType.Deleted, uri }]);
      });
    }
    throw vscode.FileSystemError.NoPermissions(`Cannot delete ${uri.toString()}`);
  }

  rename(
    _oldUri: vscode.Uri,
    _newUri: vscode.Uri,
    _options: { overwrite: boolean },
  ): void | Thenable<void> {
    // The id is part of the URI and immutable; renaming = updating `name:` in
    // the YAML body, not changing the URI.
    throw vscode.FileSystemError.NoPermissions(
      'To rename a request, change its `name:` field in the YAML and save.',
    );
  }

  // -------------------------------------------------------------------------
  // Public helpers used by other extension modules
  // -------------------------------------------------------------------------

  /** Build the canonical URI for a request inside a workspace. */
  static requestUri(workspaceId: string, requestId: string): vscode.Uri {
    return vscode.Uri.from({
      scheme: SCHEME,
      // VS Code URI authority must match `[a-zA-Z0-9-_.~]+` — hash the
      // workspace path so we can put filesystem-style paths into authority.
      authority: encodeAuthority(workspaceId),
      path: `/requests/${requestId}.req.yaml`,
    });
  }

  /** Build the canonical URI for a response document keyed by runId. */
  static responseUri(workspaceId: string, runId: string): vscode.Uri {
    return vscode.Uri.from({
      scheme: SCHEME,
      authority: encodeAuthority(workspaceId),
      path: `/responses/${runId}.run.yaml`,
    });
  }

  /** Build the canonical URI for an environment YAML document. */
  static environmentUri(workspaceId: string, envName: string): vscode.Uri {
    return vscode.Uri.from({
      scheme: SCHEME,
      authority: encodeAuthority(workspaceId),
      path: `/environments/${encodeURIComponent(envName)}.env.yaml`,
    });
  }

  /** Build the canonical URI for a history run-detail document. */
  static historyUri(workspaceId: string, runId: string): vscode.Uri {
    return vscode.Uri.from({
      scheme: SCHEME,
      authority: encodeAuthority(workspaceId),
      path: `/history/${runId}.run.yaml`,
    });
  }

  /** Build the canonical URI for a plan YAML document. */
  static planUri(workspaceId: string, planId: string): vscode.Uri {
    return vscode.Uri.from({
      scheme: SCHEME,
      authority: encodeAuthority(workspaceId),
      path: `/plans/${planId}.plan.yaml`,
    });
  }

  /** Build the canonical URI for a mock-server YAML document. */
  static mockUri(workspaceId: string, mockId: string): vscode.Uri {
    return vscode.Uri.from({
      scheme: SCHEME,
      authority: encodeAuthority(workspaceId),
      path: `/mocks/${mockId}.mock.yaml`,
    });
  }

  /** Emit a synthetic change event — used when an external write occurs. */
  fireChangedExternal(uri: vscode.Uri): void {
    this._onDidChangeFile.fire([{ type: vscode.FileChangeType.Changed, uri }]);
  }

  // -------------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------------

  private requireWorkspace(workspaceId: string): WorkspaceSurface {
    const decoded = decodeAuthority(workspaceId);
    const all = this.bridge.listWorkspaces();
    const match = all.find(
      (w) => w.workspace.id === decoded || encodeAuthority(w.workspace.id) === workspaceId,
    );
    if (!match) {
      throw vscode.FileSystemError.FileNotFound(`Unknown workspace: ${decoded}`);
    }
    return match;
  }
}

// -----------------------------------------------------------------------------
// URI parsing helpers
// -----------------------------------------------------------------------------

function parseUri(uri: vscode.Uri): ParsedUri {
  if (uri.scheme !== SCHEME) {
    throw vscode.FileSystemError.FileNotFound(`Not an apicircle: URI: ${uri.toString()}`);
  }
  const workspaceId = uri.authority;
  // Path shape: /<kind>/<id>.<ext>
  const segments = uri.path.split('/').filter(Boolean);
  if (segments.length !== 2) {
    throw vscode.FileSystemError.FileNotFound(`Malformed URI path: ${uri.path}`);
  }
  const kind = segments[0];
  if (
    kind !== 'requests' &&
    kind !== 'responses' &&
    kind !== 'environments' &&
    kind !== 'history' &&
    kind !== 'plans' &&
    kind !== 'mocks'
  ) {
    throw vscode.FileSystemError.FileNotFound(`Unsupported URI kind: ${kind}`);
  }
  const fileName = segments[1];
  const rawId = path
    .basename(fileName, path.extname(fileName))
    .replace(/\.req$/, '')
    .replace(/\.run$/, '')
    .replace(/\.env$/, '')
    .replace(/\.plan$/, '')
    .replace(/\.mock$/, '');
  const id = kind === 'environments' ? decodeURIComponent(rawId) : rawId;
  return { workspaceId, kind, id };
}

/**
 * VS Code URI authorities are constrained to URL-safe characters. Workspace
 * ids are absolute filesystem paths (currently the workspace's .apicircle/
 * directory) and contain `\`, `:`, `/` — none URL-safe. Encode to a stable
 * base64url-style representation for the authority slot, decode back when
 * the FS provider needs the original path.
 */
function encodeAuthority(workspaceId: string): string {
  return Buffer.from(workspaceId, 'utf8').toString('base64url');
}

function decodeAuthority(encoded: string): string {
  try {
    return Buffer.from(encoded, 'base64url').toString('utf8');
  } catch {
    return encoded;
  }
}

export { encodeAuthority as __encodeAuthorityForTests };
