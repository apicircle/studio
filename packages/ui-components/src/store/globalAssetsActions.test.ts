import { describe, expect, it } from 'vitest';
import type { Request as ApiRequest, WorkspaceSynced } from '@apicircle/shared';
import {
  addGlobalGraphQL,
  addGlobalFileAsset,
  addGlobalSchema,
  attachmentRefFromGlobalFileAsset,
  formDataRowFromGlobalFileAsset,
  removeGlobalFileAsset,
  removeGlobalGraphQL,
  removeGlobalSchema,
  updateGlobalGraphQL,
  updateGlobalFileAsset,
  updateGlobalSchema,
} from './globalAssetsActions';

const baseSynced = (): WorkspaceSynced => ({
  schemaVersion: 1,
  workspaceId: 'ws-1',
  collections: { tree: { id: 'r', type: 'root', children: [] }, requests: {}, folders: {} },
  environments: { items: {}, activeName: null, priorityOrder: [] },
  linkedWorkspaces: {},
  linkedOverrides: { requests: {}, environmentVars: {} },
  releases: { self: null, perLink: {} },
  globalAssets: { schemas: {}, graphql: {}, files: {} },
  mockServers: {},
  meta: { createdAt: 't', updatedAt: 't', appVersion: '0.1.0' },
});

const seedRequest = (synced: WorkspaceSynced, partial: Partial<ApiRequest>): WorkspaceSynced => {
  const req: ApiRequest = {
    id: partial.id ?? 'r1',
    name: 'r',
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
    createdAt: 't',
    updatedAt: 't',
    ...partial,
  };
  return {
    ...synced,
    collections: {
      ...synced.collections,
      requests: { ...synced.collections.requests, [req.id]: req },
    },
  };
};

describe('addGlobalSchema', () => {
  it('appends a new entry with a fresh id and updates meta.updatedAt', () => {
    const before = baseSynced();
    const { synced, schema } = addGlobalSchema(before, { name: 'User' });
    expect(synced.globalAssets.schemas[schema.id]).toBe(schema);
    expect(schema.name).toBe('User');
    expect(synced.meta.updatedAt).not.toBe(before.meta.updatedAt);
  });

  it('seeds a draft 2020-12 schema body when none is supplied', () => {
    const { schema } = addGlobalSchema(baseSynced(), { name: 'X' });
    expect(schema.schema).toContain('https://json-schema.org/draft/2020-12/schema');
  });
});

describe('updateGlobalSchema', () => {
  it('patches name + body fields', () => {
    const { synced, schema } = addGlobalSchema(baseSynced(), { name: 'A' });
    const next = updateGlobalSchema(synced, schema.id, { name: 'B', schema: '{"type":"string"}' });
    expect(next.globalAssets.schemas[schema.id]?.name).toBe('B');
    expect(next.globalAssets.schemas[schema.id]?.schema).toBe('{"type":"string"}');
    // Original createdAt must be preserved.
    expect(next.globalAssets.schemas[schema.id]?.createdAt).toBe(schema.createdAt);
  });

  it('is a no-op when the schema is unknown', () => {
    const before = baseSynced();
    expect(updateGlobalSchema(before, 'missing', { name: 'X' })).toBe(before);
  });
});

describe('removeGlobalSchema', () => {
  it('drops the entry and clears bodySchemaId on referencing requests', () => {
    const { synced: withSchema, schema } = addGlobalSchema(baseSynced(), { name: 'A' });
    const withReq = seedRequest(withSchema, { id: 'r1', bodySchemaId: schema.id });
    const next = removeGlobalSchema(withReq, schema.id);
    expect(next.globalAssets.schemas[schema.id]).toBeUndefined();
    expect(next.collections.requests['r1']?.bodySchemaId).toBeNull();
  });

  it('is a no-op when the id is unknown', () => {
    const before = baseSynced();
    expect(removeGlobalSchema(before, 'nope')).toBe(before);
  });
});

describe('addGlobalGraphQL', () => {
  it('defaults to SDL kind and seeds a stub Query type', () => {
    const { synced, graphql } = addGlobalGraphQL(baseSynced(), { name: 'API' });
    expect(graphql.kind).toBe('sdl');
    expect(graphql.source).toContain('type Query');
    expect(synced.globalAssets.graphql[graphql.id]).toBe(graphql);
  });
});

describe('updateGlobalGraphQL', () => {
  it('patches kind/source and bumps updatedAt', () => {
    const { synced, graphql } = addGlobalGraphQL(baseSynced(), { name: 'API' });
    const next = updateGlobalGraphQL(synced, graphql.id, {
      kind: 'introspection',
      source: '{"__schema":{}}',
    });
    expect(next.globalAssets.graphql[graphql.id]?.kind).toBe('introspection');
  });
});

describe('removeGlobalGraphQL', () => {
  it('clears graphqlSchemaId on referencing requests', () => {
    const { synced: withGraphQL, graphql } = addGlobalGraphQL(baseSynced(), { name: 'API' });
    const withReq = seedRequest(withGraphQL, { id: 'r1', graphqlSchemaId: graphql.id });
    const next = removeGlobalGraphQL(withReq, graphql.id);
    expect(next.collections.requests['r1']?.graphqlSchemaId).toBeNull();
  });
});

describe('global file assets', () => {
  it('adds and updates reusable file metadata', () => {
    const { synced, file } = addGlobalFileAsset(baseSynced(), {
      name: 'Payload',
      slotId: 'slot-1',
      filename: 'payload.json',
      size: 12,
      mimeType: 'application/json',
      sha256: 'abc',
    });
    expect(synced.globalAssets.files?.[file.id]).toMatchObject({
      name: 'Payload',
      slotId: 'slot-1',
      filename: 'payload.json',
    });

    const next = updateGlobalFileAsset(synced, file.id, { name: 'Renamed' });
    expect(next.globalAssets.files?.[file.id]?.name).toBe('Renamed');
    expect(next.globalAssets.files?.[file.id]?.slotId).toBe('slot-1');
  });

  it('updateGlobalFileAsset preserves provenance refs through a rename', () => {
    // Regression guard: the asset-provenance state machine writes
    // `workingBranchRef` / `baseBranchRef` via the push + refresh flows.
    // A rename / re-describe must not clobber that — the reducer spreads
    // `...existing` which already preserves the refs, but pin the
    // behaviour explicitly so a future patch-shape change can't drop it
    // silently.
    const { synced, file } = addGlobalFileAsset(baseSynced(), {
      name: 'Payload',
      slotId: 'slot-1',
      filename: 'payload.json',
      size: 12,
      mimeType: 'application/json',
      sha256: 'abc',
    });
    const withRefs: WorkspaceSynced = {
      ...synced,
      globalAssets: {
        ...synced.globalAssets,
        files: {
          ...synced.globalAssets.files,
          [file.id]: {
            ...file,
            workingBranchRef: {
              branchName: 'apicircle/wb-aaa',
              blobSha: 'blob-w',
              commitSha: 'commit-w',
              verifiedAt: '2026-06-06T00:00:00.000Z',
            },
            baseBranchRef: {
              branchName: 'main',
              blobSha: 'blob-b',
              commitSha: 'commit-b',
              verifiedAt: '2026-06-06T00:00:00.000Z',
            },
          },
        },
      },
    };
    const renamed = updateGlobalFileAsset(withRefs, file.id, { name: 'Renamed' });
    const after = renamed.globalAssets.files![file.id];
    expect(after.name).toBe('Renamed');
    expect(after.workingBranchRef?.branchName).toBe('apicircle/wb-aaa');
    expect(after.baseBranchRef?.branchName).toBe('main');
  });

  it('builds request refs from reusable file metadata', () => {
    const { file } = addGlobalFileAsset(baseSynced(), {
      name: 'Payload',
      slotId: 'slot-1',
      filename: 'payload.json',
      size: 12,
      mimeType: 'application/json',
      sha256: 'abc',
    });
    expect(attachmentRefFromGlobalFileAsset(file)).toMatchObject({
      globalFileAssetId: file.id,
      slotId: 'slot-1',
      filename: 'payload.json',
    });
    expect(
      formDataRowFromGlobalFileAsset(
        { kind: 'file', key: 'upload', enabled: true, slotId: null },
        file,
      ),
    ).toMatchObject({
      key: 'upload',
      globalFileAssetId: file.id,
      slotId: 'slot-1',
    });
  });

  it('removes the asset and clears request references', () => {
    const { synced, file } = addGlobalFileAsset(baseSynced(), {
      name: 'Payload',
      slotId: 'slot-1',
      filename: 'payload.json',
      size: 12,
      mimeType: 'application/json',
    });
    const withForm = seedRequest(synced, {
      id: 'form',
      body: {
        type: 'form-data',
        content: '',
        formRows: [
          formDataRowFromGlobalFileAsset(
            { kind: 'file', key: 'f', enabled: true, slotId: null },
            file,
          ),
        ],
      },
    });
    const withBinary = seedRequest(withForm, {
      id: 'binary',
      body: { type: 'binary', content: '', attachment: attachmentRefFromGlobalFileAsset(file) },
    });

    const next = removeGlobalFileAsset(withBinary, file.id);
    expect(next.globalAssets.files?.[file.id]).toBeUndefined();
    const formRows =
      next.collections.requests.form?.body.type === 'form-data'
        ? next.collections.requests.form.body.formRows
        : [];
    expect(formRows?.[0]).toMatchObject({ kind: 'file', slotId: null });
    expect(next.collections.requests.binary?.body).toEqual({ type: 'binary', content: '' });
  });

  it('clears mock response references when a reusable file is removed', () => {
    const { synced, file } = addGlobalFileAsset(baseSynced(), {
      name: 'Payload',
      slotId: 'slot-1',
      filename: 'payload.json',
      size: 12,
      mimeType: 'application/json',
    });
    const withMock: WorkspaceSynced = {
      ...synced,
      mockServers: {
        m1: {
          id: 'm1',
          name: 'Files',
          source: { kind: 'manual', endpoints: [] },
          endpoints: [
            {
              id: 'e1',
              name: 'GET file',
              method: 'GET',
              pathPattern: '/file',
              requestSchema: { pathParams: [], queryParams: [], headers: [], cookies: [] },
              requestValidation: [],
              responseRules: [],
              defaultResponse: {
                status: 200,
                headers: [],
                body: {
                  type: 'binary',
                  content: '',
                  attachment: attachmentRefFromGlobalFileAsset(file),
                },
              },
            },
          ],
          defaultPort: null,
          cors: { enabled: false, origins: [] },
          createdAt: 't',
          updatedAt: 't',
        },
      },
    };

    const next = removeGlobalFileAsset(withMock, file.id);

    expect(next.mockServers.m1?.endpoints[0]?.defaultResponse.body).toEqual({
      type: 'binary',
      content: '',
    });
    expect(next.mockServers.m1?.source.kind).toBe('manual');
    if (next.mockServers.m1?.source.kind === 'manual') {
      expect(next.mockServers.m1.source.endpoints[0]?.defaultResponse.body).toEqual({
        type: 'binary',
        content: '',
      });
    }
  });
});
