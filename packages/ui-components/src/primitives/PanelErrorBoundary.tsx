import { Component, type ErrorInfo, type ReactNode } from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';

// =============================================================================
// PanelErrorBoundary — catches render errors thrown by a single panel so a
// broken panel can't blank out the whole app. Without this, a thrown
// exception inside e.g. EditorPanel bubbles past App.tsx and React unmounts
// the root, leaving the user with a white screen and no recourse.
//
// One boundary per panel (mounted in PanelContent) so the user can still
// navigate to a working panel via the panel-tabs bar after a crash.
//
// The fallback surfaces error.message + a collapsed stack so the user can
// share it as a bug report. The reset button re-mounts the panel — it
// clears the boundary state, which forces React to retry rendering the
// child tree from scratch.
// =============================================================================

interface PanelErrorBoundaryProps {
  /** Human label for the panel (shown in the fallback UI). */
  panelLabel: string;
  children: ReactNode;
}

interface PanelErrorBoundaryState {
  error: Error | null;
  componentStack: string | null;
}

export class PanelErrorBoundary extends Component<
  PanelErrorBoundaryProps,
  PanelErrorBoundaryState
> {
  state: PanelErrorBoundaryState = { error: null, componentStack: null };

  static getDerivedStateFromError(error: Error): Partial<PanelErrorBoundaryState> {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // Surface to the dev console with full context. We don't push this to
    // a toast — the in-panel fallback is the primary user signal, and a
    // toast on top of a crashed pane would be noise.
    console.error(`[PanelErrorBoundary:${this.props.panelLabel}]`, error, info);
    this.setState({ componentStack: info.componentStack ?? null });
  }

  reset = (): void => {
    this.setState({ error: null, componentStack: null });
  };

  render(): ReactNode {
    if (!this.state.error) return this.props.children;
    const { error, componentStack } = this.state;
    return (
      <div className="flex h-full items-center justify-center bg-surface p-6">
        <div className="flex max-w-2xl flex-col gap-3 rounded-md border border-danger/40 bg-danger/5 p-5 text-text-primary">
          <header className="flex items-center gap-2">
            <AlertTriangle size={16} className="text-danger" aria-hidden="true" />
            <h2 className="text-sm font-medium">{this.props.panelLabel} crashed</h2>
          </header>
          <p className="text-xs text-text-muted">
            Something in this panel threw an error while rendering. Other panels still work — switch
            via the top bar — and you can retry below. Share the details with the maintainers if it
            keeps happening.
          </p>
          <div className="rounded-sm border border-border-subtle bg-card p-2 text-[0.6875rem] text-text-muted">
            <p className="font-mono text-text-primary">{error.message || error.name}</p>
            {(error.stack || componentStack) && (
              <details className="mt-2">
                <summary className="cursor-pointer text-text-dim">Stack trace</summary>
                <pre className="mt-1 max-h-64 overflow-auto whitespace-pre-wrap font-mono text-[0.625rem] text-text-dim">
                  {error.stack ?? ''}
                  {componentStack ? `\n\nComponent stack:${componentStack}` : ''}
                </pre>
              </details>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={this.reset}
              className="inline-flex h-7 items-center gap-1 rounded-sm border border-accent/40 bg-accent/10 px-3 text-[0.6875rem] text-accent hover:bg-accent/20"
            >
              <RefreshCw size={11} aria-hidden="true" />
              Retry
            </button>
          </div>
        </div>
      </div>
    );
  }
}
