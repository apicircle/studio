import { act } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { useWorkspaceStore } from './workspaceStore';

// End-to-end (fake-indexeddb) coverage of "mock two modes off a spec asset":
// create linked vs materialized, read-only guards on linked mocks,
// refreshMockServer, and auto-refresh of linked mocks when the asset changes.

const specJson = (paths: string[]): string =>
  JSON.stringify({
    openapi: '3.0.0',
    info: { title: 'Petstore', version: '1.0' },
    paths: Object.fromEntries(
      paths.map((p) => [p, { get: { responses: { '200': { description: 'ok' } } } }]),
    ),
  });

const specFile = (paths: string[]): File =>
  new File([specJson(paths)], 'petstore.json', { type: 'application/json' });

const store = () => useWorkspaceStore.getState();

async function uploadSpec(paths: string[]): Promise<string> {
  let id = '';
  await act(async () => {
    id = await store().addGlobalFileAsset(specFile(paths));
  });
  return id;
}

async function createAssetMock(assetId: string, mode: 'linked' | 'materialized'): Promise<string> {
  let id = '';
  await act(async () => {
    const r = await store().createMockServer({
      name: `mock-${mode}-${assetId.slice(0, 4)}`,
      source: { kind: 'openapi-asset', assetId, format: 'json', mode },
    });
    id = r.id;
  });
  return id;
}

describe('mock two modes off a spec asset', () => {
  beforeEach(async () => {
    await act(async () => {
      await store().hydrate();
    });
  });

  it('materializes endpoints and records the source for a linked mock', async () => {
    const assetId = await uploadSpec(['/pets', '/pets/{id}']);
    const mockId = await createAssetMock(assetId, 'linked');
    const mock = store().synced?.mockServers[mockId];
    expect(mock?.endpoints.length).toBe(2);
    expect(mock?.source).toMatchObject({ kind: 'openapi-asset', assetId, mode: 'linked' });
  });

  it('makes linked mocks read-only (endpoint mutations no-op)', async () => {
    const assetId = await uploadSpec(['/pets']);
    const mockId = await createAssetMock(assetId, 'linked');
    const before = store().synced?.mockServers[mockId]?.endpoints.length ?? 0;

    act(() => {
      store().addMockEndpoint(mockId);
    });
    const epId = store().synced?.mockServers[mockId]?.endpoints[0]?.id ?? '';
    act(() => {
      store().updateMockEndpoint(mockId, epId, { name: 'hacked' });
      store().removeMockEndpoint(mockId, epId);
      store().duplicateMockEndpoint(mockId, epId);
      store().setMockServerEndpoints(mockId, []);
    });

    const after = store().synced?.mockServers[mockId];
    expect(after?.endpoints.length).toBe(before);
    expect(after?.endpoints[0]?.name).not.toBe('hacked');
  });

  it('allows editing a materialized mock', async () => {
    const assetId = await uploadSpec(['/pets']);
    const mockId = await createAssetMock(assetId, 'materialized');
    expect(store().synced?.mockServers[mockId]?.endpoints.length).toBe(1);
    act(() => {
      store().addMockEndpoint(mockId);
    });
    expect(store().synced?.mockServers[mockId]?.endpoints.length).toBe(2);
  });

  it('auto-refreshes a linked mock when the spec asset changes', async () => {
    const assetId = await uploadSpec(['/pets']);
    const mockId = await createAssetMock(assetId, 'linked');
    expect(store().synced?.mockServers[mockId]?.endpoints.length).toBe(1);

    // Re-upload a richer spec into the same asset.
    await act(async () => {
      await store().fillGlobalFileAssetBytes(assetId, specFile(['/pets', '/pets/{id}', '/owners']));
    });
    expect(store().synced?.mockServers[mockId]?.endpoints.length).toBe(3);
  });

  it('refreshMockServer re-derives endpoints and returns warnings', async () => {
    const assetId = await uploadSpec(['/pets', '/pets/{id}']);
    const mockId = await createAssetMock(assetId, 'materialized');
    const res = await store().refreshMockServer(mockId);
    expect(Array.isArray(res.warnings)).toBe(true);
    expect(store().synced?.mockServers[mockId]?.endpoints.length).toBe(2);
  });

  it('refreshMockServer is a no-op for an unknown id', async () => {
    const res = await store().refreshMockServer('no-such');
    expect(res).toEqual({ warnings: [] });
  });

  it('converts a linked mock to editable (materialized), preserving endpoints + spec link', async () => {
    const assetId = await uploadSpec(['/pets', '/pets/{id}']);
    const mockId = await createAssetMock(assetId, 'linked');
    expect(store().synced?.mockServers[mockId]?.endpoints.length).toBe(2);

    act(() => {
      store().convertMockToEditable(mockId);
    });

    const mock = store().synced?.mockServers[mockId];
    // Same spec link, mode flipped to materialized, endpoints preserved.
    expect(mock?.source).toMatchObject({ kind: 'openapi-asset', assetId, mode: 'materialized' });
    expect(mock?.endpoints.length).toBe(2);
    // Now editable — endpoint mutations take effect (were no-ops while linked).
    act(() => {
      store().addMockEndpoint(mockId);
    });
    expect(store().synced?.mockServers[mockId]?.endpoints.length).toBe(3);
  });

  it('convertMockToEditable is a no-op for unknown ids, manual, and already-materialized mocks', async () => {
    // Unknown id — no throw, nothing created.
    act(() => {
      store().convertMockToEditable('no-such');
    });

    let manualId = '';
    await act(async () => {
      const r = await store().createMockServer({
        name: 'manual',
        source: { kind: 'manual', endpoints: [] },
      });
      manualId = r.id;
    });
    act(() => {
      store().convertMockToEditable(manualId);
    });
    expect(store().synced?.mockServers[manualId]?.source.kind).toBe('manual');

    const assetId = await uploadSpec(['/pets']);
    const matId = await createAssetMock(assetId, 'materialized');
    act(() => {
      store().convertMockToEditable(matId);
    });
    expect(store().synced?.mockServers[matId]?.source).toMatchObject({
      kind: 'openapi-asset',
      mode: 'materialized',
    });
  });

  it('reuploadMockSpec replaces the spec bytes and re-derives a linked mock', async () => {
    const assetId = await uploadSpec(['/pets']);
    const mockId = await createAssetMock(assetId, 'linked');
    expect(store().synced?.mockServers[mockId]?.endpoints.length).toBe(1);

    await act(async () => {
      await store().reuploadMockSpec(mockId, specFile(['/pets', '/pets/{id}', '/owners']));
    });

    // Endpoints re-derived from the revised spec + the asset summary re-parsed.
    expect(store().synced?.mockServers[mockId]?.endpoints.length).toBe(3);
    expect(store().synced?.globalAssets.files?.[assetId]?.spec?.operationCount).toBe(3);
  });

  it('reuploadMockSpec is a no-op for a non-spec-asset (manual) mock', async () => {
    let manualId = '';
    await act(async () => {
      const r = await store().createMockServer({
        name: 'manual',
        source: { kind: 'manual', endpoints: [] },
      });
      manualId = r.id;
    });
    await act(async () => {
      await store().reuploadMockSpec(manualId, specFile(['/pets']));
    });
    expect(store().synced?.mockServers[manualId]?.source.kind).toBe('manual');
    expect(store().synced?.mockServers[manualId]?.endpoints.length).toBe(0);
  });

  it('reuploadMockSpec rejects a non-spec file and leaves the mock + asset unchanged', async () => {
    const assetId = await uploadSpec(['/pets']);
    const mockId = await createAssetMock(assetId, 'linked');
    expect(store().synced?.mockServers[mockId]?.endpoints.length).toBe(1);

    // A JSON file with no openapi/swagger key is not a spec.
    const notASpec = new File([JSON.stringify({ hello: 'world' })], 'notes.json', {
      type: 'application/json',
    });
    await act(async () => {
      await store().reuploadMockSpec(mockId, notASpec);
    });

    // Untouched: endpoints preserved, the asset keeps its original spec summary.
    expect(store().synced?.mockServers[mockId]?.endpoints.length).toBe(1);
    expect(store().synced?.globalAssets.files?.[assetId]?.spec?.operationCount).toBe(1);
  });
});
