import { act, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { WorkspaceSwitcher } from './WorkspaceSwitcher';
import { useWorkspaceStore } from '../store/workspaceStore';
import { renderWithStore } from '../../test/renderWithStore';
import { WorkspaceAccessProvider } from './workspaceAccess';

/**
 * The switcher inside an UNCAPPED policy.
 *
 * The default access policy is a cap of ONE, so rendering the bare component
 * would lock every row but the oldest and these tests would be asserting the
 * lock rather than the naming rules they are actually about. Locking has its own
 * describe block below.
 */
function Unlimited() {
  return (
    <WorkspaceAccessProvider value={{ maxWorkspaces: Infinity }}>
      <WorkspaceSwitcher />
    </WorkspaceAccessProvider>
  );
}

// Switcher's disambiguation logic — when two registry entries share a
// (case-insensitive) name, the dropdown appends a short `#xxxx` id
// suffix so the user can tell them apart. The 1.0.8 create + rename
// guards prevent NEW collisions, but pre-1.0.8 registries (e.g. the
// user's existing data with two "My Workspace" entries from a legacy-
// migration race) still render here.

const T0 = '2026-05-22T00:00:00.000Z';

describe('WorkspaceSwitcher disambiguation', () => {
  it('renders bare names when every workspace has a unique name', async () => {
    await renderWithStore(<Unlimited />);
    useWorkspaceStore.setState({
      workspaceRegistry: {
        schemaVersion: 1,
        activeWorkspaceId: 'ws-alpha',
        workspaces: [
          { id: 'ws-alpha', name: 'Alpha', createdAt: T0, lastOpenedAt: T0 },
          { id: 'ws-beta', name: 'Beta', createdAt: T0, lastOpenedAt: T0 },
        ],
      },
    });
    const trigger = await screen.findByRole('button', { name: /Switch workspace/ });
    await userEvent.click(trigger);

    // Each option's accessible name is the bare workspace name —
    // no `(id ...)` suffix because there's no collision.
    expect(screen.getByRole('option', { name: 'Switch to Alpha' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Switch to Beta' })).toBeInTheDocument();
  });

  it('appends a short id suffix to colliding rows (case-insensitive)', async () => {
    await renderWithStore(<Unlimited />);
    useWorkspaceStore.setState({
      workspaceRegistry: {
        schemaVersion: 1,
        activeWorkspaceId: 'aaaa1111-0000-0000-0000-000000000000',
        workspaces: [
          {
            id: 'aaaa1111-0000-0000-0000-000000000000',
            name: 'My Workspace',
            createdAt: T0,
            lastOpenedAt: T0,
          },
          {
            id: 'bbbb2222-0000-0000-0000-000000000000',
            name: 'my workspace',
            createdAt: T0,
            lastOpenedAt: T0,
          },
          {
            // Sibling with a UNIQUE name — must NOT get a suffix.
            id: 'cccc3333-0000-0000-0000-000000000000',
            name: 'Beta',
            createdAt: T0,
            lastOpenedAt: T0,
          },
        ],
      },
    });
    const trigger = await screen.findByRole('button', { name: /Switch workspace/ });
    await userEvent.click(trigger);

    // Both colliding rows show the id suffix in their accessible
    // name; the unique row does not.
    expect(
      screen.getByRole('option', { name: /Switch to My Workspace \(id aaaa\)/ }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('option', { name: /Switch to my workspace \(id bbbb\)/ }),
    ).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Switch to Beta' })).toBeInTheDocument();

    // And the visual `#xxxx` chip renders for both collisions.
    const list = screen.getByRole('listbox', { name: 'Workspaces' });
    expect(within(list).getByText('#aaaa')).toBeInTheDocument();
    expect(within(list).getByText('#bbbb')).toBeInTheDocument();
    expect(within(list).queryByText('#cccc')).toBeNull();
  });
});

describe('WorkspaceSwitcher access policy', () => {
  const registryOf = (...ids: string[]) => ({
    schemaVersion: 1 as const,
    activeWorkspaceId: ids[0],
    workspaces: ids.map((id, i) => ({
      id,
      name: id.toUpperCase(),
      // Ascending createdAt, so `ids[0]` is the oldest and stays unlocked.
      createdAt: `2026-05-2${i + 1}T00:00:00.000Z`,
      lastOpenedAt: T0,
    })),
  });

  async function openWith(max: number, ...ids: string[]) {
    await renderWithStore(
      <WorkspaceAccessProvider value={{ maxWorkspaces: max }}>
        <WorkspaceSwitcher />
      </WorkspaceAccessProvider>,
    );
    useWorkspaceStore.setState({ workspaceRegistry: registryOf(...ids) });
    await userEvent.click(await screen.findByRole('button', { name: /Switch workspace/ }));
  }

  it('locks every workspace past the cap, oldest first', async () => {
    await openWith(1, 'ws-a', 'ws-b', 'ws-c');
    expect(screen.getByRole('option', { name: 'Switch to WS-A' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'WS-B (locked)' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'WS-C (locked)' })).toBeInTheDocument();
  });

  it('unlocks exactly the cap, not one more', async () => {
    await openWith(2, 'ws-a', 'ws-b', 'ws-c');
    expect(screen.getByRole('option', { name: 'Switch to WS-A' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Switch to WS-B' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'WS-C (locked)' })).toBeInTheDocument();
  });

  it('keeps the open workspace unlocked when it sits past the cap', async () => {
    // The user is in WS-C, the newest. The cap locks the others instead of it.
    await renderWithStore(
      <WorkspaceAccessProvider value={{ maxWorkspaces: 1 }}>
        <WorkspaceSwitcher />
      </WorkspaceAccessProvider>,
    );
    useWorkspaceStore.setState({
      workspaceRegistry: { ...registryOf('ws-a', 'ws-b', 'ws-c'), activeWorkspaceId: 'ws-c' },
    });
    await userEvent.click(
      await screen.findByRole('button', { name: 'Switch workspace (current: WS-C)' }),
    );
    const open = screen.getByRole('option', { name: 'Switch to WS-C' });
    expect(open).toHaveAttribute('aria-selected', 'true');
    expect(within(open).getByText('active')).toBeInTheDocument();
    expect(within(open).queryByText('locked')).not.toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'WS-A (locked)' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'WS-B (locked)' })).toBeInTheDocument();
    // The open workspace keeps its delete; the locked ones have none.
    expect(screen.getByRole('button', { name: 'Delete WS-C' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Delete WS-A' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Delete WS-B' })).not.toBeInTheDocument();
  });

  it('offers no delete on a locked row', async () => {
    // The user cannot open a locked workspace to see what is inside, so a
    // destructive action on it is not a choice they can make informedly.
    await openWith(1, 'ws-a', 'ws-b');
    expect(screen.queryByRole('button', { name: 'Delete WS-B' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Delete WS-A' })).toBeInTheDocument();
  });

  it('explains the lock instead of switching, says the data is safe, and links to the plans', async () => {
    await openWith(1, 'ws-a', 'ws-b');
    await userEvent.click(screen.getByRole('option', { name: 'WS-B (locked)' }));
    const notice = await screen.findByRole('dialog', { name: 'Workspace locked' });
    expect(
      within(notice).getByText(/Additional workspaces are locked on this plan\./),
    ).toBeInTheDocument();
    expect(within(notice).getByText(/Nothing has been deleted/)).toBeInTheDocument();
    // Its one action is the pricing page, which leads on to the account site.
    // Spelled out here, not read from `PRICING_URL`: a wrong constant must fail.
    const plans = within(notice).getByRole('link', { name: 'See plans' });
    expect(plans).toHaveAttribute('href', 'https://apicircle.dev/pricing');
    // A new window, not a navigation: a desktop build cancels navigations, and
    // hands an http(s) link like this one to the browser.
    expect(plans).toHaveAttribute('target', '_blank');
    expect(plans).toHaveAttribute('rel', 'noopener noreferrer');
    // It is the only link: the notice no longer sends people to our inbox.
    expect(within(notice).getAllByRole('link')).toEqual([plans]);
    expect(notice).not.toHaveTextContent(/contact@apicircle\.dev/);
    // It promises no date: the pricing release it once waited on has shipped.
    expect(notice).not.toHaveTextContent(/end of September/);
    // and it did NOT switch
    expect(useWorkspaceStore.getState().workspaceRegistry?.activeWorkspaceId).toBe('ws-a');
  });

  it("shows an edition's own notice in place of the default", async () => {
    // An edition with an upgrade path to offer replaces the default wholesale.
    await renderWithStore(
      <WorkspaceAccessProvider
        value={{ maxWorkspaces: 1, lockedNotice: <button type="button">Upgrade</button> }}
      >
        <WorkspaceSwitcher />
      </WorkspaceAccessProvider>,
    );
    useWorkspaceStore.setState({ workspaceRegistry: registryOf('ws-a') });
    await userEvent.click(await screen.findByRole('button', { name: /Switch workspace/ }));
    await userEvent.click(screen.getByRole('button', { name: 'New workspace (locked)' }));
    const notice = await screen.findByRole('dialog', { name: 'Workspace locked' });
    expect(within(notice).getByRole('button', { name: 'Upgrade' })).toBeInTheDocument();
    expect(within(notice).queryByText(/Additional workspaces are locked/)).not.toBeInTheDocument();
  });

  it('locks the create affordance at the cap', async () => {
    await openWith(1, 'ws-a');
    expect(screen.getByRole('button', { name: 'New workspace (locked)' })).toBeInTheDocument();
  });

  it('offers the create affordance below the cap', async () => {
    await openWith(3, 'ws-a');
    expect(screen.getByRole('button', { name: 'New workspace' })).toBeInTheDocument();
  });

  it('renders every row unlocked when the policy is unlimited', async () => {
    await openWith(Infinity, 'ws-a', 'ws-b', 'ws-c');
    expect(screen.queryByText('locked')).not.toBeInTheDocument();
  });
});

describe('WorkspaceSwitcher new-workspace busy state', () => {
  // While `createNewWorkspace` runs, Create workspace shows the brand loader in
  // place of its icon, reads "Creating…", and is disabled and `aria-busy`. The
  // tests hold that promise open to look at the busy render, then settle it.

  type CreateNewWorkspace = (name: string, maxWorkspaces?: number) => Promise<string>;

  function held(): {
    create: ReturnType<typeof vi.fn<CreateNewWorkspace>>;
    resolve: (id: string) => void;
    reject: (reason: Error) => void;
  } {
    let resolve!: (id: string) => void;
    let reject!: (reason: Error) => void;
    const promise = new Promise<string>((res, rej) => {
      resolve = res;
      reject = rej;
    });
    return { create: vi.fn<CreateNewWorkspace>(() => promise), resolve, reject };
  }

  /** Opens New workspace from the switcher, with `createNewWorkspace` swapped. */
  async function openNewWorkspace(createNewWorkspace: CreateNewWorkspace): Promise<HTMLElement> {
    await renderWithStore(<Unlimited />);
    useWorkspaceStore.setState({
      createNewWorkspace,
      workspaceRegistry: {
        schemaVersion: 1,
        activeWorkspaceId: 'ws-alpha',
        workspaces: [{ id: 'ws-alpha', name: 'Alpha', createdAt: T0, lastOpenedAt: T0 }],
      },
    });
    await userEvent.click(await screen.findByRole('button', { name: /Switch workspace/ }));
    await userEvent.click(screen.getByRole('button', { name: 'New workspace' }));
    return screen.findByRole('dialog', { name: 'New workspace' });
  }

  function expectBusy(button: HTMLElement): void {
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute('aria-busy', 'true');
    expect(button.querySelector('svg[data-brand-loader]')).not.toBeNull();
    expect(button.querySelector('svg:not([data-brand-loader])')).toBeNull();
  }

  function expectIdle(button: HTMLElement): void {
    expect(button).not.toHaveAttribute('aria-busy');
    expect(button.querySelector('svg[data-brand-loader]')).toBeNull();
    expect(button.querySelector('svg:not([data-brand-loader])')).not.toBeNull();
  }

  it('is idle, and disabled until a name is typed', async () => {
    const { create } = held();
    const dialog = await openNewWorkspace(create);
    const button = within(dialog).getByRole('button', { name: 'Create workspace' });
    expectIdle(button);
    expect(button).toBeDisabled();

    await userEvent.type(within(dialog).getByLabelText('New workspace name'), 'Payments API');
    expectIdle(button);
    expect(button).toBeEnabled();
    expect(create).not.toHaveBeenCalled();
  });

  it('shows Creating… with the loader while the workspace is created, then closes', async () => {
    const { create, resolve } = held();
    const dialog = await openNewWorkspace(create);
    const input = within(dialog).getByLabelText('New workspace name');
    await userEvent.type(input, 'Payments API');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Create workspace' }));

    const creating = within(dialog).getByRole('button', { name: 'Creating…' });
    expectBusy(creating);
    expect(
      within(dialog).queryByRole('button', { name: 'Create workspace' }),
    ).not.toBeInTheDocument();
    expect(create).toHaveBeenCalledWith('Payments API', Infinity);
    // Neither a second click nor Enter in the name field starts another create.
    await userEvent.click(creating);
    await userEvent.type(input, '{Enter}');
    expect(create).toHaveBeenCalledTimes(1);

    await act(async () => resolve('ws-payments'));

    expect(screen.queryByRole('dialog', { name: 'New workspace' })).not.toBeInTheDocument();

    // Opened again, the modal starts over: an empty name and an idle button.
    await userEvent.click(screen.getByRole('button', { name: /Switch workspace/ }));
    await userEvent.click(screen.getByRole('button', { name: 'New workspace' }));
    const reopened = await screen.findByRole('dialog', { name: 'New workspace' });
    expect(within(reopened).getByLabelText('New workspace name')).toHaveValue('');
    const button = within(reopened).getByRole('button', { name: 'Create workspace' });
    expectIdle(button);
    expect(button).toBeDisabled();
  });

  it('returns to an enabled, idle Create workspace with the error when creating fails', async () => {
    const { create, reject } = held();
    const dialog = await openNewWorkspace(create);
    await userEvent.type(within(dialog).getByLabelText('New workspace name'), 'Alpha{Enter}');
    expect(create).toHaveBeenCalledWith('Alpha', Infinity);
    expectBusy(within(dialog).getByRole('button', { name: 'Creating…' }));

    await act(async () => reject(new Error('A workspace named "Alpha" already exists')));

    expect(within(dialog).getByRole('alert')).toHaveTextContent(
      'A workspace named "Alpha" already exists',
    );
    const button = within(dialog).getByRole('button', { name: 'Create workspace' });
    expectIdle(button);
    // The name is kept, so the user can fix it and try again.
    expect(button).toBeEnabled();
    expect(within(dialog).getByLabelText('New workspace name')).toHaveValue('Alpha');
  });
});
