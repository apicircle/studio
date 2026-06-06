import { act } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useWorkspaceStore } from './workspaceStore';

// End-to-end audit of the linked-workspace lifecycle. Codifies the
// invariants the user expects:
//
//   - Link:    snapshot, pin, ledger all populate from the source's
//              workspace.json at link time.
//   - Refresh: ONLY the ledger updates. The snapshot stays frozen at
//              what the last successful Apply (or initial Link) set.
//              The pin stays where it is — refresh is metadata-only.
//   - Preview: re-fetches the source's workspace.json and diffs against
//              the cached snapshot (NOT against a freshly-pulled bytes
//              base — that would always be empty after a refresh-broke-
//              the-snapshot bug we're guarding against).
//   - Apply:   replaces the snapshot with the just-fetched target,
//              advances the pin to the source's currentVersion, and
//              refreshes the ledger atomically. After Apply, refresh-
//              again is a no-op (no fake "Update Available" badge).
//
// The previous bug had Refresh also replace the snapshot, which made
// the diff empty post-refresh and left the user staring at an empty
// "Review update" modal even though the badge said an update was
// available.

interface ResponseSpec {
  body: unknown;
  status?: number;
  headers?: Record<string, string>;
}

function fakeResponse(spec: ResponseSpec): Response {
  return new Response(JSON.stringify(spec.body), {
    status: spec.status ?? 200,
    statusText: 'OK',
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

function fileContents(json: string, sha = 'sha-1'): ResponseSpec {
  const content = btoa(unescape(encodeURIComponent(json)));
  return {
    body: {
      type: 'file',
      path: '.apicircle/workspace.json',
      sha,
      size: json.length,
      content,
      encoding: 'base64',
    },
  };
}

async function setupSession(): Promise<void> {
  vi.stubGlobal(
    'fetch',
    queuedFetch([
      { body: { login: 'me', id: 1 }, headers: { 'x-oauth-scopes': 'repo, pull_request' } },
    ]),
  );
  await useWorkspaceStore.getState().connectGitHubSession('tok');
  vi.unstubAllGlobals();
}

function workspaceJson(args: {
  versions: Array<{ version: string; bytes: string }>;
  currentVersion: string | null;
  /** Single request whose URL embeds the version's bytes — gives us a
   *  cheap way to detect snapshot drift. */
  requestUrl: string;
}): string {
  return JSON.stringify({
    collections: {
      tree: { id: 'r', type: 'root', children: [{ kind: 'request', id: 'req-1' }] },
      requests: {
        'req-1': {
          id: 'req-1',
          name: 'Greet',
          folderId: null,
          method: 'GET',
          url: args.requestUrl,
          headers: [],
          query: [],
          body: { type: 'none', content: '' },
          contextVars: [],
          assertions: [],
          createdAt: 't',
          updatedAt: 't',
        },
      },
      folders: {},
    },
    environments: { items: {}, activeName: null, priorityOrder: [] },
    releases: {
      self: {
        versions: args.versions.map((v) => ({
          version: v.version,
          publishedAt: 't',
          notes: '',
          workspaceSnapshot: v.bytes.padEnd(64, '0').slice(0, 64),
          deprecated: false,
          yanked: false,
        })),
        currentVersion: args.currentVersion,
      },
    },
  });
}

describe('linked-workspace lifecycle audit', () => {
  beforeEach(async () => {
    await act(async () => {
      await useWorkspaceStore.getState().hydrate();
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('Refresh updates ledger only — snapshot + pin stay frozen', async () => {
    await setupSession();
    // Link at v1.0.0. Source's only request has URL "/v1".
    vi.stubGlobal(
      'fetch',
      queuedFetch([
        fileContents(
          workspaceJson({
            versions: [{ version: '1.0.0', bytes: 'aaa' }],
            currentVersion: '1.0.0',
            requestUrl: 'https://api.example.test/v1',
          }),
        ),
      ]),
    );
    const link = await useWorkspaceStore
      .getState()
      .linkPrivateWorkspace({ repoFullName: 'me/api', branch: 'main' });
    const initialSnapshot = useWorkspaceStore.getState().local!.linkedCollections[link.id];
    expect(initialSnapshot.collections.requests['req-1'].url).toBe('https://api.example.test/v1');
    expect(useWorkspaceStore.getState().synced!.linkedWorkspaces[link.id].pinnedVersion).toBe(
      '1.0.0',
    );

    // Source publishes v2.0.0 (different request URL = "/v2").
    vi.unstubAllGlobals();
    vi.stubGlobal(
      'fetch',
      queuedFetch([
        fileContents(
          workspaceJson({
            versions: [
              { version: '1.0.0', bytes: 'aaa' },
              { version: '2.0.0', bytes: 'bbb' },
            ],
            currentVersion: '2.0.0',
            requestUrl: 'https://api.example.test/v2',
          }),
        ),
      ]),
    );
    await useWorkspaceStore.getState().refreshLinkedWorkspace(link.id);

    // Ledger updated.
    const ledgerAfterRefresh = useWorkspaceStore.getState().synced!.releases.perLink[link.id];
    expect(ledgerAfterRefresh.currentVersion).toBe('2.0.0');
    expect(ledgerAfterRefresh.versions).toHaveLength(2);

    // Snapshot UNCHANGED — still has the v1 URL bytes.
    const snapshotAfterRefresh = useWorkspaceStore.getState().local!.linkedCollections[link.id];
    expect(snapshotAfterRefresh.collections.requests['req-1'].url).toBe(
      'https://api.example.test/v1',
    );
    expect(snapshotAfterRefresh).toBe(initialSnapshot);

    // Pin UNCHANGED.
    expect(useWorkspaceStore.getState().synced!.linkedWorkspaces[link.id].pinnedVersion).toBe(
      '1.0.0',
    );
  });

  it('Refresh + Preview sees a real diff (snapshot at v1, target at v2)', async () => {
    await setupSession();
    vi.stubGlobal(
      'fetch',
      queuedFetch([
        fileContents(
          workspaceJson({
            versions: [{ version: '1.0.0', bytes: 'aaa' }],
            currentVersion: '1.0.0',
            requestUrl: 'https://api.example.test/v1',
          }),
        ),
      ]),
    );
    const link = await useWorkspaceStore
      .getState()
      .linkPrivateWorkspace({ repoFullName: 'me/api', branch: 'main' });

    // Source published v2.0.0; user refreshes (ledger updates only).
    const v2Json = workspaceJson({
      versions: [
        { version: '1.0.0', bytes: 'aaa' },
        { version: '2.0.0', bytes: 'bbb' },
      ],
      currentVersion: '2.0.0',
      requestUrl: 'https://api.example.test/v2',
    });
    vi.unstubAllGlobals();
    vi.stubGlobal('fetch', queuedFetch([fileContents(v2Json)]));
    await useWorkspaceStore.getState().refreshLinkedWorkspace(link.id);

    // Now Preview — fetches the target again, diffs against the
    // (still-v1) snapshot. Real entries should appear.
    vi.unstubAllGlobals();
    vi.stubGlobal('fetch', queuedFetch([fileContents(v2Json)]));
    await useWorkspaceStore.getState().previewLinkedUpdateForLink(link.id);
    const active = useWorkspaceStore.getState().activeLinkedUpdate!;
    expect(active.preview.entries.length).toBeGreaterThan(0);
    expect(active.preview.toVersion).toBe('2.0.0');
    expect(active.preview.fromVersion).toBe('1.0.0');
  });

  it('Apply advances pin + refreshes ledger + replaces snapshot atomically; refresh-after is a no-op', async () => {
    await setupSession();
    vi.stubGlobal(
      'fetch',
      queuedFetch([
        fileContents(
          workspaceJson({
            versions: [{ version: '1.0.0', bytes: 'aaa' }],
            currentVersion: '1.0.0',
            requestUrl: 'https://api.example.test/v1',
          }),
        ),
      ]),
    );
    const link = await useWorkspaceStore
      .getState()
      .linkPrivateWorkspace({ repoFullName: 'me/api', branch: 'main' });

    const v2Json = workspaceJson({
      versions: [
        { version: '1.0.0', bytes: 'aaa' },
        { version: '2.0.0', bytes: 'bbb' },
      ],
      currentVersion: '2.0.0',
      requestUrl: 'https://api.example.test/v2',
    });

    // Refresh (ledger only).
    vi.unstubAllGlobals();
    vi.stubGlobal('fetch', queuedFetch([fileContents(v2Json)]));
    await useWorkspaceStore.getState().refreshLinkedWorkspace(link.id);

    // Preview (re-fetches target).
    vi.unstubAllGlobals();
    vi.stubGlobal('fetch', queuedFetch([fileContents(v2Json)]));
    await useWorkspaceStore.getState().previewLinkedUpdateForLink(link.id);

    // Apply (re-fetches target one more time per the action's
    // honesty re-fetch).
    vi.unstubAllGlobals();
    vi.stubGlobal('fetch', queuedFetch([fileContents(v2Json)]));
    await useWorkspaceStore.getState().applyLinkedUpdateForLink({});

    // Post-apply state: pin AND ledger.currentVersion both at 2.0.0.
    const afterApply = useWorkspaceStore.getState();
    expect(afterApply.synced!.linkedWorkspaces[link.id].pinnedVersion).toBe('2.0.0');
    expect(afterApply.synced!.releases.perLink[link.id].currentVersion).toBe('2.0.0');
    // Snapshot updated to v2.
    expect(afterApply.local!.linkedCollections[link.id].collections.requests['req-1'].url).toBe(
      'https://api.example.test/v2',
    );
    // Modal cleared.
    expect(afterApply.activeLinkedUpdate).toBeNull();

    // Refresh again — source still at 2.0.0 — should be a no-op:
    // pin stays at 2.0.0, ledger stays at 2.0.0, no fake "update
    // available" should be inferable from the resulting state.
    vi.unstubAllGlobals();
    vi.stubGlobal('fetch', queuedFetch([fileContents(v2Json)]));
    await useWorkspaceStore.getState().refreshLinkedWorkspace(link.id);
    const finalState = useWorkspaceStore.getState();
    expect(finalState.synced!.linkedWorkspaces[link.id].pinnedVersion).toBe('2.0.0');
    expect(finalState.synced!.releases.perLink[link.id].currentVersion).toBe('2.0.0');
    // Update-available is just a derived UI state; assert the equality
    // it relies on holds.
    expect(
      finalState.synced!.releases.perLink[link.id].currentVersion ===
        finalState.synced!.linkedWorkspaces[link.id].pinnedVersion,
    ).toBe(true);
  });

  it('After Apply, source publishes a NEWER version → next Refresh shows real new update', async () => {
    await setupSession();
    vi.stubGlobal(
      'fetch',
      queuedFetch([
        fileContents(
          workspaceJson({
            versions: [{ version: '1.0.0', bytes: 'aaa' }],
            currentVersion: '1.0.0',
            requestUrl: 'https://api.example.test/v1',
          }),
        ),
      ]),
    );
    const link = await useWorkspaceStore
      .getState()
      .linkPrivateWorkspace({ repoFullName: 'me/api', branch: 'main' });

    // Apply v2.
    const v2Json = workspaceJson({
      versions: [
        { version: '1.0.0', bytes: 'aaa' },
        { version: '2.0.0', bytes: 'bbb' },
      ],
      currentVersion: '2.0.0',
      requestUrl: 'https://api.example.test/v2',
    });
    vi.unstubAllGlobals();
    vi.stubGlobal(
      'fetch',
      queuedFetch([fileContents(v2Json), fileContents(v2Json), fileContents(v2Json)]),
    );
    await useWorkspaceStore.getState().refreshLinkedWorkspace(link.id);
    await useWorkspaceStore.getState().previewLinkedUpdateForLink(link.id);
    await useWorkspaceStore.getState().applyLinkedUpdateForLink({});
    expect(useWorkspaceStore.getState().synced!.linkedWorkspaces[link.id].pinnedVersion).toBe(
      '2.0.0',
    );

    // Source publishes v3.0.0. Refresh again — pin stays at 2.0.0,
    // ledger.currentVersion advances to 3.0.0, badge fires correctly.
    const v3Json = workspaceJson({
      versions: [
        { version: '1.0.0', bytes: 'aaa' },
        { version: '2.0.0', bytes: 'bbb' },
        { version: '3.0.0', bytes: 'ccc' },
      ],
      currentVersion: '3.0.0',
      requestUrl: 'https://api.example.test/v3',
    });
    vi.unstubAllGlobals();
    vi.stubGlobal('fetch', queuedFetch([fileContents(v3Json)]));
    await useWorkspaceStore.getState().refreshLinkedWorkspace(link.id);
    const after = useWorkspaceStore.getState();
    expect(after.synced!.linkedWorkspaces[link.id].pinnedVersion).toBe('2.0.0');
    expect(after.synced!.releases.perLink[link.id].currentVersion).toBe('3.0.0');
    // Snapshot still at v2 (Refresh doesn't touch it).
    expect(after.local!.linkedCollections[link.id].collections.requests['req-1'].url).toBe(
      'https://api.example.test/v2',
    );
  });
});
