import { useEffect, useState } from 'react';
import { AlertTriangle, LifeBuoy } from 'lucide-react';
import { Panel, PanelGroup, PanelResizeHandle } from 'react-resizable-panels';
import { probeWorkspaceRecords } from './persistence/workspaceStorage';
import { useWorkspaceStore } from './store/workspaceStore';
import { TopBar } from './layout/TopBar';
import { PanelTabs } from './layout/PanelTabs';
import { Sidebar } from './layout/Sidebar';
import { PanelContent } from './layout/PanelContent';
import { SecretVaultModal } from './layout/SecretVaultModal';
import { MissingScopeGate } from './layout/MissingScopeGate';
import { KeyboardShortcuts } from './layout/KeyboardShortcuts';
import { GlobalAssetsPanel } from './panels/globalAssets/GlobalAssetsPanel';
import { LinkedRequestEditor } from './panels/link-workspace/LinkedRequestEditor';
import { OnboardingTips } from './onboarding/OnboardingTips';
import { getPanel } from './layout/panels';

export function App() {
  const ready = useWorkspaceStore((s) => s.ready);
  const hydrationError = useWorkspaceStore((s) => s.hydrationError);
  const hydrate = useWorkspaceStore((s) => s.hydrate);

  useEffect(() => {
    void hydrate();
  }, [hydrate]);

  if (hydrationError) {
    return <HydrationErrorScreen />;
  }

  if (!ready) {
    return (
      <div className="flex h-full items-center justify-center bg-surface text-sm text-text-muted">
        Loading workspace…
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col bg-surface text-text-primary">
      <TopBar />
      <PanelTabs />
      <div className="flex flex-1 overflow-hidden">
        <BodyLayout />
      </div>
      <SecretVaultModal />
      <GlobalAssetsPanel />
      <LinkedRequestEditor />
      <MissingScopeGate />
      <KeyboardShortcuts />
      <OnboardingTips />
    </div>
  );
}

/**
 * Sidebar + main split. Wraps both in a horizontal `PanelGroup` so the
 * sidebar is user-resizable via a draggable handle (same pattern as the
 * GraphQL Query/Variables splitter). Auto-saves the chosen width per
 * sidebar-class panel — Editor's tree gets remembered separately from
 * Environments etc., so users who like a wide tree don't have to redrag
 * every time they switch panels.
 *
 * When the active panel has no sidebar (`hasSidebar === false`), we skip
 * the splitter entirely — no empty Panel left behind.
 */
function BodyLayout() {
  const activePanel = useWorkspaceStore((s) => s.activePanel);
  const hasSidebar = getPanel(activePanel).hasSidebar;

  if (!hasSidebar) {
    return <PanelContent />;
  }

  return (
    <PanelGroup direction="horizontal" autoSaveId={`apicircle:layout:sidebar:${activePanel}`}>
      <Panel defaultSize={20} minSize={12} maxSize={50}>
        <Sidebar />
      </Panel>
      <PanelResizeHandle
        aria-label="Resize sidebar"
        className="group flex w-1.5 cursor-col-resize items-center justify-center border-x border-border-subtle bg-surface hover:bg-accent/20"
      >
        <span className="h-8 w-0.5 rounded-full bg-border group-hover:bg-accent" />
      </PanelResizeHandle>
      <Panel defaultSize={80} minSize={30}>
        <PanelContent />
      </Panel>
    </PanelGroup>
  );
}

interface RecoverableSummary {
  syncedHasData: boolean;
  localHasData: boolean;
  syncedWorkspaceName?: string;
  syncedRequestCount?: number;
  syncedEnvironmentCount?: number;
}

function HydrationErrorScreen() {
  const error = useWorkspaceStore((s) => s.hydrationError)!;
  const hydrate = useWorkspaceStore((s) => s.hydrate);
  const resetWorkspace = useWorkspaceStore((s) => s.resetWorkspace);
  const recoverPartialWorkspace = useWorkspaceStore((s) => s.recoverPartialWorkspace);
  const [busy, setBusy] = useState(false);
  const [recoverable, setRecoverable] = useState<RecoverableSummary | null>(null);

  // Probe IDB on mount so the recovery UI can tell the user what data is
  // actually salvageable (vs a generic "your data is still in IndexedDB").
  useEffect(() => {
    let cancelled = false;
    probeWorkspaceRecords()
      .then((records) => {
        if (cancelled) return;
        setRecoverable({
          syncedHasData: !!records.synced,
          localHasData: !!records.local,
          syncedWorkspaceName: records.synced?.workspaceName,
          syncedRequestCount: records.synced
            ? Object.keys(records.synced.collections.requests).length
            : undefined,
          syncedEnvironmentCount: records.synced
            ? Object.keys(records.synced.environments.items).length
            : undefined,
        });
      })
      .catch(() => {
        // Probe itself failed — IDB is fully broken. Leave recoverable null;
        // the UI falls back to Retry / Reset.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const canRecover =
    recoverable !== null &&
    (recoverable.syncedHasData || recoverable.localHasData) &&
    !(
      recoverable.syncedHasData &&
      recoverable.localHasData &&
      error.syncedWorkspaceId === error.localWorkspaceId
    );

  return (
    <div className="flex h-full items-center justify-center bg-surface p-6">
      <div className="flex max-w-xl flex-col gap-3 rounded-md border border-amber/40 bg-amber/5 p-5 text-text-primary">
        <header className="flex items-center gap-2">
          <AlertTriangle size={16} className="text-amber" />
          <h1 className="text-sm font-medium">Couldn&rsquo;t load your workspace</h1>
        </header>
        <p className="text-xs text-text-muted">{error.message}</p>

        {recoverable && (recoverable.syncedHasData || recoverable.localHasData) && (
          <div className="rounded-sm border border-border-subtle bg-card p-2 text-[11px] text-text-muted">
            <p className="mb-1 font-medium text-text-primary">Data still in IndexedDB</p>
            <ul className="flex flex-col gap-0.5 font-mono">
              <li>
                synced: {recoverable.syncedHasData ? 'present' : '— (missing)'}
                {recoverable.syncedHasData &&
                  ` · ${recoverable.syncedWorkspaceName ?? 'unnamed'} · ${recoverable.syncedRequestCount ?? 0} requests · ${recoverable.syncedEnvironmentCount ?? 0} envs`}
              </li>
              <li>local: {recoverable.localHasData ? 'present' : '— (missing)'}</li>
            </ul>
          </div>
        )}

        <p className="text-xs text-text-muted">
          {canRecover
            ? 'Recovering keeps your synced data (collections, environments, folders) and rebuilds the missing local-side state with a fresh secret vault and history. Resetting wipes everything.'
            : 'Try retrying first; if that doesn’t work, resetting creates a brand-new workspace (existing records will be overwritten).'}
        </p>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              void (async () => {
                setBusy(true);
                try {
                  await hydrate();
                } finally {
                  setBusy(false);
                }
              })();
            }}
            className="inline-flex h-7 items-center gap-1 rounded-sm border border-accent/40 bg-accent/10 px-3 text-[11px] text-accent hover:bg-accent/20 disabled:opacity-50"
          >
            {busy ? 'Retrying…' : 'Retry'}
          </button>
          {canRecover && (
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                void (async () => {
                  setBusy(true);
                  try {
                    const result = await recoverPartialWorkspace();
                    if (result === 'no-data') {
                      window.alert('No recoverable data found. Use Reset to start fresh.');
                    }
                  } finally {
                    setBusy(false);
                  }
                })();
              }}
              className="inline-flex h-7 items-center gap-1 rounded-sm border border-accent/40 bg-accent/15 px-3 text-[11px] text-accent hover:bg-accent/25 disabled:opacity-50"
            >
              <LifeBuoy size={11} />
              Recover existing data
            </button>
          )}
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              const ok = window.confirm(
                'Reset workspace? This wipes the existing IndexedDB records and creates a fresh workspace. This cannot be undone.',
              );
              if (!ok) return;
              void (async () => {
                setBusy(true);
                try {
                  await resetWorkspace();
                } finally {
                  setBusy(false);
                }
              })();
            }}
            className="inline-flex h-7 items-center gap-1 rounded-sm border border-danger/40 bg-danger/5 px-3 text-[11px] text-danger hover:bg-danger/10 disabled:opacity-50"
          >
            Reset workspace
          </button>
        </div>
      </div>
    </div>
  );
}
