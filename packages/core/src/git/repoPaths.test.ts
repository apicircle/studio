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

  it('accepts the id shapes Studio mints (UUIDs and the imported-folder wrapper)', () => {
    const uuid = '8f14e45f-ceea-467a-9575-6d8f0b2c1a3e';
    expect(workspaceJsonPath(uuid)).toBe(`.apicircle/workspace-${uuid}/workspace.json`);
    expect(attachmentPath('imported-folder-0123456789abcdef', uuid)).toBe(
      `.apicircle/workspace-imported-folder-0123456789abcdef/attachments/${uuid}`,
    );
  });

  // The workspace id and slot id come from a remote workspace.json /
  // registry.json. Each must stay one segment: the renderer's fetch collapses
  // `..` segments, so a traversal id would aim a Contents API call carrying
  // the user's token at another repository.
  const exploits = [
    '..',
    '../x',
    '..%2f',
    'a/../../b',
    '..\\x',
    '/etc/passwd',
    'C:\\x',
    '',
    '../../../../../../victim/priv/contents/.env',
  ];

  it.each(exploits)('refuses the workspace id %j in every path builder', (id) => {
    expect(() => workspaceJsonPath(id)).toThrow(/Unsafe workspace id/);
    expect(() => attachmentsDir(id)).toThrow(/Unsafe workspace id/);
    expect(() => attachmentPath(id, 'slot-1')).toThrow(/Unsafe workspace id/);
  });

  it.each(exploits)('refuses the attachment slot id %j', (slotId) => {
    expect(() => attachmentPath('ws-1', slotId)).toThrow(/Unsafe attachment slot id/);
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

  it('returns null for an empty-string active id with no entries (same as an empty registry)', () => {
    expect(parseRegistryActiveId(JSON.stringify({ activeWorkspaceId: '', workspaces: [] }))).toBe(
      null,
    );
  });

  it('refuses a traversal activeWorkspaceId instead of handing it to a path builder', () => {
    const json = JSON.stringify({
      activeWorkspaceId: 'a/../../x',
      workspaces: [{ id: 'ws-first' }],
    });
    expect(() => parseRegistryActiveId(json)).toThrow(
      /Unsafe workspace id in registry\.json "a\/\.\.\/\.\.\/x"/,
    );
  });

  it('refuses a traversal id on the first-entry fallback too', () => {
    const json = JSON.stringify({ activeWorkspaceId: null, workspaces: [{ id: '..\\x' }] });
    expect(() => parseRegistryActiveId(json)).toThrow(/Unsafe workspace id in registry\.json/);
  });

  it('refuses an id that is not a string', () => {
    expect(() => parseRegistryActiveId(JSON.stringify({ activeWorkspaceId: 7 }))).toThrow(
      /Unsafe workspace id in registry\.json \(number\)/,
    );
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

  it.each(['../../../other/repo', '..%2f..%2fx', 'a\\..\\b'])(
    'returns an error and never fetches a workspace path for the registry id %j',
    async (hostileId) => {
      const registry = JSON.stringify({ activeWorkspaceId: hostileId, workspaces: [] });
      const requested: string[] = [];
      const fetchFile = async (path: string): Promise<string | null> => {
        requested.push(path);
        return path === REGISTRY_JSON_PATH ? registry : '{}';
      };

      const result = await fetchRemoteWorkspaceJson(fetchFile);
      expect(result).toEqual({
        error: expect.stringMatching(/^Unsafe workspace id in registry\.json /),
      });
      expect(requested).toEqual([REGISTRY_JSON_PATH]);
    },
  );
});
