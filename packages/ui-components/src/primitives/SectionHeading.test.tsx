import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { SectionHeading } from './SectionHeading';

describe('SectionHeading', () => {
  it('is a level-2 heading at 12px by default', () => {
    render(<SectionHeading>Steps</SectionHeading>);
    const heading = screen.getByRole('heading', { level: 2, name: 'Steps' });
    expect(heading).toHaveClass('text-xs', 'uppercase', 'tracking-wider', 'text-text-dim');
  });

  it('takes a level, a size for a dense card, an id and extra classes', () => {
    render(
      <SectionHeading as="h3" size="sm" id="vars" className="mb-2">
        Plan variables
      </SectionHeading>,
    );
    const heading = screen.getByRole('heading', { level: 3, name: 'Plan variables' });
    expect(heading).toHaveAttribute('id', 'vars');
    expect(heading).toHaveClass('text-[0.6875rem]', 'mb-2');
    expect(heading).not.toHaveClass('text-xs');
  });

  it('renders an h4 when asked', () => {
    render(<SectionHeading as="h4">Request</SectionHeading>);
    expect(screen.getByRole('heading', { level: 4, name: 'Request' })).toBeInTheDocument();
  });
});
