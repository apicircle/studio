import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LinkedWorkspace, ReleaseHistory, WorkspaceLocal } from '@apicircle-v2/shared';
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
        accountLogin: 'me',
        tokenSecretId: 'tok-id',
        grantedScopes: ['repo', 'pull_request'],
        addedAt: 't',
        lastVerifiedAt: 't',
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
    source: { provider: 'github', repoFullName: `me/${opts.name}`, branch: 'main' },
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

  it('shows the connect-prompt when no GitHub session exists', () => {
    render(<LinkWorkspacePanel />);
    expect(screen.getByText(/Connect GitHub first/)).toBeInTheDocument();
  });

  it('the connect button opens the Secret Vault', async () => {
    render(<LinkWorkspacePanel />);
    expect(useWorkspaceStore.getState().secretVaultOpen).toBe(false);
    await userEvent.click(screen.getByRole('button', { name: /Open Secret Vault/ }));
    expect(useWorkspaceStore.getState().secretVaultOpen).toBe(true);
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

  it('the private-link modal validates owner/name format and surfaces error text', async () => {
    const user = userEvent.setup();
    render(<LinkWorkspacePanel />);
    await user.click(screen.getByRole('button', { name: /Link a private workspace/ }));
    await user.type(screen.getByLabelText('Linked repo full name'), 'just-a-name');
    await user.click(screen.getByRole('button', { name: /Review .* link/ }));
    // The confirm dialog opens; clicking Link triggers the store action
    // which throws "Repo must be `owner/name`".
    await user.click(screen.getByRole('button', { name: 'Link' }));
    expect(await screen.findByText(/Repo must be `owner\/name`/)).toBeVisible();
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
    const pinSelect = screen.getByLabelText('Pin Payments version');
    expect(pinSelect).toHaveValue('1.0.0');
    expect(within(pinSelect).getByText(/0\.9\.0 · deprecated/)).toBeInTheDocument();
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

  it('switching the pin opens a confirm dialog and applies the new version', async () => {
    seedLink({
      id: 'lw-3',
      name: 'API',
      pinnedVersion: '0.2.0',
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
    const user = userEvent.setup();
    render(<LinkWorkspacePanel />);
    const pin = screen.getByLabelText('Pin API version');
    await user.selectOptions(pin, '0.1.0');
    await user.click(screen.getByRole('button', { name: 'Pin' }));
    expect(useWorkspaceStore.getState().synced!.linkedWorkspaces['lw-3'].pinnedVersion).toBe(
      '0.1.0',
    );
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

  it('required-key flow: declare → provision → status flips → remove', async () => {
    seedLink({ id: 'lw-5', name: 'API', requiredKeys: [] });
    const user = userEvent.setup();
    render(<LinkWorkspacePanel />);

    // Empty state.
    expect(screen.getByText(/No required keys declared/)).toBeInTheDocument();

    // Declare a key.
    await user.type(screen.getByLabelText('Add required key'), 'API_KEY');
    await user.click(screen.getByRole('button', { name: /Add key/ }));
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
