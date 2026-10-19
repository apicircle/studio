import { act, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { EditorSidebar } from './EditorSidebar';
import { renderWithStore } from '../../../test/renderWithStore';
import { useWorkspaceStore } from '../../store/workspaceStore';

// "Move to…" on a request's and a folder's row menu (STU-UX-8).

async function seed(): Promise<{ users: string; admin: string; orders: string; list: string }> {
  let ids = { users: '', admin: '', orders: '', list: '' };
  await act(async () => {
    const store = useWorkspaceStore.getState();
    const users = store.addFolder(null, 'Users');
    const admin = store.addFolder(users, 'Admin');
    const orders = store.addFolder(null, 'Orders');
    const list = store.addRequest(null, 'List users');
    ids = { users, admin, orders, list };
  });
  return ids;
}

async function openMove(rowMenu: string): Promise<HTMLElement> {
  await userEvent.click(screen.getByRole('button', { name: rowMenu }));
  await userEvent.click(screen.getByRole('menuitem', { name: 'Move to…' }));
  return screen.getByRole('dialog');
}

const destination = (dialog: HTMLElement, name: string) =>
  within(dialog).getByRole('button', { name: new RegExp(`^${name}`) });

describe('EditorSidebar — Move to…', () => {
  it('moves a request into a folder, opens the way to it, and says where it went', async () => {
    await renderWithStore(<EditorSidebar />);
    const { users, list } = await seed();
    const dialog = await openMove('Request actions for List users');
    expect(dialog).toHaveAccessibleName('Move “List users”');
    expect(within(dialog).getByText('Pick where the request goes.')).toBeInTheDocument();
    // Where it is now cannot be picked, and says so on its row.
    const top = destination(dialog, 'Top level');
    expect(top).toBeDisabled();
    expect(top).toHaveAccessibleDescription('The request is here now.');

    await userEvent.click(destination(dialog, 'Users'));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(useWorkspaceStore.getState().synced!.collections.requests[list].folderId).toBe(users);
    // The folder it went into is open, so the request is still in sight.
    expect(screen.getByRole('button', { name: 'Collapse Users' })).toBeInTheDocument();
    expect(screen.getByText('List users')).toBeInTheDocument();
    expect(useWorkspaceStore.getState().toasts.at(-1)).toMatchObject({
      tone: 'success',
      title: 'Moved “List users” to “Users”',
    });
  });

  it('moves a folder to the top level, and keeps it out of itself', async () => {
    await renderWithStore(<EditorSidebar />);
    const { admin } = await seed();
    await userEvent.click(screen.getByRole('button', { name: 'Expand Users' }));
    const dialog = await openMove('Folder actions for Admin');
    expect(
      within(dialog).getByText('Pick where the folder goes. Everything in it moves with it.'),
    ).toBeInTheDocument();
    expect(destination(dialog, 'Admin')).toHaveAccessibleDescription(
      'A folder can’t go inside itself.',
    );
    expect(destination(dialog, 'Users')).toHaveAccessibleDescription('The folder is here now.');

    await userEvent.click(destination(dialog, 'Top level'));
    expect(useWorkspaceStore.getState().synced!.collections.folders[admin].parentId).toBeNull();
    const tree = screen.getByRole('tree', { name: 'Requests' });
    expect(within(tree).getByRole('button', { name: 'Expand Admin' })).toBeInTheDocument();
    expect(useWorkspaceStore.getState().toasts.at(-1)?.title).toBe(
      'Moved “Admin” to the top level',
    );
  });

  it('opens the way down through every folder above where it went', async () => {
    await renderWithStore(<EditorSidebar />);
    const { admin, list } = await seed();
    const dialog = await openMove('Request actions for List users');
    await userEvent.click(destination(dialog, 'Admin'));
    expect(useWorkspaceStore.getState().synced!.collections.requests[list].folderId).toBe(admin);
    expect(screen.getByRole('button', { name: 'Collapse Users' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Collapse Admin' })).toBeInTheDocument();
  });

  it('leaves everything as it was when the dialog is cancelled', async () => {
    await renderWithStore(<EditorSidebar />);
    const { list } = await seed();
    const before = useWorkspaceStore.getState().synced;
    const dialog = await openMove('Request actions for List users');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(useWorkspaceStore.getState().synced).toBe(before);
    expect(useWorkspaceStore.getState().synced!.collections.requests[list].folderId).toBeNull();
  });

  it('a row turns unavailable, with its reason, when its name is taken while the dialog is open', async () => {
    await renderWithStore(<EditorSidebar />);
    const { users } = await seed();
    const dialog = await openMove('Request actions for List users');
    await act(async () => {
      useWorkspaceStore.getState().addRequest(users, 'List users');
    });
    const target = destination(dialog, 'Users');
    expect(target).toBeDisabled();
    expect(target).toHaveAccessibleDescription('A request named “List users” is already there.');
  });

  it('claims no move the store refused', async () => {
    await renderWithStore(<EditorSidebar />);
    await seed();
    const toasts = useWorkspaceStore.getState().toasts.length;
    useWorkspaceStore.setState({ moveRequest: () => false });
    const dialog = await openMove('Request actions for List users');
    await userEvent.click(destination(dialog, 'Orders'));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(useWorkspaceStore.getState().toasts).toHaveLength(toasts);
    expect(screen.queryByRole('button', { name: 'Collapse Orders' })).toBeNull();
  });
});
