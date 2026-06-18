import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { Mock } from 'vitest';
import type { ApplyMutationResult, WorkspacePatch, WorkspaceState } from '@apicircle/core';
import type { Request as ApiRequest, WorkspaceLocal, WorkspaceSynced } from '@apicircle/shared';
import type { Uri } from '../../test/mocks/vscode';
import { window } from '../../test/mocks/vscode';
import type { VsCodeBridge } from '../host/vscodeBridge';
import { newRequestFromTemplateCommand } from './newRequestFromTemplate';

function emptyState(): WorkspaceState {
  return {
    synced: {
      schemaVersion: 1,
      workspaceId: 'ws-1',
      collections: { tree: { id: 'root', type: 'root', children: [] }, requests: {}, folders: {} },
      environments: { items: {}, activeName: null, priorityOrder: [] },
      linkedWorkspaces: {},
      linkedOverrides: { requests: {}, environmentVars: {} },
      releases: { self: null, perLink: {} },
      globalAssets: { schemas: {}, graphql: {} },
      mockServers: {},
      meta: { createdAt: 't', updatedAt: 't', appVersion: '0.1.0' },
    } as unknown as WorkspaceSynced,
    local: {
      historyRuns: {},
      globalContext: {},
      linkedCollections: {},
      settings: {},
      mockServersRuntime: {},
    } as unknown as WorkspaceLocal,
  };
}

function makeBridge(initial: WorkspaceState): {
  bridge: VsCodeBridge;
  applied: WorkspacePatch[];
  state: WorkspaceState;
} {
  const applied: WorkspacePatch[] = [];
  const state = JSON.parse(JSON.stringify(initial)) as WorkspaceState;
  const surface = {
    workspace: { id: 'ws-1', name: 'demo', dir: '/x' },
    read: vi.fn(async () => state),
    write: vi.fn(),
    apply: vi.fn(async (patch: WorkspacePatch): Promise<ApplyMutationResult> => {
      applied.push(patch);
      // Reflect a few patch kinds into the read-back state so the URI
      // resolver downstream finds the new request.
      if (patch.kind === 'request.create') {
        (
          state.synced as { collections: { requests: Record<string, ApiRequest> } }
        ).collections.requests[patch.request.id] = patch.request;
      } else if (patch.kind === 'folder.create') {
        (
          state.synced as {
            collections: { folders: Record<string, unknown> };
          }
        ).collections.folders[patch.folder.id] = patch.folder;
      }
      return { state, mutated: true } as unknown as ApplyMutationResult;
    }),
  };
  return {
    bridge: { activeWorkspace: () => surface } as unknown as VsCodeBridge,
    applied,
    state,
  };
}

describe('newRequestFromTemplateCommand', () => {
  beforeEach(() => {
    (window.showQuickPick as Mock).mockReset();
    (window.showInputBox as Mock).mockReset();
    (window.showWarningMessage as Mock).mockReset();
  });

  it('warns when there is no active API Circle workspace', async () => {
    const bridge = { activeWorkspace: () => null } as unknown as VsCodeBridge;
    await newRequestFromTemplateCommand({ bridge });
    expect(window.showWarningMessage).toHaveBeenCalledWith('No active API Circle workspace.');
  });

  it('exits silently when the template picker is dismissed', async () => {
    const { bridge, applied } = makeBridge(emptyState());
    (window.showQuickPick as Mock).mockResolvedValueOnce(undefined);
    await newRequestFromTemplateCommand({ bridge });
    expect(applied).toHaveLength(0);
  });

  it('applies a single request.create for a single-shape template', async () => {
    const { bridge, applied } = makeBridge(emptyState());
    (window.showQuickPick as Mock)
      .mockResolvedValueOnce({ value: 'simple-get' }) // template
      .mockResolvedValueOnce({ folderId: null }); // folder
    const openCreated = vi.fn(async (_u: Uri) => undefined);
    await newRequestFromTemplateCommand({ bridge, openCreated });
    expect(applied).toHaveLength(1);
    expect(applied[0].kind).toBe('request.create');
    if (applied[0].kind === 'request.create') {
      expect(applied[0].request.method).toBe('GET');
      expect(applied[0].request.url).toBe('https://api.example.com/resource');
      expect(applied[0].request.folderId).toBeNull();
    }
    expect(openCreated).toHaveBeenCalledTimes(1);
  });

  it('targets the chosen folder when a folder pick is non-null', async () => {
    const state = emptyState();
    (state.synced as { collections: { folders: Record<string, unknown> } }).collections.folders[
      'f-1'
    ] = { id: 'f-1', name: 'Demo folder', parentId: null };
    const { bridge, applied } = makeBridge(state);
    (window.showQuickPick as Mock)
      .mockResolvedValueOnce({ value: 'json-post' })
      .mockResolvedValueOnce({ folderId: 'f-1' });
    await newRequestFromTemplateCommand({ bridge, openCreated: vi.fn() });
    expect(applied).toHaveLength(1);
    if (applied[0].kind === 'request.create') {
      expect(applied[0].request.folderId).toBe('f-1');
      expect(applied[0].request.method).toBe('POST');
    }
  });

  it('applies a folder + five requests for the REST CRUD template', async () => {
    const { bridge, applied } = makeBridge(emptyState());
    (window.showQuickPick as Mock)
      .mockResolvedValueOnce({ value: 'rest-crud' })
      .mockResolvedValueOnce({ folderId: null });
    (window.showInputBox as Mock).mockResolvedValueOnce('users');
    await newRequestFromTemplateCommand({ bridge, openCreated: vi.fn() });
    expect(applied).toHaveLength(6);
    expect(applied[0].kind).toBe('folder.create');
    if (applied[0].kind === 'folder.create') {
      expect(applied[0].folder.name).toBe('users (CRUD)');
    }
    const methods = applied
      .slice(1)
      .map((p) => (p.kind === 'request.create' ? p.request.method : ''));
    expect(methods).toEqual(['GET', 'GET', 'POST', 'PATCH', 'DELETE']);
  });

  it('returns silently when the CRUD resource prompt is cancelled', async () => {
    const { bridge, applied } = makeBridge(emptyState());
    (window.showQuickPick as Mock).mockResolvedValueOnce({ value: 'rest-crud' });
    (window.showInputBox as Mock).mockResolvedValueOnce(undefined);
    await newRequestFromTemplateCommand({ bridge });
    expect(applied).toHaveLength(0);
  });

  it('exposes a validator on the CRUD resource prompt that rejects invalid names', async () => {
    const { bridge } = makeBridge(emptyState());
    (window.showQuickPick as Mock).mockResolvedValueOnce({ value: 'rest-crud' });
    let captured: ((v: string) => string | null) | undefined;
    (window.showInputBox as Mock).mockImplementationOnce(
      async (opts: { validateInput?: (v: string) => string | null }) => {
        captured = opts.validateInput;
        return undefined;
      },
    );
    await newRequestFromTemplateCommand({ bridge });
    expect(captured).toBeDefined();
    expect(captured?.('')).toMatch(/required/i);
    expect(captured?.('123invalid')).toMatch(/must start/i);
    expect(captured?.('with space')).toMatch(/letters/i);
    expect(captured?.('users')).toBeNull();
    expect(captured?.('users_v2')).toBeNull();
  });
});
