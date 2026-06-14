import * as vscode from 'vscode';
import { VsCodeBridge } from './host/vscodeBridge';
import {
  discoverRegistryWorkspaces,
  discoverWorkspaces,
  workspaceIdForOpenEditor,
} from './util/workspaceDiscovery';
import { EditorView } from './views/EditorView';
import { EnvironmentView } from './views/EnvironmentView';
import { ExecutionView } from './views/ExecutionView';
import { MockView } from './views/MockView';
import { HistoryView } from './views/HistoryView';
import { McpView } from './views/McpView';
import { LinkWorkspaceView } from './views/LinkWorkspaceView';
import { SnapshotsView } from './views/SnapshotsView';
import { WorkspaceView } from './views/WorkspaceView';
import { switchWorkspaceCommand } from './commands/switchWorkspace';
import { createWorkspaceCommand } from './commands/createWorkspace';
import { ApicircleFsProvider } from './fs/apicircleFsProvider';
import { uriEntityKind, type UriEntityKind } from './fs/uriKind';
import { AbortRegistry } from './execute/abortRegistry';
import { InFlightSendTracker } from './execute/inFlightTracker';
import { sendRequestCommand } from './execute/sendRequest';
import { cancelOneSendCommand } from './commands/cancelRequestSend';
import { PreSendDiagnostics } from './diagnostics/preSendDiagnostics';
import { StatusBar } from './status/statusBar';
import { newRequestCommand } from './commands/newRequest';
import { newRequestFromTemplateCommand } from './commands/newRequestFromTemplate';
import { addRequestSectionCommand } from './commands/addRequestSection';
import {
  switchRequestBodyTypeCommand,
  switchRequestAuthTypeCommand,
} from './commands/switchRequestSection';
import { pickBinaryAttachmentCommand } from './commands/binaryAttachment';
import {
  addFormDataRowCommand,
  switchFormDataRowKindCommand,
  pickFormDataRowFileCommand,
} from './commands/formDataRow';
import { pickHeaderCommand } from './commands/pickHeader';
import { mapContextVarsFromJsonCommand } from './commands/mapContextVarsFromJson';
import { fetchOAuth2TokenCommand } from './commands/fetchOAuth2Token';
import {
  addQueryRowCommand,
  addCookieRowCommand,
  addPathParamRowCommand,
  addAssertionRowCommand,
  addExtractionRowCommand,
} from './commands/addRequestRows';
import {
  addMockValidationRuleCommand,
  setMockValidationKindCommand,
  setMockValidationTargetCommand,
  setMockValidationExpectedCommand,
  addMockMultiplierCommand,
  switchMockResponseBodyTypeCommand,
  setMockResponseStatusCommand,
  addMockResponseRuleCommand,
  removeMockResponseRuleCommand,
  removeMockValidationRuleCommand,
  removeMockMultiplierCommand,
  toggleMockRuleEnabledCommand,
  addMockResponseHeaderCommand,
} from './commands/mockEndpointEdits';
import {
  setMockMethodFieldCommand,
  setMockStatusFieldCommand,
  setMockBodyTypeFieldCommand,
  setMockHeaderKeyFieldCommand,
  setMockHeaderValueFieldCommand,
  setMockClauseScopeFieldCommand,
  setMockClauseOpFieldCommand,
  setMockClauseTargetFieldCommand,
  setMockClauseValueFieldCommand,
  toggleMockHeaderEnabledCommand,
  addMockConditionClauseCommand,
  setMockMultiplierKindFieldCommand,
  setMockMultiplierKeyFieldCommand,
  setMockMultiplierTargetPathFieldCommand,
  setMockTextFieldCommand,
  setMockNumberFieldCommand,
} from './commands/mockFieldEdits';
import { formatJsonCommand } from './commands/formatJson';
import {
  setRequestMethodFieldCommand,
  setRequestHeaderKeyFieldCommand,
  setRequestHeaderValueFieldCommand,
  setRequestTextFieldCommand,
  setRequestAssertionKindFieldCommand,
  setRequestAssertionOpFieldCommand,
  setRequestAssertionTargetFieldCommand,
  setRequestAssertionExpectedFieldCommand,
  setRequestAuthFieldCommand,
  setRequestExtractionSourceFieldCommand,
  setRequestFieldEditsBridge,
  toggleRequestRowEnabledCommand,
} from './commands/requestFieldEdits';
import {
  addMockRequestSchemaCommand,
  addMockRequestSchemaParamCommand,
  addMockRequestSchemaBodyExampleCommand,
  setMockParamTypeFieldCommand,
  type RequestSchemaParamKind,
} from './commands/mockRequestSchemaEdits';
import { EndpointCodeLensProvider } from './lang/endpointCodeLens';
import { registerApicircleDiagnostics } from './lang/diagnostics';
import { RequestCodeLensProvider } from './lang/requestCodeLens';
import { FolderCodeLensProvider } from './lang/folderCodeLens';
import { FolderCompletionProvider } from './lang/folderCompletion';
import { InheritAuthHoverProvider } from './lang/folderHover';
import { registerRequestSyncOnSave } from './lang/requestSyncOnSave';
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
import {
  deleteFolderCommand,
  newFolderCommand,
  newRequestInFolderCommand,
  openFolderYamlCommand,
} from './commands/folderActions';
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
  openMockEndpointYamlCommand,
  setMockPortCommand,
} from './commands/mockActions';
import { VsCodeMockController } from './host/vscodeMockController';
import { MockCodeLensProvider } from './lang/mockCodeLens';
import { MockCompletionProvider } from './lang/mockCompletion';
import { MockHoverProvider } from './lang/mockHover';
import { ReleasesCodeLensProvider } from './lang/releasesCodeLens';
import { ResponseCodeLensProvider, formatResponseJsonCommand } from './lang/responseCodeLens';
import {
  openReleaseHistoryCommand,
  publishReleaseCommand,
  deprecateReleaseCommand,
  withdrawReleaseCommand,
} from './commands/releaseActions';
import { LinkCodeLensProvider } from './lang/linkCodeLens';
import {
  setLinkNameFieldCommand,
  setLinkDescriptionFieldCommand,
  setLinkPinnedVersionFieldCommand,
  setLinkScopeFieldCommand,
  setLinkSessionModeFieldCommand,
  addLinkRequiredKeyCommand,
  removeLinkRequiredKeyCommand,
  unlinkWorkspaceCommand,
  showLinkedChangelogCommand,
  openLinkYamlCommand,
  linkWorkspaceCommand,
  searchMarketplaceCommand,
  refreshLinkedWorkspaceCommand,
  reviewLinkedUpdateCommand,
  setLinkSessionTokenCommand,
  clearLinkSessionTokenCommand,
  openLinkedRequestCommand,
  resetLinkedRequestCommand,
  discardLinkedModsCommand,
  provisionLinkedSecretCommand,
  clearLinkedSecretCommand,
  setLinkedEnvVarOverrideCommand,
  type LinkArg,
} from './commands/linkActions';
import { LinkedRequestCodeLensProvider } from './lang/linkedRequestCodeLens';
import { tagReleaseCommand, editRepoTopicsCommand } from './commands/repoActions';
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
  openMcpConfigFileCommand,
  openMcpConnectGuideCommand,
  revealMcpBinaryInfoCommand,
} from './commands/mcpActions';
import {
  installCopilotMcpConfigCommand,
  uninstallCopilotMcpConfigCommand,
} from './commands/copilotMcpActions';
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
  coerceInstallableClientArg,
} from './commands/mcpClientActions';
import {
  INSTALLABLE_CLIENTS,
  detectClientMcpConfigState,
  type InstallableClient,
} from './host/mcpClientInstall';

// =============================================================================
// API Circle Studio — VS Code extension entry point.
//
// activate() wires up:
//   • The nine sidebar TreeViews (Workspace, Editor, Environment, etc.)
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
let inFlightTracker: InFlightSendTracker | null = null;
let mockController: VsCodeMockController | null = null;
let vaultManager: VsCodeVaultManager | null = null;
let runsChannel: RunsChannel | null = null;
let mcpManager: VsCodeMcpManager | null = null;
let embeddedMcpHost: EmbeddedMcpHost | null = null;
let lmMcpRegistration: ProposedMcpRegistration | null = null;
let mockEndpointEditor: MockEndpointEditor | null = null;
let views: {
  workspace: WorkspaceView;
  editor: EditorView;
  environment: EnvironmentView;
  execution: ExecutionView;
  mock: MockView;
  history: HistoryView;
  snapshots: SnapshotsView;
  mcp: McpView;
  linkWorkspaces: LinkWorkspaceView;
} | null = null;

export function activate(context: vscode.ExtensionContext): void {
  bridge = new VsCodeBridge(context);
  // The ◆ Expected / ◆ Target lenses on json-path assertions reach into the
  // latest response via the bridge. Wire it up here; null in tests / before
  // activation degrades to free-text input.
  setRequestFieldEditsBridge(bridge);
  abortRegistry = new AbortRegistry();
  inFlightTracker = new InFlightSendTracker();
  context.subscriptions.push(inFlightTracker);

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
    workspace: new WorkspaceView(bridge),
    editor: new EditorView(bridge),
    environment: new EnvironmentView(bridge, vaultManager),
    execution: new ExecutionView(bridge),
    mock: new MockView(bridge),
    history: new HistoryView(bridge, fsProvider),
    snapshots: new SnapshotsView(bridge),
    mcp: new McpView(mcpManager, (client) => {
      const paths = mcpManager!.resolvePaths();
      if (!paths.hasActiveWorkspace) return 'absent';
      return detectClientMcpConfigState({
        client,
        binary: paths.binary,
        apicircleDir: paths.workspace,
      });
    }),
    linkWorkspaces: new LinkWorkspaceView(bridge),
  };
  for (const v of Object.values(views)) {
    v.register(context);
  }

  // Refresh all views when the active workspace changes (e.g. via switchWorkspace).
  context.subscriptions.push({
    dispose: bridge.onDidChangeActiveWorkspace(() => {
      for (const v of Object.values(views ?? {})) v.refresh();
    }).dispose,
  });
  context.subscriptions.push(
    vscode.workspace.registerFileSystemProvider('apicircle', fsProvider, {
      isCaseSensitive: true,
      isReadonly: false,
    }),
    // Set the custom language mode on apicircle:// documents so the correct
    // TextMate grammar fires. Without compound extensions (.req.yaml etc.) the
    // FS provider emits plain .yaml — VS Code defaults to `yaml`, and this
    // handler overrides based on the URI path prefix.
    vscode.workspace.onDidOpenTextDocument((doc) => {
      if (doc.uri.scheme !== 'apicircle') return;
      const kind = uriEntityKind(doc.uri);
      const langMap: Record<UriEntityKind, string> = {
        request: 'apicircle-request',
        response: 'apicircle-response',
        environment: 'apicircle-environment',
        plan: 'apicircle-plan',
        mock: 'apicircle-mock',
        endpoint: 'apicircle-endpoint',
        folder: 'apicircle-folder',
        link: 'apicircle-link',
        releases: 'apicircle-releases',
      };
      const lang = kind ? langMap[kind] : undefined;
      if (lang && doc.languageId !== lang) {
        void vscode.languages.setTextDocumentLanguage(doc, lang);
      }
    }),
    // Completion provider for the apicircle-request language.
    vscode.languages.registerCompletionItemProvider(
      { scheme: 'apicircle', pattern: '**/requests/**/*.yaml' },
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

  // CodeLens above the name: line in request YAMLs. The provider is wired to
  // the in-flight tracker so a running send swaps ▶ Send → ⏳ Sending… · ✖ Cancel
  // automatically — no extra refresh wiring at the call site.
  // The bridge is passed so the provider can resolve `auth: inherit` requests
  // against the active workspace's folder chain and surface a "◆ Inherits
  // from <Folder> (<type>)" lens that opens the source folder YAML. The
  // fsProvider hook fires onDidChangeCodeLenses when a folder YAML changes
  // so the inherited-auth lens picks up upstream edits without a buffer
  // touch on the request side.
  const codeLensProvider = new RequestCodeLensProvider(inFlightTracker, bridge, fsProvider);
  context.subscriptions.push(
    codeLensProvider,
    vscode.languages.registerCodeLensProvider(
      { scheme: 'apicircle', pattern: '**/requests/**/*.yaml' },
      codeLensProvider,
    ),
    // Rewrite the buffer to the canonical projection on save so the URL ↔
    // query / pathParams sync (parseRequestFromYaml) appears immediately on
    // Ctrl+S instead of only on doc reopen.
    registerRequestSyncOnSave(),
  );

  // CodeLens for folder YAML — ✚ New request in this folder + 🔑 Switch
  // auth type… (reuses the existing apicircle.switchRequestAuthType command).
  // The same provider also handles read-only linked folder YAML, where the
  // auth-switch lens is moot but the OAuth2 Get-token + name-row request
  // affordances would be meaningless — the provider's regex won't match
  // anything actionable on a linked snapshot, which is fine.
  const folderCodeLensProvider = new FolderCodeLensProvider();
  context.subscriptions.push(
    folderCodeLensProvider,
    vscode.languages.registerCodeLensProvider(
      { scheme: 'apicircle', pattern: '**/folders/**/*.yaml' },
      folderCodeLensProvider,
    ),
    // Also fire the inherited-auth lens on linked request YAMLs so the
    // consumer can see + jump to the source folder's auth.
    vscode.languages.registerCodeLensProvider(
      { scheme: 'apicircle', pattern: '**/linked/**/*.yaml' },
      codeLensProvider,
    ),
    // Completion for `auth: { type: <cursor> }` inside folder YAML — surfaces
    // all 17 RequestAuth types with their detail strings.
    vscode.languages.registerCompletionItemProvider(
      { scheme: 'apicircle', pattern: '**/folders/**/*.yaml' },
      new FolderCompletionProvider(),
      ':',
      ' ',
    ),
    // Inherit-aware hover — resolves `auth: inherit` on request YAMLs and
    // previews descendant resolution on folder YAMLs.
    vscode.languages.registerHoverProvider(
      [
        { scheme: 'apicircle', pattern: '**/folders/**/*.yaml' },
        { scheme: 'apicircle', pattern: '**/requests/**/*.yaml' },
        { scheme: 'apicircle', pattern: '**/linked/**/*.yaml' },
      ],
      new InheritAuthHoverProvider(bridge),
    ),
  );

  // Environment language services — CodeLens (Set Active / Delete) above
  // the name: line, key:/value: completions, and per-key hover with
  // resolution source + mask warnings.
  context.subscriptions.push(
    vscode.languages.registerCodeLensProvider(
      { scheme: 'apicircle', pattern: '**/environments/*.yaml' },
      new EnvironmentCodeLensProvider(),
    ),
    vscode.languages.registerCompletionItemProvider(
      { scheme: 'apicircle', pattern: '**/environments/*.yaml' },
      new EnvironmentCompletionProvider(bridge),
      ':',
      ' ',
    ),
    vscode.languages.registerHoverProvider(
      { scheme: 'apicircle', pattern: '**/environments/*.yaml' },
      new EnvironmentHoverProvider(bridge),
    ),
    // Plan CodeLens — ▶ Run Plan above the name: line in plan YAMLs.
    vscode.languages.registerCodeLensProvider(
      { scheme: 'apicircle', pattern: '**/plans/*.yaml' },
      new PlanCodeLensProvider(),
    ),
    vscode.languages.registerCompletionItemProvider(
      { scheme: 'apicircle', pattern: '**/plans/*.yaml' },
      new PlanCompletionProvider(bridge),
      ':',
      ' ',
    ),
    vscode.languages.registerHoverProvider(
      { scheme: 'apicircle', pattern: '**/plans/*.yaml' },
      new PlanHoverProvider(bridge),
    ),
    // Mock language services — CodeLens for Start/Stop/Restart, field
    // completions, and hover on name / port / endpoint pathPattern.
    (() => {
      const lens = new MockCodeLensProvider(mockController);
      context.subscriptions.push(lens);
      return vscode.languages.registerCodeLensProvider(
        { scheme: 'apicircle', pattern: '**/mocks/*.yaml' },
        lens,
      );
    })(),
    vscode.languages.registerCompletionItemProvider(
      { scheme: 'apicircle', pattern: '**/mocks/*.yaml' },
      new MockCompletionProvider(),
      ':',
      ' ',
    ),
    vscode.languages.registerHoverProvider(
      { scheme: 'apicircle', pattern: '**/mocks/*.yaml' },
      new MockHoverProvider(bridge, mockController),
    ),
    // Per-endpoint YAML CodeLens — fires for apicircle://<ws>/mocks/<mockSlug>/<endpointSlug>.yaml
    (() => {
      const provider = new EndpointCodeLensProvider();
      context.subscriptions.push(provider);
      return vscode.languages.registerCodeLensProvider(
        { scheme: 'apicircle', pattern: '**/mocks/*/*.yaml' },
        provider,
      );
    })(),
    // Release-ledger CodeLens — ▶ Publish on the currentVersion line and
    // ⚠ Deprecate / ⛔ Withdraw on each version row in the read-only
    // releases.yaml view.
    (() => {
      const provider = new ReleasesCodeLensProvider();
      context.subscriptions.push(provider);
      return vscode.languages.registerCodeLensProvider(
        { scheme: 'apicircle', pattern: '**/releases/releases.yaml' },
        provider,
      );
    })(),
    // Linked-workspace CodeLens — ◆ field editors + ⟳ Refresh / 📓 Changelog /
    // ⊗ Unlink actions on link YAML documents.
    (() => {
      const provider = new LinkCodeLensProvider();
      context.subscriptions.push(provider);
      return vscode.languages.registerCodeLensProvider(
        { scheme: 'apicircle', pattern: '**/links/*.yaml' },
        provider,
      );
    })(),
    // Linked-request CodeLens — ▶ Send / ↺ Reset on /linked/**/*.yaml.
    (() => {
      const provider = new LinkedRequestCodeLensProvider();
      context.subscriptions.push(provider);
      return vscode.languages.registerCodeLensProvider(
        { scheme: 'apicircle', pattern: '**/linked/**/*.yaml' },
        provider,
      );
    })(),
    // Response document CodeLens — ⟳ Format JSON on the body section header.
    (() => {
      const provider = new ResponseCodeLensProvider();
      context.subscriptions.push(provider);
      return vscode.languages.registerCodeLensProvider(
        { scheme: 'apicircle', pattern: '**/responses/*.yaml' },
        provider,
      );
    })(),
  );

  // Structural diagnostics — surface parse errors (red, save-blocking) +
  // coercible warnings (yellow) on apicircle:// endpoint / mock / request YAML
  // before the user saves. Mirrors the FS provider's save-time validation.
  registerApicircleDiagnostics(context);

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
    // The watcher's `**/.apicircle/workspace.json` glob fires on CREATE
    // events too — re-discover so a workspace.json that appeared after
    // activation (Git pull, scaffold-via-CLI, hand-mkdir) registers with
    // the bridge and flips the welcome view.
    rediscoverAndRegister(context);
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
  rediscoverAndRegister(context);

  // Startup: if VS Code restored an editor that belongs to an APICircle
  // workspace (an apicircle:// virtual YAML or the raw .apicircle/workspace.json),
  // make that workspace the active one so the sidebar matches what's on screen.
  adoptActiveWorkspaceFromOpenEditors();

  // Re-discover when the user adds/removes folders from the workspace.
  context.subscriptions.push(
    vscode.workspace.onDidChangeWorkspaceFolders(() => {
      if (!bridge) return;
      rediscoverAndRegister(context);
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
    switchWorkspaceCommand(bridge),
    vscode.commands.registerCommand('apicircle.refresh', () => {
      // Re-discover first so a workspace.json created (or a folder added)
      // after activation is picked up — the prior implementation only
      // re-fired the tree-data event, making the refresh button feel
      // broken for that case.
      rediscoverAndRegister(context);
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
        tracker: inFlightTracker ?? undefined,
        fsProvider,
        diagnostics,
        vault: vaultManager ?? null,
        secrets: context.secrets,
      });
    }),
    vscode.commands.registerCommand('apicircle.cancelOneSend', (uri?: vscode.Uri) => {
      if (!abortRegistry || !inFlightTracker) return;
      return cancelOneSendCommand({ abortRegistry, tracker: inFlightTracker }, uri);
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
    vscode.commands.registerCommand('apicircle.newRequestFromTemplate', () => {
      if (!bridge) return;
      return newRequestFromTemplateCommand({ bridge });
    }),
    vscode.commands.registerCommand('apicircle.addRequestSection', (uri?: vscode.Uri) => {
      return addRequestSectionCommand(uri);
    }),
    vscode.commands.registerCommand('apicircle.switchRequestBodyType', (uri?: vscode.Uri) => {
      return switchRequestBodyTypeCommand(uri);
    }),
    vscode.commands.registerCommand('apicircle.switchRequestAuthType', (uri?: vscode.Uri) => {
      return switchRequestAuthTypeCommand(uri);
    }),
    vscode.commands.registerCommand('apicircle.pickBinaryAttachment', (uri?: vscode.Uri) => {
      if (!bridge) return;
      return pickBinaryAttachmentCommand({ bridge }, uri);
    }),
    vscode.commands.registerCommand(
      'apicircle.addFormDataRow',
      (uri?: vscode.Uri, kind?: 'text' | 'file') => {
        if (!bridge) return;
        return addFormDataRowCommand({ bridge }, uri, kind === 'file' ? 'file' : 'text');
      },
    ),
    vscode.commands.registerCommand(
      'apicircle.switchFormDataRowKind',
      (uri?: vscode.Uri, rowIndex?: number) => {
        if (!bridge) return;
        return switchFormDataRowKindCommand({ bridge }, uri, rowIndex);
      },
    ),
    vscode.commands.registerCommand(
      'apicircle.pickFormDataRowFile',
      (uri?: vscode.Uri, rowIndex?: number) => {
        if (!bridge) return;
        return pickFormDataRowFileCommand({ bridge }, uri, rowIndex);
      },
    ),
    vscode.commands.registerCommand('apicircle.pickHeader', (uri?: vscode.Uri) => {
      return pickHeaderCommand(uri);
    }),
    vscode.commands.registerCommand('apicircle.mapContextVarsFromJson', (uri?: vscode.Uri) => {
      return mapContextVarsFromJsonCommand(uri);
    }),
    vscode.commands.registerCommand('apicircle.fetchOAuth2Token', (uri?: vscode.Uri) => {
      return fetchOAuth2TokenCommand(uri);
    }),
    vscode.commands.registerCommand('apicircle.addQueryRow', (uri?: vscode.Uri) =>
      addQueryRowCommand(uri),
    ),
    vscode.commands.registerCommand('apicircle.addCookieRow', (uri?: vscode.Uri) =>
      addCookieRowCommand(uri),
    ),
    vscode.commands.registerCommand('apicircle.addPathParamRow', (uri?: vscode.Uri) =>
      addPathParamRowCommand(uri),
    ),
    vscode.commands.registerCommand('apicircle.addAssertionRow', (uri?: vscode.Uri) =>
      addAssertionRowCommand(uri),
    ),
    vscode.commands.registerCommand('apicircle.addExtractionRow', (uri?: vscode.Uri) =>
      addExtractionRowCommand(uri),
    ),
    vscode.commands.registerCommand('apicircle.addMockValidationRule', (uri?: vscode.Uri) =>
      addMockValidationRuleCommand(uri),
    ),
    vscode.commands.registerCommand(
      'apicircle.setMockValidationKind',
      (uri?: vscode.Uri, ruleId?: string) => setMockValidationKindCommand(uri, ruleId),
    ),
    vscode.commands.registerCommand(
      'apicircle.setMockValidationTarget',
      (uri?: vscode.Uri, ruleId?: string) => setMockValidationTargetCommand(uri, ruleId),
    ),
    vscode.commands.registerCommand(
      'apicircle.setMockValidationExpected',
      (uri?: vscode.Uri, ruleId?: string) => setMockValidationExpectedCommand(uri, ruleId),
    ),
    vscode.commands.registerCommand('apicircle.addMockMultiplier', (uri?: vscode.Uri) =>
      addMockMultiplierCommand(uri),
    ),
    vscode.commands.registerCommand(
      'apicircle.switchMockResponseBodyType',
      (uri?: vscode.Uri, ruleId?: string) => switchMockResponseBodyTypeCommand(uri, ruleId),
    ),
    vscode.commands.registerCommand(
      'apicircle.setMockResponseStatus',
      (uri?: vscode.Uri, ruleId?: string) => setMockResponseStatusCommand(uri, ruleId),
    ),
    vscode.commands.registerCommand('apicircle.addMockResponseRule', (uri?: vscode.Uri) =>
      addMockResponseRuleCommand(uri),
    ),
    vscode.commands.registerCommand(
      'apicircle.removeMockResponseRule',
      (uri?: vscode.Uri, ruleId?: string) => removeMockResponseRuleCommand(uri, ruleId),
    ),
    vscode.commands.registerCommand(
      'apicircle.removeMockValidationRule',
      (uri?: vscode.Uri, ruleId?: string) => removeMockValidationRuleCommand(uri, ruleId),
    ),
    vscode.commands.registerCommand(
      'apicircle.removeMockMultiplier',
      (uri?: vscode.Uri, multiplierId?: string) => removeMockMultiplierCommand(uri, multiplierId),
    ),
    vscode.commands.registerCommand(
      'apicircle.setMockMethodField',
      (uri?: vscode.Uri, line?: number) => setMockMethodFieldCommand(uri, line),
    ),
    vscode.commands.registerCommand(
      'apicircle.setMockStatusField',
      (uri?: vscode.Uri, line?: number) => setMockStatusFieldCommand(uri, line),
    ),
    vscode.commands.registerCommand(
      'apicircle.setMockBodyTypeField',
      (uri?: vscode.Uri, line?: number) => setMockBodyTypeFieldCommand(uri, line),
    ),
    vscode.commands.registerCommand(
      'apicircle.setMockHeaderKeyField',
      (uri?: vscode.Uri, line?: number) => setMockHeaderKeyFieldCommand(uri, line),
    ),
    vscode.commands.registerCommand(
      'apicircle.setMockHeaderValueField',
      (uri?: vscode.Uri, line?: number) => setMockHeaderValueFieldCommand(uri, line),
    ),
    vscode.commands.registerCommand(
      'apicircle.setMockClauseScopeField',
      (uri?: vscode.Uri, line?: number) => setMockClauseScopeFieldCommand(uri, line),
    ),
    vscode.commands.registerCommand(
      'apicircle.setMockClauseOpField',
      (uri?: vscode.Uri, line?: number) => setMockClauseOpFieldCommand(uri, line),
    ),
    vscode.commands.registerCommand(
      'apicircle.setMockClauseTargetField',
      (uri?: vscode.Uri, line?: number) => setMockClauseTargetFieldCommand(uri, line),
    ),
    vscode.commands.registerCommand(
      'apicircle.setMockClauseValueField',
      (uri?: vscode.Uri, line?: number) => setMockClauseValueFieldCommand(uri, line),
    ),
    vscode.commands.registerCommand(
      'apicircle.toggleMockHeaderEnabled',
      (uri?: vscode.Uri, line?: number) => toggleMockHeaderEnabledCommand(uri, line),
    ),
    vscode.commands.registerCommand('apicircle.formatJson', (uri?: vscode.Uri, line?: number) =>
      formatJsonCommand(uri, line),
    ),
    vscode.commands.registerCommand(
      'apicircle.formatResponseJson',
      (uri?: vscode.Uri, line?: number) => formatResponseJsonCommand(uri, line),
    ),
    vscode.commands.registerCommand('apicircle.addMockRequestSchema', (uri?: vscode.Uri) =>
      addMockRequestSchemaCommand(uri),
    ),
    vscode.commands.registerCommand(
      'apicircle.addMockRequestSchemaParam',
      (uri?: vscode.Uri, kind?: RequestSchemaParamKind) =>
        addMockRequestSchemaParamCommand(uri, kind),
    ),
    vscode.commands.registerCommand(
      'apicircle.addMockRequestSchemaBodyExample',
      (uri?: vscode.Uri) => addMockRequestSchemaBodyExampleCommand(uri),
    ),
    vscode.commands.registerCommand(
      'apicircle.setMockParamTypeField',
      (uri?: vscode.Uri, line?: number) => setMockParamTypeFieldCommand(uri, line),
    ),
    vscode.commands.registerCommand(
      'apicircle.setRequestMethodField',
      (uri?: vscode.Uri, line?: number) => setRequestMethodFieldCommand(uri, line),
    ),
    vscode.commands.registerCommand(
      'apicircle.setRequestHeaderKeyField',
      (uri?: vscode.Uri, line?: number) => setRequestHeaderKeyFieldCommand(uri, line),
    ),
    vscode.commands.registerCommand(
      'apicircle.setRequestHeaderValueField',
      (uri?: vscode.Uri, line?: number) => setRequestHeaderValueFieldCommand(uri, line),
    ),
    vscode.commands.registerCommand(
      'apicircle.setRequestTextField',
      (uri?: vscode.Uri, line?: number) => setRequestTextFieldCommand(uri, line),
    ),
    vscode.commands.registerCommand(
      'apicircle.setRequestAssertionKindField',
      (uri?: vscode.Uri, line?: number) => setRequestAssertionKindFieldCommand(uri, line),
    ),
    vscode.commands.registerCommand(
      'apicircle.setRequestAssertionOpField',
      (uri?: vscode.Uri, line?: number) => setRequestAssertionOpFieldCommand(uri, line),
    ),
    vscode.commands.registerCommand(
      'apicircle.setRequestAssertionTargetField',
      (uri?: vscode.Uri, line?: number) => setRequestAssertionTargetFieldCommand(uri, line),
    ),
    vscode.commands.registerCommand(
      'apicircle.setRequestAssertionExpectedField',
      (uri?: vscode.Uri, line?: number) => setRequestAssertionExpectedFieldCommand(uri, line),
    ),
    vscode.commands.registerCommand(
      'apicircle.setRequestAuthField',
      (uri?: vscode.Uri, line?: number) => setRequestAuthFieldCommand(uri, line),
    ),
    vscode.commands.registerCommand(
      'apicircle.setRequestExtractionSourceField',
      (uri?: vscode.Uri, line?: number) => setRequestExtractionSourceFieldCommand(uri, line),
    ),
    vscode.commands.registerCommand(
      'apicircle.toggleRequestRowEnabled',
      (uri?: vscode.Uri, line?: number) => toggleRequestRowEnabledCommand(uri, line),
    ),
    vscode.commands.registerCommand(
      'apicircle.addMockConditionClause',
      (uri?: vscode.Uri, line?: number) => addMockConditionClauseCommand(uri, line),
    ),
    vscode.commands.registerCommand(
      'apicircle.setMockMultiplierKindField',
      (uri?: vscode.Uri, line?: number) => setMockMultiplierKindFieldCommand(uri, line),
    ),
    vscode.commands.registerCommand(
      'apicircle.setMockMultiplierKeyField',
      (uri?: vscode.Uri, line?: number) => setMockMultiplierKeyFieldCommand(uri, line),
    ),
    vscode.commands.registerCommand(
      'apicircle.setMockMultiplierTargetPathField',
      (uri?: vscode.Uri, line?: number) => setMockMultiplierTargetPathFieldCommand(uri, line),
    ),
    vscode.commands.registerCommand(
      'apicircle.setMockTextField',
      (uri?: vscode.Uri, line?: number) => setMockTextFieldCommand(uri, line),
    ),
    vscode.commands.registerCommand(
      'apicircle.setMockNumberField',
      (uri?: vscode.Uri, line?: number) => setMockNumberFieldCommand(uri, line),
    ),
    vscode.commands.registerCommand(
      'apicircle.toggleMockRuleEnabled',
      (uri?: vscode.Uri, kind?: 'response' | 'validation', ruleId?: string) =>
        toggleMockRuleEnabledCommand(uri, kind, ruleId),
    ),
    vscode.commands.registerCommand(
      'apicircle.addMockResponseHeader',
      (uri?: vscode.Uri, ruleId?: string) => addMockResponseHeaderCommand(uri, ruleId),
    ),
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
      'apicircle.openFolderYaml',
      (node?: { kind: 'folder'; id: string }) => {
        if (!bridge) return;
        return openFolderYamlCommand({ bridge }, node);
      },
    ),
    vscode.commands.registerCommand(
      'apicircle.newFolder',
      (node?: { kind: 'folder'; id: string }) => {
        if (!bridge) return;
        return newFolderCommand({ bridge }, node);
      },
    ),
    vscode.commands.registerCommand(
      'apicircle.editFolderAuth',
      (node?: { kind: 'folder'; id: string }) => {
        if (!bridge) return;
        // Same projection as openFolderYaml, but focusOnAuth jumps the
        // cursor to the auth: line on open (and inserts a fresh `auth:
        // { type: bearer }` scaffold when the folder has no auth section
        // yet, so the user lands directly in something editable).
        return openFolderYamlCommand({ bridge }, node, { focusOnAuth: true });
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
    // Release-ledger commands — drive the Link Workspaces view + releases.yaml
    // CodeLens. Each refreshes the views after mutating so the tree's release
    // list updates without waiting for the next watcher tick.
    vscode.commands.registerCommand('apicircle.openReleaseHistory', () => {
      if (!bridge) return;
      return openReleaseHistoryCommand({ bridge, fsProvider });
    }),
    vscode.commands.registerCommand('apicircle.publishRelease', async () => {
      if (!bridge) return;
      await publishReleaseCommand({ bridge, fsProvider });
      for (const v of Object.values(views ?? {})) v.refresh();
    }),
    vscode.commands.registerCommand(
      'apicircle.deprecateRelease',
      async (arg?: { version?: string }) => {
        if (!bridge) return;
        await deprecateReleaseCommand({ bridge, fsProvider }, arg);
        for (const v of Object.values(views ?? {})) v.refresh();
      },
    ),
    vscode.commands.registerCommand(
      'apicircle.withdrawRelease',
      async (arg?: { version?: string }) => {
        if (!bridge) return;
        await withdrawReleaseCommand({ bridge, fsProvider }, arg);
        for (const v of Object.values(views ?? {})) v.refresh();
      },
    ),
    // Linked-workspace commands. Field editors + lifecycle, each refreshing the
    // views afterward so the Link Workspaces tree reflects the change.
    vscode.commands.registerCommand('apicircle.linkWorkspace', async () => {
      if (!bridge) return;
      await linkWorkspaceCommand({ bridge, fsProvider, secrets: context.secrets });
      for (const v of Object.values(views ?? {})) v.refresh();
    }),
    vscode.commands.registerCommand('apicircle.searchMarketplace', async () => {
      if (!bridge) return;
      await searchMarketplaceCommand({ bridge, fsProvider, secrets: context.secrets });
      for (const v of Object.values(views ?? {})) v.refresh();
    }),
    vscode.commands.registerCommand('apicircle.refreshLinkedWorkspace', async (arg?: LinkArg) => {
      if (!bridge) return;
      await refreshLinkedWorkspaceCommand({ bridge, fsProvider, secrets: context.secrets }, arg);
      for (const v of Object.values(views ?? {})) v.refresh();
    }),
    vscode.commands.registerCommand('apicircle.reviewLinkedUpdate', async (arg?: LinkArg) => {
      if (!bridge) return;
      await reviewLinkedUpdateCommand({ bridge, fsProvider, secrets: context.secrets }, arg);
      for (const v of Object.values(views ?? {})) v.refresh();
    }),
    vscode.commands.registerCommand('apicircle.tagRelease', () => {
      if (!bridge) return;
      return tagReleaseCommand({ bridge });
    }),
    vscode.commands.registerCommand('apicircle.editRepoTopics', () => {
      if (!bridge) return;
      return editRepoTopicsCommand({ bridge });
    }),
    vscode.commands.registerCommand('apicircle.unlinkWorkspace', async (arg?: LinkArg) => {
      if (!bridge) return;
      await unlinkWorkspaceCommand({ bridge, fsProvider, secrets: context.secrets }, arg);
      for (const v of Object.values(views ?? {})) v.refresh();
    }),
    vscode.commands.registerCommand('apicircle.openLinkYaml', (arg?: LinkArg) => {
      if (!bridge) return;
      return openLinkYamlCommand({ bridge, fsProvider, secrets: context.secrets }, arg);
    }),
    vscode.commands.registerCommand('apicircle.showLinkedChangelog', (arg?: LinkArg) => {
      if (!bridge) return;
      return showLinkedChangelogCommand({ bridge, fsProvider, secrets: context.secrets }, arg);
    }),
    vscode.commands.registerCommand('apicircle.setLinkNameField', async (arg?: LinkArg) => {
      if (!bridge) return;
      await setLinkNameFieldCommand({ bridge, fsProvider, secrets: context.secrets }, arg);
      for (const v of Object.values(views ?? {})) v.refresh();
    }),
    vscode.commands.registerCommand('apicircle.setLinkDescriptionField', (arg?: LinkArg) => {
      if (!bridge) return;
      return setLinkDescriptionFieldCommand({ bridge, fsProvider, secrets: context.secrets }, arg);
    }),
    vscode.commands.registerCommand(
      'apicircle.setLinkPinnedVersionField',
      async (arg?: LinkArg) => {
        if (!bridge) return;
        await setLinkPinnedVersionFieldCommand(
          { bridge, fsProvider, secrets: context.secrets },
          arg,
        );
        for (const v of Object.values(views ?? {})) v.refresh();
      },
    ),
    vscode.commands.registerCommand('apicircle.setLinkScopeField', (arg?: LinkArg) => {
      if (!bridge) return;
      return setLinkScopeFieldCommand({ bridge, fsProvider, secrets: context.secrets }, arg);
    }),
    vscode.commands.registerCommand('apicircle.setLinkSessionModeField', (arg?: LinkArg) => {
      if (!bridge) return;
      return setLinkSessionModeFieldCommand({ bridge, fsProvider, secrets: context.secrets }, arg);
    }),
    vscode.commands.registerCommand('apicircle.addLinkRequiredKey', (arg?: LinkArg) => {
      if (!bridge) return;
      return addLinkRequiredKeyCommand({ bridge, fsProvider, secrets: context.secrets }, arg);
    }),
    vscode.commands.registerCommand(
      'apicircle.removeLinkRequiredKey',
      (arg?: LinkArg, key?: string) => {
        if (!bridge) return;
        return removeLinkRequiredKeyCommand(
          { bridge, fsProvider, secrets: context.secrets },
          arg,
          key,
        );
      },
    ),
    vscode.commands.registerCommand('apicircle.setLinkSessionToken', (arg?: LinkArg) => {
      if (!bridge) return;
      return setLinkSessionTokenCommand({ bridge, fsProvider, secrets: context.secrets }, arg);
    }),
    vscode.commands.registerCommand(
      'apicircle.openLinkedRequest',
      (arg?: { linkId?: string; requestId?: string }) => {
        if (!bridge) return;
        return openLinkedRequestCommand({ bridge, fsProvider, secrets: context.secrets }, arg);
      },
    ),
    vscode.commands.registerCommand(
      'apicircle.resetLinkedRequest',
      async (arg?: { linkId?: string; requestId?: string }) => {
        if (!bridge) return;
        await resetLinkedRequestCommand({ bridge, fsProvider, secrets: context.secrets }, arg);
        for (const v of Object.values(views ?? {})) v.refresh();
      },
    ),
    vscode.commands.registerCommand('apicircle.discardLinkedMods', async (arg?: LinkArg) => {
      if (!bridge) return;
      await discardLinkedModsCommand({ bridge, fsProvider, secrets: context.secrets }, arg);
      for (const v of Object.values(views ?? {})) v.refresh();
    }),
    vscode.commands.registerCommand(
      'apicircle.provisionLinkedSecret',
      (arg?: LinkArg, key?: string) => {
        if (!bridge) return;
        return provisionLinkedSecretCommand(
          { bridge, fsProvider, secrets: context.secrets },
          arg,
          key,
        );
      },
    ),
    vscode.commands.registerCommand(
      'apicircle.clearLinkedSecret',
      (arg?: LinkArg, key?: string) => {
        if (!bridge) return;
        return clearLinkedSecretCommand({ bridge, fsProvider, secrets: context.secrets }, arg, key);
      },
    ),
    vscode.commands.registerCommand(
      'apicircle.setLinkedEnvVarOverride',
      async (arg?: { linkId?: string; envName?: string; varKey?: string }) => {
        if (!bridge) return;
        await setLinkedEnvVarOverrideCommand({ bridge, fsProvider, secrets: context.secrets }, arg);
        for (const v of Object.values(views ?? {})) v.refresh();
      },
    ),
    vscode.commands.registerCommand('apicircle.clearLinkSessionToken', (arg?: LinkArg) => {
      if (!bridge) return;
      return clearLinkSessionTokenCommand({ bridge, fsProvider, secrets: context.secrets }, arg);
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
    vscode.commands.registerCommand(
      'apicircle.setMockPort',
      (node?: { kind: 'server' | 'mock-running' | 'mock-idle'; id: string }) => {
        if (!bridge || !mockController) return;
        return setMockPortCommand({ bridge, controller: mockController }, node);
      },
    ),
    vscode.commands.registerCommand(
      'apicircle.openMockEndpointYaml',
      (node?: { kind: 'endpoint'; serverId: string; endpointId: string }) => {
        if (!bridge || !mockController) return;
        return openMockEndpointYamlCommand({ bridge, controller: mockController }, node);
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
      'apicircle.openMcpConfigFile',
      (node?: { kind: 'client'; client: AiClient }) => {
        if (!mcpManager) return;
        return openMcpConfigFileCommand(
          {
            mcp: mcpManager,
            onChanged: () => views?.mcp.refresh(),
            log: runsChannel?.forCategory('misc'),
          },
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
    vscode.commands.registerCommand('apicircle.uninstallCopilotMcpConfig', () => {
      if (!mcpManager) return;
      return uninstallCopilotMcpConfigCommand({
        mcp: mcpManager,
        getRelativeConfigPath: () =>
          vscode.workspace
            .getConfiguration('apicircle.mcp')
            .get<string>('workspaceConfigPath', '.vscode/mcp.json'),
        onInstalled: () => views?.mcp.refresh(),
        log: runsChannel?.forCategory('misc'),
      });
    }),
    // ---- P8: multi-AI-client MCP install ----
    vscode.commands.registerCommand(
      'apicircle.installMcpForClient',
      // `arg` arrives as a string client id when the row's
      // `item.command.arguments = [client]` fires; as an `McpNode`
      // `{ kind: 'client', client }` from the inline button / context
      // menu (VS Code passes the tree node). `coerceInstallableClientArg`
      // normalises both into the bare client id; an unrecognised arg
      // falls through to the QuickPick.
      (arg?: unknown) => {
        if (!mcpManager) return;
        const clientArg = coerceInstallableClientArg(arg);
        if (!clientArg) {
          return vscode.window
            .showQuickPick(
              INSTALLABLE_CLIENTS.map((c) => ({ label: c, value: c })),
              { title: 'Install API Circle MCP for which client?' },
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
      // Same arg shapes as `installMcpForClient`. Without the unwrap the
      // handler returned silently when invoked from the inline trash
      // button or the row's context menu — the 1.1.0 bug where "Remove
      // API Circle MCP from AI Client" did nothing.
      (arg?: unknown) => {
        if (!mcpManager) return;
        const clientArg = coerceInstallableClientArg(arg);
        if (!clientArg) return;
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

  // ---- Workspace discovery + hasActiveWorkspace context key ----
  // Re-runs `discoverWorkspaces` for the currently-open VS Code workspace
  // folders, registers any newly found `.apicircle/workspace.json` with the
  // bridge, picks an active workspace if none is set yet, and finally
  // updates the `apicircle.hasActiveWorkspace` context key so the Editor's
  // viewsWelcome content switches between the no-workspace and
  // workspace-present copies. Called from activate() initialisation, the
  // apicircle.refresh command, the workspace-file watcher, and
  // onDidChangeWorkspaceFolders. Safe to call repeatedly — bridge
  // registration is idempotent.
  function rediscoverAndRegister(_ctx: vscode.ExtensionContext): void {
    if (!bridge) return;
    const log = runsChannel?.forCategory('misc');
    const folders = vscode.workspace.workspaceFolders;
    log?.(
      `discover: ${folders?.length ?? 0} workspace folder(s) — ${
        folders?.map((f) => f.uri.fsPath).join(' | ') ?? '<none>'
      }`,
    );
    const discovery = discoverWorkspaces(folders);
    log?.(
      `discover: found ${discovery.workspaces.length} git-folder workspace(s) — ${
        discovery.workspaces.map((w) => w.workspaceJsonPath).join(' | ') || '<none>'
      }`,
    );
    if (discovery.foldersWithoutWorkspace.length > 0) {
      log?.(
        `discover: ${discovery.foldersWithoutWorkspace.length} folder(s) had no .apicircle/workspace.json — ${discovery.foldersWithoutWorkspace
          .map((f) => f.uri.fsPath)
          .join(' | ')}`,
      );
    }

    // Registry-based discovery: also load workspaces from ~/.apicircle/registry.json
    const registryWorkspaces = discoverRegistryWorkspaces();
    if (registryWorkspaces.length > 0) {
      log?.(
        `discover: found ${registryWorkspaces.length} registry workspace(s) — ${registryWorkspaces
          .map((w) => w.label)
          .join(' | ')}`,
      );
    }

    // Register all discovered workspaces (git-folder first, then registry).
    // Duplicates (same id) are a no-op in bridge.registerWorkspace.
    for (const ws of discovery.workspaces) {
      bridge.registerWorkspace(ws);
    }
    for (const ws of registryWorkspaces) {
      bridge.registerWorkspace(ws);
    }

    const allWorkspaces = [...discovery.workspaces, ...registryWorkspaces];
    if (!bridge.activeWorkspace() && allWorkspaces.length > 0) {
      const previous = _ctx.globalState.get<string>('apicircle.activeWorkspaceId');
      const toActivate = allWorkspaces.find((w) => w.id === previous) ?? allWorkspaces[0];
      bridge.setActive(toActivate.id);
    }
    const hasActive = bridge.activeWorkspace() !== null;
    const hasMultiple = allWorkspaces.length > 1;
    log?.(`discover: hasActiveWorkspace=${hasActive}, hasMultipleWorkspaces=${hasMultiple}`);
    void vscode.commands.executeCommand('setContext', 'apicircle.hasActiveWorkspace', hasActive);
    void vscode.commands.executeCommand(
      'setContext',
      'apicircle.hasMultipleWorkspaces',
      hasMultiple,
    );
  }

  // ---- Startup: adopt the workspace backing an already-open editor ----
  // On reload VS Code restores the previous session's editors. If one is an
  // apicircle:// virtual YAML (request / env / mock / endpoint / …) or the raw
  // `.apicircle/workspace.json`, switch the active workspace to the one that
  // editor belongs to — so the TreeViews, status bar and MCP snippets reflect
  // what the user is already looking at instead of whatever discovery defaulted
  // to. Best-effort: any malformed URI is skipped, never thrown.
  function adoptActiveWorkspaceFromOpenEditors(): void {
    if (!bridge) return;
    const registered = bridge.listWorkspaces();
    if (registered.length === 0) return;
    const log = runsChannel?.forCategory('misc');
    const lookup = registered.map((w) => ({
      id: w.workspace.id,
      workspaceJsonPath: w.workspace.workspaceJsonPath,
    }));

    // Prefer the focused editor, then any other open document.
    const ordered: vscode.TextDocument[] = [];
    const activeDoc = vscode.window.activeTextEditor?.document;
    if (activeDoc) ordered.push(activeDoc);
    for (const doc of vscode.workspace.textDocuments) {
      if (doc !== activeDoc) ordered.push(doc);
    }

    for (const doc of ordered) {
      const id = workspaceIdForOpenEditor(
        { scheme: doc.uri.scheme, authority: doc.uri.authority, fsPath: doc.uri.fsPath },
        lookup,
      );
      if (!id) continue;
      if (bridge.activeWorkspace()?.workspace.id !== id) {
        bridge.setActive(id);
        log?.(`startup: adopted workspace ${id} from open editor ${doc.uri.toString()}`);
        for (const v of Object.values(views ?? {})) v.refresh();
        void vscode.commands.executeCommand('setContext', 'apicircle.hasActiveWorkspace', true);
      }
      return; // first match wins
    }
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

  // The blanket `onDidChangeActiveWorkspace` listener (wired near the view
  // registration block) already refreshes every view — including MCP — so
  // no dedicated MCP-only subscription is needed here.
}

export async function deactivate(): Promise<void> {
  abortRegistry?.cancelAll();
  abortRegistry = null;
  inFlightTracker?.dispose();
  inFlightTracker = null;
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
