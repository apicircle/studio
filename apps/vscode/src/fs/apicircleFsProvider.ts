import * as vscode from 'vscode';
import * as path from 'node:path';
import type {
  ExecutionPlan,
  Folder,
  LinkedWorkspace,
  MockServer,
  MockEndpoint,
  Request as ApiRequest,
} from '@apicircle/shared';
import {
  mergeRequestOverride,
  computeRequestOverridePatch,
  isEmptyOverridePatch,
} from '@apicircle/core';
import type { VsCodeBridge, WorkspaceSurface } from '../host/vscodeBridge';
import { serializeRequestToYaml, parseRequestFromYaml, RequestYamlParseError } from './requestYaml';
import { serializeEnvironmentToYaml, parseEnvironmentFromYaml, EnvYamlParseError } from './envYaml';
import { serializePlanToYaml, parsePlanFromYaml, PlanYamlParseError } from './planYaml';
import { serializeMockToYaml, parseMockFromYaml, MockYamlParseError } from './mockYaml';
import {
  serializeEndpointToYaml,
  parseEndpointFromYaml,
  EndpointYamlParseError,
} from './endpointYaml';
import { serializeReleasesToYaml } from './releasesYaml';
import { serializeLinkToYaml, parseLinkFromYaml, LinkYamlParseError } from './linkYaml';
import { formatRequestRunDocument, formatPlanRunDocument } from '../execute/historyDocument';

// =============================================================================
// apicircle: FileSystemProvider
//
// Projects entities from each registered workspace as virtual YAML documents.
// The URI shape encodes the human-readable name in the path so VS Code's tab
// label is readable, with the stable identifier in `?id=` so renames don't
// break identity:
//
//   apicircle://<wsAuth>/requests/<folderSlug…>/<nameSlug>.req.yaml?id=<requestId>
//   apicircle://<wsAuth>/plans/<nameSlug>.plan.yaml?id=<planId>
//   apicircle://<wsAuth>/mocks/<nameSlug>.mock.yaml?id=<mockId>
//   apicircle://<wsAuth>/mocks/<mockSlug>/<endpointSlug>.endpoint.yaml?mockId=…&id=…
//   apicircle://<wsAuth>/responses/<nameSlug>.run.yaml?runId=<runId>
//   apicircle://<wsAuth>/history/<labelSlug>.run.yaml?runId=<runId>
//   apicircle://<wsAuth>/environments/<envName>.env.yaml
//   apicircle://<wsAuth>/releases/releases.yaml   (one per workspace; read-only)
//   apicircle://<wsAuth>/links/<nameSlug>.link.yaml?id=<linkedWorkspaceId>
//   apicircle://<wsAuth>/linked/<linkSlug>/<nameSlug>.req.yaml?link=<linkId>&id=<reqId>
//
// On readFile: serializes the entity to YAML.
// On writeFile: parses YAML → WorkspacePatch → applyMutation through the
//   bridge's per-workspace FileBackedWorkspaceProvider. If the save changed
//   the entity name, the post-save URI differs from the URI VS Code is
//   showing in the tab — `followRenameIfChanged` reopens the new URI in the
//   same column (cursor preserved) and closes the stale tab so the title
//   tracks the rename on a single Ctrl+S.
// =============================================================================

const SCHEME = 'apicircle';

interface ParsedUri {
  workspaceId: string;
  kind:
    | 'requests'
    | 'responses'
    | 'environments'
    | 'history'
    | 'plans'
    | 'mocks'
    | 'endpoints'
    | 'releases'
    | 'links'
    | 'linkedRequests';
  id: string;
  /** When kind is 'endpoints', the parent mock id this endpoint belongs to. */
  parentMockId?: string;
  /** When kind is 'linkedRequests', the linked workspace id the request lives in. */
  linkId?: string;
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
    } else if (parsed.kind === 'endpoints') {
      const mock = parsed.parentMockId ? state.synced.mockServers[parsed.parentMockId] : undefined;
      exists = !!mock && mock.endpoints.some((ep) => ep.id === parsed.id);
    } else if (parsed.kind === 'releases') {
      // The release ledger document is workspace-scoped and always present —
      // an empty ledger still renders (header + currentVersion: null).
      exists = true;
    } else if (parsed.kind === 'links') {
      exists = state.synced.linkedWorkspaces[parsed.id] !== undefined;
    } else if (parsed.kind === 'linkedRequests') {
      exists =
        state.local.linkedCollections[parsed.linkId ?? '']?.collections.requests[parsed.id] !==
        undefined;
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
    if (parsed.kind === 'releases') {
      return Buffer.from(serializeReleasesToYaml(state.synced.releases.self), 'utf8');
    }
    if (parsed.kind === 'links') {
      const link = state.synced.linkedWorkspaces[parsed.id];
      if (!link) throw vscode.FileSystemError.FileNotFound(uri);
      return Buffer.from(
        serializeLinkToYaml(link, state.synced.releases.perLink[parsed.id] ?? null),
        'utf8',
      );
    }
    if (parsed.kind === 'linkedRequests') {
      const base =
        state.local.linkedCollections[parsed.linkId ?? '']?.collections.requests[parsed.id];
      if (!base) throw vscode.FileSystemError.FileNotFound(uri);
      const ov = state.synced.linkedOverrides.requests[`${parsed.linkId}:${parsed.id}`];
      const effective = ov ? mergeRequestOverride(base, ov.patch) : base;
      return Buffer.from(serializeRequestToYaml(effective), 'utf8');
    }
    if (parsed.kind === 'mocks') {
      const mock = state.synced.mockServers[parsed.id];
      if (!mock) throw vscode.FileSystemError.FileNotFound(uri);
      return Buffer.from(serializeMockToYaml(mock), 'utf8');
    }
    if (parsed.kind === 'endpoints') {
      const mock = parsed.parentMockId ? state.synced.mockServers[parsed.parentMockId] : undefined;
      const endpoint = mock?.endpoints.find((ep) => ep.id === parsed.id);
      if (!endpoint) throw vscode.FileSystemError.FileNotFound(uri);
      return Buffer.from(serializeEndpointToYaml(endpoint), 'utf8');
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
    if (parsed.kind === 'releases') {
      // The release ledger is managed through the ▶ Publish / ⚠ Deprecate /
      // ⛔ Withdraw CodeLens actions — never by editing this generated view.
      // (Publishing needs an async snapshot; deprecate / withdraw are
      // per-version transitions.)
      throw vscode.FileSystemError.NoPermissions(
        'Release history is read-only here — use the ▶ Publish release… / ⚠ Deprecate / ⛔ Withdraw CodeLens actions.',
      );
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
      // Follow URI renames: if `name:` changed in the YAML, the canonical
      // request URI (slug-derived basename) now differs from the URI the tab
      // is showing. Reopen at the new URI in the same column so the tab
      // title reflects the rename.
      const stateAfterReq = await surface.read();
      const requestAfter = stateAfterReq.synced.collections.requests[parsed.id];
      if (requestAfter) {
        const newUri = ApicircleFsProvider.requestUri(
          decodeAuthority(parsed.workspaceId),
          requestAfter,
          stateAfterReq.synced.collections.folders,
          stateAfterReq.synced.collections.requests,
        );
        void this.followRenameIfChanged(uri, newUri);
      }
      this._onDidChangeFile.fire([{ type: vscode.FileChangeType.Changed, uri }]);
      return;
    }
    if (parsed.kind === 'linkedRequests') {
      let parsedYaml: ReturnType<typeof parseRequestFromYaml>;
      try {
        parsedYaml = parseRequestFromYaml(text);
      } catch (e) {
        if (e instanceof RequestYamlParseError) {
          throw vscode.FileSystemError.NoPermissions(e.message);
        }
        throw e;
      }
      const state = await surface.read();
      const base =
        state.local.linkedCollections[parsed.linkId ?? '']?.collections.requests[parsed.id];
      if (!base) {
        throw vscode.FileSystemError.FileNotFound(
          'Linked request no longer cached — refresh the linked workspace.',
        );
      }
      // The edited YAML is the EFFECTIVE request; persist only the delta vs the
      // source as an override (empty delta = reset to source). Diff against the
      // base AFTER the same serialize→parse round-trip the reader uses, so
      // parser-normalized defaults (e.g. an omitted `cookies` → `[]`) don't
      // register as spurious overrides.
      const baseNormalized: ApiRequest = {
        ...base,
        ...parseRequestFromYaml(serializeRequestToYaml(base)).patch,
      };
      const effective: ApiRequest = { ...base, ...parsedYaml.patch };
      const overridePatch = computeRequestOverridePatch(baseNormalized, effective);
      if (isEmptyOverridePatch(overridePatch)) {
        await surface.apply({
          kind: 'linkedOverride.removeRequest',
          linkedWorkspaceId: parsed.linkId ?? '',
          itemId: parsed.id,
        });
      } else {
        await surface.apply({
          kind: 'linkedOverride.setRequest',
          override: {
            linkedWorkspaceId: parsed.linkId ?? '',
            itemId: parsed.id,
            patch: overridePatch,
            updatedAt: new Date().toISOString(),
          },
        });
      }
      this._onDidChangeFile.fire([{ type: vscode.FileChangeType.Changed, uri }]);
      return;
    }
    if (parsed.kind === 'links') {
      let parsedYaml: ReturnType<typeof parseLinkFromYaml>;
      try {
        parsedYaml = parseLinkFromYaml(text);
      } catch (e) {
        if (e instanceof LinkYamlParseError) {
          throw vscode.FileSystemError.NoPermissions(e.message);
        }
        throw e;
      }
      const state = await surface.read();
      const existing = state.synced.linkedWorkspaces[parsed.id];
      if (!existing) {
        throw vscode.FileSystemError.FileNotFound(
          'Linked workspace no longer exists — it may have been unlinked.',
        );
      }
      const p = parsedYaml.patch;
      // pinnedVersion must exist in the cached ledger (or be null = unpinned).
      if (p.pinnedVersion !== undefined && p.pinnedVersion !== null) {
        const cached = state.synced.releases.perLink[parsed.id]?.versions ?? [];
        if (!cached.some((v) => v.version === p.pinnedVersion)) {
          throw vscode.FileSystemError.NoPermissions(
            `pinnedVersion "${p.pinnedVersion}" is not in the cached ledger — refresh the link to pull newer versions, or pick an existing one.`,
          );
        }
      }
      const next: LinkedWorkspace = {
        ...existing,
        ...(p.name !== undefined ? { name: p.name } : {}),
        ...(p.description !== undefined ? { description: p.description } : {}),
        ...(p.pinnedVersion !== undefined ? { pinnedVersion: p.pinnedVersion } : {}),
        ...(p.scope !== undefined ? { scope: p.scope } : {}),
        ...(p.requiredSecretKeyIds !== undefined
          ? { requiredSecretKeyIds: p.requiredSecretKeyIds }
          : {}),
        ...(p.sessionMode !== undefined
          ? { source: { ...existing.source, sessionMode: p.sessionMode } }
          : {}),
      };
      if (p.marketplace !== undefined) {
        if (p.marketplace === null) {
          delete next.marketplace;
        } else {
          next.marketplace = p.marketplace;
        }
      }
      await surface.apply({ kind: 'linkedWorkspace.upsert', link: next });
      const stateAfterLink = await surface.read();
      const linkAfter = stateAfterLink.synced.linkedWorkspaces[parsed.id];
      if (linkAfter) {
        const newUri = ApicircleFsProvider.linkUri(decodeAuthority(parsed.workspaceId), linkAfter);
        void this.followRenameIfChanged(uri, newUri);
      }
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
      const stateAfterMock = await surface.read();
      const mockAfter = stateAfterMock.synced.mockServers[parsed.id];
      if (mockAfter) {
        const newUri = ApicircleFsProvider.mockUri(decodeAuthority(parsed.workspaceId), mockAfter);
        void this.followRenameIfChanged(uri, newUri);
      }
      this._onDidChangeFile.fire([{ type: vscode.FileChangeType.Changed, uri }]);
      return;
    }
    if (parsed.kind === 'endpoints') {
      let parsedYaml: ReturnType<typeof parseEndpointFromYaml>;
      try {
        parsedYaml = parseEndpointFromYaml(text);
      } catch (e) {
        if (e instanceof EndpointYamlParseError) {
          throw vscode.FileSystemError.NoPermissions(e.message);
        }
        throw e;
      }
      if (!parsed.parentMockId) {
        throw vscode.FileSystemError.NoPermissions(
          'Endpoint URI is missing the parent mock id — cannot save.',
        );
      }
      const state = await surface.read();
      const existing = state.synced.mockServers[parsed.parentMockId];
      if (!existing) {
        throw vscode.FileSystemError.FileNotFound(
          `Parent mock "${parsed.parentMockId}" no longer exists.`,
        );
      }
      const idx = existing.endpoints.findIndex((ep) => ep.id === parsed.id);
      if (idx === -1) {
        throw vscode.FileSystemError.FileNotFound(
          `Endpoint "${parsed.id}" is not part of mock "${existing.name}".`,
        );
      }
      const nextEndpoint = { id: parsed.id, ...parsedYaml.endpoint };
      const nextEndpoints = existing.endpoints.slice();
      nextEndpoints[idx] = nextEndpoint;
      await surface.apply({
        kind: 'mock.upsert',
        mock: {
          ...existing,
          endpoints: nextEndpoints,
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
      const stateAfterPlan = await surface.read();
      const planAfter = stateAfterPlan.local.executionPlans[parsed.id];
      if (planAfter) {
        const newUri = ApicircleFsProvider.planUri(decodeAuthority(parsed.workspaceId), planAfter);
        void this.followRenameIfChanged(uri, newUri);
      }
      this._onDidChangeFile.fire([{ type: vscode.FileChangeType.Changed, uri }]);
      return;
    }
    throw vscode.FileSystemError.NoPermissions(`Unsupported URI kind: ${String(parsed.kind)}`);
  }

  /**
   * When a save changes the entity's name (and therefore the slug-based URI),
   * reopen the document at the new URI in the same editor column and close
   * the stale tab. Best-effort: any thrown error is swallowed so a save can't
   * fail because tab manipulation hiccupped.
   */
  private async followRenameIfChanged(oldUri: vscode.Uri, newUri: vscode.Uri): Promise<void> {
    if (oldUri.toString() === newUri.toString()) return;
    const editors = vscode.window.visibleTextEditors.filter(
      (e) => e.document.uri.toString() === oldUri.toString(),
    );
    for (const editor of editors) {
      try {
        const doc = await vscode.workspace.openTextDocument(newUri);
        await vscode.window.showTextDocument(doc, {
          viewColumn: editor.viewColumn,
          preserveFocus: false,
          selection: editor.selection,
        });
      } catch {
        // Best-effort — VS Code may refuse to open in some edge cases (eg
        // workspace closing mid-save); the new URI is still navigable from
        // the TreeView, so we just give up on the tab swap.
      }
    }
    // The Tabs API landed in VS Code 1.66 and is the supported way to close
    // the old URI tab so the user only sees the renamed one. Guard against
    // hosts (or unit-test mocks) that don't expose it.
    const tabGroups = vscode.window.tabGroups as
      | {
          all: readonly { tabs: readonly vscode.Tab[] }[];
          close: (t: vscode.Tab[]) => Thenable<boolean>;
        }
      | undefined;
    if (!tabGroups) return;
    const oldTabs: vscode.Tab[] = [];
    for (const group of tabGroups.all) {
      for (const tab of group.tabs) {
        const input = tab.input;
        if (
          input !== null &&
          typeof input === 'object' &&
          'uri' in input &&
          (input as { uri: vscode.Uri }).uri.toString() === oldUri.toString()
        ) {
          oldTabs.push(tab);
        }
      }
    }
    if (oldTabs.length > 0) {
      try {
        await tabGroups.close(oldTabs);
      } catch {
        // No-op — the new tab is already focused; leaving the stale tab open
        // is ugly but not broken.
      }
    }
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
    if (parsed.kind === 'links') {
      // Deleting links/<slug>.link.yaml unlinks the workspace (cascades the
      // cached ledger, overrides, snapshot, and per-link session).
      return surface.apply({ kind: 'linkedWorkspace.remove', id: parsed.id }).then(() => {
        this._onDidChangeFile.fire([{ type: vscode.FileChangeType.Deleted, uri }]);
      });
    }
    if (parsed.kind === 'linkedRequests') {
      // Deleting a linked request resets it to source (drops the override).
      return surface
        .apply({
          kind: 'linkedOverride.removeRequest',
          linkedWorkspaceId: parsed.linkId ?? '',
          itemId: parsed.id,
        })
        .then(() => {
          this._onDidChangeFile.fire([{ type: vscode.FileChangeType.Changed, uri }]);
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

  /**
   * Build the canonical URI for a request. The URI shape is
   *
   *   apicircle://<wsAuth>/requests/<folderSlug>/<nameSlug>.req.yaml?id=<requestId>
   *
   * — the folder slug path mirrors the request's place in the collection tree
   * so the tab tooltip surfaces the folder breadcrumb, the `<nameSlug>` is
   * the basename VS Code uses for the tab label, and the `?id=` query is the
   * stable identity that survives name renames and folder moves.
   *
   * Collision strategy: when a sibling request in the same folder slugifies
   * to the same name, this request's slug is suffixed with `~<shortId>` so
   * the URIs remain unique without exposing the full id in the tab label.
   */
  static requestUri(
    workspaceId: string,
    request: ApiRequest,
    folders: Record<string, Folder>,
    siblings: Record<string, ApiRequest>,
  ): vscode.Uri {
    const folderSegments = computeFolderSlugPath(request.folderId, folders);
    const baseSlug = slugify(request.name) || 'untitled';
    const slug = disambiguateRequestSlug(baseSlug, request, siblings);
    const pathSegments = ['requests', ...folderSegments, `${slug}.req.yaml`];
    return vscode.Uri.from({
      scheme: SCHEME,
      authority: encodeAuthority(workspaceId),
      path: '/' + pathSegments.join('/'),
      query: `id=${encodeURIComponent(request.id)}`,
    });
  }

  /**
   * Build the canonical URI for a response document. The basename surfaces the
   * request name so multiple open response tabs are scannable; the `?runId=`
   * query is the stable lookup key into the FS provider's responseStore.
   */
  static responseUri(workspaceId: string, runId: string, requestName: string): vscode.Uri {
    const slug = slugify(requestName) || 'response';
    return vscode.Uri.from({
      scheme: SCHEME,
      authority: encodeAuthority(workspaceId),
      path: `/responses/${slug}.run.yaml`,
      query: `runId=${encodeURIComponent(runId)}`,
    });
  }

  /**
   * Build the canonical URI for the workspace-self release-ledger document.
   * There is exactly one per workspace, so the basename is stable (`releases`)
   * and no `?id=` query is needed.
   */
  static releasesUri(workspaceId: string): vscode.Uri {
    return vscode.Uri.from({
      scheme: SCHEME,
      authority: encodeAuthority(workspaceId),
      path: '/releases/releases.yaml',
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

  /**
   * Build the canonical URI for a history run-detail document. `label` becomes
   * the basename so the tab reads "Login.run.yaml" instead of "<runId>.run.yaml"
   * when the user has the history sidebar collapsed.
   */
  static historyUri(workspaceId: string, runId: string, label?: string): vscode.Uri {
    const slug = slugify(label ?? '') || 'run';
    return vscode.Uri.from({
      scheme: SCHEME,
      authority: encodeAuthority(workspaceId),
      path: `/history/${slug}.run.yaml`,
      query: `runId=${encodeURIComponent(runId)}`,
    });
  }

  /** Build the canonical URI for a plan YAML document. */
  static planUri(workspaceId: string, plan: ExecutionPlan): vscode.Uri {
    const slug = slugify(plan.name) || 'untitled-plan';
    return vscode.Uri.from({
      scheme: SCHEME,
      authority: encodeAuthority(workspaceId),
      path: `/plans/${slug}.plan.yaml`,
      query: `id=${encodeURIComponent(plan.id)}`,
    });
  }

  /**
   * Build the canonical URI for a linked-workspace YAML document. The link's
   * name is the slug (tab label); identity rides in `?id=` so a rename doesn't
   * break the tab.
   */
  static linkUri(workspaceId: string, link: LinkedWorkspace): vscode.Uri {
    const slug = slugify(link.name) || 'linked-workspace';
    return vscode.Uri.from({
      scheme: SCHEME,
      authority: encodeAuthority(workspaceId),
      path: `/links/${slug}.link.yaml`,
      query: `id=${encodeURIComponent(link.id)}`,
    });
  }

  /**
   * Build the canonical URI for a linked workspace's request (effective =
   * source + the consumer's override). The link slug + request slug are the
   * tab label; identity rides in `?link=&id=`.
   */
  static linkedRequestUri(
    workspaceId: string,
    link: LinkedWorkspace,
    request: ApiRequest,
  ): vscode.Uri {
    const linkSlug = slugify(link.name) || 'linked';
    const reqSlug = slugify(request.name) || 'request';
    return vscode.Uri.from({
      scheme: SCHEME,
      authority: encodeAuthority(workspaceId),
      path: `/linked/${linkSlug}/${reqSlug}.req.yaml`,
      query: `link=${encodeURIComponent(link.id)}&id=${encodeURIComponent(request.id)}`,
    });
  }

  /** Build the canonical URI for a mock-server YAML document. */
  static mockUri(workspaceId: string, mock: MockServer): vscode.Uri {
    const slug = slugify(mock.name) || 'untitled-mock';
    return vscode.Uri.from({
      scheme: SCHEME,
      authority: encodeAuthority(workspaceId),
      path: `/mocks/${slug}.mock.yaml`,
      query: `id=${encodeURIComponent(mock.id)}`,
    });
  }

  /**
   * Build the canonical URI for a per-endpoint YAML document. The mock slug
   * sits in the path so the tab tooltip surfaces the owning server, and both
   * the mock id and endpoint id ride in the query for parser routing.
   */
  static endpointUri(workspaceId: string, mock: MockServer, endpoint: MockEndpoint): vscode.Uri {
    const mockSlug = slugify(mock.name) || 'mock';
    const endpointSlug = slugify(endpoint.name) || 'endpoint';
    return vscode.Uri.from({
      scheme: SCHEME,
      authority: encodeAuthority(workspaceId),
      path: `/mocks/${mockSlug}/${endpointSlug}.endpoint.yaml`,
      query: `mockId=${encodeURIComponent(mock.id)}&id=${encodeURIComponent(endpoint.id)}`,
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
  const query = new URLSearchParams(uri.query || '');
  const segments = uri.path.split('/').filter(Boolean);
  if (segments.length < 2) {
    throw vscode.FileSystemError.FileNotFound(`Malformed URI path: ${uri.path}`);
  }
  const kind = segments[0];

  // The release ledger is workspace-scoped — one document, no `?id=` query.
  if (kind === 'releases') {
    return { workspaceId, kind: 'releases', id: '' };
  }

  // Linked request: /linked/<linkSlug>/<nameSlug>.req.yaml?link=<linkId>&id=<reqId>
  if (kind === 'linked') {
    const linkId = query.get('link') ?? '';
    const reqId = query.get('id') ?? '';
    if (!linkId || !reqId) {
      throw vscode.FileSystemError.FileNotFound(
        `Linked-request URI is missing ?link= or ?id= — got ${uri.toString()}`,
      );
    }
    return { workspaceId, kind: 'linkedRequests', id: reqId, linkId };
  }

  // Environments still encode the name as the basename — no `?id=` query.
  if (kind === 'environments') {
    if (segments.length !== 2) {
      throw vscode.FileSystemError.FileNotFound(`Unsupported environments URI: ${uri.path}`);
    }
    const rawId = path.basename(segments[1], path.extname(segments[1])).replace(/\.env$/, '');
    return { workspaceId, kind: 'environments', id: decodeURIComponent(rawId) };
  }

  // Endpoints: /mocks/<mockSlug>/<endpointSlug>.endpoint.yaml?mockId=<m>&id=<e>
  // Identity comes from the query so the slug can change with the endpoint
  // name without invalidating tabs.
  if (kind === 'mocks' && segments.length === 3 && segments[2].endsWith('.endpoint.yaml')) {
    const parentMockId = query.get('mockId') ?? '';
    const endpointId = query.get('id') ?? '';
    if (!parentMockId || !endpointId) {
      throw vscode.FileSystemError.FileNotFound(
        `Endpoint URI is missing ?mockId= or ?id= query — got ${uri.toString()}`,
      );
    }
    return { workspaceId, kind: 'endpoints', id: endpointId, parentMockId };
  }

  if (
    kind !== 'requests' &&
    kind !== 'responses' &&
    kind !== 'history' &&
    kind !== 'plans' &&
    kind !== 'mocks' &&
    kind !== 'links'
  ) {
    throw vscode.FileSystemError.FileNotFound(`Unsupported URI kind: ${kind}`);
  }

  // Identity lookup keys are `id` for entities, `runId` for transient run
  // documents. Either is required — without one the FS provider can't route.
  const id = query.get('id') ?? query.get('runId') ?? '';
  if (!id) {
    throw vscode.FileSystemError.FileNotFound(
      `URI is missing ?id= (or ?runId=) — got ${uri.toString()}`,
    );
  }
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

// -----------------------------------------------------------------------------
// Slug + folder-path helpers — produce URI path segments that VS Code surfaces
// as the tab label, with the entity id riding in `?id=` so identity survives
// renames. Exported for tests; not for general consumption.
// -----------------------------------------------------------------------------

/**
 * Render `name` as a URI-safe slug. Strips characters that are illegal on
 * Windows file systems (`\ / : * ? " < > |`), collapses whitespace to `-`,
 * trims trailing dots, and caps the length so a very long name doesn't
 * blow out the tab title.
 *
 * Case is preserved so `Login` reads as `Login` in the tab, not `login`.
 * An empty input returns `''` — callers fall back to a kind-specific default
 * (e.g. `untitled`) so the URI is never path-zero.
 */
export function slugify(name: string): string {
  return name
    .trim()
    .replace(/[\\/:*?"<>|]/g, '_')
    .replace(/\s+/g, '-')
    .replace(/\.+$/g, '')
    .slice(0, 80);
}

/**
 * Walk up the folder chain from `folderId` and return the slugified names from
 * root → leaf. Returns `[]` for root-level entities. Cycle-safe: a corrupt
 * folder map with a parent loop stops at the first revisited node.
 */
export function computeFolderSlugPath(
  folderId: string | null | undefined,
  folders: Record<string, Folder>,
): string[] {
  if (!folderId) return [];
  const chain: string[] = [];
  const visited = new Set<string>();
  let current: Folder | undefined = folders[folderId];
  while (current && !visited.has(current.id)) {
    visited.add(current.id);
    chain.unshift(slugify(current.name) || 'untitled-folder');
    current = current.parentId ? folders[current.parentId] : undefined;
  }
  return chain;
}

/**
 * When two requests in the same folder slugify to the same string the URIs
 * would collide — and VS Code would refuse to open a second tab for the
 * second request. Detect that case and suffix the slug with `~<shortId>` so
 * the URI is unique without exposing the full request id in the tab.
 */
export function disambiguateRequestSlug(
  baseSlug: string,
  request: ApiRequest,
  siblings: Record<string, ApiRequest>,
): string {
  for (const other of Object.values(siblings)) {
    if (other.id === request.id) continue;
    if ((other.folderId ?? null) !== (request.folderId ?? null)) continue;
    if (slugify(other.name) === baseSlug) {
      return `${baseSlug}~${request.id.slice(0, 8)}`;
    }
  }
  return baseSlug;
}

export { encodeAuthority as __encodeAuthorityForTests };
