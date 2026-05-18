import { describe, expect, it } from 'vitest';
import { createEmptyWorkspace } from '../persistence/workspaceStorage';
import { addFolder, addRequest, duplicateFolder, duplicateRequest } from './editorActions';
import { duplicateMockEndpoint, duplicateMockServer } from './mockActions';

// Pure-reducer tests for the new duplicate actions. Mirror the
// envActions.test.ts shape: build up a workspace via the public API,
// run the duplicator, assert the resulting tree.

describe('duplicateRequest', () => {
  it('clones a request inside the same folder with a fresh id and "(copy)" name', () => {
    const { synced } = createEmptyWorkspace();
    const { synced: a, request } = addRequest(synced, null, 'Original');
    const { synced: b, request: clone } = duplicateRequest(a, request.id);
    expect(clone).not.toBeNull();
    expect(clone!.id).not.toBe(request.id);
    expect(clone!.name).toBe('Original (copy)');
    expect(clone!.folderId).toBe(request.folderId);
    expect(b.collections.requests[clone!.id]).toBeDefined();
    expect(b.collections.requests[request.id]).toBeDefined();
  });

  it('uniquifies the name when a copy already exists', () => {
    const { synced } = createEmptyWorkspace();
    const { synced: a, request } = addRequest(synced, null, 'Original');
    const { synced: b } = duplicateRequest(a, request.id);
    const { synced: c, request: third } = duplicateRequest(b, request.id);
    expect(third!.name).toBe('Original (copy) (2)');
    void c;
  });

  it('returns null + unchanged synced when the source id does not exist', () => {
    const { synced } = createEmptyWorkspace();
    const { synced: next, request } = duplicateRequest(synced, 'no-such');
    expect(request).toBeNull();
    expect(next).toBe(synced);
  });

  it('does not share array references between the original and the clone', () => {
    const { synced } = createEmptyWorkspace();
    const { synced: a, request } = addRequest(synced, null, 'Original');
    const { synced: b, request: clone } = duplicateRequest(a, request.id);
    expect(clone!.headers).not.toBe(b.collections.requests[request.id].headers);
    expect(clone!.assertions).not.toBe(b.collections.requests[request.id].assertions);
  });
});

describe('duplicateFolder', () => {
  it('clones a folder along with its descendants and re-ids everything', () => {
    const { synced } = createEmptyWorkspace();
    const { synced: a, folder: parent } = addFolder(synced, null, 'Parent');
    const { synced: b, folder: child } = addFolder(a, parent.id, 'Child');
    const { synced: c, request: nested } = addRequest(b, child.id, 'Nested');
    const { synced: d, folder: clone } = duplicateFolder(c, parent.id);

    expect(clone).not.toBeNull();
    expect(clone!.id).not.toBe(parent.id);
    expect(clone!.name).toBe('Parent (copy)');
    expect(clone!.parentId).toBe(parent.parentId);

    // Find the cloned descendants by name + lineage, since their ids are fresh.
    const clonedChildren = Object.values(d.collections.folders).filter(
      (f) => f.parentId === clone!.id,
    );
    expect(clonedChildren).toHaveLength(1);
    expect(clonedChildren[0].id).not.toBe(child.id);

    const clonedNested = Object.values(d.collections.requests).filter(
      (r) => r.folderId === clonedChildren[0].id,
    );
    expect(clonedNested).toHaveLength(1);
    expect(clonedNested[0].id).not.toBe(nested.id);
    // Original tree stays intact.
    expect(d.collections.folders[parent.id]).toBeDefined();
    expect(d.collections.folders[child.id]).toBeDefined();
    expect(d.collections.requests[nested.id]).toBeDefined();
  });

  it('returns null when the source folder does not exist', () => {
    const { synced } = createEmptyWorkspace();
    const { synced: next, folder } = duplicateFolder(synced, 'no-such');
    expect(folder).toBeNull();
    expect(next).toBe(synced);
  });
});

describe('duplicateMockServer', () => {
  function withMockServer() {
    const { synced } = createEmptyWorkspace();
    const id = 's1';
    const next = {
      ...synced,
      mockServers: {
        [id]: {
          id,
          name: 'Petstore',
          source: { kind: 'manual' as const, endpoints: [] },
          endpoints: [
            {
              id: 'e1',
              name: 'GET /pets',
              method: 'GET' as const,
              pathPattern: '/pets',
              requestSchema: { pathParams: [], queryParams: [], headers: [], cookies: [] },
              requestValidation: [
                {
                  id: 'v1',
                  kind: 'header-required' as const,
                  target: 'authorization',
                  enabled: true,
                  failResponse: {
                    status: 401,
                    headers: [],
                    body: { type: 'json' as const, content: '{}' },
                  },
                },
              ],
              responseRules: [
                {
                  id: 'rr1',
                  name: 'admin',
                  enabled: true,
                  when: [
                    {
                      id: 'c1',
                      scope: 'header' as const,
                      target: 'X-Role',
                      op: 'equals' as const,
                      value: 'admin',
                    },
                  ],
                  response: {
                    status: 200,
                    headers: [],
                    body: { type: 'json' as const, content: '{"admin":true}' },
                    multipliers: [
                      {
                        id: 'mu1',
                        source: { kind: 'query' as const, key: 'pageSize' },
                        targetJsonPath: '$.items',
                        defaultCount: 3,
                      },
                    ],
                  },
                },
              ],
              defaultResponse: {
                status: 200,
                headers: [],
                body: { type: 'json' as const, content: '[]' },
              },
            },
          ],
          // overrides removed in Phase 4 cleanup — the legacy field is gone.
          defaultPort: null,
          cors: { enabled: false, origins: [] },
          createdAt: 't',
          updatedAt: 't',
        },
      },
    };
    return next;
  }

  it('clones every nested entity with fresh ids', () => {
    const synced = withMockServer();
    const { synced: next, server: clone } = duplicateMockServer(synced, 's1');
    expect(clone).not.toBeNull();
    expect(clone!.id).not.toBe('s1');
    expect(clone!.name).toBe('Petstore (copy)');
    expect(clone!.endpoints).toHaveLength(1);
    expect(clone!.endpoints[0].id).not.toBe('e1');
    expect(clone!.endpoints[0].requestValidation[0].id).not.toBe('v1');
    expect(clone!.endpoints[0].responseRules[0].id).not.toBe('rr1');
    expect(clone!.endpoints[0].responseRules[0].when[0].id).not.toBe('c1');
    expect(clone!.endpoints[0].responseRules[0].response.multipliers![0].id).not.toBe('mu1');
    expect(next.mockServers['s1']).toBeDefined();
    expect(next.mockServers[clone!.id]).toBe(clone);
  });

  it('returns null + unchanged synced when the source id does not exist', () => {
    const synced = withMockServer();
    const result = duplicateMockServer(synced, 'no-such');
    expect(result.server).toBeNull();
    expect(result.synced).toBe(synced);
  });
});

describe('duplicateMockEndpoint', () => {
  function withMockServer() {
    const { synced } = createEmptyWorkspace();
    const id = 's1';
    const endpointId = 'e1';
    return {
      ...synced,
      mockServers: {
        [id]: {
          id,
          name: 'Petstore',
          source: { kind: 'manual' as const, endpoints: [] },
          endpoints: [
            {
              id: endpointId,
              name: 'GET /pets',
              method: 'GET' as const,
              pathPattern: '/pets',
              requestSchema: { pathParams: [], queryParams: [], headers: [], cookies: [] },
              requestValidation: [],
              responseRules: [
                {
                  id: 'rr1',
                  name: 'X',
                  enabled: true,
                  when: [
                    { id: 'c1', scope: 'query' as const, target: 'q', op: 'present' as const },
                  ],
                  response: {
                    status: 200,
                    headers: [],
                    body: { type: 'json' as const, content: '[]' },
                  },
                },
              ],
              defaultResponse: {
                status: 200,
                headers: [],
                body: { type: 'json' as const, content: '[]' },
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
  }

  it('clones an endpoint inside the same server with a uniquified name', () => {
    const synced = withMockServer();
    const { synced: next, endpoint } = duplicateMockEndpoint(synced, 's1', 'e1');
    expect(endpoint).not.toBeNull();
    expect(endpoint!.id).not.toBe('e1');
    expect(endpoint!.name).toBe('GET /pets (copy)');
    const server = next.mockServers['s1'];
    expect(server.endpoints).toHaveLength(2);
    expect(server.endpoints.find((e) => e.id === 'e1')).toBeDefined();
    expect(server.endpoints.find((e) => e.id === endpoint!.id)).toBeDefined();
  });

  it('mirrors cloned endpoints into source.endpoints for manual mocks', () => {
    const synced = withMockServer();
    const { synced: next } = duplicateMockEndpoint(synced, 's1', 'e1');
    const server = next.mockServers['s1'];
    if (server.source.kind === 'manual') {
      expect(server.source.endpoints).toHaveLength(2);
    } else {
      throw new Error('expected manual source');
    }
  });

  it('returns null when the endpoint does not exist', () => {
    const synced = withMockServer();
    const result = duplicateMockEndpoint(synced, 's1', 'no-such');
    expect(result.endpoint).toBeNull();
    expect(result.synced).toBe(synced);
  });
});
