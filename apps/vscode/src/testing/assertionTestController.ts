import * as vscode from 'vscode';
import { executeRequest, runAssertions, type AssertionResult } from '@apicircle/core';
import type { Request as ApiRequest, Folder } from '@apicircle/shared';
import type { VsCodeBridge, WorkspaceSurface } from '../host/vscodeBridge';

// =============================================================================
// Phase 9 — Assertion Test Controller.
//
// Surfaces every request-with-assertions in the active workspace under VS
// Code's native Testing tab. Each request becomes a TestItem whose children
// are the individual assertions; running an item sends the request and emits
// per-assertion pass/fail through the TestRun API.
//
// Hierarchy (mirrors the workspace's folder tree):
//
//   APICircle / <workspace label>
//     ▸ <folder name>
//        ▸ <Request name>             [request-level item]
//           ✓ status equals 200       [per-assertion item]
//           ✓ duration lt 500
//           ✗ json-path $.id matches /^u_/
//
// Items are addressed by stable string IDs:
//   request item:   "req:<requestId>"
//   assertion item: "assertion:<requestId>:<assertionId>"
//   folder item:    "folder:<folderId|root>"
//
// Refresh strategy: the controller re-discovers from scratch on every
// `workspace change` event the bridge fires. This is simpler than diffing
// the tree on each patch and reflects exactly what the user just changed.
//
// Skipped tests: a request with `assertions: []` is NOT surfaced at all
// (there's nothing to assert). A workspace with zero assertion-bearing
// requests results in an empty Testing tab — VS Code's native empty state
// handles that.
// =============================================================================

export interface AssertionTestControllerDeps {
  bridge: VsCodeBridge;
  /** Test-only override hook — defaults to core's `executeRequest`. */
  execute?: typeof executeRequest;
  log?: (msg: string) => void;
}

const REFRESH_DEBOUNCE_MS = 100;

export class AssertionTestController implements vscode.Disposable {
  static readonly controllerId = 'apicircle-assertions';
  static readonly controllerLabel = 'APICircle Assertions';

  private readonly controller: vscode.TestController;
  private readonly bridge: VsCodeBridge;
  private readonly execute: typeof executeRequest;
  private readonly log: (msg: string) => void;
  private readonly disposables: vscode.Disposable[] = [];
  private refreshTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(deps: AssertionTestControllerDeps) {
    this.bridge = deps.bridge;
    this.execute = deps.execute ?? executeRequest;
    this.log = deps.log ?? (() => undefined);

    this.controller = vscode.tests.createTestController(
      AssertionTestController.controllerId,
      AssertionTestController.controllerLabel,
    );

    // Default run profile — handles "Run Tests" + per-item runs.
    this.controller.createRunProfile(
      'Run Assertions',
      vscode.TestRunProfileKind.Run,
      (request, token) => {
        void this.runHandler(request, token);
      },
      /* isDefault */ true,
    );

    // Subscribe to bridge events for live refresh on workspace activation +
    // external writes. The refresh is debounced so a series of patches
    // (e.g. a Git pull) only triggers one re-discovery pass.
    this.disposables.push(this.bridge.onDidChangeActiveWorkspace(() => this.scheduleRefresh()));

    // Initial discovery.
    this.scheduleRefresh();
  }

  dispose(): void {
    if (this.refreshTimer) clearTimeout(this.refreshTimer);
    for (const d of this.disposables) d.dispose();
    this.controller.dispose();
  }

  /** Public so the activation layer can force a refresh after registering
   *  a new workspace (the bridge event fires AFTER the workspace is added). */
  forceRefresh(): void {
    if (this.refreshTimer) {
      clearTimeout(this.refreshTimer);
      this.refreshTimer = null;
    }
    void this.refresh();
  }

  private scheduleRefresh(): void {
    if (this.refreshTimer) clearTimeout(this.refreshTimer);
    this.refreshTimer = setTimeout(() => {
      this.refreshTimer = null;
      void this.refresh();
    }, REFRESH_DEBOUNCE_MS);
  }

  // ---------------------------------------------------------------------------
  // Discovery
  // ---------------------------------------------------------------------------

  private async refresh(): Promise<void> {
    const surfaces = this.bridge.listWorkspaces();
    const roots: vscode.TestItem[] = [];
    for (const surface of surfaces) {
      try {
        const state = await surface.read();
        const root = this.buildWorkspaceRoot(surface, state);
        if (root) roots.push(root);
      } catch (err) {
        this.log(
          `discovery for workspace ${surface.workspace.id} failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
    this.controller.items.replace(roots);
  }

  private buildWorkspaceRoot(
    surface: WorkspaceSurface,
    state: Awaited<ReturnType<WorkspaceSurface['read']>>,
  ): vscode.TestItem | null {
    const requests: Record<string, ApiRequest> = state.synced.collections.requests;
    const folders: Record<string, Folder> = state.synced.collections.folders;
    const assertedRequestIds = Object.keys(requests).filter(
      (id) => (requests[id]?.assertions?.length ?? 0) > 0,
    );
    // Skip workspaces with no assertion-bearing requests — saves noise.
    if (assertedRequestIds.length === 0) return null;

    const rootId = `workspace:${surface.workspace.id}`;
    const rootItem = this.controller.createTestItem(
      rootId,
      surface.workspace.label || surface.workspace.id,
    );

    // Group requests by folderId. The shared `Folder` type has `parentId`
    // for nesting; for Phase 9's first cut we flatten one level (folder →
    // request). Deeper nesting follows the bridge's existing tree walk.
    const requestsByFolder = new Map<string | null, ApiRequest[]>();
    for (const id of assertedRequestIds) {
      const r = requests[id];
      const folderId = r.folderId ?? null;
      const list = requestsByFolder.get(folderId) ?? [];
      list.push(r);
      requestsByFolder.set(folderId, list);
    }

    for (const [folderId, reqList] of requestsByFolder) {
      const folderItem =
        folderId === null
          ? null
          : this.controller.createTestItem(
              `folder:${folderId}`,
              folders[folderId]?.name ?? '(unknown folder)',
            );
      const parent = folderItem ?? rootItem;
      for (const req of reqList) {
        const reqItem = this.controller.createTestItem(
          `req:${req.id}`,
          `${req.method} ${req.name}`,
        );
        // Per-assertion child items.
        for (const a of req.assertions) {
          const aItem = this.controller.createTestItem(
            `assertion:${req.id}:${a.id}`,
            formatAssertionLabel(a),
          );
          reqItem.children.add(aItem);
        }
        parent.children.add(reqItem);
      }
      if (folderItem) rootItem.children.add(folderItem);
    }

    return rootItem;
  }

  // ---------------------------------------------------------------------------
  // Run handler
  // ---------------------------------------------------------------------------

  private async runHandler(
    request: vscode.TestRunRequest,
    token: vscode.CancellationToken,
  ): Promise<void> {
    const run = this.controller.createTestRun(request);
    // Collect ALL request items in scope, expanding from whatever items
    // the user selected. If the user clicked the run-all-tests button,
    // `request.include` is undefined → expand from the root.
    const requestItems: vscode.TestItem[] = [];
    const seed = request.include?.slice() ?? this.collectRootItems();
    for (const item of seed) {
      this.collectRequestItems(item, requestItems);
    }

    for (const reqItem of requestItems) {
      if (token.isCancellationRequested) {
        run.skipped(reqItem);
        continue;
      }
      await this.runOneRequest(reqItem, run, token);
    }
    run.end();
  }

  private collectRootItems(): vscode.TestItem[] {
    const out: vscode.TestItem[] = [];
    this.controller.items.forEach((item) => out.push(item));
    return out;
  }

  /** Recursively flatten down to request-level items (skip assertions —
   *  those are children of requests and run as part of the request). */
  private collectRequestItems(item: vscode.TestItem, out: vscode.TestItem[]): void {
    if (item.id.startsWith('req:')) {
      out.push(item);
      return;
    }
    item.children.forEach((child) => this.collectRequestItems(child, out));
  }

  private async runOneRequest(
    reqItem: vscode.TestItem,
    run: vscode.TestRun,
    token: vscode.CancellationToken,
  ): Promise<void> {
    const requestId = reqItem.id.slice('req:'.length);
    const surface = this.findOwningSurface(reqItem);
    if (!surface) {
      run.failed(reqItem, new vscode.TestMessage('Owning workspace not found.'));
      return;
    }
    const state = await surface.read();
    const apiRequest: ApiRequest | undefined = state.synced.collections.requests[requestId];
    if (!apiRequest) {
      run.failed(
        reqItem,
        new vscode.TestMessage(`Request ${requestId} was deleted since the test tree was built.`),
      );
      return;
    }

    run.started(reqItem);
    // Each assertion's row should also report started — VS Code uses
    // 'started' to render the spinner alongside the row.
    reqItem.children.forEach((child) => run.started(child));

    const cfg = vscode.workspace.getConfiguration('apicircle');
    const timeoutMs = cfg.get<number>('execution.timeoutMs', 30000);
    const abort = new AbortController();
    const tokenSub = token.onCancellationRequested(() => abort.abort());

    let execResult;
    try {
      execResult = await this.execute(apiRequest, { signal: abort.signal, timeoutMs });
    } catch (err) {
      tokenSub.dispose();
      const msg = err instanceof Error ? err.message : String(err);
      this.log(`request ${requestId} send failed: ${msg}`);
      run.failed(reqItem, new vscode.TestMessage(`Send failed: ${msg}`));
      reqItem.children.forEach((child) => run.skipped(child));
      return;
    }
    tokenSub.dispose();

    const verdicts: AssertionResult[] = runAssertions(apiRequest.assertions, execResult);
    // Map verdicts back to child items by assertionId.
    const verdictByAssertion = new Map<string, AssertionResult>();
    for (const v of verdicts) verdictByAssertion.set(v.assertionId, v);

    let anyFailed = false;
    reqItem.children.forEach((child) => {
      const assertionId = child.id.slice(`assertion:${requestId}:`.length);
      const v = verdictByAssertion.get(assertionId);
      if (!v) {
        run.skipped(child);
        return;
      }
      if (v.passed) {
        run.passed(child);
      } else {
        anyFailed = true;
        run.failed(
          child,
          new vscode.TestMessage(v.detail ?? `${v.kind} ${v.op} ${String(v.expected)} — failed`),
        );
      }
    });

    if (anyFailed) {
      run.failed(
        reqItem,
        new vscode.TestMessage(
          `${verdicts.filter((v) => !v.passed).length}/${verdicts.length} assertions failed.`,
        ),
      );
    } else {
      run.passed(reqItem);
    }
  }

  /** Walks up the tree to find the workspace ancestor's surface. The
   *  Testing tab doesn't give us the surface directly — we infer from
   *  the root TestItem's `workspace:<id>` prefix. */
  private findOwningSurface(item: vscode.TestItem): WorkspaceSurface | null {
    let cur: vscode.TestItem | undefined = item;
    while (cur) {
      if (cur.id.startsWith('workspace:')) {
        const wsId = cur.id.slice('workspace:'.length);
        return this.bridge.listWorkspaces().find((s) => s.workspace.id === wsId) ?? null;
      }
      cur = cur.parent;
    }
    // Fallback: single-workspace case — return the only surface.
    const surfaces = this.bridge.listWorkspaces();
    return surfaces.length === 1 ? surfaces[0] : null;
  }
}

function formatAssertionLabel(a: {
  kind: string;
  op: string;
  target?: string;
  expected: string | number;
}): string {
  const target = a.target ? ` ${a.target}` : '';
  return `${a.kind}${target} ${a.op} ${String(a.expected)}`;
}
