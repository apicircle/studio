import * as vscode from 'vscode';
import type { BridgeSubscription, VsCodeBridge } from '../host/vscodeBridge';
import type { ChangeSubscription, VsCodeMockController } from '../host/vscodeMockController';

// =============================================================================
// MockStatusBar — left-side status bar item summarising mock runtime.
//
// States:
//   • Hidden when no mocks are running.
//   • Visible "$(server) Mocks: 1 (:3000)" when one is running.
//   • Visible "$(server) Mocks: 3 (:3000, :3001, +1)" when three+.
//
// Click → focus the Mock view.
//
// Refreshes via a cheap 1-second poll while at least one mock is running.
// When the count drops to zero, the poll pauses (P3R1-G11) and resumes
// only after the next external nudge (a workspace-watcher event or an
// explicit refresh() call from the mock-lifecycle commands).
// =============================================================================

const REFRESH_INTERVAL_MS = 1000;

export class MockStatusBar implements vscode.Disposable {
  private readonly item: vscode.StatusBarItem;
  private timer: ReturnType<typeof setInterval> | null = null;
  private controllerSub: ChangeSubscription | null = null;
  private bridgeSub: BridgeSubscription | null = null;

  constructor(
    private readonly bridge: VsCodeBridge,
    /** Optional — when provided, the status bar subscribes to controller
     * lifecycle events so it refreshes on start/stop/restart immediately
     * instead of waiting for the next watcher tick. P3R2-G1. */
    controller?: VsCodeMockController,
  ) {
    this.item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 99);
    // Use the built-in `<viewId>.focus` command VS Code auto-creates for
    // every TreeView; no need for an extension-side wrapper command.
    this.item.command = 'apicircle.mock.focus';
    this.item.tooltip = 'API Circle mock servers — click to open the Mock view';
    if (controller) {
      this.controllerSub = controller.onChange(() => {
        void this.refresh();
      });
    }
    // F-G9: refresh instantly when the user switches the active workspace
    // (multi-root setup) so the count + ports reflect the new workspace.
    this.bridgeSub = bridge.onDidChangeActiveWorkspace(() => {
      void this.refresh();
    });
    void this.refresh();
  }

  /** Force an immediate refresh — exposed for tests + start/stop callbacks. */
  async refresh(): Promise<void> {
    const surface = this.bridge.activeWorkspace();
    if (!surface) {
      this.item.hide();
      this.stopPolling();
      return;
    }
    let state;
    try {
      state = await surface.read();
    } catch {
      // Workspace.json was deleted under us, or the bridge is in flight
      // during teardown. Hide and stop polling — next workspace event
      // will resurrect us.
      this.item.hide();
      this.stopPolling();
      return;
    }
    const entries = Object.values(state.local.mockRuntime.active);
    if (entries.length === 0) {
      this.item.hide();
      this.stopPolling();
      return;
    }
    const ports = entries.map((e) => `:${e.port}`);
    const summary =
      ports.length <= 2
        ? ports.join(', ')
        : `${ports.slice(0, 2).join(', ')}, +${ports.length - 2}`;
    this.item.text = `$(server) Mocks: ${entries.length} (${summary})`;
    this.item.show();
    this.startPolling();
  }

  private startPolling(): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      void this.refresh();
    }, REFRESH_INTERVAL_MS);
  }

  private stopPolling(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  dispose(): void {
    this.stopPolling();
    this.controllerSub?.dispose();
    this.controllerSub = null;
    this.bridgeSub?.dispose();
    this.bridgeSub = null;
    this.item.dispose();
  }
}
