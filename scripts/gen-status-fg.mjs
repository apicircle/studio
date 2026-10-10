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
// It also generates the per-theme `--diff-add` / `--diff-del` tokens: the
// backdrop of an added and a removed line of a diff. A fixed tint cannot be
// that backdrop. It is the tone painted thin over the page, and on a page of the
// opposite hue the two cancel: 10% red over Solarized Dark's teal lands 2.0 from
// the page in OKLab x100, where about 2 is the least an eye can tell apart. 20%
// reads in most themes and still leaves that row at 5.3, and no stronger fixed
// step keeps the code on it at AA in every theme. So each theme gets its own:
// the tone at 20% over the surface, and where that is too faint, the least more
// that stands off the surface, never so much the text on it stops being
// readable. See `solveDiffTint`.
//
// Usage:
//   node scripts/gen-status-fg.mjs           rewrite global.css in place
//   node scripts/gen-status-fg.mjs --check   exit 1 if global.css is stale
//
// Run it after adding a theme or changing a theme's tone, surface, card,
// text-primary or text-muted. apps/web/src/__tests__/theme-contrast.test.ts
// fails until you do.

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

/** The tones that get a generated foreground. */
export const FG_TONES = ['success', 'warning', 'danger', 'info', 'accent'];
/** The alpha of each tint a `-fg` colour is placed on (0 = the bare surface). */
export const FG_TINTS = [0, 0.1, 0.15];
/** WCAG 2.1 AA for normal-size text. */
export const FG_MIN_CONTRAST = 4.5;

/** The diff tokens, by the kind of line each one backs, with the tone it is a tint of. */
export const DIFF_TINTS = { add: 'success', del: 'danger' };
/** The tokens a diff row is solved against: the page it lies on, its code, its line number. */
export const DIFF_PAGE = 'surface';
export const DIFF_CODE = 'text-primary';
export const DIFF_NUMBER = 'text-muted';
/** The share of the tone (whole percent) every diff tint starts from. */
export const DIFF_TINT_FLOOR = 20;
/**
 * The least a diff tint may differ from the page, in OKLab x100 (`difference`).
 * About what the 20% floor gives in the middle theme: a faint theme is raised to
 * the pack, and none is pushed past it.
 */
export const DIFF_TINT_TARGET = 10;
/** WCAG 2.1 AA for the code on a diff tint. */
export const DIFF_CODE_MIN_CONTRAST = 4.5;
/** A line number is a label beside the code: the 3:1 large-text floor. */
export const DIFF_NUMBER_MIN_CONTRAST = 3;

const SURFACES = ['surface', 'card'];
const BLOCK = /\[data-theme='([^']+)'\]\s*\{([^}]*)\}/g;
const TRIPLET = /--([\w-]+):\s*(\d+)\s+(\d+)\s+(\d+)\s*;/g;
const GENERATED_LINE = /^[ \t]*--(?:[\w-]+-fg|diff-[\w-]+):[^;]*;[ \t]*\r?\n/gm;

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

const oklab = (rgb) => {
  const [r, g, b] = rgb.map(linear);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
};

/**
 * How different two colours LOOK: their distance in OKLab, times 100, where
 * about 2 is the least a careful eye can tell apart side by side. A contrast
 * ratio cannot answer this. It compares lightness alone, and a red and a green
 * of one lightness are 1:1.
 */
export function difference(a, b) {
  const [x, y] = [oklab(a), oklab(b)];
  return 100 * Math.hypot(x[0] - y[0], x[1] - y[1], x[2] - y[2]);
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

/**
 * The backdrop of a diff line in one theme: `tone` over `page`, as a solid
 * colour. It starts at the floor share and takes the least more that puts it
 * `DIFF_TINT_TARGET` from the page.
 *
 * Two things bound it. The text on it comes first: a share is only taken while
 * `code` reads at AA and `number` at 3:1, so a theme with no room stops short of
 * the target, and one that cannot take even the floor gets less than the floor.
 * And it never goes under the floor to meet the target sooner. On a black page
 * 2% of a green is `2 5 2`, which OKLab scores at 10 from `0 0 0` and no display
 * shows: the measure is not to be trusted that close to black.
 */
export function solveDiffTint(tone, page, code, number) {
  const at = (share) => composite(tone, page, share / 100).map(Math.round);
  const readable = (tint) =>
    contrast(code, tint) >= DIFF_CODE_MIN_CONTRAST &&
    contrast(number, tint) >= DIFF_NUMBER_MIN_CONTRAST;
  let share = DIFF_TINT_FLOOR;
  while (share > 0 && !readable(at(share))) share -= 1;
  while (share < 100 && difference(at(share), page) < DIFF_TINT_TARGET && readable(at(share + 1))) {
    share += 1;
  }
  return at(share);
}

function parseTokens(body) {
  const tokens = {};
  for (const tok of body.matchAll(TRIPLET)) {
    tokens[tok[1]] = [Number(tok[2]), Number(tok[3]), Number(tok[4])];
  }
  return tokens;
}

/**
 * Return `css` with every theme block's generated tokens — the `-fg`
 * foregrounds and the diff tints — regenerated. Pure, and idempotent: feeding
 * its own output back in changes nothing, which is what `--check` and the
 * contrast test rely on.
 */
export function generate(css) {
  const eol = css.includes('\r\n') ? '\r\n' : '\n';
  return css.replace(BLOCK, (block, id, body) => {
    const stripped = body.replace(GENERATED_LINE, '');
    const tokens = parseTokens(stripped);
    const needed = [...FG_TONES, 'text-primary', DIFF_NUMBER, ...SURFACES];
    const missing = needed.filter((name) => !tokens[name]);
    if (missing.length > 0) {
      throw new Error(
        `Theme '${id}' does not define ${missing.map((m) => `--${m}`).join(', ')}. ` +
          'Every theme sets its own status tones; none are inherited.',
      );
    }
    const surfaces = SURFACES.map((name) => tokens[name]);
    const fgLines = FG_TONES.map((tone) => {
      const fg = solveFg(tokens[tone], tokens['text-primary'], surfaces);
      return `  --${tone}-fg: ${fg.join(' ')};${eol}`;
    });
    const diffLines = Object.entries(DIFF_TINTS).map(([kind, tone]) => {
      const tint = solveDiffTint(
        tokens[tone],
        tokens[DIFF_PAGE],
        tokens[DIFF_CODE],
        tokens[DIFF_NUMBER],
      );
      return `  --diff-${kind}: ${tint.join(' ')};${eol}`;
    });
    const lines = [...fgLines, ...diffLines].join('');
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
        'apps/web/src/styles/global.css has stale --<tone>-fg or --diff-* tokens. Run: node scripts/gen-status-fg.mjs',
      );
      process.exit(1);
    }
    console.log('--<tone>-fg and --diff-* tokens are up to date.');
    return;
  }
  if (next === current) {
    console.log('--<tone>-fg and --diff-* tokens already up to date.');
    return;
  }
  writeFileSync(CSS_PATH, next);
  console.log('Regenerated --<tone>-fg and --diff-* tokens in apps/web/src/styles/global.css.');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2));
}
