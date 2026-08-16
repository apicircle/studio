import { useCallback, useEffect, useRef, useState } from 'react';
import { AlertTriangle, LifeBuoy } from 'lucide-react';
import { Panel, PanelGroup, PanelResizeHandle } from 'react-resizable-panels';
import { probeWorkspaceRecords } from './persistence/workspaceStorage';
import { useWorkspaceStore } from './store/workspaceStore';
import { getDesktopWorkspaceFileBridge } from './desktop/bridge';

/**
 * Re-run `refreshWorkspace` when the user comes back to the app from
 * another tab / window. Catches the common workflow:
 *   1. User clicks "Create PR" in the app, opens GitHub in a new tab.
 *   2. User merges the PR on GitHub.
 *   3. User switches back to the app — should now see "PR merged" /
 *      branch retired without having to click Refresh.
 *
 * Listens to both `visibilitychange` (covers tab switches inside the
 * same window) and `focus` (covers window switches across applications).
 * Also fires once on hydrate-with-branch — covers the cold-launch case
 * where the user merged a PR while the app was closed and the app comes
 * up already-focused (no focus *transition* happens, so the listener
 * wouldn't otherwise run).
 *
 * Debounced to one refresh per ~10s so a user rapidly cycling Alt-Tab
 * doesn't spam the GitHub API. Skips when there's no working branch
 * (refreshWorkspace would throw) or when a refresh is already in flight.
 */
function useFocusRefresh(): void {
  const refreshWorkspace = useWorkspaceStore((s) => s.refreshWorkspace);
  const hasBranch = useWorkspaceStore((s) => Boolean(s.local?.workingBranch));
  const inFlightRef = useRef(false);
  const lastRefreshAtRef = useRef(0);

  useEffect(() => {
    if (!hasBranch) return;
    const MIN_INTERVAL_MS = 10_000;
    const fire = () => {
      if (document.hidden) return;
      if (inFlightRef.current) return;
      const now = Date.now();
      if (now - lastRefreshAtRef.current < MIN_INTERVAL_MS) return;
      inFlightRef.current = true;
      lastRefreshAtRef.current = now;
      refreshWorkspace()
        .catch(() => {
          // Silent — focus-refresh is opportunistic. The user can still
          // hit Refresh manually if they want a typed error surface.
        })
        .finally(() => {
          inFlightRef.current = false;
        });
    };
    const onVisibilityChange = () => {
      if (!document.hidden) fire();
    };
    // Cold-launch probe: if hydrate left us with a working branch, kick a
    // refresh once so a PR merged-while-closed gets detected without the
    // user having to defocus + refocus the window.
    fire();
    window.addEventListener('focus', fire);
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      window.removeEventListener('focus', fire);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [hasBranch, refreshWorkspace]);
}

/**
 * Subscribe to file-watcher events from the desktop main process so the
 * renderer auto-refreshes when an external writer (MCP server, CLI, or
 * a user editing the JSON by hand) changes `workspace.json` while
 * the desktop is running.
 *
 * Without this hook the desktop only re-reads disk on a manual Refresh
 * click, and the debounced IDB→disk mirror would silently overwrite the
 * external write on the next mutation. The watcher in main suppresses
 * its own write events, so this subscription only fires for truly
 * external changes.
 *
 * Debounced: a burst of external writes (e.g. an MCP `folder.import`
 * that lands many requests in quick succession) coalesces to one refresh.
 */
function useExternalDiskRefresh(): void {
  const refreshFromDisk = useWorkspaceStore((s) => s.refreshFromDisk);
  const refreshRegistryFromDisk = useWorkspaceStore((s) => s.refreshRegistryFromDisk);
  const pushToast = useWorkspaceStore((s) => s.pushToast);
  const ready = useWorkspaceStore((s) => s.ready);
  const inFlightRef = useRef(false);

  useEffect(() => {
    // Wait until hydration completes — refreshFromDisk needs the
    // current workspaceId to know which on-disk file to read.
    if (!ready) return;
    const bridge = getDesktopWorkspaceFileBridge();
    if (!bridge?.onExternalChange) return;
    const unsubscribe = bridge.onExternalChange((event) => {
      // Registry events: an external writer (CLI `workspaces create`,
      // MCP-side registration, or `setActive` from a sibling process)
      // touched `registry.json`. Re-read the registry into the store so
      // the workspace switcher reflects whatever's on disk. We do NOT
      // also call refreshFromDisk here — the active-workspace pointer
      // change, if any, doesn't move CONTENT until the user actually
      // switches workspaces in the UI.
      if (event.workspaceId === 'registry') {
        void refreshRegistryFromDisk()
          .then((result) => {
            if (result.kind === 'updated' && result.added > 0) {
              pushToast({
                tone: 'info',
                title: 'Workspace list updated',
                detail: `${result.added} new workspace${result.added === 1 ? '' : 's'} appeared on disk (CLI or MCP).`,
              });
            }
          })
          .catch(() => {
            /* readRegistry handles its own errors */
          });
        return;
      }
      if (inFlightRef.current) return;
      inFlightRef.current = true;
      refreshFromDisk()
        .then((result) => {
          if (result.kind === 'updated') {
            pushToast({
              tone: 'info',
              title: 'Workspace updated from disk',
              detail: 'An external change (MCP, CLI, or editor) was picked up.',
            });
          } else if (result.kind === 'merged') {
            pushToast({
              tone: 'info',
              title: 'On-disk content merged in',
              detail: `Imported ${result.importedRequestIds.length} request(s) and ${result.importedFolderIds.length} folder(s).`,
            });
          }
          // 'up-to-date' / 'no-file' / 'no-mirror' / 'error' are silent
          // here so the user isn't spammed when nothing changed.
        })
        .catch(() => {
          /* refreshFromDisk handles its own errors via the result kind */
        })
        .finally(() => {
          inFlightRef.current = false;
        });
    });
    return unsubscribe;
  }, [ready, refreshFromDisk, refreshRegistryFromDisk, pushToast]);
}

import { TopBar, type BrandDef } from './layout/TopBar';
import { PanelTabs } from './layout/PanelTabs';
import { Sidebar } from './layout/Sidebar';
import { PanelContent } from './layout/PanelContent';
import { RightDock } from './layout/RightDock';
import { RightDockRail } from './layout/RightDockRail';
import { MissingScopeGate } from './layout/MissingScopeGate';
import { AttachmentDownloadPromptModal } from './layout/AttachmentDownloadPromptModal';
import { KeyboardShortcuts } from './layout/KeyboardShortcuts';
import { UpdatePreviewModal } from './panels/link-workspace/UpdatePreviewModal';
import { CloseConfirmModal } from './layout/CloseConfirmModal';
import { OnboardingTour } from './onboarding/OnboardingTour';
import { ConfirmDialog } from './primitives/ConfirmDialog';
import { Modal } from './primitives/Modal';
import { ToastViewport } from './primitives/Toast';
import { UpdateAvailableBanner } from './primitives/UpdateAvailableBanner';
import { PassphrasePromptModalGate } from './onboarding/PassphrasePromptModalGate';
import {
  ExtraPanelsProvider,
  useExtraPanels,
  resolveActivePanel,
  NO_EXTRA_PANELS,
  type ExtraPanelDef,
} from './layout/extraPanels';
import {
  SectionsProvider,
  readStoredSection,
  writeStoredSection,
  resolveActiveSection,
  NO_SECTIONS,
  type SectionDef,
} from './layout/sections';
import { SectionLanding } from './layout/SectionLanding';

export function App({
  extraPanels = NO_EXTRA_PANELS,
  sections = NO_SECTIONS,
  brand,
}: {
  /** Edition-contributed top-nav panels. Omitted in Studio → strict no-op. */
  extraPanels?: readonly ExtraPanelDef[];
  /** Edition-contributed sections/modes. Omitted in Studio → strict no-op. */
  sections?: readonly SectionDef[];
  /** Edition-provided header brand. Omitted in Studio → the default "API Circle Studio". */
  brand?: BrandDef;
} = {}) {
  const ready = useWorkspaceStore((s) => s.ready);
  const hydrationError = useWorkspaceStore((s) => s.hydrationError);
  const hydrate = useWorkspaceStore((s) => s.hydrate);
  const workspaceId = useWorkspaceStore((s) => s.synced?.workspaceId ?? '');
  const setActivePanel = useWorkspaceStore((s) => s.setActivePanel);

  // Active section ("mode"), persisted per-workspace. Inert in Studio (no
  // sections registered) — the seam is a strict no-op.
  const [activeSectionId, setActiveSectionIdState] = useState('');
  useEffect(() => {
    // Re-resolve the stored mode when the active workspace changes (or sections
    // first register) so switching workspaces restores that workspace's mode.
    if (sections.length <= 1 || !workspaceId) return;
    const storedSectionId = readStoredSection(workspaceId, sections);
    setActiveSectionIdState(storedSectionId);
    // Reconcile the active panel with the restored mode. `activePanel` is
    // persisted globally and `readStoredPanel` only round-trips core panel ids,
    // so a cold launch into an edition section (e.g. Lens) would otherwise leave
    // a core panel (Editor) showing under the wrong mode — the tab strip shows
    // that section's tabs while the body renders a panel the section doesn't
    // list. Land on the section's first panel whenever the current one isn't
    // part of the restored section (the same move `setActiveSectionId` makes on
    // an explicit mode switch). Read the panel via getState so this effect
    // reconciles on load/workspace-change only, and never fights the user as
    // they switch panels within a mode.
    const section = resolveActiveSection(storedSectionId, sections);
    const currentPanel = useWorkspaceStore.getState().activePanel;
    if (section && section.panelIds.length > 0 && !section.panelIds.includes(currentPanel)) {
      setActivePanel(section.panelIds[0]);
    }
  }, [workspaceId, sections, setActivePanel]);
  const setActiveSectionId = useCallback(
    (id: string) => {
      setActiveSectionIdState(id);
      writeStoredSection(workspaceId, id);
      // Keep the tab strip + content consistent: move the active panel into the
      // newly-selected section.
      const firstPanel = sections.find((s) => s.id === id)?.panelIds[0];
      if (firstPanel) setActivePanel(firstPanel);
    },
    [workspaceId, sections, setActivePanel],
  );

  useEffect(() => {
    void hydrate();
  }, [hydrate]);

  useFocusRefresh();
  useExternalDiskRefresh();

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
    <ExtraPanelsProvider value={extraPanels}>
      <SectionsProvider value={{ sections, activeSectionId, setActiveSectionId }}>
        <div className="flex h-full flex-col bg-surface text-text-primary">
          <TopBar brand={brand} />
          <PanelTabs />
          <div className="flex flex-1 overflow-hidden">
            <BodyArea />
            <RightDockRail />
          </div>
          <UpdatePreviewModal />
          <MissingScopeGate />
          <AttachmentDownloadPromptModal />
          <KeyboardShortcuts />
          {/* Don't auto-start the Studio tour for an edition that has its own
              first-run mode landing (Lens) — it would stack over and disable it.
              Studio-standalone (no sections) keeps auto-start. Replay is always
              available via the Help Center. */}
          <OnboardingTour autoStart={sections.length <= 1} />
          <ToastSlot />
          <UpdateAvailableBanner />
          <PassphrasePromptModalGate />
          <CloseConfirmModal />
          {sections.length > 1 && <SectionLanding />}
        </div>
      </SectionsProvider>
    </ExtraPanelsProvider>
  );
}

function ToastSlot() {
  const toasts = useWorkspaceStore((s) => s.toasts);
  const dismiss = useWorkspaceStore((s) => s.dismissToast);
  return <ToastViewport toasts={toasts} onDismiss={dismiss} />;
}

/**
 * Body area = sidebar + main content (+ docked dock when applicable),
 * sitting to the left of the always-visible RightDockRail. Two render
 * modes for the dock:
 *
 * - `mode === 'docked'` — the dock joins a horizontal `PanelGroup` with
 *   sidebar and main content. The user drags a splitter to size it, and
 *   the layout is persisted per (active-panel, sidebar-vis, dock-vis)
 *   via `react-resizable-panels` so the Editor's tree width and the
 *   chosen dock width survive panel switches.
 *
 * - `mode === 'overlay'` — the dock floats absolutely above main content
 *   on the right side of the body area. Main content keeps its full
 *   width; the user can scroll/click behind the floating panel.
 *
 * In both cases the rail (rendered by App.tsx) sits to the right of
 * this whole area, providing the entry point.
 */
function BodyArea() {
  const activePanel = useWorkspaceStore((s) => s.activePanel);
  const extraPanels = useExtraPanels();
  const hasSidebar = resolveActivePanel(activePanel, extraPanels).hasSidebar;
  const dockTab = useWorkspaceStore((s) => s.rightDock.tab);
  const dockMode = useWorkspaceStore((s) => s.rightDock.mode);
  const dockOpen = dockTab !== null;
  const dockedInline = dockOpen && dockMode === 'docked';
  const dockOverlay = dockOpen && dockMode === 'overlay';

  return (
    <div className="relative flex flex-1 overflow-hidden">
      <InlineLayout hasSidebar={hasSidebar} dockedInline={dockedInline} activePanel={activePanel} />
      {dockOverlay && (
        <div
          // Floats over the main content from the top-right corner of
          // the body area. The rail (40px) is rendered as a sibling at
          // the App level — by the time we hit BodyArea's right edge
          // the rail is already accounted for, so right-0 is correct.
          className="absolute right-0 top-0 z-30 flex h-full w-[400px] max-w-[80vw]"
        >
          <RightDock />
        </div>
      )}
    </div>
  );
}

interface InlineLayoutProps {
  hasSidebar: boolean;
  dockedInline: boolean;
  activePanel: string;
}

function InlineLayout({ hasSidebar, dockedInline, activePanel }: InlineLayoutProps) {
  if (!hasSidebar && !dockedInline) {
    return <PanelContent />;
  }

  // Layout key changes when sidebar/dock visibility changes so
  // `react-resizable-panels` doesn't try to apply a saved layout that
  // referenced a different number of panels.
  const layoutKey = `apicircle:layout:body:${activePanel}:${hasSidebar ? 'sb' : 'no-sb'}:${
    dockedInline ? 'dock' : 'no-dock'
  }`;

  // `react-resizable-panels` requires stable `id` and `order` props on
  // each Panel when siblings are conditionally rendered, otherwise it
  // can't track which saved size belongs to which panel after the tree
  // shape changes.
  return (
    <PanelGroup direction="horizontal" autoSaveId={layoutKey}>
      {hasSidebar && (
        <>
          <Panel id="sidebar" order={1} defaultSize={20} minSize={12} maxSize={50}>
            <Sidebar />
          </Panel>
          <PanelResizeHandle
            aria-label="Resize sidebar"
            className="group flex w-1.5 cursor-col-resize items-center justify-center border-x border-border-subtle bg-surface hover:bg-accent/20"
          >
            <span className="h-8 w-0.5 rounded-full bg-border group-hover:bg-accent" />
          </PanelResizeHandle>
        </>
      )}
      <Panel
        id="main"
        order={2}
        defaultSize={dockedInline ? (hasSidebar ? 52 : 72) : hasSidebar ? 80 : 100}
        minSize={30}
      >
        <PanelContent />
      </Panel>
      {dockedInline && (
        <>
          <PanelResizeHandle
            aria-label="Resize workspace inspector"
            className="group flex w-1.5 cursor-col-resize items-center justify-center border-x border-border-subtle bg-surface hover:bg-accent/20"
          >
            <span className="h-8 w-0.5 rounded-full bg-border group-hover:bg-accent" />
          </PanelResizeHandle>
          <Panel id="dock" order={3} defaultSize={28} minSize={16} maxSize={60}>
            <RightDock />
          </Panel>
        </>
      )}
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
  const [resetConfirmOpen, setResetConfirmOpen] = useState(false);
  // Surface the "no recoverable data" outcome from `recoverPartialWorkspace`
  // as an in-app modal instead of a native alert. When null, the modal is
  // closed; the message string is displayed verbatim when set.
  const [recoverNotice, setRecoverNotice] = useState<string | null>(null);

  // Probe IDB on mount so the recovery UI can tell the user what data is
  // actually salvageable (vs a generic "your data is still in IndexedDB").
  useEffect(() => {
    let cancelled = false;
    probeWorkspaceRecords()
      .then((records) => {
        if (cancelled) return;
        // Post-B.6 multi-workspace: probeWorkspaceRecords returns the
        // registry. The recovery banner only needs to know whether
        // anything is salvageable — the registry's existence is enough.
        const reg = records.registry;
        const activeEntry = reg?.workspaces.find((w) => w.id === reg.activeWorkspaceId);
        setRecoverable({
          syncedHasData: Boolean(reg && reg.workspaces.length > 0),
          localHasData: Boolean(reg && reg.workspaces.length > 0),
          syncedWorkspaceName: activeEntry?.name,
          syncedRequestCount: undefined,
          syncedEnvironmentCount: undefined,
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
          <div className="rounded-sm border border-border-subtle bg-card p-2 text-[0.6875rem] text-text-muted">
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
            className="inline-flex h-7 items-center gap-1 rounded-sm border border-accent/40 bg-accent/10 px-3 text-[0.6875rem] text-accent hover:bg-accent/20 disabled:opacity-50"
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
                      setRecoverNotice('No recoverable data found. Use Reset to start fresh.');
                    }
                  } finally {
                    setBusy(false);
                  }
                })();
              }}
              className="inline-flex h-7 items-center gap-1 rounded-sm border border-accent/40 bg-accent/15 px-3 text-[0.6875rem] text-accent hover:bg-accent/25 disabled:opacity-50"
            >
              <LifeBuoy size={11} />
              Recover existing data
            </button>
          )}
          <button
            type="button"
            disabled={busy}
            onClick={() => setResetConfirmOpen(true)}
            className="inline-flex h-7 items-center gap-1 rounded-sm border border-danger/40 bg-danger/5 px-3 text-[0.6875rem] text-danger hover:bg-danger/10 disabled:opacity-50"
          >
            Reset workspace
          </button>
        </div>
      </div>

      <ConfirmDialog
        open={resetConfirmOpen}
        title="Reset workspace?"
        description={
          <p>
            Wipes the existing IndexedDB records and creates a fresh workspace. Every collection,
            environment, secret, and run history entry is removed. This cannot be undone.
          </p>
        }
        confirmLabel="Reset workspace"
        tone="danger"
        typedConfirm="RESET"
        onCancel={() => setResetConfirmOpen(false)}
        onConfirm={async () => {
          setResetConfirmOpen(false);
          setBusy(true);
          try {
            await resetWorkspace();
          } finally {
            setBusy(false);
          }
        }}
      />

      <Modal
        open={recoverNotice !== null}
        onClose={() => setRecoverNotice(null)}
        title="Recovery result"
        className="max-w-sm"
      >
        <div className="space-y-3 text-xs text-text-muted">
          <p>{recoverNotice}</p>
          <div className="flex justify-end">
            <button
              type="button"
              onClick={() => setRecoverNotice(null)}
              className="inline-flex h-7 items-center rounded-sm border border-accent/40 bg-accent/10 px-3 text-xs text-accent hover:bg-accent/20"
            >
              OK
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
