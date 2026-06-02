import { describe, expect, it } from 'vitest';
import type {
  Folder,
  GlobalFileAsset,
  GlobalGraphQL,
  GlobalSchema,
  Request as ApiRequest,
  WorkspaceSynced,
} from '@apicircle/shared';
import {
  APICIRCLE_FOLDER_EXPORT_FORMAT,
  collectFolderExport,
  serializeFolderExport,
  suggestFolderExportFilename,
} from './folderExport';

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

function folder(id: string, name: string, parentId: string | null = null): Folder {
  return { id, name, parentId };
}

function request(
  overrides: Partial<ApiRequest> & { id: string; folderId: string | null },
): ApiRequest {
  return {
    id: overrides.id,
    name: overrides.name ?? 'Req',
    folderId: overrides.folderId,
    method: overrides.method ?? 'GET',
    url: overrides.url ?? 'https://example.com',
    headers: overrides.headers ?? [],
    query: overrides.query ?? [],
    pathParams: overrides.pathParams,
    cookies: overrides.cookies,
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

function schema(id: string, name: string): GlobalSchema {
  return { id, name, schema: '{"type":"object"}', createdAt: ISO, updatedAt: ISO };
}

function graphql(id: string, name: string, kind: GlobalGraphQL['kind'] = 'sdl'): GlobalGraphQL {
  return { id, name, kind, source: 'type Query { hi: String }', createdAt: ISO, updatedAt: ISO };
}

function fileAsset(id: string, name: string): GlobalFileAsset {
  return {
    id,
    name,
    slotId: `slot-${id}`,
    filename: `${name}.bin`,
    size: 42,
    mimeType: 'application/octet-stream',
    createdAt: ISO,
    updatedAt: ISO,
  };
}

describe('collectFolderExport', () => {
  it('returns null when the folder id does not exist', () => {
    const synced = emptySynced();
    expect(collectFolderExport({ synced, folderId: 'missing' })).toBeNull();
  });

  it('exports an empty folder with the envelope discriminator + report', () => {
    const synced = emptySynced();
    synced.collections.folders['f-root'] = folder('f-root', 'Root');

    const result = collectFolderExport({
      synced,
      folderId: 'f-root',
      now: ISO,
      appVersion: '1.0.6',
    });
    expect(result).not.toBeNull();
    const { envelope, report } = result!;
    expect(envelope.format).toBe(APICIRCLE_FOLDER_EXPORT_FORMAT);
    expect(envelope.exportedAt).toBe(ISO);
    expect(envelope.appVersion).toBe('1.0.6');
    expect(envelope.source).toEqual({
      workspaceId: 'ws-1',
      folderId: 'f-root',
      folderName: 'Root',
    });
    expect(envelope.folder.name).toBe('Root');
    expect(envelope.folder.subfolders).toEqual([]);
    expect(envelope.folder.requests).toEqual([]);
    expect(envelope.dependencies).toEqual({ schemas: [], graphql: [], files: [] });
    expect(report.folderName).toBe('Root');
    expect(report.requestCount).toBe(0);
    expect(report.subfolderCount).toBe(0);
    expect(report.totalFolderCount).toBe(1);
    expect(report.hasDependencies).toBe(false);
  });

  it('includes folder-level auth on the exported root', () => {
    const synced = emptySynced();
    synced.collections.folders['f-root'] = {
      ...folder('f-root', 'Root'),
      auth: { type: 'bearer', token: 'tk' },
    };
    const { envelope } = collectFolderExport({ synced, folderId: 'f-root', now: ISO })!;
    expect(envelope.folder.auth).toEqual({ type: 'bearer', token: 'tk' });
  });

  it('walks descendant folders + requests but stops at unrelated subtrees', () => {
    const synced = emptySynced();
    synced.collections.folders['f-root'] = folder('f-root', 'Root');
    synced.collections.folders['f-child'] = folder('f-child', 'Child', 'f-root');
    synced.collections.folders['f-grand'] = folder('f-grand', 'Grand', 'f-child');
    synced.collections.folders['f-sibling'] = folder('f-sibling', 'Sibling'); // NOT in subtree
    synced.collections.requests['r-1'] = request({
      id: 'r-1',
      folderId: 'f-grand',
      name: 'GET /a',
    });
    synced.collections.requests['r-2'] = request({
      id: 'r-2',
      folderId: 'f-sibling',
      name: 'GET /b',
    });

    const { envelope, report } = collectFolderExport({ synced, folderId: 'f-root', now: ISO })!;
    expect(envelope.folder.subfolders.map((s) => s.id).sort()).toEqual(['f-child', 'f-grand']);
    expect(envelope.folder.requests.map((r) => r.id)).toEqual(['r-1']);
    expect(report.requestCount).toBe(1);
    expect(report.subfolderCount).toBe(2);
    expect(report.totalFolderCount).toBe(3);
  });

  it('embeds JSON Schema + GraphQL definitions referenced by requests', () => {
    const synced = emptySynced();
    synced.collections.folders['f-root'] = folder('f-root', 'Root');
    synced.globalAssets.schemas['s-1'] = schema('s-1', 'User');
    synced.globalAssets.graphql['g-1'] = graphql('g-1', 'Catalog');
    synced.collections.requests['r-1'] = request({
      id: 'r-1',
      folderId: 'f-root',
      bodySchemaId: 's-1',
      graphqlSchemaId: 'g-1',
    });

    const { envelope, report } = collectFolderExport({ synced, folderId: 'f-root', now: ISO })!;
    expect(envelope.dependencies.schemas.map((s) => s.id)).toEqual(['s-1']);
    expect(envelope.dependencies.graphql.map((g) => g.id)).toEqual(['g-1']);
    expect(report.dependencies.schemas).toEqual([{ id: 's-1', name: 'User' }]);
    expect(report.dependencies.graphql).toEqual([{ id: 'g-1', name: 'Catalog', kind: 'sdl' }]);
    expect(report.hasDependencies).toBe(true);
  });

  it('captures file-asset metadata for binary attachments', () => {
    const synced = emptySynced();
    synced.collections.folders['f-root'] = folder('f-root', 'Root');
    synced.globalAssets.files = { 'file-1': fileAsset('file-1', 'avatar') };
    synced.collections.requests['r-1'] = request({
      id: 'r-1',
      folderId: 'f-root',
      body: {
        type: 'binary',
        content: '',
        attachment: { slotId: 'slot-x', globalFileAssetId: 'file-1' },
      },
    });
    const { envelope, report } = collectFolderExport({ synced, folderId: 'f-root', now: ISO })!;
    expect(envelope.dependencies.files.map((f) => f.id)).toEqual(['file-1']);
    expect(report.dependencies.files).toEqual([
      {
        id: 'file-1',
        name: 'avatar',
        filename: 'avatar.bin',
        size: 42,
        mimeType: 'application/octet-stream',
      },
    ]);
  });

  it('captures file-asset metadata for form-data file rows', () => {
    const synced = emptySynced();
    synced.collections.folders['f-root'] = folder('f-root', 'Root');
    synced.globalAssets.files = { 'file-1': fileAsset('file-1', 'upload') };
    synced.collections.requests['r-1'] = request({
      id: 'r-1',
      folderId: 'f-root',
      body: {
        type: 'form-data',
        content: '',
        formRows: [
          { kind: 'text', key: 't', value: 'v', enabled: true },
          {
            kind: 'file',
            key: 'photo',
            slotId: 'slot-x',
            globalFileAssetId: 'file-1',
            enabled: true,
          },
        ],
      },
    });
    const { envelope } = collectFolderExport({ synced, folderId: 'f-root', now: ISO })!;
    expect(envelope.dependencies.files.map((f) => f.id)).toEqual(['file-1']);
  });

  it('does not duplicate the same dependency across multiple requests', () => {
    const synced = emptySynced();
    synced.collections.folders['f-root'] = folder('f-root', 'Root');
    synced.globalAssets.schemas['s-1'] = schema('s-1', 'Shared');
    synced.collections.requests['r-1'] = request({
      id: 'r-1',
      folderId: 'f-root',
      bodySchemaId: 's-1',
    });
    synced.collections.requests['r-2'] = request({
      id: 'r-2',
      folderId: 'f-root',
      bodySchemaId: 's-1',
    });
    const { envelope } = collectFolderExport({ synced, folderId: 'f-root', now: ISO })!;
    expect(envelope.dependencies.schemas).toHaveLength(1);
  });

  it('drops dangling dependency references (id present on request, missing in globalAssets)', () => {
    const synced = emptySynced();
    synced.collections.folders['f-root'] = folder('f-root', 'Root');
    synced.collections.requests['r-1'] = request({
      id: 'r-1',
      folderId: 'f-root',
      bodySchemaId: 'never-existed',
    });
    const { envelope } = collectFolderExport({ synced, folderId: 'f-root', now: ISO })!;
    expect(envelope.dependencies.schemas).toEqual([]);
  });

  it('deep-clones nested mutable structures so the source workspace is not aliased', () => {
    const synced = emptySynced();
    synced.collections.folders['f-root'] = folder('f-root', 'Root');
    const original: ApiRequest = request({
      id: 'r-1',
      folderId: 'f-root',
      headers: [{ key: 'X', value: '1', enabled: true }],
      query: [{ key: 'q', value: '1', enabled: true }],
      pathParams: { id: '5' },
      cookies: [{ key: 'c', value: '1', enabled: true }],
      contextVars: [{ key: 'a', value: '1' }],
      extractions: [{ id: 'e', variable: 'v', source: 'body', path: 'p', enabled: true }],
      assertions: [{ id: 'a', kind: 'status', op: 'equals', expected: 200 }],
      body: {
        type: 'form-data',
        content: '',
        formRows: [{ kind: 'text', key: 'k', value: 'v', enabled: true }],
      },
    });
    synced.collections.requests['r-1'] = original;

    const { envelope } = collectFolderExport({ synced, folderId: 'f-root', now: ISO })!;
    const exported = envelope.folder.requests[0];
    expect(exported.headers).not.toBe(original.headers);
    expect(exported.headers[0]).not.toBe(original.headers[0]);
    expect(exported.body).not.toBe(original.body);
  });

  it('produces a stable dependency order (sorted by name then id)', () => {
    const synced = emptySynced();
    synced.collections.folders['f-root'] = folder('f-root', 'Root');
    synced.globalAssets.schemas['s-b'] = schema('s-b', 'Beta');
    synced.globalAssets.schemas['s-a'] = schema('s-a', 'Alpha');
    synced.globalAssets.schemas['s-c'] = schema('s-c', 'Alpha'); // same name → tiebreak by id
    synced.collections.requests['r-1'] = request({
      id: 'r-1',
      folderId: 'f-root',
      bodySchemaId: 's-b',
    });
    synced.collections.requests['r-2'] = request({
      id: 'r-2',
      folderId: 'f-root',
      bodySchemaId: 's-a',
    });
    synced.collections.requests['r-3'] = request({
      id: 'r-3',
      folderId: 'f-root',
      bodySchemaId: 's-c',
    });

    const { envelope } = collectFolderExport({ synced, folderId: 'f-root', now: ISO })!;
    expect(envelope.dependencies.schemas.map((s) => s.id)).toEqual(['s-a', 's-c', 's-b']);
  });

  it('defaults `now` + `appVersion` when omitted', () => {
    const synced = emptySynced();
    synced.collections.folders['f-root'] = folder('f-root', 'Root');
    const { envelope } = collectFolderExport({ synced, folderId: 'f-root' })!;
    expect(typeof envelope.exportedAt).toBe('string');
    expect(envelope.exportedAt).not.toBe('');
    expect(envelope.appVersion).toBe('apicircle-studio');
  });

  it('ignores requests stored without a folderId even when ids might collide', () => {
    const synced = emptySynced();
    synced.collections.folders['f-root'] = folder('f-root', 'Root');
    synced.collections.requests['r-1'] = request({ id: 'r-1', folderId: null });
    const { envelope } = collectFolderExport({ synced, folderId: 'f-root', now: ISO })!;
    expect(envelope.folder.requests).toEqual([]);
  });

  it('preserves descendant folder auth and request optional fields (pathParams, cookies)', () => {
    const synced = emptySynced();
    synced.collections.folders['f-root'] = folder('f-root', 'Root');
    synced.collections.folders['f-child'] = {
      ...folder('f-child', 'Child', 'f-root'),
      auth: { type: 'bearer', token: 'tk' },
    };
    synced.collections.requests['r-1'] = request({
      id: 'r-1',
      folderId: 'f-child',
      pathParams: { id: '9' },
      cookies: [{ key: 'c', value: 'v', enabled: true }],
    });
    const { envelope } = collectFolderExport({ synced, folderId: 'f-root', now: ISO })!;
    expect(envelope.folder.subfolders[0].auth).toEqual({ type: 'bearer', token: 'tk' });
    expect(envelope.folder.requests[0].pathParams).toEqual({ id: '9' });
    expect(envelope.folder.requests[0].cookies).toEqual([{ key: 'c', value: 'v', enabled: true }]);
  });

  it('omits subfolder auth when the source folder has none', () => {
    const synced = emptySynced();
    synced.collections.folders['f-root'] = folder('f-root', 'Root');
    synced.collections.folders['f-child'] = folder('f-child', 'Child', 'f-root');
    const { envelope } = collectFolderExport({ synced, folderId: 'f-root', now: ISO })!;
    expect(envelope.folder.subfolders[0].auth).toBeUndefined();
  });

  it('preserves a binary body without an attachment ref (clone branch)', () => {
    const synced = emptySynced();
    synced.collections.folders['f-root'] = folder('f-root', 'Root');
    synced.collections.requests['r-1'] = request({
      id: 'r-1',
      folderId: 'f-root',
      body: { type: 'binary', content: '' },
    });
    const { envelope } = collectFolderExport({ synced, folderId: 'f-root', now: ISO })!;
    const exported = envelope.folder.requests[0];
    if (exported.body.type !== 'binary') throw new Error('expected binary');
    expect(exported.body.attachment).toBeUndefined();
  });

  it('preserves a form-data body without formRows (clone branch)', () => {
    const synced = emptySynced();
    synced.collections.folders['f-root'] = folder('f-root', 'Root');
    synced.collections.requests['r-1'] = request({
      id: 'r-1',
      folderId: 'f-root',
      body: { type: 'form-data', content: '' },
    });
    const { envelope } = collectFolderExport({ synced, folderId: 'f-root', now: ISO })!;
    const exported = envelope.folder.requests[0];
    if (exported.body.type !== 'form-data') throw new Error('expected form-data');
    expect(exported.body.formRows).toBeUndefined();
  });

  it('handles a workspace that omits the optional globalAssets.files map', () => {
    const synced = emptySynced();
    synced.collections.folders['f-root'] = folder('f-root', 'Root');
    synced.globalAssets.files = undefined; // pre-P-file workspaces
    synced.collections.requests['r-1'] = request({
      id: 'r-1',
      folderId: 'f-root',
      body: {
        type: 'binary',
        content: '',
        attachment: { slotId: 'slot-x', globalFileAssetId: 'never' },
      },
    });
    const { envelope } = collectFolderExport({ synced, folderId: 'f-root', now: ISO })!;
    expect(envelope.dependencies.files).toEqual([]);
  });
});

describe('serializeFolderExport', () => {
  it('produces stable, indented JSON that round-trips through JSON.parse', () => {
    const synced = emptySynced();
    synced.collections.folders['f-root'] = folder('f-root', 'Root');
    const { envelope } = collectFolderExport({ synced, folderId: 'f-root', now: ISO })!;
    const text = serializeFolderExport(envelope);
    expect(text).toContain('"format": "apicircle.folder/v1"');
    expect(text.includes('\n  ')).toBe(true); // 2-space indent present
    expect(JSON.parse(text)).toEqual(envelope);
  });
});

describe('suggestFolderExportFilename', () => {
  it('slugifies the folder name and appends .apicircle.json', () => {
    const synced = emptySynced();
    synced.collections.folders['f-root'] = folder('f-root', 'My Auth Folder!');
    const { envelope } = collectFolderExport({ synced, folderId: 'f-root', now: ISO })!;
    expect(suggestFolderExportFilename(envelope)).toBe('my-auth-folder.apicircle.json');
  });

  it('falls back to "folder" when the name has no alphanumerics', () => {
    const synced = emptySynced();
    synced.collections.folders['f-root'] = folder('f-root', '---');
    const { envelope } = collectFolderExport({ synced, folderId: 'f-root', now: ISO })!;
    expect(suggestFolderExportFilename(envelope)).toBe('folder.apicircle.json');
  });
});
