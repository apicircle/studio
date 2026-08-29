import { act, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { registerGitProvider, resetGitProviderRegistry, type GitProvider } from '@apicircle/git';
import { GIT_HOST_LABELS, type GitHostKind } from '@apicircle/shared';
import { ReleaseAndTopicsModal } from './ReleaseAndTopicsModal';
import { WorkspacePanel } from './WorkspacePanel';
import { useWorkspaceStore } from '../../store/workspaceStore';

// The modal offered a Release checkbox and a topics editor on every host. Two of
// the four cannot do either: `createRelease` and `setRepoTopics` reject with a
// provider error on Bitbucket Cloud and Azure DevOps. So the user was invited to
// click a control that could only fail, and the failure arrived as a raw error
// after they had already committed to the action.
//
// What must NOT happen in the fix is over-correction. Tagging works on all four
// hosts, and topics are READABLE on all four (Bitbucket answers with an empty
// list — its repos have no topics, which is a real answer). Hiding the whole
// modal, or the whole topics section, would remove working features to fix a
// broken one. So these tests pin both directions: the controls that must go, and
// the controls that must stay.

/**
 * Everything the modal drives on mount, and nothing else.
 *
 * `getContents` returns an UNENCODED body: base64 is the GitHub REST wire
 * format, decoded by that client before it reaches the provider seam. A stub
 * that base64-encoded here would be modelling the wire, not the contract.
 *
 * `getTagSha` answers null so the version reads as untagged — otherwise
 * `loadLatestUntaggedRelease` walks past it, `latest` stays null, and the modal
 * renders "Nothing to tag" with no controls at all. Every assertion about the
 * Release checkbox would then pass or fail for the wrong reason.
 */
function stubProvider(topics: string[]): GitProvider {
  const ledger = JSON.stringify({
    releases: { self: { versions: [{ version: '1.2.0', notes: 'notes' }] } },
  });
  return {
    getContents: vi.fn(async () => ({
      content: ledger,
      sha: 'fileSha',
      path: 'workspace.json',
      size: ledger.length,
    })),
    getTagSha: vi.fn(async () => null),
    listRepoTopics: vi.fn(async () => topics),
    setRepoTopics: vi.fn(async () => topics),
  } as unknown as GitProvider;
}

/**
 * A workspace connected to `host`.
 *
 * The session is always a GitHub one — `connectGitHubSession` is the only public
 * route that seeds the in-memory token cache, and the token is not what is under
 * test here. `connectedRepo.hostKind` is what the modal reads.
 */
async function bootstrap(host: GitHostKind, topics: string[] = ['apicircle']): Promise<void> {
  const ledger = JSON.stringify({
    releases: { self: { versions: [{ version: '1.2.0', notes: 'notes' }] } },
  });
  const json = (body: unknown, headers: Record<string, string> = {}) =>
    new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'content-type': 'application/json', ...headers },
    });
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      if (/\/topics$/.test(url)) return json({ names: topics });
      if (/\/contents\//.test(url)) {
        return json({
          type: 'file',
          content: Buffer.from(ledger, 'utf8').toString('base64'),
          sha: 'fileSha',
          path: 'workspace.json',
          size: ledger.length,
        });
      }
      if (/\/git\/ref|\/tags/.test(url)) return new Response(null, { status: 404 });
      return json({ login: 'me', id: 1 }, { 'x-oauth-scopes': 'repo' });
    }),
  );
  await act(async () => {
    await useWorkspaceStore.getState().hydrate();
  });
  // Connect ONCE per module: the store persists to fake-indexeddb, so a second
  // call throws "a GitHub session for me already exists". The in-memory token
  // cache the modal needs is module-scoped and survives, so re-connecting would
  // buy nothing even if it were allowed.
  if (!useWorkspaceStore.getState().local?.sessions.github.workspace) {
    await act(async () => {
      await useWorkspaceStore.getState().connectGitHubSession('tok-secret');
    });
  }

  if (host !== 'github') {
    vi.unstubAllGlobals();
    registerGitProvider(host, () => stubProvider(topics));
  }

  await act(async () => {
    const local = useWorkspaceStore.getState().local!;
    // A session for THAT host. `decryptSessionToken` resolves the credential per
    // host, so a GitLab-connected repo with only a GitHub session fails at the
    // token step and never reaches the provider — the modal would then render a
    // session error and every gating assertion below would be measuring that
    // instead. Reuses the real session's `tokenSecretId`, so it decrypts.
    const hostSession =
      host === 'github'
        ? local.sessions.hosts
        : {
            ...local.sessions.hosts,
            [host]: { workspace: local.sessions.github.workspace, links: {} },
          };
    useWorkspaceStore.setState({
      local: {
        ...local,
        sessions: { ...local.sessions, hosts: hostSession },
        connectedRepo: {
          owner: 'me',
          name: 'api',
          fullName: 'me/api',
          defaultBranch: 'main',
          visibility: 'public',
          isPrivate: false,
          pushable: true,
          connectedAt: '2026-04-27T00:00:00.000Z',
          hostKind: host,
        },
      },
    });
  });
}

/** The chip list renders once topics have loaded. */
async function settled(): Promise<void> {
  await waitFor(() => expect(screen.queryByText('Loading topics…')).not.toBeInTheDocument());
}

const RELEASE_CHECKBOX = (host: GitHostKind) =>
  new RegExp(`Also create ${GIT_HOST_LABELS[host]} Release`);

describe('Release & topics — per-host capability gate', () => {
  beforeEach(() => {
    resetGitProviderRegistry();
    vi.unstubAllGlobals();
  });
  afterEach(() => {
    resetGitProviderRegistry();
    vi.unstubAllGlobals();
  });

  it.each([
    ['github' as const, true],
    ['gitlab' as const, true],
    ['bitbucket' as const, false],
    ['azure-devops' as const, false],
  ])('%s: offers the Release checkbox only when the host has releases', async (host, offered) => {
    await bootstrap(host);
    render(<ReleaseAndTopicsModal open={true} onClose={() => {}} />);
    await settled();

    const checkbox = screen.queryByLabelText(RELEASE_CHECKBOX(host));
    if (offered) {
      expect(checkbox).toBeInTheDocument();
    } else {
      expect(checkbox).not.toBeInTheDocument();
      // Not merely absent — SAID. A GitHub user who knows the checkbox would
      // otherwise wonder whether tagging failed as well.
      expect(
        screen.getByText(
          new RegExp(`${GIT_HOST_LABELS[host]} has no release object to attach to a tag`),
        ),
      ).toBeInTheDocument();
    }
  });

  it.each([
    ['github' as const, true],
    ['gitlab' as const, true],
    ['bitbucket' as const, false],
    ['azure-devops' as const, false],
  ])('%s: offers topic EDITING only when the host can write them', async (host, editable) => {
    await bootstrap(host);
    render(<ReleaseAndTopicsModal open={true} onClose={() => {}} />);
    await settled();

    const addInput = screen.queryByLabelText('New topic');
    const save = screen.queryByRole('button', { name: /Save topics/ });

    if (editable) {
      expect(addInput).toBeInTheDocument();
      expect(save).toBeInTheDocument();
    } else {
      expect(addInput).not.toBeInTheDocument();
      expect(save).not.toBeInTheDocument();
      expect(
        screen.getByText(new RegExp(`${GIT_HOST_LABELS[host]} has no API for setting topics`)),
      ).toBeInTheDocument();
    }
  });

  it('keeps topics READABLE on a host that cannot write them', async () => {
    // The regression this guards: gating the section as a whole rather than its
    // controls. Bitbucket's `listRepoTopics` succeeds and returns [] — removing
    // the section would hide a working read behind a broken write.
    await bootstrap('bitbucket', ['apicircle', 'payments']);
    render(<ReleaseAndTopicsModal open={true} onClose={() => {}} />);
    await settled();

    expect(screen.getByLabelText('Repo topics')).toBeInTheDocument();
    expect(screen.getByText('payments')).toBeInTheDocument();
    // Read-only means no per-chip remove either, or the user edits a list that
    // can never be saved.
    expect(screen.queryByLabelText('Remove topic payments')).not.toBeInTheDocument();
  });

  it('keeps TAGGING offered on every host, including the two that cannot release', async () => {
    // Tagging is supported on all four. Over-correcting to hide the modal would
    // remove a working feature to fix a broken one.
    for (const host of ['github', 'gitlab', 'bitbucket', 'azure-devops'] as const) {
      resetGitProviderRegistry();
      await bootstrap(host);
      const { unmount } = render(<ReleaseAndTopicsModal open={true} onClose={() => {}} />);
      await settled();
      expect(screen.getByText(/Tag a release on/)).toBeInTheDocument();
      unmount();
    }
  });

  it.each([
    ['github' as const, 'Edit topics'],
    ['gitlab' as const, 'Edit topics'],
    ['bitbucket' as const, 'View topics'],
    ['azure-devops' as const, 'View topics'],
  ])('%s: the ENTRY POINT promises only what the dialog will deliver', async (host, label) => {
    // Gating the dialog alone is not enough. The button that opens it is the
    // promise a user reads first — "Edit topics" on a host that cannot write
    // them is an invitation the dialog then has to withdraw.
    await bootstrap(host);
    render(<WorkspacePanel />);
    expect(await screen.findByRole('button', { name: label })).toBeInTheDocument();
    const other = label === 'Edit topics' ? 'View topics' : 'Edit topics';
    expect(screen.queryByRole('button', { name: other })).not.toBeInTheDocument();

    // Tagging is offered on every host, so this button never changes.
    expect(screen.getByRole('button', { name: 'Tag release' })).toBeInTheDocument();
  });

  it('treats a repo connected before hostKind existed as GitHub', async () => {
    // `hostKind` is optional on ConnectedRepo — it was added when the second
    // host was. A workspace connected before that must keep every control it
    // had, not lose them to a conservative default.
    await bootstrap('github');
    await act(async () => {
      const local = useWorkspaceStore.getState().local!;
      const { hostKind: _dropped, ...withoutHost } = local.connectedRepo!;
      useWorkspaceStore.setState({ local: { ...local, connectedRepo: withoutHost } });
    });
    render(<ReleaseAndTopicsModal open={true} onClose={() => {}} />);
    await settled();

    expect(screen.getByLabelText(/Also create GitHub Release/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Save topics/ })).toBeInTheDocument();
  });
});
