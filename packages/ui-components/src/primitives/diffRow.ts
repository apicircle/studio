// How a line of a diff is marked: the classes of its row, by what the line is.
//
// A marked line carries two things, because neither is enough alone:
//
//   the tint   `bg-diff-add` / `bg-diff-del`: the theme's own backdrop for the
//              line, generated per theme (scripts/gen-status-fg.mjs). A fixed
//              tint (`bg-danger/10`) is the tone painted thin over the page, and
//              on a page of the opposite hue the two cancel: over Solarized
//              Dark's teal a 10% red came out a grey the eye could not tell from
//              the page. The token is solved to stand off the page in every
//              theme while the code on it still reads at AA.
//   the edge   a rule down the row's left in the tone itself, unmixed. On a
//              theme where the tint can only say "not the page", it is what says
//              WHICH of the two the line is.
//
// Two tests hold this. apps/web/src/__tests__/theme-contrast.test.ts measures a
// row made of these parts on every theme, and fails when a theme is added, or a
// tone changed, that a line no longer shows on. diffRow.test.ts fails when a
// class here stops being one of those parts.
//
// NOTE: class names are FULL LITERALS. Tailwind generates only the classes it
// can see written out.

/** What a line of a diff is: added, removed, or unchanged around a change. */
export type DiffRowKind = 'add' | 'del' | 'context';

/**
 * What every row shares. Each has the edge's width, clear on a line that is not
 * marked, so the code starts at the same column on all of them: the rule and
 * the padding beside it come to the half-rem a row is padded by on its other
 * side.
 */
export const DIFF_ROW = 'border-l-2 pl-[calc(0.5rem-2px)] pr-2';

/** The tint and the edge of a row. */
export const DIFF_ROW_TONE: Record<DiffRowKind, string> = {
  add: 'border-l-success bg-diff-add',
  del: 'border-l-danger bg-diff-del',
  context: 'border-l-transparent',
};

/**
 * A row's line number. The dimmest text falls under 3:1 on a tint, so a marked
 * line's number is a step stronger than the rest; the tint is solved against it.
 */
export const DIFF_ROW_NUMBER: Record<DiffRowKind, string> = {
  add: 'text-text-muted',
  del: 'text-text-muted',
  context: 'text-text-dim',
};

/** The sign a row's code starts with: the mark that does not depend on colour at all. */
export const DIFF_ROW_MARKER: Record<DiffRowKind, string> = { add: '+', del: '−', context: ' ' };
