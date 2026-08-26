import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
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

  it('offers no delete on a locked row', async () => {
    // The user cannot open a locked workspace to see what is inside, so a
    // destructive action on it is not a choice they can make informedly.
    await openWith(1, 'ws-a', 'ws-b');
    expect(screen.queryByRole('button', { name: 'Delete WS-B' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Delete WS-A' })).toBeInTheDocument();
  });

  it('explains the lock instead of switching, and says the data is safe', async () => {
    await openWith(1, 'ws-a', 'ws-b');
    await userEvent.click(screen.getByRole('option', { name: 'WS-B (locked)' }));
    expect(await screen.findByText(/end of September/)).toBeInTheDocument();
    expect(screen.getByText(/Nothing has been deleted/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'contact@apicircle.dev' })).toBeInTheDocument();
    // and it did NOT switch
    expect(useWorkspaceStore.getState().workspaceRegistry?.activeWorkspaceId).toBe('ws-a');
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
