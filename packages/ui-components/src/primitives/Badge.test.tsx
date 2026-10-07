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

  // The tint and border are the tone; the text is its readable `-fg` twin, since
  // the raw tone on its own tint fails contrast in most light themes.
  it.each(['accent', 'success', 'warning', 'danger', 'info'] as const)(
    'applies the %s tone, with its readable foreground for the text',
    (tone) => {
      render(<Badge tone={tone}>{tone}</Badge>);
      const el = screen.getByText(tone);
      expect(el).toHaveClass(`text-${tone}-fg`, `bg-${tone}/10`, `border-${tone}/40`);
      expect(el).not.toHaveClass(`text-${tone}`);
    },
  );

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
