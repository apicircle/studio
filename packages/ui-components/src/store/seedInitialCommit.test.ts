import { act } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useWorkspaceStore } from './workspaceStore';

// `seedInitialCommit` bootstraps an empty repo through the Contents API: it
// writes `.apicircle/registry.json`, then a scaffold `workspace.json`, onto the
// default branch. The registry entry it writes names the workspace by the same
// rule `pushWorkspace` follows, so the first thing a teammate's "Import from
// workspace" picker reads off that branch is a real name, not a placeholder.

interface ResponseSpec {
  body: unknown;
  status?: number;
  headers?: Record<string, string>;
}

function fakeResponse(spec: ResponseSpec): Response {
  return new Response(JSON.stringify(spec.body), {
    status: spec.status ?? 200,
    headers: { 'content-type': 'application/json', ...(spec.headers ?? {}) },
  });
}

function queuedFetch(queue: ResponseSpec[]): ReturnType<typeof vi.fn> {
  let i = 0;
  return vi.fn(async () => {
    if (i >= queue.length) throw new Error(`unexpected fetch call #${i + 1}`);
    return fakeResponse(queue[i++]);
  });
}

async function connectRepo(): Promise<void> {
  vi.stubGlobal(
    'fetch',
    queuedFetch([
      // connectGitHubSession → GET /user
      { body: { login: 'me', id: 1 }, headers: { 'x-oauth-scopes': 'repo, pull_request' } },
      // connectRepo → GET /repos/me/api
      {
        body: {
          full_name: 'me/api',
          name: 'api',
          owner: { login: 'me' },
          default_branch: 'main',
          visibility: 'public',
          private: false,
          permissions: { push: true, admin: false },
        },
      },
    ]),
  );
  await useWorkspaceStore.getState().connectGitHubSession('tok');
  await useWorkspaceStore.getState().connectRepo('me', 'api');
  vi.unstubAllGlobals();
}

/** The three calls seeding an empty repo makes, in order. */
function seedResponses(): ResponseSpec[] {
  return [
    // getContents: probe for a workspace.json already on main — there is none
    { status: 404, body: { message: 'Not Found' } },
    // putContents: .apicircle/registry.json
    {
      status: 201,
      body: { commit: { sha: 'commit-registry' }, content: { sha: 'registry-blob' } },
    },
    // putContents: the scaffold workspace.json
    { status: 201, body: { commit: { sha: 'commit-seed' }, content: { sha: 'scaffold-blob' } } },
  ];
}

interface SeededRegistry {
  activeWorkspaceId: string;
  workspaces: Array<{ id: string; name: string; createdAt: string; lastOpenedAt: string }>;
}

/** Decodes the registry document the seed PUT onto the branch. */
function seededRegistry(fetchMock: ReturnType<typeof vi.fn>): SeededRegistry {
  const put = fetchMock.mock.calls.find(
    ([url, init]) =>
      String(url).endsWith('/contents/.apicircle/registry.json') &&
      (init as RequestInit | undefined)?.method === 'PUT',
  );
  if (!put) throw new Error('the seed never wrote .apicircle/registry.json');
  const { content } = JSON.parse((put[1] as RequestInit).body as string) as { content: string };
  const bytes = Uint8Array.from(atob(content), (c) => c.charCodeAt(0));
  return JSON.parse(new TextDecoder().decode(bytes)) as SeededRegistry;
}

describe('workspaceStore.seedInitialCommit', () => {
  beforeEach(async () => {
    await act(async () => {
      await useWorkspaceStore.getState().hydrate();
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("names this workspace's registry entry after this device's name for it", async () => {
    await connectRepo();
    useWorkspaceStore.getState().setWorkspaceName('  Payments API  ');
    const fetchMock = queuedFetch(seedResponses());
    vi.stubGlobal('fetch', fetchMock);

    await useWorkspaceStore.getState().seedInitialCommit();

    const workspaceId = useWorkspaceStore.getState().synced!.workspaceId;
    const registry = seededRegistry(fetchMock);
    expect(registry.activeWorkspaceId).toBe(workspaceId);
    expect(registry.workspaces).toHaveLength(1);
    expect(registry.workspaces[0]).toMatchObject({ id: workspaceId, name: 'Payments API' });
  });

  it('writes the placeholder name when this device has no usable name', async () => {
    await connectRepo();
    // `setWorkspaceName` keeps a blank name in memory while it skips persisting
    // it, so a seed fired mid-edit still has to write something readable.
    useWorkspaceStore.getState().setWorkspaceName('   ');
    const fetchMock = queuedFetch(seedResponses());
    vi.stubGlobal('fetch', fetchMock);

    await useWorkspaceStore.getState().seedInitialCommit();

    expect(seededRegistry(fetchMock).workspaces[0].name).toBe('Workspace');
  });
});
