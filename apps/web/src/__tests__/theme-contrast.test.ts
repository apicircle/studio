import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// WCAG 2.1 colour-contrast guarantee for the theme tokens (UX-S-010). The e2e
// a11y sweep runs axe's `color-contrast` on the *default* theme only; this unit
// test extends that guarantee to every theme's token definitions — no browser
// needed — so a token edit that regresses contrast fails CI here.
//
// Scope of the promise (grounded in an audit of all 60 themes):
//  - `text-primary` is the main readable text and MUST meet AA (4.5:1) on both
//    core surfaces in EVERY theme.
//  - Studio's own designed themes (the 5 built-ins + the 4 "high-contrast"
//    variants, whose contrast is an explicit promise) must meet AA on
//    primary / muted / dim.
//  - No theme may drop any of those pairs below the 3:1 large-text floor, save a
//    single pinned exception: community palettes' `text-dim` faithfully
//    replicates the source editor's comment colour (e.g. Dracula, Tokyo Night),
//    which the real palettes render at sub-AA too — matching them is the point.
//    Only `tokyo-night-day` dips below 3:1; it is allow-listed and pinned so any
//    NEW severe drop fails.

const css = readFileSync(resolve(__dirname, '../styles/global.css'), 'utf8');

const BUILTIN = new Set([
  'studio-dark',
  'graphite-dark',
  'midnight-blue',
  'workbench-light',
  'paper-light',
]);
const HIGH_CONTRAST = new Set([
  'high-contrast-dark',
  'high-contrast-light',
  'github-dark-high-contrast',
  'github-light-high-contrast',
]);

type RGB = [number, number, number];
const linear = (c: number): number => {
  const s = c / 255;
  return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
};
const luminance = (rgb: RGB): number =>
  0.2126 * linear(rgb[0]) + 0.7152 * linear(rgb[1]) + 0.0722 * linear(rgb[2]);
const contrast = (a: RGB, b: RGB): number => {
  const hi = Math.max(luminance(a), luminance(b));
  const lo = Math.min(luminance(a), luminance(b));
  return (hi + 0.05) / (lo + 0.05);
};

interface Theme {
  id: string;
  tokens: Record<string, RGB>;
}
const themes: Theme[] = [];
for (const block of css.matchAll(/\[data-theme='([^']+)'\]\s*\{([^}]*)\}/g)) {
  const tokens: Record<string, RGB> = {};
  for (const tok of block[2].matchAll(/--([\w-]+):\s*(\d+)\s+(\d+)\s+(\d+)\s*;/g)) {
    tokens[tok[1]] = [Number(tok[2]), Number(tok[3]), Number(tok[4])];
  }
  themes.push({ id: block[1], tokens });
}

const AA = 4.5;
const LARGE = 3;
const SURFACES = ['surface', 'card'] as const;

const failing = (fgs: string[], threshold: number, filter: (id: string) => boolean): string[] => {
  const out: string[] = [];
  for (const { id, tokens } of themes) {
    if (!filter(id)) continue;
    for (const fg of fgs) {
      for (const bg of SURFACES) {
        if (!tokens[fg] || !tokens[bg]) continue;
        if (contrast(tokens[fg], tokens[bg]) < threshold) out.push(`${id} ${fg}/${bg}`);
      }
    }
  }
  return out;
};

describe('theme colour contrast (WCAG 2.1 AA)', () => {
  it('parses a token block for every catalogued theme', () => {
    expect(themes.length).toBeGreaterThanOrEqual(60);
    for (const { tokens } of themes) expect(tokens['text-primary']).toBeDefined();
  });

  it('primary text meets AA (4.5:1) on surface and card in EVERY theme', () => {
    expect(failing(['text-primary'], AA, () => true)).toEqual([]);
  });

  it("Studio's built-in + high-contrast themes meet AA on primary / muted / dim", () => {
    const designed = (id: string) => BUILTIN.has(id) || HIGH_CONTRAST.has(id);
    expect(failing(['text-primary', 'text-muted', 'text-dim'], AA, designed)).toEqual([]);
  });

  it('no theme drops primary / muted / dim below the 3:1 large-text floor (one pinned community exception)', () => {
    expect(failing(['text-primary', 'text-muted', 'text-dim'], LARGE, () => true)).toEqual([
      'tokyo-night-day text-dim/card',
    ]);
  });
});
