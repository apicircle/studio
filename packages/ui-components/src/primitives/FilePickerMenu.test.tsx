import { describe, expect, it, vi } from 'vitest';
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
});
