import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { RightDockRail } from './RightDockRail';
import { renderWithStore } from '../../test/renderWithStore';
import { useWorkspaceStore } from '../store/workspaceStore';

describe('RightDockRail', () => {
  it('renders three icon buttons (Variables / Vault / Assets) labelled by accessible name', async () => {
    await renderWithStore(<RightDockRail />);
    expect(screen.getByRole('button', { name: /Open Variables/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Open Secret Vault/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Open Global Assets/ })).toBeInTheDocument();
  });

  it('clicking an icon opens that tab; clicking the same icon again closes the dock', async () => {
    await renderWithStore(<RightDockRail />);

    await userEvent.click(screen.getByRole('button', { name: /Open Variables/ }));
    expect(useWorkspaceStore.getState().rightDock.tab).toBe('variables');

    // Re-click — the aria-label flips to "Close Variables" while open.
    await userEvent.click(screen.getByRole('button', { name: /Close Variables/ }));
    expect(useWorkspaceStore.getState().rightDock.tab).toBe(null);
  });

  it('switches between tabs without closing the dock', async () => {
    await renderWithStore(<RightDockRail />);

    await userEvent.click(screen.getByRole('button', { name: /Open Variables/ }));
    expect(useWorkspaceStore.getState().rightDock.tab).toBe('variables');

    await userEvent.click(screen.getByRole('button', { name: /Open Secret Vault/ }));
    expect(useWorkspaceStore.getState().rightDock.tab).toBe('vault');
  });

  it('the active rail icon reflects aria-pressed', async () => {
    await renderWithStore(<RightDockRail />);

    await userEvent.click(screen.getByRole('button', { name: /Open Global Assets/ }));
    expect(screen.getByRole('button', { name: /Close Global Assets/ })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(screen.getByRole('button', { name: /Open Variables/ })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
  });
});
