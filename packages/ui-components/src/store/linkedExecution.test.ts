import { act } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Folder, LinkedSnapshot, Request as ApiRequest } from '@apicircle/shared';
import { useWorkspaceStore } from './workspaceStore';

const T0 = '2026-04-27T00:00:00.000Z';

function makeRequest(opts: Partial<ApiRequest> = {}): ApiRequest {
  return {
    id: 'src-r1',
    name: 'Get user',
    folderId: null,
    method: 'GET',
    url: 'https://api.example.test/users/1',
    headers: [],
    query: [],
    body: { type: 'none', content: '' },
    auth: { type: 'none' },
    contextVars: [],
    extractions: [],
    assertions: [],
    createdAt: T0,
    updatedAt: T0,
    ...opts,
  };
}

function makeSnapshot(args: {
  request: ApiRequest;
  folders?: Record<string, Folder>;
  envVars?: Array<{ key: string; value: string }>;
}): LinkedSnapshot {
  return {
    workspaceName: 'Source',
    pulledAt: T0,
    ref: 'v1.0.0',
    collections: {
      tree: { id: 'r', type: 'root', children: [{ kind: 'request', id: args.request.id }] },
      requests: { [args.request.id]: args.request },
      folders: args.folders ?? {},
    },
    environments: args.envVars
      ? {
          items: {
            dev: {
              name: 'dev',
              variables: args.envVars.map((v) => ({ ...v, encrypted: false })),
            },
          },
          activeName: 'dev',
          priorityOrder: ['dev'],
        }
      : { items: {}, activeName: null, priorityOrder: [] },
  };
}

async function hydrate(): Promise<void> {
  await act(async () => {
    await useWorkspaceStore.getState().hydrate();
  });
}

function seedLink(snapshot: LinkedSnapshot): void {
  const synced = useWorkspaceStore.getState().synced!;
  const local = useWorkspaceStore.getState().local!;
  useWorkspaceStore.setState({
    synced: {
      ...synced,
      linkedWorkspaces: {
        'lw-1': {
          id: 'lw-1',
          kind: 'private',
          name: 'Source',
          source: { provider: 'github', repoFullName: 'a/b', branch: 'main' },
          scope: ['collections', 'environments'],
          pinnedVersion: '1.0.0',
          updatePolicy: 'manual',
          linkedAt: T0,
          requiredSecretKeyIds: [],
        },
      },
    },
    local: { ...local, linkedCollections: { 'lw-1': snapshot } },
    activeLinkedRequest: { linkedWorkspaceId: 'lw-1', itemId: 'src-r1' },
  });
}

describe('executeLinkedActiveRequest', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    await hydrate();
    fetchMock = vi.fn(
      async () =>
        new Response('{"ok":true}', {
          status: 200,
          statusText: 'OK',
          headers: { 'content-type': 'application/json' },
        }),
    );
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => vi.unstubAllGlobals());

  it('records a run when the linked request resolves successfully', async () => {
    seedLink(makeSnapshot({ request: makeRequest() }));
    await useWorkspaceStore.getState().executeLinkedActiveRequest();
    const runs = useWorkspaceStore.getState().local!.history.requestRuns;
    expect(runs).toHaveLength(1);
    expect(runs[0].requestId).toBe('src-r1');
    expect(useWorkspaceStore.getState().lastRun['src-r1']?.ok).toBe(true);
  });

  it('walks the SOURCE folder chain for auth.type === "inherit" (not the consumer’s)', async () => {
    // Source structure: folder F has bearer auth, request lives inside F
    // and inherits.  The consumer’s folders dictionary has nothing —
    // a buggy implementation would fall through to no auth.
    const sourceFolder: Folder = {
      id: 'src-f1',
      name: 'Authed folder',
      parentId: null,
      auth: { type: 'bearer', token: 'src-bearer-token' },
    };
    const req = makeRequest({
      id: 'src-r1',
      folderId: 'src-f1',
      auth: { type: 'inherit' },
    });
    seedLink(
      makeSnapshot({
        request: req,
        folders: { 'src-f1': sourceFolder },
      }),
    );

    await useWorkspaceStore.getState().executeLinkedActiveRequest();

    const callArgs = fetchMock.mock.calls[0];
    const init = callArgs[1] as RequestInit;
    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer src-bearer-token');
  });

  it('applies a request-level URL override on top of the linked snapshot', async () => {
    const req = makeRequest({ url: 'https://api.example.test/prod-only' });
    seedLink(makeSnapshot({ request: req }));
    useWorkspaceStore.getState().setLinkedRequestOverride('lw-1', 'src-r1', {
      url: 'https://staging.example.test/v2',
    });

    await useWorkspaceStore.getState().executeLinkedActiveRequest();

    const url = fetchMock.mock.calls[0][0] as string;
    expect(url).toBe('https://staging.example.test/v2');
  });

  it('resolves {{VAR}} from the SOURCE env (not the consumer’s)', async () => {
    const req = makeRequest({ url: '{{BASE_URL}}/users/1' });
    seedLink(
      makeSnapshot({
        request: req,
        envVars: [{ key: 'BASE_URL', value: 'https://from-source.example.test' }],
      }),
    );

    await useWorkspaceStore.getState().executeLinkedActiveRequest();

    const url = fetchMock.mock.calls[0][0] as string;
    expect(url).toBe('https://from-source.example.test/users/1');
  });

  it('applies a per-variable env override on top of the source env at resolve time', async () => {
    const req = makeRequest({ url: '{{BASE_URL}}/users/1' });
    seedLink(
      makeSnapshot({
        request: req,
        envVars: [{ key: 'BASE_URL', value: 'https://from-source.example.test' }],
      }),
    );
    useWorkspaceStore.getState().setLinkedEnvVarOverride('lw-1', 'dev', 'BASE_URL', {
      value: 'https://my-fork.example.test',
    });

    await useWorkspaceStore.getState().executeLinkedActiveRequest();

    const url = fetchMock.mock.calls[0][0] as string;
    expect(url).toBe('https://my-fork.example.test/users/1');
  });

  it('records a typed error result when the snapshot is missing', async () => {
    // No seedLink call → snapshot is missing for an active linked request.
    useWorkspaceStore.setState({
      activeLinkedRequest: { linkedWorkspaceId: 'unknown-link', itemId: 'src-r1' },
    });
    await useWorkspaceStore.getState().executeLinkedActiveRequest();
    const lastRun = useWorkspaceStore.getState().lastRun['src-r1'];
    expect(lastRun?.ok).toBe(false);
    expect(lastRun?.statusText).toMatch(/Linked workspace was unlinked/);
  });
});
