// scripts/gen-status-fg.mjs
//
// Generates the per-theme `--<tone>-fg` tokens in apps/web/src/styles/global.css.
//
// Why they exist: a status chip is tone-coloured text on a low-alpha tint of the
// same tone (`bg-warning/10 text-warning`). In most themes the raw tone is not
// readable there — pale amber on a light surface measures under 2:1 — and no
// single adjustment fixes all 60 themes without washing out the ones that were
// already fine. So each theme gets its own foreground per tone: the tone itself
// where that already meets WCAG AA (4.5:1), otherwise the tone mixed toward the
// theme's `--text-primary` by the smallest amount that gets there.
//
// "Gets there" means on every backdrop the primitives put it on: the bare
// surface and card, and the 10% (Badge) and 15% (Button, active Tab) tints of
// the tone over each.
//
// Usage:
//   node scripts/gen-status-fg.mjs           rewrite global.css in place
//   node scripts/gen-status-fg.mjs --check   exit 1 if global.css is stale
//
// Run it after adding a theme or changing a theme's tone, surface, card or
// text-primary. apps/web/src/__tests__/theme-contrast.test.ts fails until you do.

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

/** The tones that get a generated foreground. */
export const FG_TONES = ['success', 'warning', 'danger', 'info', 'accent'];
/** The alpha of each tint a `-fg` colour is placed on (0 = the bare surface). */
export const FG_TINTS = [0, 0.1, 0.15];
/** WCAG 2.1 AA for normal-size text. */
export const FG_MIN_CONTRAST = 4.5;

const SURFACES = ['surface', 'card'];
const BLOCK = /\[data-theme='([^']+)'\]\s*\{([^}]*)\}/g;
const TRIPLET = /--([\w-]+):\s*(\d+)\s+(\d+)\s+(\d+)\s*;/g;
const FG_LINE = /^[ \t]*--[\w-]+-fg:[^;]*;[ \t]*\r?\n/gm;

const linear = (c) => {
  const s = c / 255;
  return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
};
const luminance = (rgb) =>
  0.2126 * linear(rgb[0]) + 0.7152 * linear(rgb[1]) + 0.0722 * linear(rgb[2]);

/** WCAG contrast ratio between two RGB triplets. */
export function contrast(a, b) {
  const hi = Math.max(luminance(a), luminance(b));
  const lo = Math.min(luminance(a), luminance(b));
  return (hi + 0.05) / (lo + 0.05);
}

/** `fg` painted at `alpha` over `bg` — what a `bg-tone/10` tint resolves to. */
export function composite(fg, bg, alpha) {
  return fg.map((v, i) => v * alpha + bg[i] * (1 - alpha));
}

/**
 * The foreground for `tone` in one theme: the largest share of the tone (in
 * whole percent, mixed with `text`) that reads at AA on every tint over every
 * surface. `text` itself is the floor — the contrast test already holds
 * `text-primary` to AA on both surfaces, and a tint only moves the backdrop
 * toward the tone, so a 0% share is the last resort rather than a real outcome.
 */
export function solveFg(tone, text, surfaces) {
  for (let share = 100; share >= 0; share -= 1) {
    const fg = tone.map((v, i) => Math.round((v * share + text[i] * (100 - share)) / 100));
    const readable = surfaces.every((bg) =>
      FG_TINTS.every((alpha) => contrast(fg, composite(tone, bg, alpha)) >= FG_MIN_CONTRAST),
    );
    if (readable) return fg;
  }
  return text;
}

function parseTokens(body) {
  const tokens = {};
  for (const tok of body.matchAll(TRIPLET)) {
    tokens[tok[1]] = [Number(tok[2]), Number(tok[3]), Number(tok[4])];
  }
  return tokens;
}

/**
 * Return `css` with every theme block's `-fg` tokens regenerated. Pure, and
 * idempotent: feeding its own output back in changes nothing, which is what
 * `--check` and the contrast test rely on.
 */
export function generate(css) {
  const eol = css.includes('\r\n') ? '\r\n' : '\n';
  return css.replace(BLOCK, (block, id, body) => {
    const stripped = body.replace(FG_LINE, '');
    const tokens = parseTokens(stripped);
    const needed = [...FG_TONES, 'text-primary', ...SURFACES];
    const missing = needed.filter((name) => !tokens[name]);
    if (missing.length > 0) {
      throw new Error(
        `Theme '${id}' does not define ${missing.map((m) => `--${m}`).join(', ')}. ` +
          'Every theme sets its own status tones; none are inherited.',
      );
    }
    const surfaces = SURFACES.map((name) => tokens[name]);
    const lines = FG_TONES.map((tone) => {
      const fg = solveFg(tokens[tone], tokens['text-primary'], surfaces);
      return `  --${tone}-fg: ${fg.join(' ')};${eol}`;
    }).join('');
    // After `--info`, so the generated group sits with the tones it derives from.
    const anchor = /^[ \t]*--info:[^;]*;[ \t]*\r?\n/m;
    const next = stripped.replace(anchor, (line) => line + lines);
    return block.replace(body, () => next);
  });
}

const CSS_PATH = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../apps/web/src/styles/global.css',
);

function main(argv) {
  const current = readFileSync(CSS_PATH, 'utf8');
  const next = generate(current);
  if (argv.includes('--check')) {
    if (next !== current) {
      console.error(
        'apps/web/src/styles/global.css has stale --<tone>-fg tokens. Run: node scripts/gen-status-fg.mjs',
      );
      process.exit(1);
    }
    console.log('--<tone>-fg tokens are up to date.');
    return;
  }
  if (next === current) {
    console.log('--<tone>-fg tokens already up to date.');
    return;
  }
  writeFileSync(CSS_PATH, next);
  console.log('Regenerated --<tone>-fg tokens in apps/web/src/styles/global.css.');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2));
}
