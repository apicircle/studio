import { act } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { useWorkspaceStore } from './workspaceStore';

const spec = JSON.stringify({
  openapi: '3.0.0',
  info: { title: 'Petstore', version: '1.0' },
  paths: {
    '/pets': {
      get: {
        parameters: [{ name: 'limit', in: 'query' }],
        responses: { '200': { description: 'ok' } },
      },
    },
    '/pets/{id}': {
      delete: {
        parameters: [{ name: 'id', in: 'path', required: true }],
        responses: { '204': { description: 'gone' } },
      },
    },
  },
});

const store = () => useWorkspaceStore.getState();

describe('importOpenApiToCollection', () => {
  beforeEach(async () => {
    await act(async () => {
      await store().hydrate();
    });
  });

  it('creates a folder + one request per operation, with source back-refs', async () => {
    let res: { folderId: string | null; requests: number; warnings: string[] } = {
      folderId: null,
      requests: 0,
      warnings: [],
    };
    await act(async () => {
      res = await store().importOpenApiToCollection({
        spec,
        format: 'json',
        specAssetId: 'asset-1',
        title: 'Petstore',
      });
    });

    expect(res.requests).toBe(2);
    expect(res.folderId).toBeTruthy();

    const imported = Object.values(store().synced!.collections.requests).filter(
      (r) => r.folderId === res.folderId,
    );
    expect(imported).toHaveLength(2);
    // Every imported request carries the source back-refs.
    expect(imported.every((r) => r.specAssetId === 'asset-1')).toBe(true);

    const get = imported.find((r) => r.url === '/pets');
    expect(get?.method).toBe('GET');
    expect(get?.operationId).toBe('GET /pets');
    expect(get?.query.some((q) => q.key === 'limit' && !q.enabled)).toBe(true);

    const del = imported.find((r) => r.url === '/pets/{id}');
    expect(del?.method).toBe('DELETE');
    expect(del?.operationId).toBe('DELETE /pets/{id}');
    expect(del?.pathParams).toHaveProperty('id');
  });

  it('creates an empty folder (0 requests) for a spec with no operations', async () => {
    const empty = JSON.stringify({ openapi: '3.0.0', info: { title: 'Empty' }, paths: {} });
    let res: { folderId: string | null; requests: number; warnings: string[] } = {
      folderId: null,
      requests: 0,
      warnings: [],
    };
    await act(async () => {
      res = await store().importOpenApiToCollection({ spec: empty, format: 'json' });
    });
    expect(res.requests).toBe(0);
    expect(res.folderId).toBeTruthy();
  });
});
