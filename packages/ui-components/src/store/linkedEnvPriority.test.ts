import { act } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import type { LinkedSnapshot, LinkedWorkspace } from '@apicircle/shared';
import { useWorkspaceStore } from './workspaceStore';

// Linked envs as first-class members of the priority order. Verifies:
//   - setPriorityOrder accepts a linked-ref entry
//   - resolveRequest's flat env map exposes the linked env under
//     `linked:<id>:<name>` and substitutes its plaintext at send time
//   - removing the priority entry stops the substitution

const T0 = '2026-04-27T00:00:00.000Z';

function makeLink(id: string): LinkedWorkspace {
  return {
    id,
    kind: 'private',
    name: `Linked-${id}`,
    source: {
      provider: 'github',
      repoFullName: `acme/${id}`,
      branch: 'main',
      sessionMode: 'workspace',
    },
    scope: ['environments'],
    pinnedVersion: '1.0.0',
    updatePolicy: 'manual',
    linkedAt: T0,
    requiredSecretKeyIds: [],
  };
}

function makeSnapshotWithEnv(envName: string, value: string): LinkedSnapshot {
  return {
    workspaceName: 'Source',
    pulledAt: T0,
    ref: 'v1.0.0',
    collections: { tree: { id: 'r', type: 'root', children: [] }, requests: {}, folders: {} },
    environments: {
      items: {
        [envName]: {
          name: envName,
          variables: [{ key: 'API_TOKEN', value, encrypted: false }],
        },
      },
      activeName: null,
      priorityOrder: [],
    },
  };
}

describe('linked envs in priority order', () => {
  beforeEach(async () => {
    await act(async () => {
      await useWorkspaceStore.getState().hydrate();
    });
  });

  it('accepts a linked ref via setPriorityOrder and resolves it at send time', async () => {
    // Seed a linked workspace with a `prod` env containing API_TOKEN.
    const linkId = 'lw-acme';
    await act(async () => {
      const synced = useWorkspaceStore.getState().synced!;
      const local = useWorkspaceStore.getState().local!;
      useWorkspaceStore.setState({
        synced: { ...synced, linkedWorkspaces: { [linkId]: makeLink(linkId) } },
        local: {
          ...local,
          linkedCollections: { [linkId]: makeSnapshotWithEnv('prod', 'linked-token') },
        },
      });
      // Add the linked env to the workspace's priority order.
      useWorkspaceStore
        .getState()
        .setPriorityOrder([{ kind: 'linked', linkedWorkspaceId: linkId, envName: 'prod' }]);
    });

    // Stub fetch and execute a request that references {{API_TOKEN}}.
    let calledUrl = '';
    const origFetch = globalThis.fetch;
    globalThis.fetch = (async (url: RequestInfo | URL) => {
      calledUrl = typeof url === 'string' ? url : url instanceof URL ? url.toString() : url.url;
      return new Response('{}', { status: 200 });
    }) as typeof fetch;

    try {
      await act(async () => {
        const id = useWorkspaceStore.getState().addRequest(null);
        useWorkspaceStore.getState().setRequestUrl(id, 'https://example.test/?t={{API_TOKEN}}');
        useWorkspaceStore.getState().setActiveRequestId(id);
        await useWorkspaceStore.getState().executeActiveRequest();
      });
    } finally {
      globalThis.fetch = origFetch;
    }

    // The linked env's value flowed through the priority chain.
    expect(calledUrl).toContain('t=linked-token');
    expect(calledUrl).not.toContain('{{API_TOKEN}}');
  });

  it('persists priority order containing both local and linked entries through addEnvironment', async () => {
    // Seed a link first so linked-env refs are resolvable.
    const linkId = 'lw-1';
    await act(async () => {
      const synced = useWorkspaceStore.getState().synced!;
      const local = useWorkspaceStore.getState().local!;
      useWorkspaceStore.setState({
        synced: { ...synced, linkedWorkspaces: { [linkId]: makeLink(linkId) } },
        local: {
          ...local,
          linkedCollections: { [linkId]: makeSnapshotWithEnv('staging', 'val') },
        },
      });
      // Add a linked env to the priority list, then add a local env. The
      // local env should append at the tail without disturbing the linked
      // entry.
      useWorkspaceStore
        .getState()
        .setPriorityOrder([{ kind: 'linked', linkedWorkspaceId: linkId, envName: 'staging' }]);
      useWorkspaceStore.getState().addEnvironment('dev');
    });
    const order = useWorkspaceStore.getState().synced!.environments.priorityOrder;
    expect(order).toEqual([
      { kind: 'linked', linkedWorkspaceId: linkId, envName: 'staging' },
      { kind: 'local', name: 'dev' },
    ]);
  });

  it('removing a linked workspace leaves stale refs in priorityOrder but the resolver skips them', async () => {
    const linkId = 'lw-stale';
    await act(async () => {
      const synced = useWorkspaceStore.getState().synced!;
      const local = useWorkspaceStore.getState().local!;
      useWorkspaceStore.setState({
        synced: { ...synced, linkedWorkspaces: { [linkId]: makeLink(linkId) } },
        local: {
          ...local,
          linkedCollections: { [linkId]: makeSnapshotWithEnv('prod', 'linked-val') },
        },
      });
      useWorkspaceStore
        .getState()
        .setPriorityOrder([{ kind: 'linked', linkedWorkspaceId: linkId, envName: 'prod' }]);
    });
    // Drop the snapshot — simulates link unlinked while the priority entry
    // still references it. setPriorityOrder won't filter it (linked refs
    // pass through; the snapshot isn't visible to the reducer).
    await act(async () => {
      const local = useWorkspaceStore.getState().local!;
      const collections = { ...local.linkedCollections };
      delete collections[linkId];
      useWorkspaceStore.setState({ local: { ...local, linkedCollections: collections } });
    });

    let calledUrl = '';
    const origFetch = globalThis.fetch;
    globalThis.fetch = (async (url: RequestInfo | URL) => {
      calledUrl = typeof url === 'string' ? url : url instanceof URL ? url.toString() : url.url;
      return new Response('{}', { status: 200 });
    }) as typeof fetch;
    try {
      await act(async () => {
        const id = useWorkspaceStore.getState().addRequest(null);
        useWorkspaceStore.getState().setRequestUrl(id, 'https://example.test/?t={{API_TOKEN}}');
        useWorkspaceStore.getState().setActiveRequestId(id);
        await useWorkspaceStore.getState().executeActiveRequest();
      });
    } finally {
      globalThis.fetch = origFetch;
    }
    // No env to resolve API_TOKEN against — the placeholder stays as-is.
    expect(calledUrl).toContain('{{API_TOKEN}}');
  });
});
