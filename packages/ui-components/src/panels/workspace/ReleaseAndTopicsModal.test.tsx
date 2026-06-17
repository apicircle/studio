import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ReleaseAndTopicsModal } from './ReleaseAndTopicsModal';
import { useWorkspaceStore } from '../../store/workspaceStore';

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

function queuedFetch(queue: ResponseSpec[]): ReturnType<typeof vi.fn> {
  let i = 0;
  return vi.fn(async () => {
    if (i >= queue.length) throw new Error(`unexpected fetch #${i + 1}`);
    return fakeResponse(queue[i++]);
  });
}

/**
 * Routes fetch URLs to canned responses by pattern. Avoids the
 * sequential-queue race when the modal triggers parallel fetches on
 * mount (loadLatestUntaggedRelease + listRepoTopics fire concurrently).
 *
 * Each pattern entry can return a single ResponseSpec or a queue —
 * sequential calls to the same URL pattern walk the queue.
 */
function routedFetch(
  routes: Array<{ match: RegExp; responses: ResponseSpec[] }>,
): ReturnType<typeof vi.fn> {
  const cursors = new WeakMap<RegExp, number>();
  return vi.fn(async (input: RequestInfo | URL) => {
    const url =
      typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    for (const route of routes) {
      if (route.match.test(url)) {
        const i = cursors.get(route.match) ?? 0;
        if (i >= route.responses.length) {
          throw new Error(`route ${route.match.source} exhausted (call #${i + 1}, url=${url})`);
        }
        cursors.set(route.match, i + 1);
        return fakeResponse(route.responses[i]);
      }
    }
    throw new Error(`unrouted fetch: ${url}`);
  });
}

function ledgerFile(versions: Array<{ version: string; notes?: string }>): ResponseSpec {
  const json = JSON.stringify({ releases: { self: { versions } } });
  const wsId = useWorkspaceStore.getState().synced?.workspaceId ?? 'ws';
  return {
    body: {
      type: 'file',
      content: Buffer.from(json, 'utf8').toString('base64'),
      sha: 'fileSha',
      path: `.apicircle/workspace-${wsId}/workspace.json`,
      size: json.length,
    },
  };
}

/**
 * Hydrates the store, connects a real GitHub session via the public
 * action so the in-memory token cache is populated, then patches
 * `connectedRepo` directly. Single hydrate so the in-memory token
 * survives. After this, the test installs its own URL-routed fetch
 * stub for the modal calls.
 */
async function bootstrapStoreWithRepo(): Promise<void> {
  vi.stubGlobal(
    'fetch',
    queuedFetch([{ body: { login: 'me', id: 1 }, headers: { 'x-oauth-scopes': 'repo' } }]),
  );
  await act(async () => {
    await useWorkspaceStore.getState().hydrate();
  });
  await act(async () => {
    await useWorkspaceStore.getState().connectGitHubSession('tok-secret');
  });
  await act(async () => {
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
  vi.unstubAllGlobals();
}

describe('ReleaseAndTopicsModal', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('shows empty-state when main has no published versions', async () => {
    await bootstrapStoreWithRepo();
    vi.stubGlobal(
      'fetch',
      routedFetch([
        {
          match: /\/contents\/\.apicircle\/workspace-[^/]+\/workspace\.json/,
          responses: [{ body: { message: 'Not Found' }, status: 404 }],
        },
        { match: /\/topics$/, responses: [{ body: { names: ['apicircle'] } }] },
      ]),
    );
    render(<ReleaseAndTopicsModal open={true} onClose={() => {}} />);
    expect(await screen.findByText(/Nothing to tag/)).toBeInTheDocument();
    // Topics still load — `apicircle` appears both as a chip and in
    // the locked-topic help text.
    await waitFor(() => expect(screen.getAllByText('apicircle').length).toBeGreaterThan(0));
  });

  it('shows empty-state when every published version is already tagged', async () => {
    await bootstrapStoreWithRepo();
    vi.stubGlobal(
      'fetch',
      routedFetch([
        {
          match: /\/contents\/\.apicircle\/workspace-[^/]+\/workspace\.json/,
          responses: [ledgerFile([{ version: '2.3.0', notes: 'released' }])],
        },
        {
          match: /\/git\/refs\/tags\/v2\.3\.0/,
          responses: [{ body: { ref: 'refs/tags/v2.3.0', object: { sha: 'oldSha' } } }],
        },
        { match: /\/topics$/, responses: [{ body: { names: ['apicircle'] } }] },
      ]),
    );
    render(<ReleaseAndTopicsModal open={true} onClose={() => {}} />);
    // No "Override v2.3.0" prompt anymore — just an empty state.
    expect(await screen.findByText(/Nothing to tag/)).toBeInTheDocument();
    expect(screen.queryByText(/Override v2\.3\.0/)).toBeNull();
    expect(screen.queryByText(/Tag exists at oldSha/)).toBeNull();
  });

  it('renders the latest untagged version + creates a tag against main HEAD', async () => {
    await bootstrapStoreWithRepo();
    vi.stubGlobal(
      'fetch',
      routedFetch([
        {
          match: /\/contents\/\.apicircle\/workspace-[^/]+\/workspace\.json/,
          responses: [
            ledgerFile([
              { version: '1.0.0', notes: 'initial' },
              { version: '1.1.0', notes: 'feature drop' },
            ]),
          ],
        },
        // getTagSha(v1.1.0) is called twice: once during loadLatestUntaggedRelease
        // walk, once during tagReleaseVersion's pre-check. Both return 404.
        {
          match: /\/git\/refs\/tags\/v1\.1\.0/,
          responses: [
            { body: { message: 'Not Found' }, status: 404 },
            { body: { message: 'Not Found' }, status: 404 },
          ],
        },
        { match: /\/topics$/, responses: [{ body: { names: ['apicircle'] } }] },
        // getRef(main) for tagReleaseVersion
        {
          match: /\/git\/refs\/heads\/main/,
          responses: [{ body: { ref: 'refs/heads/main', object: { sha: 'mainHead123' } } }],
        },
        // createTag
        {
          match: /\/git\/refs$/,
          responses: [{ body: { ref: 'refs/tags/v1.1.0', object: { sha: 'mainHead123' } } }],
        },
      ]),
    );
    render(<ReleaseAndTopicsModal open={true} onClose={() => {}} />);
    const createBtn = await screen.findByRole('button', { name: /Create tag v1\.1\.0/ });
    await userEvent.click(createBtn);
    await waitFor(() => expect(screen.getByText(/Tagged ·/)).toBeInTheDocument());
  });

  it('topics editor: add + save round-trips through setRepoTopics', async () => {
    await bootstrapStoreWithRepo();
    vi.stubGlobal(
      'fetch',
      routedFetch([
        {
          match: /\/contents\/\.apicircle\/workspace-[^/]+\/workspace\.json/,
          responses: [{ body: { message: 'Not Found' }, status: 404 }],
        },
        {
          match: /\/topics$/,
          responses: [
            { body: { names: ['apicircle', 'payments'] } },
            // setRepoTopics PUT response
            { body: { names: ['apicircle', 'payments', 'graphql'] } },
          ],
        },
      ]),
    );
    render(<ReleaseAndTopicsModal open={true} onClose={() => {}} />);
    await waitFor(() => expect(screen.getByText('payments')).toBeInTheDocument());

    const input = screen.getByLabelText('New topic');
    await userEvent.type(input, 'graphql');
    await userEvent.click(screen.getByRole('button', { name: /^Add$/ }));
    expect(screen.getByText('graphql')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: /Save topics/ }));
    await waitFor(() => expect(screen.getByText(/Topics saved\./)).toBeInTheDocument());
  });

  it('apicircle topic is locked (no remove button rendered)', async () => {
    await bootstrapStoreWithRepo();
    vi.stubGlobal(
      'fetch',
      routedFetch([
        {
          match: /\/contents\/\.apicircle\/workspace-[^/]+\/workspace\.json/,
          responses: [{ body: { message: 'Not Found' }, status: 404 }],
        },
        { match: /\/topics$/, responses: [{ body: { names: ['apicircle', 'payments'] } }] },
      ]),
    );
    render(<ReleaseAndTopicsModal open={true} onClose={() => {}} />);
    await waitFor(() => expect(screen.getByText('payments')).toBeInTheDocument());
    // Locked: no remove-button for apicircle.
    expect(screen.queryByRole('button', { name: /Remove topic apicircle/ })).toBeNull();
    // Unlocked: payments has one.
    expect(screen.getByRole('button', { name: /Remove topic payments/ })).toBeInTheDocument();
  });
});
