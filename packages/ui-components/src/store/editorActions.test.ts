import { describe, expect, it } from 'vitest';
import { createEmptyWorkspace } from '../persistence/workspaceStorage';
import {
  addFolder,
  addRequest,
  removeRequest,
  renameRequest,
  setRequestAssertions,
  setRequestBody,
  setRequestHeaders,
  setRequestMethod,
  setRequestQuery,
  setRequestUrl,
  updateRequest,
} from './editorActions';

describe('editorActions', () => {
  describe('addRequest', () => {
    it('adds a new request to the tree and the requests map', () => {
      const { synced } = createEmptyWorkspace();
      const { synced: next, request } = addRequest(synced, null);
      expect(next.collections.requests[request.id]).toBeDefined();
      expect(next.collections.tree.children).toContainEqual({ kind: 'request', id: request.id });
      expect(request.method).toBe('GET');
      expect(request.body).toEqual({ type: 'none', content: '' });
    });

    it('bumps meta.updatedAt', () => {
      const { synced } = createEmptyWorkspace();
      const { synced: next } = addRequest(synced, null);
      expect(new Date(next.meta.updatedAt).getTime()).toBeGreaterThanOrEqual(
        new Date(synced.meta.updatedAt).getTime(),
      );
    });
  });

  describe('addFolder', () => {
    it('adds a folder with the given name', () => {
      const { synced } = createEmptyWorkspace();
      const { synced: next, folder } = addFolder(synced, null, 'Auth');
      expect(next.collections.folders[folder.id]).toEqual({
        id: folder.id,
        name: 'Auth',
        parentId: null,
      });
    });
    it('uses default name when none given', () => {
      const { synced } = createEmptyWorkspace();
      const { folder } = addFolder(synced, null);
      expect(folder.name).toBe('New folder');
    });
  });

  describe('removeRequest', () => {
    it('removes the request from map and tree', () => {
      const { synced } = createEmptyWorkspace();
      const { synced: withReq, request } = addRequest(synced, null);
      const cleaned = removeRequest(withReq, request.id);
      expect(cleaned.collections.requests[request.id]).toBeUndefined();
      expect(cleaned.collections.tree.children).not.toContainEqual({
        kind: 'request',
        id: request.id,
      });
    });

    it('is a no-op for unknown ids', () => {
      const { synced } = createEmptyWorkspace();
      const result = removeRequest(synced, 'unknown');
      expect(result).toBe(synced);
    });
  });

  describe('updateRequest / renameRequest / setters', () => {
    function seed() {
      const { synced } = createEmptyWorkspace();
      const { synced: with1, request } = addRequest(synced, null);
      return { synced: with1, id: request.id };
    }

    it('updateRequest patches the request and bumps updatedAt', async () => {
      const { synced, id } = seed();
      const before = synced.collections.requests[id].updatedAt;
      await new Promise((r) => setTimeout(r, 5));
      const next = updateRequest(synced, id, { name: 'List users' });
      expect(next.collections.requests[id].name).toBe('List users');
      expect(new Date(next.collections.requests[id].updatedAt).getTime()).toBeGreaterThanOrEqual(
        new Date(before).getTime(),
      );
    });

    it('updateRequest is a no-op for unknown ids', () => {
      const { synced } = seed();
      const result = updateRequest(synced, 'unknown', { name: 'x' });
      expect(result).toBe(synced);
    });

    it('renameRequest delegates to updateRequest', () => {
      const { synced, id } = seed();
      const next = renameRequest(synced, id, 'Hello');
      expect(next.collections.requests[id].name).toBe('Hello');
    });

    it('setters update each field', () => {
      const { synced, id } = seed();
      const a = setRequestMethod(synced, id, 'POST');
      expect(a.collections.requests[id].method).toBe('POST');
      const b = setRequestUrl(a, id, 'https://example.org');
      expect(b.collections.requests[id].url).toBe('https://example.org');
      const c = setRequestBody(b, id, { type: 'json', content: '{}' });
      expect(c.collections.requests[id].body).toEqual({ type: 'json', content: '{}' });
      const d = setRequestHeaders(c, id, [{ key: 'X', value: 'y', enabled: true }]);
      expect(d.collections.requests[id].headers).toEqual([{ key: 'X', value: 'y', enabled: true }]);
      const e = setRequestQuery(d, id, [{ key: 'q', value: '1', enabled: true }]);
      expect(e.collections.requests[id].query).toEqual([{ key: 'q', value: '1', enabled: true }]);
      const f = setRequestAssertions(e, id, [
        { id: 'a1', kind: 'status', op: 'equals', expected: 200 },
      ]);
      expect(f.collections.requests[id].assertions).toHaveLength(1);
    });
  });
});
