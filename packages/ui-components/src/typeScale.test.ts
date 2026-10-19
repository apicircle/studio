import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

// The type scale's floor (docs/architecture/design-system.md): text read as a
// sentence is 12px (`text-xs`) or more. 11px is for uppercase micro-labels and
// chips, 10px for badges, and nothing is smaller. A section's title is the
// `SectionHeading` primitive, not a heading styled by hand.
//
// This reads the source rather than a rendered page, so it holds every screen,
// including the ones no other test opens.

const ROOT = __dirname;

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return /\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name) ? [path] : [];
  });
}

/** Index just past the `>` that closes the JSX opening tag starting at `source[start]`. */
function tagEnd(source: string, start: number): number {
  let depth = 0;
  let quote: string | null = null;
  for (let i = start + 1; i < source.length; i += 1) {
    const c = source[i];
    if (quote) {
      if (c === quote) quote = null;
    } else if (c === '"' || c === "'" || c === '`') {
      quote = c;
    } else if (c === '{') {
      depth += 1;
    } else if (c === '}') {
      depth -= 1;
    } else if (c === '>' && depth === 0) {
      return i + 1;
    }
  }
  return source.length;
}

/** Every opening tag of `name` in `source`, whole (attributes over several lines included). */
function openingTags(source: string, name: string): string[] {
  const tags: string[] = [];
  const open = new RegExp(`<${name}(?=[\\s>])`, 'g');
  for (let m = open.exec(source); m; m = open.exec(source)) {
    tags.push(source.slice(m.index, tagEnd(source, m.index)));
  }
  return tags;
}

const BELOW_THE_SCALE = /text-\[(0\.5625rem|0\.5rem|\d+px)\]/;
const UNDER_12PX = /text-\[(0\.6875rem|0\.625rem)\]/;

/** What a source file breaks of the type scale, one line per break. */
function breaches(path: string, source: string): string[] {
  const out: string[] = [];
  const where = relative(ROOT, path).replace(/\\/g, '/');
  for (const [i, line] of source.split('\n').entries()) {
    const size = BELOW_THE_SCALE.exec(line);
    if (size) out.push(`${where}:${i + 1} uses ${size[0]}, under the 10px badge size`);
  }
  for (const tag of openingTags(source, 'p')) {
    const size = UNDER_12PX.exec(tag);
    if (size) out.push(`${where}: a <p> at ${size[0]}: ${tag.replace(/\s+/g, ' ').slice(0, 80)}`);
  }
  for (const level of ['h2', 'h3', 'h4']) {
    for (const tag of openingTags(source, level)) {
      if (/\buppercase\b/.test(tag)) {
        out.push(`${where}: a hand-styled <${level}> section title (use SectionHeading)`);
      }
    }
  }
  return out;
}

describe('the type scale', () => {
  const files = sourceFiles(ROOT);

  it('reads the whole package (a scan of nothing would pass anything)', () => {
    expect(files.length).toBeGreaterThan(200);
    expect(files.some((f) => f.endsWith('WorkspacePanel.tsx'))).toBe(true);
  });

  it('has no text under 12px in a sentence, nothing under 10px anywhere, and no hand-styled section title', () => {
    expect(files.flatMap((path) => breaches(path, readFileSync(path, 'utf8')))).toEqual([]);
  });

  it('catches each kind of break, a tag over several lines included', () => {
    const sample = [
      '<span className="text-[9px]">x</span>',
      '<span className="text-[0.5625rem]">x</span>',
      '<p',
      '  id="hint"',
      '  className={cn("text-[0.6875rem]", on && "x")}',
      '>',
      '  A sentence.',
      '</p>',
      '<h3 className="text-xs uppercase tracking-wider">Title</h3>',
    ].join('\n');
    expect(breaches(join(ROOT, 'sample.tsx'), sample)).toEqual([
      'sample.tsx:1 uses text-[9px], under the 10px badge size',
      'sample.tsx:2 uses text-[0.5625rem], under the 10px badge size',
      'sample.tsx: a <p> at text-[0.6875rem]: <p id="hint" className={cn("text-[0.6875rem]", on && "x")} >',
      'sample.tsx: a hand-styled <h3> section title (use SectionHeading)',
    ]);
  });

  it('lets 11px labels and 10px badges be, and reads an arrow inside a tag as part of it', () => {
    const sample = [
      '<span className="text-[0.6875rem] uppercase">Label</span>',
      '<span className="text-[0.625rem]">3</span>',
      '<p className={cn("text-xs", (n) => n > 1)}>Fine</p>',
      '<pre className="text-[0.625rem]">code</pre>',
      '<h2 className="text-sm font-medium">Plain title</h2>',
      "<p className='text-xs'>Single-quoted</p>",
      '<p className={`text-xs ${x}`}>Template</p>',
    ].join('\n');
    expect(breaches(join(ROOT, 'sample.tsx'), sample)).toEqual([]);
  });

  it('ends a tag that is never closed at the end of the file', () => {
    expect(openingTags('<p className="text-xs"', 'p')).toEqual(['<p className="text-xs"']);
  });
});
