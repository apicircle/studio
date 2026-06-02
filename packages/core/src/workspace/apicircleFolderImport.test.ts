import { describe, expect, it } from 'vitest';
import type {
  GlobalFileAsset,
  GlobalGraphQL,
  GlobalSchema,
  Request as ApiRequest,
  WorkspaceSynced,
} from '@apicircle/shared';
import type { ParsedApicircleFolderExport } from '../import/apicircleFolder';
import { importApicircleFolderInto } from './apicircleFolderImport';

const ISO = '2026-06-02T00:00:00.000Z';

function emptySynced(): WorkspaceSynced {
  return {
    schemaVersion: 1,
    workspaceId: 'ws-1',
    collections: {
      tree: { id: 'root', type: 'root', children: [] },
      requests: {},
      folders: {},
    },
    environments: { items: {}, activeName: null, priorityOrder: [] },
    linkedWorkspaces: {},
    linkedOverrides: { requests: {}, environmentVars: {} },
    releases: { self: null, perLink: {} },
    globalAssets: { schemas: {}, graphql: {}, files: {} },
    mockServers: {},
    meta: { createdAt: ISO, updatedAt: ISO, appVersion: '1.0.6' },
  };
}

function buildParsed(
  overrides: Partial<ParsedApicircleFolderExport> = {},
): ParsedApicircleFolderExport {
  return {
    rootFolder: { id: 'root-new', name: 'Imported', auth: undefined },
    subfolders: [],
    requests: [],
    dependencies: { schemas: [], graphql: [], files: [] },
    sourceFolderName: 'Imported',
    warnings: [],
    ...overrides,
  };
}

function makeRequest(
  overrides: Partial<ApiRequest> & { id: string; folderId: string | null },
): ApiRequest {
  return {
    id: overrides.id,
    name: overrides.name ?? 'r',
    folderId: overrides.folderId,
    method: overrides.method ?? 'GET',
    url: overrides.url ?? 'https://x',
    headers: overrides.headers ?? [],
    query: overrides.query ?? [],
    body: overrides.body ?? { type: 'none', content: '' },
    auth: overrides.auth ?? { type: 'none' },
    contextVars: overrides.contextVars ?? [],
    extractions: overrides.extractions ?? [],
    assertions: overrides.assertions ?? [],
    bodySchemaId: overrides.bodySchemaId,
    graphqlSchemaId: overrides.graphqlSchemaId,
    createdAt: overrides.createdAt ?? ISO,
    updatedAt: overrides.updatedAt ?? ISO,
  };
}

describe('importApicircleFolderInto', () => {
  it('inserts the root folder at top-level when parentFolderId is null', () => {
    const result = importApicircleFolderInto(emptySynced(), buildParsed(), null);
    expect(result.synced.collections.folders['root-new']).toMatchObject({
      id: 'root-new',
      name: 'Imported',
      parentId: null,
    });
    expect(result.synced.collections.tree.children).toEqual([{ kind: 'folder', id: 'root-new' }]);
    expect(result.rootFolderId).toBe('root-new');
    expect(result.rootFolderName).toBe('Imported');
    expect(result.counts.folders).toBe(1);
  });

  it('attaches the root folder under a parent folder (no tree entry)', () => {
    const synced = emptySynced();
    synced.collections.folders['parent'] = { id: 'parent', name: 'Parent', parentId: null };
    synced.collections.tree.children = [{ kind: 'folder', id: 'parent' }];
    const result = importApicircleFolderInto(synced, buildParsed(), 'parent');
    expect(result.synced.collections.folders['root-new'].parentId).toBe('parent');
    expect(result.synced.collections.tree.children).toEqual([{ kind: 'folder', id: 'parent' }]);
  });

  it('uniquifies the root folder name against the destination parent', () => {
    const synced = emptySynced();
    synced.collections.folders['existing'] = { id: 'existing', name: 'Imported', parentId: null };
    synced.collections.tree.children = [{ kind: 'folder', id: 'existing' }];
    const result = importApicircleFolderInto(synced, buildParsed(), null);
    expect(result.rootFolderName).toBe('Imported (2)');
    expect(result.synced.collections.folders['root-new'].name).toBe('Imported (2)');
  });

  it('inserts subfolders and requests into the workspace', () => {
    const parsed = buildParsed({
      subfolders: [
        { id: 'child', name: 'Child', parentId: 'root-new' },
        { id: 'grand', name: 'Grand', parentId: 'child' },
      ],
      requests: [
        makeRequest({ id: 'r-1', folderId: 'grand', name: 'GET /a' }),
        makeRequest({ id: 'r-2', folderId: 'child', name: 'GET /b' }),
      ],
    });
    const result = importApicircleFolderInto(emptySynced(), parsed, null);
    expect(Object.keys(result.synced.collections.folders).sort()).toEqual([
      'child',
      'grand',
      'root-new',
    ]);
    expect(Object.keys(result.synced.collections.requests).sort()).toEqual(['r-1', 'r-2']);
    expect(result.counts.folders).toBe(3);
    expect(result.counts.requests).toBe(2);
  });

  it('preserves folder-level auth from the export', () => {
    const parsed = buildParsed({
      rootFolder: { id: 'root-new', name: 'Imported', auth: { type: 'bearer', token: 'tk' } },
    });
    const result = importApicircleFolderInto(emptySynced(), parsed, null);
    expect(result.synced.collections.folders['root-new'].auth).toEqual({
      type: 'bearer',
      token: 'tk',
    });
  });

  it('adds embedded JSON schemas and counts them under schemasAdded', () => {
    const schema: GlobalSchema = {
      id: 's-1',
      name: 'User',
      schema: '{"type":"object"}',
      createdAt: ISO,
      updatedAt: ISO,
    };
    const parsed = buildParsed({ dependencies: { schemas: [schema], graphql: [], files: [] } });
    const result = importApicircleFolderInto(emptySynced(), parsed, null);
    expect(result.synced.globalAssets.schemas['s-1']).toMatchObject({ name: 'User' });
    expect(result.counts).toMatchObject({ schemasAdded: 1, schemasReused: 0 });
  });

  it('reuses an existing JSON schema with matching name + content', () => {
    const synced = emptySynced();
    synced.globalAssets.schemas['existing'] = {
      id: 'existing',
      name: 'User',
      schema: '{"type":"object"}',
      createdAt: ISO,
      updatedAt: ISO,
    };
    const parsed = buildParsed({
      requests: [makeRequest({ id: 'r-1', folderId: 'root-new', bodySchemaId: 's-incoming' })],
      dependencies: {
        schemas: [
          {
            id: 's-incoming',
            name: 'User',
            schema: '{"type":"object"}',
            createdAt: ISO,
            updatedAt: ISO,
          },
        ],
        graphql: [],
        files: [],
      },
    });
    const result = importApicircleFolderInto(synced, parsed, null);
    expect(Object.keys(result.synced.globalAssets.schemas)).toEqual(['existing']);
    expect(result.counts).toMatchObject({ schemasAdded: 0, schemasReused: 1 });
    // Request reference should now point at the reused id.
    expect(result.synced.collections.requests['r-1'].bodySchemaId).toBe('existing');
  });

  it('does NOT reuse a schema whose name matches but content differs', () => {
    const synced = emptySynced();
    synced.globalAssets.schemas['existing'] = {
      id: 'existing',
      name: 'User',
      schema: '{"type":"array"}',
      createdAt: ISO,
      updatedAt: ISO,
    };
    const parsed = buildParsed({
      dependencies: {
        schemas: [
          {
            id: 's-incoming',
            name: 'User',
            schema: '{"type":"object"}',
            createdAt: ISO,
            updatedAt: ISO,
          },
        ],
        graphql: [],
        files: [],
      },
    });
    const result = importApicircleFolderInto(synced, parsed, null);
    expect(Object.keys(result.synced.globalAssets.schemas).sort()).toEqual([
      'existing',
      's-incoming',
    ]);
    expect(result.counts.schemasAdded).toBe(1);
  });

  it('adds + reuses GraphQL definitions on a name+kind+source match', () => {
    const synced = emptySynced();
    synced.globalAssets.graphql['existing'] = {
      id: 'existing',
      name: 'Catalog',
      kind: 'sdl',
      source: 'type Query { hi: String }',
      createdAt: ISO,
      updatedAt: ISO,
    };
    const incomingReused: GlobalGraphQL = {
      id: 'g-reused',
      name: 'Catalog',
      kind: 'sdl',
      source: 'type Query { hi: String }',
      createdAt: ISO,
      updatedAt: ISO,
    };
    const incomingNew: GlobalGraphQL = {
      id: 'g-new',
      name: 'Catalog',
      kind: 'sdl',
      source: 'type Query { other: String }',
      createdAt: ISO,
      updatedAt: ISO,
    };
    const parsed = buildParsed({
      requests: [
        makeRequest({ id: 'r-1', folderId: 'root-new', graphqlSchemaId: 'g-reused' }),
        makeRequest({ id: 'r-2', folderId: 'root-new', graphqlSchemaId: 'g-new' }),
      ],
      dependencies: {
        schemas: [],
        graphql: [incomingReused, incomingNew],
        files: [],
      },
    });
    const result = importApicircleFolderInto(synced, parsed, null);
    expect(result.counts).toMatchObject({ graphqlAdded: 1, graphqlReused: 1 });
    expect(result.synced.collections.requests['r-1'].graphqlSchemaId).toBe('existing');
    expect(result.synced.collections.requests['r-2'].graphqlSchemaId).toBe('g-new');
  });

  it('adds + reuses file-asset metadata on a name+filename+size match', () => {
    const synced = emptySynced();
    synced.globalAssets.files = {
      existing: {
        id: 'existing',
        name: 'photo',
        slotId: 'src-slot',
        filename: 'photo.jpg',
        size: 1,
        mimeType: 'image/jpeg',
        createdAt: ISO,
        updatedAt: ISO,
      },
    };
    const reuseFile: GlobalFileAsset = {
      id: 'f-reused',
      name: 'photo',
      slotId: 'fresh',
      filename: 'photo.jpg',
      size: 1,
      mimeType: 'image/jpeg',
      createdAt: ISO,
      updatedAt: ISO,
    };
    const newFile: GlobalFileAsset = {
      id: 'f-new',
      name: 'avatar',
      slotId: 'fresh',
      filename: 'avatar.png',
      size: 999,
      mimeType: 'image/png',
      createdAt: ISO,
      updatedAt: ISO,
    };
    const parsed = buildParsed({
      requests: [
        makeRequest({
          id: 'r-1',
          folderId: 'root-new',
          body: {
            type: 'binary',
            content: '',
            attachment: { slotId: null, globalFileAssetId: 'f-reused' },
          },
        }),
        makeRequest({
          id: 'r-2',
          folderId: 'root-new',
          body: {
            type: 'form-data',
            content: '',
            formRows: [
              {
                kind: 'file',
                key: 'av',
                slotId: null,
                globalFileAssetId: 'f-new',
                enabled: true,
              },
            ],
          },
        }),
      ],
      dependencies: { schemas: [], graphql: [], files: [reuseFile, newFile] },
    });
    const result = importApicircleFolderInto(synced, parsed, null);
    expect(result.counts).toMatchObject({ filesAdded: 1, filesReused: 1 });

    const r1 = result.synced.collections.requests['r-1'];
    if (r1.body.type !== 'binary') throw new Error('expected binary');
    expect(r1.body.attachment?.globalFileAssetId).toBe('existing'); // reused

    const r2 = result.synced.collections.requests['r-2'];
    if (r2.body.type !== 'form-data') throw new Error('expected form-data');
    const row = r2.body.formRows?.[0];
    if (!row || row.kind !== 'file') throw new Error('expected file row');
    expect(row.globalFileAssetId).toBe('f-new');
  });

  it('leaves a binary body untouched when its file ref is not in the remap', () => {
    const parsed = buildParsed({
      requests: [
        makeRequest({
          id: 'r-1',
          folderId: 'root-new',
          body: {
            type: 'binary',
            content: '',
            attachment: { slotId: null, globalFileAssetId: 'unknown' },
          },
        }),
      ],
    });
    const result = importApicircleFolderInto(emptySynced(), parsed, null);
    const r = result.synced.collections.requests['r-1'];
    if (r.body.type !== 'binary') throw new Error('expected binary');
    expect(r.body.attachment?.globalFileAssetId).toBe('unknown');
  });

  it('passes through a binary body without an attachment', () => {
    const parsed = buildParsed({
      requests: [
        makeRequest({
          id: 'r-1',
          folderId: 'root-new',
          body: { type: 'binary', content: '' },
        }),
      ],
    });
    const result = importApicircleFolderInto(emptySynced(), parsed, null);
    const r = result.synced.collections.requests['r-1'];
    if (r.body.type !== 'binary') throw new Error('expected binary');
    expect(r.body.attachment).toBeUndefined();
  });

  it('leaves a form-data row untouched when its file ref is not in the remap', () => {
    const parsed = buildParsed({
      requests: [
        makeRequest({
          id: 'r-1',
          folderId: 'root-new',
          body: {
            type: 'form-data',
            content: '',
            formRows: [
              { kind: 'text', key: 't', value: 'v', enabled: true },
              {
                kind: 'file',
                key: 'photo',
                slotId: null,
                globalFileAssetId: 'unknown',
                enabled: true,
              },
            ],
          },
        }),
      ],
    });
    const result = importApicircleFolderInto(emptySynced(), parsed, null);
    const r = result.synced.collections.requests['r-1'];
    if (r.body.type !== 'form-data') throw new Error('expected form-data');
    const row = r.body.formRows?.find((x) => x.kind === 'file');
    if (!row || row.kind !== 'file') throw new Error('expected file row');
    expect(row.globalFileAssetId).toBe('unknown');
  });

  it('passes a form-data body without formRows through unchanged', () => {
    const parsed = buildParsed({
      requests: [
        makeRequest({
          id: 'r-1',
          folderId: 'root-new',
          body: { type: 'form-data', content: '' },
        }),
      ],
    });
    const result = importApicircleFolderInto(emptySynced(), parsed, null);
    const r = result.synced.collections.requests['r-1'];
    if (r.body.type !== 'form-data') throw new Error('expected form-data');
    expect(r.body.formRows).toBeUndefined();
  });

  it('passes JSON / text bodies through unchanged', () => {
    const parsed = buildParsed({
      requests: [
        makeRequest({
          id: 'r-1',
          folderId: 'root-new',
          body: { type: 'json', content: '{"a":1}' },
        }),
      ],
    });
    const result = importApicircleFolderInto(emptySynced(), parsed, null);
    const r = result.synced.collections.requests['r-1'];
    expect(r.body).toEqual({ type: 'json', content: '{"a":1}' });
  });

  it('handles a workspace missing globalAssets.files (legacy pre-files shape)', () => {
    const synced = emptySynced();
    synced.globalAssets.files = undefined;
    const fileAsset: GlobalFileAsset = {
      id: 'f-1',
      name: 'photo',
      slotId: 'src',
      filename: 'photo.jpg',
      size: 1,
      mimeType: 'image/jpeg',
      createdAt: ISO,
      updatedAt: ISO,
    };
    const parsed = buildParsed({
      dependencies: { schemas: [], graphql: [], files: [fileAsset] },
    });
    const result = importApicircleFolderInto(synced, parsed, null);
    expect(result.synced.globalAssets.files?.['f-1']).toMatchObject({ name: 'photo' });
    expect(result.counts.filesAdded).toBe(1);
  });

  it('handles a workspace missing the entire globalAssets section', () => {
    const synced = emptySynced();
    // Force-strip globalAssets to exercise the withGlobalAssets fallback.
    (
      synced as unknown as { globalAssets: WorkspaceSynced['globalAssets'] | undefined }
    ).globalAssets = undefined as unknown as WorkspaceSynced['globalAssets'];
    const parsed = buildParsed({
      dependencies: {
        schemas: [{ id: 's-1', name: 'X', schema: '{}', createdAt: ISO, updatedAt: ISO }],
        graphql: [
          {
            id: 'g-1',
            name: 'Q',
            kind: 'sdl',
            source: 'type Query { x: String }',
            createdAt: ISO,
            updatedAt: ISO,
          },
        ],
        files: [],
      },
    });
    const result = importApicircleFolderInto(synced, parsed, null);
    expect(result.synced.globalAssets.schemas['s-1']).toBeDefined();
    expect(result.synced.globalAssets.graphql['g-1']).toBeDefined();
  });

  it('uniquifies up to a deep collision (n>=3)', () => {
    const synced = emptySynced();
    synced.collections.folders['a'] = { id: 'a', name: 'Imported', parentId: null };
    synced.collections.folders['b'] = { id: 'b', name: 'Imported (2)', parentId: null };
    synced.collections.tree.children = [
      { kind: 'folder', id: 'a' },
      { kind: 'folder', id: 'b' },
    ];
    const result = importApicircleFolderInto(synced, buildParsed(), null);
    expect(result.rootFolderName).toBe('Imported (3)');
  });

  it('rewrites form-data file-row refs when the remap reuses an existing file', () => {
    const synced = emptySynced();
    synced.globalAssets.files = {
      existing: {
        id: 'existing',
        name: 'photo',
        slotId: 'src',
        filename: 'photo.jpg',
        size: 7,
        mimeType: 'image/jpeg',
        createdAt: ISO,
        updatedAt: ISO,
      },
    };
    const parsed = buildParsed({
      requests: [
        makeRequest({
          id: 'r-1',
          folderId: 'root-new',
          body: {
            type: 'form-data',
            content: '',
            formRows: [
              { kind: 'text', key: 't', value: 'v', enabled: true },
              {
                kind: 'file',
                key: 'photo',
                slotId: null,
                globalFileAssetId: 'f-incoming',
                enabled: true,
              },
            ],
          },
        }),
      ],
      dependencies: {
        schemas: [],
        graphql: [],
        files: [
          {
            id: 'f-incoming',
            name: 'photo',
            slotId: 'fresh',
            filename: 'photo.jpg',
            size: 7,
            mimeType: 'image/jpeg',
            createdAt: ISO,
            updatedAt: ISO,
          },
        ],
      },
    });
    const result = importApicircleFolderInto(synced, parsed, null);
    const r = result.synced.collections.requests['r-1'];
    if (r.body.type !== 'form-data') throw new Error('expected form-data');
    const fileRow = r.body.formRows?.find((row) => row.kind === 'file');
    if (!fileRow || fileRow.kind !== 'file') throw new Error('expected file row');
    expect(fileRow.globalFileAssetId).toBe('existing');
  });

  it('falls through the (n>999) escape hatch when uniquification cannot resolve', () => {
    // Pre-seed 1000 collisions so the inner loop hits its pragmatic
    // ceiling. Exercises the defensive `if (n > 999) return …` branch
    // shared with `uniquifyName` in editorActions.
    const synced = emptySynced();
    synced.collections.folders['a-0'] = { id: 'a-0', name: 'Imported', parentId: null };
    synced.collections.tree.children.push({ kind: 'folder', id: 'a-0' });
    for (let i = 2; i <= 1000; i++) {
      synced.collections.folders[`a-${i}`] = {
        id: `a-${i}`,
        name: `Imported (${i})`,
        parentId: null,
      };
      synced.collections.tree.children.push({ kind: 'folder', id: `a-${i}` });
    }
    const result = importApicircleFolderInto(synced, buildParsed(), null);
    expect(result.rootFolderName).toBe('Imported (1000)');
  });

  it('bumps the meta.updatedAt timestamp', () => {
    const before = emptySynced();
    const result = importApicircleFolderInto(before, buildParsed(), null);
    expect(result.synced.meta.updatedAt).not.toBe(before.meta.updatedAt);
  });
});
