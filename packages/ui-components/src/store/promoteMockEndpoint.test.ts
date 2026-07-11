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

  it('creates a request from a mock endpoint (method + path + params)', async () => {
    const { mockId, endpointId } = await seedManualMockWithEndpoint();
    let reqId: string | null = null;
    act(() => {
      reqId = store().promoteMockEndpointToRequest(mockId, endpointId);
    });
    expect(reqId).toBeTruthy();
    const req = store().synced!.collections.requests[reqId!];
    expect(req.method).toBe('POST');
    expect(req.url).toBe('/pets/{id}');
    expect(req.query.some((q) => q.key === 'limit' && !q.enabled)).toBe(true);
    expect(req.headers.some((h) => h.key === 'X-Key')).toBe(true);
    expect(req.pathParams).toHaveProperty('id');
  });

  it('returns null for a missing mock or endpoint', () => {
    expect(store().promoteMockEndpointToRequest('no-mock', 'no-ep')).toBeNull();
  });
});
