import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  DIFF_CODE,
  DIFF_CODE_MIN_CONTRAST,
  DIFF_NUMBER,
  DIFF_NUMBER_MIN_CONTRAST,
  DIFF_PAGE,
  DIFF_TINTS,
  DIFF_TINT_FLOOR,
  DIFF_TINT_TARGET,
  FG_MIN_CONTRAST,
  FG_TINTS,
  FG_TONES,
  composite,
  difference,
  generate,
  solveDiffTint,
} from '../../../../scripts/gen-status-fg.mjs';

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
//  - Tone-coloured text (`text-<tone>-fg`: status chips, primary buttons, the
//    active tab) MUST meet AA in EVERY theme, on the bare surfaces and on the
//    10% / 15% tints of its own tone the primitives paint behind it. Those
//    tokens are generated (scripts/gen-status-fg.mjs), so this also fails when
//    a theme was edited or added without regenerating them.
//  - A diff's added and removed lines MUST show in EVERY theme. The tint this
//    replaced, 10% of the tone, landed one just-noticeable step from the page on
//    Solarized Dark, and nothing failed, because nothing looked. So the second
//    half of this file takes what a marked row is made of (its generated tint,
//    its edge, its line number) and measures, on each theme's page, what a
//    reader has to tell apart: the tint from the page, the code and the line
//    number on the tint, and the two edges from the page and from each other.
//    `primitives/diffRow.test.ts` in ui-components holds the row's classes to
//    the same parts.

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

  it('every theme sets its own status tones — none are inherited from the default theme', () => {
    const missing: string[] = [];
    for (const { id, tokens } of themes) {
      for (const tone of FG_TONES) {
        if (!tokens[tone]) missing.push(`${id} --${tone}`);
        if (!tokens[`${tone}-fg`]) missing.push(`${id} --${tone}-fg`);
      }
    }
    expect(missing).toEqual([]);
  });

  it('tone-coloured text meets AA on both surfaces and on its own 10% / 15% tint in EVERY theme', () => {
    const out: string[] = [];
    for (const { id, tokens } of themes) {
      for (const tone of FG_TONES) {
        const fg = tokens[`${tone}-fg`];
        for (const bg of SURFACES) {
          for (const alpha of FG_TINTS) {
            const backdrop = composite(tokens[tone], tokens[bg], alpha) as RGB;
            if (contrast(fg, backdrop) < FG_MIN_CONTRAST) {
              out.push(`${id} ${tone}-fg on ${tone}/${alpha * 100} over ${bg}`);
            }
          }
        }
      }
    }
    expect(out).toEqual([]);
  });

  it('the generated tokens are current (run `node scripts/gen-status-fg.mjs` after editing a theme)', () => {
    expect(generate(css)).toBe(css);
  });
});

/**
 * What a marked line of a diff is made of, as the generator solves it: the token
 * of its tint, the tone of its edge, and the colour of its line number.
 * `primitives/diffRow.test.ts` holds the row's classes to exactly these, so what
 * is measured here is what is drawn.
 */
interface DiffRowParts {
  tint: string;
  edge: string;
  number: string;
}
const MARKED = ['add', 'del'] as const;
const DIFF_ROWS: Record<(typeof MARKED)[number], DiffRowParts> = {
  add: { tint: 'diff-add', edge: DIFF_TINTS.add, number: DIFF_NUMBER },
  del: { tint: 'diff-del', edge: DIFF_TINTS.del, number: DIFF_NUMBER },
};

/** The edge is the tone itself: it must be plainly not the page, and plainly not the other edge. */
const EDGE_FROM_PAGE = 25;
const EDGE_FROM_EDGE = 15;

const toRgb = (colour: readonly number[]): RGB => [colour[0], colour[1], colour[2]];

/** Everything a theme's diff rows fall short on, as lines that name the row and the measure. */
function shortfalls(theme: Theme, rows = DIFF_ROWS): string[] {
  const { tokens } = theme;
  const page = tokens[DIFF_PAGE];
  const out: string[] = [];
  const check = (what: string, value: number, least: number): void => {
    if (value < least) out.push(`${theme.id}: ${what} is ${value.toFixed(1)}, under ${least}`);
  };
  for (const kind of MARKED) {
    const { tint, edge, number } = rows[kind];
    const row = tokens[tint];
    check(`the ${kind} tint against the page`, difference(row, page), DIFF_TINT_TARGET);
    check(`the code on the ${kind} tint`, contrast(tokens[DIFF_CODE], row), DIFF_CODE_MIN_CONTRAST);
    check(
      `the line number on the ${kind} tint`,
      contrast(tokens[number], row),
      DIFF_NUMBER_MIN_CONTRAST,
    );
    check(`the ${kind} edge against the page`, difference(tokens[edge], page), EDGE_FROM_PAGE);
  }
  check(
    'the add edge against the del edge',
    difference(tokens[rows.add.edge], tokens[rows.del.edge]),
    EDGE_FROM_EDGE,
  );
  return out;
}

/** `theme` with its diff tints replaced by the tone at one fixed share over the page. */
function withFixedTint(theme: Theme, alpha: number): Theme {
  const tokens = { ...theme.tokens };
  for (const kind of MARKED) {
    tokens[`diff-${kind}`] = toRgb(
      composite(tokens[DIFF_TINTS[kind]], tokens[DIFF_PAGE], alpha).map(Math.round),
    );
  }
  return { id: theme.id, tokens };
}

describe('a diff row shows on every theme', () => {
  const themeOf = (id: string): Theme => {
    const theme = themes.find((t) => t.id === id);
    if (!theme) throw new Error(`no theme '${id}'`);
    return theme;
  };

  it('every theme defines what a row is made of (a guard that read nothing would pass anything)', () => {
    const asked = [
      DIFF_PAGE,
      DIFF_CODE,
      ...MARKED.flatMap((kind) => Object.values(DIFF_ROWS[kind])),
    ];
    expect([...new Set(asked)].sort()).toEqual([
      'danger',
      'diff-add',
      'diff-del',
      'success',
      'surface',
      'text-muted',
      'text-primary',
    ]);
    for (const { id, tokens } of themes) {
      expect(Object.keys(tokens), id).toEqual(expect.arrayContaining(asked));
    }
    expect(() => themeOf('no-such-theme')).toThrow("no theme 'no-such-theme'");
  });

  it('an added and a removed line stand out, can be read, and can be told apart', () => {
    expect(themes.flatMap((theme) => shortfalls(theme))).toEqual([]);
  });

  it('fails on the tint this replaced: 10% of the tone was lost on Solarized Dark', () => {
    // The removed line at the edge of what an eye can tell from the page at all.
    expect(shortfalls(withFixedTint(themeOf('solarized-dark'), 0.1))).toEqual([
      expect.stringMatching(/^solarized-dark: the add tint against the page is 4\.\d, under 10$/),
      expect.stringMatching(
        /^solarized-dark: the del tint against the page is [12]\.\d, under 10$/,
      ),
    ]);
  });

  it('no one share of the tone does for every theme, which is why each has its own', () => {
    // 20% keeps every line readable and leaves some too faint to see...
    const floor = themes.flatMap((theme) =>
      shortfalls(withFixedTint(theme, DIFF_TINT_FLOOR / 100)),
    );
    expect(floor.length).toBeGreaterThan(0);
    expect(floor.every((line) => line.includes('tint against the page'))).toBe(true);
    expect(floor).toContainEqual(
      expect.stringMatching(/^solarized-dark: the del tint against the page is 5\.\d, under 10$/),
    );
    // ...and the share that lifts those takes the code under AA somewhere else.
    const lifted = themes.flatMap((theme) => shortfalls(withFixedTint(theme, 0.33)));
    expect(lifted.some((line) => line.includes('the code on the'))).toBe(true);
  });

  it('keeps the floor where it stands off the page, and raises it only where it does not', () => {
    let kept = 0;
    let raised = 0;
    for (const { id, tokens } of themes) {
      const page = tokens[DIFF_PAGE];
      for (const kind of MARKED) {
        const tint = tokens[`diff-${kind}`];
        const floor = composite(tokens[DIFF_TINTS[kind]], page, DIFF_TINT_FLOOR / 100).map(
          Math.round,
        );
        if (difference(floor, page) >= DIFF_TINT_TARGET) {
          expect(tint, `${id} ${kind}`).toEqual(floor);
          kept += 1;
        } else {
          expect(difference(tint, page), `${id} ${kind}`).toBeGreaterThan(difference(floor, page));
          raised += 1;
        }
      }
    }
    expect(kept).toBeGreaterThan(0);
    expect(raised).toBeGreaterThan(0);
  });

  it('fails on a tint too strong to read code on, on edges of one colour, and on a number too dim', () => {
    const heavy = themes.flatMap((theme) => shortfalls(withFixedTint(theme, 0.6)));
    expect(heavy.some((line) => line.includes('the code on the del tint'))).toBe(true);

    const theme = themes[0];
    const oneEdge = { ...DIFF_ROWS, add: { ...DIFF_ROWS.add, edge: DIFF_ROWS.del.edge } };
    expect(shortfalls(theme, oneEdge)).toEqual([
      `${theme.id}: the add edge against the del edge is 0.0, under ${EDGE_FROM_EDGE}`,
    ]);
    const faintEdge = { ...DIFF_ROWS, del: { ...DIFF_ROWS.del, edge: 'card' } };
    expect(shortfalls(theme, faintEdge)).toContainEqual(
      expect.stringContaining('the del edge against the page'),
    );
    const dimNumber = { ...DIFF_ROWS, add: { ...DIFF_ROWS.add, number: 'surface' } };
    expect(shortfalls(theme, dimNumber)).toContainEqual(
      expect.stringContaining('the line number on the add tint'),
    );
  });
});

describe('solveDiffTint', () => {
  // A mid grey over white: 20% of it is 7.5 from the page, and 27% the first share 10 from it.
  const white: RGB = [255, 255, 255];
  const black: RGB = [0, 0, 0];
  const grey: RGB = [128, 128, 128];
  const at = (tone: RGB, page: RGB, share: number): RGB =>
    toRgb(composite(tone, page, share / 100).map(Math.round));
  const readable = (code: RGB, number: RGB, tint: RGB): boolean =>
    contrast(code, tint) >= DIFF_CODE_MIN_CONTRAST &&
    contrast(number, tint) >= DIFF_NUMBER_MIN_CONTRAST;

  it('is the floor where the floor already stands off the page', () => {
    const green: RGB = [0, 255, 0];
    expect(solveDiffTint(green, black, white, white)).toEqual(at(green, black, DIFF_TINT_FLOOR));
  });

  it('takes the least more that reaches the target where the floor is too faint', () => {
    const tint = solveDiffTint(grey, white, black, black);
    expect(tint).toEqual(at(grey, white, 27));
    expect(difference(tint, white)).toBeGreaterThanOrEqual(DIFF_TINT_TARGET);
    expect(difference(at(grey, white, 26), white)).toBeLessThan(DIFF_TINT_TARGET);
  });

  it('stops short of the target when one more share would take the code under AA', () => {
    const code: RGB = [101, 101, 101];
    const tint = toRgb(solveDiffTint(grey, white, code, black));
    expect(tint).toEqual(at(grey, white, 22));
    expect(difference(tint, white)).toBeLessThan(DIFF_TINT_TARGET);
    expect(readable(code, black, tint)).toBe(true);
    expect(readable(code, black, at(grey, white, 23))).toBe(false);
  });

  it('stops short of the target when one more share would take the line number under 3:1', () => {
    const number: RGB = [130, 130, 130];
    const tint = toRgb(solveDiffTint(grey, white, black, number));
    expect(tint).toEqual(at(grey, white, 21));
    expect(readable(black, number, tint)).toBe(true);
    expect(readable(black, number, at(grey, white, 22))).toBe(false);
  });

  it('goes under the floor when the text cannot take the floor', () => {
    const code: RGB = [110, 110, 110];
    expect(readable(code, black, at(grey, white, DIFF_TINT_FLOOR))).toBe(false);
    // The most the code can take, and it is still a tint: 11% of the grey.
    expect(solveDiffTint(grey, white, code, black)).toEqual(at(grey, white, 11));
    expect(readable(code, black, at(grey, white, 11))).toBe(true);
    expect(readable(code, black, at(grey, white, 12))).toBe(false);
  });

  it('is the bare page when the text does not read even there', () => {
    const faint: RGB = [150, 150, 150];
    expect(solveDiffTint(grey, white, faint, faint)).toEqual(white);
  });

  it('ends at the tone itself when the tone is the page: no share can stand off it', () => {
    expect(solveDiffTint(white, white, black, black)).toEqual(white);
  });

  it('never goes under the floor to meet the target sooner: near black the measure is not to be trusted', () => {
    const green: RGB = [100, 250, 120];
    // 2% of the tone over black is `2 5 2`: 10 by the measure, and not a colour a display shows.
    expect(difference(at(green, black, 2), black)).toBeGreaterThanOrEqual(DIFF_TINT_TARGET);
    expect(solveDiffTint(green, black, white, white)).toEqual(at(green, black, DIFF_TINT_FLOOR));
  });
});

describe('difference', () => {
  it('knows black from white, and a colour from itself', () => {
    expect(difference([10, 20, 30], [10, 20, 30])).toBe(0);
    expect(difference([0, 0, 0], [255, 255, 255])).toBeCloseTo(100, 0);
  });

  it('tells a red from a green of the same lightness, where a contrast ratio cannot', () => {
    const red: RGB = [200, 60, 60];
    const green: RGB = [40, 127, 40];
    expect(contrast(red, green)).toBeLessThan(1.1);
    expect(difference(red, green)).toBeGreaterThan(20);
  });
});

describe('generate', () => {
  const block = (lines: string[]): string => `[data-theme='t'] {\n${lines.join('\n')}\n}\n`;
  const tones = [
    '  --surface: 255 255 255;',
    '  --card: 250 250 250;',
    '  --text-primary: 0 0 0;',
    '  --text-muted: 60 60 60;',
    '  --accent: 0 90 200;',
    '  --success: 128 128 128;',
    '  --warning: 150 100 0;',
    '  --danger: 60 0 0;',
    '  --info: 0 110 140;',
  ];

  it('writes a theme its foregrounds and its diff tints, after the tones they come from', () => {
    const out = generate(block([...tones, '  --purple: 1 2 3;']));
    const names = [...out.matchAll(/--([\w-]+):/g)].map((match) => match[1]);
    expect(names.slice(names.indexOf('info'))).toEqual([
      'info',
      ...FG_TONES.map((tone) => `${tone}-fg`),
      'diff-add',
      'diff-del',
      'purple',
    ]);
    // The grey is raised to the target (27%); the dark red stands off white at the floor (20%).
    expect(out).toContain('--diff-add: 221 221 221;');
    expect(out).toContain('--diff-del: 216 204 204;');
    expect(generate(out)).toBe(out);
  });

  it('replaces a stale diff tint instead of keeping it or writing a second', () => {
    const stale = block([...tones, '  --diff-add: 9 8 7;', '  --diff-del: 7 8 9;']);
    const out = generate(stale);
    expect(out).toBe(generate(block(tones)));
    expect(out.match(/--diff-add:/g)).toHaveLength(1);
    expect(out).not.toContain('9 8 7');
  });

  it('refuses a theme without the line-number colour the diff tints are solved against', () => {
    const missing = tones.filter((line) => !line.includes('--text-muted'));
    expect(() => generate(block(missing))).toThrow("Theme 't' does not define --text-muted");
  });
});
