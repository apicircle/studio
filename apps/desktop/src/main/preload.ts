// Preload runs in an isolated context that has access to a limited set
// of Electron APIs. We expose a narrow `apicircleDesktop` namespace on
// the renderer's `window` so the persistence layer can detect us and
// wrap the master JWK with the OS keychain.
//
// Surface kept tight — every method here adds attack surface, so we
// only ship the calls renderer features actually need.

import { contextBridge, ipcRenderer } from 'electron';
import type { MockServer, MockRuntimeEntry, McpToolName } from '@apicircle/shared';

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
};

contextBridge.exposeInMainWorld('apicircleDesktop', bridge);
