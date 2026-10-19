import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { BRAND_LOADER_CSS, BRAND_LOADER_STYLE_ID, BrandLoader, LoadingState } from './BrandLoader';
import { hexToRgbTriplet, markPoint, markSpoke } from './brandMark';

afterEach(() => {
  document.getElementById(BRAND_LOADER_STYLE_ID)?.remove();
});

const loaders = (root: ParentNode = document) => root.querySelectorAll('svg[data-brand-loader]');

describe('BrandLoader', () => {
  it('is decorative: the words beside it are what gets announced', () => {
    const { container } = render(<BrandLoader />);
    const svg = loaders(container)[0];
    expect(svg).toHaveAttribute('aria-hidden', 'true');
    expect(svg).toHaveAttribute('focusable', 'false');
    expect(svg).toHaveClass('apc-loader');
    // `sm` is the default: 16px, the compact drawing.
    expect(svg).toHaveAttribute('width', '16');
    expect(svg).toHaveAttribute('data-brand-loader', 'compact');
  });

  it('draws the compact ring of six dots round the core where the full mark would blur', () => {
    const { container } = render(<BrandLoader size="xs" />);
    const svg = loaders(container)[0];
    expect(svg).toHaveAttribute('data-brand-loader', 'compact');
    expect(svg).toHaveAttribute('width', '14');
    expect(svg.querySelectorAll('.apc-node')).toHaveLength(6);
    expect(svg.querySelectorAll('.apc-spoke')).toHaveLength(0);
    expect(svg.querySelector('path')).toBeNull();
    // The ring sits a little inside the full one: the top dot at radius 36.
    expect(svg.querySelector('.apc-d0')).toHaveAttribute('cy', '14');
  });

  it('draws the whole mark — orbit, spokes, nodes, core and chevron — from 24px up', () => {
    const { container } = render(<BrandLoader size="lg" className="mx-auto" />);
    const svg = loaders(container)[0];
    expect(svg).toHaveAttribute('data-brand-loader', 'full');
    expect(svg).toHaveAttribute('width', '64');
    expect(svg).toHaveClass('apc-loader', 'mx-auto');
    expect(svg.querySelector('.apc-orbit')).not.toBeNull();
    expect(svg.querySelectorAll('.apc-spoke')).toHaveLength(6);
    expect(svg.querySelectorAll('.apc-node')).toHaveLength(6);
    expect(svg.querySelector('path')).toHaveAttribute('d', 'M44 41 L56 50 L44 59');
    expect(svg.querySelector('.apc-live')).toHaveAttribute('fill', '#22c55e');
  });

  it('takes a pixel size, switching drawing at the 24px threshold', () => {
    const { container } = render(
      <>
        <BrandLoader size={23} />
        <BrandLoader size={24} />
      </>,
    );
    const [small, large] = loaders(container);
    expect(small).toHaveAttribute('data-brand-loader', 'compact');
    expect(large).toHaveAttribute('data-brand-loader', 'full');
    expect(large).toHaveAttribute('height', '24');
  });

  it('lights the nodes clockwise in the brand order, each one a step behind the last', () => {
    const { container } = render(<BrandLoader size="md" />);
    const nodes = [...loaders(container)[0].querySelectorAll('.apc-node')];
    expect(nodes.map((n) => n.getAttribute('class'))).toEqual([
      'apc-node apc-d0 apc-t-purple',
      'apc-node apc-d1 apc-t-green',
      'apc-node apc-d2 apc-t-blue',
      'apc-node apc-d3 apc-t-amber',
      'apc-node apc-d4 apc-t-red',
      'apc-node apc-d5 apc-t-info',
    ]);
    // Negative delays: the sweep is already under way on first paint.
    expect(BRAND_LOADER_CSS).toContain('.apc-loader .apc-d0{animation-delay:-1.80s}');
    expect(BRAND_LOADER_CSS).toContain('.apc-loader .apc-d5{animation-delay:-0.30s}');
  });

  it('wears the theme’s tones, falling back to the logo’s own colours', () => {
    expect(BRAND_LOADER_CSS).toContain(
      '.apc-loader .apc-t-purple{color:rgb(var(--purple,167 139 250))}',
    );
    expect(BRAND_LOADER_CSS).toContain(
      '.apc-loader .apc-t-info{color:rgb(var(--info,96 165 250))}',
    );
  });

  it('stops moving under reduced motion but keeps the nodes brightening in turn', () => {
    const reduced = BRAND_LOADER_CSS.slice(
      BRAND_LOADER_CSS.indexOf('@media (prefers-reduced-motion:reduce)'),
    );
    expect(reduced).toContain(
      '.apc-loader .apc-orbit,.apc-loader .apc-core,.apc-loader .apc-spoke{animation:none}',
    );
    expect(reduced).toContain('animation-name:apc-node-fade;transform:none');
    expect(BRAND_LOADER_CSS).toContain(
      '@keyframes apc-node-fade{0%,100%{opacity:.32}16%{opacity:1}44%{opacity:.32}}',
    );
  });

  it('puts its stylesheet in the document once, however many loaders are on screen', () => {
    render(
      <>
        <BrandLoader />
        <BrandLoader size="lg" />
      </>,
    );
    render(<BrandLoader size="md" />);
    const sheets = document.querySelectorAll(`style#${BRAND_LOADER_STYLE_ID}`);
    expect(sheets).toHaveLength(1);
    expect(sheets[0].textContent).toBe(BRAND_LOADER_CSS);
    expect(sheets[0].parentElement).toBe(document.head);
  });

  it('leaves a sheet already in the document alone (an edition that drew the mark first)', () => {
    const existing = document.createElement('style');
    existing.id = BRAND_LOADER_STYLE_ID;
    existing.textContent = '/* the edition’s own copy */';
    document.head.appendChild(existing);
    render(<BrandLoader />);
    const sheets = document.querySelectorAll(`style#${BRAND_LOADER_STYLE_ID}`);
    expect(sheets).toHaveLength(1);
    expect(sheets[0]).toBe(existing);
  });
});

describe('brandMark geometry', () => {
  it('puts the six services on the logo’s ring, clockwise from the top', () => {
    const [x, y] = markPoint(30, 38);
    expect(x).toBeCloseTo(82.91, 2);
    expect(y).toBeCloseTo(31, 2);
    expect(markPoint(90, 38).map((v) => Math.round(v * 100) / 100)).toEqual([50, 12]);
  });

  it('runs each spoke from just outside the core to just inside its node', () => {
    expect(markSpoke(90).map((v) => Math.round(v * 100) / 100)).toEqual([50, 29, 50, 20]);
  });

  it('writes a hex colour as the space-separated triplet the theme tokens use', () => {
    expect(hexToRgbTriplet('#a78bfa')).toBe('167 139 250');
    expect(hexToRgbTriplet('#000000')).toBe('0 0 0');
  });
});

describe('LoadingState', () => {
  it('announces what is being waited for, once, politely', () => {
    render(<LoadingState title="Reading the repository…" />);
    const region = screen.getByRole('status');
    expect(region).toHaveAttribute('aria-live', 'polite');
    expect(region).toHaveTextContent('Reading the repository…');
    expect(loaders(region)[0]).toHaveAttribute('data-brand-loader', 'full');
    expect(loaders(region)[0]).toHaveAttribute('width', '40');
    expect(region.querySelectorAll('p')).toHaveLength(1);
  });

  it('adds a detail line and takes the panel size', () => {
    render(
      <LoadingState
        title="Loading workspace…"
        detail="A large workspace can take a moment."
        size="lg"
        className="h-full"
      />,
    );
    const region = screen.getByRole('status');
    expect(region).toHaveClass('h-full');
    expect(screen.getByText('A large workspace can take a moment.')).toHaveClass(
      'text-xs',
      'text-text-dim',
    );
    expect(loaders(region)[0]).toHaveAttribute('width', '64');
  });

  it('sits on one line, the compact mark beside the title, at the small size', () => {
    render(<LoadingState size="sm" title="Loading branches…" className="mt-1" />);
    const region = screen.getByRole('status');
    expect(region).toHaveClass('flex', 'items-center', 'mt-1');
    expect(region).toHaveTextContent('Loading branches…');
    expect(loaders(region)[0]).toHaveAttribute('data-brand-loader', 'compact');
    expect(loaders(region)[0]).toHaveAttribute('width', '14');
    expect(region.querySelector('p')).toBeNull();
  });

  it('carries a detail on the same line at the small size', () => {
    render(<LoadingState size="sm" title="Loading branches…" detail="from GitHub" />);
    expect(screen.getByText('from GitHub')).toHaveClass('text-text-faint');
  });
});
