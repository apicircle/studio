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

  describe('placement', () => {
    const BASE =
      'pointer-events-none absolute z-50 w-max max-w-xs rounded-sm border border-border bg-card px-2 py-1 ' +
      'text-[0.6875rem] leading-snug text-text-primary shadow-md transition-opacity';

    // The centred placement every existing call site renders, pinned verbatim:
    // omitting `align` (or passing "center") must keep producing exactly these.
    const CENTRED = {
      top: 'bottom-full left-1/2 mb-1 -translate-x-1/2',
      bottom: 'top-full left-1/2 mt-1 -translate-x-1/2',
      left: 'right-full top-1/2 mr-1 -translate-y-1/2',
      right: 'left-full top-1/2 ml-1 -translate-y-1/2',
    } as const;

    it('defaults to the top side, centred', () => {
      render(
        <Tooltip content="tip">
          <button>T</button>
        </Tooltip>,
      );
      expect(screen.getByRole('tooltip').className).toBe(`${BASE} ${CENTRED.top} opacity-0`);
    });

    it.each(['top', 'bottom', 'left', 'right'] as const)(
      'keeps the centred %s classes unchanged when align is omitted or "center"',
      (side) => {
        const expected = `${BASE} ${CENTRED[side]} opacity-0`;
        const { unmount } = render(
          <Tooltip content="tip" side={side}>
            <button>T</button>
          </Tooltip>,
        );
        expect(screen.getByRole('tooltip').className).toBe(expected);
        unmount();

        render(
          <Tooltip content="tip" side={side} align="center">
            <button>T</button>
          </Tooltip>,
        );
        expect(screen.getByRole('tooltip').className).toBe(expected);
      },
    );

    it.each([
      ['top', 'start', 'bottom-full left-0 mb-1'],
      ['top', 'end', 'bottom-full right-0 mb-1'],
      ['bottom', 'start', 'top-full left-0 mt-1'],
      ['bottom', 'end', 'top-full right-0 mt-1'],
      ['left', 'start', 'right-full top-0 mr-1'],
      ['left', 'end', 'right-full bottom-0 mr-1'],
      ['right', 'start', 'left-full top-0 ml-1'],
      ['right', 'end', 'left-full bottom-0 ml-1'],
    ] as const)(
      'side="%s" align="%s" anchors to that edge instead of centring',
      (side, align, placement) => {
        render(
          <Tooltip content="tip" side={side} align={align}>
            <button>T</button>
          </Tooltip>,
        );
        const className = screen.getByRole('tooltip').className;
        expect(className).toBe(`${BASE} ${placement} opacity-0`);
        expect(className).not.toMatch(/translate|1\/2/);
      },
    );

    it('an edge-anchored tooltip still opens on hover', async () => {
      render(
        <Tooltip content="tip" side="bottom" align="end">
          <button>T</button>
        </Tooltip>,
      );
      await userEvent.hover(screen.getByRole('button', { name: 'T' }));
      expect(screen.getByRole('tooltip').className).toBe(
        `${BASE} top-full right-0 mt-1 opacity-100`,
      );
    });
  });
});
