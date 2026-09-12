// =============================================================================
// Markdown builders for untrusted text in hovers, tree tooltips and notebook
// cells.
//
// Request names and URLs, environment names and values, mock names and folder
// names reach the extension from Postman / Insomnia / OpenAPI / HAR imports and
// from git-synced workspace.json files that someone else wrote. VS Code renders
// every MarkdownString, so a value interpolated raw can carry a link
// (`[x](https://…)`, or a `command:` link once a string is trusted),
// formatting, a bare-URL autolink or a `$(icon)`. These helpers turn a value
// into markdown that renders as exactly that text.
//
// They target MarkdownStrings that neither trust commands nor enable theme
// icons: VS Code substitutes `$(icon)` after markdown parsing, so a backslash
// before `$` does not stop it, and nothing inside a code span can.
//
// `MarkdownString.appendText` is not a substitute: it leaves `:`, `.`, `@`,
// `<` and `|` alone, so bare URLs and e-mail addresses still autolink, and it
// cannot produce a code span.
// =============================================================================

// CommonMark lets any ASCII punctuation character be backslash-escaped and
// renders it literally, so escaping the whole set covers every inline and block
// construct (links, emphasis, code, HTML, autolinks, headings, lists, tables)
// without a per-construct list to keep in step with the renderer.
const ASCII_PUNCTUATION = /[!-/:-@[-`{-~]/g;
const LINE_BREAKS = /[\r\n]+/g;

/**
 * Inline markdown that renders as `value`. Line breaks fold to a space so the
 * value stays on its line and cannot split the markup wrapped around it.
 */
export function markdownText(value: string): string {
  return value.replace(LINE_BREAKS, ' ').replace(ASCII_PUNCTUATION, '\\$&');
}

/**
 * Markdown that renders `value` as prose: blank-line paragraph breaks survive,
 * everything else is escaped as in {@link markdownText}. Each paragraph is
 * trimmed so leading indentation cannot turn it into a code block.
 */
export function markdownParagraphs(value: string): string {
  return value
    .replace(/\r\n?/g, '\n')
    .split(/\n[\t ]*\n/)
    .map((paragraph) => markdownText(paragraph.trim()))
    .join('\n\n');
}

/**
 * A code span that renders `value` verbatim. The fence is one backtick longer
 * than the longest backtick run inside, so the value cannot close it early; a
 * value that starts or ends with a backtick gets the single padding space
 * CommonMark strips back off. Line breaks fold to a space, which is how a code
 * span renders them anyway, and a blank line would otherwise end the span.
 */
export function markdownCode(value: string): string {
  const text = value.replace(LINE_BREAKS, ' ');
  const fence = '`'.repeat(longestBacktickRun(text) + 1);
  const pad = text.startsWith('`') || text.endsWith('`') ? ' ' : '';
  return `${fence}${pad}${text}${pad}${fence}`;
}

/** A fenced code block that renders `value` verbatim, whatever backtick lines it holds. */
export function markdownCodeBlock(value: string): string {
  const fence = '`'.repeat(Math.max(3, longestBacktickRun(value) + 1));
  return `${fence}\n${value}\n${fence}`;
}

function longestBacktickRun(text: string): number {
  let longest = 0;
  for (const run of text.match(/`+/g) ?? []) longest = Math.max(longest, run.length);
  return longest;
}
