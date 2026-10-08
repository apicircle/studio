// A line diff of two texts, grouped into the hunks of a unified diff — what
// the unpushed-changes preview draws a Studio change from. Pure: no React, no
// store. The inputs are a few dozen lines of pretty-printed JSON, so this is
// the textbook longest-common-subsequence diff rather than a library.

/**
 * One line of a diff. Each kind carries exactly the line numbers it has: a line
 * on both sides has both, an added line only the new one, a removed line only
 * the old one.
 */
export type DiffLine =
  | { kind: 'context'; text: string; oldLine: number; newLine: number }
  | { kind: 'add'; text: string; newLine: number }
  | { kind: 'del'; text: string; oldLine: number };

/** A run of changed lines with the unchanged lines around it. */
export interface DiffHunk {
  /** `@@ -<oldStart>,<oldCount> +<newStart>,<newCount> @@`. */
  header: string;
  lines: DiffLine[];
}

/**
 * Past this many cells the comparison table is not built: the lines that
 * differ are reported as all removed, then all added. Still a correct diff,
 * only not the shortest one — and it keeps a large pair from freezing the UI.
 */
export const MAX_COMPARED_CELLS = 1_000_000;

/** The most diff lines one open change draws. The rest are counted, not drawn. */
export const MAX_DRAWN_LINES = 1000;

/**
 * Every line of both texts, in order, marked as kept, removed or added. Where
 * a line was replaced, the removed lines come before the added ones.
 */
export function diffLines(before: readonly string[], after: readonly string[]): DiffLine[] {
  // What the two share at the start and at the end needs no comparing: an
  // edit to one field leaves a middle of a line or two.
  const shortest = Math.min(before.length, after.length);
  let head = 0;
  while (head < shortest && before[head] === after[head]) head += 1;
  let tail = 0;
  while (
    tail < shortest - head &&
    before[before.length - 1 - tail] === after[after.length - 1 - tail]
  ) {
    tail += 1;
  }

  const lines: DiffLine[] = [];
  let oldLine = 1;
  let newLine = 1;
  const keep = (text: string) => {
    lines.push({ kind: 'context', text, oldLine, newLine });
    oldLine += 1;
    newLine += 1;
  };
  const remove = (text: string) => {
    lines.push({ kind: 'del', text, oldLine });
    oldLine += 1;
  };
  const add = (text: string) => {
    lines.push({ kind: 'add', text, newLine });
    newLine += 1;
  };

  for (let i = 0; i < head; i += 1) keep(before[i]);

  const removed = before.slice(head, before.length - tail);
  const added = after.slice(head, after.length - tail);
  const rows = removed.length;
  const cols = added.length;
  if (rows * cols > MAX_COMPARED_CELLS) {
    removed.forEach(remove);
    added.forEach(add);
  } else {
    // common[i][j]: how many lines `removed` from i and `added` from j share,
    // in order. The cap above keeps the shorter side under 65,536 lines.
    const width = cols + 1;
    const common = new Uint16Array((rows + 1) * width);
    for (let i = rows - 1; i >= 0; i -= 1) {
      for (let j = cols - 1; j >= 0; j -= 1) {
        common[i * width + j] =
          removed[i] === added[j]
            ? common[(i + 1) * width + j + 1] + 1
            : Math.max(common[(i + 1) * width + j], common[i * width + j + 1]);
      }
    }
    let i = 0;
    let j = 0;
    while (i < rows && j < cols) {
      if (removed[i] === added[j]) {
        keep(removed[i]);
        i += 1;
        j += 1;
      } else if (common[(i + 1) * width + j] >= common[i * width + j + 1]) {
        remove(removed[i]);
        i += 1;
      } else {
        add(added[j]);
        j += 1;
      }
    }
    for (; i < rows; i += 1) remove(removed[i]);
    for (; j < cols; j += 1) add(added[j]);
  }

  for (let i = before.length - tail; i < before.length; i += 1) keep(before[i]);
  return lines;
}

/** How many lines a diff adds and removes. */
export function countChangedLines(lines: readonly DiffLine[]): {
  additions: number;
  deletions: number;
} {
  let additions = 0;
  let deletions = 0;
  for (const line of lines) {
    if (line.kind === 'add') additions += 1;
    else if (line.kind === 'del') deletions += 1;
  }
  return { additions, deletions };
}

/**
 * Group a diff into hunks: each run of changed lines with up to `context`
 * unchanged lines on either side. Runs whose context would touch or overlap
 * share a hunk. No changed line, no hunk.
 */
export function toHunks(lines: readonly DiffLine[], context = 3): DiffHunk[] {
  // [start, end) of each hunk, as indexes into `lines`.
  const ranges: [number, number][] = [];
  lines.forEach((line, index) => {
    if (line.kind === 'context') return;
    const start = Math.max(0, index - context);
    const end = Math.min(lines.length, index + context + 1);
    const last = ranges[ranges.length - 1];
    if (last && start <= last[1]) last[1] = end;
    else ranges.push([start, end]);
  });

  // How many old and new lines sit before each index: where a hunk starts.
  const oldBefore: number[] = [0];
  const newBefore: number[] = [0];
  for (const line of lines) {
    oldBefore.push(oldBefore[oldBefore.length - 1] + (line.kind === 'add' ? 0 : 1));
    newBefore.push(newBefore[newBefore.length - 1] + (line.kind === 'del' ? 0 : 1));
  }
  // A side with no lines in the hunk is written `<line before it>,0`.
  const span = (before: number, count: number) => `${count === 0 ? before : before + 1},${count}`;

  return ranges.map(([start, end]) => ({
    header: `@@ -${span(oldBefore[start], oldBefore[end] - oldBefore[start])} +${span(
      newBefore[start],
      newBefore[end] - newBefore[start],
    )} @@`,
    lines: lines.slice(start, end),
  }));
}

/**
 * Keep the first `maxLines` lines of a diff's hunks, and say how many were
 * left out. A hunk that does not fit whole is cut; the ones after it go.
 */
export function capHunks(
  hunks: readonly DiffHunk[],
  maxLines: number,
): { hunks: DiffHunk[]; hidden: number } {
  const kept: DiffHunk[] = [];
  let room = maxLines;
  let hidden = 0;
  for (const hunk of hunks) {
    if (hunk.lines.length <= room) {
      kept.push(hunk);
      room -= hunk.lines.length;
    } else {
      if (room > 0) kept.push({ header: hunk.header, lines: hunk.lines.slice(0, room) });
      hidden += hunk.lines.length - room;
      room = 0;
    }
  }
  return { hunks: kept, hidden };
}
