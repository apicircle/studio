import { act, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { EditorSidebar } from './EditorSidebar';
import { renderWithStore } from '../../../test/renderWithStore';
import { useWorkspaceStore } from '../../store/workspaceStore';

// The Editor sidebar's "New Request" / "New Folder" / "Import" actions live
// in a kebab menu rendered by Sidebar.tsx (next to the panel label) — not
// inside <EditorSidebar /> itself. Tests drive them through the lifted store
// state so they don't depend on the kebab's render location.
const triggerNewRequest = () =>
  act(() => {
    useWorkspaceStore.getState().setEditorPendingCreate({ kind: 'request', parentId: null });
  });
const triggerNewFolder = () =>
  act(() => {
    useWorkspaceStore.getState().setEditorPendingCreate({ kind: 'folder', parentId: null });
  });

async function createRequestNamed(name: string): Promise<void> {
  triggerNewRequest();
  const input = screen.getByLabelText('Inline rename request');
  await userEvent.type(input, name);
  await userEvent.keyboard('{Enter}');
}

async function createFolderNamed(name: string): Promise<void> {
  triggerNewFolder();
  const input = screen.getByLabelText('Inline rename folder');
  await userEvent.type(input, name);
  await userEvent.keyboard('{Enter}');
}

describe('EditorSidebar', () => {
  it('shows the empty-state hint when no requests exist', async () => {
    await renderWithStore(<EditorSidebar />);
    expect(screen.getByText(/No requests yet/i)).toBeInTheDocument();
  });

  it('triggering "New request" opens the name-first input', async () => {
    await renderWithStore(<EditorSidebar />);
    triggerNewRequest();
    expect(screen.getByLabelText('Inline rename request')).toBeInTheDocument();
  });

  it('Esc cancels the name-first prompt without creating', async () => {
    await renderWithStore(<EditorSidebar />);
    triggerNewRequest();
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByLabelText('Inline rename request')).toBeNull();
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
    triggerNewRequest();
    const input = screen.getByLabelText('Inline rename request');
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
    // Open the kebab, then activate the Delete entry.
    await userEvent.click(screen.getByLabelText('Request actions for My request'));
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Delete request' }));
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
