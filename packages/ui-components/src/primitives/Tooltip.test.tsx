import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { Tooltip } from './Tooltip';

describe('Tooltip', () => {
  it('renders the trigger and keeps the tooltip text in the DOM', () => {
    render(
      <Tooltip content="Sends the request">
        <button>Send</button>
      </Tooltip>,
    );
    expect(screen.getByRole('button', { name: 'Send' })).toBeInTheDocument();
    // present but hidden (opacity-0) so aria-describedby always resolves
    expect(screen.getByRole('tooltip')).toHaveTextContent('Sends the request');
  });

  it('describes rather than renames the trigger (name stays "Send")', () => {
    render(
      <Tooltip content="Sends with the active environment">
        <button>Send</button>
      </Tooltip>,
    );
    // The accessible NAME must remain the concise label, not the tooltip prose.
    expect(screen.getByRole('button', { name: 'Send' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /active environment/ })).toBeNull();
  });

  it('links via aria-describedby on hover', async () => {
    render(
      <Tooltip content="Helpful detail">
        <button>Act</button>
      </Tooltip>,
    );
    const btn = screen.getByRole('button', { name: 'Act' });
    expect(btn).not.toHaveAttribute('aria-describedby');
    await userEvent.hover(btn);
    const id = btn.getAttribute('aria-describedby');
    expect(id).toBeTruthy();
    expect(document.getElementById(id!)).toHaveTextContent('Helpful detail');
    await userEvent.unhover(btn);
    expect(btn).not.toHaveAttribute('aria-describedby');
  });

  it('also surfaces on keyboard focus, not just hover', async () => {
    render(
      <Tooltip content="Keyboard reachable">
        <button>Focusable</button>
      </Tooltip>,
    );
    const btn = screen.getByRole('button', { name: 'Focusable' });
    await userEvent.tab();
    expect(btn).toHaveFocus();
    expect(btn).toHaveAttribute('aria-describedby');
    await userEvent.tab();
    expect(btn).not.toHaveAttribute('aria-describedby');
  });

  it('preserves the child’s own handlers and describedby', async () => {
    const onFocus = vi.fn();
    const onBlur = vi.fn();
    const onMouseEnter = vi.fn();
    const onMouseLeave = vi.fn();
    render(
      <Tooltip content="tip">
        <button
          aria-describedby="pre"
          onFocus={onFocus}
          onBlur={onBlur}
          onMouseEnter={onMouseEnter}
          onMouseLeave={onMouseLeave}
        >
          C
        </button>
      </Tooltip>,
    );
    const btn = screen.getByRole('button', { name: 'C' });
    await userEvent.hover(btn);
    await userEvent.unhover(btn);
    await userEvent.tab(); // focus
    await userEvent.tab(); // blur
    expect(onMouseEnter).toHaveBeenCalledOnce();
    expect(onMouseLeave).toHaveBeenCalledOnce();
    expect(onFocus).toHaveBeenCalledOnce();
    expect(onBlur).toHaveBeenCalledOnce();
    // the pre-existing description is preserved (with or without the tooltip id)
    expect(btn.getAttribute('aria-describedby')).toMatch(/\bpre\b/);
  });
});
