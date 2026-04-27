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

describe('EditorSidebar', () => {
  it('shows the empty-state hint when no requests exist', async () => {
    await renderWithStore(<EditorSidebar />);
    expect(screen.getByText(/No requests yet/i)).toBeInTheDocument();
  });

  it('clicking "New request" creates a request, selects it, and renders it in the tree', async () => {
    await renderWithStore(<EditorSidebar />);
    await userEvent.click(toolbarNew());
    const tree = screen.getByRole('tree', { name: 'Requests' });
    const items = within(tree).getAllByRole('treeitem');
    expect(items).toHaveLength(1);
    expect(items[0]).toHaveAttribute('aria-selected', 'true');
    expect(useWorkspaceStore.getState().local!.ui.activeRequestId).toBeTruthy();
  });

  it('renders method badge and request name', async () => {
    await renderWithStore(<EditorSidebar />);
    await userEvent.click(toolbarNew());
    const tree = screen.getByRole('tree', { name: 'Requests' });
    expect(within(tree).getByText('GET')).toBeInTheDocument();
    expect(within(tree).getByText('New request')).toBeInTheDocument();
  });

  it('clicking a request selects it', async () => {
    await renderWithStore(<EditorSidebar />);
    await userEvent.click(toolbarNew());
    await userEvent.click(toolbarNew());
    const tree = screen.getByRole('tree', { name: 'Requests' });
    const firstRow = within(tree).getAllByRole('treeitem')[0];
    await userEvent.click(within(firstRow).getByText('New request'));
    const ids = Object.keys(useWorkspaceStore.getState().synced!.collections.requests);
    expect(useWorkspaceStore.getState().local!.ui.activeRequestId).toBe(ids[0]);
  });

  it('clicking the row delete button removes the request', async () => {
    await renderWithStore(<EditorSidebar />);
    await userEvent.click(toolbarNew());
    const id = useWorkspaceStore.getState().local!.ui.activeRequestId!;
    await userEvent.click(screen.getByLabelText('Delete New request'));
    expect(useWorkspaceStore.getState().synced!.collections.requests[id]).toBeUndefined();
    expect(screen.getByText(/No requests yet/i)).toBeInTheDocument();
  });

  it('clicking "New folder" adds a folder entry', async () => {
    await renderWithStore(<EditorSidebar />);
    await userEvent.click(toolbarFolder());
    const tree = screen.getByRole('tree', { name: 'Requests' });
    expect(within(tree).getByText('New folder')).toBeInTheDocument();
  });
});
