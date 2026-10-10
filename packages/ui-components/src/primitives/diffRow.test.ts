import { describe, expect, it } from 'vitest';
import { DIFF_NUMBER, DIFF_TINTS } from '../../../../scripts/gen-status-fg.mjs';
import { cn } from './cn';
import { DIFF_ROW, DIFF_ROW_MARKER, DIFF_ROW_NUMBER, DIFF_ROW_TONE } from './diffRow';

// The row's classes, held to what the theme was solved for.
//
// `--diff-add` / `--diff-del` are generated per theme (scripts/gen-status-fg.mjs)
// for one arrangement: a tint of a given tone, with the code and a line number of
// a given colour on it. apps/web's theme-contrast.test.ts measures that
// arrangement on every theme. This is the other half: it fails when a class here
// stops being that arrangement, so a row cannot quietly be drawn with something
// the themes were never measured for.

const MARKED = ['add', 'del'] as const;

describe('diffRow', () => {
  it.each(MARKED)(
    'a marked line (%s) is its generated tint and an edge in the tone it is a tint of',
    (kind) => {
      expect(DIFF_ROW_TONE[kind].split(' ').sort()).toEqual(
        [`bg-diff-${kind}`, `border-l-${DIFF_TINTS[kind]}`].sort(),
      );
    },
  );

  it.each(MARKED)(
    'a marked line (%s) has its number in the colour the tint was solved against',
    (kind) => {
      expect(DIFF_ROW_NUMBER[kind]).toBe(`text-${DIFF_NUMBER}`);
    },
  );

  it('an unchanged line has no tint, a clear edge, and the dimmer number', () => {
    expect(DIFF_ROW_TONE.context).toBe('border-l-transparent');
    expect(DIFF_ROW_NUMBER.context).toBe('text-text-dim');
  });

  it('every row has the edge’s width, so the code starts at one column', () => {
    expect(DIFF_ROW.split(' ')).toEqual(['border-l-2', 'pl-[calc(0.5rem-2px)]', 'pr-2']);
  });

  it('survives the class merge whole: the edge’s width and its colour are not one setting', () => {
    for (const kind of [...MARKED, 'context'] as const) {
      const merged = cn('flex items-start gap-2', DIFF_ROW, DIFF_ROW_TONE[kind]).split(' ');
      expect(merged).toEqual(
        expect.arrayContaining([...DIFF_ROW.split(' '), ...DIFF_ROW_TONE[kind].split(' ')]),
      );
    }
  });

  it('signs a line without colour: plus, a true minus, and a space that keeps the column', () => {
    expect(DIFF_ROW_MARKER).toEqual({ add: '+', del: '−', context: ' ' });
  });
});
