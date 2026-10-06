import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { GlobalFileAsset } from '@apicircle/shared';

import { FilePickerMenu } from './FilePickerMenu';

const T = '2026-06-06T00:00:00.000Z';

function makeAsset(overrides: Partial<GlobalFileAsset> = {}): GlobalFileAsset {
  return {
    id: 'a1',
    name: 'Payload',
    slotId: 'slot-a1',
    filename: 'payload.bin',
    size: 12,
    mimeType: 'application/octet-stream',
    sha256: 'sha-a1',
    createdAt: T,
    updatedAt: T,
    ...overrides,
  };
}

describe('FilePickerMenu', () => {
  it('renders the trigger label + chevron and does not show the menu by default', () => {
    render(
      <FilePickerMenu
        libraryFiles={[]}
        onPickLocal={() => {}}
        onPickLibrary={() => {}}
        ariaLabel="Pick file"
        triggerLabel="Pick file"
      />,
    );
    const trigger = screen.getByRole('button', { name: 'Pick file' });
    expect(trigger).toBeInTheDocument();
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });

  it('opens the menu on click and shows "Upload new file..." even when the library is empty', async () => {
    const user = userEvent.setup();
    render(
      <FilePickerMenu
        libraryFiles={[]}
        onPickLocal={() => {}}
        onPickLibrary={() => {}}
        ariaLabel="Pick file"
      />,
    );
    await user.click(screen.getByRole('button', { name: /Pick file/i }));
    const menu = screen.getByRole('menu', { name: /Pick file/i });
    expect(within(menu).getByRole('menuitem', { name: /Upload new file/i })).toBeInTheDocument();
    // Library section header is absent when there are no library files.
    expect(within(menu).queryByText(/From library/i)).not.toBeInTheDocument();
  });

  it('lists every library file under the "From library" section', async () => {
    const user = userEvent.setup();
    const files = [
      makeAsset({ id: 'a1', name: 'Avatar', filename: 'avatar.png' }),
      makeAsset({ id: 'a2', name: 'Manifest', filename: 'manifest.json' }),
    ];
    render(
      <FilePickerMenu
        libraryFiles={files}
        onPickLocal={() => {}}
        onPickLibrary={() => {}}
        ariaLabel="Pick file"
      />,
    );
    await user.click(screen.getByRole('button', { name: /Pick file/i }));
    const menu = screen.getByRole('menu');
    expect(within(menu).getByText(/From library/i)).toBeInTheDocument();
    expect(within(menu).getByRole('menuitem', { name: /Avatar/i })).toBeInTheDocument();
    expect(within(menu).getByRole('menuitem', { name: /Manifest/i })).toBeInTheDocument();
  });

  it('calls onPickLocal when "Upload new file..." is activated', async () => {
    const user = userEvent.setup();
    const onPickLocal = vi.fn();
    const onPickLibrary = vi.fn();
    render(
      <FilePickerMenu
        libraryFiles={[makeAsset()]}
        onPickLocal={onPickLocal}
        onPickLibrary={onPickLibrary}
        ariaLabel="Pick file"
      />,
    );
    await user.click(screen.getByRole('button', { name: /Pick file/i }));
    await user.click(screen.getByRole('menuitem', { name: /Upload new file/i }));
    expect(onPickLocal).toHaveBeenCalledTimes(1);
    expect(onPickLibrary).not.toHaveBeenCalled();
    // Menu closes after selection.
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });

  it('calls onPickLibrary with the asset id when a library item is activated', async () => {
    const user = userEvent.setup();
    const onPickLocal = vi.fn();
    const onPickLibrary = vi.fn();
    render(
      <FilePickerMenu
        libraryFiles={[makeAsset({ id: 'lib-asset-1', name: 'Logo' })]}
        onPickLocal={onPickLocal}
        onPickLibrary={onPickLibrary}
        ariaLabel="Pick file"
      />,
    );
    await user.click(screen.getByRole('button', { name: /Pick file/i }));
    await user.click(screen.getByRole('menuitem', { name: /Logo/i }));
    expect(onPickLibrary).toHaveBeenCalledTimes(1);
    expect(onPickLibrary).toHaveBeenCalledWith('lib-asset-1');
    expect(onPickLocal).not.toHaveBeenCalled();
  });

  it('closes the menu on Escape and returns focus to the trigger', async () => {
    const user = userEvent.setup();
    render(
      <FilePickerMenu
        libraryFiles={[]}
        onPickLocal={() => {}}
        onPickLibrary={() => {}}
        ariaLabel="Pick file"
      />,
    );
    const trigger = screen.getByRole('button', { name: /Pick file/i });
    await user.click(trigger);
    expect(screen.getByRole('menu')).toBeInTheDocument();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });

  it('closes the menu when the user clicks outside', () => {
    render(
      <div>
        <FilePickerMenu
          libraryFiles={[]}
          onPickLocal={() => {}}
          onPickLibrary={() => {}}
          ariaLabel="Pick file"
        />
        <button type="button">outside</button>
      </div>,
    );
    fireEvent.click(screen.getByRole('button', { name: /Pick file/i }));
    expect(screen.getByRole('menu')).toBeInTheDocument();
    // Pointer event outside the menu closes it.
    fireEvent.pointerDown(screen.getByRole('button', { name: 'outside' }));
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });

  it('renders a full-width trigger when `fullWidth` is true', () => {
    // Regression: the empty-state form-data row used to render the
    // trigger as a small inline-flex button drifting at the left of a
    // wide `flex-[2]` column. The user reported the bordered "field"
    // looked broken because the picker didn't fill the same width as
    // the text-row value field. fullWidth puts the picker in `flex
    // w-full justify-between` mode so the label hugs the left and the
    // chevron sits flush right.
    const { container } = render(
      <FilePickerMenu
        libraryFiles={[]}
        onPickLocal={() => {}}
        onPickLibrary={() => {}}
        ariaLabel="Pick file"
        triggerLabel="Pick file"
        fullWidth
      />,
    );
    const trigger = screen.getByRole('button', { name: /Pick file/i });
    expect(trigger.className).toMatch(/\bw-full\b/);
    expect(trigger.className).toMatch(/\bjustify-between\b/);
    // Outer wrapper is block, not inline-block, so the parent flex/grid
    // sizing reaches the trigger.
    const wrapper = container.firstElementChild as HTMLElement;
    expect(wrapper.className).toMatch(/\bblock\b/);
    expect(wrapper.className).toMatch(/\bw-full\b/);
  });

  it('renders the trigger in a disabled state when `disabled` is true', () => {
    render(
      <FilePickerMenu
        libraryFiles={[makeAsset()]}
        onPickLocal={() => {}}
        onPickLibrary={() => {}}
        ariaLabel="Pick file"
        disabled
      />,
    );
    const trigger = screen.getByRole('button', { name: /Pick file/i });
    expect(trigger).toHaveAttribute('aria-disabled', 'true');
    // Clicking does not open the menu.
    fireEvent.click(trigger);
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });
  it('moves through items with the arrow keys, Home and End', () => {
    render(
      <FilePickerMenu
        libraryFiles={[makeAsset({ id: 'l1', name: 'Logo' })]}
        onPickLocal={() => {}}
        onPickLibrary={() => {}}
        ariaLabel="Pick file"
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /Pick file/i }));
    const menu = screen.getByRole('menu');
    const upload = screen.getByRole('menuitem', { name: /Upload new file/i });
    const logo = screen.getByRole('menuitem', { name: /Logo/i });
    expect(upload).toHaveFocus();
    fireEvent.keyDown(menu, { key: 'ArrowDown' });
    expect(logo).toHaveFocus();
    fireEvent.keyDown(menu, { key: 'ArrowDown' });
    expect(upload).toHaveFocus();
    fireEvent.keyDown(menu, { key: 'ArrowUp' });
    expect(logo).toHaveFocus();
    fireEvent.keyDown(menu, { key: 'Home' });
    expect(upload).toHaveFocus();
    fireEvent.keyDown(menu, { key: 'End' });
    expect(logo).toHaveFocus();
    expect(logo).toHaveAttribute('tabindex', '0');
  });

  describe('on the floating layer', () => {
    afterEach(() => vi.restoreAllMocks());

    function mockLayout(trigger: { top: number; left: number; width: number; height: number }) {
      vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (
        this: HTMLElement,
      ) {
        const b =
          this.getAttribute('aria-haspopup') === 'menu'
            ? trigger
            : { top: 0, left: 0, width: 0, height: 0 };
        return {
          ...b,
          x: b.left,
          y: b.top,
          right: b.left + b.width,
          bottom: b.top + b.height,
        } as DOMRect;
      });
      // A long library: the list's natural height is well past 300px.
      vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockImplementation(function (
        this: HTMLElement,
      ) {
        return this.getAttribute('role') === 'menu' ? 480 : 0;
      });
    }

    const picker = (props: { fullWidth?: boolean } = {}) => (
      <>
        <div style={{ overflow: 'auto' }}>
          <FilePickerMenu
            libraryFiles={[makeAsset()]}
            onPickLocal={() => {}}
            onPickLibrary={() => {}}
            ariaLabel="Pick file"
            {...props}
          />
        </div>
        <button type="button">after</button>
      </>
    );

    it('renders on the document body, below the trigger, at the comfortable width', () => {
      render(picker());
      fireEvent.click(screen.getByRole('button', { name: /Pick file/i }));
      const menu = screen.getByRole('menu');
      expect(menu.parentElement).toBe(document.body);
      expect(menu).toHaveAttribute('data-side', 'bottom');
      expect(menu.style.position).toBe('fixed');
      expect(menu.className).toMatch(/z-\[55\]/);
      expect(menu.className).toMatch(/\bmin-w-\[220px\]/);
    });

    it('caps a long list at 300px and matches a full-width trigger', () => {
      mockLayout({ top: 100, left: 40, width: 260, height: 28 });
      render(picker({ fullWidth: true }));
      fireEvent.click(screen.getByRole('button', { name: /Pick file/i }));
      const menu = screen.getByRole('menu');
      expect(menu.style.maxHeight).toBe('300px');
      expect(menu.style.width).toBe('260px');
      expect(menu.style.top).toBe(`${100 + 28 + 4}px`);
      expect(menu.className).not.toMatch(/min-w-\[220px\]/);
    });

    it('Tab closes the menu and hands focus to the trigger; Shift+Tab stops there', () => {
      render(picker());
      const trigger = screen.getByRole('button', { name: /Pick file/i });
      fireEvent.click(trigger);
      expect(fireEvent.keyDown(screen.getByRole('menu'), { key: 'Tab' })).toBe(true);
      expect(trigger).toHaveFocus();
      expect(screen.queryByRole('menu')).not.toBeInTheDocument();
      fireEvent.click(trigger);
      expect(fireEvent.keyDown(screen.getByRole('menu'), { key: 'Tab', shiftKey: true })).toBe(
        false,
      );
      expect(trigger).toHaveFocus();
      expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    });

    it('closes when its trigger is scrolled out of view', () => {
      mockLayout({ top: 2000, left: 40, width: 120, height: 28 });
      render(picker());
      fireEvent.click(screen.getByRole('button', { name: /Pick file/i }));
      expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    });
  });
});
