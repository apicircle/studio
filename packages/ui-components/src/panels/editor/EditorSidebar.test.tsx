import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { EditorSidebar } from './EditorSidebar';
import { renderWithStore } from '../../../test/renderWithStore';
import { useWorkspaceStore } from '../../store/workspaceStore';

// `aria-label` on the toolbar buttons gives us a stable handle that doesn't
// collide with the default "New request" text on the request row.
const toolbarNew = () => screen.getByLabelText('New request');
const toolbarFolder = () => screen.getByLabelText('New folder');

async function createRequestNamed(name: string): Promise<void> {
  await userEvent.click(toolbarNew());
  const input = screen.getByLabelText('New request name');
  await userEvent.type(input, name);
  await userEvent.keyboard('{Enter}');
}

async function createFolderNamed(name: string): Promise<void> {
  await userEvent.click(toolbarFolder());
  const input = screen.getByLabelText('New folder name');
  await userEvent.type(input, name);
  await userEvent.keyboard('{Enter}');
}

describe('EditorSidebar', () => {
  it('shows the empty-state hint when no requests exist', async () => {
    await renderWithStore(<EditorSidebar />);
    expect(screen.getByText(/No requests yet/i)).toBeInTheDocument();
  });

  it('clicking "New request" opens the name-first input', async () => {
    await renderWithStore(<EditorSidebar />);
    await userEvent.click(toolbarNew());
    expect(screen.getByLabelText('New request name')).toBeInTheDocument();
  });

  it('Esc cancels the name-first prompt without creating', async () => {
    await renderWithStore(<EditorSidebar />);
    await userEvent.click(toolbarNew());
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByLabelText('New request name')).toBeNull();
    expect(Object.keys(useWorkspaceStore.getState().synced!.collections.requests)).toHaveLength(0);
  });

  it('typing a name + Enter creates the request and renders it', async () => {
    await renderWithStore(<EditorSidebar />);
    await createRequestNamed('Auth login');
    const tree = screen.getByRole('tree', { name: 'Requests' });
    const items = within(tree).getAllByRole('treeitem');
    expect(items).toHaveLength(1);
    expect(items[0]).toHaveAttribute('aria-selected', 'true');
    expect(within(tree).getByText('Auth login')).toBeInTheDocument();
    expect(within(tree).getByText('GET')).toBeInTheDocument();
  });

  it('rejects a duplicate name in the same scope (input stays open with warning)', async () => {
    await renderWithStore(<EditorSidebar />);
    await createRequestNamed('login');
    await userEvent.click(toolbarNew());
    const input = screen.getByLabelText('New request name');
    await userEvent.type(input, 'login');
    expect(screen.getByText(/Name already used/i)).toBeInTheDocument();
    await userEvent.keyboard('{Enter}');
    // Still only one request exists.
    expect(Object.keys(useWorkspaceStore.getState().synced!.collections.requests)).toHaveLength(1);
  });

  it('clicking the row delete button removes the request', async () => {
    await renderWithStore(<EditorSidebar />);
    await createRequestNamed('My request');
    const id = useWorkspaceStore.getState().local!.ui.activeRequestId!;
    await userEvent.click(screen.getByLabelText('Delete My request'));
    expect(useWorkspaceStore.getState().synced!.collections.requests[id]).toBeUndefined();
    expect(screen.getByText(/No requests yet/i)).toBeInTheDocument();
  });

  it('clicking "New folder" prompts for name; typing + Enter creates it', async () => {
    await renderWithStore(<EditorSidebar />);
    await createFolderNamed('Auth');
    const tree = screen.getByRole('tree', { name: 'Requests' });
    expect(within(tree).getByText('Auth')).toBeInTheDocument();
  });

  it('children sort alphabetically within their parent', async () => {
    await renderWithStore(<EditorSidebar />);
    await createRequestNamed('zeta');
    await createRequestNamed('alpha');
    await createRequestNamed('mike');
    const tree = screen.getByRole('tree', { name: 'Requests' });
    const labels = within(tree)
      .getAllByRole('treeitem')
      .map((el) => el.textContent?.replace(/^GET/, '').trim() ?? '');
    expect(labels).toEqual(['alpha', 'mike', 'zeta']);
  });
});
