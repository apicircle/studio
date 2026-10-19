import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { EmptyState } from './EmptyState';

describe('EmptyState', () => {
  it('says what is missing, how to fill it, and offers the way in', () => {
    const { container } = render(
      <EmptyState
        icon={<svg data-testid="icon" />}
        title="No request open"
        description="Pick one in the sidebar, or start a new one."
        actions={<button type="button">New request</button>}
        className="min-h-40"
      />,
    );
    expect(screen.getByText('No request open')).toHaveClass('text-sm', 'font-medium');
    expect(screen.getByText('Pick one in the sidebar, or start a new one.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'New request' })).toBeInTheDocument();
    // The icon is decoration.
    expect(screen.getByTestId('icon').parentElement).toHaveAttribute('aria-hidden', 'true');
    expect(container.firstElementChild).toHaveClass('min-h-40', 'items-center');
  });

  it('draws only the title when that is all it is given', () => {
    const { container } = render(<EmptyState title="Nothing here yet" />);
    expect(screen.getByText('Nothing here yet')).toBeInTheDocument();
    expect(container.querySelectorAll('p')).toHaveLength(1);
    expect(container.querySelector('[aria-hidden]')).toBeNull();
    expect(container.querySelector('button')).toBeNull();
  });
});
