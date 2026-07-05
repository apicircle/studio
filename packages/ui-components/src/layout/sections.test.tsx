import { render } from '@testing-library/react';
import { describe, expect, it, beforeEach, vi } from 'vitest';
import { Compass, Server } from 'lucide-react';
import {
  NO_SECTIONS,
  SectionsProvider,
  useSections,
  resolveActiveSection,
  readStoredSection,
  writeStoredSection,
  type SectionDef,
  type SectionsContextValue,
} from './sections';

const studio: SectionDef = {
  id: 'studio',
  label: 'Studio',
  icon: Compass,
  panelIds: ['editor', 'workspace'],
};
const lens: SectionDef = {
  id: 'lens',
  label: 'Lens',
  icon: Server,
  description: 'Discover',
  panelIds: ['lens.discover'],
};
const two = [studio, lens];

describe('sections seam', () => {
  it('NO_SECTIONS is a frozen empty array (stable default identity)', () => {
    expect(NO_SECTIONS).toEqual([]);
    expect(Object.isFrozen(NO_SECTIONS)).toBe(true);
  });

  it('useSections defaults to empty/no-op with no provider (Studio)', () => {
    let seen: SectionsContextValue | undefined;
    function Probe() {
      seen = useSections();
      return null;
    }
    render(<Probe />);
    expect(seen?.sections).toEqual([]);
    expect(seen?.activeSectionId).toBe('');
    expect(() => seen?.setActiveSectionId('x')).not.toThrow(); // default setter is a no-op
  });

  it('useSections returns the provided value', () => {
    let seen: SectionsContextValue | undefined;
    function Probe() {
      seen = useSections();
      return null;
    }
    render(
      <SectionsProvider
        value={{ sections: two, activeSectionId: 'lens', setActiveSectionId: vi.fn() }}
      >
        <Probe />
      </SectionsProvider>,
    );
    expect(seen?.sections).toEqual(two);
    expect(seen?.activeSectionId).toBe('lens');
  });

  describe('resolveActiveSection', () => {
    it('returns the matching section', () => {
      expect(resolveActiveSection('lens', two)).toBe(lens);
    });
    it('falls back to the first section for an unknown id', () => {
      expect(resolveActiveSection('ghost', two)).toBe(studio);
    });
    it('returns null when no sections are registered', () => {
      expect(resolveActiveSection('anything', [])).toBeNull();
    });
  });

  describe('readStoredSection / writeStoredSection', () => {
    beforeEach(() => localStorage.clear());

    it('returns the first section id when fewer than 2 sections', () => {
      expect(readStoredSection('ws1', [])).toBe('');
      expect(readStoredSection('ws1', [studio])).toBe('studio');
    });

    it('returns the first section when nothing is stored', () => {
      expect(readStoredSection('ws1', two)).toBe('studio');
    });

    it('round-trips a stored section, keyed per workspace', () => {
      writeStoredSection('ws1', 'lens');
      expect(readStoredSection('ws1', two)).toBe('lens');
      // A different workspace is independent → its own default.
      expect(readStoredSection('ws2', two)).toBe('studio');
    });

    it('ignores a stored id that is not a registered section', () => {
      writeStoredSection('ws1', 'ghost');
      expect(readStoredSection('ws1', two)).toBe('studio');
    });

    it('is a safe default / no-op when localStorage is unavailable (SSR guard)', () => {
      vi.stubGlobal('localStorage', undefined);
      expect(readStoredSection('ws1', two)).toBe('studio');
      expect(() => writeStoredSection('ws1', 'lens')).not.toThrow();
      vi.unstubAllGlobals();
    });

    it('treats a throwing localStorage as "no stored mode" and write as a no-op', () => {
      vi.stubGlobal('localStorage', {
        getItem: () => {
          throw new Error('boom');
        },
        setItem: () => {
          throw new Error('boom');
        },
      });
      expect(readStoredSection('ws1', two)).toBe('studio');
      expect(() => writeStoredSection('ws1', 'lens')).not.toThrow();
      vi.unstubAllGlobals();
    });
  });
});
