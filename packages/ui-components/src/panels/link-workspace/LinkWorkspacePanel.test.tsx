import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LinkedWorkspace, ReleaseHistory, WorkspaceLocal } from '@apicircle/shared';
import { useWorkspaceStore } from '../../store/workspaceStore';
import { LinkWorkspacePanel } from './LinkWorkspacePanel';

async function hydrate(): Promise<void> {
  await act(async () => {
    await useWorkspaceStore.getState().hydrate();
  });
}

function seedSession(): void {
  const local = useWorkspaceStore.getState().local!;
  const next: WorkspaceLocal = {
    ...local,
    sessions: {
      github: {
        workspace: {
          accountLogin: 'me',
          tokenSecretId: 'tok-id',
          grantedScopes: ['repo', 'pull_request'],
          addedAt: 't',
          lastVerifiedAt: 't',
          canCreatePullRequests: true,
        },
        links: {},
      },
    },
  };
  useWorkspaceStore.setState({ local: next });
}

function seedLink(opts: {
  id: string;
  name: string;
  pinnedVersion?: string | null;
  ledger?: ReleaseHistory;
  requiredKeys?: string[];
}): void {
  const link: LinkedWorkspace = {
    id: opts.id,
    kind: 'private',
    name: opts.name,
    source: {
      provider: 'github',
      repoFullName: `me/${opts.name}`,
      branch: 'main',
      sessionMode: 'workspace' as const,
    },
    scope: ['collections', 'environments'],
    pinnedVersion: opts.pinnedVersion ?? null,
    updatePolicy: 'manual',
    linkedAt: '2026-04-27T00:00:00.000Z',
    requiredSecretKeyIds: opts.requiredKeys ?? [],
  };
  const synced = useWorkspaceStore.getState().synced!;
  useWorkspaceStore.setState({
    synced: {
      ...synced,
      linkedWorkspaces: { ...synced.linkedWorkspaces, [opts.id]: link },
      releases: {
        ...synced.releases,
        perLink: {
          ...synced.releases.perLink,
          [opts.id]: opts.ledger ?? { versions: [], currentVersion: null },
        },
      },
    },
  });
}

describe('LinkWorkspacePanel — no session state', () => {
  beforeEach(hydrate);
  afterEach(() => vi.unstubAllGlobals());

  it('shows the connect-prompt and disables the private-link CTA when no GitHub session exists', () => {
    render(<LinkWorkspacePanel />);
    expect(screen.getByText(/Connect GitHub to link a workspace/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Link a private workspace/ })).toBeDisabled();
  });

  it('the connect button opens the Vault tab in the workspace inspector dock', async () => {
    render(<LinkWorkspacePanel />);
    expect(useWorkspaceStore.getState().rightDock.tab).toBe(null);
    await userEvent.click(screen.getByRole('button', { name: /Open Secret Vault/ }));
    expect(useWorkspaceStore.getState().rightDock.tab).toBe('vault');
  });

  it('marketplace search remains usable anonymously; results render but the Link button is disabled', async () => {
    const user = userEvent.setup();
    useWorkspaceStore.setState({
      searchMarketplace: vi.fn(async () => [
        {
          fullName: 'org/payments',
          owner: 'org',
          name: 'payments',
          description: 'Payments collection',
          topics: ['apicircle-marketplace', 'fintech'],
          stargazers: 12,
          defaultBranch: 'main',
        },
      ]),
    });

    render(<LinkWorkspacePanel />);
    // The marketplace CTA is visible without a session.
    await user.click(screen.getByRole('button', { name: /Search marketplace/ }));
    // Anonymous-mode hint copy.
    expect(
      screen.getByText(
        (content, node) =>
          content.includes('Browsing is anonymous') &&
          node?.textContent?.includes('Secret Vault') === true,
      ),
    ).toBeInTheDocument();
    await user.type(screen.getByLabelText('Marketplace query'), 'pay');
    await user.click(screen.getByRole('button', { name: /^Search$/ }));
    expect(await screen.findByText('Payments collection')).toBeInTheDocument();
    // The per-result Link button is disabled when the user has no session.
    expect(screen.getByRole('button', { name: /^Link$/ })).toBeDisabled();
  });
});

describe('LinkWorkspacePanel — connected, no links yet', () => {
  beforeEach(async () => {
    await hydrate();
    seedSession();
  });

  it('renders the link form CTAs and a 0-linked badge', () => {
    render(<LinkWorkspacePanel />);
    expect(screen.getByText('0 linked')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Link a private workspace/ })).toBeVisible();
    expect(screen.getByRole('button', { name: /Search marketplace/ })).toBeVisible();
  });

  it('the private-link modal — manual-entry path keeps "Review & link" disabled until the repo contains a slash', async () => {
    const user = userEvent.setup();
    render(<LinkWorkspacePanel />);
    await user.click(screen.getByRole('button', { name: /Link a private workspace/ }));
    // The B.1 modal defaults to the repo browser; switch to manual entry
    // to exercise the typed `owner/name` precondition. UI-level
    // validation supersedes the legacy post-submit error string —
    // disabled button is clearer feedback than a hidden error.
    await user.click(screen.getByRole('button', { name: /Switch to manual entry/ }));
    const submit = screen.getByRole('button', { name: /Review .* link/ });
    expect(submit).toBeDisabled();
    await user.type(screen.getByLabelText('Linked repo full name'), 'just-a-name');
    expect(submit).toBeDisabled();
    await user.clear(screen.getByLabelText('Linked repo full name'));
    await user.type(screen.getByLabelText('Linked repo full name'), 'org/api');
    expect(submit).toBeEnabled();
  });

  it('the repo-browser path lists repos, picks one, and probes for the pin-version dropdown', async () => {
    const user = userEvent.setup();
    // Stub the store actions the new modal calls so we don't need
    // network roundtrips. listAccessibleRepos returns two repos; the
    // user picks one; listRepoBranches returns its branches; the probe
    // returns one published version (1.2.0).
    useWorkspaceStore.setState({
      listAccessibleRepos: vi.fn(async () => [
        {
          fullName: 'me/api',
          owner: 'me',
          name: 'api',
          defaultBranch: 'main',
          visibility: 'private' as const,
          isPrivate: true,
          pushable: true,
        },
        {
          fullName: 'me/widgets',
          owner: 'me',
          name: 'widgets',
          defaultBranch: 'main',
          visibility: 'public' as const,
          isPrivate: false,
          pushable: true,
        },
      ]),
      listRepoBranches: vi.fn(async () => [
        { name: 'main', commitSha: 'aaa' },
        { name: 'develop', commitSha: 'bbb' },
      ]),
      probeLinkedRepoVersions: vi.fn(async () => ({
        repoFullName: 'me/api',
        versions: ['1.0.0', '1.2.0'],
        currentVersion: '1.2.0',
        requiredSecretKeys: [],
      })),
    });

    render(<LinkWorkspacePanel />);
    await user.click(screen.getByRole('button', { name: /Link a private workspace/ }));

    // The combobox is available and lists the seeded repos.
    const combo = await screen.findByLabelText('Filter accessible repos');
    await user.click(combo);
    expect(await screen.findByRole('option', { name: /Pick me\/api/ })).toBeVisible();
    expect(screen.getByRole('option', { name: /Pick me\/widgets/ })).toBeVisible();

    // Pick the first repo. Branches load + default to `main`.
    await user.click(screen.getByRole('option', { name: /Pick me\/api/ }));
    expect(await screen.findByLabelText('Pick a branch')).toHaveValue('main');

    // Probe runs and surfaces the repo path + currentVersion chip. The
    // workspace name no longer lives in the git-tracked doc, so the
    // wizard shows the unambiguous `owner/repo` identifier instead.
    // The repo path appears in multiple places (the selected-repo chip
    // in the picker and the Source workspace line under the probe);
    // assert at least one match plus the version chip.
    expect((await screen.findAllByText(/me\/api/)).length).toBeGreaterThan(0);
    expect(screen.getByText(/currentVersion v1\.2\.0/)).toBeVisible();

    // Switching to "Pin to a specific version" reveals the dropdown
    // populated from the source's published versions, sorted desc.
    await user.click(screen.getByLabelText('Pin to a specific version'));
    const pinSelect = await screen.findByLabelText('Specific version to pin');
    expect(pinSelect).toHaveValue('1.2.0');

    // Review & link is now enabled.
    expect(screen.getByRole('button', { name: /Review .* link/ })).toBeEnabled();
  });

  it('switches between repo-browser and manual-entry modes; manual mode hides the combobox', async () => {
    const user = userEvent.setup();
    useWorkspaceStore.setState({
      listAccessibleRepos: vi.fn(async () => []),
    });
    render(<LinkWorkspacePanel />);
    await user.click(screen.getByRole('button', { name: /Link a private workspace/ }));

    // Combobox visible by default.
    expect(await screen.findByLabelText('Filter accessible repos')).toBeVisible();

    // Toggle to manual entry.
    await user.click(screen.getByRole('button', { name: /Switch to manual entry/ }));
    expect(screen.getByLabelText('Linked repo full name')).toBeVisible();
    expect(screen.queryByLabelText('Filter accessible repos')).not.toBeInTheDocument();

    // Toggle back to repo browser.
    await user.click(screen.getByRole('button', { name: /Switch to repo browser/ }));
    expect(screen.getByLabelText('Filter accessible repos')).toBeVisible();
    expect(screen.queryByLabelText('Linked repo full name')).not.toBeInTheDocument();
  });
});

describe('LinkWorkspacePanel — link card surface', () => {
  beforeEach(async () => {
    await hydrate();
    seedSession();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('renders the card with source repo, pin select, and version dropdown', () => {
    seedLink({
      id: 'lw-1',
      name: 'Payments',
      pinnedVersion: '1.0.0',
      ledger: {
        versions: [
          {
            version: '1.0.0',
            publishedAt: 't',
            notes: '',
            workspaceSnapshot: 'a'.repeat(64),
            deprecated: false,
            yanked: false,
          },
          {
            version: '0.9.0',
            publishedAt: 't',
            notes: '',
            workspaceSnapshot: 'b'.repeat(64),
            deprecated: true,
            yanked: false,
          },
        ],
        currentVersion: '1.0.0',
      },
    });
    render(<LinkWorkspacePanel />);
    expect(screen.getByText('Payments')).toBeInTheDocument();
    expect(screen.getByText('me/Payments@main')).toBeInTheDocument();
    // The pinned version is now a read-only display (the dropdown was
    // removed — pinning is set at link time + via Refresh/Apply, not
    // changeable from the link card directly).
    const pinDisplay = screen.getByLabelText('Pinned to v1.0.0');
    expect(pinDisplay).toHaveTextContent('v1.0.0');
    // Old-flow pin <select> shouldn't exist anymore.
    expect(screen.queryByRole('combobox', { name: /Pin .* version/ })).toBeNull();
  });

  it('shows "update available" when the cached current version diverges from the pin', () => {
    seedLink({
      id: 'lw-2',
      name: 'API',
      pinnedVersion: '0.1.0',
      ledger: {
        versions: [
          {
            version: '0.1.0',
            publishedAt: 't',
            notes: '',
            workspaceSnapshot: 'a'.repeat(64),
            deprecated: false,
            yanked: false,
          },
          {
            version: '0.2.0',
            publishedAt: 't',
            notes: '',
            workspaceSnapshot: 'b'.repeat(64),
            deprecated: false,
            yanked: false,
          },
        ],
        currentVersion: '0.2.0',
      },
    });
    render(<LinkWorkspacePanel />);
    expect(screen.getByText(/update available · v0\.2\.0/)).toBeInTheDocument();
  });

  it('surfaces the deprecated badge next to the pinned version when source flags it', () => {
    seedLink({
      id: 'lw-deprecated',
      name: 'API',
      pinnedVersion: '0.1.0',
      ledger: {
        versions: [
          {
            version: '0.1.0',
            publishedAt: 't',
            notes: '',
            workspaceSnapshot: 'a'.repeat(64),
            deprecated: true,
            yanked: false,
          },
        ],
        currentVersion: '0.1.0',
      },
    });
    render(<LinkWorkspacePanel />);
    // The pinned-version chip has a "deprecated" badge alongside it so
    // consumers stuck on a deprecated release have a visible signal.
    expect(screen.getByText('deprecated')).toBeInTheDocument();
    expect(screen.queryByText('withdrawn')).toBeNull();
  });

  it('surfaces the withdrawn badge next to the pinned version when source yanks it', () => {
    seedLink({
      id: 'lw-yanked',
      name: 'API',
      pinnedVersion: '0.1.0',
      ledger: {
        versions: [
          {
            version: '0.1.0',
            publishedAt: 't',
            notes: '',
            workspaceSnapshot: 'a'.repeat(64),
            deprecated: false,
            yanked: true,
          },
        ],
        currentVersion: '0.1.0',
      },
    });
    render(<LinkWorkspacePanel />);
    expect(screen.getByText('withdrawn')).toBeInTheDocument();
    expect(screen.queryByText('deprecated')).toBeNull();
  });

  it('Changelog button surfaces version notes; Unlink button removes the card', async () => {
    seedLink({
      id: 'lw-4',
      name: 'Pets',
      pinnedVersion: '0.1.0',
      ledger: {
        versions: [
          {
            version: '0.1.0',
            publishedAt: '2026-04-27T00:00:00.000Z',
            notes: 'first cut',
            workspaceSnapshot: 'a'.repeat(64),
            deprecated: false,
            yanked: false,
          },
        ],
        currentVersion: '0.1.0',
      },
    });
    const user = userEvent.setup();
    render(<LinkWorkspacePanel />);
    await user.click(screen.getByRole('button', { name: 'Changelog' }));
    expect(screen.getByRole('dialog', { name: /Pets — changelog/ })).toBeVisible();
    expect(screen.getByText('first cut')).toBeVisible();
    // Close the changelog with the explicit Close button.
    await user.click(screen.getByRole('button', { name: 'Close' }));

    await user.click(screen.getByRole('button', { name: 'Unlink' }));
    // Confirm dialog: the modal has its own Unlink button (last in DOM).
    const unlinkButtons = screen.getAllByRole('button', { name: 'Unlink' });
    await user.click(unlinkButtons[unlinkButtons.length - 1]);
    expect(useWorkspaceStore.getState().synced!.linkedWorkspaces['lw-4']).toBeUndefined();
  });

  it('required-key flow: auto-populated → provision → status flips → remove', async () => {
    // Required keys are auto-populated from the source's secretKeys
    // registry at link time (or on Refresh ledger). Manual-add was
    // removed since linking auto-discovers slots.
    seedLink({ id: 'lw-5', name: 'API', requiredKeys: ['API_KEY'] });
    const user = userEvent.setup();
    render(<LinkWorkspacePanel />);

    // The auto-populated row is visible with a "missing" status.
    expect(screen.getByText('API_KEY')).toBeInTheDocument();
    expect(screen.getByText('missing')).toBeInTheDocument();

    // Provision a value.
    await user.click(screen.getByRole('button', { name: 'Set value' }));
    await user.type(screen.getByLabelText('Value for API_KEY'), 'secret');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText('set')).toBeVisible();

    // Remove the key (confirm modal).
    await user.click(screen.getByRole('button', { name: 'Remove key API_KEY' }));
    const removeButtons = screen.getAllByRole('button', { name: 'Remove' });
    await user.click(removeButtons[removeButtons.length - 1]);
    expect(
      useWorkspaceStore.getState().synced!.linkedWorkspaces['lw-5'].requiredSecretKeyIds,
    ).toEqual([]);
  });

  it('shows guidance when the source declares no vault slots', () => {
    seedLink({ id: 'lw-5b', name: 'NoSlots', requiredKeys: [] });
    render(<LinkWorkspacePanel />);
    expect(
      screen.getByText(/source workspace doesn't declare any vault slots/i),
    ).toBeInTheDocument();
    // No manual-add button — the affordance was removed since linking
    // auto-discovers slots from the source registry.
    expect(screen.queryByRole('button', { name: /Add a key manually/ })).toBeNull();
  });
});

describe('LinkWorkspacePanel — marketplace search', () => {
  beforeEach(async () => {
    await hydrate();
    seedSession();
  });
  afterEach(() => vi.unstubAllGlobals());

  it('search → results render with topic chips, link launches confirm', async () => {
    const user = userEvent.setup();
    // Stub fetch directly on the searchMarketplace path so we don't need
    // to wire IPC. The store action calls GitHubClient internally.
    useWorkspaceStore.setState({
      searchMarketplace: vi.fn(async (q: string) => {
        void q;
        return [
          {
            fullName: 'org/payments',
            owner: 'org',
            name: 'payments',
            description: 'Payments collection',
            topics: ['apicircle-marketplace', 'fintech'],
            stargazers: 12,
            defaultBranch: 'main',
          },
        ];
      }),
    });

    render(<LinkWorkspacePanel />);
    await user.click(screen.getByRole('button', { name: /Search marketplace/ }));
    await user.type(screen.getByLabelText('Marketplace query'), 'pay');
    await user.click(screen.getByRole('button', { name: /^Search$/ }));
    expect(await screen.findByText('Payments collection')).toBeInTheDocument();
    expect(screen.getByText('apicircle-marketplace')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /^Link$/ }));
    expect(screen.getByRole('dialog', { name: /Link org\/payments/ })).toBeVisible();
  });

  it('empty results render the "No results" placeholder', async () => {
    const user = userEvent.setup();
    useWorkspaceStore.setState({
      searchMarketplace: vi.fn(async () => []),
    });
    render(<LinkWorkspacePanel />);
    await user.click(screen.getByRole('button', { name: /Search marketplace/ }));
    await user.type(screen.getByLabelText('Marketplace query'), 'nothing');
    await user.click(screen.getByRole('button', { name: /^Search$/ }));
    expect(await screen.findByText('No results.')).toBeInTheDocument();
  });
});

describe('LinkWorkspacePanel — per-link session UX', () => {
  beforeEach(async () => {
    await hydrate();
    seedSession();
  });
  afterEach(() => vi.unstubAllGlobals());

  it('the link card shows the workspace-session badge for sessionMode=workspace links', () => {
    seedLink({ id: 'lw-1', name: 'Payments' });
    render(<LinkWorkspacePanel />);
    // Badge text ends with '@me' (the seeded workspace session login).
    expect(screen.getByText(/workspace · @me/)).toBeInTheDocument();
  });

  it('orphaned dedicated link auto-recovers to workspace mode when a workspace session is available', async () => {
    // A dedicated-mode link whose dedicated session is gone — but a
    // healthy workspace session exists. The card auto-recovers
    // silently (flips the link's mode back to 'workspace') instead of
    // showing the alarming "Dedicated session removed" banner.
    const synced = useWorkspaceStore.getState().synced!;
    const link: LinkedWorkspace = {
      id: 'lw-orphan',
      kind: 'private',
      name: 'Acme',
      source: {
        provider: 'github',
        repoFullName: 'acme/tools',
        branch: 'main',
        sessionMode: 'dedicated',
      },
      scope: ['collections', 'environments'],
      pinnedVersion: null,
      updatePolicy: 'manual',
      linkedAt: '2026-04-27T00:00:00.000Z',
      requiredSecretKeyIds: [],
    };
    useWorkspaceStore.setState({
      synced: {
        ...synced,
        linkedWorkspaces: { ...synced.linkedWorkspaces, [link.id]: link },
      },
    });
    render(<LinkWorkspacePanel />);
    // The auto-recover effect runs after mount → mode flips to 'workspace'.
    await waitFor(() => {
      const after = useWorkspaceStore.getState().synced!.linkedWorkspaces['lw-orphan'];
      expect(after.source.sessionMode).toBe('workspace');
    });
    // No alarming banner.
    expect(screen.queryByText(/Dedicated session removed/i)).toBeNull();
  });

  it('orphaned dedicated link DOES surface the banner when no workspace session exists', () => {
    // Same setup as above but drop the workspace session — now there's
    // nothing to fall back to, so the banner stays visible and the
    // user must explicitly reconnect a dedicated session.
    const local = useWorkspaceStore.getState().local!;
    useWorkspaceStore.setState({
      local: {
        ...local,
        sessions: { github: { workspace: null, links: {} } },
      },
    });
    const synced = useWorkspaceStore.getState().synced!;
    const link: LinkedWorkspace = {
      id: 'lw-orphan-no-ws',
      kind: 'private',
      name: 'Acme',
      source: {
        provider: 'github',
        repoFullName: 'acme/tools',
        branch: 'main',
        sessionMode: 'dedicated',
      },
      scope: ['collections', 'environments'],
      pinnedVersion: null,
      updatePolicy: 'manual',
      linkedAt: '2026-04-27T00:00:00.000Z',
      requiredSecretKeyIds: [],
    };
    useWorkspaceStore.setState({
      synced: {
        ...synced,
        linkedWorkspaces: { ...synced.linkedWorkspaces, [link.id]: link },
      },
    });
    render(<LinkWorkspacePanel />);
    expect(screen.getByRole('alert')).toHaveTextContent(/Dedicated session removed/i);
    expect(screen.getByRole('button', { name: /Reconnect dedicated session/ })).toBeInTheDocument();
  });

  it('orphaned workspace-mode link (no workspace session) shows a workspace-disconnected banner', () => {
    // Drop the workspace session, then add a link in workspace mode.
    const local = useWorkspaceStore.getState().local!;
    useWorkspaceStore.setState({
      local: {
        ...local,
        sessions: { github: { workspace: null, links: {} } },
      },
    });
    seedLink({ id: 'lw-2', name: 'Payments' });
    render(<LinkWorkspacePanel />);
    expect(screen.getByRole('alert')).toHaveTextContent(/Workspace session disconnected/i);
    // Adding a dedicated session is a valid remap path — the user can
    // bind a separate PAT to this link without restoring the workspace
    // session.
    expect(screen.getByRole('button', { name: /Add dedicated session/ })).toBeInTheDocument();
  });

  it('the link wizard renders a session picker with workspace + dedicated radios', async () => {
    const user = userEvent.setup();
    render(<LinkWorkspacePanel />);
    await user.click(screen.getByRole('button', { name: /Link a private workspace/ }));
    // Workspace radio is the default.
    const workspaceRadio = screen.getByLabelText(/Use workspace session/);
    const dedicatedRadio = screen.getByLabelText(/Add a dedicated session/);
    expect(workspaceRadio).toBeChecked();
    expect(dedicatedRadio).not.toBeChecked();
    // Switching to dedicated reveals the PAT input.
    await user.click(dedicatedRadio);
    expect(screen.getByLabelText('Dedicated linking session PAT')).toBeInTheDocument();
  });

  it('once the dedicated PAT is pasted, repo browser refetches via tokenOverride', async () => {
    const user = userEvent.setup();
    const listAccessibleRepos = vi.fn(async () => [
      {
        fullName: 'acme/secret-repo',
        owner: 'acme',
        name: 'secret-repo',
        defaultBranch: 'main',
        visibility: 'private' as const,
        isPrivate: true,
        pushable: true,
      },
    ]);
    useWorkspaceStore.setState({ listAccessibleRepos });
    render(<LinkWorkspacePanel />);
    await user.click(screen.getByRole('button', { name: /Link a private workspace/ }));
    // Initial open: workspace mode, no tokenOverride.
    expect(listAccessibleRepos).toHaveBeenCalledWith(undefined);
    // Switch to dedicated → existing repo list clears (no token yet).
    await user.click(screen.getByLabelText(/Add a dedicated session/));
    // Paste a PAT. The combobox should refetch with tokenOverride. Type
    // the token in one shot via .paste() so the effect only debounces
    // through the final value, not every keystroke.
    const patInput = screen.getByLabelText('Dedicated linking session PAT');
    await user.click(patInput);
    await user.paste('ghp_dedicated_secret');
    await waitFor(() => {
      const lastCall = listAccessibleRepos.mock.calls.at(-1) as
        | [{ tokenOverride?: string } | undefined]
        | undefined;
      expect(lastCall?.[0]).toEqual({ tokenOverride: 'ghp_dedicated_secret' });
    });
  });
});
