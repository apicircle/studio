// Preload runs in an isolated context that has access to a limited set
// of Electron APIs. We expose a narrow `apicircleDesktop` namespace on
// the renderer's `window` so the persistence layer can detect us and
// wrap the master JWK with the OS keychain.
//
// Surface kept tight — every method here adds attack surface, so we
// only ship the calls renderer features actually need.

import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import type {
  MockServer,
  MockRuntimeEntry,
  McpToolName,
  WorkspaceLocal,
  WorkspaceSynced,
} from '@apicircle/shared';
import type { WorkspaceRegistry, WorkspaceRegistryEntry } from '@apicircle/core/workspace/registry';

/** Payload emitted on the `apicircle:update:available` IPC channel. */
export interface UpdateAvailablePayload {
  version: string;
  releaseNotesUrl: string | null;
  releaseDate: string | null;
}

/** Payload pushed by main when a quit is pending and mocks are still running. */
export interface PromptClosePayload {
  runningMocks: Array<{ serverId: string; port: number }>;
}

/** Payload pushed during the drain — `completed` increments toward `total`. */
export interface ShutdownProgressPayload {
  completed: number;
  total: number;
}

const bridge = {
  encryptString: (plaintext: string): Promise<string> =>
    ipcRenderer.invoke('apicircle:secret:encrypt', plaintext) as Promise<string>,
  decryptString: (ciphertext: string): Promise<string> =>
    ipcRenderer.invoke('apicircle:secret:decrypt', ciphertext) as Promise<string>,
  isEncryptionAvailable: (): Promise<boolean> =>
    ipcRenderer.invoke('apicircle:secret:isAvailable') as Promise<boolean>,

  mock: {
    start: (server: MockServer, opts?: { port?: number }): Promise<MockRuntimeEntry> =>
      ipcRenderer.invoke('apicircle:mock:start', server, opts) as Promise<MockRuntimeEntry>,
    stop: (serverId: string): Promise<{ ok: boolean }> =>
      ipcRenderer.invoke('apicircle:mock:stop', serverId) as Promise<{ ok: boolean }>,
    list: (): Promise<Array<{ serverId: string; runtime: MockRuntimeEntry }>> =>
      ipcRenderer.invoke('apicircle:mock:list') as Promise<
        Array<{ serverId: string; runtime: MockRuntimeEntry }>
      >,
    getRuntime: (serverId: string): Promise<MockRuntimeEntry | null> =>
      ipcRenderer.invoke('apicircle:mock:getRuntime', serverId) as Promise<MockRuntimeEntry | null>,
    stopAll: (): Promise<{ ok: boolean }> =>
      ipcRenderer.invoke('apicircle:mock:stopAll') as Promise<{ ok: boolean }>,
  },

  mcp: {
    status: (): Promise<{ workspaceDir: string; binary: string }> =>
      ipcRenderer.invoke('apicircle:mcp:status') as Promise<{
        workspaceDir: string;
        binary: string;
      }>,
    getConfigSnippet: (client: string): Promise<string> =>
      ipcRenderer.invoke('apicircle:mcp:getConfigSnippet', client) as Promise<string>,
    getConfigPath: (client: string): Promise<string | null> =>
      ipcRenderer.invoke('apicircle:mcp:getConfigPath', client) as Promise<string | null>,
    toolCatalog: (): Promise<readonly McpToolName[]> =>
      ipcRenderer.invoke('apicircle:mcp:toolCatalog') as Promise<readonly McpToolName[]>,
  },

  // On-disk multi-workspace mirror. The renderer writes every debounced
  // persistence flush through `writeWorkspace` so each workspace's pair
  // (`workspace.synced.json` + `workspace.local.json`) stays in sync with
  // IndexedDB — that's the pair `apicircle-mcp` and the CLI read.
  workspaceFile: {
    status: (): Promise<{ workspacesRoot: string }> =>
      ipcRenderer.invoke('apicircle:workspaceFile:status') as Promise<{ workspacesRoot: string }>,
    init: (): Promise<{ registry: WorkspaceRegistry; migrated: boolean }> =>
      ipcRenderer.invoke('apicircle:workspaceFile:init') as Promise<{
        registry: WorkspaceRegistry;
        migrated: boolean;
      }>,
    readRegistry: (): Promise<WorkspaceRegistry> =>
      ipcRenderer.invoke('apicircle:workspaceFile:readRegistry') as Promise<WorkspaceRegistry>,
    writeRegistry: (registry: WorkspaceRegistry): Promise<void> =>
      ipcRenderer.invoke('apicircle:workspaceFile:writeRegistry', registry) as Promise<void>,
    readWorkspace: (
      workspaceId: string,
    ): Promise<{ synced: WorkspaceSynced; local: WorkspaceLocal } | null> =>
      ipcRenderer.invoke('apicircle:workspaceFile:readWorkspace', workspaceId) as Promise<{
        synced: WorkspaceSynced;
        local: WorkspaceLocal;
      } | null>,
    writeWorkspace: (payload: {
      workspaceId: string;
      synced: WorkspaceSynced;
      local: WorkspaceLocal;
    }): Promise<void> =>
      ipcRenderer.invoke('apicircle:workspaceFile:writeWorkspace', payload) as Promise<void>,
    deleteWorkspace: (workspaceId: string): Promise<WorkspaceRegistry> =>
      ipcRenderer.invoke(
        'apicircle:workspaceFile:deleteWorkspace',
        workspaceId,
      ) as Promise<WorkspaceRegistry>,
    registerWorkspace: (entry: WorkspaceRegistryEntry): Promise<WorkspaceRegistry> =>
      ipcRenderer.invoke(
        'apicircle:workspaceFile:registerWorkspace',
        entry,
      ) as Promise<WorkspaceRegistry>,
    setActiveWorkspace: (workspaceId: string): Promise<WorkspaceRegistry> =>
      ipcRenderer.invoke(
        'apicircle:workspaceFile:setActiveWorkspace',
        workspaceId,
      ) as Promise<WorkspaceRegistry>,
    flush: (): Promise<void> =>
      ipcRenderer.invoke('apicircle:workspaceFile:flush') as Promise<void>,
  },

  // OAuth2 callback bridge — wraps the localhost http server in main.ts.
  // The renderer drives flows via Auth tab UI; this surface stays small
  // (find a port, run a flow) so the attack surface is contained.
  oauth2: {
    findFreePort: (preferred: number): Promise<number> =>
      ipcRenderer.invoke('apicircle:oauth2:findFreePort', preferred) as Promise<number>,
    startFlow: (args: {
      authorizeUrl: string;
      port: number;
      mode: 'code' | 'token';
      callbackPath?: string;
      timeoutMs?: number;
    }): Promise<{
      code?: string;
      accessToken?: string;
      tokenType?: string;
      expiresIn?: number;
      scope?: string;
      state?: string;
      error?: string;
      errorDescription?: string;
      port: number;
      redirectUri: string;
    }> => ipcRenderer.invoke('apicircle:oauth2:startFlow', args),
  },

  // App-quit lifecycle bridge. Main holds the quit when mocks are running
  // and pushes `prompt-close` so the renderer can show a confirm modal;
  // the renderer answers via `cancelClose` or `confirmClose`. During the
  // drain main emits `shutdown-progress` events the modal can render as
  // an X-of-N bar; `shutdown-complete` fires just before app.quit().
  lifecycle: {
    onPromptClose: (cb: (payload: PromptClosePayload) => void): (() => void) => {
      const handler = (_e: IpcRendererEvent, payload: PromptClosePayload) => cb(payload);
      ipcRenderer.on('apicircle:lifecycle:prompt-close', handler);
      return () => ipcRenderer.removeListener('apicircle:lifecycle:prompt-close', handler);
    },
    onShutdownProgress: (cb: (payload: ShutdownProgressPayload) => void): (() => void) => {
      const handler = (_e: IpcRendererEvent, payload: ShutdownProgressPayload) => cb(payload);
      ipcRenderer.on('apicircle:lifecycle:shutdown-progress', handler);
      return () => ipcRenderer.removeListener('apicircle:lifecycle:shutdown-progress', handler);
    },
    onShutdownComplete: (cb: () => void): (() => void) => {
      const handler = () => cb();
      ipcRenderer.on('apicircle:lifecycle:shutdown-complete', handler);
      return () => ipcRenderer.removeListener('apicircle:lifecycle:shutdown-complete', handler);
    },
    cancelClose: (): Promise<void> =>
      ipcRenderer.invoke('apicircle:lifecycle:cancel-close') as Promise<void>,
    confirmClose: (): Promise<void> =>
      ipcRenderer.invoke('apicircle:lifecycle:confirm-close') as Promise<void>,
  },

  // Auto-update bridge. The renderer subscribes once at mount; the main
  // process emits exactly one `apicircle:update:available` per downloaded
  // update (electron-updater's `update-downloaded` event), then the user
  // can request a restart-to-install via `applyUpdate()`.
  update: {
    onAvailable: (cb: (payload: UpdateAvailablePayload) => void): (() => void) => {
      const handler = (_e: IpcRendererEvent, payload: UpdateAvailablePayload) => cb(payload);
      ipcRenderer.on('apicircle:update:available', handler);
      return () => {
        ipcRenderer.removeListener('apicircle:update:available', handler);
      };
    },
    applyUpdate: (): Promise<void> => ipcRenderer.invoke('apicircle:update:apply') as Promise<void>,
    checkNow: (): Promise<{ checked: boolean; reason?: string }> =>
      ipcRenderer.invoke('apicircle:update:checkNow') as Promise<{
        checked: boolean;
        reason?: string;
      }>,
  },
};

contextBridge.exposeInMainWorld('apicircleDesktop', bridge);
