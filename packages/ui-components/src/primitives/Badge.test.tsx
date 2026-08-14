import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Badge } from './Badge';

describe('Badge', () => {
  it('renders its children', () => {
    render(<Badge>stub</Badge>);
    expect(screen.getByText('stub')).toBeInTheDocument();
  });

  it('defaults to the neutral tone', () => {
    render(<Badge>n</Badge>);
    expect(screen.getByText('n')).toHaveClass('text-text-muted');
  });

  it.each([
    ['accent', 'text-accent'],
    ['success', 'text-success'],
    ['warning', 'text-warning'],
    ['danger', 'text-danger'],
    ['info', 'text-info'],
  ] as const)('applies the %s tone', (tone, cls) => {
    render(<Badge tone={tone}>{tone}</Badge>);
    expect(screen.getByText(tone)).toHaveClass(cls);
  });

  it('adds uppercase micro-caps styling when asked', () => {
    render(<Badge uppercase>get</Badge>);
    expect(screen.getByText('get')).toHaveClass('uppercase');
  });

  it('forwards a custom className and arbitrary props', () => {
    render(
      <Badge className="ml-2" data-testid="b" title="method">
        x
      </Badge>,
    );
    const el = screen.getByTestId('b');
    expect(el).toHaveClass('ml-2');
    expect(el).toHaveAttribute('title', 'method');
  });
});
