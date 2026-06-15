import { act } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useWorkspaceStore } from './workspaceStore';
import { getSecretPayload } from '../persistence/secrets';

// Per-link session model:
//   - LinkedWorkspace.source.sessionMode picks 'workspace' | 'dedicated'
//   - 'dedicated' looks up local.sessions.github.links[linkedWorkspaceId]
//   - addLinkSession verifies + stores the per-link PAT and flips the mode
//   - removeLinkSession drops the dedicated entry but does NOT auto-flip
//     the mode (the link card surfaces a "remap" affordance instead)
//
// These tests drive the store actions directly with mocked fetch — they're
// the contract the link wizard / link card UI builds on top of.

interface RspSpec {
  body: unknown;
  status?: number;
  headers?: Record<string, string>;
}

function rsp(spec: RspSpec): Response {
  return new Response(JSON.stringify(spec.body), {
    status: spec.status ?? 200,
    statusText: 'OK',
    headers: { 'content-type': 'application/json', ...(spec.headers ?? {}) },
  });
}

function queuedFetch(queue: RspSpec[]): ReturnType<typeof vi.fn> {
  let i = 0;
  return vi.fn(async () => {
    if (i >= queue.length) throw new Error(`unexpected fetch call #${i + 1}`);
    return rsp(queue[i++]);
  });
}

/** ID used for the remote workspace in registry.json mocks. */
const REMOTE_WS_ID = 'remote-ws';

function registryContents(): RspSpec {
  const json = JSON.stringify({
    schemaVersion: 1,
    activeWorkspaceId: REMOTE_WS_ID,
    workspaces: [{ id: REMOTE_WS_ID }],
  });
  const content = btoa(unescape(encodeURIComponent(json)));
  return {
    body: {
      type: 'file',
      path: '.apicircle/registry.json',
      sha: 'registry-sha',
      size: json.length,
      content,
      encoding: 'base64',
    },
  };
}

function fileContents(json: string, sha = 'remote-sha'): RspSpec[] {
  const content = btoa(unescape(encodeURIComponent(json)));
  return [
    registryContents(),
    {
      body: {
        type: 'file',
        path: `.apicircle/workspace-${REMOTE_WS_ID}/workspace.json`,
        sha,
        size: json.length,
        content,
        encoding: 'base64',
      },
    },
  ];
}

const REMOTE_WORKSPACE_JSON = JSON.stringify({
  workspaceName: 'Acme Tools',
  collections: { tree: { id: 'r', type: 'root', children: [] }, requests: {}, folders: {} },
  environments: { items: {}, activeName: null, priorityOrder: [] },
  releases: { self: { versions: [], currentVersion: null } },
});

async function connectWorkspaceSession(): Promise<void> {
  vi.stubGlobal(
    'fetch',
    queuedFetch([
      { body: { login: 'me', id: 1 }, headers: { 'x-oauth-scopes': 'repo, pull_request' } },
    ]),
  );
  await useWorkspaceStore.getState().connectGitHubSession('workspace-tok');
  vi.unstubAllGlobals();
}

describe('per-link session model', () => {
  beforeEach(async () => {
    await act(async () => {
      await useWorkspaceStore.getState().hydrate();
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('linkPrivateWorkspace defaults sessionMode=workspace and reuses the workspace session', async () => {
    await connectWorkspaceSession();
    vi.stubGlobal('fetch', queuedFetch([...fileContents(REMOTE_WORKSPACE_JSON)]));
    const link = await useWorkspaceStore.getState().linkPrivateWorkspace({
      repoFullName: 'acme/tools',
      branch: 'main',
    });
    expect(link.source.sessionMode).toBe('workspace');
    // No dedicated session was created.
    expect(useWorkspaceStore.getState().local!.sessions.github.links[link.id]).toBeUndefined();
  });

  it('linkPrivateWorkspace with sessionMode=dedicated verifies + stores the per-link PAT', async () => {
    await connectWorkspaceSession();
    // Two fetches: GET /user (verifying the dedicated PAT), then GET contents.
    vi.stubGlobal(
      'fetch',
      queuedFetch([
        { body: { login: 'acme-bot', id: 99 }, headers: { 'x-oauth-scopes': 'repo' } },
        ...fileContents(REMOTE_WORKSPACE_JSON),
      ]),
    );
    const link = await useWorkspaceStore.getState().linkPrivateWorkspace({
      repoFullName: 'acme/tools',
      branch: 'main',
      sessionMode: 'dedicated',
      linkSessionToken: 'link-tok-1',
    });
    expect(link.source.sessionMode).toBe('dedicated');
    const linkSession = useWorkspaceStore.getState().local!.sessions.github.links[link.id];
    expect(linkSession).toBeDefined();
    expect(linkSession.accountLogin).toBe('acme-bot');
    expect(linkSession.grantedScopes).toEqual(['repo']);
    // The IDB payload was written under the link session's tokenSecretId.
    expect(await getSecretPayload(linkSession.tokenSecretId)).not.toBeNull();
  });

  it('rejects sessionMode=dedicated without a token', async () => {
    await connectWorkspaceSession();
    await expect(
      useWorkspaceStore.getState().linkPrivateWorkspace({
        repoFullName: 'acme/tools',
        branch: 'main',
        sessionMode: 'dedicated',
      }),
    ).rejects.toThrow(/dedicated/i);
  });

  it('addLinkSession after a workspace-mode link flips the link to dedicated', async () => {
    await connectWorkspaceSession();
    vi.stubGlobal('fetch', queuedFetch([...fileContents(REMOTE_WORKSPACE_JSON)]));
    const link = await useWorkspaceStore.getState().linkPrivateWorkspace({
      repoFullName: 'acme/tools',
      branch: 'main',
    });
    expect(link.source.sessionMode).toBe('workspace');

    vi.unstubAllGlobals();
    vi.stubGlobal(
      'fetch',
      queuedFetch([{ body: { login: 'acme-bot', id: 99 }, headers: { 'x-oauth-scopes': 'repo' } }]),
    );
    const session = await useWorkspaceStore.getState().addLinkSession(link.id, 'link-tok');
    expect(session.accountLogin).toBe('acme-bot');

    const after = useWorkspaceStore.getState();
    expect(after.synced!.linkedWorkspaces[link.id].source.sessionMode).toBe('dedicated');
    expect(after.local!.sessions.github.links[link.id]).toBeDefined();
  });

  it('removeLinkSession drops the per-link entry but leaves sessionMode alone (orphan-aware)', async () => {
    await connectWorkspaceSession();
    vi.stubGlobal(
      'fetch',
      queuedFetch([
        { body: { login: 'acme-bot', id: 99 }, headers: { 'x-oauth-scopes': 'repo' } },
        ...fileContents(REMOTE_WORKSPACE_JSON),
      ]),
    );
    const link = await useWorkspaceStore.getState().linkPrivateWorkspace({
      repoFullName: 'acme/tools',
      branch: 'main',
      sessionMode: 'dedicated',
      linkSessionToken: 'link-tok',
    });
    expect(link.source.sessionMode).toBe('dedicated');
    const tokenId =
      useWorkspaceStore.getState().local!.sessions.github.links[link.id].tokenSecretId;

    await useWorkspaceStore.getState().removeLinkSession(link.id);

    const after = useWorkspaceStore.getState();
    expect(after.local!.sessions.github.links[link.id]).toBeUndefined();
    // Mode stays 'dedicated' so the link card can prompt the user to remap
    // — flipping silently to 'workspace' would mask a credential change.
    expect(after.synced!.linkedWorkspaces[link.id].source.sessionMode).toBe('dedicated');
    // Vault payload is gone.
    expect(await getSecretPayload(tokenId)).toBeNull();
  });

  it('setLinkSessionMode requires a dedicated session before flipping to dedicated', async () => {
    await connectWorkspaceSession();
    vi.stubGlobal('fetch', queuedFetch([...fileContents(REMOTE_WORKSPACE_JSON)]));
    const link = await useWorkspaceStore.getState().linkPrivateWorkspace({
      repoFullName: 'acme/tools',
      branch: 'main',
    });
    await expect(
      useWorkspaceStore.getState().setLinkSessionMode(link.id, 'dedicated'),
    ).rejects.toThrow(/Add a linking session/);
  });

  it('refreshLinkedWorkspace routes through the link-bound session for dedicated links', async () => {
    await connectWorkspaceSession();
    vi.stubGlobal(
      'fetch',
      queuedFetch([
        { body: { login: 'acme-bot', id: 99 }, headers: { 'x-oauth-scopes': 'repo' } },
        ...fileContents(REMOTE_WORKSPACE_JSON, 'sha-1'),
      ]),
    );
    const link = await useWorkspaceStore.getState().linkPrivateWorkspace({
      repoFullName: 'acme/tools',
      branch: 'main',
      sessionMode: 'dedicated',
      linkSessionToken: 'link-tok',
    });

    vi.unstubAllGlobals();
    const refreshFetch = queuedFetch([...fileContents(REMOTE_WORKSPACE_JSON, 'sha-2')]);
    vi.stubGlobal('fetch', refreshFetch);

    await useWorkspaceStore.getState().refreshLinkedWorkspace(link.id);
    expect(refreshFetch).toHaveBeenCalledTimes(2);
    // The Authorization header on both fetches must be the dedicated token,
    // not the workspace token.
    const secondCall = refreshFetch.mock.calls[1] as [unknown, RequestInit | undefined];
    const init = secondCall[1];
    const authHeader = (init?.headers as Record<string, string> | undefined)?.['Authorization'];
    expect(authHeader).toBe('Bearer link-tok');
  });

  it('orphaned dedicated link surfaces a typed error at refresh time', async () => {
    await connectWorkspaceSession();
    vi.stubGlobal(
      'fetch',
      queuedFetch([
        { body: { login: 'acme-bot', id: 99 }, headers: { 'x-oauth-scopes': 'repo' } },
        ...fileContents(REMOTE_WORKSPACE_JSON),
      ]),
    );
    const link = await useWorkspaceStore.getState().linkPrivateWorkspace({
      repoFullName: 'acme/tools',
      branch: 'main',
      sessionMode: 'dedicated',
      linkSessionToken: 'link-tok',
    });
    await useWorkspaceStore.getState().removeLinkSession(link.id);

    vi.unstubAllGlobals();
    await expect(useWorkspaceStore.getState().refreshLinkedWorkspace(link.id)).rejects.toThrow(
      /dedicated session re-added|reconnect/i,
    );
  });
});
