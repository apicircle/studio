import { describe, expect, it } from 'vitest';
import type { WorkspaceSynced } from '@apicircle/shared';
import { putAttachment } from '../persistence/attachments';
import { resolveMockEndpoints } from './mockResolve';

const openapi = JSON.stringify({
  openapi: '3.0.0',
  info: { title: 'Petstore', version: '1.0' },
  paths: {
    '/pets': { get: { responses: { '200': { description: 'ok' } } } },
    '/pets/{id}': { get: { responses: { '200': { description: 'ok' } } } },
  },
});

const baseSynced = (files: WorkspaceSynced['globalAssets']['files'] = {}): WorkspaceSynced => ({
  schemaVersion: 1,
  workspaceId: 'ws-1',
  collections: { tree: { id: 'r', type: 'root', children: [] }, requests: {}, folders: {} },
  environments: { items: {}, activeName: null, priorityOrder: [] },
  linkedWorkspaces: {},
  linkedOverrides: { requests: {}, environmentVars: {} },
  releases: { self: null, perLink: {} },
  globalAssets: { schemas: {}, graphql: {}, files },
  mockServers: {},
  meta: { createdAt: 't', updatedAt: 't', appVersion: '0.1.0' },
});

async function seedAttachment(slotId: string): Promise<void> {
  await putAttachment({
    slotId,
    filename: 'petstore.json',
    mimeType: 'application/json',
    size: openapi.length,
    sha256: 'sha',
    savedAt: 't',
    bytes: new TextEncoder().encode(openapi),
  });
}

describe('resolveMockEndpoints', () => {
  it('returns the inline endpoints for a manual source', async () => {
    const out = await resolveMockEndpoints({ kind: 'manual', endpoints: [] }, baseSynced());
    expect(out).toEqual({ endpoints: [], warnings: [] });
  });

  it('resolves an openapi-asset source from IDB bytes and parses it', async () => {
    await seedAttachment('slot-1');
    const synced = baseSynced({
      a1: {
        id: 'a1',
        name: 'Petstore',
        slotId: 'slot-1',
        filename: 'petstore.json',
        size: openapi.length,
        mimeType: 'application/json',
        createdAt: 't',
        updatedAt: 't',
        spec: {
          dialect: 'openapi-3',
          format: 'json',
          operationCount: 2,
          parsedAt: 't',
          warnings: [],
        },
      },
    });
    const out = await resolveMockEndpoints(
      { kind: 'openapi-asset', assetId: 'a1', format: 'json', mode: 'linked' },
      synced,
    );
    expect(out.endpoints.length).toBe(2);
  });

  it('warns when the asset is not in the workspace', async () => {
    const out = await resolveMockEndpoints(
      { kind: 'openapi-asset', assetId: 'missing', format: 'json', mode: 'linked' },
      baseSynced(),
    );
    expect(out.endpoints).toEqual([]);
    expect(out.warnings[0]).toMatch(/was not found/);
  });

  it('warns when the asset bytes are not in IDB', async () => {
    const synced = baseSynced({
      a2: {
        id: 'a2',
        name: 'Gone',
        slotId: 'slot-absent',
        filename: 'gone.json',
        size: 1,
        mimeType: 'application/json',
        createdAt: 't',
        updatedAt: 't',
      },
    });
    const out = await resolveMockEndpoints(
      { kind: 'openapi-asset', assetId: 'a2', format: 'json', mode: 'materialized' },
      synced,
    );
    expect(out.endpoints).toEqual([]);
    expect(out.warnings[0]).toMatch(/not available locally/);
  });

  it('reads a split spec with its mapped files, and names one it could not read', async () => {
    const split = JSON.stringify({
      openapi: '3.0.0',
      info: { title: 'Split', version: '1' },
      paths: { '/pets': { $ref: 'pets.json' }, '/tags': { $ref: 'tags.json' } },
    });
    const put = (slotId: string, text: string) =>
      putAttachment({
        slotId,
        filename: `${slotId}.json`,
        mimeType: 'application/json',
        size: text.length,
        sha256: 'sha',
        savedAt: 't',
        bytes: new TextEncoder().encode(text),
      });
    await put('slot-split', split);
    await put(
      'slot-pets',
      JSON.stringify({ get: { responses: { '200': { description: 'ok' } } } }),
    );
    await put('slot-tags', '{ not json: [');
    const asset = (id: string, slotId: string) => ({
      id,
      name: id,
      slotId,
      filename: `${id}.json`,
      size: 1,
      mimeType: 'application/json',
      createdAt: 't',
      updatedAt: 't',
    });
    const synced = baseSynced({
      split: {
        ...asset('split', 'slot-split'),
        spec: {
          dialect: 'openapi-3',
          format: 'json',
          operationCount: 0,
          parsedAt: 't',
          warnings: [],
          externalRefs: [
            { target: 'pets.json', assetId: 'pets' },
            { target: 'tags.json', assetId: 'tags' },
          ],
        },
      },
      pets: asset('pets', 'slot-pets'),
      tags: asset('tags', 'slot-tags'),
    });
    const out = await resolveMockEndpoints(
      { kind: 'openapi-asset', assetId: 'split', format: 'json', mode: 'linked' },
      synced,
    );
    expect(out.endpoints.map((e) => e.pathPattern)).toEqual(['/pets']);
    // The bundler's finding comes first, then the parser names the path it skipped.
    expect(out.warnings[0]).toBe('Referenced file "tags.json" could not be read as JSON or YAML.');
    expect(out.warnings.some((w) => w.includes('path item for /tags'))).toBe(true);
  });
});
