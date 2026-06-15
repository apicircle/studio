import { describe, it, expect, vi } from 'vitest';
import type { SecretStorage } from 'vscode';
import type {
  Environment,
  EnvironmentVariable,
  LinkedWorkspace,
  Request as ApiRequest,
  WorkspaceLocal,
  WorkspaceSynced,
} from '@apicircle/shared';
import type { WorkspaceState } from '@apicircle/core';
import type { VsCodeVaultManager } from '../host/vaultManager';
import { buildResolvedRequest, buildLinkedAttachmentResolver } from './buildSendScope';
import { linkedSecretStorageKey } from '../host/githubAuth';

function makeRequest(over: Partial<ApiRequest> = {}): ApiRequest {
  return {
    id: 'r1',
    name: 'r',
    folderId: null,
    method: 'GET',
    url: 'https://api.example.com/{{path}}',
    headers: [],
    query: [],
    body: { type: 'none', content: '' },
    auth: { type: 'none' },
    contextVars: [],
    extractions: [],
    assertions: [],
    createdAt: 't',
    updatedAt: 't',
    ...over,
  } as ApiRequest;
}

function plainVar(key: string, value: string): EnvironmentVariable {
  return { key, value, enabled: true, encrypted: false } as EnvironmentVariable;
}

function encryptedVar(key: string, value: string): EnvironmentVariable {
  return { key, value, enabled: true, encrypted: true } as EnvironmentVariable;
}

function makeSynced(over: Partial<WorkspaceSynced> = {}): WorkspaceSynced {
  return {
    schemaVersion: 1,
    workspaceId: 'ws-1',
    collections: { tree: { id: 'root', type: 'root', children: [] }, requests: {}, folders: {} },
    environments: {
      items: {},
      activeName: null,
      priorityOrder: [{ kind: 'local', name: 'dev' }],
    },
    linkedWorkspaces: {},
    linkedOverrides: { requests: {}, environmentVars: {} },
    releases: { self: null, perLink: {} },
    globalAssets: { schemas: {}, graphql: {} },
    mockServers: {},
    meta: { createdAt: 't', updatedAt: 't', appVersion: '0.1.0' },
    ...over,
  } as WorkspaceSynced;
}

function makeLocal(over: Partial<WorkspaceLocal> = {}): WorkspaceLocal {
  return {
    historyRuns: {},
    globalContext: {},
    linkedCollections: {},
    settings: {},
    mockServersRuntime: {},
    ...over,
  } as WorkspaceLocal;
}

function makeState(
  synced: Partial<WorkspaceSynced> = {},
  local: Partial<WorkspaceLocal> = {},
): WorkspaceState {
  return { synced: makeSynced(synced), local: makeLocal(local) };
}

function makeEnv(name: string, vars: EnvironmentVariable[]): Environment {
  return { name, variables: vars } as Environment;
}

function makeSecretStorage(seed: Record<string, string> = {}) {
  const store = new Map(Object.entries(seed));
  return {
    get: vi.fn(async (k: string) => store.get(k)),
    store: vi.fn(async (k: string, v: string) => {
      store.set(k, v);
    }),
    delete: vi.fn(async (k: string) => {
      store.delete(k);
    }),
    onDidChange: vi.fn(() => ({ dispose: () => undefined })),
  } as unknown as SecretStorage;
}

describe('buildResolvedRequest', () => {
  it('resolves a request using plaintext local env vars when no vault is present', async () => {
    const state = makeState({
      environments: {
        items: { dev: makeEnv('dev', [plainVar('path', 'pets')]) },
        activeName: 'dev',
        priorityOrder: [{ kind: 'local', name: 'dev' }],
      },
    });
    const out = await buildResolvedRequest({
      state,
      workspaceId: 'ws-1',
      request: makeRequest(),
      vault: null,
      secrets: makeSecretStorage(),
    });
    expect(out.request.url).toBe('https://api.example.com/pets');
    expect(out.missing).toEqual([]);
  });

  it('drops encrypted env rows silently when the vault is null', async () => {
    const state = makeState({
      environments: {
        items: {
          dev: makeEnv('dev', [encryptedVar('path', 'enc:v1:bogus')]),
        },
        activeName: 'dev',
        priorityOrder: [{ kind: 'local', name: 'dev' }],
      },
    });
    const out = await buildResolvedRequest({
      state,
      workspaceId: 'ws-1',
      request: makeRequest({ url: 'https://api/{{path}}' }),
      vault: null,
      secrets: makeSecretStorage(),
    });
    expect(out.missing).toContain('path');
    // The original placeholder is preserved when not resolved.
    expect(out.request.url).toContain('{{path}}');
  });

  it('decrypts encrypted env rows via the vault when available', async () => {
    const state = makeState({
      environments: {
        items: {
          dev: makeEnv('dev', [encryptedVar('path', 'enc:v1:ciphertext')]),
        },
        activeName: 'dev',
        priorityOrder: [{ kind: 'local', name: 'dev' }],
      },
    });
    const vault = {
      decryptValue: vi.fn(async (_ws: string, wire: string) => `plain:${wire}`),
    } as unknown as VsCodeVaultManager;
    const out = await buildResolvedRequest({
      state,
      workspaceId: 'ws-1',
      request: makeRequest({ url: 'https://api/{{path}}' }),
      vault,
      secrets: makeSecretStorage(),
    });
    expect(vault.decryptValue).toHaveBeenCalledTimes(1);
    expect(out.request.url).toBe('https://api/plain:enc:v1:ciphertext');
  });

  it('tolerates vault decryption errors (row dropped, placeholder reported missing)', async () => {
    const state = makeState({
      environments: {
        items: {
          dev: makeEnv('dev', [encryptedVar('path', 'enc:v1:bogus')]),
        },
        activeName: 'dev',
        priorityOrder: [{ kind: 'local', name: 'dev' }],
      },
    });
    const vault = {
      decryptValue: vi.fn(async () => {
        throw new Error('locked');
      }),
    } as unknown as VsCodeVaultManager;
    const out = await buildResolvedRequest({
      state,
      workspaceId: 'ws-1',
      request: makeRequest({ url: 'https://api/{{path}}' }),
      vault,
      secrets: makeSecretStorage(),
    });
    expect(out.missing).toContain('path');
  });

  it('collects linked secret values by label and forwards them to the resolver', async () => {
    const link: LinkedWorkspace = {
      id: 'link-1',
      kind: 'public',
      sourceWorkspaceId: 'remote-ws-1',
      source: {
        repoFullName: 'owner/repo',
        branch: 'main',
        sessionMode: 'shared',
      },
      requiredSecretKeyIds: ['key-1'],
      pinnedVersion: null,
      addedAt: 't',
    } as unknown as LinkedWorkspace;
    const state = makeState(
      {
        linkedWorkspaces: { 'link-1': link },
      },
      {
        linkedCollections: {
          'link-1': {
            secretKeys: {
              'key-1': { id: 'key-1', label: 'API_TOKEN' },
            },
            environments: { items: {}, activeName: null, priorityOrder: [] },
            collections: {
              tree: { id: 'r', type: 'root', children: [] },
              requests: {},
              folders: {},
            },
            globalAssets: { schemas: {}, graphql: {}, files: {} },
          } as never,
        },
      },
    );
    const secrets = makeSecretStorage({
      [linkedSecretStorageKey('link-1', 'key-1')]: 'super-secret',
    });
    const out = await buildResolvedRequest({
      state,
      workspaceId: 'ws-1',
      request: makeRequest({
        url: 'https://api',
        headers: [{ key: 'X-Auth', value: '{{API_TOKEN}}', enabled: true }],
      }),
      vault: null,
      secrets,
    });
    expect(out.request.headers[0].value).toBe('super-secret');
  });
});

describe('buildLinkedAttachmentResolver', () => {
  it('returns a resolver that always yields null when the link id is unknown', async () => {
    const state = makeState();
    const resolver = buildLinkedAttachmentResolver({
      state,
      secrets: makeSecretStorage(),
      fromLinkId: 'no-such-link',
    });
    await expect(resolver('any-slot')).resolves.toBeNull();
  });
});
