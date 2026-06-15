import { act } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useWorkspaceStore } from './workspaceStore';

// Tests for the #6 release-flow rework:
//   - tagReleaseVersion always tags `main` HEAD (never the working branch).
//   - The override toggle deletes the existing tag ref before recreating.
//   - listRepoTopics / setRepoTopics passthrough.
//   - loadLatestUntaggedRelease picks the highest version on main without a tag.

interface ResponseSpec {
  body: unknown;
  status?: number;
  headers?: Record<string, string>;
}

function fakeResponse(spec: ResponseSpec): Response {
  return new Response(spec.body === null ? null : JSON.stringify(spec.body), {
    status: spec.status ?? 200,
    statusText: 'OK',
    headers: { 'content-type': 'application/json', ...(spec.headers ?? {}) },
  });
}

interface RecordedCall {
  url: string;
  method: string;
  body: unknown;
}

function queuedFetch(queue: ResponseSpec[]): {
  fn: ReturnType<typeof vi.fn>;
  calls: RecordedCall[];
} {
  let i = 0;
  const calls: RecordedCall[] = [];
  const fn = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url =
      typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    if (i >= queue.length) {
      throw new Error(`unexpected fetch call #${i + 1} — queue exhausted (url=${url})`);
    }
    calls.push({
      url,
      method: init?.method ?? 'GET',
      body: typeof init?.body === 'string' ? JSON.parse(init.body) : init?.body,
    });
    return fakeResponse(queue[i++]);
  });
  return { fn, calls };
}

beforeEach(async () => {
  vi.unstubAllGlobals();
});
afterEach(() => {
  vi.unstubAllGlobals();
});

// Connect a real session via the public action so the in-memory token
// cache is populated. Returns the spent fetch count so callers know how
// many queue entries got used.
async function connectViaSession(initialFetches: ResponseSpec[]): Promise<{ fetchSpent: number }> {
  // The first fetch hits GET /user during connectGitHubSession.
  const { fn } = queuedFetch([
    { body: { login: 'me', id: 1 }, headers: { 'x-oauth-scopes': 'repo' } },
    ...initialFetches,
  ]);
  vi.stubGlobal('fetch', fn);
  await act(async () => {
    await useWorkspaceStore.getState().hydrate();
  });
  await act(async () => {
    await useWorkspaceStore.getState().connectGitHubSession('tok-secret');
    // Patch a connectedRepo so the action paths that need it have one.
    const local = useWorkspaceStore.getState().local!;
    useWorkspaceStore.setState({
      local: {
        ...local,
        connectedRepo: {
          owner: 'me',
          name: 'api',
          fullName: 'me/api',
          defaultBranch: 'main',
          visibility: 'public',
          isPrivate: false,
          pushable: true,
          connectedAt: '2026-04-27T00:00:00.000Z',
        },
      },
    });
  });
  return { fetchSpent: 1 };
}

describe('tagReleaseVersion', () => {
  it('tags main HEAD when no working branch is set', async () => {
    await connectViaSession([]);
    // Now overwrite fetch with the call sequence the action drives.
    const { fn, calls } = queuedFetch([
      // 1. getRef(main) → returns main HEAD SHA
      { body: { ref: 'refs/heads/main', object: { sha: 'mainHead123' } } },
      // 2. getTagSha(v1.0.0) → 404, no existing tag
      { body: { message: 'Not Found' }, status: 404 },
      // 3. createTag → new tag at mainHead123
      { body: { ref: 'refs/tags/v1.0.0', object: { sha: 'mainHead123' } } },
    ]);
    vi.stubGlobal('fetch', fn);

    const result = await useWorkspaceStore.getState().tagReleaseVersion({
      version: '1.0.0',
    });
    expect(result.sha).toBe('mainHead123');
    expect(result.tagRef).toBe('refs/tags/v1.0.0');
    // The createTag body MUST carry main HEAD's SHA — never a working-
    // branch SHA. That's the entire point of #6.
    const tagCall = calls.find((c) => c.method === 'POST' && c.url.endsWith('/git/refs'));
    expect(tagCall).toBeDefined();
    expect((tagCall!.body as { sha: string }).sha).toBe('mainHead123');
  });

  it('refuses to retag without override when the tag already exists', async () => {
    await connectViaSession([]);
    const { fn } = queuedFetch([
      { body: { ref: 'refs/heads/main', object: { sha: 'mainHead123' } } },
      // Tag already exists → return its sha, not 404.
      { body: { ref: 'refs/tags/v1.0.0', object: { sha: 'oldSha456' } } },
    ]);
    vi.stubGlobal('fetch', fn);
    await expect(
      useWorkspaceStore.getState().tagReleaseVersion({ version: '1.0.0' }),
    ).rejects.toThrow(/already exists/i);
  });

  it('with override=true: deletes the existing tag ref then recreates against main HEAD', async () => {
    await connectViaSession([]);
    const { fn, calls } = queuedFetch([
      { body: { ref: 'refs/heads/main', object: { sha: 'mainHead123' } } },
      { body: { ref: 'refs/tags/v1.0.0', object: { sha: 'oldSha456' } } },
      // deleteRef → 204 empty body
      { body: null, status: 204 },
      { body: { ref: 'refs/tags/v1.0.0', object: { sha: 'mainHead123' } } },
    ]);
    vi.stubGlobal('fetch', fn);
    const result = await useWorkspaceStore.getState().tagReleaseVersion({
      version: '1.0.0',
      override: true,
    });
    expect(result.sha).toBe('mainHead123');
    const deleteCall = calls.find((c) => c.method === 'DELETE');
    expect(deleteCall).toBeDefined();
    expect(deleteCall!.url).toContain('git/refs/tags/v1.0.0');
  });

  it('createGitHubRelease=true also POSTs the release', async () => {
    await connectViaSession([]);
    const { fn, calls } = queuedFetch([
      { body: { ref: 'refs/heads/main', object: { sha: 'mainHead123' } } },
      { body: { message: 'Not Found' }, status: 404 },
      { body: { ref: 'refs/tags/v1.0.0', object: { sha: 'mainHead123' } } },
      {
        body: {
          id: 99,
          html_url: 'https://github.com/me/api/releases/tag/v1.0.0',
          tag_name: 'v1.0.0',
        },
      },
    ]);
    vi.stubGlobal('fetch', fn);
    const result = await useWorkspaceStore.getState().tagReleaseVersion({
      version: '1.0.0',
      notes: 'first cut',
      createGitHubRelease: true,
    });
    expect(result.releaseUrl).toBe('https://github.com/me/api/releases/tag/v1.0.0');
    const releaseCall = calls.find((c) => c.url.endsWith('/releases'));
    expect(releaseCall).toBeDefined();
    expect((releaseCall!.body as { body: string }).body).toBe('first cut');
  });

  it('strips a leading "v" so callers can pass either "1.0.0" or "v1.0.0"', async () => {
    await connectViaSession([]);
    const { fn, calls } = queuedFetch([
      { body: { ref: 'refs/heads/main', object: { sha: 'mainHead123' } } },
      { body: { message: 'Not Found' }, status: 404 },
      { body: { ref: 'refs/tags/v1.0.0', object: { sha: 'mainHead123' } } },
    ]);
    vi.stubGlobal('fetch', fn);
    await useWorkspaceStore.getState().tagReleaseVersion({ version: 'v1.0.0' });
    // The tag ref in createTag's payload is `refs/tags/v1.0.0`, never `refs/tags/vv1.0.0`.
    const tagCall = calls.find((c) => c.method === 'POST' && c.url.endsWith('/git/refs'));
    expect((tagCall!.body as { ref: string }).ref).toBe('refs/tags/v1.0.0');
  });
});

describe('listRepoTopics + setRepoTopics', () => {
  it('listRepoTopics returns the topic names from GitHub', async () => {
    await connectViaSession([]);
    const { fn } = queuedFetch([{ body: { names: ['apicircle', 'payments'] } }]);
    vi.stubGlobal('fetch', fn);
    const topics = await useWorkspaceStore.getState().listRepoTopics();
    expect(topics).toEqual(['apicircle', 'payments']);
  });

  it('setRepoTopics normalizes (lowercase + dedupe + drop blanks) before PUT', async () => {
    await connectViaSession([]);
    const { fn, calls } = queuedFetch([{ body: { names: ['apicircle', 'payments', 'graphql'] } }]);
    vi.stubGlobal('fetch', fn);
    const persisted = await useWorkspaceStore
      .getState()
      .setRepoTopics(['APICIRCLE', '  payments  ', 'payments', '', 'GraphQL']);
    expect(persisted).toEqual(['apicircle', 'payments', 'graphql']);
    const put = calls[0];
    expect(put.method).toBe('PUT');
    expect((put.body as { names: string[] }).names).toEqual(['apicircle', 'payments', 'graphql']);
  });
});

describe('loadLatestUntaggedRelease', () => {
  it('returns the highest version on main that has no matching tag yet', async () => {
    await connectViaSession([]);
    const wsId = useWorkspaceStore.getState().synced!.workspaceId;
    // 1. getContents(workspace.json on main) → ledger with v1.0.0, v1.1.0.
    const ledgerJson = JSON.stringify({
      releases: {
        self: {
          versions: [
            { version: '1.0.0', notes: 'initial' },
            { version: '1.1.0', notes: 'feature drop' },
          ],
        },
      },
    });
    const base64 = Buffer.from(ledgerJson, 'utf8').toString('base64');
    const { fn } = queuedFetch([
      {
        body: {
          type: 'file',
          content: base64,
          sha: 'fileSha',
          path: `.apicircle/workspace-${wsId}/workspace.json`,
          size: ledgerJson.length,
        },
      },
      // 2. getTagSha(v1.1.0) → 404 → not yet tagged → that's our pick
      { body: { message: 'Not Found' }, status: 404 },
    ]);
    vi.stubGlobal('fetch', fn);
    const res = await useWorkspaceStore.getState().loadLatestUntaggedRelease();
    expect(res).toEqual({
      version: '1.1.0',
      notes: 'feature drop',
      existingTagSha: null,
    });
  });

  it('returns null when every published version on main is already tagged', async () => {
    await connectViaSession([]);
    const wsId = useWorkspaceStore.getState().synced!.workspaceId;
    const ledgerJson = JSON.stringify({
      releases: { self: { versions: [{ version: '1.0.0', notes: 'initial' }] } },
    });
    const base64 = Buffer.from(ledgerJson, 'utf8').toString('base64');
    const { fn } = queuedFetch([
      {
        body: {
          type: 'file',
          content: base64,
          sha: 'fileSha',
          path: `.apicircle/workspace-${wsId}/workspace.json`,
          size: ledgerJson.length,
        },
      },
      // Walk: v1.0.0 already tagged.
      { body: { ref: 'refs/tags/v1.0.0', object: { sha: 'oldSha' } } },
    ]);
    vi.stubGlobal('fetch', fn);
    // The modal renders an empty state — surfacing v1.0.0 + an Override
    // toggle when there's nothing new to release confused users.
    // Retagging is still possible via tagReleaseVersion({ override: true })
    // but isn't promoted as a default surface here.
    const res = await useWorkspaceStore.getState().loadLatestUntaggedRelease();
    expect(res).toBeNull();
  });

  it('returns null when main has no workspace.json or no released versions', async () => {
    await connectViaSession([]);
    const { fn } = queuedFetch([
      // 404 for .apicircle/workspace-<id>/workspace.json on main
      { body: { message: 'Not Found' }, status: 404 },
    ]);
    vi.stubGlobal('fetch', fn);
    const res = await useWorkspaceStore.getState().loadLatestUntaggedRelease();
    expect(res).toBeNull();
  });
});
