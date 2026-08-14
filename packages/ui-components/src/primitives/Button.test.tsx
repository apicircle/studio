import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { Button } from './Button';

describe('Button', () => {
  it('renders children and forwards props', () => {
    render(<Button data-testid="b">Click</Button>);
    expect(screen.getByTestId('b')).toHaveTextContent('Click');
  });

  it('fires onClick when clicked', async () => {
    const onClick = vi.fn();
    render(<Button onClick={onClick}>Go</Button>);
    await userEvent.click(screen.getByRole('button', { name: 'Go' }));
    expect(onClick).toHaveBeenCalledOnce();
  });

  it('does not fire onClick when disabled', async () => {
    const onClick = vi.fn();
    render(
      <Button onClick={onClick} disabled>
        Go
      </Button>,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Go' }));
    expect(onClick).not.toHaveBeenCalled();
  });

  it('applies the requested variant and size class hooks', () => {
    render(
      <Button variant="danger" size="sm">
        X
      </Button>,
    );
    const btn = screen.getByRole('button', { name: 'X' });
    expect(btn.className).toMatch(/bg-danger/);
    expect(btn.className).toMatch(/h-7/);
  });

  it('renders left and right icons around the label', () => {
    render(
      <Button leftIcon={<span data-testid="l" />} rightIcon={<span data-testid="r" />}>
        Mid
      </Button>,
    );
    expect(screen.getByTestId('l')).toBeInTheDocument();
    expect(screen.getByTestId('r')).toBeInTheDocument();
  });

  describe('size scale', () => {
    it.each([
      ['xs', /h-6/],
      ['sm', /h-7/],
      ['md', /h-8/],
      ['lg', /h-9/],
    ] as const)('renders %s at the expected height', (size, expected) => {
      render(<Button size={size}>{size}</Button>);
      expect(screen.getByRole('button', { name: size }).className).toMatch(expected);
    });

    it('defaults to the sm height the panels use', () => {
      render(<Button>Default</Button>);
      expect(screen.getByRole('button', { name: 'Default' }).className).toMatch(/h-7/);
    });

    it('never renders below the 24px minimum target size', () => {
      render(<Button size="xs">Tiny</Button>);
      // h-6 === 24px === the WCAG 2.5.8 AA floor.
      expect(screen.getByRole('button', { name: 'Tiny' }).className).toMatch(/h-6/);
    });
  });

  it('lets a call-site className override the base height', () => {
    render(
      <Button size="lg" className="h-7">
        Override
      </Button>,
    );
    const btn = screen.getByRole('button', { name: 'Override' });
    expect(btn.className).toMatch(/h-7/);
    expect(btn.className).not.toMatch(/h-9/);
  });

  it('defaults to type="button" so it cannot submit a surrounding form', () => {
    render(<Button>Safe</Button>);
    expect(screen.getByRole('button', { name: 'Safe' })).toHaveAttribute('type', 'button');
  });

  it('still allows an explicit submit type', () => {
    render(<Button type="submit">Send</Button>);
    expect(screen.getByRole('button', { name: 'Send' })).toHaveAttribute('type', 'submit');
  });
});
