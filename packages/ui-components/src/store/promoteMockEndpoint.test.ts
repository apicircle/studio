import { act } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { useWorkspaceStore } from './workspaceStore';

const store = () => useWorkspaceStore.getState();

async function seedManualMockWithEndpoint(): Promise<{ mockId: string; endpointId: string }> {
  let mockId = '';
  await act(async () => {
    const r = await store().createMockServer({
      name: 'API',
      source: { kind: 'manual', endpoints: [] },
    });
    mockId = r.id;
  });
  let endpointId = '';
  act(() => {
    endpointId = store().addMockEndpoint(mockId);
    store().updateMockEndpoint(mockId, endpointId, {
      method: 'POST',
      pathPattern: '/pets/{id}',
      requestSchema: {
        pathParams: [{ id: 'p1', name: 'id' }],
        queryParams: [{ id: 'q1', name: 'limit' }],
        headers: [{ id: 'h1', name: 'X-Key' }],
        cookies: [],
      },
    });
  });
  return { mockId, endpointId };
}

describe('promoteMockEndpointToRequest', () => {
  beforeEach(async () => {
    await act(async () => {
      await store().hydrate();
    });
  });

  it('creates a request with the env-templated URL, plus the Mock env + "<name> (mock)" folder', async () => {
    const { mockId, endpointId } = await seedManualMockWithEndpoint();
    let reqId: string | null = null;
    act(() => {
      reqId = store().promoteMockEndpointToRequest(mockId, endpointId);
    });
    expect(reqId).toBeTruthy();
    const s = store().synced!;
    const req = s.collections.requests[reqId!];
    expect(req.method).toBe('POST');
    expect(req.url).toBe('{{MOCK_BASE_URL}}:{{MOCK_PORT}}/pets/{id}');
    expect(req.query.some((q) => q.key === 'limit' && !q.enabled)).toBe(true);
    expect(req.headers.some((h) => h.key === 'X-Key')).toBe(true);
    expect(req.pathParams).toHaveProperty('id');

    // The shared "Mock" environment is created, active, and carries both vars
    // (MOCK_PORT falls back to 8080 for a mock with no port set).
    expect(s.environments.activeName).toBe('Mock');
    const env = s.environments.items['Mock'];
    expect(env.variables.find((v) => v.key === 'MOCK_BASE_URL')?.value).toBe('http://localhost');
    expect(env.variables.find((v) => v.key === 'MOCK_PORT')?.value).toBe('8080');

    // The request lands in an "API (mock)" folder.
    const folder = Object.values(s.collections.folders).find((f) => f.name === 'API (mock)');
    expect(folder).toBeTruthy();
    expect(req.folderId).toBe(folder!.id);
  });

  it('prefills MOCK_PORT from the server port when one is set', async () => {
    const { mockId, endpointId } = await seedManualMockWithEndpoint();
    act(() => {
      store().setMockServerDefaultPort(mockId, 4010);
    });
    act(() => {
      store().promoteMockEndpointToRequest(mockId, endpointId);
    });
    const env = store().synced!.environments.items['Mock'];
    expect(env.variables.find((v) => v.key === 'MOCK_PORT')?.value).toBe('4010');
  });

  it('reuses the same "<name> (mock)" folder for repeated single-endpoint promotes', async () => {
    const { mockId, endpointId } = await seedManualMockWithEndpoint();
    act(() => {
      store().promoteMockEndpointToRequest(mockId, endpointId);
      store().promoteMockEndpointToRequest(mockId, endpointId);
    });
    const folders = Object.values(store().synced!.collections.folders).filter(
      (f) => f.name === 'API (mock)',
    );
    expect(folders).toHaveLength(1);
  });

  it('promoteMockToCollection promotes every endpoint into one folder', async () => {
    const { mockId } = await seedManualMockWithEndpoint();
    act(() => {
      const ep2 = store().addMockEndpoint(mockId);
      store().updateMockEndpoint(mockId, ep2, { method: 'GET', pathPattern: '/pets' });
    });

    let res: { folderId: string; requests: number } | null = null;
    act(() => {
      res = store().promoteMockToCollection(mockId);
    });
    expect(res!.requests).toBe(2);
    const s = store().synced!;
    expect(s.collections.folders[res!.folderId].name).toBe('API (mock)');
    const reqs = Object.values(s.collections.requests).filter((r) => r.folderId === res!.folderId);
    expect(reqs).toHaveLength(2);
    expect(reqs.every((r) => r.url.startsWith('{{MOCK_BASE_URL}}:{{MOCK_PORT}}'))).toBe(true);
  });

  it('returns null for a missing mock or endpoint', () => {
    expect(store().promoteMockEndpointToRequest('no-mock', 'no-ep')).toBeNull();
    expect(store().promoteMockToCollection('no-mock')).toBeNull();
  });
});
