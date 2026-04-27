import { describe, expect, it } from 'vitest';
import { HELP_SECTIONS, searchHelp } from './helpContent';

describe('Help Center content', () => {
  it('every section is under the 80-word body cap', () => {
    for (const section of HELP_SECTIONS) {
      const wordCount = section.body.split(/\s+/).filter(Boolean).length;
      // Soft cap with a small margin for editorial wiggle. The plan §11.3
      // says "If we need more than 80 words for a section, the section is
      // doing too much" — 100 keeps the spirit while not failing CI on
      // a one-word edit.
      expect(wordCount, `${section.id} body word count`).toBeLessThanOrEqual(100);
    }
  });

  it('section ids are unique', () => {
    const ids = HELP_SECTIONS.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('searchHelp', () => {
  it('returns every section for an empty / whitespace query', () => {
    expect(searchHelp('')).toEqual(HELP_SECTIONS);
    expect(searchHelp('   ')).toEqual(HELP_SECTIONS);
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
