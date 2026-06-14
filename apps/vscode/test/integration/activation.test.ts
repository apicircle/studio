// =============================================================================
// Activation integration test.
//
// Drives the extension's `activate()` function with a hand-rolled mock
// ExtensionContext + empty / single / multi workspace folder configurations.
// Verifies the full activation pipeline registers views, commands, watchers
// without errors — the seam that pure unit tests don't cover.
//
// This is NOT an E2E test — it doesn't launch a real VS Code. That harness
// lives in `e2e/vscode/`. This sits between unit (per-module mock) and E2E
// (real VS Code) and validates the wiring.
// =============================================================================

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import type * as vscode from 'vscode';
import { Uri, window, workspace, commands } from '../mocks/vscode';
import { activate, deactivate, __getInternalsForTests } from '../../src/extension';

interface TestContext {
  ctx: vscode.ExtensionContext;
  globalState: Map<string, unknown>;
}

function makeMockContext(globalStoragePath: string): TestContext {
  const state = new Map<string, unknown>();
  const ctx = {
    subscriptions: [],
    globalState: {
      get: <T>(key: string, defaultValue?: T): T | undefined =>
        state.has(key) ? (state.get(key) as T) : defaultValue,
      update: async (key: string, value: unknown) => {
        state.set(key, value);
      },
      keys: () => Array.from(state.keys()),
    },
    workspaceState: {
      get: <T>(_key: string, defaultValue?: T): T | undefined => defaultValue,
      update: async () => undefined,
      keys: () => [],
    },
    secrets: {
      get: async () => undefined,
      store: async () => undefined,
      delete: async () => undefined,
    },
    globalStorageUri: Uri.file(globalStoragePath),
    storageUri: undefined,
    extensionUri: Uri.file('/ext'),
    extensionPath: '/ext',
    asAbsolutePath: (rel: string) => path.join('/ext', rel),
    extensionMode: 3,
  };
  return { ctx: ctx as unknown as vscode.ExtensionContext, globalState: state };
}

describe('extension activation (integration)', () => {
  let tmp: string;
  let registeredCommandIds: string[] = [];
  let registeredTreeViewIds: string[] = [];

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vscode-activation-'));
    registeredCommandIds = [];
    registeredTreeViewIds = [];

    (
      commands.registerCommand as unknown as {
        mockReset: () => void;
        mockImplementation: (fn: (...a: unknown[]) => unknown) => void;
      }
    ).mockReset();
    (
      commands.registerCommand as unknown as {
        mockImplementation: (fn: (...a: unknown[]) => unknown) => void;
      }
    ).mockImplementation((...args: unknown[]) => {
      registeredCommandIds.push(args[0] as string);
      return { dispose: () => undefined };
    });
    (
      window.createTreeView as unknown as {
        mockReset: () => void;
        mockImplementation: (fn: (...a: unknown[]) => unknown) => void;
      }
    ).mockReset();
    (
      window.createTreeView as unknown as {
        mockImplementation: (fn: (...a: unknown[]) => unknown) => void;
      }
    ).mockImplementation((...args: unknown[]) => {
      registeredTreeViewIds.push(args[0] as string);
      return { dispose: () => undefined };
    });
    (
      workspace.onDidChangeWorkspaceFolders as unknown as {
        mockReset: () => void;
        mockReturnValue: (v: unknown) => void;
      }
    ).mockReset();
    (
      workspace.onDidChangeWorkspaceFolders as unknown as { mockReturnValue: (v: unknown) => void }
    ).mockReturnValue({ dispose: () => undefined });
    (workspace as { workspaceFolders: unknown }).workspaceFolders = undefined;
  });

  afterEach(async () => {
    try {
      // P3R2-G3: deactivate is now async — await it so the mock controller
      // disposeAll completes before we tear down.
      await deactivate();
    } catch {
      /* ignore */
    }
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('registers all 9 sidebar views when no folder is open', () => {
    const { ctx } = makeMockContext(path.join(tmp, 'globalStorage'));
    activate(ctx);

    expect(registeredTreeViewIds.sort()).toEqual(
      [
        'apicircle.editor',
        'apicircle.environment',
        'apicircle.execution',
        'apicircle.history',
        'apicircle.linkWorkspaces',
        'apicircle.mcp',
        'apicircle.mock',
        'apicircle.snapshots',
        'apicircle.workspace',
      ].sort(),
    );
  });

  it('registers all expected commands', () => {
    const { ctx } = makeMockContext(path.join(tmp, 'globalStorage'));
    activate(ctx);

    // Every command contributed in package.json's `contributes.commands`
    // must also have a runtime `vscode.commands.registerCommand` — otherwise
    // selecting it from the palette throws "command 'apicircle.x' not found".
    // R3-G1: snapshot the full registered set instead of a small allowlist
    // so future contributions can't slip through.
    const expectedCommandIds = [
      'apicircle.createWorkspace',
      'apicircle.switchWorkspace',
      'apicircle.refresh',
      'apicircle.openWorkspaceFile',
      'apicircle.sendRequest',
      'apicircle.cancelSend',
      'apicircle.newRequest',
      'apicircle.deleteRequest',
      'apicircle.duplicateRequest',
      'apicircle.revealInSource',
      'apicircle.setActiveEnvironment',
      'apicircle.newEnvironment',
      'apicircle.deleteEnvironment',
      'apicircle.captureSnapshot',
      'apicircle.restoreSnapshot',
      'apicircle.deleteSnapshot',
      'apicircle.setSnapshotMaxBytes',
      'apicircle.runPlan',
      'apicircle.newPlan',
      'apicircle.setEnvPriorityOrder',
      'apicircle.addExtraction',
      'apicircle.clearAllHistory',
      'apicircle.purgeOlderThan',
      'apicircle.deleteHistoryRun',
      'apicircle.editVariableValue',
      'apicircle.deleteVariable',
      'apicircle.deleteFolder',
      'apicircle.newRequestInFolder',
      'apicircle.toggleStepEnabled',
      'apicircle.removeStepFromPlan',
      'apicircle.newMock',
      'apicircle.startMock',
      'apicircle.stopMock',
      'apicircle.restartMock',
      'apicircle.deleteMock',
      'apicircle.copyEndpointPath',
      'apicircle.revealEndpointInMockYaml',
      'apicircle.openMockInBrowser',
      'apicircle.setMockPort',
      // ---- P4 vault + runs channel ----
      'apicircle.unlockVault',
      'apicircle.lockVault',
      'apicircle.setupVaultPassphrase',
      'apicircle.changeVaultPassphrase',
      'apicircle.openVaultEntry',
      'apicircle.showRunsChannel',
      // ---- P5 MCP host integration ----
      'apicircle.openMcpConfigFile',
      'apicircle.openMcpConnectGuide',
      'apicircle.revealMcpBinaryInfo',
      // ---- P6 Copilot Chat / VS Code MCP install ----
      'apicircle.installCopilotMcpConfig',
      // ---- P8 multi-AI-client MCP install ----
      'apicircle.installMcpForClient',
      'apicircle.installMcpForAllClients',
      'apicircle.uninstallMcpForClient',
      // ---- P8 vault remember-on-device ----
      'apicircle.forgetVaultOnDevice',
      // ---- P9 Plan Notebook ----
      'apicircle.openPlanAsNotebook',
      // ---- Link Workspaces: release ledger ----
      'apicircle.openReleaseHistory',
      'apicircle.publishRelease',
      'apicircle.deprecateRelease',
      'apicircle.withdrawRelease',
      // ---- Link Workspaces: linked-workspace config + networking ----
      'apicircle.linkWorkspace',
      'apicircle.searchMarketplace',
      'apicircle.refreshLinkedWorkspace',
      'apicircle.reviewLinkedUpdate',
      'apicircle.tagRelease',
      'apicircle.editRepoTopics',
      'apicircle.unlinkWorkspace',
      'apicircle.openLinkYaml',
      'apicircle.showLinkedChangelog',
      'apicircle.setLinkNameField',
      'apicircle.setLinkDescriptionField',
      'apicircle.setLinkPinnedVersionField',
      'apicircle.setLinkScopeField',
      'apicircle.setLinkSessionModeField',
      'apicircle.addLinkRequiredKey',
      'apicircle.removeLinkRequiredKey',
      'apicircle.setLinkSessionToken',
      'apicircle.clearLinkSessionToken',
      'apicircle.openLinkedRequest',
      'apicircle.resetLinkedRequest',
      'apicircle.discardLinkedMods',
      'apicircle.provisionLinkedSecret',
      'apicircle.clearLinkedSecret',
      'apicircle.setLinkedEnvVarOverride',
      // ---- P10 Embedded MCP host ----
      'apicircle.startEmbeddedMcp',
      'apicircle.stopEmbeddedMcp',
      'apicircle.restartEmbeddedMcp',
      'apicircle.copyEmbeddedMcpUrl',
      // ---- P11 Mock endpoint visual editor ----
      'apicircle.editMockEndpoint',
      'apicircle.openMockEndpointYaml',
      // ---- Post-launch UX: request templates + section CodeLens ----
      'apicircle.newRequestFromTemplate',
      'apicircle.addRequestSection',
      'apicircle.switchRequestBodyType',
      'apicircle.switchRequestAuthType',
      'apicircle.pickBinaryAttachment',
      'apicircle.addFormDataRow',
      'apicircle.switchFormDataRowKind',
      'apicircle.pickFormDataRowFile',
      'apicircle.pickHeader',
      'apicircle.mapContextVarsFromJson',
      'apicircle.fetchOAuth2Token',
      'apicircle.addQueryRow',
      'apicircle.addCookieRow',
      'apicircle.addPathParamRow',
      'apicircle.addAssertionRow',
      'apicircle.addExtractionRow',
      'apicircle.addMockValidationRule',
      'apicircle.setMockValidationKind',
      'apicircle.setMockValidationTarget',
      'apicircle.setMockValidationExpected',
      'apicircle.addMockMultiplier',
      'apicircle.setMockMethodField',
      'apicircle.setMockStatusField',
      'apicircle.setMockBodyTypeField',
      'apicircle.setMockHeaderKeyField',
      'apicircle.setMockHeaderValueField',
      'apicircle.setMockClauseScopeField',
      'apicircle.setMockClauseOpField',
      'apicircle.setMockClauseTargetField',
      'apicircle.setMockClauseValueField',
      'apicircle.toggleMockHeaderEnabled',
      'apicircle.formatJson',
      'apicircle.addMockConditionClause',
      'apicircle.setMockMultiplierKindField',
      'apicircle.setMockMultiplierKeyField',
      'apicircle.setMockMultiplierTargetPathField',
      'apicircle.setMockTextField',
      'apicircle.setMockNumberField',
      // ---- requestSchema authoring ----
      'apicircle.addMockRequestSchema',
      'apicircle.addMockRequestSchemaParam',
      'apicircle.addMockRequestSchemaBodyExample',
      'apicircle.setMockParamTypeField',
      // ---- collection-request field editors ----
      'apicircle.setRequestMethodField',
      'apicircle.setRequestHeaderKeyField',
      'apicircle.setRequestHeaderValueField',
      'apicircle.setRequestTextField',
      'apicircle.setRequestAssertionKindField',
      'apicircle.setRequestAssertionOpField',
      'apicircle.setRequestExtractionSourceField',
      'apicircle.switchMockResponseBodyType',
      'apicircle.setMockResponseStatus',
      'apicircle.addMockResponseRule',
      'apicircle.removeMockResponseRule',
      'apicircle.removeMockValidationRule',
      'apicircle.removeMockMultiplier',
      'apicircle.toggleMockRuleEnabled',
      'apicircle.addMockResponseHeader',
      // ---- Post-launch UX: Copilot Chat uninstall affordance ----
      'apicircle.uninstallCopilotMcpConfig',
      // ---- Post-launch UX: in-flight CodeLens cancel ----
      'apicircle.cancelOneSend',
      // ---- Folder-wise auth ----
      'apicircle.openFolderYaml',
      'apicircle.editFolderAuth',
      'apicircle.newFolder',
      // ---- Post-launch UX: request-side ◆ field editors for auth + assertions ----
      'apicircle.setRequestAssertionTargetField',
      'apicircle.setRequestAssertionExpectedField',
      'apicircle.setRequestAuthField',
      'apicircle.toggleRequestRowEnabled',
      'apicircle.formatResponseJson',
    ];
    for (const id of expectedCommandIds) {
      expect(registeredCommandIds).toContain(id);
    }
    // Inverse guard: no UNEXPECTED commands either — catches typos and
    // dangling registrations that don't have a package.json contribution.
    for (const id of registeredCommandIds) {
      expect(expectedCommandIds).toContain(id);
    }
  });

  it('subscribes to workspace folder changes for re-discovery', () => {
    const { ctx } = makeMockContext(path.join(tmp, 'globalStorage'));
    activate(ctx);
    expect(workspace.onDidChangeWorkspaceFolders).toHaveBeenCalledTimes(1);
  });

  it('auto-registers workspaces found via canonical .apicircle/ discovery', () => {
    const folder = path.join(tmp, 'repo');
    fs.mkdirSync(path.join(folder, '.apicircle'), { recursive: true });
    fs.writeFileSync(
      path.join(folder, '.apicircle', 'workspace.json'),
      JSON.stringify({ schemaVersion: 1, workspaceId: 'test-ws' }),
    );

    (workspace as { workspaceFolders: unknown }).workspaceFolders = [
      { uri: Uri.file(folder), name: 'repo', index: 0 },
    ];

    const { ctx } = makeMockContext(path.join(tmp, 'globalStorage'));
    activate(ctx);

    const { bridge } = __getInternalsForTests();
    expect(bridge?.listWorkspaces()).toHaveLength(1);
    expect(bridge?.activeWorkspace()?.workspace.label).toBe('repo');
  });

  it('does NOT register a workspace when the folder has no .apicircle/', () => {
    const folder = path.join(tmp, 'no-workspace');
    fs.mkdirSync(folder, { recursive: true });

    (workspace as { workspaceFolders: unknown }).workspaceFolders = [
      { uri: Uri.file(folder), name: 'empty', index: 0 },
    ];

    const { ctx } = makeMockContext(path.join(tmp, 'globalStorage'));
    activate(ctx);

    const { bridge } = __getInternalsForTests();
    expect(bridge?.listWorkspaces()).toHaveLength(0);
    expect(bridge?.activeWorkspace()).toBeNull();
  });

  it('restores previously-active workspace from globalState on subsequent activation', async () => {
    const folder = path.join(tmp, 'repo-a');
    fs.mkdirSync(path.join(folder, '.apicircle'), { recursive: true });
    fs.writeFileSync(path.join(folder, '.apicircle', 'workspace.json'), '{}');

    (workspace as { workspaceFolders: unknown }).workspaceFolders = [
      { uri: Uri.file(folder), name: 'repo-a', index: 0 },
    ];

    const { ctx, globalState } = makeMockContext(path.join(tmp, 'globalStorage'));
    globalState.set('apicircle.activeWorkspaceId', path.join(folder, '.apicircle'));
    activate(ctx);

    const { bridge } = __getInternalsForTests();
    expect(bridge?.activeWorkspace()?.workspace.label).toBe('repo-a');
  });

  it('deactivate() clears the bridge and view singletons', async () => {
    const { ctx } = makeMockContext(path.join(tmp, 'globalStorage'));
    activate(ctx);
    expect(__getInternalsForTests().bridge).not.toBeNull();

    await deactivate();
    expect(__getInternalsForTests().bridge).toBeNull();
    expect(__getInternalsForTests().views).toBeNull();
  });
});
