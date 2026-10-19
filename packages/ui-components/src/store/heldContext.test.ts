import { act } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LinkedSnapshot, Request as ApiRequest } from '@apicircle/shared';
import { useWorkspaceStore } from './workspaceStore';
import { flushPendingPersist } from '../persistence/debouncedPersist';
import { LOCAL_STORE, readRecord } from '../persistence/db';
import * as workspaceSharing from '../layout/workspaceSharing';

// Extracted values that look like credentials are held in memory
// (`heldContext`) and never reach `local.globalContext` — so never IndexedDB
// or the disk mirror — while later requests still resolve them.

const TOKEN = 'login-token-value';

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    statusText: 'OK',
    headers: { 'content-type': 'application/json' },
  });
}

/** `/login` answers with `accessToken` (default: the token); anything else
 *  echoes the request body. */
function stubFetch(loginTokens: string[] = [TOKEN]): ReturnType<typeof vi.fn> {
  let logins = 0;
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (url.includes('/login')) {
      const accessToken = loginTokens[Math.min(logins++, loginTokens.length - 1)];
      return json({ data: { access_token: accessToken, id: '42' } });
    }
    return json({ echo: typeof init?.body === 'string' ? init.body : null });
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function headerOf(call: unknown[], name: string): string | null {
  const init = call[1] as RequestInit | undefined;
  return new Headers(init?.headers).get(name);
}

async function hydrate(): Promise<void> {
  await act(async () => {
    await useWorkspaceStore.getState().hydrate();
  });
}

function addLogin(): string {
  const s = useWorkspaceStore.getState();
  const id = s.addRequest(null);
  s.setRequestUrl(id, 'https://api.test/login');
  s.setRequestExtractions(id, [
    { id: 'x1', variable: 'AUTH', source: 'body', path: 'data.access_token', enabled: true },
    { id: 'x2', variable: 'USER_ID', source: 'body', path: 'data.id', enabled: true },
  ]);
  return id;
}

function addUse(): string {
  const s = useWorkspaceStore.getState();
  const id = s.addRequest(null);
  s.setRequestMethod(id, 'POST');
  s.setRequestUrl(id, 'https://api.test/me?u={{USER_ID}}');
  s.setRequestHeaders(id, [{ key: 'Authorization', value: 'Bearer {{AUTH}}', enabled: true }]);
  s.setRequestBody(id, { type: 'json', content: '{"t":"{{AUTH}}"}' });
  return id;
}

async function send(id: string): Promise<void> {
  useWorkspaceStore.getState().setActiveRequestId(id);
  await act(async () => {
    await useWorkspaceStore.getState().executeActiveRequest();
  });
}

/** The raw IndexedDB record of the active workspace's device-local half —
 *  read past the load normalizer, which would drop a leaked value. */
async function storedLocal(): Promise<string> {
  await flushPendingPersist();
  const record = await readRecord(LOCAL_STORE, useWorkspaceStore.getState().synced!.workspaceId);
  expect(record).not.toBeNull();
  return JSON.stringify(record);
}

describe('held extracted values', () => {
  beforeEach(hydrate);
  afterEach(() => vi.unstubAllGlobals());

  it('holds a credential capture in memory, saves the rest, and sends it on', async () => {
    const fetchMock = stubFetch();
    const login = addLogin();
    const use = addUse();

    await send(login);

    const state = useWorkspaceStore.getState();
    expect(state.local!.globalContext).toEqual({ USER_ID: '42' });
    expect(state.heldContext).toEqual({
      AUTH: { value: TOKEN, reason: 'named like a credential' },
    });
    // The record is the real one: the saved capture is in it, the held one is not.
    const stored = await storedLocal();
    expect(stored).toContain('"USER_ID":"42"');
    expect(stored).not.toContain(TOKEN);

    await send(use);

    const call = fetchMock.mock.calls[1];
    expect(call[0]).toBe('https://api.test/me?u=42');
    expect(headerOf(call, 'authorization')).toBe(`Bearer ${TOKEN}`);
    expect(call[1]?.body).toBe(`{"t":"${TOKEN}"}`);
    // The run that sent it keeps no copy, even in a body field named `t`.
    const [useRun] = useWorkspaceStore.getState().local!.history.requestRuns;
    expect(useRun.requestBodyPreview).toBe('{"t":"[hidden]"}');
    expect(JSON.stringify(useWorkspaceStore.getState().local)).not.toContain(TOKEN);
    expect(await storedLocal()).not.toContain(TOKEN);
  });

  it('moves a variable between the two places as its captured value changes', async () => {
    stubFetch(['no', TOKEN, 'no']);
    const login = addLogin();

    await send(login);
    expect(useWorkspaceStore.getState().local!.globalContext.AUTH).toBe('no');
    expect(useWorkspaceStore.getState().heldContext).toEqual({});

    await send(login);
    expect(useWorkspaceStore.getState().local!.globalContext).not.toHaveProperty('AUTH');
    expect(useWorkspaceStore.getState().heldContext.AUTH?.value).toBe(TOKEN);

    await send(login);
    expect(useWorkspaceStore.getState().local!.globalContext.AUTH).toBe('no');
    expect(useWorkspaceStore.getState().heldContext).toEqual({});
  });

  it('captures again on a replay', async () => {
    stubFetch(['first-token-1', 'second-token-2']);
    const login = addLogin();
    await send(login);
    const runId = useWorkspaceStore.getState().local!.history.requestRuns[0].id;

    await act(async () => {
      await useWorkspaceStore.getState().replayRequestRun(runId);
    });

    expect(useWorkspaceStore.getState().heldContext.AUTH?.value).toBe('second-token-2');
    expect(JSON.stringify(useWorkspaceStore.getState().local)).not.toContain('second-token-2');
  });

  it('carries a held value between plan steps and keeps it out of the saved half', async () => {
    const fetchMock = stubFetch();
    const login = addLogin();
    const use = addUse();
    const s = useWorkspaceStore.getState();
    const planId = s.addPlan('Login then use');
    s.addPlanStep(planId, login);
    s.addPlanStep(planId, use);

    await act(async () => {
      await useWorkspaceStore.getState().runPlan(planId);
    });

    expect(headerOf(fetchMock.mock.calls[1], 'authorization')).toBe(`Bearer ${TOKEN}`);
    expect(useWorkspaceStore.getState().heldContext.AUTH?.value).toBe(TOKEN);
    expect(useWorkspaceStore.getState().local!.globalContext).toEqual({ USER_ID: '42' });
    expect(await storedLocal()).not.toContain(TOKEN);
  });

  it('holds the capture of a linked request too', async () => {
    vi.spyOn(workspaceSharing, 'isWorkspaceSharingEnabled').mockReturnValue(true);
    stubFetch();
    const request: ApiRequest = {
      id: 'src-login',
      name: 'Login',
      folderId: null,
      method: 'POST',
      url: 'https://api.test/login',
      headers: [],
      query: [],
      body: { type: 'none', content: '' },
      auth: { type: 'none' },
      contextVars: [],
      extractions: [
        { id: 'x1', variable: 'AUTH', source: 'body', path: 'data.access_token', enabled: true },
      ],
      assertions: [],
      createdAt: 't',
      updatedAt: 't',
    };
    const snapshot: LinkedSnapshot = {
      pulledAt: 't',
      ref: 'v1.0.0',
      collections: {
        tree: { id: 'r', type: 'root', children: [{ kind: 'request', id: request.id }] },
        requests: { [request.id]: request },
        folders: {},
      },
      environments: { items: {}, activeName: null, priorityOrder: [] },
    };
    const { synced, local } = useWorkspaceStore.getState();
    useWorkspaceStore.setState({
      synced: {
        ...synced!,
        linkedWorkspaces: {
          'lw-1': {
            id: 'lw-1',
            kind: 'private',
            name: 'Source',
            sourceWorkspaceId: 'src-ws',
            source: {
              provider: 'github',
              repoFullName: 'a/b',
              branch: 'main',
              sessionMode: 'workspace',
            },
            scope: ['collections', 'environments'],
            pinnedVersion: '1.0.0',
            updatePolicy: 'manual',
            linkedAt: 't',
            requiredSecretKeyIds: [],
          },
        },
      },
      local: { ...local!, linkedCollections: { 'lw-1': snapshot } },
      activeLinkedRequest: { linkedWorkspaceId: 'lw-1', itemId: request.id },
    });

    await act(async () => {
      await useWorkspaceStore.getState().executeLinkedActiveRequest();
    });

    expect(useWorkspaceStore.getState().heldContext.AUTH?.value).toBe(TOKEN);
    expect(JSON.stringify(useWorkspaceStore.getState().local)).not.toContain(TOKEN);
  });

  it('forgets a held value with the saved ones', async () => {
    stubFetch();
    await send(addLogin());

    act(() => useWorkspaceStore.getState().removeGlobalContextKey('AUTH'));
    expect(useWorkspaceStore.getState().heldContext).toEqual({});
    expect(useWorkspaceStore.getState().local!.globalContext).toEqual({ USER_ID: '42' });

    // Unknown everywhere: nothing changes.
    const before = useWorkspaceStore.getState().local;
    act(() => useWorkspaceStore.getState().removeGlobalContextKey('NOPE'));
    expect(useWorkspaceStore.getState().local).toBe(before);

    await send(useWorkspaceStore.getState().local!.ui.activeRequestId!);
    act(() => useWorkspaceStore.getState().clearGlobalContext());
    expect(useWorkspaceStore.getState().heldContext).toEqual({});
    expect(useWorkspaceStore.getState().local!.globalContext).toEqual({});
  });

  it('forgets held values when another workspace opens', async () => {
    stubFetch();
    const firstId = useWorkspaceStore.getState().synced!.workspaceId;
    await send(addLogin());
    expect(useWorkspaceStore.getState().heldContext).not.toEqual({});

    await act(async () => {
      await useWorkspaceStore.getState().createNewWorkspace('Second');
    });
    expect(useWorkspaceStore.getState().heldContext).toEqual({});

    useWorkspaceStore.setState({
      heldContext: { AUTH: { value: TOKEN, reason: 'named like a credential' } },
    });
    await act(async () => {
      await useWorkspaceStore.getState().switchWorkspace(firstId);
    });
    expect(useWorkspaceStore.getState().heldContext).toEqual({});

    useWorkspaceStore.setState({
      heldContext: { AUTH: { value: TOKEN, reason: 'named like a credential' } },
    });
    await act(async () => {
      await useWorkspaceStore.getState().resetWorkspace();
    });
    expect(useWorkspaceStore.getState().heldContext).toEqual({});
  });
});
