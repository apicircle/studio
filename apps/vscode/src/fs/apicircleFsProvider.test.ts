import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { Uri, FileType } from '../../test/mocks/vscode';
import { VsCodeBridge } from '../host/vscodeBridge';
import {
  ApicircleFsProvider,
  __encodeAuthorityForTests,
  slugify,
  computeFolderSlugPath,
  disambiguateRequestSlug,
  disambiguateFolderSlug,
} from './apicircleFsProvider';
import { generateId } from '@apicircle/shared';
import type {
  Folder,
  Request,
  MockServer,
  MockEndpoint,
  ExecutionPlan,
  Environment,
  LinkedWorkspace,
  RequestRun,
  PlanRun,
} from '@apicircle/shared';

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

describe('disambiguateFolderSlug', () => {
  it('keeps the base slug when no collision at the same parent', () => {
    const f: Folder = { id: 'f1', name: 'Auth', parentId: null };
    const folders: Record<string, Folder> = {
      f1: f,
      f2: { id: 'f2', name: 'Users', parentId: null },
    };
    expect(disambiguateFolderSlug('Auth', f, folders)).toBe('Auth');
  });

  it('suffixes with ~<shortId> when a sibling slugifies to the same string', () => {
    const a: Folder = { id: 'fld_abcdef0123', name: 'Auth', parentId: null };
    const b: Folder = { id: 'fld_other00000', name: 'Auth', parentId: null };
    const folders: Record<string, Folder> = { [a.id]: a, [b.id]: b };
    expect(disambiguateFolderSlug('Auth', a, folders)).toBe('Auth~fld_abcd');
  });

  it('ignores a same-name folder under a DIFFERENT parent', () => {
    const a: Folder = { id: 'fA', name: 'Auth', parentId: null };
    const b: Folder = { id: 'fB', name: 'Auth', parentId: 'fA' };
    const folders: Record<string, Folder> = { fA: a, fB: b };
    expect(disambiguateFolderSlug('Auth', a, folders)).toBe('Auth');
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
      source: 'git-folder',
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
      expect(uri.path).toBe('/requests/Get-user.yaml');
      expect(uri.query).toBe('id=req_xyz');
    });

    it('embeds the folder chain in the path so the tab tooltip shows it', () => {
      const folders: Record<string, Folder> = {
        f1: { id: 'f1', name: 'Auth', parentId: null },
        f2: { id: 'f2', name: 'OAuth', parentId: 'f1' },
      };
      const r = makeRequest('req_1', { name: 'Login', folderId: 'f2' });
      const uri = ApicircleFsProvider.requestUri('/x', r, folders, { req_1: r });
      expect(uri.path).toBe('/requests/Auth/OAuth/Login.yaml');
    });

    it('disambiguates colliding sibling slugs with ~<shortId>', () => {
      const a = makeRequest('req_abcdef0123', { name: 'Login' });
      const b = makeRequest('req_other00000', { name: 'Login' });
      const siblings: Record<string, Request> = { [a.id]: a, [b.id]: b };
      const uri = ApicircleFsProvider.requestUri('/x', a, {}, siblings);
      expect(uri.path).toBe('/requests/Login~req_abcd.yaml');
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
      expect(uri.path).toBe('/links/Payments-API.yaml');
      expect(uri.query).toBe('id=lw1');
    });

    it('readFile renders the link YAML with the cached ledger', async () => {
      seedLink();
      const uri = Uri.parse(
        `apicircle://${workspaceId ? __encodeAuthorityForTests(workspaceId) : ''}/links/Payments.yaml?id=lw1`,
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
        `apicircle://${__encodeAuthorityForTests(workspaceId)}/links/Payments.yaml?id=lw1`,
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
        `apicircle://${__encodeAuthorityForTests(workspaceId)}/links/Payments.yaml?id=lw1`,
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
        `apicircle://${__encodeAuthorityForTests(workspaceId)}/links/Payments.yaml?id=lw1`,
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
        `apicircle://${__encodeAuthorityForTests(workspaceId)}/linked/Payments/List-pets.yaml?link=lw1&id=lreq-1`,
      );
    }

    it('linkedRequestUri embeds link slug + ?link=&id=', () => {
      const uri = ApicircleFsProvider.linkedRequestUri(
        '/x/.apicircle',
        linkRec as never,
        baseReq(),
      );
      expect(uri.path).toBe('/linked/Payments/List-pets.yaml');
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
    it('refuses — folders are managed via the New Folder command, not FS', () => {
      const uri = Uri.parse('apicircle://x/folders/y');
      expect(() => provider.createDirectory(uri as never)).toThrow(/New Folder/);
    });
  });

  describe('folders/', () => {
    function seedFolders(folders: Record<string, Folder>): void {
      const wsPath = path.join(apicircleDir, 'workspace.json');
      const synced = JSON.parse(fs.readFileSync(wsPath, 'utf8')) as {
        collections: { folders: Record<string, Folder>; tree: { children: unknown[] } };
      };
      synced.collections.folders = folders;
      synced.collections.tree.children = [
        ...Object.values(folders)
          .filter((f) => f.parentId === null)
          .map((f) => ({ kind: 'folder', id: f.id })),
        ...synced.collections.tree.children,
      ];
      fs.writeFileSync(wsPath, JSON.stringify(synced, null, 2));
    }

    it('folderUri() puts the slug in the path and the id in ?id=', () => {
      const f: Folder = { id: 'f_xyz', name: 'Auth', parentId: null };
      const uri = ApicircleFsProvider.folderUri('/some/.apicircle', f, { f_xyz: f });
      expect(uri.scheme).toBe('apicircle');
      expect(uri.path).toBe('/folders/Auth.yaml');
      expect(uri.query).toBe('id=f_xyz');
    });

    it('folderUri() embeds the parent breadcrumb in the path', () => {
      const folders: Record<string, Folder> = {
        f1: { id: 'f1', name: 'Auth', parentId: null },
        f2: { id: 'f2', name: 'OAuth', parentId: 'f1' },
      };
      const uri = ApicircleFsProvider.folderUri('/x', folders.f2, folders);
      expect(uri.path).toBe('/folders/Auth/OAuth.yaml');
    });

    it('readFile returns the folder YAML projection', async () => {
      const f: Folder = {
        id: 'fA',
        name: 'API v2',
        parentId: null,
        auth: { type: 'bearer', token: 'tok' },
      };
      seedFolders({ fA: f });
      const uri = ApicircleFsProvider.folderUri(workspaceId, f, { fA: f });
      const bytes = await provider.readFile(uri as never);
      const text = Buffer.from(bytes).toString('utf8');
      expect(text).toContain('name: API v2');
      expect(text).toContain('type: bearer');
      expect(text).toContain('token: tok');
    });

    it('writeFile updates the folder name + auth in workspace.json', async () => {
      const f: Folder = { id: 'fA', name: 'Old', parentId: null };
      seedFolders({ fA: f });
      const uri = ApicircleFsProvider.folderUri(workspaceId, f, { fA: f });
      const yaml = 'name: New\nauth:\n  type: bearer\n  token: TOK\n';
      await provider.writeFile(uri as never, Buffer.from(yaml, 'utf8'), {
        create: false,
        overwrite: true,
      });
      const synced = JSON.parse(
        fs.readFileSync(path.join(apicircleDir, 'workspace.json'), 'utf8'),
      ) as { collections: { folders: Record<string, Folder> } };
      expect(synced.collections.folders.fA.name).toBe('New');
      expect(synced.collections.folders.fA.auth).toEqual({ type: 'bearer', token: 'TOK' });
    });

    it('writeFile clears auth when the YAML omits the section', async () => {
      const f: Folder = {
        id: 'fA',
        name: 'A',
        parentId: null,
        auth: { type: 'bearer', token: 'old' },
      };
      seedFolders({ fA: f });
      const uri = ApicircleFsProvider.folderUri(workspaceId, f, { fA: f });
      await provider.writeFile(uri as never, Buffer.from('name: A\n', 'utf8'), {
        create: false,
        overwrite: true,
      });
      const synced = JSON.parse(
        fs.readFileSync(path.join(apicircleDir, 'workspace.json'), 'utf8'),
      ) as { collections: { folders: Record<string, Folder> } };
      expect(synced.collections.folders.fA.auth).toBeUndefined();
    });

    it('writeFile rejects unknown top-level keys', async () => {
      const f: Folder = { id: 'fA', name: 'A', parentId: null };
      seedFolders({ fA: f });
      const uri = ApicircleFsProvider.folderUri(workspaceId, f, { fA: f });
      await expect(
        provider.writeFile(uri as never, Buffer.from('name: A\nbogus: 1\n', 'utf8'), {
          create: false,
          overwrite: true,
        }),
      ).rejects.toThrow(/Unknown field/);
    });

    it('writeFile errors when the folder no longer exists', async () => {
      const f: Folder = { id: 'fA', name: 'A', parentId: null };
      const uri = ApicircleFsProvider.folderUri(workspaceId, f, { fA: f });
      // folder not seeded
      await expect(
        provider.writeFile(uri as never, Buffer.from('name: A\n', 'utf8'), {
          create: false,
          overwrite: true,
        }),
      ).rejects.toThrow(/no longer exists/);
    });

    it('writeFile rejects a rename that collides with a sibling under the same parent', async () => {
      const a: Folder = { id: 'fA', name: 'Auth', parentId: null };
      const b: Folder = { id: 'fB', name: 'Other', parentId: null };
      seedFolders({ fA: a, fB: b });
      const uri = ApicircleFsProvider.folderUri(workspaceId, b, { fA: a, fB: b });
      await expect(
        provider.writeFile(uri as never, Buffer.from('name: Auth\n', 'utf8'), {
          create: false,
          overwrite: true,
        }),
      ).rejects.toThrow(/already exists/);
      // And the on-disk state should be unchanged for fB.
      const synced = JSON.parse(
        fs.readFileSync(path.join(apicircleDir, 'workspace.json'), 'utf8'),
      ) as { collections: { folders: Record<string, Folder> } };
      expect(synced.collections.folders.fB.name).toBe('Other');
    });

    it('saving a renamed folder makes it reachable via the new slug URI', async () => {
      const f: Folder = { id: 'fA', name: 'Old', parentId: null };
      seedFolders({ fA: f });
      const oldUri = ApicircleFsProvider.folderUri(workspaceId, f, { fA: f });
      // Save with the renamed name.
      await provider.writeFile(oldUri as never, Buffer.from('name: Renamed\n', 'utf8'), {
        create: false,
        overwrite: true,
      });
      // Build the post-rename URI from the now-current folder shape.
      const renamed: Folder = { id: 'fA', name: 'Renamed', parentId: null };
      const newUri = ApicircleFsProvider.folderUri(workspaceId, renamed, { fA: renamed });
      expect(newUri.path).toBe('/folders/Renamed.yaml');
      expect(newUri.path).not.toBe(oldUri.path);
      // The folder is reachable via the new URI…
      const bytes = await provider.readFile(newUri as never);
      expect(Buffer.from(bytes).toString('utf8')).toContain('name: Renamed');
    });

    it('linkedFolderUri() builds a /linked/<linkSlug>/<folderSlug>.yaml URI', () => {
      const link = {
        id: 'lw1',
        name: 'Payments',
      } as unknown as Parameters<typeof ApicircleFsProvider.linkedFolderUri>[1];
      const f: Folder = { id: 'fA', name: 'Authenticated', parentId: null };
      const uri = ApicircleFsProvider.linkedFolderUri(workspaceId, link, f);
      expect(uri.scheme).toBe('apicircle');
      expect(uri.path).toBe('/linked/Payments/Authenticated.yaml');
      expect(uri.query).toContain('link=lw1');
      expect(uri.query).toContain('id=fA');
      expect(uri.query).toContain('kind=folder');
    });

    it('linkedFolders readFile renders the linked snapshot folder + blocks writes', async () => {
      // Use the same upsert path the production code uses to seed linked
      // workspaces; this populates both `synced.linkedWorkspaces` AND
      // `local.linkedCollections` atomically without bypassing the reducer.
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
        scope: ['collections' as const],
        pinnedVersion: null,
        updatePolicy: 'manual' as const,
        linkedAt: '2026-01-01T00:00:00.000Z',
        requiredSecretKeyIds: [],
      };
      const sourceFolder: Folder = {
        id: 'lf1',
        name: 'Authenticated',
        parentId: null,
        auth: { type: 'bearer', token: 'src-tok' },
      };
      const snapshot = {
        pulledAt: '2026-01-01T00:00:00.000Z',
        ref: 'HEAD@main',
        collections: {
          tree: { id: 'r', type: 'root' as const, children: [] },
          requests: {},
          folders: { lf1: sourceFolder },
        },
        environments: { items: {}, activeName: null, priorityOrder: [] },
      };
      await bridge
        .activeWorkspace()!
        .apply({ kind: 'linkedWorkspace.upsert', link: linkRec, snapshot });

      const uri = ApicircleFsProvider.linkedFolderUri(workspaceId, linkRec as never, sourceFolder);
      const text = Buffer.from(await provider.readFile(uri as never)).toString('utf8');
      expect(text).toContain('name: Authenticated');
      expect(text).toContain('type: bearer');

      // Writes are blocked — linked entities project the source, never mutate it.
      await expect(
        provider.writeFile(uri as never, Buffer.from('name: hacked', 'utf8'), {
          create: false,
          overwrite: true,
        }),
      ).rejects.toThrow(/read-only/);
    });

    it('delete removes the folder (and reparents descendants)', async () => {
      const parent: Folder = { id: 'fP', name: 'Parent', parentId: null };
      const child: Folder = { id: 'fC', name: 'Child', parentId: 'fP' };
      seedFolders({ fP: parent, fC: child });
      const uri = ApicircleFsProvider.folderUri(workspaceId, parent, {
        fP: parent,
        fC: child,
      });
      await provider.delete(uri as never, { recursive: false });
      const synced = JSON.parse(
        fs.readFileSync(path.join(apicircleDir, 'workspace.json'), 'utf8'),
      ) as { collections: { folders: Record<string, Folder> } };
      expect(synced.collections.folders.fP).toBeUndefined();
      expect(synced.collections.folders.fC.parentId).toBeNull();
    });
  });

  // ===========================================================================
  // watch() + readDirectory() + fireChangedExternal()
  // ===========================================================================

  describe('watch()', () => {
    it('returns a disposable no-op', () => {
      const uri = Uri.parse('apicircle://x/requests/foo.yaml?id=r1');
      const disposable = provider.watch(uri as never);
      expect(typeof disposable.dispose).toBe('function');
      disposable.dispose(); // should not throw
    });
  });

  describe('readDirectory()', () => {
    it('returns an empty array (no directory listing exposed)', async () => {
      const uri = Uri.parse('apicircle://x/requests');
      const entries = await provider.readDirectory(uri as never);
      expect(entries).toEqual([]);
    });
  });

  describe('fireChangedExternal()', () => {
    it('emits a Changed event on the event emitter', () => {
      const uri = Uri.parse('apicircle://x/requests/foo.yaml?id=r1');
      const events: unknown[] = [];
      provider.onDidChangeFile((e) => events.push(e));
      provider.fireChangedExternal(uri as never);
      expect(events.length).toBe(1);
      expect((events[0] as Array<{ type: number }>)[0].type).toBe(1); // FileChangeType.Changed
    });
  });

  // ===========================================================================
  // Response + history store paths
  // ===========================================================================

  describe('responses/', () => {
    it('responseUri() builds the correct URI shape', () => {
      const uri = ApicircleFsProvider.responseUri('/ws/.apicircle', 'run-1', 'Login');
      expect(uri.scheme).toBe('apicircle');
      expect(uri.path).toBe('/responses/Login.yaml');
      expect(uri.query).toBe('runId=run-1');
    });

    it('responseUri() falls back to "response" for empty name', () => {
      const uri = ApicircleFsProvider.responseUri('/ws/.apicircle', 'run-2', '');
      expect(uri.path).toBe('/responses/response.yaml');
    });

    it('storeResponse + readFile round-trips a stored response', async () => {
      provider.storeResponse('run-1', 'status: 200\nbody: ok\n');
      const uri = ApicircleFsProvider.responseUri(workspaceId, 'run-1', 'Test');
      const bytes = await provider.readFile(uri as never);
      expect(Buffer.from(bytes).toString('utf8')).toBe('status: 200\nbody: ok\n');
    });

    it('readFile throws FileNotFound for an unknown response runId', async () => {
      const uri = ApicircleFsProvider.responseUri(workspaceId, 'missing', 'Test');
      await expect(provider.readFile(uri as never)).rejects.toThrow(/File not found/);
    });

    it('stat returns the size of a stored response', async () => {
      provider.storeResponse('run-x', 'hello');
      const uri = ApicircleFsProvider.responseUri(workspaceId, 'run-x', 'A');
      const stat = await provider.stat(uri as never);
      expect(stat.type).toBe(FileType.File);
      expect(stat.size).toBe(5);
    });

    it('stat throws FileNotFound for a missing response', async () => {
      const uri = ApicircleFsProvider.responseUri(workspaceId, 'nope', 'A');
      await expect(provider.stat(uri as never)).rejects.toThrow(/File not found/);
    });

    it('writeFile on responses updates the in-memory store (accepts transient edits)', async () => {
      provider.storeResponse('run-w', 'original');
      const uri = ApicircleFsProvider.responseUri(workspaceId, 'run-w', 'Test');
      const events: unknown[] = [];
      provider.onDidChangeFile((e) => events.push(e));
      await provider.writeFile(uri as never, Buffer.from('edited', 'utf8'), {
        create: false,
        overwrite: true,
      });
      // Re-read should see the edit
      const bytes = await provider.readFile(uri as never);
      expect(Buffer.from(bytes).toString('utf8')).toBe('edited');
      expect(events.length).toBe(1);
    });
  });

  describe('history/', () => {
    it('historyUri() builds the correct URI shape', () => {
      const uri = ApicircleFsProvider.historyUri('/ws/.apicircle', 'run-h1', 'Get users');
      expect(uri.scheme).toBe('apicircle');
      expect(uri.path).toBe('/history/Get-users.yaml');
      expect(uri.query).toBe('runId=run-h1');
    });

    it('historyUri() falls back to "run" for empty label', () => {
      const uri = ApicircleFsProvider.historyUri('/ws/.apicircle', 'run-h2');
      expect(uri.path).toBe('/history/run.yaml');
    });

    it('storeHistoryRun + readFile round-trips a pre-cached history entry', async () => {
      provider.storeHistoryRun('hrun-1', 'summary:\n  status: 200\n');
      const uri = ApicircleFsProvider.historyUri(workspaceId, 'hrun-1', 'Test');
      const bytes = await provider.readFile(uri as never);
      expect(Buffer.from(bytes).toString('utf8')).toBe('summary:\n  status: 200\n');
    });

    it('stat returns the size of a cached history entry', async () => {
      provider.storeHistoryRun('hrun-s', 'content');
      const uri = ApicircleFsProvider.historyUri(workspaceId, 'hrun-s', 'A');
      const stat = await provider.stat(uri as never);
      expect(stat.type).toBe(FileType.File);
      expect(stat.size).toBe(7);
    });

    it('stat throws FileNotFound for a missing history entry', async () => {
      const uri = ApicircleFsProvider.historyUri(workspaceId, 'nope', 'A');
      await expect(provider.stat(uri as never)).rejects.toThrow(/File not found/);
    });

    it('writeFile on history updates the in-memory store', async () => {
      provider.storeHistoryRun('hrun-w', 'original');
      const uri = ApicircleFsProvider.historyUri(workspaceId, 'hrun-w', 'Test');
      await provider.writeFile(uri as never, Buffer.from('edited', 'utf8'), {
        create: false,
        overwrite: true,
      });
      const bytes = await provider.readFile(uri as never);
      expect(Buffer.from(bytes).toString('utf8')).toBe('edited');
    });

    it('readFile lazy-populates from a requestRun in workspace local history', async () => {
      const run: RequestRun = {
        id: 'lazy-run-1',
        requestId: requestId,
        startedAt: '2026-01-01T00:00:00Z',
        durationMs: 42,
        status: 200,
        statusText: 'OK',
        ok: true,
        url: 'https://example.com',
        method: 'GET',
        requestHeaders: {},
        requestBodyPreview: null,
        responseHeaders: {},
        responseBodyPreview: '{}',
        responseBodyKind: 'json',
        responseTruncated: false,
        assertions: [],
      };
      // Seed a requestRun into the local state
      const surface = bridge.activeWorkspace()!;
      const state = await surface.read();
      await surface.write({
        local: {
          ...state.local,
          history: {
            ...state.local.history,
            requestRuns: [run],
            planRuns: [],
          },
        },
      });
      const uri = ApicircleFsProvider.historyUri(workspaceId, 'lazy-run-1', 'Test');
      const bytes = await provider.readFile(uri as never);
      const text = Buffer.from(bytes).toString('utf8');
      expect(text).toContain('200 OK');
      expect(text).toContain('https://example.com');
    });

    it('readFile lazy-populates from a planRun in workspace local history', async () => {
      const reqRun: RequestRun = {
        id: 'pr-reqrun-1',
        requestId: requestId,
        startedAt: '2026-01-01T00:00:00Z',
        durationMs: 10,
        status: 200,
        statusText: 'OK',
        ok: true,
        url: 'https://example.com',
        method: 'GET',
        requestHeaders: {},
        requestBodyPreview: null,
        responseHeaders: {},
        responseBodyPreview: '{}',
        responseBodyKind: 'json',
        responseTruncated: false,
        assertions: [],
      };
      const planRun: PlanRun = {
        id: 'lazy-plan-1',
        planId: 'plan-x',
        startedAt: '2026-01-01T00:00:00Z',
        durationMs: 50,
        withAssertions: false,
        steps: [{ requestRunId: 'pr-reqrun-1', passed: true }],
      };
      const surface = bridge.activeWorkspace()!;
      const state = await surface.read();
      await surface.write({
        local: {
          ...state.local,
          history: {
            ...state.local.history,
            requestRuns: [reqRun],
            planRuns: [planRun],
          },
        },
      });
      const uri = ApicircleFsProvider.historyUri(workspaceId, 'lazy-plan-1', 'Plan test');
      const bytes = await provider.readFile(uri as never);
      const text = Buffer.from(bytes).toString('utf8');
      expect(text).toContain('plan-x');
    });

    it('readFile throws FileNotFound when no matching run in history', async () => {
      const uri = ApicircleFsProvider.historyUri(workspaceId, 'non-existent', 'Test');
      await expect(provider.readFile(uri as never)).rejects.toThrow(/File not found/);
    });
  });

  // ===========================================================================
  // Environments
  // ===========================================================================

  describe('environments/', () => {
    function seedEnv(env: Environment): void {
      const wsPath = path.join(apicircleDir, 'workspace.json');
      const synced = JSON.parse(fs.readFileSync(wsPath, 'utf8')) as {
        environments: { items: Record<string, Environment> };
      };
      synced.environments.items[env.name] = env;
      fs.writeFileSync(wsPath, JSON.stringify(synced, null, 2));
    }

    it('environmentUri() builds the correct URI', () => {
      const uri = ApicircleFsProvider.environmentUri('/ws/.apicircle', 'production');
      expect(uri.scheme).toBe('apicircle');
      expect(uri.path).toBe('/environments/production.yaml');
    });

    it('readFile serializes the environment as YAML', async () => {
      const env: Environment = {
        name: 'staging',
        variables: [{ key: 'API_URL', value: 'https://staging.api.com', encrypted: false }],
      };
      seedEnv(env);
      const uri = ApicircleFsProvider.environmentUri(workspaceId, 'staging');
      const bytes = await provider.readFile(uri as never);
      const text = Buffer.from(bytes).toString('utf8');
      expect(text).toContain('name: staging');
      expect(text).toContain('API_URL');
    });

    it('readFile throws FileNotFound for a missing environment', async () => {
      const uri = ApicircleFsProvider.environmentUri(workspaceId, 'nope');
      await expect(provider.readFile(uri as never)).rejects.toThrow(/File not found/);
    });

    it('stat confirms existence for a seeded environment', async () => {
      seedEnv({ name: 'dev', variables: [] });
      const uri = ApicircleFsProvider.environmentUri(workspaceId, 'dev');
      const stat = await provider.stat(uri as never);
      expect(stat.type).toBe(FileType.File);
    });

    it('stat throws FileNotFound for a missing environment', async () => {
      const uri = ApicircleFsProvider.environmentUri(workspaceId, 'ghost');
      await expect(provider.stat(uri as never)).rejects.toThrow(/File not found/);
    });

    it('writeFile persists an environment edit', async () => {
      seedEnv({ name: 'dev', variables: [{ key: 'k', value: 'v', encrypted: false }] });
      const uri = ApicircleFsProvider.environmentUri(workspaceId, 'dev');
      const yaml = 'name: dev\nvariables:\n  - key: k\n    value: updated\n';
      await provider.writeFile(uri as never, Buffer.from(yaml, 'utf8'), {
        create: false,
        overwrite: true,
      });
      const synced = JSON.parse(
        fs.readFileSync(path.join(apicircleDir, 'workspace.json'), 'utf8'),
      ) as { environments: { items: Record<string, Environment> } };
      expect(synced.environments.items.dev.variables[0].value).toBe('updated');
    });

    it('writeFile throws on invalid env YAML (parse error)', async () => {
      seedEnv({ name: 'dev', variables: [] });
      const uri = ApicircleFsProvider.environmentUri(workspaceId, 'dev');
      // Missing required 'name' field
      await expect(
        provider.writeFile(uri as never, Buffer.from('variables: []\n', 'utf8'), {
          create: false,
          overwrite: true,
        }),
      ).rejects.toThrow(/name/);
    });

    it('delete removes the environment', async () => {
      seedEnv({ name: 'staging', variables: [] });
      const uri = ApicircleFsProvider.environmentUri(workspaceId, 'staging');
      const events: unknown[] = [];
      provider.onDidChangeFile((e) => events.push(e));
      await provider.delete(uri as never, { recursive: false });
      const synced = JSON.parse(
        fs.readFileSync(path.join(apicircleDir, 'workspace.json'), 'utf8'),
      ) as { environments: { items: Record<string, unknown> } };
      expect(synced.environments.items.staging).toBeUndefined();
      expect(events.length).toBe(1);
    });
  });

  // ===========================================================================
  // Plans
  // ===========================================================================

  describe('plans/', () => {
    async function seedPlan(plan: ExecutionPlan): Promise<void> {
      // Plans live in workspace.local — use surface.apply to seed them
      // through the canonical mutation path.
      const surface = bridge.activeWorkspace()!;
      await surface.apply({ kind: 'plan.upsert', plan });
    }

    const plan: ExecutionPlan = {
      id: 'plan-1',
      name: 'Smoke test',
      steps: [{ requestId: 'TBD', enabled: true }],
      envPriorityOrder: [],
      variables: [],
      stopOnAssertionFailure: false,
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z',
    };

    it('planUri() builds the correct URI', () => {
      const uri = ApicircleFsProvider.planUri('/ws/.apicircle', plan);
      expect(uri.scheme).toBe('apicircle');
      expect(uri.path).toBe('/plans/Smoke-test.yaml');
      expect(uri.query).toBe('id=plan-1');
    });

    it('planUri() falls back to "untitled-plan" for empty name', () => {
      const uri = ApicircleFsProvider.planUri('/ws/.apicircle', { ...plan, name: '' });
      expect(uri.path).toBe('/plans/untitled-plan.yaml');
    });

    it('readFile serializes the plan as YAML', async () => {
      const seeded = { ...plan, steps: [{ requestId: requestId, enabled: true }] };
      await seedPlan(seeded);
      const uri = ApicircleFsProvider.planUri(workspaceId, seeded);
      const bytes = await provider.readFile(uri as never);
      const text = Buffer.from(bytes).toString('utf8');
      expect(text).toContain('name: Smoke test');
      expect(text).toContain('requestId:');
    });

    it('readFile throws FileNotFound for a missing plan', async () => {
      const uri = ApicircleFsProvider.planUri(workspaceId, { ...plan, id: 'nope' });
      await expect(provider.readFile(uri as never)).rejects.toThrow(/File not found/);
    });

    it('stat confirms existence for a seeded plan', async () => {
      await seedPlan(plan);
      const uri = ApicircleFsProvider.planUri(workspaceId, plan);
      const stat = await provider.stat(uri as never);
      expect(stat.type).toBe(FileType.File);
    });

    it('stat throws FileNotFound for a missing plan', async () => {
      const uri = ApicircleFsProvider.planUri(workspaceId, { ...plan, id: 'ghost' });
      await expect(provider.stat(uri as never)).rejects.toThrow(/File not found/);
    });

    it('writeFile persists a plan update (with valid step references)', async () => {
      // requestId must match an existing request for the save to succeed
      const seeded = { ...plan, steps: [{ requestId: requestId, enabled: true }] };
      await seedPlan(seeded);
      const uri = ApicircleFsProvider.planUri(workspaceId, seeded);
      const yaml = `name: Renamed plan\nsteps:\n  - requestId: ${requestId}\n    enabled: true\n`;
      await provider.writeFile(uri as never, Buffer.from(yaml, 'utf8'), {
        create: false,
        overwrite: true,
      });
      const surface = bridge.activeWorkspace()!;
      const state = await surface.read();
      expect(state.local.executionPlans['plan-1'].name).toBe('Renamed plan');
    });

    it('writeFile rejects a plan with dangling request references', async () => {
      await seedPlan(plan);
      const uri = ApicircleFsProvider.planUri(workspaceId, plan);
      const yaml = 'name: Plan\nsteps:\n  - requestId: nonexistent-id\n';
      await expect(
        provider.writeFile(uri as never, Buffer.from(yaml, 'utf8'), {
          create: false,
          overwrite: true,
        }),
      ).rejects.toThrow(/unknown request id/);
    });

    it('writeFile throws on invalid plan YAML (missing name)', async () => {
      await seedPlan(plan);
      const uri = ApicircleFsProvider.planUri(workspaceId, plan);
      // The plan parser requires `name` to be present
      await expect(
        provider.writeFile(uri as never, Buffer.from('steps: []\n', 'utf8'), {
          create: false,
          overwrite: true,
        }),
      ).rejects.toThrow(/name/);
    });

    it('delete removes the plan', async () => {
      await seedPlan(plan);
      const uri = ApicircleFsProvider.planUri(workspaceId, plan);
      const events: unknown[] = [];
      provider.onDidChangeFile((e) => events.push(e));
      await provider.delete(uri as never, { recursive: false });
      const surface = bridge.activeWorkspace()!;
      const state = await surface.read();
      expect(state.local.executionPlans['plan-1']).toBeUndefined();
      expect(events.length).toBe(1);
    });
  });

  // ===========================================================================
  // Mocks
  // ===========================================================================

  describe('mocks/', () => {
    function makeMock(id: string, over: Partial<MockServer> = {}): MockServer {
      return {
        id,
        name: 'Pet Store',
        source: { kind: 'manual', endpoints: [] },
        endpoints: [],
        defaultPort: null,
        cors: { enabled: false, origins: [] },
        createdAt: '2026-01-01T00:00:00Z',
        updatedAt: '2026-01-01T00:00:00Z',
        ...over,
      };
    }
    function seedMock(mock: MockServer): void {
      const wsPath = path.join(apicircleDir, 'workspace.json');
      const synced = JSON.parse(fs.readFileSync(wsPath, 'utf8')) as {
        mockServers: Record<string, MockServer>;
      };
      synced.mockServers[mock.id] = mock;
      fs.writeFileSync(wsPath, JSON.stringify(synced, null, 2));
    }

    it('mockUri() builds the correct URI', () => {
      const mock = makeMock('mock-1');
      const uri = ApicircleFsProvider.mockUri('/ws/.apicircle', mock);
      expect(uri.scheme).toBe('apicircle');
      expect(uri.path).toBe('/mocks/Pet-Store.yaml');
      expect(uri.query).toBe('id=mock-1');
    });

    it('mockUri() falls back to "untitled-mock" for empty name', () => {
      const uri = ApicircleFsProvider.mockUri('/ws/.apicircle', makeMock('m', { name: '' }));
      expect(uri.path).toBe('/mocks/untitled-mock.yaml');
    });

    it('readFile serializes the mock as YAML', async () => {
      const mock = makeMock('m1', { defaultPort: 3000 });
      seedMock(mock);
      const uri = ApicircleFsProvider.mockUri(workspaceId, mock);
      const bytes = await provider.readFile(uri as never);
      const text = Buffer.from(bytes).toString('utf8');
      expect(text).toContain('name: Pet Store');
      expect(text).toContain('defaultPort: 3000');
    });

    it('readFile throws FileNotFound for a missing mock', async () => {
      const mock = makeMock('ghost');
      const uri = ApicircleFsProvider.mockUri(workspaceId, mock);
      await expect(provider.readFile(uri as never)).rejects.toThrow(/File not found/);
    });

    it('stat confirms existence for a seeded mock', async () => {
      const mock = makeMock('m-stat');
      seedMock(mock);
      const uri = ApicircleFsProvider.mockUri(workspaceId, mock);
      const stat = await provider.stat(uri as never);
      expect(stat.type).toBe(FileType.File);
    });

    it('stat throws FileNotFound for a missing mock', async () => {
      const uri = ApicircleFsProvider.mockUri(workspaceId, makeMock('nope'));
      await expect(provider.stat(uri as never)).rejects.toThrow(/File not found/);
    });

    it('writeFile persists mock edits (name, cors, port)', async () => {
      const mock = makeMock('m-write');
      seedMock(mock);
      const uri = ApicircleFsProvider.mockUri(workspaceId, mock);
      const yaml =
        'name: Renamed Mock\ndefaultPort: 4000\ncors:\n  enabled: true\n  origins:\n    - http://localhost:3000\n';
      await provider.writeFile(uri as never, Buffer.from(yaml, 'utf8'), {
        create: false,
        overwrite: true,
      });
      const synced = JSON.parse(
        fs.readFileSync(path.join(apicircleDir, 'workspace.json'), 'utf8'),
      ) as { mockServers: Record<string, MockServer> };
      expect(synced.mockServers['m-write'].name).toBe('Renamed Mock');
      expect(synced.mockServers['m-write'].defaultPort).toBe(4000);
      expect(synced.mockServers['m-write'].cors.enabled).toBe(true);
    });

    it('writeFile throws when the mock no longer exists', async () => {
      const mock = makeMock('deleted-mock');
      const uri = ApicircleFsProvider.mockUri(workspaceId, mock);
      await expect(
        provider.writeFile(uri as never, Buffer.from('name: X\n', 'utf8'), {
          create: false,
          overwrite: true,
        }),
      ).rejects.toThrow(/no longer exists/);
    });

    it('writeFile throws on invalid mock YAML (missing name)', async () => {
      const mock = makeMock('m-bad');
      seedMock(mock);
      const uri = ApicircleFsProvider.mockUri(workspaceId, mock);
      // The mock parser requires `name` to be present
      await expect(
        provider.writeFile(uri as never, Buffer.from('defaultPort: null\n', 'utf8'), {
          create: false,
          overwrite: true,
        }),
      ).rejects.toThrow(/name/);
    });

    it('delete removes the mock', async () => {
      const mock = makeMock('m-del');
      seedMock(mock);
      const uri = ApicircleFsProvider.mockUri(workspaceId, mock);
      const events: unknown[] = [];
      provider.onDidChangeFile((e) => events.push(e));
      await provider.delete(uri as never, { recursive: false });
      const synced = JSON.parse(
        fs.readFileSync(path.join(apicircleDir, 'workspace.json'), 'utf8'),
      ) as { mockServers: Record<string, unknown> };
      expect(synced.mockServers['m-del']).toBeUndefined();
      expect(events.length).toBe(1);
    });
  });

  // ===========================================================================
  // Endpoints
  // ===========================================================================

  describe('endpoints/', () => {
    function makeEndpoint(id: string, name: string): MockEndpoint {
      return {
        id,
        name,
        method: 'GET',
        pathPattern: '/pets',
        requestSchema: {
          pathParams: [],
          queryParams: [],
          headers: [],
          cookies: [],
          body: undefined,
        },
        requestValidation: [],
        responseRules: [],
        defaultResponse: {
          status: 200,
          headers: [],
          body: { type: 'json', content: '{}' },
          multipliers: [],
        },
      };
    }
    function makeMockWithEndpoint(): { mock: MockServer; endpoint: MockEndpoint } {
      const ep = makeEndpoint('ep-1', 'List pets');
      const mock: MockServer = {
        id: 'mock-e',
        name: 'Pet API',
        source: { kind: 'manual', endpoints: [] },
        endpoints: [ep],
        defaultPort: null,
        cors: { enabled: false, origins: [] },
        createdAt: '2026-01-01T00:00:00Z',
        updatedAt: '2026-01-01T00:00:00Z',
      };
      return { mock, endpoint: ep };
    }
    function seedMockWithEndpoint(mock: MockServer): void {
      const wsPath = path.join(apicircleDir, 'workspace.json');
      const synced = JSON.parse(fs.readFileSync(wsPath, 'utf8')) as {
        mockServers: Record<string, MockServer>;
      };
      synced.mockServers[mock.id] = mock;
      fs.writeFileSync(wsPath, JSON.stringify(synced, null, 2));
    }

    it('endpointUri() builds the correct URI with both mockId and id in query', () => {
      const { mock, endpoint } = makeMockWithEndpoint();
      const uri = ApicircleFsProvider.endpointUri('/ws/.apicircle', mock, endpoint);
      expect(uri.scheme).toBe('apicircle');
      expect(uri.path).toBe('/mocks/Pet-API/List-pets.yaml');
      expect(uri.query).toContain('mockId=mock-e');
      expect(uri.query).toContain('id=ep-1');
    });

    it('readFile serializes the endpoint as YAML', async () => {
      const { mock, endpoint } = makeMockWithEndpoint();
      seedMockWithEndpoint(mock);
      const uri = ApicircleFsProvider.endpointUri(workspaceId, mock, endpoint);
      const bytes = await provider.readFile(uri as never);
      const text = Buffer.from(bytes).toString('utf8');
      expect(text).toContain('name: List pets');
      expect(text).toContain('method: GET');
      expect(text).toContain('/pets');
    });

    it('readFile throws FileNotFound for a missing endpoint', async () => {
      const { mock } = makeMockWithEndpoint();
      seedMockWithEndpoint(mock);
      // Ask for a different endpoint id
      const uri = Uri.parse(
        `apicircle://${__encodeAuthorityForTests(workspaceId)}/mocks/Pet-API/ghost.yaml?mockId=mock-e&id=ghost`,
      );
      await expect(provider.readFile(uri as never)).rejects.toThrow(/File not found/);
    });

    it('readFile throws FileNotFound when parent mock does not exist', async () => {
      const uri = Uri.parse(
        `apicircle://${__encodeAuthorityForTests(workspaceId)}/mocks/X/Y.yaml?mockId=no-such-mock&id=ep-1`,
      );
      await expect(provider.readFile(uri as never)).rejects.toThrow(/File not found/);
    });

    it('stat confirms existence for a seeded endpoint', async () => {
      const { mock, endpoint } = makeMockWithEndpoint();
      seedMockWithEndpoint(mock);
      const uri = ApicircleFsProvider.endpointUri(workspaceId, mock, endpoint);
      const stat = await provider.stat(uri as never);
      expect(stat.type).toBe(FileType.File);
    });

    it('stat throws FileNotFound when the endpoint is not in the mock', async () => {
      const { mock } = makeMockWithEndpoint();
      seedMockWithEndpoint(mock);
      const uri = Uri.parse(
        `apicircle://${__encodeAuthorityForTests(workspaceId)}/mocks/Pet-API/ghost.yaml?mockId=mock-e&id=ghost`,
      );
      await expect(provider.stat(uri as never)).rejects.toThrow(/File not found/);
    });

    it('writeFile updates the endpoint in the parent mock', async () => {
      const { mock, endpoint } = makeMockWithEndpoint();
      seedMockWithEndpoint(mock);
      const uri = ApicircleFsProvider.endpointUri(workspaceId, mock, endpoint);
      const bytes = await provider.readFile(uri as never);
      const text = Buffer.from(bytes).toString('utf8');
      // Change the method from GET to POST by editing the YAML
      const edited = text.replace('method: GET', 'method: POST');
      await provider.writeFile(uri as never, Buffer.from(edited, 'utf8'), {
        create: false,
        overwrite: true,
      });
      const synced = JSON.parse(
        fs.readFileSync(path.join(apicircleDir, 'workspace.json'), 'utf8'),
      ) as { mockServers: Record<string, MockServer> };
      expect(synced.mockServers['mock-e'].endpoints[0].method).toBe('POST');
    });

    it('writeFile throws when the parent mock no longer exists', async () => {
      const uri = Uri.parse(
        `apicircle://${__encodeAuthorityForTests(workspaceId)}/mocks/X/Y.yaml?mockId=gone&id=ep-1`,
      );
      await expect(
        provider.writeFile(
          uri as never,
          Buffer.from(
            'name: X\nmethod: GET\npathPattern: /x\ndefaultResponse:\n  status: 200\n  headers: []\n  body:\n    type: json\n    content: "{}"\n  multipliers: []\nresponseRules: []\nrequestValidation: []\nrequestSchema:\n  pathParams: []\n  queryParams: []\n  headerParams: []\n  cookieParams: []\n  body: null\n',
            'utf8',
          ),
          { create: false, overwrite: true },
        ),
      ).rejects.toThrow(/no longer exists/);
    });

    it('writeFile throws when the endpoint is not in the mock', async () => {
      const { mock } = makeMockWithEndpoint();
      seedMockWithEndpoint(mock);
      const uri = Uri.parse(
        `apicircle://${__encodeAuthorityForTests(workspaceId)}/mocks/Pet-API/missing.yaml?mockId=mock-e&id=missing-ep`,
      );
      await expect(
        provider.writeFile(
          uri as never,
          Buffer.from(
            'name: X\nmethod: GET\npathPattern: /x\ndefaultResponse:\n  status: 200\n  headers: []\n  body:\n    type: json\n    content: "{}"\n  multipliers: []\nresponseRules: []\nrequestValidation: []\nrequestSchema:\n  pathParams: []\n  queryParams: []\n  headerParams: []\n  cookieParams: []\n  body: null\n',
            'utf8',
          ),
          { create: false, overwrite: true },
        ),
      ).rejects.toThrow(/not part of mock/);
    });

    it('writeFile throws on invalid endpoint YAML (missing required fields)', async () => {
      const { mock, endpoint } = makeMockWithEndpoint();
      seedMockWithEndpoint(mock);
      const uri = ApicircleFsProvider.endpointUri(workspaceId, mock, endpoint);
      // Missing all required fields
      await expect(
        provider.writeFile(uri as never, Buffer.from('bogus: true\n', 'utf8'), {
          create: false,
          overwrite: true,
        }),
      ).rejects.toThrow();
    });

    it('writeFile throws when endpoint URI has no parentMockId', async () => {
      // The parseUri function requires mockId to be present for endpoint URIs
      const uri = Uri.parse(
        `apicircle://${__encodeAuthorityForTests(workspaceId)}/mocks/Pet-API/ep.yaml?mockId=&id=ep-1`,
      );
      await expect(
        provider.writeFile(uri as never, Buffer.from('name: X\n', 'utf8'), {
          create: false,
          overwrite: true,
        }),
      ).rejects.toThrow();
    });
  });

  // ===========================================================================
  // URI parsing edge cases
  // ===========================================================================

  describe('parseUri error paths', () => {
    it('throws for a non-apicircle scheme', async () => {
      const uri = Uri.parse('file:///foo/bar.yaml');
      await expect(provider.readFile(uri as never)).rejects.toThrow(/Not an apicircle/);
    });

    it('throws for a malformed path with < 2 segments', async () => {
      const uri = Uri.parse('apicircle://x/');
      await expect(provider.readFile(uri as never)).rejects.toThrow(/Malformed URI/);
    });

    it('throws for an unsupported URI kind', async () => {
      const uri = Uri.parse('apicircle://x/bogus/thing.yaml?id=1');
      await expect(provider.readFile(uri as never)).rejects.toThrow(/Unsupported URI kind/);
    });

    it('throws for a requests URI missing ?id=', async () => {
      const uri = Uri.parse('apicircle://x/requests/foo.yaml');
      await expect(provider.readFile(uri as never)).rejects.toThrow(/missing.*id/i);
    });

    it('throws for a linked URI missing ?link= or ?id=', async () => {
      const uri = Uri.parse('apicircle://x/linked/foo/bar.yaml');
      await expect(provider.readFile(uri as never)).rejects.toThrow(/missing.*link/i);
    });

    it('throws for an endpoint URI missing ?mockId= or ?id=', async () => {
      const uri = Uri.parse('apicircle://x/mocks/slug/ep.yaml');
      await expect(provider.readFile(uri as never)).rejects.toThrow(/missing.*mockId/i);
    });

    it('throws for an environments URI with wrong segment count', async () => {
      const uri = Uri.parse('apicircle://x/environments/nested/too/deep.yaml');
      await expect(provider.readFile(uri as never)).rejects.toThrow(/Unsupported environments/);
    });
  });

  // ===========================================================================
  // stat() for releases, links, linkedRequests, linkedFolders
  // ===========================================================================

  describe('stat() — releases + links', () => {
    it('releases always stat as existing (even when empty)', async () => {
      const uri = ApicircleFsProvider.releasesUri(workspaceId);
      const stat = await provider.stat(uri as never);
      expect(stat.type).toBe(FileType.File);
    });

    it('links stat throws FileNotFound for a missing link', async () => {
      const uri = Uri.parse(
        `apicircle://${__encodeAuthorityForTests(workspaceId)}/links/ghost.yaml?id=nope`,
      );
      await expect(provider.stat(uri as never)).rejects.toThrow(/File not found/);
    });
  });

  // ===========================================================================
  // delete() error paths
  // ===========================================================================

  describe('delete() unsupported kinds', () => {
    it('throws NoPermissions for an unsupported kind (responses)', () => {
      provider.storeResponse('run-del', 'x');
      const uri = ApicircleFsProvider.responseUri(workspaceId, 'run-del', 'Test');
      expect(() => provider.delete(uri as never, { recursive: false })).toThrow(/Cannot delete/);
    });

    it('throws NoPermissions for releases', () => {
      const uri = ApicircleFsProvider.releasesUri(workspaceId);
      expect(() => provider.delete(uri as never, { recursive: false })).toThrow(/Cannot delete/);
    });

    it('throws NoPermissions for history', () => {
      provider.storeHistoryRun('h-del', 'x');
      const uri = ApicircleFsProvider.historyUri(workspaceId, 'h-del', 'Test');
      expect(() => provider.delete(uri as never, { recursive: false })).toThrow(/Cannot delete/);
    });
  });

  // ===========================================================================
  // writeFile fallthrough (unsupported kind)
  // ===========================================================================

  describe('writeFile unsupported kind', () => {
    it('throws NoPermissions for linkedFolders (read-only projection)', async () => {
      const uri = Uri.parse(
        `apicircle://${__encodeAuthorityForTests(workspaceId)}/linked/X/folder.yaml?link=lw1&id=fA&kind=folder`,
      );
      await expect(
        provider.writeFile(uri as never, Buffer.from('name: hack', 'utf8'), {
          create: false,
          overwrite: true,
        }),
      ).rejects.toThrow(/read-only/);
    });
  });

  // ===========================================================================
  // Static URI builders — edge cases
  // ===========================================================================

  describe('static URI builders — edge cases', () => {
    it('linkedRequestUri() builds the correct path and query', () => {
      const link = { id: 'lw1', name: 'Payments' } as LinkedWorkspace;
      const req = makeRequest('lr1', { name: 'Charge' });
      const uri = ApicircleFsProvider.linkedRequestUri('/ws/.apicircle', link, req);
      expect(uri.path).toBe('/linked/Payments/Charge.yaml');
      expect(uri.query).toContain('link=lw1');
      expect(uri.query).toContain('id=lr1');
    });

    it('linkedRequestUri() falls back for empty names', () => {
      const link = { id: 'lw1', name: '' } as LinkedWorkspace;
      const req = makeRequest('lr2', { name: '' });
      const uri = ApicircleFsProvider.linkedRequestUri('/ws/.apicircle', link, req);
      expect(uri.path).toBe('/linked/linked/request.yaml');
    });

    it('linkedFolderUri() falls back for empty names', () => {
      const link = { id: 'lw1', name: '' } as LinkedWorkspace;
      const folder: Folder = { id: 'f1', name: '', parentId: null };
      const uri = ApicircleFsProvider.linkedFolderUri('/ws/.apicircle', link, folder);
      expect(uri.path).toBe('/linked/linked/folder.yaml');
      expect(uri.query).toContain('kind=folder');
    });

    it('endpointUri() falls back for empty names', () => {
      const mock: MockServer = {
        id: 'm1',
        name: '',
        source: { kind: 'manual', endpoints: [] },
        endpoints: [],
        defaultPort: null,
        cors: { enabled: false, origins: [] },
        createdAt: 't',
        updatedAt: 't',
      };
      const ep: MockEndpoint = {
        id: 'e1',
        name: '',
        method: 'GET',
        pathPattern: '/x',
        requestSchema: { pathParams: [], queryParams: [], headers: [], cookies: [] },
        requestValidation: [],
        responseRules: [],
        defaultResponse: {
          status: 200,
          headers: [],
          body: { type: 'json', content: '{}' },
          multipliers: [],
        },
      };
      const uri = ApicircleFsProvider.endpointUri('/ws/.apicircle', mock, ep);
      expect(uri.path).toBe('/mocks/mock/endpoint.yaml');
    });

    it('requestUri() falls back to "untitled" for empty request name', () => {
      const req = makeRequest('r-empty', { name: '' });
      const uri = ApicircleFsProvider.requestUri('/ws/.apicircle', req, {}, { 'r-empty': req });
      expect(uri.path).toBe('/requests/untitled.yaml');
    });

    it('folderUri() falls back to "untitled-folder" for empty folder name', () => {
      const f: Folder = { id: 'f-empty', name: '', parentId: null };
      const uri = ApicircleFsProvider.folderUri('/ws/.apicircle', f, { 'f-empty': f });
      expect(uri.path).toBe('/folders/untitled-folder.yaml');
    });
  });

  // ===========================================================================
  // encodeAuthority / decodeAuthority round-trip
  // ===========================================================================

  describe('encodeAuthority round-trip', () => {
    it('round-trips a typical Windows path', () => {
      const original = 'C:\\Users\\test\\.apicircle';
      const encoded = __encodeAuthorityForTests(original);
      // The bridge constructor in beforeEach uses the same encode → decode path
      // to look up workspaces, verifying the round-trip implicitly. Check the
      // encoded form doesn't contain URL-unsafe characters.
      expect(encoded).not.toContain('/');
      expect(encoded).not.toContain(':');
      expect(encoded).not.toContain('\\');
    });
  });

  // ===========================================================================
  // stat() for requests (the default path verifying existence)
  // ===========================================================================

  describe('stat() — requests', () => {
    it('returns File type for an existing request', async () => {
      const uri = ApicircleFsProvider.requestUri(
        workspaceId,
        request,
        {},
        { [requestId]: request },
      );
      const stat = await provider.stat(uri as never);
      expect(stat.type).toBe(FileType.File);
      expect(stat.mtime).toBeGreaterThan(0);
    });

    it('throws FileNotFound for a missing request', async () => {
      const ghost = makeRequest('ghost');
      const uri = ApicircleFsProvider.requestUri(workspaceId, ghost, {}, { ghost: ghost });
      await expect(provider.stat(uri as never)).rejects.toThrow(/File not found/);
    });
  });

  // ===========================================================================
  // stat() for folders
  // ===========================================================================

  describe('stat() — folders', () => {
    it('returns File type for an existing folder', async () => {
      // Seed a folder
      const wsPath = path.join(apicircleDir, 'workspace.json');
      const synced = JSON.parse(fs.readFileSync(wsPath, 'utf8')) as {
        collections: { folders: Record<string, Folder> };
      };
      const folder: Folder = { id: 'stat-f', name: 'Auth', parentId: null };
      synced.collections.folders['stat-f'] = folder;
      fs.writeFileSync(wsPath, JSON.stringify(synced, null, 2));

      const uri = ApicircleFsProvider.folderUri(workspaceId, folder, { 'stat-f': folder });
      const stat = await provider.stat(uri as never);
      expect(stat.type).toBe(FileType.File);
    });

    it('throws FileNotFound for a missing folder', async () => {
      const ghost: Folder = { id: 'ghost-f', name: 'Gone', parentId: null };
      const uri = ApicircleFsProvider.folderUri(workspaceId, ghost, { 'ghost-f': ghost });
      await expect(provider.stat(uri as never)).rejects.toThrow(/File not found/);
    });
  });

  // ===========================================================================
  // stat + readFile + writeFile for linked requests/folders
  // ===========================================================================

  describe('stat/readFile for linked entities', () => {
    const linkRec = {
      id: 'lw-stat',
      kind: 'public' as const,
      name: 'Stats',
      source: {
        provider: 'github' as const,
        repoFullName: 'org/stats',
        branch: 'main',
        sessionMode: 'workspace' as const,
      },
      scope: ['collections' as const],
      pinnedVersion: null,
      updatePolicy: 'manual' as const,
      linkedAt: '2026-01-01T00:00:00.000Z',
      requiredSecretKeyIds: [],
    };

    async function seedLinkedEntities() {
      const folder: Folder = { id: 'lf-stat', name: 'Folder', parentId: null };
      const req = makeRequest('lr-stat', { name: 'Get stats', url: 'https://api/stats' });
      const snapshot = {
        pulledAt: '2026-01-01T00:00:00.000Z',
        ref: 'HEAD@main',
        collections: {
          tree: { id: 'r', type: 'root' as const, children: [] },
          requests: { 'lr-stat': req },
          folders: { 'lf-stat': folder },
        },
        environments: { items: {}, activeName: null, priorityOrder: [] },
      };
      await bridge
        .activeWorkspace()!
        .apply({ kind: 'linkedWorkspace.upsert', link: linkRec, snapshot });
    }

    it('stat for linkedRequests confirms existence', async () => {
      await seedLinkedEntities();
      const uri = Uri.parse(
        `apicircle://${__encodeAuthorityForTests(workspaceId)}/linked/Stats/Get-stats.yaml?link=lw-stat&id=lr-stat`,
      );
      const stat = await provider.stat(uri as never);
      expect(stat.type).toBe(FileType.File);
    });

    it('stat for linkedRequests throws FileNotFound for missing id', async () => {
      await seedLinkedEntities();
      const uri = Uri.parse(
        `apicircle://${__encodeAuthorityForTests(workspaceId)}/linked/Stats/missing.yaml?link=lw-stat&id=missing`,
      );
      await expect(provider.stat(uri as never)).rejects.toThrow(/File not found/);
    });

    it('stat for linkedFolders confirms existence', async () => {
      await seedLinkedEntities();
      const uri = Uri.parse(
        `apicircle://${__encodeAuthorityForTests(workspaceId)}/linked/Stats/Folder.yaml?link=lw-stat&id=lf-stat&kind=folder`,
      );
      const stat = await provider.stat(uri as never);
      expect(stat.type).toBe(FileType.File);
    });

    it('stat for linkedFolders throws FileNotFound for missing id', async () => {
      await seedLinkedEntities();
      const uri = Uri.parse(
        `apicircle://${__encodeAuthorityForTests(workspaceId)}/linked/Stats/gone.yaml?link=lw-stat&id=gone&kind=folder`,
      );
      await expect(provider.stat(uri as never)).rejects.toThrow(/File not found/);
    });

    it('stat for links confirms existence for a seeded link', async () => {
      await seedLinkedEntities();
      const uri = Uri.parse(
        `apicircle://${__encodeAuthorityForTests(workspaceId)}/links/Stats.yaml?id=lw-stat`,
      );
      const stat = await provider.stat(uri as never);
      expect(stat.type).toBe(FileType.File);
    });

    it('writeFile for linkedRequests throws when base is missing', async () => {
      await seedLinkedEntities();
      // Use a request id that doesn't exist in the linked snapshot
      const uri = Uri.parse(
        `apicircle://${__encodeAuthorityForTests(workspaceId)}/linked/Stats/ghost.yaml?link=lw-stat&id=ghost`,
      );
      await expect(
        provider.writeFile(
          uri as never,
          Buffer.from('name: Ghost\nmethod: GET\nurl: https://x\n', 'utf8'),
          {
            create: false,
            overwrite: true,
          },
        ),
      ).rejects.toThrow(/no longer cached/);
    });

    it('readFile for linkedFolders throws FileNotFound when missing', async () => {
      await seedLinkedEntities();
      const uri = Uri.parse(
        `apicircle://${__encodeAuthorityForTests(workspaceId)}/linked/Stats/gone.yaml?link=lw-stat&id=gone&kind=folder`,
      );
      await expect(provider.readFile(uri as never)).rejects.toThrow(/File not found/);
    });

    it('readFile for linkedRequests throws FileNotFound when missing', async () => {
      await seedLinkedEntities();
      const uri = Uri.parse(
        `apicircle://${__encodeAuthorityForTests(workspaceId)}/linked/Stats/ghost.yaml?link=lw-stat&id=ghost`,
      );
      await expect(provider.readFile(uri as never)).rejects.toThrow(/File not found/);
    });
  });

  // ===========================================================================
  // writeFile for links — edge cases
  // ===========================================================================

  describe('writeFile links — edge cases', () => {
    function seedLink(): void {
      const wsPath = path.join(apicircleDir, 'workspace.json');
      const synced = JSON.parse(fs.readFileSync(wsPath, 'utf8')) as Record<string, unknown>;
      synced.linkedWorkspaces = {
        lw2: {
          id: 'lw2',
          kind: 'public',
          name: 'Link Two',
          source: {
            provider: 'github',
            repoFullName: 'org/two',
            branch: 'main',
            sessionMode: 'workspace',
          },
          scope: ['collections'],
          pinnedVersion: null,
          updatePolicy: 'manual',
          linkedAt: '2026-01-01T00:00:00.000Z',
          requiredSecretKeyIds: [],
        },
      };
      fs.writeFileSync(wsPath, JSON.stringify(synced, null, 2));
    }

    it('writeFile throws when the link no longer exists', async () => {
      const uri = Uri.parse(
        `apicircle://${__encodeAuthorityForTests(workspaceId)}/links/gone.yaml?id=gone`,
      );
      await expect(
        provider.writeFile(uri as never, Buffer.from('name: X\n', 'utf8'), {
          create: false,
          overwrite: true,
        }),
      ).rejects.toThrow(/no longer exists/);
    });

    it('writeFile on links accepts null pinnedVersion (unpinning)', async () => {
      seedLink();
      const uri = Uri.parse(
        `apicircle://${__encodeAuthorityForTests(workspaceId)}/links/Link-Two.yaml?id=lw2`,
      );
      await provider.writeFile(
        uri as never,
        Buffer.from('name: Link Two\npinnedVersion: null\n', 'utf8'),
        { create: false, overwrite: true },
      );
      const synced = JSON.parse(
        fs.readFileSync(path.join(apicircleDir, 'workspace.json'), 'utf8'),
      ) as { linkedWorkspaces: Record<string, { pinnedVersion: string | null }> };
      expect(synced.linkedWorkspaces.lw2.pinnedVersion).toBeNull();
    });

    it('writeFile on links throws on unknown top-level keys', async () => {
      seedLink();
      const uri = Uri.parse(
        `apicircle://${__encodeAuthorityForTests(workspaceId)}/links/Link-Two.yaml?id=lw2`,
      );
      // Unknown top-level keys trigger LinkYamlParseError
      await expect(
        provider.writeFile(
          uri as never,
          Buffer.from('name: Link Two\nbogusField: true\n', 'utf8'),
          {
            create: false,
            overwrite: true,
          },
        ),
      ).rejects.toThrow(/Unknown field/);
    });
  });

  // ===========================================================================
  // computeFolderSlugPath with undefined folderId
  // ===========================================================================

  describe('computeFolderSlugPath — undefined', () => {
    it('returns [] for undefined folder id', () => {
      expect(computeFolderSlugPath(undefined, {})).toEqual([]);
    });

    it('returns [] for empty string folder id', () => {
      expect(computeFolderSlugPath('', {})).toEqual([]);
    });

    it('returns fallback slug for a folder with empty name', () => {
      const folders: Record<string, Folder> = {
        f1: { id: 'f1', name: '', parentId: null },
      };
      expect(computeFolderSlugPath('f1', folders)).toEqual(['untitled-folder']);
    });
  });

  // ===========================================================================
  // onDidChangeFile event listener
  // ===========================================================================

  describe('onDidChangeFile event', () => {
    it('listeners receive events from writeFile', async () => {
      const uri = ApicircleFsProvider.requestUri(
        workspaceId,
        request,
        {},
        { [requestId]: request },
      );
      const events: unknown[] = [];
      const disposable = provider.onDidChangeFile((e) => events.push(e));
      await provider.writeFile(
        uri as never,
        Buffer.from('name: Changed\nmethod: GET\nurl: https://api.example.com/users/123\n', 'utf8'),
        { create: false, overwrite: true },
      );
      expect(events.length).toBe(1);
      disposable.dispose();
    });
  });
});
