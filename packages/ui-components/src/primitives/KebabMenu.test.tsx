import { afterEach, describe, expect, it, vi } from 'vitest';
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
  it('moves through items with the arrow keys, Home and End', async () => {
    render(
      <KebabMenu
        ariaLabel="Nav"
        items={[
          { id: 'a', label: 'Alpha', onSelect: vi.fn() },
          { id: 'b', label: 'Bravo', onSelect: vi.fn() },
          { id: 'c', label: 'Charlie', onSelect: vi.fn() },
        ]}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Nav' }));
    const menu = await screen.findByRole('menu');
    const item = (name: string) => screen.getByRole('menuitem', { name });
    await waitFor(() => expect(item('Alpha')).toHaveFocus());
    fireEvent.keyDown(menu, { key: 'ArrowDown' });
    expect(item('Bravo')).toHaveFocus();
    fireEvent.keyDown(menu, { key: 'ArrowUp' });
    expect(item('Alpha')).toHaveFocus();
    fireEvent.keyDown(menu, { key: 'ArrowUp' });
    expect(item('Charlie')).toHaveFocus();
    fireEvent.keyDown(menu, { key: 'Home' });
    expect(item('Alpha')).toHaveFocus();
    fireEvent.keyDown(menu, { key: 'End' });
    expect(item('Charlie')).toHaveFocus();
    expect(item('Charlie')).toHaveAttribute('tabindex', '0');
  });

  it('hands focus back to the trigger after an action that leaves it nowhere — and not after one that moves it', async () => {
    const frames: FrameRequestCallback[] = [];
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => {
      frames.push(cb);
      return frames.length;
    });
    const runFrames = () => {
      while (frames.length > 0) frames.shift()!(0);
    };
    render(
      <>
        <KebabMenu
          ariaLabel="Acts"
          items={[
            { id: 'a', label: 'Alpha', onSelect: vi.fn(), icon: <svg data-testid="alpha-icon" /> },
            {
              id: 'b',
              label: 'Rename',
              onSelect: () => screen.getByRole('textbox', { name: 'Name' }).focus(),
            },
          ]}
        />
        <input aria-label="Name" />
      </>,
    );
    const trigger = screen.getByRole('button', { name: 'Acts' });
    fireEvent.click(trigger);
    expect(await screen.findByTestId('alpha-icon')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Alpha' }));
    await waitFor(() => expect(screen.queryByRole('menu')).not.toBeInTheDocument());
    runFrames();
    expect(trigger).toHaveFocus();

    fireEvent.click(trigger);
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Rename' }));
    runFrames();
    expect(screen.getByRole('textbox', { name: 'Name' })).toHaveFocus();
    vi.restoreAllMocks();
  });

  describe('on the floating layer', () => {
    afterEach(() => vi.restoreAllMocks());

    const open = async () => {
      render(
        <>
          <div style={{ overflow: 'hidden' }}>
            <KebabMenu
              ariaLabel="Row actions"
              items={[{ id: 'a', label: 'Alpha', onSelect: vi.fn() }]}
            />
          </div>
          <button>Next control</button>
        </>,
      );
      const trigger = screen.getByRole('button', { name: 'Row actions' });
      fireEvent.click(trigger);
      return { trigger, menu: await screen.findByRole('menu', { name: 'Row actions' }) };
    };

    it('renders on the document body, out of a clipping sidebar, below the trigger', async () => {
      const { menu } = await open();
      expect(menu.parentElement).toBe(document.body);
      expect(menu).toHaveAttribute('data-side', 'bottom');
      expect(menu.style.position).toBe('fixed');
      expect(menu.className).toMatch(/z-\[55\]/);
    });

    it('closes on a press outside, but not on a press inside the portalled menu', async () => {
      const { menu } = await open();
      fireEvent.pointerDown(screen.getByRole('menuitem', { name: 'Alpha' }));
      expect(menu).toBeInTheDocument();
      fireEvent.pointerDown(screen.getByRole('button', { name: 'Next control' }));
      await waitFor(() => expect(screen.queryByRole('menu')).not.toBeInTheDocument());
    });

    it('Tab closes the menu and hands focus back to the trigger, so Tab moves on from there', async () => {
      const { trigger, menu } = await open();
      const notPrevented = fireEvent.keyDown(menu, { key: 'Tab' });
      expect(notPrevented).toBe(true);
      expect(trigger).toHaveFocus();
      await waitFor(() => expect(screen.queryByRole('menu')).not.toBeInTheDocument());
    });

    it('Shift+Tab closes the menu and stops on the trigger', async () => {
      const { trigger, menu } = await open();
      const notPrevented = fireEvent.keyDown(menu, { key: 'Tab', shiftKey: true });
      expect(notPrevented).toBe(false);
      expect(trigger).toHaveFocus();
      await waitFor(() => expect(screen.queryByRole('menu')).not.toBeInTheDocument());
    });

    it('closes when its trigger is scrolled out of view', async () => {
      vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (
        this: HTMLElement,
      ) {
        const b =
          this.getAttribute('aria-haspopup') === 'menu'
            ? { top: -200, left: 10, width: 24, height: 24 }
            : { top: 0, left: 0, width: 0, height: 0 };
        return {
          ...b,
          x: b.left,
          y: b.top,
          right: b.left + b.width,
          bottom: b.top + b.height,
        } as DOMRect;
      });
      render(
        <KebabMenu
          ariaLabel="Row actions"
          items={[{ id: 'a', label: 'Alpha', onSelect: vi.fn() }]}
        />,
      );
      fireEvent.click(screen.getByRole('button', { name: 'Row actions' }));
      await waitFor(() => expect(screen.queryByRole('menu')).not.toBeInTheDocument());
      expect(screen.getByRole('button', { name: 'Row actions' })).toHaveAttribute(
        'aria-expanded',
        'false',
      );
    });
  });
});
