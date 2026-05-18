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
});
