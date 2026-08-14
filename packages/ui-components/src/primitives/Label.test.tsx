import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Label } from './Label';

describe('Label', () => {
  it('renders its text and binds to a control via htmlFor', () => {
    render(
      <>
        <Label htmlFor="f">Email address</Label>
        <input id="f" />
      </>,
    );
    expect(screen.getByText('Email address')).toBeInTheDocument();
    // getByLabelText resolves through htmlFor → the label is truly associated.
    expect(screen.getByLabelText('Email address')).toBeInstanceOf(HTMLInputElement);
  });

  it('shows a required marker and an accessible (required) note', () => {
    render(<Label required>Name</Label>);
    expect(screen.getByText('*')).toHaveAttribute('aria-hidden', 'true');
    expect(screen.getByText('(required)')).toHaveClass('sr-only');
  });

  it('omits the required affordances when not required', () => {
    render(<Label>Name</Label>);
    expect(screen.queryByText('*')).not.toBeInTheDocument();
    expect(screen.queryByText('(required)')).not.toBeInTheDocument();
  });

  it('merges a custom className', () => {
    render(<Label className="mb-4">X</Label>);
    expect(screen.getByText('X')).toHaveClass('mb-4');
  });
});
