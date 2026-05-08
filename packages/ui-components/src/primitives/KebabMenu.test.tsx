import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { KebabMenu } from './KebabMenu';

describe('KebabMenu', () => {
  it('renders the trigger with the supplied aria-label', () => {
    render(<KebabMenu ariaLabel="Folder actions" items={[]} />);
    expect(screen.getByRole('button', { name: 'Folder actions' })).toBeInTheDocument();
  });

  it('opens the menu on click and renders all enabled items', async () => {
    const onA = vi.fn();
    const onB = vi.fn();
    render(
      <KebabMenu
        ariaLabel="Test actions"
        items={[
          { id: 'a', label: 'Alpha', onSelect: onA },
          { id: 'b', label: 'Bravo', onSelect: onB },
        ]}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Test actions' }));
    const menu = await screen.findByRole('menu', { name: 'Test actions' });
    expect(menu).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'Alpha' })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'Bravo' })).toBeInTheDocument();
  });

  it('calls the item handler and closes the menu', async () => {
    const onA = vi.fn();
    render(
      <KebabMenu ariaLabel="Test actions" items={[{ id: 'a', label: 'Alpha', onSelect: onA }]} />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Test actions' }));
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Alpha' }));
    expect(onA).toHaveBeenCalledOnce();
    await waitFor(() => {
      expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    });
  });

  it('closes on Escape', async () => {
    render(
      <KebabMenu
        ariaLabel="Test actions"
        items={[{ id: 'a', label: 'Alpha', onSelect: vi.fn() }]}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Test actions' }));
    const menu = await screen.findByRole('menu');
    fireEvent.keyDown(menu, { key: 'Escape' });
    await waitFor(() => {
      expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    });
  });

  it('skips disabled items in keyboard navigation', async () => {
    render(
      <KebabMenu
        ariaLabel="Test actions"
        items={[
          { id: 'a', label: 'Alpha', onSelect: vi.fn(), disabled: true },
          { id: 'b', label: 'Bravo', onSelect: vi.fn() },
        ]}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Test actions' }));
    const bravo = await screen.findByRole('menuitem', { name: 'Bravo' });
    // Bravo is the first enabled item, so it gets initial focus.
    expect(bravo).toHaveAttribute('tabindex', '0');
  });

  it('does not invoke disabled item handlers', async () => {
    const onA = vi.fn();
    render(
      <KebabMenu
        ariaLabel="Test actions"
        items={[{ id: 'a', label: 'Alpha', onSelect: onA, disabled: true }]}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Test actions' }));
    const item = await screen.findByRole('menuitem', { name: 'Alpha' });
    fireEvent.click(item);
    expect(onA).not.toHaveBeenCalled();
  });

  it('renders danger items with the danger tone', async () => {
    render(
      <KebabMenu
        ariaLabel="Test actions"
        items={[{ id: 'd', label: 'Delete', onSelect: vi.fn(), tone: 'danger' }]}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Test actions' }));
    const item = await screen.findByRole('menuitem', { name: 'Delete' });
    expect(item.className).toMatch(/text-danger/);
  });
});
