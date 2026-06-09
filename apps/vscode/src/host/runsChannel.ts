import * as vscode from 'vscode';

// =============================================================================
// RunsChannel — the single "APICircle Runs" OutputChannel.
//
// Before P4 the extension carried per-feature ad-hoc OutputChannels (mock log,
// future plan-runner, future request-sender). They each created their own
// channel lazily; users with multiple features active would see a cluttered
// channel picker.
//
// This consolidates into one user-facing channel — the same name the desktop
// app uses for its in-process log surface — with category prefixes so
// `[mock]` / `[vault]` / `[plan]` lines remain searchable. Future phases
// route plan / request execution through this same channel.
//
// **Lazy creation:** the underlying channel is NOT created until the first
// `log()` call. Users who never trigger a diagnostic don't see an empty
// "APICircle Runs" entry in their channel picker — matching the P3R6-G4
// pattern.
//
// **Lifecycle:** the channel is disposed via the registered disposable in
// `extension.ts` when the extension deactivates.
// =============================================================================

export type RunsChannelCategory = 'mock' | 'vault' | 'plan' | 'send' | 'snapshot' | 'misc';

export interface RunsChannelOptions {
  /** Override the channel name (default: "APICircle Runs"). Used by tests. */
  name?: string;
  /**
   * Hook called instead of creating a real channel — lets unit tests
   * capture lines without instantiating vscode.OutputChannel.
   */
  sink?: (line: string) => void;
}

export class RunsChannel implements vscode.Disposable {
  private readonly channelName: string;
  private channel: vscode.OutputChannel | undefined;
  private readonly sink: ((line: string) => void) | undefined;

  constructor(opts: RunsChannelOptions = {}) {
    this.channelName = opts.name ?? 'APICircle Runs';
    this.sink = opts.sink;
  }

  /**
   * Append a categorised line. Lines are formatted as
   *   `[<category>] <timestamp> <message>`
   * so the picker stays scannable.
   */
  log(category: RunsChannelCategory, message: string): void {
    const ts = new Date().toISOString();
    const line = `[${category}] ${ts} ${message}`;
    if (this.sink) {
      this.sink(line);
      return;
    }
    if (!this.channel) {
      this.channel = vscode.window.createOutputChannel(this.channelName);
    }
    this.channel.appendLine(line);
  }

  /**
   * Convenience for "I want a fixed-category logger to hand to a sub-system"
   * — used by the VaultManager + VsCodeMockController DI.
   */
  forCategory(category: RunsChannelCategory): (msg: string) => void {
    return (msg) => this.log(category, msg);
  }

  /** Show the channel (if it has been created). Otherwise create + show. */
  reveal(): void {
    if (!this.channel) {
      this.channel = vscode.window.createOutputChannel(this.channelName);
    }
    this.channel.show(/* preserveFocus */ true);
  }

  /** True once the underlying OutputChannel has been instantiated. Used by
   * tests + the audit pass to confirm laziness. */
  isCreated(): boolean {
    return this.channel !== undefined;
  }

  dispose(): void {
    this.channel?.dispose();
    this.channel = undefined;
  }
}
