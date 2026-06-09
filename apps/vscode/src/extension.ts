import * as vscode from 'vscode';
import { VsCodeBridge } from './host/vscodeBridge';
import { discoverWorkspaces } from './util/workspaceDiscovery';
import { EditorView } from './views/EditorView';
import { EnvironmentView } from './views/EnvironmentView';
import { ExecutionView } from './views/ExecutionView';
import { MockView } from './views/MockView';
import { HistoryView } from './views/HistoryView';
import { McpView } from './views/McpView';
import { MarketplaceView } from './views/MarketplaceView';
import { SnapshotsView } from './views/SnapshotsView';
import { createWorkspaceCommand } from './commands/createWorkspace';
import { ApicircleFsProvider } from './fs/apicircleFsProvider';
import { AbortRegistry } from './execute/abortRegistry';
import { sendRequestCommand } from './execute/sendRequest';
import { PreSendDiagnostics } from './diagnostics/preSendDiagnostics';
import { StatusBar } from './status/statusBar';
import { newRequestCommand } from './commands/newRequest';
import { RequestCodeLensProvider } from './lang/requestCodeLens';
import { RequestCompletionProvider } from './lang/requestCompletion';
import { EnvironmentCodeLensProvider } from './lang/environmentCodeLens';
import { EnvironmentCompletionProvider } from './lang/environmentCompletion';
import { EnvironmentHoverProvider } from './lang/environmentHover';
import { PlanCodeLensProvider } from './lang/planCodeLens';
import { PlanCompletionProvider } from './lang/planCompletion';
import { PlanHoverProvider } from './lang/planHover';
import {
  deleteRequestCommand,
  duplicateRequestCommand,
  revealInSourceCommand,
} from './commands/requestActions';
import {
  setActiveEnvironmentCommand,
  newEnvironmentCommand,
  deleteEnvironmentCommand,
} from './commands/environmentActions';
import {
  captureSnapshotCommand,
  restoreSnapshotCommand,
  deleteSnapshotCommand,
  setSnapshotMaxBytesCommand,
} from './commands/snapshotActions';
import { runPlanCommand } from './commands/planActions';
import { setEnvPriorityOrderCommand } from './commands/environmentPriority';
import { newPlanCommand } from './commands/newPlan';
import { addExtractionFromLatestResponseCommand } from './commands/addExtraction';
import {
  clearAllHistoryCommand,
  purgeOlderThanCommand,
  deleteHistoryRunCommand,
} from './commands/historyActions';
import { editVariableValueCommand, deleteVariableCommand } from './commands/variableActions';
import { deleteFolderCommand, newRequestInFolderCommand } from './commands/folderActions';
import { toggleStepEnabledCommand, removeStepFromPlanCommand } from './commands/stepActions';
import {
  newMockCommand,
  startMockCommand,
  stopMockCommand,
  restartMockCommand,
  deleteMockCommand,
  copyEndpointPathCommand,
  revealEndpointInMockYamlCommand,
  openMockInBrowserCommand,
} from './commands/mockActions';
import { VsCodeMockController } from './host/vscodeMockController';
import { MockCodeLensProvider } from './lang/mockCodeLens';
import { MockCompletionProvider } from './lang/mockCompletion';
import { MockHoverProvider } from './lang/mockHover';
import { MockStatusBar } from './status/mockStatusBar';
import { registerWorkspaceWatchers } from './watch/workspaceWatcher';
import { VsCodeVaultManager } from './host/vaultManager';
import { RunsChannel } from './host/runsChannel';
import {
  unlockVaultCommand,
  lockVaultCommand,
  setupVaultPassphraseCommand,
  changeVaultPassphraseCommand,
  openVaultEntryCommand,
  forgetVaultOnDeviceCommand,
  silentUnlockFromDevice,
  type VaultActionsDeps,
} from './commands/vaultActions';
import { VsCodeMcpManager } from './host/mcpManager';
import type { AiClient } from '@apicircle/mcp-server';
import {
  copyMcpConfigCommand,
  openMcpConfigFileCommand,
  openMcpConnectGuideCommand,
  revealMcpBinaryInfoCommand,
} from './commands/mcpActions';
import { installCopilotMcpConfigCommand, pickOwningFolder } from './commands/copilotMcpActions';
import { detectCopilotMcpConfigState } from './host/copilotMcpInstall';
import { PlanNotebookSerializer } from './notebook/planNotebookSerializer';
import { PlanNotebookController } from './notebook/planNotebookController';
import { openPlanAsNotebookCommand } from './commands/openPlanAsNotebook';
import { AssertionTestController } from './testing/assertionTestController';
import { EmbeddedMcpHost } from './host/embeddedMcpHost';
import {
  startEmbeddedMcpCommand,
  stopEmbeddedMcpCommand,
  restartEmbeddedMcpCommand,
  copyEmbeddedMcpUrlCommand,
} from './commands/embeddedMcpActions';
import {
  tryRegisterEmbeddedMcpAsLmProvider,
  type ProposedMcpRegistration,
} from './host/proposedMcpProviderRegistration';
import { MockEndpointEditor } from './webview/mockEndpointEditor';
import { editMockEndpointCommand, applyFormStateToMock } from './commands/editMockEndpoint';
import {
  installMcpForClientCommand,
  installMcpForAllClientsCommand,
  uninstallMcpForClientCommand,
} from './commands/mcpClientActions';
import {
  INSTALLABLE_CLIENTS,
  detectClientMcpConfigState,
  type InstallableClient,
} from './host/mcpClientInstall';

// =============================================================================
// APICircle Studio — VS Code extension entry point.
//
// activate() wires up:
//   • The seven sidebar TreeViews (stubs in day-1; populated in Phase 1+)
//   • The VsCodeBridge singleton (workspace surface + future MCP/mock/secrets)
//   • The `APICircle: Create New Workspace` command
//   • Initial workspace discovery — auto-registers and activates the first
//     `.apicircle/workspace.json` found in the open folders
//
// Everything else (FileSystemProvider, language services, response viewer,
// send command, etc.) lands incrementally in subsequent commits within Phase 1.
// =============================================================================

let bridge: VsCodeBridge | null = null;
let abortRegistry: AbortRegistry | null = null;
let mockController: VsCodeMockController | null = null;
let vaultManager: VsCodeVaultManager | null = null;
let runsChannel: RunsChannel | null = null;
let mcpManager: VsCodeMcpManager | null = null;
let embeddedMcpHost: EmbeddedMcpHost | null = null;
let lmMcpRegistration: ProposedMcpRegistration | null = null;
let mockEndpointEditor: MockEndpointEditor | null = null;
let views: {
  editor: EditorView;
  environment: EnvironmentView;
  execution: ExecutionView;
  mock: MockView;
  history: HistoryView;
  snapshots: SnapshotsView;
  mcp: McpView;
  marketplace: MarketplaceView;
} | null = null;

export function activate(context: vscode.ExtensionContext): void {
  bridge = new VsCodeBridge(context);
  abortRegistry = new AbortRegistry();

  // P4: a single consolidated "APICircle Runs" OutputChannel replaces the
  // P3 per-feature "APICircle Mock" channel. Lazy — never created until the
  // first log() call (matches P3R6-G4). Mock controller + vault manager
  // route their diagnostics here under category prefixes so the picker
  // stays scannable.
  runsChannel = new RunsChannel();
  context.subscriptions.push(runsChannel);

  mockController = new VsCodeMockController({
    getActiveSurface: () => bridge?.activeWorkspace() ?? undefined,
    log: runsChannel.forCategory('mock'),
  });

  // P4: vault manager. The auto-lock minutes default mirrors
  // package.json contributes.configuration; the live setting is read +
  // applied below. Audit-G9: shutdown wipe lives in `deactivate()` only —
  // a subscription path would fire alongside the explicit deactivate
  // call (double lockAll), and lockAll is keyed by reference identity so
  // the duplicate would log no entries either way. One owner.
  vaultManager = new VsCodeVaultManager({
    log: runsChannel.forCategory('vault'),
  });
  context.subscriptions.push(bridge);

  // Apply the current vault settings + subscribe to changes.
  const applyVaultSettings = () => {
    if (!vaultManager) return;
    const cfg = vscode.workspace.getConfiguration('apicircle.secrets');
    vaultManager.setAutoLockMinutes(cfg.get<number>('autoLockMinutes', 30));
  };
  applyVaultSettings();
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('apicircle.secrets')) applyVaultSettings();
      // P6R4-G1: if `apicircle.mcp.workspaceConfigPath` (or `binaryPath`,
      // which affects the probe result) changes mid-session, refresh the
      // McpView so the Copilot row's install state reflects the new
      // setting without waiting for an unrelated event.
      if (e.affectsConfiguration('apicircle.mcp')) {
        views?.mcp.refresh();
      }
    }),
  );

  // P5: MCP manager. Reads `apicircle.mcp.binaryPath` on every call so a
  // settings change takes effect without reactivation. The manager itself
  // is stateless — no lifecycle wiring beyond the dispose-on-extension-
  // deactivate path below.
  mcpManager = new VsCodeMcpManager({
    bridge,
    getBinaryPath: () =>
      vscode.workspace.getConfiguration('apicircle.mcp').get<string>('binaryPath', 'apicircle-mcp'),
  });

  // Register the apicircle: FileSystemProvider FIRST so views that take a
  // reference to it (history) can wire up.
  const fsProvider = new ApicircleFsProvider(bridge);

  // Sidebar views.
  views = {
    editor: new EditorView(bridge),
    environment: new EnvironmentView(bridge, vaultManager),
    execution: new ExecutionView(bridge),
    mock: new MockView(bridge),
    history: new HistoryView(bridge, fsProvider),
    snapshots: new SnapshotsView(bridge),
    mcp: new McpView(
      mcpManager,
      () => {
        // P6: probe `.vscode/mcp.json` for the apicircle entry. Called
        // every time the view renders the github-copilot row — cheap
        // (one fs.existsSync + JSON.parse). P6R1-G4: uses the shared
        // `pickOwningFolder` helper so the multi-root logic stays in
        // one place. P6R4-G3: catches ANY thrown error so a corrupt
        // setting or surprise exception doesn't crash the tree render.
        try {
          const mgr = mcpManager;
          const folders = vscode.workspace.workspaceFolders;
          if (!mgr || !folders || folders.length === 0) return 'absent';
          const paths = mgr.resolvePaths();
          if (!paths.hasActiveWorkspace) return 'absent';
          const owning = pickOwningFolder(folders, paths.workspace);
          if (!owning) return 'absent';
          return detectCopilotMcpConfigState({
            workspaceFolder: owning.uri.fsPath,
            relativeConfigPath: vscode.workspace
              .getConfiguration('apicircle.mcp')
              .get<string>('workspaceConfigPath', '.vscode/mcp.json'),
            binary: paths.binary,
            apicircleDir: paths.workspace,
          });
        } catch (err) {
          runsChannel?.forCategory('misc')(
            `copilot probe threw (treating as absent): ${err instanceof Error ? err.message : String(err)}`,
          );
          return 'absent';
        }
      },
      (client: InstallableClient) => {
        // P8: probe each external AI client's user-level config file for
        // the apicircle entry. Same defensive pattern as the Copilot
        // probe — any throw maps to 'absent' so the tree never crashes.
        try {
          const mgr = mcpManager;
          if (!mgr) return 'absent';
          const paths = mgr.resolvePaths();
          if (!paths.hasActiveWorkspace) return 'absent';
          return detectClientMcpConfigState({
            client,
            binary: paths.binary,
            apicircleDir: paths.workspace,
          });
        } catch (err) {
          runsChannel?.forCategory('misc')(
            `client install probe (${client}) threw (treating as absent): ${err instanceof Error ? err.message : String(err)}`,
          );
          return 'absent';
        }
      },
    ),
    marketplace: new MarketplaceView(),
  };
  for (const v of Object.values(views)) {
    v.register(context);
  }
  context.subscriptions.push(
    vscode.workspace.registerFileSystemProvider('apicircle', fsProvider, {
      isCaseSensitive: true,
      isReadonly: false,
    }),
    // Completion provider for the apicircle-request language.
    vscode.languages.registerCompletionItemProvider(
      { scheme: 'apicircle', pattern: '**/requests/*.req.yaml' },
      new RequestCompletionProvider(),
      ':',
      ' ',
    ),
  );

  // Pre-send validation diagnostics surface in the Problems panel.
  const diagnostics = new PreSendDiagnostics(bridge);
  context.subscriptions.push(diagnostics);

  // Status bar items.
  const statusBar = new StatusBar(bridge, abortRegistry, vaultManager);
  context.subscriptions.push(statusBar);

  // CodeLens above the name: line in request YAMLs.
  const codeLensProvider = new RequestCodeLensProvider();
  context.subscriptions.push(
    vscode.languages.registerCodeLensProvider(
      { scheme: 'apicircle', pattern: '**/requests/*.req.yaml' },
      codeLensProvider,
    ),
  );

  // Environment language services — CodeLens (Set Active / Delete) above
  // the name: line, key:/value: completions, and per-key hover with
  // resolution source + mask warnings.
  context.subscriptions.push(
    vscode.languages.registerCodeLensProvider(
      { scheme: 'apicircle', pattern: '**/environments/*.env.yaml' },
      new EnvironmentCodeLensProvider(),
    ),
    vscode.languages.registerCompletionItemProvider(
      { scheme: 'apicircle', pattern: '**/environments/*.env.yaml' },
      new EnvironmentCompletionProvider(bridge),
      ':',
      ' ',
    ),
    vscode.languages.registerHoverProvider(
      { scheme: 'apicircle', pattern: '**/environments/*.env.yaml' },
      new EnvironmentHoverProvider(bridge),
    ),
    // Plan CodeLens — ▶ Run Plan above the name: line in plan YAMLs.
    vscode.languages.registerCodeLensProvider(
      { scheme: 'apicircle', pattern: '**/plans/*.plan.yaml' },
      new PlanCodeLensProvider(),
    ),
    vscode.languages.registerCompletionItemProvider(
      { scheme: 'apicircle', pattern: '**/plans/*.plan.yaml' },
      new PlanCompletionProvider(bridge),
      ':',
      ' ',
    ),
    vscode.languages.registerHoverProvider(
      { scheme: 'apicircle', pattern: '**/plans/*.plan.yaml' },
      new PlanHoverProvider(bridge),
    ),
    // Mock language services — CodeLens for Start/Stop/Restart, field
    // completions, and hover on name / port / endpoint pathPattern.
    (() => {
      const lens = new MockCodeLensProvider(mockController);
      context.subscriptions.push(lens);
      return vscode.languages.registerCodeLensProvider(
        { scheme: 'apicircle', pattern: '**/mocks/*.mock.yaml' },
        lens,
      );
    })(),
    vscode.languages.registerCompletionItemProvider(
      { scheme: 'apicircle', pattern: '**/mocks/*.mock.yaml' },
      new MockCompletionProvider(),
      ':',
      ' ',
    ),
    vscode.languages.registerHoverProvider(
      { scheme: 'apicircle', pattern: '**/mocks/*.mock.yaml' },
      new MockHoverProvider(bridge, mockController),
    ),
  );

  // Mock status bar — shows "Mocks: N (:port, …)" when ≥1 server is running.
  // P3R2-G1: subscribes to the controller's onChange so it refreshes on
  // start/stop/restart immediately (not just on the watcher's tick).
  const mockStatusBar = new MockStatusBar(bridge, mockController);
  context.subscriptions.push(mockStatusBar);

  // ---- P9: Plan Notebook serializer + controller ----
  // Maps `.apicircle-plan.json` ↔ NotebookData with one cell per step.
  // The controller drives executeRequest for each cell, mirroring the
  // sendRequestCommand path but without persisting to history (notebooks
  // are a scratchpad surface). See `notebook/planNotebookSerializer.ts`
  // and `notebook/planNotebookController.ts`.
  const planNotebookSerializer = new PlanNotebookSerializer((requestId) => {
    if (!bridge) return null;
    const surface = bridge.activeWorkspace();
    if (!surface) return null;
    // The serializer is called synchronously by VS Code, but our bridge
    // exposes async reads. We cache the last-known synced state per
    // workspace via the bridge's listWorkspaces() snapshot when it's
    // available; fall back to null when the workspace hasn't been
    // opened yet.
    try {
      const cached = (
        surface as {
          _lastReadCache?: {
            synced?: {
              collections?: {
                requests?: Record<string, { name: string; method: string; url: string }>;
              };
            };
          };
        }
      )._lastReadCache;
      const req = cached?.synced?.collections?.requests?.[requestId];
      if (req) return { name: req.name, method: req.method, url: req.url };
    } catch {
      // ignore — return null below
    }
    return null;
  });
  context.subscriptions.push(
    vscode.workspace.registerNotebookSerializer('apicircle-plan', planNotebookSerializer, {
      transientOutputs: false,
      transientCellMetadata: {},
      transientDocumentMetadata: {},
    }),
  );
  const planNotebookController = new PlanNotebookController({
    bridge,
    log: runsChannel?.forCategory('plan'),
  });
  context.subscriptions.push(planNotebookController);

  // ---- P9: Assertion Test Controller ----
  // Surfaces every request-with-assertions in the active workspace under
  // VS Code's native Testing tab. Run handler drives executeRequest +
  // runAssertions, reports per-assertion pass/fail via TestRun.
  const assertionTestController = new AssertionTestController({
    bridge,
    log: runsChannel?.forCategory('send'),
  });
  context.subscriptions.push(assertionTestController);

  // ---- P11: Mock endpoint visual editor (webview MVP) ----
  // Opt-in form editor for a single mock endpoint, shared by the
  // MockView's per-endpoint context menu. YAML editing remains the
  // primary path.
  mockEndpointEditor = new MockEndpointEditor(context.extensionUri, {
    bridge,
    onSave: async (formState) => {
      const surface = bridge?.activeWorkspace();
      if (!surface) return { ok: false, error: 'No active workspace.' };
      const state = await surface.read();
      // The editor only knows its endpointId — we have to scan mocks to
      // find the owning server. Mock IDs aren't on the form state because
      // VS Code's webview lifetime can outlive a workspace switch; we
      // re-resolve at save time.
      const owning = Object.values(state.synced.mockServers).find((m) =>
        m.endpoints.some((e) => e.id === formState.endpointId),
      );
      if (!owning) {
        return {
          ok: false,
          error: `No mock server in the active workspace contains endpoint ${formState.endpointId}.`,
        };
      }
      const patched = applyFormStateToMock(owning, formState);
      if (!patched.ok) return patched;
      const result = await surface.apply({ kind: 'mock.upsert', mock: patched.next });
      if (!result) return { ok: false, error: 'applyMutation returned no result.' };
      return { ok: true };
    },
    log: runsChannel?.forCategory('mock'),
  });
  context.subscriptions.push({ dispose: () => mockEndpointEditor?.dispose() });

  // ---- P10: Embedded MCP host ----
  // In-extension MCP server over Streamable HTTP. Off by default; opt-in
  // via `apicircle.mcp.embeddedHost.enabled`. Auto-starts if enabled.
  embeddedMcpHost = new EmbeddedMcpHost(bridge, runsChannel?.forCategory('misc'));
  context.subscriptions.push({ dispose: () => embeddedMcpHost?.dispose() });
  // P10-3: best-effort native registration with VS Code's MCP client
  // surface (Copilot Chat). No-op on engines without
  // `vscode.lm.registerMcpServerDefinitionProvider` — Copilot Chat still
  // picks up `.vscode/mcp.json` via the P6 install command in that case.
  lmMcpRegistration = tryRegisterEmbeddedMcpAsLmProvider(
    embeddedMcpHost,
    runsChannel?.forCategory('misc'),
  );
  if (lmMcpRegistration) {
    context.subscriptions.push(lmMcpRegistration);
  }
  const embeddedEnabledAtBoot = vscode.workspace
    .getConfiguration('apicircle.mcp.embeddedHost')
    .get<boolean>('enabled', false);
  if (embeddedEnabledAtBoot) {
    void embeddedMcpHost
      .start(readEmbeddedMcpOptions())
      .then((info) => {
        runsChannel?.forCategory('misc')(
          `embedded MCP host auto-started on ${info.url} (rotate token via Restart)`,
        );
        views?.mcp.refresh();
      })
      .catch((err) => {
        runsChannel?.forCategory('misc')(
          `embedded MCP host auto-start failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      });
  }

  // Auto-refresh views when external writes hit either workspace file
  // (Git pull, CLI run, MCP server, hand-edit) — synced OR local. Plan
  // create, history append, snapshot capture and env-var rename all write
  // to workspace.local.json, so the synced-only watcher used to miss them.
  // The TreeView re-reads the bridge on every getChildren call so the
  // refresh is "fire change event" and let VS Code re-query.
  //
  // P3R1-G2: also reconcile mock runtime — if a Git pull removed a mock
  // definition while it was running, stop the orphan and clear its entry.
  const refreshAll = () => {
    for (const v of Object.values(views ?? {})) v.refresh();
    void mockController?.reconcile();
  };
  const watcherHandle = registerWorkspaceWatchers({
    syncedGlob: '**/.apicircle/workspace.json',
    localGlob: '**/workspace.local.json',
    onAnyChange: refreshAll,
  });
  context.subscriptions.push(watcherHandle);

  // Initial discovery — register every detected `.apicircle/workspace.json`.
  const discovery = discoverWorkspaces(vscode.workspace.workspaceFolders);
  for (const ws of discovery.workspaces) {
    bridge.registerWorkspace(ws);
  }
  if (discovery.workspaces.length > 0) {
    const previous = context.globalState.get<string>('apicircle.activeWorkspaceId');
    const toActivate =
      discovery.workspaces.find((w) => w.id === previous) ?? discovery.workspaces[0];
    bridge.setActive(toActivate.id);
  }

  // Re-discover when the user adds/removes folders from the workspace.
  context.subscriptions.push(
    vscode.workspace.onDidChangeWorkspaceFolders(() => {
      if (!bridge) return;
      const d = discoverWorkspaces(vscode.workspace.workspaceFolders);
      for (const ws of d.workspaces) {
        bridge.registerWorkspace(ws);
      }
      for (const v of Object.values(views ?? {})) {
        v.refresh();
      }
    }),
  );

  // Commands.
  context.subscriptions.push(
    vscode.commands.registerCommand('apicircle.createWorkspace', () => {
      if (!bridge) return;
      return createWorkspaceCommand(bridge);
    }),
    vscode.commands.registerCommand('apicircle.refresh', () => {
      for (const v of Object.values(views ?? {})) {
        v.refresh();
      }
    }),
    vscode.commands.registerCommand('apicircle.openWorkspaceFile', async () => {
      const active = bridge?.activeWorkspace();
      if (!active) {
        await vscode.window.showInformationMessage(
          'No active APICircle workspace. Run "APICircle: Create New Workspace" first.',
        );
        return;
      }
      const uri = vscode.Uri.file(active.workspace.workspaceJsonPath);
      await vscode.commands.executeCommand('vscode.open', uri);
    }),
    vscode.commands.registerCommand('apicircle.sendRequest', () => {
      if (!bridge || !abortRegistry) return;
      return sendRequestCommand({
        bridge,
        abortRegistry,
        fsProvider,
        diagnostics,
      });
    }),
    vscode.commands.registerCommand(
      'apicircle.deleteRequest',
      (node?: { kind: 'request'; id: string }) => {
        if (!bridge) return;
        return deleteRequestCommand({ bridge }, node);
      },
    ),
    vscode.commands.registerCommand(
      'apicircle.duplicateRequest',
      (node?: { kind: 'request'; id: string }) => {
        if (!bridge) return;
        return duplicateRequestCommand({ bridge }, node);
      },
    ),
    vscode.commands.registerCommand(
      'apicircle.revealInSource',
      (node?: { kind: 'request'; id: string }) => {
        if (!bridge) return;
        return revealInSourceCommand({ bridge }, node);
      },
    ),
    vscode.commands.registerCommand('apicircle.setActiveEnvironment', () => {
      if (!bridge) return;
      return setActiveEnvironmentCommand({ bridge });
    }),
    vscode.commands.registerCommand('apicircle.newEnvironment', () => {
      if (!bridge) return;
      return newEnvironmentCommand({ bridge });
    }),
    vscode.commands.registerCommand(
      'apicircle.deleteEnvironment',
      (node?: { kind: 'env'; name: string }) => {
        if (!bridge) return;
        return deleteEnvironmentCommand({ bridge }, node);
      },
    ),
    vscode.commands.registerCommand('apicircle.captureSnapshot', () => {
      if (!bridge) return;
      return captureSnapshotCommand({ bridge });
    }),
    vscode.commands.registerCommand(
      'apicircle.restoreSnapshot',
      (node?: { kind: 'entry'; id: string }) => {
        if (!bridge) return;
        return restoreSnapshotCommand({ bridge }, node);
      },
    ),
    vscode.commands.registerCommand(
      'apicircle.deleteSnapshot',
      (node?: { kind: 'entry'; id: string }) => {
        if (!bridge) return;
        return deleteSnapshotCommand({ bridge }, node);
      },
    ),
    vscode.commands.registerCommand('apicircle.setSnapshotMaxBytes', () => {
      if (!bridge) return;
      return setSnapshotMaxBytesCommand({ bridge });
    }),
    vscode.commands.registerCommand('apicircle.runPlan', (node?: { kind: 'plan'; id: string }) => {
      if (!bridge || !abortRegistry) return;
      return runPlanCommand({ bridge, abortRegistry }, node);
    }),
    vscode.commands.registerCommand('apicircle.newPlan', () => {
      if (!bridge) return;
      return newPlanCommand({ bridge });
    }),
    vscode.commands.registerCommand('apicircle.setEnvPriorityOrder', () => {
      if (!bridge) return;
      return setEnvPriorityOrderCommand({ bridge });
    }),
    vscode.commands.registerCommand('apicircle.addExtraction', () => {
      if (!bridge) return;
      return addExtractionFromLatestResponseCommand({ bridge });
    }),
    vscode.commands.registerCommand('apicircle.clearAllHistory', () => {
      if (!bridge) return;
      return clearAllHistoryCommand({ bridge });
    }),
    vscode.commands.registerCommand('apicircle.purgeOlderThan', () => {
      if (!bridge) return;
      return purgeOlderThanCommand({ bridge });
    }),
    vscode.commands.registerCommand(
      'apicircle.deleteHistoryRun',
      (node?: { kind: 'request-run' | 'plan-run'; runId: string }) => {
        if (!bridge) return;
        return deleteHistoryRunCommand({ bridge }, node);
      },
    ),
    vscode.commands.registerCommand(
      'apicircle.editVariableValue',
      (node?: { kind: 'variable'; envName: string; key: string }) => {
        if (!bridge) return;
        return editVariableValueCommand({ bridge }, node);
      },
    ),
    vscode.commands.registerCommand(
      'apicircle.deleteVariable',
      (node?: { kind: 'variable'; envName: string; key: string }) => {
        if (!bridge) return;
        return deleteVariableCommand({ bridge }, node);
      },
    ),
    vscode.commands.registerCommand('apicircle.cancelSend', () => {
      if (!abortRegistry) return;
      const count = abortRegistry.cancelAll();
      void vscode.window.showInformationMessage(
        count === 0 ? 'No active sends to cancel.' : `Cancelled ${count} active send(s).`,
      );
    }),
    vscode.commands.registerCommand('apicircle.newRequest', (ctx?: { folderId?: string }) => {
      if (!bridge) return;
      return newRequestCommand({ bridge }, ctx);
    }),
    vscode.commands.registerCommand(
      'apicircle.deleteFolder',
      (node?: { kind: 'folder'; id: string }) => {
        if (!bridge) return;
        return deleteFolderCommand({ bridge }, node);
      },
    ),
    vscode.commands.registerCommand(
      'apicircle.newRequestInFolder',
      (node?: { kind: 'folder'; id: string }) => {
        if (!bridge) return;
        return newRequestInFolderCommand({ bridge }, node);
      },
    ),
    vscode.commands.registerCommand(
      'apicircle.toggleStepEnabled',
      (node?: { kind: 'step' | 'step-disabled'; planId: string; stepIndex: number }) => {
        if (!bridge) return;
        return toggleStepEnabledCommand({ bridge }, node);
      },
    ),
    vscode.commands.registerCommand(
      'apicircle.removeStepFromPlan',
      (node?: { kind: 'step' | 'step-disabled'; planId: string; stepIndex: number }) => {
        if (!bridge) return;
        return removeStepFromPlanCommand({ bridge }, node);
      },
    ),
    vscode.commands.registerCommand('apicircle.newMock', () => {
      if (!bridge || !mockController) return;
      return newMockCommand({ bridge, controller: mockController });
    }),
    vscode.commands.registerCommand(
      'apicircle.startMock',
      (node?: { kind: 'server' | 'mock-running' | 'mock-idle'; id: string }) => {
        if (!bridge || !mockController) return;
        return startMockCommand({ bridge, controller: mockController }, node);
      },
    ),
    vscode.commands.registerCommand(
      'apicircle.stopMock',
      (node?: { kind: 'server' | 'mock-running' | 'mock-idle'; id: string }) => {
        if (!bridge || !mockController) return;
        return stopMockCommand({ bridge, controller: mockController }, node);
      },
    ),
    vscode.commands.registerCommand(
      'apicircle.restartMock',
      (node?: { kind: 'server' | 'mock-running' | 'mock-idle'; id: string }) => {
        if (!bridge || !mockController) return;
        return restartMockCommand({ bridge, controller: mockController }, node);
      },
    ),
    vscode.commands.registerCommand(
      'apicircle.deleteMock',
      (node?: { kind: 'server' | 'mock-running' | 'mock-idle'; id: string }) => {
        if (!bridge || !mockController) return;
        return deleteMockCommand({ bridge, controller: mockController }, node);
      },
    ),
    vscode.commands.registerCommand(
      'apicircle.copyEndpointPath',
      (node?: { kind: 'endpoint'; serverId: string; endpointId: string }) => {
        if (!bridge || !mockController) return;
        return copyEndpointPathCommand({ bridge, controller: mockController }, node);
      },
    ),
    vscode.commands.registerCommand(
      'apicircle.revealEndpointInMockYaml',
      (node?: { kind: 'endpoint'; serverId: string; endpointId: string }) => {
        if (!bridge || !mockController) return;
        return revealEndpointInMockYamlCommand({ bridge, controller: mockController }, node);
      },
    ),
    vscode.commands.registerCommand(
      'apicircle.openMockInBrowser',
      (node?: { kind: 'server' | 'mock-running' | 'mock-idle'; id: string }) => {
        if (!bridge || !mockController) return;
        return openMockInBrowserCommand({ bridge, controller: mockController }, node);
      },
    ),
    // ---- P11 Mock endpoint visual editor ----
    vscode.commands.registerCommand(
      'apicircle.editMockEndpoint',
      (arg?: {
        kind?: 'endpoint' | 'mock-endpoint';
        serverId?: string;
        mockId?: string;
        endpointId?: string;
      }) => {
        if (!bridge || !mockEndpointEditor) return;
        return editMockEndpointCommand({ bridge, editor: mockEndpointEditor }, arg);
      },
    ),
    // ---- P4 vault commands ----
    vscode.commands.registerCommand('apicircle.unlockVault', () => {
      if (!bridge || !vaultManager) return;
      return unlockVaultCommand(buildVaultDeps(bridge, vaultManager, context, runsChannel));
    }),
    vscode.commands.registerCommand('apicircle.lockVault', () => {
      if (!bridge || !vaultManager) return;
      lockVaultCommand(buildVaultDeps(bridge, vaultManager, context, runsChannel));
    }),
    vscode.commands.registerCommand('apicircle.setupVaultPassphrase', () => {
      if (!bridge || !vaultManager) return;
      return setupVaultPassphraseCommand(
        buildVaultDeps(bridge, vaultManager, context, runsChannel),
      );
    }),
    vscode.commands.registerCommand('apicircle.changeVaultPassphrase', () => {
      if (!bridge || !vaultManager) return;
      return changeVaultPassphraseCommand(
        buildVaultDeps(bridge, vaultManager, context, runsChannel),
      );
    }),
    vscode.commands.registerCommand(
      'apicircle.openVaultEntry',
      (node?: { kind: 'variable' | 'variable-encrypted'; envName: string; key: string }) => {
        if (!bridge || !vaultManager) return;
        const cfg = vscode.workspace.getConfiguration('apicircle.secrets');
        return openVaultEntryCommand(
          buildVaultDeps(bridge, vaultManager, context, runsChannel),
          { clipboardClearSeconds: cfg.get<number>('clipboardClearSeconds', 30) },
          node,
        );
      },
    ),
    // ---- P8 vault remember-on-device ----
    vscode.commands.registerCommand('apicircle.forgetVaultOnDevice', () => {
      if (!bridge || !vaultManager) return;
      return forgetVaultOnDeviceCommand(buildVaultDeps(bridge, vaultManager, context, runsChannel));
    }),
    // ---- P9 Plan-as-Notebook ----
    vscode.commands.registerCommand(
      'apicircle.openPlanAsNotebook',
      (arg?: { kind?: 'plan'; planId?: string }) => {
        if (!bridge) return;
        return openPlanAsNotebookCommand({ bridge, log: runsChannel?.forCategory('plan') }, arg);
      },
    ),
    // ---- P10 Embedded MCP host ----
    vscode.commands.registerCommand('apicircle.startEmbeddedMcp', () => {
      if (!embeddedMcpHost) return;
      return startEmbeddedMcpCommand({
        host: embeddedMcpHost,
        getOptions: readEmbeddedMcpOptions,
        onChanged: () => views?.mcp.refresh(),
        log: runsChannel?.forCategory('misc'),
      });
    }),
    vscode.commands.registerCommand('apicircle.stopEmbeddedMcp', () => {
      if (!embeddedMcpHost) return;
      return stopEmbeddedMcpCommand({
        host: embeddedMcpHost,
        getOptions: readEmbeddedMcpOptions,
        onChanged: () => views?.mcp.refresh(),
        log: runsChannel?.forCategory('misc'),
      });
    }),
    vscode.commands.registerCommand('apicircle.restartEmbeddedMcp', () => {
      if (!embeddedMcpHost) return;
      return restartEmbeddedMcpCommand({
        host: embeddedMcpHost,
        getOptions: readEmbeddedMcpOptions,
        onChanged: () => views?.mcp.refresh(),
        log: runsChannel?.forCategory('misc'),
      });
    }),
    vscode.commands.registerCommand('apicircle.copyEmbeddedMcpUrl', () => {
      if (!embeddedMcpHost) return;
      return copyEmbeddedMcpUrlCommand({
        host: embeddedMcpHost,
        getOptions: readEmbeddedMcpOptions,
        onChanged: () => views?.mcp.refresh(),
        log: runsChannel?.forCategory('misc'),
      });
    }),
    vscode.commands.registerCommand('apicircle.showRunsChannel', () => {
      runsChannel?.reveal();
    }),
    // ---- P5 MCP commands ----
    vscode.commands.registerCommand(
      'apicircle.copyMcpConfig',
      (node?: { kind: 'client'; client: AiClient }) => {
        if (!mcpManager) return;
        return copyMcpConfigCommand(
          { mcp: mcpManager, log: runsChannel?.forCategory('misc') },
          node,
        );
      },
    ),
    vscode.commands.registerCommand(
      'apicircle.openMcpConfigFile',
      (node?: { kind: 'client'; client: AiClient }) => {
        if (!mcpManager) return;
        return openMcpConfigFileCommand(
          { mcp: mcpManager, log: runsChannel?.forCategory('misc') },
          node,
        );
      },
    ),
    vscode.commands.registerCommand('apicircle.openMcpConnectGuide', () => {
      return openMcpConnectGuideCommand();
    }),
    vscode.commands.registerCommand('apicircle.revealMcpBinaryInfo', () => {
      if (!mcpManager) return;
      return revealMcpBinaryInfoCommand({
        mcp: mcpManager,
        log: runsChannel?.forCategory('misc'),
      });
    }),
    // ---- P6: Copilot Chat / VS Code MCP integration ----
    vscode.commands.registerCommand('apicircle.installCopilotMcpConfig', () => {
      if (!mcpManager) return;
      return installCopilotMcpConfigCommand({
        mcp: mcpManager,
        getRelativeConfigPath: () =>
          vscode.workspace
            .getConfiguration('apicircle.mcp')
            .get<string>('workspaceConfigPath', '.vscode/mcp.json'),
        // P6R1-G8: refresh the McpView so the Copilot row flips
        // immediately after install/update.
        onInstalled: () => views?.mcp.refresh(),
        log: runsChannel?.forCategory('misc'),
      });
    }),
    // ---- P8: multi-AI-client MCP install ----
    vscode.commands.registerCommand(
      'apicircle.installMcpForClient',
      (clientArg?: InstallableClient) => {
        if (!mcpManager) return;
        if (!clientArg || !INSTALLABLE_CLIENTS.includes(clientArg)) {
          return vscode.window
            .showQuickPick(
              INSTALLABLE_CLIENTS.map((c) => ({ label: c, value: c })),
              { title: 'Install APICircle MCP for which client?' },
            )
            .then((pick) => {
              if (!pick) return;
              return installMcpForClientCommand(
                {
                  mcp: mcpManager!,
                  getAutoConfigureClients: readAutoConfigureClients,
                  onChanged: () => views?.mcp.refresh(),
                  log: runsChannel?.forCategory('misc'),
                },
                pick.value,
              );
            });
        }
        return installMcpForClientCommand(
          {
            mcp: mcpManager,
            getAutoConfigureClients: readAutoConfigureClients,
            onChanged: () => views?.mcp.refresh(),
            log: runsChannel?.forCategory('misc'),
          },
          clientArg,
        );
      },
    ),
    vscode.commands.registerCommand('apicircle.installMcpForAllClients', () => {
      if (!mcpManager) return;
      return installMcpForAllClientsCommand({
        mcp: mcpManager,
        getAutoConfigureClients: readAutoConfigureClients,
        onChanged: () => views?.mcp.refresh(),
        log: runsChannel?.forCategory('misc'),
      });
    }),
    vscode.commands.registerCommand(
      'apicircle.uninstallMcpForClient',
      (clientArg?: InstallableClient) => {
        if (!mcpManager || !clientArg || !INSTALLABLE_CLIENTS.includes(clientArg)) return;
        return uninstallMcpForClientCommand(
          {
            mcp: mcpManager,
            getAutoConfigureClients: readAutoConfigureClients,
            onChanged: () => views?.mcp.refresh(),
            log: runsChannel?.forCategory('misc'),
          },
          clientArg,
        );
      },
    ),
  );

  // ---- P8: shared VaultActionsDeps builder ----
  // Threads SecretStorage + the rememberOnDevice setting through every
  // vault command so unlock/setup/change paths all consult the same
  // policy. Pulled out so adding a new vault command doesn't risk a
  // missed wire-up.
  function buildVaultDeps(
    _bridge: typeof bridge,
    _vault: typeof vaultManager,
    _ctx: vscode.ExtensionContext,
    _runs: typeof runsChannel,
  ): VaultActionsDeps {
    if (!_bridge || !_vault) {
      throw new Error('buildVaultDeps: bridge or vault not initialised');
    }
    return {
      bridge: _bridge,
      vault: _vault,
      secrets: _ctx.secrets,
      getRememberOnDevice: () =>
        vscode.workspace
          .getConfiguration('apicircle.secrets')
          .get<boolean>('rememberOnDevice', false),
      log: _runs?.forCategory('vault'),
    };
  }

  // ---- P10: setting reader for embedded MCP host ----
  function readEmbeddedMcpOptions(): { port: number; bindHost: string } {
    const cfg = vscode.workspace.getConfiguration('apicircle.mcp.embeddedHost');
    return {
      port: cfg.get<number>('port', 0),
      bindHost: cfg.get<string>('bindHost', '127.0.0.1'),
    };
  }

  // ---- P8: setting reader for autoConfigureClients ----
  function readAutoConfigureClients(): readonly InstallableClient[] {
    const raw = vscode.workspace
      .getConfiguration('apicircle.mcp')
      .get<readonly string[]>('autoConfigureClients', []);
    return raw.filter((c): c is InstallableClient =>
      (INSTALLABLE_CLIENTS as readonly string[]).includes(c),
    );
  }

  // ---- P8: silent-unlock pass at activation ----
  // For every registered workspace, attempt to read a stored passphrase and
  // unlock the vault silently. Best-effort; failures roll back to the normal
  // passphrase prompt on first secret access.
  void (async () => {
    if (!bridge || !vaultManager) return;
    const deps = buildVaultDeps(bridge, vaultManager, context, runsChannel);
    for (const surface of bridge.listWorkspaces()) {
      try {
        await silentUnlockFromDevice(deps, surface.workspace.id);
      } catch (err) {
        runsChannel?.forCategory('vault')(
          `silentUnlock(${surface.workspace.id}) threw: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
  })();

  // Refresh the MCP view when the active workspace changes (the view
  // surfaces per-workspace `apicircleDir` so a switch alters every
  // snippet). Tied to the bridge event so workspace changes propagate
  // without polling.
  context.subscriptions.push(
    bridge.onDidChangeActiveWorkspace(() => {
      views?.mcp.refresh();
    }),
  );
}

export async function deactivate(): Promise<void> {
  abortRegistry?.cancelAll();
  abortRegistry = null;
  // P3R2-G3: await disposeAll so the bridge stays alive while runtime
  // entries are cleared. Without the await, the bridge.dispose() below
  // raced with in-flight surface.write() calls and the mocks didn't
  // shut down cleanly. VS Code accepts a Promise return from deactivate
  // and waits up to ~5 seconds before forcing shutdown.
  if (mockController) {
    await mockController.disposeAll();
    mockController = null;
  }
  vaultManager?.lockAll();
  vaultManager = null;
  // P10: stop the embedded MCP host cleanly on shutdown. We `await` so a
  // VS Code reload that races shutdown doesn't leave the socket bound.
  if (embeddedMcpHost) {
    await embeddedMcpHost.stop();
    embeddedMcpHost = null;
  }
  // P5: McpManager is stateless — no dispose needed; just clear the
  // module ref so a re-activate gets a fresh instance.
  mcpManager = null;
  runsChannel?.dispose();
  runsChannel = null;
  bridge?.dispose();
  bridge = null;
  views = null;
}

// Test-only export for unit/integration tests.
export function __getInternalsForTests() {
  return { bridge, views, abortRegistry };
}
