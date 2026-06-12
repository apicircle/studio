import * as vscode from 'vscode';

// =============================================================================
// InFlightSendTracker — maps an active apicircle: request URI to the in-flight
// run currently executing for it.
//
// `sendRequest` registers a URI → runId entry the moment it kicks off
// executeRequest and clears the entry on completion / cancel / error. The
// request CodeLens provider subscribes to onDidChange and swaps the
// "▶ Send" row for "⏳ Sending… · ✖ Cancel" so the user sees that the click
// landed and can abort without hunting for the status bar item.
//
// Keyed by `uri.toString()` so callers can do simple `isInFlight(uri)` checks
// regardless of how VS Code reconstructed the URI on its way through the
// CodeLens API.
// =============================================================================

export interface InFlightSend {
  runId: string;
  startedAt: number;
  requestName: string;
}

export class InFlightSendTracker implements vscode.Disposable {
  private readonly entries = new Map<string, InFlightSend>();
  private readonly _onDidChange = new vscode.EventEmitter<void>();
  readonly onDidChange: vscode.Event<void> = this._onDidChange.event;

  start(uri: vscode.Uri, runId: string, requestName: string): void {
    this.entries.set(uri.toString(), { runId, startedAt: Date.now(), requestName });
    this._onDidChange.fire();
  }

  end(uri: vscode.Uri): void {
    if (this.entries.delete(uri.toString())) {
      this._onDidChange.fire();
    }
  }

  get(uri: vscode.Uri): InFlightSend | undefined {
    return this.entries.get(uri.toString());
  }

  isInFlight(uri: vscode.Uri): boolean {
    return this.entries.has(uri.toString());
  }

  hasAny(): boolean {
    return this.entries.size > 0;
  }

  /** Test/inspection hook — snapshot of current entries. */
  snapshot(): ReadonlyMap<string, InFlightSend> {
    return new Map(this.entries);
  }

  dispose(): void {
    this.entries.clear();
    this._onDidChange.dispose();
  }
}
