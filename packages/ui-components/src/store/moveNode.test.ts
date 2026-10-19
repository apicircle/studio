import { act } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { createEmptyWorkspace } from '../persistence/workspaceStorage';
import { addFolder, addRequest, movePatch, moveRefusal } from './editorActions';
import { useWorkspaceStore } from './workspaceStore';

// "Move to…" in the Editor sidebar (STU-UX-8): the rules for where a request or
// a folder may go, and the store actions that move one through the same
// `applyMutation` patches a headless writer sends.

describe('moveRefusal', () => {
  function tree() {
    const { synced } = createEmptyWorkspace();
    const { synced: a, folder: users } = addFolder(synced, null, 'Users');
    const { synced: b, folder: admin } = addFolder(a, users.id, 'Admin');
    const { synced: c, folder: orders } = addFolder(b, null, 'Orders');
    const { synced: d, request: list } = addRequest(c, users.id, 'List');
    const { synced: e, request: top } = addRequest(d, null, 'Health');
    const { synced: f } = addRequest(e, orders.id, 'list');
    return { synced: f, users, admin, orders, list, top };
  }

  it('lets a request go to another folder or the top level', () => {
    const { synced, list, orders, top, users } = tree();
    expect(moveRefusal(synced, { kind: 'request', id: top.id }, users.id)).toBeNull();
    expect(moveRefusal(synced, { kind: 'request', id: list.id }, null)).toBeNull();
    void orders;
  });

  it('says where it already is', () => {
    const { synced, list, users, admin } = tree();
    expect(moveRefusal(synced, { kind: 'request', id: list.id }, users.id)).toBe(
      'The request is here now.',
    );
    expect(moveRefusal(synced, { kind: 'folder', id: admin.id }, users.id)).toBe(
      'The folder is here now.',
    );
  });

  it('refuses a name already used there, whatever its case', () => {
    const { synced, list, orders } = tree();
    expect(moveRefusal(synced, { kind: 'request', id: list.id }, orders.id)).toBe(
      'A request named “List” is already there.',
    );
  });

  it('refuses to put a folder inside itself or anything under it', () => {
    const { synced, users, admin } = tree();
    expect(moveRefusal(synced, { kind: 'folder', id: users.id }, users.id)).toBe(
      'A folder can’t go inside itself.',
    );
    expect(moveRefusal(synced, { kind: 'folder', id: users.id }, admin.id)).toBe(
      'A folder can’t go inside itself.',
    );
  });

  it('lets a folder go anywhere else, the top level included', () => {
    const { synced, admin, orders } = tree();
    expect(moveRefusal(synced, { kind: 'folder', id: admin.id }, orders.id)).toBeNull();
    expect(moveRefusal(synced, { kind: 'folder', id: admin.id }, null)).toBeNull();
  });

  it('refuses what no longer exists, on either side', () => {
    const { synced, list } = tree();
    expect(moveRefusal(synced, { kind: 'request', id: 'gone' }, null)).toBe(
      'This request no longer exists.',
    );
    expect(moveRefusal(synced, { kind: 'request', id: list.id }, 'gone')).toBe(
      'That folder no longer exists.',
    );
  });

  it('ends on a malformed loop of parents instead of walking it forever', () => {
    const { synced, users } = tree();
    const looped = {
      ...synced,
      collections: {
        ...synced.collections,
        folders: {
          ...synced.collections.folders,
          x: { id: 'x', name: 'X', parentId: 'y' },
          y: { id: 'y', name: 'Y', parentId: 'x' },
        },
      },
    };
    expect(moveRefusal(looped, { kind: 'folder', id: users.id }, 'x')).toBeNull();
  });
});

describe('movePatch', () => {
  it('moves a request by its folder id and a folder by its parent', () => {
    expect(movePatch({ kind: 'request', id: 'r' }, 'f')).toEqual({
      kind: 'request.update',
      id: 'r',
      patch: { folderId: 'f' },
    });
    expect(movePatch({ kind: 'folder', id: 'f' }, null)).toEqual({
      kind: 'folder.move',
      id: 'f',
      newParentId: null,
    });
  });
});

describe('moveRequest / moveFolder', () => {
  beforeEach(async () => {
    await act(async () => {
      await useWorkspaceStore.getState().hydrate();
    });
  });

  const collections = () => useWorkspaceStore.getState().synced!.collections;
  const atTop = () => collections().tree.children.map((c) => `${c.kind}:${c.id}`);

  it('moves a request into a folder and back out, keeping the top-level list in step', () => {
    const store = useWorkspaceStore.getState();
    const folderId = store.addFolder(null, 'Users');
    const requestId = store.addRequest(null, 'List users');
    expect(atTop()).toContain(`request:${requestId}`);

    expect(useWorkspaceStore.getState().moveRequest(requestId, folderId)).toBe(true);
    expect(collections().requests[requestId].folderId).toBe(folderId);
    expect(atTop()).not.toContain(`request:${requestId}`);

    expect(useWorkspaceStore.getState().moveRequest(requestId, null)).toBe(true);
    expect(collections().requests[requestId].folderId).toBeNull();
    expect(atTop()).toContain(`request:${requestId}`);
  });

  it('moves a folder under another one, and refuses to move it inside itself', () => {
    const store = useWorkspaceStore.getState();
    const users = store.addFolder(null, 'Users');
    const admin = store.addFolder(users, 'Admin');
    const orders = store.addFolder(null, 'Orders');

    expect(useWorkspaceStore.getState().moveFolder(users, admin)).toBe(false);
    expect(collections().folders[users].parentId).toBeNull();

    expect(useWorkspaceStore.getState().moveFolder(users, orders)).toBe(true);
    expect(collections().folders[users].parentId).toBe(orders);
    // What was inside moves with it.
    expect(collections().folders[admin].parentId).toBe(users);
    expect(atTop()).not.toContain(`folder:${users}`);
  });

  it('changes nothing where a name is taken, and nothing before a workspace has loaded', () => {
    const store = useWorkspaceStore.getState();
    const orders = store.addFolder(null, 'Orders');
    store.addRequest(orders, 'List');
    const requestId = store.addRequest(null, 'list');
    const before = useWorkspaceStore.getState().synced;
    expect(useWorkspaceStore.getState().moveRequest(requestId, orders)).toBe(false);
    expect(useWorkspaceStore.getState().synced).toBe(before);

    useWorkspaceStore.setState({ synced: null });
    expect(useWorkspaceStore.getState().moveRequest(requestId, null)).toBe(false);
    useWorkspaceStore.setState({ synced: before, local: null });
    expect(useWorkspaceStore.getState().moveFolder(orders, null)).toBe(false);
  });
});
