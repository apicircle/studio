import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { WorkspaceSwitcher } from './WorkspaceSwitcher';
import { useWorkspaceStore } from '../store/workspaceStore';
import { renderWithStore } from '../../test/renderWithStore';

// Switcher's disambiguation logic — when two registry entries share a
// (case-insensitive) name, the dropdown appends a short `#xxxx` id
// suffix so the user can tell them apart. The 1.0.8 create + rename
// guards prevent NEW collisions, but pre-1.0.8 registries (e.g. the
// user's existing data with two "My Workspace" entries from a legacy-
// migration race) still render here.

const T0 = '2026-05-22T00:00:00.000Z';

describe('WorkspaceSwitcher disambiguation', () => {
  it('renders bare names when every workspace has a unique name', async () => {
    await renderWithStore(<WorkspaceSwitcher />);
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
    await renderWithStore(<WorkspaceSwitcher />);
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
