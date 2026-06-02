import { describe, expect, it, vi } from 'vitest';
import type { WorkspaceSynced } from '@apicircle/shared';
import { APICIRCLE_FOLDER_EXPORT_FORMAT, collectFolderExport } from '../export/folderExport';
import {
  isApicircleFolderExport,
  parseApicircleFolderExport,
  parseApicircleFolderExportDoc,
} from './apicircleFolder';

const ISO = '2026-06-02T00:00:00.000Z';

function syncedWith(folderId: string, folderName: string): WorkspaceSynced {
  return {
    schemaVersion: 1,
    workspaceId: 'ws-1',
    collections: {
      tree: { id: 'root', type: 'root', children: [] },
      requests: {},
      folders: { [folderId]: { id: folderId, name: folderName, parentId: null } },
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

function counter(): () => string {
  let i = 0;
  return () => `new-id-${++i}`;
}

describe('isApicircleFolderExport', () => {
  it.each([
    [null, false],
    [undefined, false],
    [42, false],
    ['not an object', false],
    [{}, false],
    [{ format: 'postman' }, false],
    [{ format: APICIRCLE_FOLDER_EXPORT_FORMAT }, true],
  ] as const)('discriminator on %p → %p', (doc, expected) => {
    expect(isApicircleFolderExport(doc)).toBe(expected);
  });
});

describe('parseApicircleFolderExport — malformed input', () => {
  it('throws on invalid JSON', () => {
    expect(() => parseApicircleFolderExport('{not-json')).toThrow(/Couldn't parse JSON/);
  });

  it('throws when the format discriminator is missing', () => {
    expect(() => parseApicircleFolderExport(JSON.stringify({}))).toThrow(/Unsupported format/);
  });

  it('throws when folder section is missing', () => {
    const doc = { format: APICIRCLE_FOLDER_EXPORT_FORMAT };
    expect(() => parseApicircleFolderExportDoc(doc)).toThrow(/missing the "folder" section/);
  });

  it('throws when folder.name is empty', () => {
    const doc = {
      format: APICIRCLE_FOLDER_EXPORT_FORMAT,
      folder: { name: '', subfolders: [], requests: [] },
      dependencies: { schemas: [], graphql: [], files: [] },
      source: { workspaceId: 'a', folderId: 'b', folderName: 'c' },
    };
    expect(() => parseApicircleFolderExportDoc(doc)).toThrow(/non-empty "folder.name"/);
  });

  it('throws when folder.subfolders is not an array', () => {
    const doc = {
      format: APICIRCLE_FOLDER_EXPORT_FORMAT,
      folder: { name: 'Root', subfolders: 'oops', requests: [] },
      dependencies: { schemas: [], graphql: [], files: [] },
      source: { workspaceId: 'a', folderId: 'b', folderName: 'c' },
    };
    expect(() => parseApicircleFolderExportDoc(doc)).toThrow(/"folder.subfolders" array/);
  });

  it('throws when folder.requests is not an array', () => {
    const doc = {
      format: APICIRCLE_FOLDER_EXPORT_FORMAT,
      folder: { name: 'Root', subfolders: [], requests: 'oops' },
      dependencies: { schemas: [], graphql: [], files: [] },
      source: { workspaceId: 'a', folderId: 'b', folderName: 'c' },
    };
    expect(() => parseApicircleFolderExportDoc(doc)).toThrow(/"folder.requests" array/);
  });

  it('throws when dependencies section is missing', () => {
    const doc = {
      format: APICIRCLE_FOLDER_EXPORT_FORMAT,
      folder: { name: 'Root', subfolders: [], requests: [] },
      source: { workspaceId: 'a', folderId: 'b', folderName: 'c' },
    };
    expect(() => parseApicircleFolderExportDoc(doc)).toThrow(/missing the "dependencies" section/);
  });

  it('throws when dependencies arrays are missing', () => {
    const doc = {
      format: APICIRCLE_FOLDER_EXPORT_FORMAT,
      folder: { name: 'Root', subfolders: [], requests: [] },
      dependencies: { schemas: [], graphql: 'oops', files: [] },
      source: { workspaceId: 'a', folderId: 'b', folderName: 'c' },
    };
    expect(() => parseApicircleFolderExportDoc(doc)).toThrow(/schemas \/ graphql \/ files arrays/);
  });

  it('throws when source section is missing', () => {
    const doc = {
      format: APICIRCLE_FOLDER_EXPORT_FORMAT,
      folder: { name: 'Root', subfolders: [], requests: [] },
      dependencies: { schemas: [], graphql: [], files: [] },
    };
    expect(() => parseApicircleFolderExportDoc(doc)).toThrow(/missing the "source" section/);
  });

  it('throws when source.folderId / source.folderName are not strings', () => {
    const doc = {
      format: APICIRCLE_FOLDER_EXPORT_FORMAT,
      folder: { name: 'Root', subfolders: [], requests: [] },
      dependencies: { schemas: [], graphql: [], files: [] },
      source: { workspaceId: 'ws', folderId: 1, folderName: 2 },
    };
    expect(() => parseApicircleFolderExportDoc(doc)).toThrow(/"folderId" and "folderName"/);
  });
});

describe('parseApicircleFolderExport — round-trip through collectFolderExport', () => {
  it('parses an empty-folder export and assigns a fresh root id', () => {
    const synced = syncedWith('f-root', 'Root');
    const { envelope } = collectFolderExport({ synced, folderId: 'f-root', now: ISO })!;

    const parsed = parseApicircleFolderExport(JSON.stringify(envelope), { idGenerator: counter() });
    expect(parsed.rootFolder.name).toBe('Root');
    expect(parsed.rootFolder.id).toBe('new-id-1');
    expect(parsed.subfolders).toEqual([]);
    expect(parsed.requests).toEqual([]);
    expect(parsed.warnings).toEqual([]);
    expect(parsed.sourceFolderName).toBe('Root');
  });

  it('remaps subfolder parentIds onto the new root', () => {
    const synced = syncedWith('f-root', 'Root');
    synced.collections.folders['f-child'] = { id: 'f-child', name: 'Child', parentId: 'f-root' };
    synced.collections.folders['f-grand'] = { id: 'f-grand', name: 'Grand', parentId: 'f-child' };
    const { envelope } = collectFolderExport({ synced, folderId: 'f-root', now: ISO })!;

    const parsed = parseApicircleFolderExportDoc(envelope, { idGenerator: counter() });
    // new-id-1 = new root; new-id-2 / new-id-3 = child / grand (order matches insertion).
    const idByName = new Map(parsed.subfolders.map((s) => [s.name, s.id]));
    const childId = idByName.get('Child')!;
    const grandId = idByName.get('Grand')!;
    expect(parsed.subfolders.find((s) => s.name === 'Child')?.parentId).toBe('new-id-1');
    expect(parsed.subfolders.find((s) => s.name === 'Grand')?.parentId).toBe(childId);
    expect(grandId).not.toBe('f-grand');
  });

  it('remaps request folderIds + bodySchemaId + graphqlSchemaId references', () => {
    const synced = syncedWith('f-root', 'Root');
    synced.globalAssets.schemas['s-1'] = {
      id: 's-1',
      name: 'User',
      schema: '{}',
      createdAt: ISO,
      updatedAt: ISO,
    };
    synced.globalAssets.graphql['g-1'] = {
      id: 'g-1',
      name: 'Catalog',
      kind: 'sdl',
      source: 'type Query { hi: String }',
      createdAt: ISO,
      updatedAt: ISO,
    };
    synced.collections.requests['r-1'] = {
      id: 'r-1',
      name: 'POST /users',
      folderId: 'f-root',
      method: 'POST',
      url: 'https://example.com',
      headers: [],
      query: [],
      body: { type: 'json', content: '{}' },
      auth: { type: 'none' },
      contextVars: [],
      extractions: [],
      assertions: [],
      bodySchemaId: 's-1',
      graphqlSchemaId: 'g-1',
      createdAt: ISO,
      updatedAt: ISO,
    };
    const { envelope } = collectFolderExport({ synced, folderId: 'f-root', now: ISO })!;

    const parsed = parseApicircleFolderExportDoc(envelope, { idGenerator: counter() });
    expect(parsed.requests).toHaveLength(1);
    const r = parsed.requests[0];
    expect(r.folderId).toBe(parsed.rootFolder.id);
    expect(r.bodySchemaId).toBe(parsed.dependencies.schemas[0].id);
    expect(r.graphqlSchemaId).toBe(parsed.dependencies.graphql[0].id);
    expect(parsed.dependencies.schemas[0].name).toBe('User');
    expect(parsed.dependencies.graphql[0].name).toBe('Catalog');
  });

  it('remaps form-data file rows + binary attachment file refs and resets slotId', () => {
    const synced = syncedWith('f-root', 'Root');
    synced.globalAssets.files = {
      'file-1': {
        id: 'file-1',
        name: 'photo',
        slotId: 'src-slot',
        filename: 'photo.jpg',
        size: 1,
        mimeType: 'image/jpeg',
        createdAt: ISO,
        updatedAt: ISO,
      },
    };
    synced.collections.requests['r-1'] = {
      id: 'r-1',
      name: 'binary',
      folderId: 'f-root',
      method: 'POST',
      url: 'https://example.com',
      headers: [],
      query: [],
      body: {
        type: 'binary',
        content: '',
        attachment: { slotId: 'src-slot', globalFileAssetId: 'file-1' },
      },
      auth: { type: 'none' },
      contextVars: [],
      extractions: [],
      assertions: [],
      createdAt: ISO,
      updatedAt: ISO,
    };
    synced.collections.requests['r-2'] = {
      id: 'r-2',
      name: 'form',
      folderId: 'f-root',
      method: 'POST',
      url: 'https://example.com',
      headers: [],
      query: [],
      body: {
        type: 'form-data',
        content: '',
        formRows: [
          { kind: 'text', key: 't', value: 'v', enabled: true },
          {
            kind: 'file',
            key: 'photo',
            slotId: 'src-slot',
            globalFileAssetId: 'file-1',
            enabled: true,
          },
        ],
      },
      auth: { type: 'none' },
      contextVars: [],
      extractions: [],
      assertions: [],
      createdAt: ISO,
      updatedAt: ISO,
    };
    const { envelope } = collectFolderExport({ synced, folderId: 'f-root', now: ISO })!;
    const parsed = parseApicircleFolderExportDoc(envelope, { idGenerator: counter() });

    const newFileId = parsed.dependencies.files[0].id;
    const binary = parsed.requests.find((r) => r.name === 'binary')!;
    if (binary.body.type !== 'binary') throw new Error('expected binary body');
    expect(binary.body.attachment?.slotId).toBeNull();
    expect(binary.body.attachment?.globalFileAssetId).toBe(newFileId);

    const form = parsed.requests.find((r) => r.name === 'form')!;
    if (form.body.type !== 'form-data') throw new Error('expected form-data body');
    const fileRow = form.body.formRows!.find((row) => row.kind === 'file');
    if (!fileRow || fileRow.kind !== 'file') throw new Error('expected file row');
    expect(fileRow.slotId).toBeNull();
    expect(fileRow.globalFileAssetId).toBe(newFileId);
  });

  it('warns + clears dangling bodySchemaId references not embedded in the export', () => {
    const envelope = {
      format: APICIRCLE_FOLDER_EXPORT_FORMAT,
      exportedAt: ISO,
      appVersion: '1',
      source: { workspaceId: 'ws', folderId: 'f-root', folderName: 'Root' },
      folder: {
        name: 'Root',
        subfolders: [],
        requests: [
          {
            id: 'r-1',
            name: 'r',
            folderId: 'f-root',
            method: 'GET',
            url: 'https://x',
            headers: [],
            query: [],
            body: { type: 'none', content: '' },
            auth: { type: 'none' },
            contextVars: [],
            extractions: [],
            assertions: [],
            bodySchemaId: 'missing',
            graphqlSchemaId: 'also-missing',
            createdAt: ISO,
            updatedAt: ISO,
          },
        ],
      },
      dependencies: { schemas: [], graphql: [], files: [] },
    };
    const parsed = parseApicircleFolderExportDoc(envelope, { idGenerator: counter() });
    expect(parsed.requests[0].bodySchemaId).toBeNull();
    expect(parsed.requests[0].graphqlSchemaId).toBeNull();
    expect(parsed.warnings).toEqual(
      expect.arrayContaining([
        expect.stringContaining('bodySchemaId'),
        expect.stringContaining('graphqlSchemaId'),
      ]),
    );
  });

  it('warns + clears binary attachment references to files not embedded', () => {
    const envelope = {
      format: APICIRCLE_FOLDER_EXPORT_FORMAT,
      exportedAt: ISO,
      appVersion: '1',
      source: { workspaceId: 'ws', folderId: 'f-root', folderName: 'Root' },
      folder: {
        name: 'Root',
        subfolders: [],
        requests: [
          {
            id: 'r-1',
            name: 'r',
            folderId: 'f-root',
            method: 'POST',
            url: 'https://x',
            headers: [],
            query: [],
            body: {
              type: 'binary',
              content: '',
              attachment: { slotId: 'src', globalFileAssetId: 'gone' },
            },
            auth: { type: 'none' },
            contextVars: [],
            extractions: [],
            assertions: [],
            createdAt: ISO,
            updatedAt: ISO,
          },
        ],
      },
      dependencies: { schemas: [], graphql: [], files: [] },
    };
    const parsed = parseApicircleFolderExportDoc(envelope, { idGenerator: counter() });
    const r = parsed.requests[0];
    if (r.body.type !== 'binary') throw new Error('expected binary');
    expect(r.body.attachment?.globalFileAssetId).toBeNull();
    expect(parsed.warnings.some((w) => /re-attach the file after import/.test(w))).toBe(true);
  });

  it('warns + clears form-data file row references to files not embedded', () => {
    const envelope = {
      format: APICIRCLE_FOLDER_EXPORT_FORMAT,
      exportedAt: ISO,
      appVersion: '1',
      source: { workspaceId: 'ws', folderId: 'f-root', folderName: 'Root' },
      folder: {
        name: 'Root',
        subfolders: [],
        requests: [
          {
            id: 'r-1',
            name: 'r',
            folderId: 'f-root',
            method: 'POST',
            url: 'https://x',
            headers: [],
            query: [],
            body: {
              type: 'form-data',
              content: '',
              formRows: [
                {
                  kind: 'file',
                  key: 'photo',
                  slotId: 'src',
                  globalFileAssetId: 'missing',
                  enabled: true,
                },
              ],
            },
            auth: { type: 'none' },
            contextVars: [],
            extractions: [],
            assertions: [],
            createdAt: ISO,
            updatedAt: ISO,
          },
        ],
      },
      dependencies: { schemas: [], graphql: [], files: [] },
    };
    const parsed = parseApicircleFolderExportDoc(envelope, { idGenerator: counter() });
    const r = parsed.requests[0];
    if (r.body.type !== 'form-data') throw new Error('expected form-data');
    const row = r.body.formRows![0];
    if (row.kind !== 'file') throw new Error('expected file row');
    expect(row.globalFileAssetId).toBeNull();
  });

  it('warns + reattaches subfolders pointing at unknown parentIds under the new root', () => {
    const envelope = {
      format: APICIRCLE_FOLDER_EXPORT_FORMAT,
      exportedAt: ISO,
      appVersion: '1',
      source: { workspaceId: 'ws', folderId: 'f-root', folderName: 'Root' },
      folder: {
        name: 'Root',
        subfolders: [
          // legacy/null parentId — should land under the new root
          { id: 'f-a', name: 'Loose', parentId: null },
          // dangling parent
          { id: 'f-b', name: 'Detached', parentId: 'unknown' },
        ],
        requests: [],
      },
      dependencies: { schemas: [], graphql: [], files: [] },
    };
    const parsed = parseApicircleFolderExportDoc(envelope, { idGenerator: counter() });
    expect(parsed.subfolders).toHaveLength(2);
    expect(parsed.subfolders.every((s) => s.parentId === parsed.rootFolder.id)).toBe(true);
    expect(parsed.warnings.some((w) => /Detached/.test(w))).toBe(true);
  });

  it('warns + reattaches requests pointing at unknown folderIds under the new root', () => {
    const envelope = {
      format: APICIRCLE_FOLDER_EXPORT_FORMAT,
      exportedAt: ISO,
      appVersion: '1',
      source: { workspaceId: 'ws', folderId: 'f-root', folderName: 'Root' },
      folder: {
        name: 'Root',
        subfolders: [],
        requests: [
          {
            id: 'r-1',
            name: 'orphan',
            folderId: 'gone',
            method: 'GET',
            url: 'https://x',
            headers: [],
            query: [],
            body: { type: 'none', content: '' },
            auth: { type: 'none' },
            contextVars: [],
            extractions: [],
            assertions: [],
            createdAt: ISO,
            updatedAt: ISO,
          },
          {
            id: 'r-2',
            name: 'rootless',
            folderId: null,
            method: 'GET',
            url: 'https://x',
            headers: [],
            query: [],
            body: { type: 'none', content: '' },
            auth: { type: 'none' },
            contextVars: [],
            extractions: [],
            assertions: [],
            createdAt: ISO,
            updatedAt: ISO,
          },
        ],
      },
      dependencies: { schemas: [], graphql: [], files: [] },
    };
    const parsed = parseApicircleFolderExportDoc(envelope, { idGenerator: counter() });
    expect(parsed.requests.every((r) => r.folderId === parsed.rootFolder.id)).toBe(true);
    expect(parsed.warnings.some((w) => /orphan/.test(w))).toBe(true);
  });

  it('preserves folder-level auth on the root', () => {
    const envelope = {
      format: APICIRCLE_FOLDER_EXPORT_FORMAT,
      exportedAt: ISO,
      appVersion: '1',
      source: { workspaceId: 'ws', folderId: 'f-root', folderName: 'Root' },
      folder: {
        name: 'Root',
        auth: { type: 'bearer', token: 'tk' },
        subfolders: [],
        requests: [],
      },
      dependencies: { schemas: [], graphql: [], files: [] },
    };
    const parsed = parseApicircleFolderExportDoc(envelope, { idGenerator: counter() });
    expect(parsed.rootFolder.auth).toEqual({ type: 'bearer', token: 'tk' });
  });

  it('passes through request bodies that have no asset references untouched', () => {
    const envelope = {
      format: APICIRCLE_FOLDER_EXPORT_FORMAT,
      exportedAt: ISO,
      appVersion: '1',
      source: { workspaceId: 'ws', folderId: 'f-root', folderName: 'Root' },
      folder: {
        name: 'Root',
        subfolders: [],
        requests: [
          {
            id: 'r-1',
            name: 'pure',
            folderId: 'f-root',
            method: 'POST',
            url: 'https://x',
            headers: [{ key: 'X', value: '1', enabled: true }],
            query: [],
            body: { type: 'json', content: '{}' },
            auth: { type: 'none' },
            contextVars: [],
            extractions: [],
            assertions: [],
            createdAt: ISO,
            updatedAt: ISO,
          },
        ],
      },
      dependencies: { schemas: [], graphql: [], files: [] },
    };
    const parsed = parseApicircleFolderExportDoc(envelope, { idGenerator: counter() });
    expect(parsed.requests[0].body).toEqual({ type: 'json', content: '{}' });
    expect(parsed.requests[0].headers[0]).toEqual({ key: 'X', value: '1', enabled: true });
  });

  it('handles binary requests with no attachment metadata (clones body only)', () => {
    const envelope = {
      format: APICIRCLE_FOLDER_EXPORT_FORMAT,
      exportedAt: ISO,
      appVersion: '1',
      source: { workspaceId: 'ws', folderId: 'f-root', folderName: 'Root' },
      folder: {
        name: 'Root',
        subfolders: [],
        requests: [
          {
            id: 'r-1',
            name: 'binary-noattach',
            folderId: 'f-root',
            method: 'POST',
            url: 'https://x',
            headers: [],
            query: [],
            body: { type: 'binary', content: '' }, // attachment intentionally absent
            auth: { type: 'none' },
            contextVars: [],
            extractions: [],
            assertions: [],
            createdAt: ISO,
            updatedAt: ISO,
          },
        ],
      },
      dependencies: { schemas: [], graphql: [], files: [] },
    };
    const parsed = parseApicircleFolderExportDoc(envelope, { idGenerator: counter() });
    const r = parsed.requests[0];
    if (r.body.type !== 'binary') throw new Error('expected binary');
    expect(r.body.attachment).toBeUndefined();
  });

  it('propagates a non-Error JSON.parse failure as a stringified message', () => {
    // JSON.parse normally throws SyntaxError — to exercise the
    // `String(err)` fallback branch we stub it to throw a non-Error
    // value. Restored immediately after the assertion.
    const spy = vi.spyOn(JSON, 'parse').mockImplementation(() => {
      // Throw a non-Error so we exercise the `String(err)` fallback in
      // the caller's catch block. ESLint's only-throw-error rule fires
      // on bare-string throws — this is the rare case where the test
      // is explicitly verifying that path, so the inline disable is
      // intentional.
      // eslint-disable-next-line @typescript-eslint/only-throw-error
      throw 'kaboom';
    });
    try {
      expect(() => parseApicircleFolderExport('whatever')).toThrow(/Couldn't parse JSON: kaboom/);
    } finally {
      spy.mockRestore();
    }
  });

  it('preserves descendant folder auth on import', () => {
    const envelope = {
      format: APICIRCLE_FOLDER_EXPORT_FORMAT,
      exportedAt: ISO,
      appVersion: '1',
      source: { workspaceId: 'ws', folderId: 'f-root', folderName: 'Root' },
      folder: {
        name: 'Root',
        subfolders: [
          {
            id: 'f-child',
            name: 'Child',
            parentId: 'f-root',
            auth: { type: 'bearer', token: 'tk' },
          },
        ],
        requests: [],
      },
      dependencies: { schemas: [], graphql: [], files: [] },
    };
    const parsed = parseApicircleFolderExportDoc(envelope, { idGenerator: counter() });
    expect(parsed.subfolders[0].auth).toEqual({ type: 'bearer', token: 'tk' });
  });

  it('preserves request pathParams + cookies on import', () => {
    const envelope = {
      format: APICIRCLE_FOLDER_EXPORT_FORMAT,
      exportedAt: ISO,
      appVersion: '1',
      source: { workspaceId: 'ws', folderId: 'f-root', folderName: 'Root' },
      folder: {
        name: 'Root',
        subfolders: [],
        requests: [
          {
            id: 'r-1',
            name: 'r',
            folderId: 'f-root',
            method: 'GET',
            url: 'https://x',
            headers: [],
            query: [],
            pathParams: { id: '9' },
            cookies: [{ key: 'c', value: 'v', enabled: true }],
            body: { type: 'none', content: '' },
            auth: { type: 'none' },
            contextVars: [],
            extractions: [],
            assertions: [],
            createdAt: ISO,
            updatedAt: ISO,
          },
        ],
      },
      dependencies: { schemas: [], graphql: [], files: [] },
    };
    const parsed = parseApicircleFolderExportDoc(envelope, { idGenerator: counter() });
    expect(parsed.requests[0].pathParams).toEqual({ id: '9' });
    expect(parsed.requests[0].cookies).toEqual([{ key: 'c', value: 'v', enabled: true }]);
  });

  it('defaults the idGenerator to generateId when omitted', () => {
    const envelope = {
      format: APICIRCLE_FOLDER_EXPORT_FORMAT,
      exportedAt: ISO,
      appVersion: '1',
      source: { workspaceId: 'ws', folderId: 'f-root', folderName: 'Root' },
      folder: { name: 'Root', subfolders: [], requests: [] },
      dependencies: { schemas: [], graphql: [], files: [] },
    };
    const parsed = parseApicircleFolderExportDoc(envelope);
    expect(typeof parsed.rootFolder.id).toBe('string');
    expect(parsed.rootFolder.id.length).toBeGreaterThan(0);
  });
});
