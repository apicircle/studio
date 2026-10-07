import { createRef, useRef, useState } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AnchoredPopover } from './AnchoredPopover';

function mockAnchor(box: { top: number; left: number; width: number; height: number }) {
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (
    this: HTMLElement,
  ) {
    const b = this.dataset.anchor !== undefined ? box : { top: 0, left: 0, width: 0, height: 0 };
    return {
      ...b,
      x: b.left,
      y: b.top,
      right: b.left + b.width,
      bottom: b.top + b.height,
    } as DOMRect;
  });
}

function Harness({
  onAnchorHidden,
  popoverRef,
  side,
  align,
}: {
  onAnchorHidden?: () => void;
  popoverRef?: React.Ref<HTMLDivElement>;
  side?: 'top' | 'bottom';
  align?: 'start' | 'end';
}) {
  const anchorRef = useRef<HTMLButtonElement | null>(null);
  const [open, setOpen] = useState(false);
  return (
    <div style={{ overflow: 'hidden' }} data-testid="clip">
      <button ref={anchorRef} data-anchor="" onClick={() => setOpen((v) => !v)}>
        anchor
      </button>
      <AnchoredPopover
        ref={popoverRef}
        open={open}
        anchorRef={anchorRef}
        side={side}
        align={align}
        onAnchorHidden={onAnchorHidden}
        role="dialog"
        aria-label="Pop"
        className="w-40 rounded-sm"
      >
        <p>content</p>
      </AnchoredPopover>
    </div>
  );
}

describe('AnchoredPopover', () => {
  afterEach(() => vi.restoreAllMocks());

  it('renders nothing while closed', () => {
    render(<Harness />);
    expect(screen.queryByRole('dialog', { name: 'Pop' })).toBeNull();
  });

  it('opens on the document body, out of the clipping container, below and start-aligned by default', () => {
    mockAnchor({ top: 120, left: 60, width: 80, height: 24 });
    render(<Harness />);
    fireEvent.click(screen.getByRole('button', { name: 'anchor' }));
    const pop = screen.getByRole('dialog', { name: 'Pop' });
    expect(pop.parentElement).toBe(document.body);
    expect(screen.getByTestId('clip').contains(pop)).toBe(false);
    expect(pop).toHaveAttribute('data-side', 'bottom');
    expect(pop.className).toBe('w-40 rounded-sm z-[55]');
    expect(pop.style.position).toBe('fixed');
    expect(pop.style.top).toBe(`${120 + 24 + 4}px`);
    expect(pop.style.left).toBe('60px');
    // Capped to the room below: 768 - 144 - 4 - 8.
    expect(pop.style.maxHeight).toBe('612px');
  });

  it('honours a preferred side and alignment', () => {
    mockAnchor({ top: 400, left: 300, width: 80, height: 24 });
    render(<Harness side="top" align="end" />);
    fireEvent.click(screen.getByRole('button', { name: 'anchor' }));
    expect(screen.getByRole('dialog', { name: 'Pop' })).toHaveAttribute('data-side', 'top');
  });

  it('forwards its element to an object ref and a callback ref', () => {
    const objectRef = createRef<HTMLDivElement>();
    const { unmount } = render(<Harness popoverRef={objectRef} />);
    fireEvent.click(screen.getByRole('button', { name: 'anchor' }));
    expect(objectRef.current).toBe(screen.getByRole('dialog', { name: 'Pop' }));
    unmount();

    const callback = vi.fn();
    render(<Harness popoverRef={callback} />);
    fireEvent.click(screen.getByRole('button', { name: 'anchor' }));
    expect(callback).toHaveBeenLastCalledWith(screen.getByRole('dialog', { name: 'Pop' }));
  });

  it('works with no ref at all', () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole('button', { name: 'anchor' }));
    expect(screen.getByRole('dialog', { name: 'Pop' })).toBeInTheDocument();
  });

  it('reports an anchor scrolled out of view, so the owner can close it', () => {
    mockAnchor({ top: -300, left: 60, width: 80, height: 24 });
    const onAnchorHidden = vi.fn();
    render(<Harness onAnchorHidden={onAnchorHidden} />);
    fireEvent.click(screen.getByRole('button', { name: 'anchor' }));
    expect(onAnchorHidden).toHaveBeenCalled();
  });

  it('tolerates a hidden anchor with no handler', () => {
    mockAnchor({ top: -300, left: 60, width: 80, height: 24 });
    render(<Harness />);
    fireEvent.click(screen.getByRole('button', { name: 'anchor' }));
    expect(screen.getByRole('dialog', { name: 'Pop' })).toBeInTheDocument();
  });
});
