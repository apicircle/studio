import * as vscode from 'vscode';
import { executeRequest, runAssertions, type AssertionResult } from '@apicircle/core';
import type { Request as ApiRequest } from '@apicircle/shared';
import type { VsCodeBridge, WorkspaceSurface } from '../host/vscodeBridge';
import { parseStepCellDirective } from './planNotebookSerializer';

// =============================================================================
// Phase 9 — Plan Notebook controller.
//
// One controller registered per notebook content type (`apicircle-plan`).
// Drives cell execution via the existing `@apicircle/core` engine:
//
//   1. For each cell the user runs (or "Run All"), parse the
//      `# apicircle-plan-step: <requestId>` directive line to find the
//      target request.
//   2. Look up the request in the notebook's referenced workspace
//      (cell metadata.requestId / notebook metadata.workspaceId).
//   3. Call `executeRequest` with the same `{signal, timeoutMs}` shape
//      `sendRequestCommand` uses. Skip disabled cells.
//   4. Run assertions if the request has any; emit a structured
//      NotebookCellOutput with status (✓/✗/skip) + summary.
//   5. On per-cell cancel (the Stop button in VS Code's notebook UI),
//      forward the AbortSignal via `execution.token`.
//
// History persistence is INTENTIONALLY skipped here — notebooks are a
// scratchpad surface; persisting every cell run would flood the
// HistoryView. Users who want a recorded run should use **Run Plan**
// from the ExecutionView (the existing P2 surface).
// =============================================================================

export interface PlanNotebookControllerDeps {
  bridge: VsCodeBridge;
  /** Test-only override — defaults to core's `executeRequest`. */
  execute?: typeof executeRequest;
  /** Diagnostic sink — same pattern as the other command modules. */
  log?: (msg: string) => void;
}

export class PlanNotebookController implements vscode.Disposable {
  static readonly controllerId = 'apicircle-plan-runner';
  static readonly viewType = 'apicircle-plan';

  private readonly controller: vscode.NotebookController;
  private readonly bridge: VsCodeBridge;
  private readonly execute: typeof executeRequest;
  private readonly log: (msg: string) => void;

  constructor(deps: PlanNotebookControllerDeps) {
    this.bridge = deps.bridge;
    this.execute = deps.execute ?? executeRequest;
    this.log = deps.log ?? (() => undefined);

    this.controller = vscode.notebooks.createNotebookController(
      PlanNotebookController.controllerId,
      PlanNotebookController.viewType,
      'APICircle Plan Runner',
    );
    this.controller.supportedLanguages = ['apicircle-plan-step', 'markdown'];
    this.controller.supportsExecutionOrder = true;
    this.controller.description = 'Sends each cell as the referenced APICircle request.';
    this.controller.executeHandler = (cells, notebook, ctrl) => {
      void this.executeAll(cells, notebook, ctrl);
    };
  }

  dispose(): void {
    this.controller.dispose();
  }

  private async executeAll(
    cells: vscode.NotebookCell[],
    notebook: vscode.NotebookDocument,
    _ctrl: vscode.NotebookController,
  ): Promise<void> {
    const notebookMd = (notebook.metadata ?? {}) as { workspaceId?: string; planId?: string };
    const workspaceId = notebookMd.workspaceId;
    if (!workspaceId) {
      // Without a workspace anchor we can't look up requests. Surface
      // the error on every cell the user tried to run rather than
      // silently no-op.
      for (const cell of cells) {
        const exec = this.controller.createNotebookCellExecution(cell);
        exec.start(Date.now());
        await this.emitError(
          exec,
          'Plan notebook has no `workspaceId` metadata. Was it created with the **Open Plan as Notebook** command?',
        );
        exec.end(false, Date.now());
      }
      return;
    }
    const surface = this.bridge.listWorkspaces().find((s) => s.workspace.id === workspaceId);
    if (!surface) {
      for (const cell of cells) {
        const exec = this.controller.createNotebookCellExecution(cell);
        exec.start(Date.now());
        await this.emitError(
          exec,
          `Workspace \`${workspaceId}\` is not registered in this VS Code session. Open the workspace folder containing its \`.apicircle/\` directory and retry.`,
        );
        exec.end(false, Date.now());
      }
      return;
    }

    // Read the workspace state ONCE up front. Running cells in series
    // against a fresh read avoids the cost of N reads when the user
    // hits "Run All" on a large plan.
    const state = await surface.read();

    for (const cell of cells) {
      await this.executeCell(cell, surface, state);
    }
  }

  private async executeCell(
    cell: vscode.NotebookCell,
    surface: WorkspaceSurface,
    state: Awaited<ReturnType<WorkspaceSurface['read']>>,
  ): Promise<void> {
    const exec = this.controller.createNotebookCellExecution(cell);
    exec.start(Date.now());

    // Skip non-code cells silently (markdown explanations etc.).
    if (cell.kind !== vscode.NotebookCellKind.Code) {
      exec.end(true, Date.now());
      return;
    }

    const directive = parseStepCellDirective(cell.document.getText());
    const cellMd = (cell.metadata ?? {}) as { requestId?: string; enabled?: boolean };
    const requestId = directive?.requestId ?? cellMd.requestId;
    if (!requestId) {
      await this.emitError(
        exec,
        'Cell is missing the `# apicircle-plan-step: <requestId>` directive.',
      );
      exec.end(false, Date.now());
      return;
    }

    // Honour `enabled: false` — emit a skip output rather than running.
    const enabled = directive?.enabled ?? cellMd.enabled;
    if (enabled === false) {
      await this.emitInfo(exec, '⊘ Skipped (step disabled)');
      exec.end(true, Date.now());
      return;
    }

    const request: ApiRequest | undefined = state.synced.collections.requests[requestId];
    if (!request) {
      await this.emitError(
        exec,
        `Request \`${requestId}\` was not found in the workspace. It may have been deleted since this notebook was created.`,
      );
      exec.end(false, Date.now());
      return;
    }

    // Resolve execution settings the same way sendRequestCommand does.
    const cfg = vscode.workspace.getConfiguration('apicircle');
    const timeoutMs = cfg.get<number>('execution.timeoutMs', 30000);

    // Wire the cell's cancel button through to the AbortSignal.
    const abort = new AbortController();
    exec.token.onCancellationRequested(() => abort.abort());

    let result;
    try {
      result = await this.execute(request, { signal: abort.signal, timeoutMs });
    } catch (err) {
      if (abort.signal.aborted) {
        await this.emitInfo(exec, '⊘ Cancelled');
        exec.end(false, Date.now());
        return;
      }
      const msg = err instanceof Error ? err.message : String(err);
      this.log(`cell ${requestId} execute failed: ${msg}`);
      await this.emitError(exec, `Execute failed: ${msg}`);
      exec.end(false, Date.now());
      return;
    }

    let verdicts: AssertionResult[] | undefined;
    if (request.assertions.length > 0) {
      verdicts = runAssertions(request.assertions, result);
    }

    const allPassed = !verdicts || verdicts.every((v) => v.passed);
    await this.emitRunOutput(exec, request, result, verdicts);
    exec.end(allPassed, Date.now());
  }

  // ---------------------------------------------------------------------------
  // Output helpers
  // ---------------------------------------------------------------------------

  private async emitRunOutput(
    exec: vscode.NotebookCellExecution,
    request: ApiRequest,
    result: {
      status: number | null;
      statusText: string;
      durationMs: number;
      body?: { text?: string } | string;
    },
    verdicts: AssertionResult[] | undefined,
  ): Promise<void> {
    const statusBadge = verdicts ? (verdicts.every((v) => v.passed) ? '✓' : '✗') : '·';
    const statusLine =
      result.status === null
        ? `  (no response — network error or aborted) (${result.durationMs}ms)`
        : `  ${result.status} ${result.statusText} (${result.durationMs}ms)`;
    const headerLines = [`${statusBadge} ${request.method} ${request.url}`, statusLine];
    if (verdicts && verdicts.length > 0) {
      headerLines.push(
        `  Assertions: ${verdicts.filter((v) => v.passed).length}/${verdicts.length} passed`,
      );
      for (const v of verdicts) {
        const label = formatAssertionLabel(v);
        headerLines.push(`    ${v.passed ? '✓' : '✗'} ${label}`);
        if (!v.passed && v.detail) {
          headerLines.push(`        ${v.detail}`);
        }
      }
    }
    const header = headerLines.join('\n');

    // Pull the response body for the second output item — JSON if it
    // parses, otherwise the raw text.
    const bodyText = extractBodyText(result.body);
    const bodyItems: vscode.NotebookCellOutputItem[] = [];
    if (bodyText) {
      try {
        const parsed: unknown = JSON.parse(bodyText);
        bodyItems.push(vscode.NotebookCellOutputItem.json(parsed));
      } catch {
        bodyItems.push(vscode.NotebookCellOutputItem.text(bodyText));
      }
    }

    const outputs: vscode.NotebookCellOutput[] = [
      new vscode.NotebookCellOutput([vscode.NotebookCellOutputItem.text(header)]),
    ];
    if (bodyItems.length > 0) {
      outputs.push(new vscode.NotebookCellOutput(bodyItems));
    }
    await exec.replaceOutput(outputs);
  }

  private async emitError(exec: vscode.NotebookCellExecution, msg: string): Promise<void> {
    await exec.replaceOutput([
      new vscode.NotebookCellOutput([vscode.NotebookCellOutputItem.error(new Error(msg))]),
    ]);
  }

  private async emitInfo(exec: vscode.NotebookCellExecution, msg: string): Promise<void> {
    await exec.replaceOutput([
      new vscode.NotebookCellOutput([vscode.NotebookCellOutputItem.text(msg)]),
    ]);
  }
}

// ---------------------------------------------------------------------------
// Misc helpers
// ---------------------------------------------------------------------------

function extractBodyText(body: unknown): string | null {
  if (!body) return null;
  if (typeof body === 'string') return body;
  if (typeof body === 'object' && body !== null && 'text' in body) {
    const t = (body as { text?: unknown }).text;
    if (typeof t === 'string') return t;
  }
  return null;
}

function formatAssertionLabel(v: AssertionResult): string {
  const target = v.target ? ` ${v.target}` : '';
  return `${v.kind}${target} ${v.op} ${String(v.expected)}`;
}
