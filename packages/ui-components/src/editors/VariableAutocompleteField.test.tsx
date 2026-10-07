import { useState } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { ResolutionScope } from '@apicircle/core';
import { VariableAutocompleteField } from './VariableAutocompleteField';

const scope: ResolutionScope = {
  contextVars: { CTX_VAR: 'one' },
  activeEnv: { BASE_URL: 'https://api.example.com', TOKEN: 'tok' },
  priorityEnvs: [],
  secrets: { SECRET_KEY: 'irrelevant' },
};

function Harness({
  initial = '',
  onChangeSpy,
}: {
  initial?: string;
  onChangeSpy?: (v: string) => void;
}) {
  const [value, setValue] = useState(initial);
  return (
    <VariableAutocompleteField
      value={value}
      onChange={(v) => {
        setValue(v);
        onChangeSpy?.(v);
      }}
      scope={scope}
      ariaLabel="URL"
    />
  );
}

describe('VariableAutocompleteField', () => {
  it('shows the listbox after `{{` is typed', async () => {
    render(<Harness />);
    const input = screen.getByLabelText('URL');
    await userEvent.click(input);
    await userEvent.type(input, '{{{{');
    expect(screen.getByRole('listbox', { name: 'URL suggestions' })).toBeInTheDocument();
    const options = screen.getAllByRole('option');
    const labels = options.map((o) => {
      const key = o.querySelector('span:first-child')?.textContent ?? '';
      const source = o.querySelector('span:last-child')?.textContent ?? '';
      return `${key} ${source}`.trim();
    });
    expect(labels).toEqual([
      'BASE_URL active-env',
      'CTX_VAR context',
      'SECRET_KEY secret',
      'TOKEN active-env',
    ]);
  });

  it('Tab inserts the highlighted suggestion', async () => {
    const spy = vi.fn();
    render(<Harness onChangeSpy={spy} />);
    const input = screen.getByLabelText('URL');
    await userEvent.click(input);
    await userEvent.type(input, '{{{{TOK');
    await userEvent.keyboard('{Tab}');
    expect(spy).toHaveBeenLastCalledWith('{{TOKEN}}');
  });

  it('Escape collapses the listbox', async () => {
    render(<Harness />);
    const input = screen.getByLabelText('URL');
    await userEvent.click(input);
    await userEvent.type(input, '{{{{');
    expect(screen.getByRole('listbox', { name: 'URL suggestions' })).toBeInTheDocument();
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });

  it('clicking a suggestion inserts it', async () => {
    const spy = vi.fn();
    render(<Harness onChangeSpy={spy} />);
    const input = screen.getByLabelText('URL');
    await userEvent.click(input);
    await userEvent.type(input, '{{{{');
    const option = screen.getByRole('option', { name: /CTX_VAR/ });
    await userEvent.click(option);
    expect(spy).toHaveBeenLastCalledWith('{{CTX_VAR}}');
  });

  // These fields live in scrolling tables inside resizable panels. A list drawn
  // inside the field was cut off by the first ancestor that clips.
  it('opens the list on the floating layer, outside any clipping ancestor, still wired to the field', async () => {
    render(
      <div style={{ overflow: 'hidden' }} data-testid="clip">
        <Harness />
      </div>,
    );
    const input = screen.getByLabelText('URL');
    await userEvent.click(input);
    await userEvent.type(input, '{{{{');
    const list = screen.getByRole('listbox', { name: 'URL suggestions' });
    expect(screen.getByTestId('clip').contains(list)).toBe(false);
    const popover = list.parentElement!;
    expect(popover.parentElement).toBe(document.body);
    expect(popover.style.position).toBe('fixed');
    expect(popover.className).toMatch(/z-\[55\]/);
    // Scrolls inside itself, capped by the layer rather than by a `max-h-*` class.
    expect(popover).toHaveClass('overflow-y-auto', 'min-w-[240px]');
    expect(popover.className).not.toMatch(/\bmax-h-/);
    expect(input).toHaveAttribute('aria-controls', list.id);
    expect(input).toHaveAttribute('aria-expanded', 'true');
  });

  it('closes when the field loses focus, so the list never outlives it over other content', async () => {
    render(
      <>
        <Harness />
        <button>elsewhere</button>
      </>,
    );
    const input = screen.getByLabelText('URL');
    await userEvent.click(input);
    await userEvent.type(input, '{{{{');
    expect(screen.getByRole('listbox')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'elsewhere' }));
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    // Typing again brings it back.
    await userEvent.click(input);
    await userEvent.type(input, 'B');
    expect(screen.getByRole('listbox')).toBeInTheDocument();
  });

  it('closes when the field scrolls out of view', async () => {
    const rect = vi
      .spyOn(HTMLElement.prototype, 'getBoundingClientRect')
      .mockImplementation(function (this: HTMLElement) {
        const b = this.classList.contains('relative')
          ? { top: -400, left: 20, width: 300, height: 32 }
          : { top: 0, left: 0, width: 0, height: 0 };
        return {
          ...b,
          x: b.left,
          y: b.top,
          right: b.left + b.width,
          bottom: b.top + b.height,
        } as DOMRect;
      });
    render(<Harness />);
    const input = screen.getByLabelText('URL');
    await userEvent.click(input);
    await userEvent.type(input, '{{{{');
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    rect.mockRestore();
  });
});
