import * as vscode from 'vscode';

// =============================================================================
// InFlightPlanTracker — maps a plan id to the in-flight run currently
// executing for it.
//
// The plan-side mirror of `InFlightSendTracker`. `runPlanCommand` registers a
// planId → runId entry the moment it kicks off `runPlan` and clears the entry
// on completion / cancel / error. The plan CodeLens provider subscribes to
// onDidChange and swaps the "▶ Run…" rows for "⏳ Running… · ✖ Cancel" so the
// user sees that the click landed and can abort the whole run without hunting
// for the progress notification — the same affordance a request send gets.
//
// Keyed by the STABLE plan id (not the name-slug URI the request tracker uses)
// so a plan rename between launch and render can't make the lens/cancel lookup
// miss — the CodeLens + cancel command both recover the id from the document
// URI's `?id=` query.
// =============================================================================

export interface InFlightPlanRun {
  runId: string;
  startedAt: number;
  planName: string;
}

export class InFlightPlanTracker implements vscode.Disposable {
  private readonly entries = new Map<string, InFlightPlanRun>();
  private readonly _onDidChange = new vscode.EventEmitter<void>();
  readonly onDidChange: vscode.Event<void> = this._onDidChange.event;

  start(planId: string, runId: string, planName: string): void {
    this.entries.set(planId, { runId, startedAt: Date.now(), planName });
    this._onDidChange.fire();
  }

  end(planId: string): void {
    if (this.entries.delete(planId)) {
      this._onDidChange.fire();
    }
  }

  get(planId: string): InFlightPlanRun | undefined {
    return this.entries.get(planId);
  }

  isInFlight(planId: string): boolean {
    return this.entries.has(planId);
  }

  hasAny(): boolean {
    return this.entries.size > 0;
  }

  /** Test/inspection hook — snapshot of current entries. */
  snapshot(): ReadonlyMap<string, InFlightPlanRun> {
    return new Map(this.entries);
  }

  dispose(): void {
    this.entries.clear();
    this._onDidChange.dispose();
  }
}
