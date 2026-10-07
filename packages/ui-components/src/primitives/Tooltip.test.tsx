import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
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

  describe('a disabled trigger', () => {
    // A disabled button takes no pointer or focus events, so a tooltip that
    // listens on the button can never explain why it is disabled.
    function renderDisabled() {
      render(
        <Tooltip content="Add an API key first">
          <button disabled className="h-7">
            Index with AI
          </button>
        </Tooltip>,
      );
      const btn = screen.getByRole('button', { name: 'Index with AI' });
      return { btn, wrapper: btn.parentElement!, tip: screen.getByRole('tooltip') };
    }

    it('opens when the pointer is over it — the wrapper is the hit target', async () => {
      const { btn, wrapper, tip } = renderDisabled();
      expect(btn).toHaveClass('pointer-events-none', 'h-7');
      expect(wrapper).toHaveClass('cursor-not-allowed');
      expect(tip.className).toMatch(/\bopacity-0\b/);
      await userEvent.hover(wrapper);
      expect(tip.className).toMatch(/\bopacity-100\b/);
      await userEvent.unhover(wrapper);
      expect(tip.className).toMatch(/\bopacity-0\b/);
    });

    it('gives the keyboard a tab stop in the button’s place', async () => {
      const { wrapper, tip } = renderDisabled();
      expect(wrapper).toHaveAttribute('tabindex', '0');
      await userEvent.tab();
      expect(wrapper).toHaveFocus();
      expect(tip.className).toMatch(/\bopacity-100\b/);
      await userEvent.tab();
      expect(tip.className).toMatch(/\bopacity-0\b/);
    });

    it('is described by the tooltip at all times, not only while it shows', () => {
      const { btn, tip } = renderDisabled();
      expect(btn).toHaveAttribute('aria-describedby', tip.id);
    });

    it('an enabled trigger keeps its own tab stop and pointer', () => {
      render(
        <Tooltip content="tip">
          <button className="h-7">Go</button>
        </Tooltip>,
      );
      const btn = screen.getByRole('button', { name: 'Go' });
      expect(btn.parentElement).not.toHaveAttribute('tabindex');
      expect(btn.parentElement).not.toHaveClass('cursor-not-allowed');
      expect(btn).not.toHaveClass('pointer-events-none');
    });
  });

  describe('a trigger that opens a menu', () => {
    // The menu opens where the tooltip would be, and the tooltip stacks above
    // menus — left open, it covers the first items of what the user just opened.
    it.each([[true], ['true']] as const)(
      'stays shut while the trigger reports aria-expanded=%s',
      async (expanded) => {
        render(
          <Tooltip content="Chat options">
            <button aria-haspopup="menu" aria-expanded={expanded}>
              Options
            </button>
          </Tooltip>,
        );
        const btn = screen.getByRole('button', { name: 'Options' });
        await userEvent.hover(btn);
        expect(screen.getByRole('tooltip').className).toMatch(/\bopacity-0\b/);
        expect(btn).not.toHaveAttribute('aria-describedby');
      },
    );

    it('opens as usual while the menu is closed', async () => {
      render(
        <Tooltip content="Chat options">
          <button aria-haspopup="menu" aria-expanded={false}>
            Options
          </button>
        </Tooltip>,
      );
      await userEvent.hover(screen.getByRole('button', { name: 'Options' }));
      expect(screen.getByRole('tooltip').className).toMatch(/\bopacity-100\b/);
    });

    it.each(['listbox', 'dialog', true, 'true'] as const)(
      'counts any popup kind (aria-haspopup=%s)',
      async (kind) => {
        render(
          <Tooltip content="Pick a spec">
            <button aria-haspopup={kind} aria-expanded>
              Spec
            </button>
          </Tooltip>,
        );
        await userEvent.hover(screen.getByRole('button', { name: 'Spec' }));
        expect(screen.getByRole('tooltip').className).toMatch(/\bopacity-0\b/);
      },
    );

    // A row that expands in place opens nothing over its own hint, and the hint
    // ("examine this before you unblock it") is as true expanded as collapsed.
    it.each([[undefined], [false], ['false']] as const)(
      'a plain disclosure keeps its hint while expanded (aria-haspopup=%s)',
      async (kind) => {
        render(
          <Tooltip content="Examine the trace">
            <button aria-haspopup={kind} aria-expanded>
              GET /users
            </button>
          </Tooltip>,
        );
        await userEvent.hover(screen.getByRole('button', { name: 'GET /users' }));
        expect(screen.getByRole('tooltip').className).toMatch(/\bopacity-100\b/);
      },
    );
  });

  describe('disabled (the hint does not apply right now)', () => {
    it('mounts no tooltip and never opens, but keeps the trigger in place', async () => {
      const { rerender } = render(
        <Tooltip content="/api/articles/:slug" disabled className="min-w-0 flex-1">
          <button>Path</button>
        </Tooltip>,
      );
      const btn = screen.getByRole('button', { name: 'Path' });
      expect(screen.queryByRole('tooltip')).toBeNull();
      expect(btn.parentElement).toHaveClass('relative', 'inline-flex', 'min-w-0', 'flex-1');
      await userEvent.hover(btn);
      expect(screen.queryByRole('tooltip')).toBeNull();
      expect(btn).not.toHaveAttribute('aria-describedby');

      // Turning the hint on must not remount the trigger (it may hold focus).
      rerender(
        <Tooltip content="/api/articles/:slug" className="min-w-0 flex-1">
          <button>Path</button>
        </Tooltip>,
      );
      expect(screen.getByRole('button', { name: 'Path' })).toBe(btn);
      expect(screen.getByRole('tooltip')).toHaveTextContent('/api/articles/:slug');
      expect(btn.parentElement).toHaveClass('min-w-0', 'flex-1');
    });

    it('opens at once when the hint starts to apply under a pointer that is already there', async () => {
      // "Show the full text only when it is cut off" measures on hover — the
      // pointer is already inside by the time the answer is known.
      const { rerender } = render(
        <Tooltip content="full text" disabled>
          <button>Path</button>
        </Tooltip>,
      );
      const btn = screen.getByRole('button', { name: 'Path' });
      expect(btn.parentElement).not.toHaveAttribute('data-tooltip-anchor');
      await userEvent.hover(btn);
      rerender(
        <Tooltip content="full text">
          <button>Path</button>
        </Tooltip>,
      );
      const tip = screen.getByRole('tooltip');
      expect(tip.className).toMatch(/\bopacity-100\b/);
      expect(btn).toHaveAttribute('aria-describedby', tip.id);
      expect(btn.parentElement).toHaveAttribute('data-tooltip-anchor', tip.id);
    });

    it('leaves a disabled trigger alone: no stand-in tab stop, no borrowed pointer', () => {
      render(
        <Tooltip content="unused" disabled>
          <button disabled className="h-7">
            Off
          </button>
        </Tooltip>,
      );
      const btn = screen.getByRole('button', { name: 'Off' });
      expect(btn).not.toHaveClass('pointer-events-none');
      expect(btn).not.toHaveAttribute('aria-describedby');
      expect(btn.parentElement).not.toHaveAttribute('tabindex');
      expect(btn.parentElement).not.toHaveClass('cursor-not-allowed');
    });
  });

  describe('the floating layer', () => {
    // jsdom has no layout: give the trigger's wrapper a box on screen and the
    // tooltip a size, so placement can be computed the way a browser would.
    // The viewport is jsdom's 1024 × 768.
    interface Box {
      top: number;
      left: number;
      width: number;
      height: number;
    }
    let anchorBox: Box;
    const tipSize = { width: 80, height: 24 };
    const frames: FrameRequestCallback[] = [];

    function mockLayout(anchor: Box) {
      anchorBox = anchor;
      vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (
        this: HTMLElement,
      ) {
        const b = this.hasAttribute('data-tooltip-anchor')
          ? anchorBox
          : { top: 0, left: 0, width: 0, height: 0 };
        return {
          ...b,
          x: b.left,
          y: b.top,
          right: b.left + b.width,
          bottom: b.top + b.height,
          toJSON: () => b,
        } as DOMRect;
      });
      vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockImplementation(function (
        this: HTMLElement,
      ) {
        return this.getAttribute('role') === 'tooltip' ? tipSize.width : 0;
      });
      vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockImplementation(function (
        this: HTMLElement,
      ) {
        return this.getAttribute('role') === 'tooltip' ? tipSize.height : 0;
      });
      vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => {
        frames.push(cb);
        return frames.length;
      });
      vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => {});
    }

    function flushFrames() {
      act(() => {
        while (frames.length > 0) frames.shift()!(0);
      });
    }

    afterEach(() => {
      frames.length = 0;
      vi.restoreAllMocks();
    });

    function renderTip(
      props: {
        side?: 'top' | 'bottom' | 'left' | 'right';
        align?: 'start' | 'center' | 'end';
      } = {},
    ) {
      render(
        <div style={{ overflow: 'hidden' }}>
          <Tooltip content="Read the list again" {...props}>
            <button>Refresh</button>
          </Tooltip>
        </div>,
      );
      return {
        btn: screen.getByRole('button', { name: 'Refresh' }),
        tip: screen.getByRole('tooltip'),
      };
    }

    it('renders on the document body, out of the clipping ancestor, linked to its trigger', () => {
      const { btn, tip } = renderTip();
      expect(tip.parentElement).toBe(document.body);
      expect(btn.closest('div')!.contains(tip)).toBe(false);
      expect(btn.parentElement).toHaveAttribute('data-tooltip-anchor', tip.id);
      expect(tip.style.position).toBe('fixed');
    });

    it('waits off screen while closed, and sits above modals and toasts', () => {
      const { tip } = renderTip();
      expect(tip.className).toMatch(/\bopacity-0\b/);
      expect(tip.className).toMatch(/z-\[70\]/);
      expect(tip.style.top).toBe('-10000px');
    });

    it('keeps the requested placement when there is no layout to measure', async () => {
      const { btn, tip } = renderTip({ side: 'bottom', align: 'end' });
      expect(tip).toHaveAttribute('data-side', 'bottom');
      expect(tip).toHaveAttribute('data-align', 'end');
      await userEvent.hover(btn);
      expect(tip).toHaveAttribute('data-side', 'bottom');
      expect(tip.className).toMatch(/\bopacity-100\b/);
    });

    it('defaults to the top side, centred', () => {
      const { tip } = renderTip();
      expect(tip).toHaveAttribute('data-side', 'top');
      expect(tip).toHaveAttribute('data-align', 'center');
    });

    it('opens above its trigger, centred, 4px away', async () => {
      mockLayout({ top: 100, left: 100, width: 40, height: 20 });
      const { btn, tip } = renderTip();
      await userEvent.hover(btn);
      expect(tip).toHaveAttribute('data-side', 'top');
      expect(tip.style.top).toBe(`${100 - 4 - tipSize.height}px`);
      expect(tip.style.left).toBe(`${100 + (40 - tipSize.width) / 2}px`);
      expect(tip.className).toMatch(/\bopacity-100\b/);
    });

    it('flips below when there is no room above — the clipped refresh-button case', async () => {
      mockLayout({ top: 10, left: 300, width: 24, height: 24 });
      const { btn, tip } = renderTip();
      await userEvent.hover(btn);
      expect(tip).toHaveAttribute('data-side', 'bottom');
      expect(tip.style.top).toBe(`${10 + 24 + 4}px`);
    });

    it('slides back on screen instead of hanging off the right edge', async () => {
      mockLayout({ top: 300, left: 1000, width: 20, height: 20 });
      const { btn, tip } = renderTip();
      await userEvent.hover(btn);
      expect(tip.style.left).toBe(`${1024 - 8 - tipSize.width}px`);
    });

    it('lines up with one edge of the trigger for align="end"', async () => {
      mockLayout({ top: 300, left: 400, width: 100, height: 20 });
      const { btn, tip } = renderTip({ side: 'bottom', align: 'end' });
      await userEvent.hover(btn);
      expect(tip.style.left).toBe(`${400 + 100 - tipSize.width}px`);
      expect(tip.style.top).toBe(`${300 + 20 + 4}px`);
    });

    it('follows its trigger when an ancestor scrolls', async () => {
      mockLayout({ top: 300, left: 400, width: 40, height: 20 });
      const { btn, tip } = renderTip();
      await userEvent.hover(btn);
      expect(tip.style.top).toBe('272px');
      anchorBox = { top: 200, left: 400, width: 40, height: 20 };
      act(() => {
        btn.closest('div')!.dispatchEvent(new Event('scroll'));
      });
      flushFrames();
      expect(tip.style.top).toBe('172px');
    });

    it('hides while its trigger is scrolled out of view', async () => {
      mockLayout({ top: -100, left: 400, width: 40, height: 20 });
      const { btn, tip } = renderTip();
      await userEvent.hover(btn);
      expect(tip.className).toMatch(/\bopacity-0\b/);
    });
  });
});
