import { act, fireEvent, render, screen } from '@testing-library/react';
import { useRef, useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  FLOATING_Z,
  Z,
  computeAnchoredPosition,
  useAnchoredPosition,
  useDismissableLayer,
} from './floating';
import { FloatingPortal } from './FloatingPortal';
import type { AnchoredPositionInput, UseAnchoredPositionOptions } from './floating';

const VIEWPORT = { width: 1000, height: 800 };
const base = (over: Partial<AnchoredPositionInput>): AnchoredPositionInput => ({
  anchor: { top: 400, left: 500, width: 100, height: 20 },
  floating: { width: 60, height: 30 },
  viewport: VIEWPORT,
  side: 'bottom',
  align: 'start',
  ...over,
});

describe('computeAnchoredPosition', () => {
  it('keeps the requested placement when the anchor has no box', () => {
    expect(
      computeAnchoredPosition(
        base({ anchor: { top: 0, left: 0, width: 0, height: 0 }, side: 'top' }),
      ),
    ).toEqual({ top: 0, left: 0, side: 'top', align: 'start', room: null });
  });

  it.each([
    // side, align, expected top, expected left
    ['bottom', 'start', 400 + 20 + 4, 500],
    ['bottom', 'center', 424, 500 + (100 - 60) / 2],
    ['bottom', 'end', 424, 500 + 100 - 60],
    ['top', 'start', 400 - 4 - 30, 500],
    ['top', 'end', 366, 540],
    ['right', 'start', 400, 500 + 100 + 4],
    ['right', 'center', 400 + (20 - 30) / 2, 604],
    ['right', 'end', 400 + 20 - 30, 604],
    ['left', 'start', 400, 500 - 4 - 60],
  ] as const)('opens %s / %s next to the anchor', (side, align, top, left) => {
    const pos = computeAnchoredPosition(base({ side, align }));
    expect(pos).toMatchObject({ top, left, side, align });
  });

  it('reports the room on the used side', () => {
    expect(computeAnchoredPosition(base({ side: 'bottom' })).room).toBe(800 - 420 - 4 - 8);
    expect(computeAnchoredPosition(base({ side: 'top' })).room).toBe(400 - 4 - 8);
    expect(computeAnchoredPosition(base({ side: 'left' })).room).toBe(500 - 4 - 8);
    expect(computeAnchoredPosition(base({ side: 'right' })).room).toBe(1000 - 600 - 4 - 8);
  });

  it.each([
    ['top', { top: 10, left: 500, width: 100, height: 20 }, 'bottom'],
    ['bottom', { top: 770, left: 500, width: 100, height: 20 }, 'top'],
    ['left', { top: 400, left: 20, width: 100, height: 20 }, 'right'],
    ['right', { top: 400, left: 900, width: 90, height: 20 }, 'left'],
  ] as const)('flips from %s when it has no room there', (side, anchor, flipped) => {
    expect(computeAnchoredPosition(base({ side, anchor })).side).toBe(flipped);
  });

  it('stays put when flipping is turned off', () => {
    const pos = computeAnchoredPosition(
      base({ side: 'top', anchor: { top: 10, left: 500, width: 100, height: 20 }, flip: false }),
    );
    expect(pos.side).toBe('top');
    // …and is pulled back inside the viewport rather than drawn above it.
    expect(pos.top).toBe(8);
  });

  it('does not flip toward a side with even less room', () => {
    const pos = computeAnchoredPosition(
      base({
        side: 'top',
        anchor: { top: 60, left: 500, width: 100, height: 700 },
        floating: { width: 60, height: 200 },
      }),
    );
    expect(pos.side).toBe('top');
  });

  it('slides along the anchor to stay inside the viewport', () => {
    const right = computeAnchoredPosition(
      base({ anchor: { top: 400, left: 980, width: 10, height: 20 }, align: 'center' }),
    );
    expect(right.left).toBe(1000 - 8 - 60);
    const left = computeAnchoredPosition(
      base({ anchor: { top: 400, left: 2, width: 10, height: 20 }, align: 'end' }),
    );
    expect(left.left).toBe(8);
    const below = computeAnchoredPosition(
      base({
        side: 'right',
        anchor: { top: 790, left: 100, width: 10, height: 10 },
        align: 'start',
      }),
    );
    expect(below.top).toBe(800 - 8 - 30);
  });

  it('pins something wider than the viewport to the start edge', () => {
    const pos = computeAnchoredPosition(base({ floating: { width: 2000, height: 30 } }));
    expect(pos.left).toBe(8);
  });

  it('caps the main axis to the room when asked, so a long menu stays attached', () => {
    const anchor = { top: 700, left: 500, width: 100, height: 20 };
    const tall = { width: 60, height: 900 };
    const capped = computeAnchoredPosition(base({ anchor, floating: tall, capToRoom: true }));
    // Bottom has 68px, top has 688px: it flips up and ends right above the anchor.
    expect(capped.side).toBe('top');
    expect(capped.room).toBe(688);
    expect(capped.top).toBe(700 - 4 - 688);
    const sideways = computeAnchoredPosition(
      base({
        side: 'left',
        anchor: { top: 400, left: 300, width: 10, height: 10 },
        floating: { width: 900, height: 30 },
        capToRoom: true,
      }),
    );
    expect(sideways.side).toBe('right');
    expect(sideways.left).toBe(314);
  });
});

/** A small harness: a trigger with a floating element positioned by the hook. */
function Harness(props: Partial<UseAnchoredPositionOptions> & { open: boolean }) {
  const anchorRef = useRef<HTMLButtonElement | null>(null);
  const floatingRef = useRef<HTMLDivElement | null>(null);
  const { style, side, align, anchorHidden } = useAnchoredPosition(anchorRef, floatingRef, props);
  return (
    <>
      <button ref={anchorRef} data-anchor="">
        anchor
      </button>
      <div
        ref={floatingRef}
        data-testid="floating"
        data-side={side}
        data-align={align}
        data-hidden={anchorHidden}
        style={style}
      />
    </>
  );
}

describe('useAnchoredPosition', () => {
  let anchorBox = { top: 100, left: 100, width: 50, height: 20 };
  const floatingSize = { width: 120, height: 40 };
  const frames: FrameRequestCallback[] = [];

  function mockLayout() {
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (
      this: HTMLElement,
    ) {
      const b = this.hasAttribute('data-anchor')
        ? anchorBox
        : { top: 0, left: 0, width: 0, height: 0 };
      return {
        ...b,
        x: b.left,
        y: b.top,
        right: b.left + b.width,
        bottom: b.top + b.height,
      } as DOMRect;
    });
    vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockImplementation(function (
      this: HTMLElement,
    ) {
      return this.dataset.testid === 'floating' ? floatingSize.width : 0;
    });
    vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockImplementation(function (
      this: HTMLElement,
    ) {
      return this.dataset.testid === 'floating' ? floatingSize.height : 0;
    });
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => {
      frames.push(cb);
      return frames.length;
    });
    vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => {});
  }
  const flush = () =>
    act(() => {
      while (frames.length > 0) frames.shift()!(0);
    });

  afterEach(() => {
    anchorBox = { top: 100, left: 100, width: 50, height: 20 };
    frames.length = 0;
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('parks a closed element off screen with the requested placement', () => {
    render(<Harness open={false} side="left" align="end" />);
    const el = screen.getByTestId('floating');
    expect(el.style.position).toBe('fixed');
    expect(el.style.top).toBe('-10000px');
    expect(el).toHaveAttribute('data-side', 'left');
    expect(el).toHaveAttribute('data-align', 'end');
  });

  it('defaults to bottom / start and measures before paint when opened', () => {
    mockLayout();
    render(<Harness open />);
    const el = screen.getByTestId('floating');
    expect(el).toHaveAttribute('data-side', 'bottom');
    expect(el.style.top).toBe(`${100 + 20 + 4}px`);
    expect(el.style.left).toBe('100px');
    expect(el).toHaveAttribute('data-hidden', 'false');
  });

  it('sizes from the anchor width on request', () => {
    mockLayout();
    const { unmount } = render(<Harness open matchAnchorWidth="min" />);
    expect(screen.getByTestId('floating').style.minWidth).toBe('50px');
    unmount();
    render(<Harness open matchAnchorWidth="exact" />);
    expect(screen.getByTestId('floating').style.width).toBe('50px');
  });

  it('caps height for top/bottom and width for left/right when capToRoom is set', () => {
    mockLayout();
    const { unmount } = render(<Harness open capToRoom />);
    // jsdom viewport: 1024 × 768 → bottom room = 768 - 120 - 4 - 8.
    expect(screen.getByTestId('floating').style.maxHeight).toBe('636px');
    unmount();
    render(<Harness open capToRoom side="right" />);
    expect(screen.getByTestId('floating').style.maxWidth).toBe(`${1024 - 150 - 4 - 8}px`);
  });

  it('honours a max height in placement and style, and the smaller of it and the room', () => {
    mockLayout();
    // Natural height 40, capped to 20: opening upward ends right above the anchor.
    const { unmount } = render(<Harness open side="top" maxHeight={20} />);
    const el = screen.getByTestId('floating');
    expect(el.style.top).toBe(`${100 - 4 - 20}px`);
    expect(el.style.maxHeight).toBe('20px');
    unmount();
    // Room above is 100 - 4 - 8 = 88 — less than the 300 asked for.
    render(<Harness open side="top" capToRoom maxHeight={300} />);
    expect(screen.getByTestId('floating').style.maxHeight).toBe('88px');
  });

  it('does not cap when the anchor has no box to measure', () => {
    render(<Harness open capToRoom />);
    expect(screen.getByTestId('floating').style.maxHeight).toBe('');
  });

  it('re-measures once per frame on scroll and resize', () => {
    mockLayout();
    render(<Harness open />);
    anchorBox = { top: 300, left: 100, width: 50, height: 20 };
    act(() => {
      window.dispatchEvent(new Event('scroll'));
      window.dispatchEvent(new Event('resize'));
    });
    expect(frames).toHaveLength(1);
    flush();
    expect(screen.getByTestId('floating').style.top).toBe('324px');
    // Nothing moved: the same measurement keeps the same state.
    act(() => {
      window.dispatchEvent(new Event('resize'));
    });
    flush();
    expect(screen.getByTestId('floating').style.top).toBe('324px');
  });

  it('observes both elements for size changes and stops on close', () => {
    mockLayout();
    const observe = vi.fn();
    const disconnect = vi.fn();
    let notify: () => void = () => {};
    vi.stubGlobal(
      'ResizeObserver',
      class {
        constructor(cb: () => void) {
          notify = cb;
        }
        observe = observe;
        disconnect = disconnect;
      },
    );
    const { rerender } = render(<Harness open />);
    expect(observe).toHaveBeenCalledTimes(2);
    anchorBox = { top: 500, left: 100, width: 50, height: 20 };
    act(() => notify());
    flush();
    expect(screen.getByTestId('floating').style.top).toBe('524px');
    act(() => notify());
    rerender(<Harness open={false} />);
    expect(disconnect).toHaveBeenCalled();
    expect(window.cancelAnimationFrame).toHaveBeenCalled();
    expect(screen.getByTestId('floating').style.top).toBe('-10000px');
  });

  it('still tracks scrolls where ResizeObserver does not exist', () => {
    mockLayout();
    vi.stubGlobal('ResizeObserver', undefined);
    render(<Harness open />);
    anchorBox = { top: 250, left: 100, width: 50, height: 20 };
    act(() => {
      window.dispatchEvent(new Event('scroll'));
    });
    flush();
    expect(screen.getByTestId('floating').style.top).toBe('274px');
  });

  it('flags an anchor scrolled out of the viewport, or gone from the document', () => {
    mockLayout();
    anchorBox = { top: 900, left: 100, width: 50, height: 20 };
    render(<Harness open />);
    expect(screen.getByTestId('floating')).toHaveAttribute('data-hidden', 'true');

    function Detached() {
      const anchorRef = useRef<HTMLElement | null>(document.createElement('button'));
      const floatingRef = useRef<HTMLDivElement | null>(null);
      const { anchorHidden } = useAnchoredPosition(anchorRef, floatingRef, { open: true });
      return <div ref={floatingRef} data-testid="detached" data-hidden={anchorHidden} />;
    }
    render(<Detached />);
    expect(screen.getByTestId('detached')).toHaveAttribute('data-hidden', 'true');
  });

  it('does nothing until both elements exist', () => {
    function NoFloating() {
      const anchorRef = useRef<HTMLButtonElement | null>(null);
      const floatingRef = useRef<HTMLDivElement | null>(null);
      const { style } = useAnchoredPosition(anchorRef, floatingRef, { open: true });
      return (
        <button ref={anchorRef} data-testid="lonely" data-top={String(style.top)}>
          x
        </button>
      );
    }
    render(<NoFloating />);
    expect(screen.getByTestId('lonely')).toHaveAttribute('data-top', '-10000');
  });
});

describe('FloatingPortal', () => {
  it('renders into the document body', () => {
    render(
      <section data-testid="host">
        <FloatingPortal>
          <p>floating</p>
        </FloatingPortal>
      </section>,
    );
    expect(screen.getByText('floating').parentElement).toBe(document.body);
    expect(screen.getByTestId('host')).toBeEmptyDOMElement();
  });

  it('names a stacking level for menus and tooltips', () => {
    expect(FLOATING_Z).toEqual({ menu: 'z-[55]', tooltip: 'z-[70]' });
  });

  it('orders the whole stacking scale: panel layers, dock, banner, modal, menu, toast, tooltip', () => {
    const level = (cls: string) => Number(/\d+/.exec(cls)![0]);
    const order = [
      Z.paneSticky,
      Z.panelCard,
      Z.panelPopover,
      Z.banner,
      Z.modal,
      Z.menu,
      Z.toast,
      Z.tooltip,
    ].map(level);
    expect(order).toEqual([...order].sort((a, b) => a - b));
    expect(new Set(order).size).toBe(order.length);
    // The dock ties with a panel's own popover on purpose: a panel root is
    // `isolate`, so nothing inside one is ever compared with the dock.
    expect(Z.dock).toBe(Z.panelPopover);
    expect(FLOATING_Z).toEqual({ menu: Z.menu, tooltip: Z.tooltip });
  });
});

describe('useDismissableLayer', () => {
  function Popover({ onDismiss }: { onDismiss: () => void }) {
    const [open, setOpen] = useState(true);
    const layer = useDismissableLayer({
      open,
      onDismiss: () => {
        onDismiss();
        setOpen(false);
      },
    });
    return (
      <div {...layer}>
        <span>{open ? 'open' : 'closed'}</span>
        <FloatingPortal>
          <button>portalled option</button>
        </FloatingPortal>
      </div>
    );
  }

  it('treats a press in a portalled child as inside', () => {
    const onDismiss = vi.fn();
    render(<Popover onDismiss={onDismiss} />);
    fireEvent.pointerDown(screen.getByRole('button', { name: 'portalled option' }));
    expect(onDismiss).not.toHaveBeenCalled();
    expect(screen.getByText('open')).toBeInTheDocument();
  });

  it('dismisses on a press outside, once, then stops listening', () => {
    const onDismiss = vi.fn();
    render(
      <>
        <Popover onDismiss={onDismiss} />
        <button>elsewhere</button>
      </>,
    );
    fireEvent.pointerDown(screen.getByRole('button', { name: 'elsewhere' }));
    expect(onDismiss).toHaveBeenCalledOnce();
    expect(screen.getByText('closed')).toBeInTheDocument();
    fireEvent.pointerDown(screen.getByRole('button', { name: 'elsewhere' }));
    expect(onDismiss).toHaveBeenCalledOnce();
  });

  it('calls the latest onDismiss', () => {
    const first = vi.fn();
    const second = vi.fn();
    function Swapping() {
      const [which, setWhich] = useState<'first' | 'second'>('first');
      const layer = useDismissableLayer({
        open: true,
        onDismiss: which === 'first' ? first : second,
      });
      return (
        <div {...layer}>
          <button onClick={() => setWhich('second')}>swap</button>
        </div>
      );
    }
    render(
      <>
        <Swapping />
        <button>outside</button>
      </>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'swap' }));
    fireEvent.pointerDown(screen.getByRole('button', { name: 'outside' }));
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledOnce();
  });
});
