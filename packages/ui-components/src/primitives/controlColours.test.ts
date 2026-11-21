import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

// A control's focus and ticked state are drawn in a tone's readable colour:
// `accent-fg`, `danger-fg` and the like, which apps/web's theme-contrast test
// holds to 3:1 on every theme. The bare tone, or a thin share of it, is not:
//   - every focus indicator (a ring, an edge or an outline that shows on
//     focus): a field's 30% ring was under 3:1 on all 60 themes, a checkbox's
//     50% ring on 51, and the bare accent edge on Ayu Light;
//   - a native checkbox's or radio's ticked fill (`accent-color`): the bare
//     accent was under 3:1 on Ayu Light and Tokyo Night Day, amber on 9 themes.
// This reads every source file, so a new control cannot bring either back.

const SRC = join(__dirname, '..');

/** Every `.ts` / `.tsx` source file under `src`, tests left out. */
function sources(dir = SRC): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === '__snapshots__' ? [] : sources(path);
    return /\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name) ? [path] : [];
  });
}

/** Every hit of `find` in every source file that `allowed` turns away, as `file: hit`. */
function offences(find: (text: string) => string[]): string[] {
  return sources().flatMap((file) =>
    find(readFileSync(file, 'utf8')).map(
      (hit) => `${relative(SRC, file).replace(/\\/g, '/')}: ${hit}`,
    ),
  );
}

/** The one form allowed: a tone's readable colour, whole. */
const READABLE = /-(?:accent|danger|warning|success|info)-fg$/;

/** A focus-state colour utility on a tone: `focus:border-accent`, `peer-focus-visible:ring-danger/40`. */
const FOCUS_TONE =
  /(?<![\w:/-])(?:[\w-]+:)*(?:(?:peer|group)-)?(?:focus|focus-visible|focus-within):(?:ring|border|outline)-(?:accent|danger|warning|success|info)[\w/-]*/g;

/** Every focus colour in `text` that is not a readable one. */
function faintFocus(text: string): string[] {
  return [...text.matchAll(FOCUS_TONE)].map((m) => m[0]).filter((token) => !READABLE.test(token));
}

/** A native box's ticked fill: Tailwind's `accent-*` on a colour, or an inline `accentColor`. */
const TICK_CLASS =
  /(?<![\w:/-])(?:[\w-]+:)*accent-(?:accent|danger|warning|success|info|amber|red|green|blue|purple)[\w/-]*/g;
const TICK_STYLE = /accentColor:\s*['"`]rgb\(var\(--([\w-]+)\)\)['"`]/g;

/** Every ticked-fill colour in `text` that is not a readable one. */
function faintTick(text: string): string[] {
  const classes = [...text.matchAll(TICK_CLASS)]
    .map((m) => m[0])
    .filter((token) => !READABLE.test(token));
  const styles = [...text.matchAll(TICK_STYLE)]
    .filter((m) => !READABLE.test(`-${m[1]}`))
    .map((m) => m[0]);
  return [...classes, ...styles];
}

describe('focus colours', () => {
  it('reads the source it guards (a guard that read nothing would pass anything)', () => {
    const files = sources();
    expect(files.length).toBeGreaterThan(100);
    const focusTokens = files.flatMap((file) => readFileSync(file, 'utf8').match(FOCUS_TONE) ?? []);
    expect(focusTokens.length).toBeGreaterThan(200);
  });

  it('draws every focus ring, edge and outline in a readable tone, in every source file', () => {
    expect(offences(faintFocus)).toEqual([]);
  });

  it('catches the faint and bare forms it replaced, and lets the readable ones through', () => {
    expect(
      faintFocus(
        [
          'focus:border-accent focus:ring-1 focus:ring-accent/30',
          'focus:border-danger focus:ring-danger/40',
          'peer-focus-visible:ring-2 peer-focus-visible:ring-accent/50',
          'focus-visible:ring-2 focus-visible:ring-accent/70 focus-visible:ring-offset-card',
          'focus-within:border-warning',
        ].join(' '),
      ),
    ).toEqual([
      'focus:border-accent',
      'focus:ring-accent/30',
      'focus:border-danger',
      'focus:ring-danger/40',
      'peer-focus-visible:ring-accent/50',
      'focus-visible:ring-accent/70',
      'focus-within:border-warning',
    ]);
    expect(
      faintFocus(
        'focus:border-accent-fg focus:ring-accent-fg focus:border-danger-fg peer-focus-visible:ring-accent-fg focus-visible:ring-offset-card focus:ring-1',
      ),
    ).toEqual([]);
    // A thin share of the readable colour is faint again.
    expect(faintFocus('focus:ring-accent-fg/40')).toEqual(['focus:ring-accent-fg/40']);
  });
});

describe('native checkbox and radio ticked colours', () => {
  it('reads the native boxes it guards', () => {
    const ticks = sources().flatMap((file) => {
      const text = readFileSync(file, 'utf8');
      return [...(text.match(TICK_CLASS) ?? []), ...(text.match(TICK_STYLE) ?? [])];
    });
    expect(ticks.length).toBeGreaterThan(20);
  });

  it('fills every ticked native checkbox and radio in a readable tone, in every source file', () => {
    expect(offences(faintTick)).toEqual([]);
  });

  it('catches the bare tones it replaced, and lets the readable ones through', () => {
    expect(
      faintTick(
        'className="h-3 w-3 accent-accent" className="accent-amber" style={{ accentColor: \'rgb(var(--accent))\' }}',
      ),
    ).toEqual(['accent-accent', 'accent-amber', "accentColor: 'rgb(var(--accent))'"]);
    expect(
      faintTick(
        'className="accent-accent-fg" className="accent-warning-fg" style={{ accentColor: \'rgb(var(--accent-fg))\' }}',
      ),
    ).toEqual([]);
    // Prose about an accent-coloured part is not a class.
    expect(faintTick('// the accent-coloured parts')).toEqual([]);
  });
});
