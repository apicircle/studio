import * as vscode from 'vscode';
import type { InFlightPlanTracker } from '../execute/inFlightPlanTracker';
import { uriEntityKind } from '../fs/uriKind';

// =============================================================================
// CodeLens provider for apicircle-plan YAML documents — PLAN-LEVEL actions only.
//
// Above the `name:` line:
//   ▶ Run with assertions   ▶ Run   ◆ Plan environments…
//   (or — while a run is in flight — ⏳ Running… (<elapsed>) · ✖ Cancel)
//
// Above the `steps:` line:
//   ✚ Add step…
//
// There are deliberately NO per-step CodeLenses. Each step row already carries a
// `# <name> · <METHOD> · <folder>` comment (written by the serializer), so a
// parallel lens row repeating the name next to the requestId was just visual
// noise. The per-step actions — Open / Enable-Disable / Change / Remove — live on
// the step nodes in the Execution TreeView instead (single-click opens the
// request; inline buttons + the right-click menu do the rest).
//
// Identity rides in the URI's `?id=` query (the path basename is a name slug),
// so the run / env lenses target the exact plan after a rename. When a run is in
// flight the InFlightPlanTracker drives a 1s tick so the elapsed counter stays
// fresh without waking VS Code when nothing is running.
// =============================================================================

const NAME_LINE_RE = /^name\s*:/;
const STEPS_LINE_RE = /^steps\s*:/;

export class PlanCodeLensProvider implements vscode.CodeLensProvider {
  private readonly _onDidChange = new vscode.EventEmitter<void>();
  readonly onDidChangeCodeLenses: vscode.Event<void> = this._onDidChange.event;
  private tickHandle: ReturnType<typeof setInterval> | null = null;
  private readonly subs: vscode.Disposable[] = [];

  constructor(private readonly tracker?: InFlightPlanTracker) {
    if (tracker) {
      this.subs.push(
        tracker.onDidChange(() => {
          this.refresh();
          this.updateTick();
        }),
      );
    }
  }

  provideCodeLenses(
    document: vscode.TextDocument,
    _token: vscode.CancellationToken,
  ): vscode.CodeLens[] {
    if (document.uri.scheme !== 'apicircle') return [];
    if (uriEntityKind(document.uri) !== 'plan') return [];

    const planId = extractPlanId(document.uri);
    if (!planId) return [];

    const { nameLine, stepsLine } = parsePlanDocument(document);
    const lenses: vscode.CodeLens[] = [];

    // --- name line: run / env / cancel ---
    if (nameLine !== -1) {
      const text = document.lineAt(nameLine).text;
      const range = new vscode.Range(nameLine, 0, nameLine, text.length);
      const inFlight = this.tracker?.get(planId);
      if (inFlight) {
        const elapsedSec = Math.max(0, (Date.now() - inFlight.startedAt) / 1000);
        lenses.push(
          new vscode.CodeLens(range, {
            title: `⏳ Running… (${formatElapsed(elapsedSec)})`,
            tooltip: 'This plan is running. Click ✖ Cancel to abort the run.',
            command: 'apicircle.cancelPlanRun',
            arguments: [document.uri],
          }),
          new vscode.CodeLens(range, {
            title: '✖ Cancel',
            tooltip: 'Abort the in-flight plan run (the current request and remaining steps).',
            command: 'apicircle.cancelPlanRun',
            arguments: [document.uri],
          }),
        );
      } else {
        lenses.push(
          new vscode.CodeLens(range, {
            title: '▶ Run with assertions',
            tooltip: "Run the plan and evaluate each step's assertions.",
            command: 'apicircle.runPlan',
            arguments: [{ kind: 'plan', id: planId, withAssertions: true }],
          }),
          new vscode.CodeLens(range, {
            title: '▶ Run',
            tooltip: 'Run the plan without evaluating assertions.',
            command: 'apicircle.runPlan',
            arguments: [{ kind: 'plan', id: planId, withAssertions: false }],
          }),
          new vscode.CodeLens(range, {
            title: '◆ Plan environments…',
            tooltip: "Set this plan's environment priority order.",
            command: 'apicircle.setPlanEnvPriority',
            arguments: [{ kind: 'plan', id: planId }],
          }),
        );
      }
    }

    // --- steps: line: add a step ---
    if (stepsLine !== -1) {
      const text = document.lineAt(stepsLine).text;
      lenses.push(
        new vscode.CodeLens(new vscode.Range(stepsLine, 0, stepsLine, text.length), {
          title: '✚ Add step…',
          tooltip:
            'Append requests to this plan — a multi-select picker that hides already-added requests.',
          command: 'apicircle.addStepToPlan',
          arguments: [{ kind: 'plan', id: planId }],
        }),
      );
    }

    return lenses;
  }

  private updateTick(): void {
    if (!this.tracker) return;
    if (this.tracker.hasAny() && this.tickHandle === null) {
      // 1s cadence keeps the elapsed counter fresh while a run is in flight,
      // without spamming refreshes when nothing is running.
      this.tickHandle = setInterval(() => this.refresh(), 1000);
    } else if (!this.tracker.hasAny() && this.tickHandle !== null) {
      clearInterval(this.tickHandle);
      this.tickHandle = null;
    }
  }

  refresh(): void {
    this._onDidChange.fire();
  }

  dispose(): void {
    if (this.tickHandle !== null) {
      clearInterval(this.tickHandle);
      this.tickHandle = null;
    }
    for (const s of this.subs) s.dispose();
    this._onDidChange.dispose();
  }
}

/** Locate the top-level `name:` and `steps:` lines (the only anchors the
 *  plan-level lenses need). Both regexes anchor at column 0, so nested step
 *  rows never match. */
function parsePlanDocument(document: vscode.TextDocument): {
  nameLine: number;
  stepsLine: number;
} {
  let nameLine = -1;
  let stepsLine = -1;
  for (let line = 0; line < document.lineCount; line++) {
    const text = document.lineAt(line).text;
    if (nameLine === -1 && NAME_LINE_RE.test(text)) nameLine = line;
    else if (stepsLine === -1 && STEPS_LINE_RE.test(text)) stepsLine = line;
    if (nameLine !== -1 && stepsLine !== -1) break;
  }
  return { nameLine, stepsLine };
}

function formatElapsed(seconds: number): string {
  if (seconds < 10) return `${seconds.toFixed(1)}s`;
  return `${Math.round(seconds)}s`;
}

function extractPlanId(uri: vscode.Uri): string | undefined {
  // Identity lives in the `?id=<planId>` query (see ApicircleFsProvider.planUri).
  const id = new URLSearchParams(uri.query || '').get('id');
  return id ?? undefined;
}
