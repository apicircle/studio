import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { AppIcon } from './AppIcon';

describe('AppIcon', () => {
  it('paints its glow from a gradient of its own, so two icons never share one', () => {
    const { container } = render(
      <>
        <AppIcon />
        <AppIcon size={48} />
      </>,
    );
    const gradients = [...container.querySelectorAll('radialGradient')];
    expect(gradients).toHaveLength(2);
    const [a, b] = gradients.map((g) => g.id);
    expect(a).not.toBe(b);
    for (const id of [a, b]) {
      expect(id).toMatch(/^apicircle-app-icon-glow-/);
      // A plain id: `url(#…)` with useId's colons in it is not.
      expect(id).not.toContain(':');
      expect(container.querySelector(`circle[fill="url(#${id})"]`)).not.toBeNull();
    }
  });

  it('draws the mark: six nodes on the ring with their spokes, the core and the chevron', () => {
    const { container } = render(<AppIcon size={32} className="text-text-primary" />);
    const svg = container.querySelector('svg')!;
    expect(svg).toHaveAttribute('width', '32');
    expect(svg).toHaveAttribute('aria-hidden', 'true');
    expect(svg).toHaveClass('text-text-primary');
    expect(svg.querySelectorAll('line')).toHaveLength(6);
    // Ring + six nodes + glow + core + pip.
    expect(svg.querySelectorAll('circle')).toHaveLength(10);
    expect(svg.querySelector('path')).toHaveAttribute('d', 'M44 41 L56 50 L44 59');
  });
});
