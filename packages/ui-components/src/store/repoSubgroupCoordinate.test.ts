import { act } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useWorkspaceStore } from './workspaceStore';

// The repo coordinate that reaches the WIRE, for a repo path deeper than two
// segments.
//
// `splitRepoFullName` replaced `repoFullName.split('/', 2)` at five sites in
// this store — one CREATE (`doLinkWorkspace`) and four refresh-side
// (`previewLinkedUpdateForLink`, `applyLinkedUpdateForLink`,
// `refreshLinkedWorkspace`, `syncAttachments`). None of them had a test that
// could tell the two implementations apart, because every existing link
// fixture in this package is two segments — 'me/api', 'org/payments', 'a/b' —
// and on two segments the old and new code agree exactly. So the fix shipped
// unguarded and a silent revert would have gone unnoticed.
//
// The old split returned owner='group', name='subgroup' and DISCARDED
// 'project'. It did not throw: it produced a well-formed request aimed at a
// DIFFERENT repository. So asserting "the action succeeded" proves nothing —
// it succeeded before the fix too. The only assertion that separates the two
// is the URL actually requested, which is what these tests read.
//
// GitLab is the host where this is real: `path_with_namespace` carries
// subgroups, and a subgroup rides inside `owner` by design. The store's link
// path is host-parameterised, so it is reachable there. The fixtures below use
// the GitHub client because that is the one this store's test harness can
// drive, but the coordinate arithmetic under test is host-independent — the
// bug was in the split, not in the client.

interface ResponseSpec {
  body: unknown;
  status?: number;
  headers?: Record<string, string>;
}

/** A fetch stub that records every URL it is asked for. */
function recordingFetch(queue: ResponseSpec[]): {
  fn: ReturnType<typeof vi.fn>;
  urls: string[];
} {
  const urls: string[] = [];
  let i = 0;
  const fn = vi.fn(async (input: unknown) => {
    urls.push(typeof input === 'string' ? input : String((input as { url: string }).url));
    if (i >= queue.length) throw new Error(`unexpected fetch call #${i + 1}`);
    const spec = queue[i++];
    return new Response(JSON.stringify(spec.body), {
      status: spec.status ?? 200,
      statusText: 'OK',
      headers: { 'content-type': 'application/json', ...(spec.headers ?? {}) },
    });
  });
  return { fn, urls };
}

const REMOTE_WS_ID = 'remote-ws';

function b64(json: string): string {
  return btoa(unescape(encodeURIComponent(json)));
}

function workspaceJson(): string {
  return JSON.stringify({
    collections: { tree: { id: 'r', type: 'root', children: [] }, requests: {}, folders: {} },
    environments: { items: {}, activeName: null, priorityOrder: [] },
    releases: { self: { versions: [], currentVersion: null } },
  });
}

/** registry.json then workspace.json — the pair every link fetch walks. */
function sourceFiles(): ResponseSpec[] {
  const registry = JSON.stringify({
    schemaVersion: 1,
    activeWorkspaceId: REMOTE_WS_ID,
    workspaces: [{ id: REMOTE_WS_ID }],
  });
  const ws = workspaceJson();
  return [
    {
      body: {
        type: 'file',
        path: '.apicircle/registry.json',
        sha: 'registry-sha',
        size: registry.length,
        content: b64(registry),
        encoding: 'base64',
      },
    },
    {
      body: {
        type: 'file',
        path: `.apicircle/workspace-${REMOTE_WS_ID}/workspace.json`,
        sha: 'sha-1',
        size: ws.length,
        content: b64(ws),
        encoding: 'base64',
      },
    },
  ];
}

/**
 * A source workspace carrying one form-data file row, which is what makes
 * `syncAttachments` reach its linked-workspace branch. Kept separate from
 * {@link workspaceJson} so the other tests keep their minimal fixture.
 */
function workspaceJsonWithAttachment(): string {
  return JSON.stringify({
    collections: {
      tree: { id: 'r', type: 'root', children: [{ kind: 'request', id: 'req-1' }] },
      requests: {
        'req-1': {
          id: 'req-1',
          name: 'Upload',
          folderId: null,
          method: 'POST',
          url: 'https://api.example.test/upload',
          headers: [],
          query: [],
          body: {
            type: 'form-data',
            content: '',
            formRows: [
              {
                kind: 'file',
                enabled: true,
                key: 'file',
                slotId: 'slot-1',
                sha256: 'a'.repeat(64),
                filename: 'a.bin',
                mimeType: 'application/octet-stream',
                size: 3,
              },
            ],
          },
          contextVars: [],
          assertions: [],
          createdAt: 't',
          updatedAt: 't',
        },
      },
      folders: {},
    },
    environments: { items: {}, activeName: null, priorityOrder: [] },
    releases: { self: { versions: [], currentVersion: null } },
  });
}

function sourceFilesWith(json: string): ResponseSpec[] {
  const registry = JSON.stringify({
    schemaVersion: 1,
    activeWorkspaceId: REMOTE_WS_ID,
    workspaces: [{ id: REMOTE_WS_ID }],
  });
  return [
    {
      body: {
        type: 'file',
        path: '.apicircle/registry.json',
        sha: 'registry-sha',
        size: registry.length,
        content: b64(registry),
        encoding: 'base64',
      },
    },
    {
      body: {
        type: 'file',
        path: `.apicircle/workspace-${REMOTE_WS_ID}/workspace.json`,
        sha: 'sha-1',
        size: json.length,
        content: b64(json),
        encoding: 'base64',
      },
    },
  ];
}

/** The blob `syncAttachments` pulls for a slot. */
function attachmentBytes(): ResponseSpec {
  return {
    body: {
      type: 'file',
      path: 'attachment',
      sha: 'blob-sha',
      size: 3,
      content: b64('abc'),
      encoding: 'base64',
    },
  };
}

async function setupSession(): Promise<void> {
  const { fn } = recordingFetch([
    { body: { login: 'me', id: 1 }, headers: { 'x-oauth-scopes': 'repo, pull_request' } },
  ]);
  vi.stubGlobal('fetch', fn);
  await useWorkspaceStore.getState().connectGitHubSession('tok');
  vi.unstubAllGlobals();
}

/** The deep path. Three segments: two of owner, one of name. */
const DEEP = 'group/subgroup/project';

/**
 * The repo coordinate as it appears in a request URL, decoded.
 *
 * The client percent-encodes `owner` and `name` separately, so the correct
 * fold arrives as `/repos/group%2Fsubgroup/project/`. Decoding lets one
 * assertion read the whole coordinate regardless of where the encoder put the
 * boundary.
 */
function repoSegmentOf(url: string): string | null {
  const m = /\/repos\/(.+?)\/contents\//.exec(decodeURIComponent(url));
  return m ? m[1] : null;
}

describe('repo coordinates deeper than two segments reach the wire intact', () => {
  beforeEach(async () => {
    await act(async () => {
      await useWorkspaceStore.getState().hydrate();
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('CREATE (doLinkWorkspace) requests the full path, not the first two segments', async () => {
    await setupSession();
    const { fn, urls } = recordingFetch(sourceFiles());
    vi.stubGlobal('fetch', fn);

    const link = await useWorkspaceStore
      .getState()
      .linkPrivateWorkspace({ repoFullName: DEEP, branch: 'main' });

    const contentUrls = urls.filter((u) => u.includes('/contents/'));
    expect(contentUrls.length).toBeGreaterThan(0);
    for (const url of contentUrls) {
      // Under `split('/', 2)` this is 'group/subgroup' — a real repository,
      // just not the one asked for. Nothing throws; the wrong repo answers.
      expect(repoSegmentOf(url)).toBe(DEEP);
    }

    // And the link persists the full path, which is what made the old bug
    // asymmetric: create fetched one repo while every later refresh used
    // another.
    expect(useWorkspaceStore.getState().synced!.linkedWorkspaces[link.id].source.repoFullName).toBe(
      DEEP,
    );
  });

  it('REFRESH (refreshLinkedWorkspace) addresses the same repo CREATE did', async () => {
    await setupSession();
    const create = recordingFetch(sourceFiles());
    vi.stubGlobal('fetch', create.fn);
    const link = await useWorkspaceStore
      .getState()
      .linkPrivateWorkspace({ repoFullName: DEEP, branch: 'main' });
    vi.unstubAllGlobals();

    const refresh = recordingFetch(sourceFiles());
    vi.stubGlobal('fetch', refresh.fn);
    await useWorkspaceStore.getState().refreshLinkedWorkspace(link.id);

    const refreshed = refresh.urls.filter((u) => u.includes('/contents/')).map(repoSegmentOf);
    expect(refreshed.length).toBeGreaterThan(0);
    for (const seg of refreshed) expect(seg).toBe(DEEP);

    // The invariant that actually broke: create and refresh must agree. When
    // only one side was fixed they silently pointed at different repositories
    // for the same link.
    const created = create.urls.filter((u) => u.includes('/contents/')).map(repoSegmentOf);
    expect(new Set([...created, ...refreshed])).toEqual(new Set([DEEP]));
  });

  it('APPLY (applyLinkedUpdateForLink) re-fetches from the full path', async () => {
    // Apply deliberately re-fetches between preview and apply, so it has its
    // own coordinate split — and therefore its own chance to address the wrong
    // repository. Reverting only this site left the other four correct, which
    // is precisely the kind of partial regression a per-site planted break
    // catches and an end-to-end "it worked" assertion does not.
    await setupSession();
    const create = recordingFetch(sourceFiles());
    vi.stubGlobal('fetch', create.fn);
    const link = await useWorkspaceStore
      .getState()
      .linkPrivateWorkspace({ repoFullName: DEEP, branch: 'main' });
    vi.unstubAllGlobals();

    const preview = recordingFetch(sourceFiles());
    vi.stubGlobal('fetch', preview.fn);
    await useWorkspaceStore.getState().previewLinkedUpdateForLink(link.id);
    vi.unstubAllGlobals();

    const apply = recordingFetch(sourceFiles());
    vi.stubGlobal('fetch', apply.fn);
    await useWorkspaceStore.getState().applyLinkedUpdateForLink({});

    const segs = apply.urls.filter((u) => u.includes('/contents/')).map(repoSegmentOf);
    expect(segs.length).toBeGreaterThan(0);
    for (const seg of segs) expect(seg).toBe(DEEP);
  });

  it('SYNC ATTACHMENTS pulls linked blobs from the full path', async () => {
    // The fifth split, and the easiest to leave unguarded: it sits inside a
    // loop over links and only runs when the linked snapshot actually carries
    // an attachment slot, so the minimal fixture the other tests use never
    // reaches it.
    await setupSession();
    const create = recordingFetch(sourceFilesWith(workspaceJsonWithAttachment()));
    vi.stubGlobal('fetch', create.fn);
    await useWorkspaceStore.getState().linkPrivateWorkspace({ repoFullName: DEEP, branch: 'main' });
    vi.unstubAllGlobals();

    const sync = recordingFetch([attachmentBytes(), attachmentBytes(), attachmentBytes()]);
    vi.stubGlobal('fetch', sync.fn);
    await useWorkspaceStore.getState().syncAttachments();

    const segs = sync.urls.filter((u) => u.includes('/contents/')).map(repoSegmentOf);
    expect(segs.length).toBeGreaterThan(0);
    for (const seg of segs) expect(seg).toBe(DEEP);
  });

  it('PREVIEW (previewLinkedUpdateForLink) addresses the full path', async () => {
    await setupSession();
    const create = recordingFetch(sourceFiles());
    vi.stubGlobal('fetch', create.fn);
    const link = await useWorkspaceStore
      .getState()
      .linkPrivateWorkspace({ repoFullName: DEEP, branch: 'main' });
    vi.unstubAllGlobals();

    const preview = recordingFetch(sourceFiles());
    vi.stubGlobal('fetch', preview.fn);
    await useWorkspaceStore.getState().previewLinkedUpdateForLink(link.id);

    const segs = preview.urls.filter((u) => u.includes('/contents/')).map(repoSegmentOf);
    expect(segs.length).toBeGreaterThan(0);
    for (const seg of segs) expect(seg).toBe(DEEP);
  });
});
