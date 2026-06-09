// =============================================================================
// AbortRegistry — tracks in-flight request sends so the user can cancel them
// via status bar / Esc / command palette.
//
// Keyed by run id (generated per send). A registered controller is removed
// from the registry when it's aborted OR when the send completes naturally.
// =============================================================================

export class AbortRegistry {
  private inflight = new Map<string, AbortController>();

  /** Register a new in-flight send. Returns the controller's signal. */
  register(runId: string): AbortSignal {
    const controller = new AbortController();
    this.inflight.set(runId, controller);
    return controller.signal;
  }

  /** Remove a send from the registry (called on successful completion). */
  complete(runId: string): void {
    this.inflight.delete(runId);
  }

  /** Cancel a specific in-flight send. */
  cancel(runId: string): boolean {
    const c = this.inflight.get(runId);
    if (!c) return false;
    c.abort();
    this.inflight.delete(runId);
    return true;
  }

  /** Cancel every in-flight send (used during deactivate). */
  cancelAll(): number {
    const count = this.inflight.size;
    for (const c of this.inflight.values()) c.abort();
    this.inflight.clear();
    return count;
  }

  /** Return the list of currently-running run ids. */
  active(): string[] {
    return Array.from(this.inflight.keys());
  }

  /** True if any send is currently active. */
  hasActive(): boolean {
    return this.inflight.size > 0;
  }
}
