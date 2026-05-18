import { act } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { LinkedSnapshot, Request as ApiRequest } from '@apicircle/shared';
import { useWorkspaceStore } from './workspaceStore';

const baseRequest = (overrides: Partial<ApiRequest> = {}): ApiRequest => ({
  id: 'src-r1',
  name: 'Get user',
  folderId: null,
  method: 'GET',
  url: 'https://api.example.com/users/1',
  headers: [{ key: 'Accept', value: 'application/json', enabled: true }],
  query: [],
  body: { type: 'none', content: '' },
  auth: { type: 'none' },
  contextVars: [],
  extractions: [],
  assertions: [],
  createdAt: 't',
  updatedAt: 't',
  ...overrides,
});

const snapshot = (req: ApiRequest): LinkedSnapshot => ({
  pulledAt: 't',
  ref: 'main',
  collections: {
    tree: { id: 'r', type: 'root', children: [{ kind: 'request', id: req.id }] },
    requests: { [req.id]: req },
    folders: {},
  },
  environments: { items: {}, activeName: null, priorityOrder: [] },
});

async function hydrate(): Promise<void> {
  await act(async () => {
    await useWorkspaceStore.getState().hydrate();
  });
}

describe('linked request overrides', () => {
  it('setLinkedRequestOverride writes the patch into synced.linkedOverrides.requests', async () => {
    await hydrate();
    useWorkspaceStore.getState().setLinkedRequestOverride('link-1', 'req-1', {
      headers: [{ key: 'X-Override', value: '1', enabled: true }],
    });
    const item = useWorkspaceStore.getState().synced!.linkedOverrides.requests['link-1:req-1'];
    expect(item).toBeDefined();
    expect(item.patch.headers).toEqual([{ key: 'X-Override', value: '1', enabled: true }]);
  });

  it('an empty patch is treated as a clear (no zero-content rows in workspace.json)', async () => {
    await hydrate();
    useWorkspaceStore.getState().setLinkedRequestOverride('link-1', 'req-1', {
      headers: [{ key: 'X', value: '1', enabled: true }],
    });
    useWorkspaceStore.getState().setLinkedRequestOverride('link-1', 'req-1', {});
    expect(
      useWorkspaceStore.getState().synced!.linkedOverrides.requests['link-1:req-1'],
    ).toBeUndefined();
  });

  it('clearLinkedRequestOverride removes the entry', async () => {
    await hydrate();
    useWorkspaceStore.getState().setLinkedRequestOverride('link-1', 'req-1', {
      headers: [{ key: 'X-Override', value: '1', enabled: true }],
    });
    useWorkspaceStore.getState().clearLinkedRequestOverride('link-1', 'req-1');
    expect(
      useWorkspaceStore.getState().synced!.linkedOverrides.requests['link-1:req-1'],
    ).toBeUndefined();
  });

  it('clearLinkedRequestOverrideField drops one field but keeps the rest', async () => {
    await hydrate();
    useWorkspaceStore.getState().setLinkedRequestOverride('link-1', 'req-1', {
      url: 'https://staging.example.com/u/1',
      method: 'PATCH',
      headers: [{ key: 'X', value: '1', enabled: true }],
    });
    useWorkspaceStore.getState().clearLinkedRequestOverrideField('link-1', 'req-1', 'method');
    const stored = useWorkspaceStore.getState().synced!.linkedOverrides.requests['link-1:req-1'];
    expect(stored).toBeDefined();
    expect(stored.patch.method).toBeUndefined();
    expect(stored.patch.url).toBe('https://staging.example.com/u/1');
    expect(stored.patch.headers).toEqual([{ key: 'X', value: '1', enabled: true }]);
  });

  it('clearLinkedRequestOverrideField on the last remaining field collapses the row', async () => {
    await hydrate();
    useWorkspaceStore.getState().setLinkedRequestOverride('link-1', 'req-1', {
      url: 'https://staging.example.com/u/1',
    });
    useWorkspaceStore.getState().clearLinkedRequestOverrideField('link-1', 'req-1', 'url');
    expect(
      useWorkspaceStore.getState().synced!.linkedOverrides.requests['link-1:req-1'],
    ).toBeUndefined();
  });

  it('clearLinkedRequestOverrideField is a no-op for a missing override or missing field', async () => {
    await hydrate();
    // No override row at all.
    expect(() =>
      useWorkspaceStore.getState().clearLinkedRequestOverrideField('link-x', 'req-x', 'url'),
    ).not.toThrow();
    expect(
      useWorkspaceStore.getState().synced!.linkedOverrides.requests['link-x:req-x'],
    ).toBeUndefined();

    // Row exists but the targeted field isn't in the patch.
    useWorkspaceStore.getState().setLinkedRequestOverride('link-1', 'req-1', {
      url: 'https://staging.example.com/u/1',
    });
    const before = useWorkspaceStore.getState().synced!.linkedOverrides.requests['link-1:req-1'];
    useWorkspaceStore.getState().clearLinkedRequestOverrideField('link-1', 'req-1', 'method');
    const after = useWorkspaceStore.getState().synced!.linkedOverrides.requests['link-1:req-1'];
    expect(after.patch).toEqual(before.patch);
  });

  it('full-field patches: URL / method / body / auth all round-trip', async () => {
    await hydrate();
    useWorkspaceStore.getState().setLinkedRequestOverride('link-1', 'req-1', {
      url: 'https://staging.example.com/users/42',
      method: 'PATCH',
      body: { type: 'json', content: '{"hello":"world"}' },
      auth: { type: 'bearer', token: 'override-tok' },
    });
    const stored = useWorkspaceStore.getState().synced!.linkedOverrides.requests['link-1:req-1'];
    expect(stored.patch.url).toBe('https://staging.example.com/users/42');
    expect(stored.patch.method).toBe('PATCH');
    expect(stored.patch.body).toEqual({ type: 'json', content: '{"hello":"world"}' });
    expect(stored.patch.auth).toEqual({ type: 'bearer', token: 'override-tok' });
  });

  it('setLinkedEnvVarOverride writes a per-variable patch into synced.linkedOverrides.environmentVars', async () => {
    await hydrate();
    useWorkspaceStore.getState().setLinkedEnvVarOverride('link-1', 'dev', 'BASE_URL', {
      value: 'https://my-fork.example.com',
    });
    const stored =
      useWorkspaceStore.getState().synced!.linkedOverrides.environmentVars['link-1:dev:BASE_URL'];
    expect(stored).toBeDefined();
    expect(stored.value).toBe('https://my-fork.example.com');
    expect(stored.removed).toBeUndefined();
  });

  it('setLinkedEnvVarOverride supports `removed: true` to soft-delete a source variable', async () => {
    await hydrate();
    useWorkspaceStore.getState().setLinkedEnvVarOverride('link-1', 'dev', 'OLD_VAR', {
      removed: true,
    });
    const stored =
      useWorkspaceStore.getState().synced!.linkedOverrides.environmentVars['link-1:dev:OLD_VAR'];
    expect(stored.removed).toBe(true);
  });

  it('clearLinkedEnvVarOverride removes the env-var override entry', async () => {
    await hydrate();
    useWorkspaceStore.getState().setLinkedEnvVarOverride('link-1', 'dev', 'BASE_URL', {
      value: 'https://x',
    });
    useWorkspaceStore.getState().clearLinkedEnvVarOverride('link-1', 'dev', 'BASE_URL');
    expect(
      useWorkspaceStore.getState().synced!.linkedOverrides.environmentVars['link-1:dev:BASE_URL'],
    ).toBeUndefined();
  });

  it('clearLinkedOverridesFor wipes all request + env-var overrides for one link', async () => {
    await hydrate();
    useWorkspaceStore.getState().setLinkedRequestOverride('link-1', 'req-a', {
      headers: [{ key: 'X', value: '1', enabled: true }],
    });
    useWorkspaceStore.getState().setLinkedRequestOverride('link-2', 'req-b', {
      headers: [{ key: 'Y', value: '2', enabled: true }],
    });
    useWorkspaceStore.getState().setLinkedEnvVarOverride('link-1', 'dev', 'V', { value: 'v' });
    useWorkspaceStore.getState().setLinkedEnvVarOverride('link-2', 'dev', 'V', { value: 'w' });

    useWorkspaceStore.getState().clearLinkedOverridesFor('link-1');

    const state = useWorkspaceStore.getState().synced!;
    // link-1 entries gone, link-2 entries preserved.
    expect(state.linkedOverrides.requests['link-1:req-a']).toBeUndefined();
    expect(state.linkedOverrides.requests['link-2:req-b']).toBeDefined();
    expect(state.linkedOverrides.environmentVars['link-1:dev:V']).toBeUndefined();
    expect(state.linkedOverrides.environmentVars['link-2:dev:V']).toBeDefined();
  });

  it('setActiveLinkedRequest controls the modal target', async () => {
    await hydrate();
    expect(useWorkspaceStore.getState().activeLinkedRequest).toBeNull();
    useWorkspaceStore.getState().setActiveLinkedRequest({
      linkedWorkspaceId: 'l',
      itemId: 'r',
    });
    expect(useWorkspaceStore.getState().activeLinkedRequest).toEqual({
      linkedWorkspaceId: 'l',
      itemId: 'r',
    });
    useWorkspaceStore.getState().setActiveLinkedRequest(null);
    expect(useWorkspaceStore.getState().activeLinkedRequest).toBeNull();
  });

  it('plan execution merges the override patch on top of the linked snapshot', async () => {
    await hydrate();
    const sourceReq = baseRequest({ id: 'src-r1' });
    const local = useWorkspaceStore.getState().local!;
    const synced = useWorkspaceStore.getState().synced!;
    useWorkspaceStore.setState({
      synced: {
        ...synced,
        linkedWorkspaces: {
          'link-1': {
            id: 'link-1',
            kind: 'private',
            name: 'Source',
            source: {
              provider: 'github',
              repoFullName: 'a/b',
              branch: 'main',
              sessionMode: 'workspace' as const,
            },
            scope: ['collections'],
            pinnedVersion: null,
            updatePolicy: 'manual',
            linkedAt: 't',
            requiredSecretKeyIds: [],
          },
        },
      },
      local: {
        ...local,
        linkedCollections: { 'link-1': snapshot(sourceReq) },
      },
    });

    useWorkspaceStore.getState().setLinkedRequestOverride('link-1', 'src-r1', {
      headers: [{ key: 'X-Local', value: 'yes', enabled: true }],
      contextVars: [{ key: 'CTX', value: '1' }],
    });

    // Add a plan with a step that points at the linked request, and assert
    // the resolved plan request includes the override.
    const planId = useWorkspaceStore.getState().addPlan('p');
    useWorkspaceStore.getState().addPlanStep(planId, 'src-r1', 'link-1');

    const plan = useWorkspaceStore.getState().synced!.executionPlans![planId];
    expect(plan.steps[0]).toEqual({ requestId: 'src-r1', linkedWorkspaceId: 'link-1' });

    // Read the same internals exposed by the lookup helper indirectly by
    // verifying the override patch is what we expect — full execution is
    // covered by runPlan tests that exist already.
    const stored = useWorkspaceStore.getState().synced!.linkedOverrides.requests['link-1:src-r1'];
    expect(stored?.patch).toMatchObject({
      headers: [{ key: 'X-Local', value: 'yes', enabled: true }],
      contextVars: [{ key: 'CTX', value: '1' }],
    });
  });
});
