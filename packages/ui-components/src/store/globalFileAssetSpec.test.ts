import { act } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { useWorkspaceStore } from './workspaceStore';

// Parse-on-upload, exercised through the real store thunks (fake-indexeddb).
// Uploading an OpenAPI/Swagger file populates `asset.spec`; re-uploading a
// non-spec file over it clears the summary.

const openapi = JSON.stringify({
  openapi: '3.0.0',
  info: { title: 'Petstore', version: '1.0' },
  paths: {
    '/pets': { get: { responses: { '200': {} } }, post: { responses: { '201': {} } } },
  },
});

const specFile = (): File => new File([openapi], 'petstore.json', { type: 'application/json' });
const pngFile = (): File =>
  new File([new Uint8Array([1, 2, 3])], 'logo.png', { type: 'image/png' });

describe('workspaceStore parse-on-upload', () => {
  beforeEach(async () => {
    await act(async () => {
      await useWorkspaceStore.getState().hydrate();
    });
  });

  it('populates asset.spec when an OpenAPI file is uploaded', async () => {
    let id = '';
    await act(async () => {
      id = await useWorkspaceStore.getState().addGlobalFileAsset(specFile());
    });
    const asset = useWorkspaceStore.getState().synced?.globalAssets.files?.[id];
    expect(asset?.spec?.dialect).toBe('openapi-3');
    expect(asset?.spec?.operationCount).toBe(2);
    expect(asset?.spec?.title).toBe('Petstore');
    expect(asset?.spec?.parsedAt).toBeTruthy();
  });

  it('leaves spec undefined for a binary upload', async () => {
    let id = '';
    await act(async () => {
      id = await useWorkspaceStore.getState().addGlobalFileAsset(pngFile());
    });
    expect(useWorkspaceStore.getState().synced?.globalAssets.files?.[id]?.spec).toBeUndefined();
  });

  it('re-parses and clears spec when non-spec bytes replace a spec', async () => {
    let id = '';
    await act(async () => {
      id = await useWorkspaceStore.getState().addGlobalFileAsset(specFile());
    });
    expect(useWorkspaceStore.getState().synced?.globalAssets.files?.[id]?.spec).toBeDefined();

    await act(async () => {
      await useWorkspaceStore.getState().fillGlobalFileAssetBytes(id, pngFile());
    });
    expect(useWorkspaceStore.getState().synced?.globalAssets.files?.[id]?.spec).toBeUndefined();
  });
});
