import { describe, expect, it } from 'vitest';

import {
  WORKSPACE_DIR,
  REGISTRY_JSON_PATH,
  workspaceJsonPath,
  attachmentsDir,
  attachmentPath,
  parseRegistryActiveId,
  fetchRemoteWorkspaceJson,
} from './repoPaths';

describe('repoPaths', () => {
  it('uses the .apicircle dotfolder as the workspace dir', () => {
    expect(WORKSPACE_DIR).toBe('.apicircle');
  });

  it('writes the synced workspace document under the dotfolder', () => {
    expect(workspaceJsonPath('ws-1')).toBe('.apicircle/workspace-ws-1/workspace.json');
  });

  it('registry path is under the dotfolder', () => {
    expect(REGISTRY_JSON_PATH).toBe('.apicircle/registry.json');
  });

  it('attachments dir is under the workspace subfolder', () => {
    expect(attachmentsDir('ws-1')).toBe('.apicircle/workspace-ws-1/attachments');
  });

  it('attachmentPath embeds the slot id verbatim', () => {
    expect(attachmentPath('ws-1', 'slot-1')).toBe('.apicircle/workspace-ws-1/attachments/slot-1');
    expect(attachmentPath('ws-1', 'with spaces')).toBe(
      '.apicircle/workspace-ws-1/attachments/with spaces',
    );
  });
});

describe('parseRegistryActiveId', () => {
  it('returns activeWorkspaceId when present', () => {
    const json = JSON.stringify({
      activeWorkspaceId: 'ws-active',
      workspaces: [{ id: 'ws-first' }],
    });
    expect(parseRegistryActiveId(json)).toBe('ws-active');
  });

  it('falls back to first workspace entry when activeWorkspaceId is null', () => {
    const json = JSON.stringify({
      activeWorkspaceId: null,
      workspaces: [{ id: 'ws-first' }, { id: 'ws-second' }],
    });
    expect(parseRegistryActiveId(json)).toBe('ws-first');
  });

  it('falls back to first workspace entry when activeWorkspaceId is undefined', () => {
    const json = JSON.stringify({
      workspaces: [{ id: 'ws-only' }],
    });
    expect(parseRegistryActiveId(json)).toBe('ws-only');
  });

  it('returns null for empty workspaces array', () => {
    const json = JSON.stringify({ activeWorkspaceId: null, workspaces: [] });
    expect(parseRegistryActiveId(json)).toBeNull();
  });

  it('returns null when workspaces key is missing', () => {
    const json = JSON.stringify({ activeWorkspaceId: null });
    expect(parseRegistryActiveId(json)).toBeNull();
  });

  it('returns null for invalid JSON', () => {
    expect(parseRegistryActiveId('not valid json {')).toBeNull();
  });

  it('returns null for non-object root (string)', () => {
    expect(parseRegistryActiveId('"just a string"')).toBeNull();
  });

  it('returns null for non-object root (array)', () => {
    expect(parseRegistryActiveId('[1,2,3]')).toBeNull();
  });
});

describe('fetchRemoteWorkspaceJson', () => {
  it('returns workspaceId and content on successful 2-step fetch', async () => {
    const registry = JSON.stringify({
      activeWorkspaceId: 'ws-abc',
      workspaces: [{ id: 'ws-abc' }],
    });
    const workspaceContent = JSON.stringify({ name: 'My Workspace' });

    const fetchFile = async (path: string): Promise<string | null> => {
      if (path === REGISTRY_JSON_PATH) return registry;
      if (path === workspaceJsonPath('ws-abc')) return workspaceContent;
      return null;
    };

    const result = await fetchRemoteWorkspaceJson(fetchFile);
    expect(result).toEqual({ workspaceId: 'ws-abc', content: workspaceContent });
  });

  it('returns error when registry.json is missing', async () => {
    const fetchFile = async (_path: string): Promise<string | null> => null;

    const result = await fetchRemoteWorkspaceJson(fetchFile);
    expect(result).toEqual({ error: 'No .apicircle/registry.json found in repo' });
  });

  it('returns error when registry is empty', async () => {
    const emptyRegistry = JSON.stringify({ workspaces: [] });
    const fetchFile = async (path: string): Promise<string | null> => {
      if (path === REGISTRY_JSON_PATH) return emptyRegistry;
      return null;
    };

    const result = await fetchRemoteWorkspaceJson(fetchFile);
    expect(result).toEqual({ error: 'Registry is empty — no workspaces found' });
  });

  it('returns error when workspace.json is missing after registry resolves', async () => {
    const registry = JSON.stringify({
      activeWorkspaceId: 'ws-gone',
      workspaces: [{ id: 'ws-gone' }],
    });
    const fetchFile = async (path: string): Promise<string | null> => {
      if (path === REGISTRY_JSON_PATH) return registry;
      // workspace.json not found
      return null;
    };

    const result = await fetchRemoteWorkspaceJson(fetchFile);
    expect(result).toEqual({ error: 'No workspace.json at .apicircle/workspace-ws-gone/' });
  });
});
