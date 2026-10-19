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

  // A tinted button is tone-coloured text on a tint of the same tone, which the
  // raw tone fails to read on in many themes — the label takes the `-fg` twin.
  it.each([
    ['primary', 'text-accent-fg'],
    ['danger', 'text-danger-fg'],
  ] as const)('labels the %s variant in its readable foreground', (variant, cls) => {
    render(<Button variant={variant}>Go</Button>);
    expect(screen.getByRole('button', { name: 'Go' })).toHaveClass(cls);
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

  describe('loading', () => {
    it('shows the brand loader in the icon’s place, says it is busy, and cannot be pressed again', async () => {
      const onClick = vi.fn();
      render(
        <Button loading leftIcon={<span data-testid="icon" />} onClick={onClick}>
          Sending…
        </Button>,
      );
      const btn = screen.getByRole('button', { name: 'Sending…' });
      expect(btn).toBeDisabled();
      expect(btn).toHaveAttribute('aria-busy', 'true');
      expect(btn.querySelector('svg[data-brand-loader="compact"]')).not.toBeNull();
      expect(screen.queryByTestId('icon')).toBeNull();
      // Busy is not unavailable: the label stays at full strength.
      expect(btn).toHaveClass('disabled:opacity-100', 'disabled:cursor-progress');
      expect(btn).not.toHaveClass('disabled:opacity-50');
      await userEvent.click(btn);
      expect(onClick).not.toHaveBeenCalled();
    });

    it('is an ordinary button again once it is done', () => {
      render(
        <Button loading={false} leftIcon={<span data-testid="icon" />}>
          Send
        </Button>,
      );
      const btn = screen.getByRole('button', { name: 'Send' });
      expect(btn).toBeEnabled();
      expect(btn).not.toHaveAttribute('aria-busy');
      expect(btn.querySelector('svg[data-brand-loader]')).toBeNull();
      expect(screen.getByTestId('icon')).toBeInTheDocument();
    });

    it('stays disabled when the caller disables it, loading or not', () => {
      render(<Button disabled>Send</Button>);
      expect(screen.getByRole('button', { name: 'Send' })).toBeDisabled();
    });
  });
});
