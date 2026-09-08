import { describe, expect, it } from 'vitest';
import { HELP_SECTIONS, VISIBLE_HELP_SECTIONS, searchHelp } from './helpContent';

describe('Help Center content', () => {
  it('every section has a non-empty title and body', () => {
    for (const section of HELP_SECTIONS) {
      expect(section.id, 'section id').toBeTruthy();
      expect(section.title.trim(), `${section.id} title`).not.toBe('');
      expect(section.body.trim(), `${section.id} body`).not.toBe('');
    }
  });

  it('section ids are unique', () => {
    const ids = HELP_SECTIONS.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('bullet-list, code-block and sub-heading markup is well-formed', () => {
    // The HelpPanel renderer treats a block whose every line starts with
    // `- ` as a list, a block whose every line starts with four spaces as
    // a code block, and a single `## ` line as a sub-heading. A block that
    // mixes any of these with prose lines would render as a paragraph and
    // leak the literal markers — guard against that.
    for (const section of HELP_SECTIONS) {
      for (const block of section.body.split(/\n\n+/)) {
        const lines = block.split('\n');
        const bulletCount = lines.filter((l) => l.startsWith('- ')).length;
        if (bulletCount > 0) {
          expect(bulletCount, `${section.id} mixed bullet block`).toBe(lines.length);
        }
        const indentCount = lines.filter((l) => l.startsWith('    ')).length;
        if (indentCount > 0) {
          expect(indentCount, `${section.id} mixed code block`).toBe(lines.length);
        }
        if (lines.some((l) => l.startsWith('## '))) {
          expect(lines.length, `${section.id} sub-heading is its own block`).toBe(1);
        }
      }
    }
  });
});

describe('VISIBLE_HELP_SECTIONS', () => {
  it('withholds the two workspace-sharing articles without deleting them', () => {
    const visible = VISIBLE_HELP_SECTIONS.map((x) => x.id);
    expect(visible).not.toContain('link-workspace');
    expect(visible).not.toContain('release-management');
    // Still in the catalogue, so an anchor written before the switch resolves.
    expect(HELP_SECTIONS.map((x) => x.id)).toContain('link-workspace');
    expect(HELP_SECTIONS.map((x) => x.id)).toContain('release-management');
  });
});

describe('searchHelp', () => {
  it('returns every VISIBLE section for an empty / whitespace query', () => {
    expect(searchHelp('')).toEqual([...VISIBLE_HELP_SECTIONS]);
    expect(searchHelp('   ')).toEqual([...VISIBLE_HELP_SECTIONS]);
  });

  it('searches the visible list, so a hit can never jump to a hidden article', () => {
    // 'yank' appears only in Release Management, which this build withholds.
    // The search finding it would open an article the rail doesn't list.
    expect(searchHelp('yank')).toEqual([]);
    expect(searchHelp('marketplace')).toEqual([]);
  });

  it('still searches the full catalogue when explicitly given it', () => {
    // The parameter exists so the articles stay reachable the day the switch
    // flips, and so this assertion can prove they were withheld, not deleted.
    expect(searchHelp('yank', HELP_SECTIONS).map((x) => x.id)).toEqual(['release-management']);
  });

  it('matches by title substring (case-insensitive)', () => {
    const hits = searchHelp('History');
    expect(hits.map((s) => s.id)).toContain('history');
  });

  it('matches body substrings', () => {
    const hits = searchHelp('AES-GCM');
    expect(hits.map((s) => s.id)).toContain('environments');
  });

  it('matches by keyword even when the term is absent from title and body', () => {
    // "hotkey" only lives in the keyboard-shortcuts keywords list, not in
    // its body.
    const hits = searchHelp('hotkey');
    expect(hits.map((s) => s.id)).toEqual(['keyboard-shortcuts']);
  });

  it('returns no results when nothing matches', () => {
    expect(searchHelp('xyz-not-in-anything-zzz')).toEqual([]);
  });

  it('preserves the original section order in results', () => {
    const hits = searchHelp('workspace');
    const positions = hits.map((s) => HELP_SECTIONS.findIndex((x) => x.id === s.id));
    const sorted = [...positions].sort((a, b) => a - b);
    expect(positions).toEqual(sorted);
  });
});
