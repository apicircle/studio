import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Skeleton } from './Skeleton';

describe('Skeleton', () => {
  it('renders a single bar by default, hidden from assistive tech', () => {
    const { container } = render(<Skeleton />);
    const bars = container.querySelectorAll('.animate-pulse');
    expect(bars).toHaveLength(1);
    expect(container.firstChild).toHaveAttribute('aria-hidden', 'true');
  });

  it('renders the requested number of lines', () => {
    const { container } = render(<Skeleton lines={4} />);
    expect(container.querySelectorAll('.animate-pulse')).toHaveLength(4);
  });

  it('makes the last line short like a paragraph tail', () => {
    const { container } = render(<Skeleton lines={3} />);
    const bars = container.querySelectorAll('.animate-pulse');
    expect(bars[bars.length - 1]).toHaveClass('w-2/3');
    expect(bars[0]).toHaveClass('w-full');
  });

  it('merges a custom className on the single-line variant', () => {
    const { container } = render(<Skeleton className="h-8" />);
    expect(container.firstChild).toHaveClass('h-8');
  });

  it('treats lines <= 1 as a single bar', () => {
    const { container } = render(<Skeleton lines={1} />);
    expect(container.querySelectorAll('.animate-pulse')).toHaveLength(1);
  });
});
