import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { createEmptyWorkspace } from '../../persistence/workspaceStorage';
import { addFolder, addRequest } from '../../store/editorActions';
import { MoveToFolderDialog } from './MoveToFolderDialog';

function workspace() {
  const { synced } = createEmptyWorkspace();
  const { synced: a, folder: users } = addFolder(synced, null, 'Users');
  const { synced: b, folder: admin } = addFolder(a, users.id, 'Admin');
  const { synced: c, folder: orders } = addFolder(b, null, 'orders');
  const { synced: d, request } = addRequest(c, null, 'Health');
  return { synced: d, users, admin, orders, request };
}

describe('MoveToFolderDialog', () => {
  it('is shut while nothing is being moved', () => {
    const { synced } = workspace();
    render(<MoveToFolderDialog synced={synced} node={null} onClose={vi.fn()} onMove={vi.fn()} />);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('lists the top level, then every folder depth first and by name, indented', () => {
    const { synced, request } = workspace();
    render(
      <MoveToFolderDialog
        synced={synced}
        node={{ kind: 'request', id: request.id }}
        onClose={vi.fn()}
        onMove={vi.fn()}
      />,
    );
    const list = screen.getByRole('list', { name: 'Destinations' });
    const rows = within(list).getAllByRole('button');
    expect(rows.map((row) => row.textContent)).toEqual([
      'Top levelThe request is here now.',
      'orders',
      'Users',
      'Admin',
    ]);
    expect(rows[3]).toHaveStyle({ paddingLeft: '1.375rem' });
  });

  it('narrows to the folders whose path matches, shown as paths', async () => {
    const { synced, request } = workspace();
    render(
      <MoveToFolderDialog
        synced={synced}
        node={{ kind: 'request', id: request.id }}
        onClose={vi.fn()}
        onMove={vi.fn()}
      />,
    );
    await userEvent.type(screen.getByLabelText('Filter folders'), 'admin');
    const rows = within(screen.getByRole('list', { name: 'Destinations' })).getAllByRole('button');
    expect(rows.map((row) => row.textContent)).toEqual(['Users / Admin']);
    await userEvent.clear(screen.getByLabelText('Filter folders'));
    await userEvent.type(screen.getByLabelText('Filter folders'), 'billing');
    expect(screen.getByText('No folder matches “billing”.')).toBeInTheDocument();
    expect(screen.queryByRole('list', { name: 'Destinations' })).toBeNull();
  });

  it('says there are no folders yet, and still offers what there is', () => {
    const { synced } = createEmptyWorkspace();
    const { synced: withFolderless, request } = addRequest(synced, null, 'Health');
    render(
      <MoveToFolderDialog
        synced={withFolderless}
        node={{ kind: 'request', id: request.id }}
        onClose={vi.fn()}
        onMove={vi.fn()}
      />,
    );
    expect(
      screen.getByText('There are no folders yet. Make one with New folder in the Editor menu.'),
    ).toBeInTheDocument();
    expect(screen.queryByLabelText('Filter folders')).toBeNull();
    expect(screen.getByRole('button', { name: /^Top level/ })).toBeDisabled();
  });

  it('hands the pick to onMove, and Cancel to onClose', async () => {
    const { synced, users, orders } = workspace();
    const onMove = vi.fn();
    const onClose = vi.fn();
    render(
      <MoveToFolderDialog
        synced={synced}
        node={{ kind: 'folder', id: users.id }}
        onClose={onClose}
        onMove={onMove}
      />,
    );
    await userEvent.click(screen.getByRole('button', { name: 'orders' }));
    expect(onMove).toHaveBeenCalledWith({ kind: 'folder', id: users.id }, orders.id);
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onClose).toHaveBeenCalled();
  });

  it('names nothing for a node that no longer exists', () => {
    const { synced } = workspace();
    render(
      <MoveToFolderDialog
        synced={synced}
        node={{ kind: 'folder', id: 'gone' }}
        onClose={vi.fn()}
        onMove={vi.fn()}
      />,
    );
    expect(screen.getByRole('dialog')).toHaveAccessibleName('Move “”');
    for (const row of within(screen.getByRole('list', { name: 'Destinations' })).getAllByRole(
      'button',
    )) {
      expect(row).toBeDisabled();
    }
  });
});
