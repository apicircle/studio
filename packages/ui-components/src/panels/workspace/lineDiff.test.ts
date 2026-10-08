import { describe, expect, it } from 'vitest';
import {
  MAX_COMPARED_CELLS,
  capHunks,
  countChangedLines,
  diffLines,
  toHunks,
  type DiffLine,
} from './lineDiff';

/** A diff as the lines a reader sees: ` kept`, `-removed`, `+added`. */
const drawn = (lines: readonly DiffLine[]): string[] =>
  lines.map((line) => `${line.kind === 'add' ? '+' : line.kind === 'del' ? '-' : ' '}${line.text}`);

/** Put a diff back together: the old text from its kept and removed lines, the new from kept and added. */
const sides = (lines: readonly DiffLine[]) => ({
  before: lines.filter((line) => line.kind !== 'add').map((line) => line.text),
  after: lines.filter((line) => line.kind !== 'del').map((line) => line.text),
});

describe('diffLines', () => {
  it.each<[string, string[], string[], string[]]>([
    ['nothing on either side', [], [], []],
    ['the same text', ['a', 'b'], ['a', 'b'], [' a', ' b']],
    ['a text that did not exist', [], ['a', 'b'], ['+a', '+b']],
    ['a text that was removed', ['a', 'b'], [], ['-a', '-b']],
    ['one line replaced', ['a', 'b', 'c'], ['a', 'x', 'c'], [' a', '-b', '+x', ' c']],
    ['a line added at the end', ['a'], ['a', 'b'], [' a', '+b']],
    ['a line added at the start', ['b'], ['a', 'b'], ['+a', ' b']],
    ['a line removed from the middle', ['a', 'b', 'c'], ['a', 'c'], [' a', '-b', ' c']],
    [
      'two edits with a kept line between them',
      ['a', 'b', 'c', 'd', 'e'],
      ['a', 'x', 'c', 'y', 'e'],
      [' a', '-b', '+x', ' c', '-d', '+y', ' e'],
    ],
    // The repeated line is the trap: the shared start and end must not overlap.
    ['a repeated line growing by one', ['a', 'a'], ['a', 'a', 'a'], [' a', ' a', '+a']],
    ['a repeated line shrinking by one', ['a', 'a', 'a'], ['a', 'a'], [' a', ' a', '-a']],
    [
      'lines kept in the middle of a rewrite',
      ['a', 'b', 'c', 'd'],
      ['x', 'b', 'c', 'y', 'z'],
      ['-a', '+x', ' b', ' c', '-d', '+y', '+z'],
    ],
  ])('marks %s', (_name, before, after, want) => {
    const lines = diffLines(before, after);
    expect(drawn(lines)).toEqual(want);
    expect(sides(lines)).toEqual({ before, after });
  });

  it('numbers each line by the side it is on', () => {
    expect(diffLines(['a', 'b', 'c'], ['a', 'x', 'y', 'c'])).toEqual([
      { kind: 'context', text: 'a', oldLine: 1, newLine: 1 },
      { kind: 'del', text: 'b', oldLine: 2 },
      { kind: 'add', text: 'x', newLine: 2 },
      { kind: 'add', text: 'y', newLine: 3 },
      { kind: 'context', text: 'c', oldLine: 3, newLine: 4 },
    ]);
  });

  it('reports a pair too large to compare as removed, then added, around what they share', () => {
    const size = Math.ceil(Math.sqrt(MAX_COMPARED_CELLS)) + 1;
    const before = ['head', ...Array.from({ length: size }, (_, i) => `old ${i}`), 'tail'];
    const after = ['head', ...Array.from({ length: size }, (_, i) => `new ${i}`), 'tail'];
    const lines = diffLines(before, after);
    expect(sides(lines)).toEqual({ before, after });
    expect(countChangedLines(lines)).toEqual({ additions: size, deletions: size });
    expect(lines[0]).toEqual({ kind: 'context', text: 'head', oldLine: 1, newLine: 1 });
    expect(lines[1].kind).toBe('del');
    expect(lines[size].kind).toBe('del');
    expect(lines[size + 1].kind).toBe('add');
    expect(lines[lines.length - 1]).toEqual({
      kind: 'context',
      text: 'tail',
      oldLine: size + 2,
      newLine: size + 2,
    });
  });
});

describe('countChangedLines', () => {
  it('counts added and removed lines, not kept ones', () => {
    expect(countChangedLines(diffLines(['a', 'b', 'c'], ['a', 'x', 'y', 'c']))).toEqual({
      additions: 2,
      deletions: 1,
    });
    expect(countChangedLines([])).toEqual({ additions: 0, deletions: 0 });
  });
});

describe('toHunks', () => {
  const numbered = (count: number): string[] =>
    Array.from({ length: count }, (_, i) => `line ${i + 1}`);

  it('has no hunk for a text that did not change', () => {
    expect(toHunks(diffLines(['a', 'b'], ['a', 'b']))).toEqual([]);
    expect(toHunks([])).toEqual([]);
  });

  it('keeps three unchanged lines on either side of a change', () => {
    const before = numbered(12);
    const after = [...before];
    after[5] = 'changed';
    const [hunk, ...rest] = toHunks(diffLines(before, after));
    expect(rest).toEqual([]);
    expect(hunk.header).toBe('@@ -3,7 +3,7 @@');
    expect(drawn(hunk.lines)).toEqual([
      ' line 3',
      ' line 4',
      ' line 5',
      '-line 6',
      '+changed',
      ' line 7',
      ' line 8',
      ' line 9',
    ]);
  });

  it('stops at the ends of the text', () => {
    const [hunk] = toHunks(diffLines(['a', 'b'], ['x', 'b']));
    expect(hunk.header).toBe('@@ -1,2 +1,2 @@');
    expect(drawn(hunk.lines)).toEqual(['-a', '+x', ' b']);
  });

  it('writes a side with no lines as the line before it and a count of zero', () => {
    expect(toHunks(diffLines([], ['a', 'b'])).map((hunk) => hunk.header)).toEqual([
      '@@ -0,0 +1,2 @@',
    ]);
    expect(toHunks(diffLines(['a', 'b'], [])).map((hunk) => hunk.header)).toEqual([
      '@@ -1,2 +0,0 @@',
    ]);
    // A line added after line 2, with no context asked for: nothing of the old side is in it.
    expect(
      toHunks(diffLines(['a', 'b', 'c'], ['a', 'b', 'x', 'c']), 0).map((hunk) => hunk.header),
    ).toEqual(['@@ -2,0 +3,1 @@']);
  });

  it('joins changes whose context touches, and splits the ones further apart', () => {
    const before = numbered(30);
    const near = [...before];
    near[5] = 'first';
    near[11] = 'second';
    // Lines 7-9 follow the first change and 9-11 lead the second: one hunk.
    expect(toHunks(diffLines(before, near)).map((hunk) => hunk.header)).toEqual([
      '@@ -3,13 +3,13 @@',
    ]);

    const far = [...before];
    far[5] = 'first';
    far[20] = 'second';
    expect(toHunks(diffLines(before, far)).map((hunk) => hunk.header)).toEqual([
      '@@ -3,7 +3,7 @@',
      '@@ -18,7 +18,7 @@',
    ]);
  });
});

describe('capHunks', () => {
  const hunks = toHunks(
    diffLines(
      Array.from({ length: 30 }, (_, i) => `line ${i + 1}`),
      Array.from({ length: 30 }, (_, i) => (i === 5 || i === 20 ? 'changed' : `line ${i + 1}`)),
    ),
  );

  it('leaves a diff that fits as it is', () => {
    expect(capHunks(hunks, 16)).toEqual({ hunks, hidden: 0 });
  });

  it('cuts the hunk that does not fit and drops the ones after it', () => {
    const capped = capHunks(hunks, 3);
    expect(capped.hidden).toBe(13);
    expect(capped.hunks).toEqual([{ header: hunks[0].header, lines: hunks[0].lines.slice(0, 3) }]);
  });

  it('keeps a whole hunk and none of the next when the room ends between them', () => {
    expect(capHunks(hunks, 8)).toEqual({ hunks: [hunks[0]], hidden: 8 });
  });
});
