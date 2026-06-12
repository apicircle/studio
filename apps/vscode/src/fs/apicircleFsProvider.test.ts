import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { Uri } from '../../test/mocks/vscode';
import { VsCodeBridge } from '../host/vscodeBridge';
import {
  ApicircleFsProvider,
  __encodeAuthorityForTests,
  slugify,
  computeFolderSlugPath,
  disambiguateRequestSlug,
} from './apicircleFsProvider';
import { generateId } from '@apicircle/shared';
import type { Folder, Request } from '@apicircle/shared';

function makeMockContext(globalStoragePath: string) {
  const state = new Map<string, unknown>();
  return {
    subscriptions: [],
    globalState: {
      get: <T>(key: string, defaultValue?: T) =>
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
  } as never;
}

function seedWorkspaceWithRequest(apicircleDir: string, request: Request): void {
  fs.mkdirSync(apicircleDir, { recursive: true });
  const now = new Date().toISOString();
  const synced = {
    schemaVersion: 1,
    workspaceId: 'test-ws',
    collections: {
      tree: { id: 'root', type: 'root', children: [{ kind: 'request', id: request.id }] },
      requests: { [request.id]: request },
      folders: {},
    },
    environments: { items: {}, activeName: null, priorityOrder: [] },
    linkedWorkspaces: {},
    linkedOverrides: { requests: {}, environmentVars: {} },
    releases: { self: null, perLink: {} },
    globalAssets: { schemas: {}, graphql: {}, files: {} },
    mockServers: {},
    executionPlans: {},
    secretKeys: {},
    secretCrypto: null,
    meta: { createdAt: now, updatedAt: now, appVersion: '0.1.0' },
  };
  fs.writeFileSync(path.join(apicircleDir, 'workspace.json'), JSON.stringify(synced, null, 2));
}

function makeRequest(id = generateId(), over: Partial<Request> = {}): Request {
  return {
    id,
    name: 'Get user',
    folderId: null,
    method: 'GET',
    url: 'https://api.example.com/users/123',
    headers: [],
    query: [],
    body: { type: 'none', content: '' },
    auth: { type: 'none' },
    contextVars: [],
    extractions: [],
    assertions: [],
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    ...over,
  };
}

describe('slugify', () => {
  it('keeps alphanumerics and case', () => {
    expect(slugify('Login')).toBe('Login');
    expect(slugify('Get user 123')).toBe('Get-user-123');
  });

  it('replaces windows-illegal characters with underscores', () => {
    expect(slugify('a/b:c*d?e"f<g>h|i\\j')).toBe('a_b_c_d_e_f_g_h_i_j');
  });

  it('strips trailing dots', () => {
    expect(slugify('Trailing...')).toBe('Trailing');
  });

  it('caps very long names', () => {
    expect(slugify('x'.repeat(200)).length).toBe(80);
  });

  it('returns empty string for empty/whitespace input', () => {
    expect(slugify('')).toBe('');
    expect(slugify('   ')).toBe('');
  });
});

describe('computeFolderSlugPath', () => {
  const folders: Record<string, Folder> = {
    root: { id: 'root', name: 'Auth', parentId: null },
    child: { id: 'child', name: 'Login flow', parentId: 'root' },
  };

  it('returns [] for null folder id (root-level entity)', () => {
    expect(computeFolderSlugPath(null, folders)).toEqual([]);
  });

  it('returns a single slug for a root folder', () => {
    expect(computeFolderSlugPath('root', folders)).toEqual(['Auth']);
  });

  it('walks up the chain root → leaf', () => {
    expect(computeFolderSlugPath('child', folders)).toEqual(['Auth', 'Login-flow']);
  });

  it('is cycle-safe — stops at the first revisited node', () => {
    const cycle: Record<string, Folder> = {
      a: { id: 'a', name: 'A', parentId: 'b' },
      b: { id: 'b', name: 'B', parentId: 'a' },
    };
    expect(computeFolderSlugPath('a', cycle)).toEqual(['B', 'A']);
  });
});

describe('disambiguateRequestSlug', () => {
  it('keeps the base slug when no collision in the same folder', () => {
    const req = makeRequest('r1', { name: 'Login' });
    const siblings: Record<string, Request> = {
      r1: req,
      r2: makeRequest('r2', { name: 'Signup' }),
    };
    expect(disambiguateRequestSlug('Login', req, siblings)).toBe('Login');
  });

  it('suffixes with ~<shortId> when a sibling slugifies to the same string', () => {
    const a = makeRequest('req_abcdef0123', { name: 'Login' });
    const b = makeRequest('req_other00000', { name: 'Login' });
    const siblings: Record<string, Request> = { [a.id]: a, [b.id]: b };
    expect(disambiguateRequestSlug('Login', a, siblings)).toBe('Login~req_abcd');
  });

  it('ignores a same-name sibling in a DIFFERENT folder', () => {
    const a = makeRequest('r1', { name: 'Login', folderId: 'folderA' });
    const b = makeRequest('r2', { name: 'Login', folderId: 'folderB' });
    const siblings: Record<string, Request> = { r1: a, r2: b };
    expect(disambiguateRequestSlug('Login', a, siblings)).toBe('Login');
  });
});

describe('ApicircleFsProvider', () => {
  let tmp: string;
  let bridge: VsCodeBridge;
  let provider: ApicircleFsProvider;
  let apicircleDir: string;
  let workspaceId: string;
  let requestId: string;
  let request: Request;

  beforeEach(async () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'apicircle-fs-'));
    apicircleDir = path.join(tmp, '.apicircle');
    requestId = generateId();
    request = makeRequest(requestId);
    seedWorkspaceWithRequest(apicircleDir, request);

    bridge = new VsCodeBridge(makeMockContext(path.join(tmp, 'globalStorage')));
    workspaceId = apicircleDir;
    bridge.registerWorkspace({
      id: workspaceId,
      apicircleDir,
      workspaceJsonPath: path.join(apicircleDir, 'workspace.json'),
      workspaceFolder: { uri: Uri.file(tmp), name: 'test', index: 0 } as never,
      label: 'test',
    });
    bridge.setActive(workspaceId);
    provider = new ApicircleFsProvider(bridge);
  });

  afterEach(() => {
    bridge.dispose();
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  describe('requestUri()', () => {
    it('puts the slugified request name in the path and the id in ?id=', () => {
      const r = makeRequest('req_xyz', { name: 'Get user' });
      const uri = ApicircleFsProvider.requestUri('/some/.apicircle', r, {}, { req_xyz: r });
      expect(uri.scheme).toBe('apicircle');
      expect(uri.authority).toBe(__encodeAuthorityForTests('/some/.apicircle'));
      expect(uri.path).toBe('/requests/Get-user.req.yaml');
      expect(uri.query).toBe('id=req_xyz');
    });

    it('embeds the folder chain in the path so the tab tooltip shows it', () => {
      const folders: Record<string, Folder> = {
        f1: { id: 'f1', name: 'Auth', parentId: null },
        f2: { id: 'f2', name: 'OAuth', parentId: 'f1' },
      };
      const r = makeRequest('req_1', { name: 'Login', folderId: 'f2' });
      const uri = ApicircleFsProvider.requestUri('/x', r, folders, { req_1: r });
      expect(uri.path).toBe('/requests/Auth/OAuth/Login.req.yaml');
    });

    it('disambiguates colliding sibling slugs with ~<shortId>', () => {
      const a = makeRequest('req_abcdef0123', { name: 'Login' });
      const b = makeRequest('req_other00000', { name: 'Login' });
      const siblings: Record<string, Request> = { [a.id]: a, [b.id]: b };
      const uri = ApicircleFsProvider.requestUri('/x', a, {}, siblings);
      expect(uri.path).toBe('/requests/Login~req_abcd.req.yaml');
    });
  });

  describe('releases', () => {
    it('releasesUri() points at the workspace-scoped read-only document', () => {
      const uri = ApicircleFsProvider.releasesUri('/x/.apicircle');
      expect(uri.scheme).toBe('apicircle');
      expect(uri.path).toBe('/releases/releases.yaml');
      expect(uri.query).toBe('');
    });

    it('readFile renders the (empty) ledger', async () => {
      const uri = ApicircleFsProvider.releasesUri(workspaceId);
      const bytes = await provider.readFile(uri as never);
      const text = Buffer.from(bytes).toString('utf8');
      expect(text).toContain('currentVersion:');
      expect(text).toContain('▶ Publish release…');
    });

    it('writeFile is blocked — releases are action-driven', async () => {
      const uri = ApicircleFsProvider.releasesUri(workspaceId);
      await expect(
        provider.writeFile(uri as never, Buffer.from('currentVersion: 9', 'utf8'), {
          create: false,
          overwrite: true,
        }),
      ).rejects.toThrow(/read-only/);
    });
  });

  describe('links', () => {
    function seedLink(): void {
      const wsPath = path.join(apicircleDir, 'workspace.json');
      const synced = JSON.parse(fs.readFileSync(wsPath, 'utf8')) as Record<string, unknown>;
      synced.linkedWorkspaces = {
        lw1: {
          id: 'lw1',
          kind: 'public',
          name: 'Payments',
          source: {
            provider: 'github',
            repoFullName: 'org/payments',
            branch: 'main',
            sessionMode: 'workspace',
          },
          scope: ['collections', 'environments'],
          pinnedVersion: '1.0.0',
          updatePolicy: 'manual',
          linkedAt: '2026-01-01T00:00:00.000Z',
          requiredSecretKeyIds: [],
        },
      };
      (synced.releases as { perLink: Record<string, unknown> }).perLink = {
        lw1: {
          currentVersion: '1.0.0',
          versions: [
            {
              version: '1.0.0',
              publishedAt: 't',
              notes: '',
              workspaceSnapshot: 'a'.repeat(64),
              deprecated: false,
              yanked: false,
            },
          ],
        },
      };
      fs.writeFileSync(wsPath, JSON.stringify(synced, null, 2));
    }

    it('linkUri() embeds the slug + ?id=', () => {
      const uri = ApicircleFsProvider.linkUri('/x/.apicircle', {
        id: 'lw1',
        name: 'Payments API',
      } as never);
      expect(uri.path).toBe('/links/Payments-API.link.yaml');
      expect(uri.query).toBe('id=lw1');
    });

    it('readFile renders the link YAML with the cached ledger', async () => {
      seedLink();
      const uri = Uri.parse(
        `apicircle://${workspaceId ? __encodeAuthorityForTests(workspaceId) : ''}/links/Payments.link.yaml?id=lw1`,
      );
      const bytes = await provider.readFile(uri as never);
      const text = Buffer.from(bytes).toString('utf8');
      expect(text).toContain('repoFullName: org/payments');
      expect(text).toContain('pinnedVersion: 1.0.0');
      expect(text).toContain('Cached ledger');
    });

    it('writeFile rejects pinning a version not in the cached ledger', async () => {
      seedLink();
      const uri = Uri.parse(
        `apicircle://${__encodeAuthorityForTests(workspaceId)}/links/Payments.link.yaml?id=lw1`,
      );
      await expect(
        provider.writeFile(
          uri as never,
          Buffer.from('name: Payments\npinnedVersion: 9.9.9\n', 'utf8'),
          {
            create: false,
            overwrite: true,
          },
        ),
      ).rejects.toThrow(/not in the cached ledger/);
    });

    it('writeFile applies an editable patch (rename + scope)', async () => {
      seedLink();
      const uri = Uri.parse(
        `apicircle://${__encodeAuthorityForTests(workspaceId)}/links/Payments.link.yaml?id=lw1`,
      );
      await provider.writeFile(
        uri as never,
        Buffer.from('name: Renamed\nscope:\n  - collections\n', 'utf8'),
        { create: false, overwrite: true },
      );
      const synced = JSON.parse(
        fs.readFileSync(path.join(apicircleDir, 'workspace.json'), 'utf8'),
      ) as { linkedWorkspaces: Record<string, { name: string; scope: string[] }> };
      expect(synced.linkedWorkspaces.lw1.name).toBe('Renamed');
      expect(synced.linkedWorkspaces.lw1.scope).toEqual(['collections']);
    });

    it('delete unlinks the workspace', async () => {
      seedLink();
      const uri = Uri.parse(
        `apicircle://${__encodeAuthorityForTests(workspaceId)}/links/Payments.link.yaml?id=lw1`,
      );
      await provider.delete(uri as never, { recursive: false });
      const synced = JSON.parse(
        fs.readFileSync(path.join(apicircleDir, 'workspace.json'), 'utf8'),
      ) as { linkedWorkspaces: Record<string, unknown> };
      expect(synced.linkedWorkspaces.lw1).toBeUndefined();
    });
  });

  describe('linked requests', () => {
    const linkRec = {
      id: 'lw1',
      kind: 'public' as const,
      name: 'Payments',
      source: {
        provider: 'github' as const,
        repoFullName: 'org/payments',
        branch: 'main',
        sessionMode: 'workspace' as const,
      },
      scope: ['collections' as const, 'environments' as const],
      pinnedVersion: null,
      updatePolicy: 'manual' as const,
      linkedAt: '2026-01-01T00:00:00.000Z',
      requiredSecretKeyIds: [],
    };
    function baseReq(): Request {
      return makeRequest('lreq-1', { name: 'List pets', url: 'https://api/pets', method: 'GET' });
    }
    async function seedLinkedRequest(): Promise<void> {
      const snapshot = {
        pulledAt: '2026-01-01T00:00:00.000Z',
        ref: 'HEAD@main',
        collections: {
          tree: { id: 'r', type: 'root' as const, children: [] },
          requests: { 'lreq-1': baseReq() },
          folders: {},
        },
        environments: { items: {}, activeName: null, priorityOrder: [] },
      };
      await bridge
        .activeWorkspace()!
        .apply({ kind: 'linkedWorkspace.upsert', link: linkRec, snapshot });
    }
    function linkedUri() {
      return Uri.parse(
        `apicircle://${__encodeAuthorityForTests(workspaceId)}/linked/Payments/List-pets.req.yaml?link=lw1&id=lreq-1`,
      );
    }

    it('linkedRequestUri embeds link slug + ?link=&id=', () => {
      const uri = ApicircleFsProvider.linkedRequestUri(
        '/x/.apicircle',
        linkRec as never,
        baseReq(),
      );
      expect(uri.path).toBe('/linked/Payments/List-pets.req.yaml');
      expect(uri.query).toBe('link=lw1&id=lreq-1');
    });

    it('readFile renders the effective request (base, then base+override)', async () => {
      await seedLinkedRequest();
      const before = Buffer.from(await provider.readFile(linkedUri() as never)).toString('utf8');
      expect(before).toContain('https://api/pets');

      // Apply an override and re-read.
      await bridge.activeWorkspace()!.apply({
        kind: 'linkedOverride.setRequest',
        override: {
          linkedWorkspaceId: 'lw1',
          itemId: 'lreq-1',
          patch: { url: 'https://mine/pets' },
          updatedAt: 't',
        },
      });
      const after = Buffer.from(await provider.readFile(linkedUri() as never)).toString('utf8');
      expect(after).toContain('https://mine/pets');
    });

    it('writeFile persists a delta as an override; identical content drops it', async () => {
      await seedLinkedRequest();
      await provider.writeFile(
        linkedUri() as never,
        Buffer.from('name: List pets\nmethod: GET\nurl: https://mine/pets\n', 'utf8'),
        { create: false, overwrite: true },
      );
      let synced = JSON.parse(
        fs.readFileSync(path.join(apicircleDir, 'workspace.json'), 'utf8'),
      ) as {
        linkedOverrides: { requests: Record<string, { patch: { url?: string } }> };
      };
      expect(synced.linkedOverrides.requests['lw1:lreq-1'].patch.url).toBe('https://mine/pets');

      // Writing the source values back drops the override.
      await provider.writeFile(
        linkedUri() as never,
        Buffer.from('name: List pets\nmethod: GET\nurl: https://api/pets\n', 'utf8'),
        { create: false, overwrite: true },
      );
      synced = JSON.parse(
        fs.readFileSync(path.join(apicircleDir, 'workspace.json'), 'utf8'),
      ) as never;
      expect(synced.linkedOverrides.requests['lw1:lreq-1']).toBeUndefined();
    });

    it('delete resets the linked request to source', async () => {
      await seedLinkedRequest();
      await bridge.activeWorkspace()!.apply({
        kind: 'linkedOverride.setRequest',
        override: {
          linkedWorkspaceId: 'lw1',
          itemId: 'lreq-1',
          patch: { url: 'https://mine/pets' },
          updatedAt: 't',
        },
      });
      await provider.delete(linkedUri() as never, { recursive: false });
      const synced = JSON.parse(
        fs.readFileSync(path.join(apicircleDir, 'workspace.json'), 'utf8'),
      ) as {
        linkedOverrides: { requests: Record<string, unknown> };
      };
      expect(synced.linkedOverrides.requests['lw1:lreq-1']).toBeUndefined();
    });
  });

  describe('readFile()', () => {
    it('serializes the stored request as YAML', async () => {
      const uri = ApicircleFsProvider.requestUri(
        workspaceId,
        request,
        {},
        { [requestId]: request },
      );
      const bytes = await provider.readFile(uri as never);
      const text = Buffer.from(bytes).toString('utf8');
      expect(text).toContain('name: Get user');
      expect(text).toContain('method: GET');
      expect(text).toContain('url: https://api.example.com/users/123');
    });

    it('throws FileNotFound for an unknown request id', async () => {
      const ghost = makeRequest('nonexistent');
      const uri = ApicircleFsProvider.requestUri(workspaceId, ghost, {}, { nonexistent: ghost });
      await expect(provider.readFile(uri as never)).rejects.toThrow(/File not found/);
    });

    it('throws FileNotFound for an unknown workspace authority', async () => {
      const uri = ApicircleFsProvider.requestUri(
        '/other/.apicircle',
        request,
        {},
        { [requestId]: request },
      );
      await expect(provider.readFile(uri as never)).rejects.toThrow(/File not found/);
    });
  });

  describe('writeFile()', () => {
    it('persists a name edit through applyMutation', async () => {
      const uri = ApicircleFsProvider.requestUri(
        workspaceId,
        request,
        {},
        { [requestId]: request },
      );
      const newYaml = `name: Renamed\nmethod: GET\nurl: https://api.example.com/users/123\n`;
      await provider.writeFile(uri as never, Buffer.from(newYaml, 'utf8'), {
        create: false,
        overwrite: true,
      });

      // Read disk directly to verify the round-trip went through to workspace.json
      const synced = JSON.parse(
        fs.readFileSync(path.join(apicircleDir, 'workspace.json'), 'utf8'),
      ) as { collections: { requests: Record<string, Request> } };
      expect(synced.collections.requests[requestId].name).toBe('Renamed');
    });

    it('throws NoPermissions on invalid YAML', async () => {
      const uri = ApicircleFsProvider.requestUri(
        workspaceId,
        request,
        {},
        { [requestId]: request },
      );
      await expect(
        provider.writeFile(uri as never, Buffer.from('::: !! ::', 'utf8'), {
          create: false,
          overwrite: true,
        }),
      ).rejects.toThrow(/Invalid YAML/);
    });

    it('throws NoPermissions when required fields are missing', async () => {
      const uri = ApicircleFsProvider.requestUri(
        workspaceId,
        request,
        {},
        { [requestId]: request },
      );
      await expect(
        provider.writeFile(uri as never, Buffer.from('name: x', 'utf8'), {
          create: false,
          overwrite: true,
        }),
      ).rejects.toThrow(/method/);
    });
  });

  describe('delete()', () => {
    it('removes the request from the workspace', async () => {
      const uri = ApicircleFsProvider.requestUri(
        workspaceId,
        request,
        {},
        { [requestId]: request },
      );
      await provider.delete(uri as never, { recursive: false });
      const synced = JSON.parse(
        fs.readFileSync(path.join(apicircleDir, 'workspace.json'), 'utf8'),
      ) as { collections: { requests: Record<string, unknown> } };
      expect(synced.collections.requests[requestId]).toBeUndefined();
    });
  });

  describe('rename()', () => {
    it('refuses with a helpful message — rename via name: field instead', () => {
      const uri = ApicircleFsProvider.requestUri(
        workspaceId,
        request,
        {},
        { [requestId]: request },
      );
      const otherReq = makeRequest('other');
      const other = ApicircleFsProvider.requestUri(workspaceId, otherReq, {}, { other: otherReq });
      expect(() => provider.rename(uri as never, other as never, { overwrite: false })).toThrow(
        /name:/,
      );
    });
  });

  describe('createDirectory()', () => {
    it('refuses — folders are managed via TreeView, not FS', () => {
      const uri = Uri.parse('apicircle://x/folders/y');
      expect(() => provider.createDirectory(uri as never)).toThrow(/TreeView/);
    });
  });
});
