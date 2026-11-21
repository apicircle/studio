/**
 * What a split spec's `$ref` target names, told from its file extension.
 *
 * A spec's `$ref`s can name other documents. Most are JSON or YAML — schemas,
 * path items, parameters — and a split spec is read in full only once those are
 * supplied. Some are TEXT: Redocly-style specs keep long descriptions in
 * Markdown (`description: { $ref: ./intro.md }`) and code samples in source files
 * (`x-codeSamples: [{ source: { $ref: samples/get.js } }]`). A text document holds
 * no schema, so it is never a file to supply.
 *
 * `@apicircle/mock-server-core`'s bundler also tells text apart by POSITION (a
 * description, a code sample's source). This is the part a target alone can say,
 * so a stored reference list can be read with it too. It lives in `shared`
 * because both the bundler and the Assets panel read it, and the panel's store
 * must not load the bundler to render a list.
 */

/** Extensions of documents that read as JSON or YAML. */
const DOCUMENT_EXTENSIONS: ReadonlySet<string> = new Set(['json', 'yaml', 'yml']);

/** Extensions of text documents: prose, and the source files code samples are kept in. */
const TEXT_EXTENSIONS: ReadonlySet<string> = new Set([
  // prose
  'md',
  'markdown',
  'mdx',
  'txt',
  'text',
  'rst',
  'adoc',
  'html',
  'htm',
  // code samples
  'sh',
  'bash',
  'zsh',
  'ps1',
  'bat',
  'cmd',
  'curl',
  'http',
  'js',
  'mjs',
  'cjs',
  'jsx',
  'ts',
  'mts',
  'cts',
  'tsx',
  'py',
  'rb',
  'php',
  'go',
  'java',
  'kt',
  'kts',
  'scala',
  'groovy',
  'cs',
  'fs',
  'vb',
  'swift',
  'm',
  'c',
  'h',
  'cc',
  'cpp',
  'hpp',
  'rs',
  'dart',
  'ex',
  'exs',
  'erl',
  'clj',
  'lua',
  'pl',
  'r',
  'sql',
  'graphql',
  'gql',
]);

/** What a `$ref` target's extension says it is (`specRefTargetKind`). */
export type SpecRefTargetKind = 'document' | 'text' | 'unknown';

/**
 * `document` when the target is a JSON or YAML file, `text` when it is prose or
 * a code sample's source (Markdown, plain text, HTML, a `.js` or `.sh` file …),
 * else `unknown` — no extension, or one that says neither. Case does not matter,
 * and a URL's query is not part of its name.
 */
export function specRefTargetKind(target: string): SpecRefTargetKind {
  const name = target.slice(target.lastIndexOf('/') + 1).replace(/[?#].*$/, '');
  const dot = name.lastIndexOf('.');
  const ext = dot > 0 ? name.slice(dot + 1).toLowerCase() : '';
  if (DOCUMENT_EXTENSIONS.has(ext)) return 'document';
  return TEXT_EXTENSIONS.has(ext) ? 'text' : 'unknown';
}
