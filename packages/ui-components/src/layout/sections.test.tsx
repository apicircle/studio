import { render } from '@testing-library/react';
import { describe, expect, it, beforeEach, vi } from 'vitest';
import { Compass, Server } from 'lucide-react';
import {
  NO_SECTIONS,
  SectionsProvider,
  ownPanelIds,
  useSections,
  resolveActiveSection,
  readStoredSection,
  readStoredSectionPanel,
  resolveSectionPanel,
  writeStoredSection,
  writeStoredSectionPanel,
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

  describe('readStoredSectionPanel / writeStoredSectionPanel', () => {
    beforeEach(() => localStorage.clear());

    it('returns null when nothing is stored', () => {
      expect(readStoredSectionPanel('ws1', 'lens')).toBeNull();
    });

    it('round-trips a panel, keyed per workspace and per section', () => {
      writeStoredSectionPanel('ws1', 'lens', 'lens.review');
      expect(readStoredSectionPanel('ws1', 'lens')).toBe('lens.review');
      // Another section of the same workspace, and the same section of another
      // workspace, each keep their own.
      expect(readStoredSectionPanel('ws1', 'studio')).toBeNull();
      expect(readStoredSectionPanel('ws2', 'lens')).toBeNull();
    });

    it('does not share a key with the stored mode', () => {
      writeStoredSectionPanel('ws1', 'lens', 'lens.review');
      expect(readStoredSection('ws1', two)).toBe('studio');
    });

    it('is a safe default / no-op when localStorage is unavailable (SSR guard)', () => {
      vi.stubGlobal('localStorage', undefined);
      expect(readStoredSectionPanel('ws1', 'lens')).toBeNull();
      expect(() => writeStoredSectionPanel('ws1', 'lens', 'lens.review')).not.toThrow();
      vi.unstubAllGlobals();
    });

    it('treats a throwing localStorage as "nothing stored" and write as a no-op', () => {
      vi.stubGlobal('localStorage', {
        getItem: () => {
          throw new Error('boom');
        },
        setItem: () => {
          throw new Error('boom');
        },
      });
      expect(readStoredSectionPanel('ws1', 'lens')).toBeNull();
      expect(() => writeStoredSectionPanel('ws1', 'lens', 'lens.review')).not.toThrow();
      vi.unstubAllGlobals();
    });
  });

  describe('ownPanelIds', () => {
    const studioSharing: SectionDef = { ...studio, panelIds: ['workspace', 'editor', 'env'] };
    const lensSharing: SectionDef = { ...lens, panelIds: ['lens.discover', 'workspace'] };

    it('is every panel while no other section lists any of them', () => {
      expect(ownPanelIds(studio, two)).toEqual(['editor', 'workspace']);
      expect(ownPanelIds(lens, two)).toEqual(['lens.discover']);
    });

    it("leaves out a panel another section lists too, keeping the section's order", () => {
      const sharing = [studioSharing, lensSharing];
      expect(ownPanelIds(studioSharing, sharing)).toEqual(['editor', 'env']);
      expect(ownPanelIds(lensSharing, sharing)).toEqual(['lens.discover']);
    });

    it('is empty for a section whose every panel is shared', () => {
      const onlyShared: SectionDef = { ...lens, panelIds: ['workspace'] };
      expect(ownPanelIds(onlyShared, [studioSharing, onlyShared])).toEqual([]);
    });

    it('does not count the section against itself', () => {
      expect(ownPanelIds(studio, [studio])).toEqual(['editor', 'workspace']);
    });
  });

  describe('resolveSectionPanel', () => {
    const shown = () => true;
    // The Workspace page is listed by both, and first by Studio.
    const studioSharing: SectionDef = { ...studio, panelIds: ['workspace', 'editor', 'env'] };
    const lensSharing: SectionDef = { ...lens, panelIds: ['lens.discover', 'workspace'] };
    const sharing = [studioSharing, lensSharing];

    it("returns the remembered panel while it is the section's own and the shell shows it", () => {
      expect(resolveSectionPanel(studioSharing, sharing, 'env', shown)).toBe('env');
    });

    it('opens on the first own panel when nothing is remembered', () => {
      expect(resolveSectionPanel(studioSharing, sharing, null, shown)).toBe('editor');
      expect(resolveSectionPanel(studio, two, null, shown)).toBe('editor');
    });

    it('never returns to a panel the modes share, even when one was stored', () => {
      // An earlier build stored whichever listed panel was on screen.
      expect(resolveSectionPanel(studioSharing, sharing, 'workspace', shown)).toBe('editor');
    });

    it('falls back to the first own panel when the section no longer lists the remembered one', () => {
      expect(resolveSectionPanel(studioSharing, sharing, 'lens.discover', shown)).toBe('editor');
    });

    it('falls back to the first own panel when the shell no longer shows the remembered one', () => {
      expect(resolveSectionPanel(studioSharing, sharing, 'env', (id: string) => id !== 'env')).toBe(
        'editor',
      );
    });

    it('skips an own panel the shell does not show when picking the first', () => {
      expect(
        resolveSectionPanel(studioSharing, sharing, null, (id: string) => id !== 'editor'),
      ).toBe('env');
    });

    it('still names the first own panel when the shell shows none of them yet', () => {
      // An edition can contribute its panels after launch; the caller waits.
      expect(resolveSectionPanel(lensSharing, sharing, null, () => false)).toBe('lens.discover');
    });

    it('opens a section that has no panel of its own on a panel it lists', () => {
      const onlyShared: SectionDef = { ...lens, panelIds: ['workspace'] };
      expect(resolveSectionPanel(onlyShared, [studioSharing, onlyShared], null, shown)).toBe(
        'workspace',
      );
    });

    it('returns undefined for a section with no panels', () => {
      expect(resolveSectionPanel({ ...lens, panelIds: [] }, two, null, shown)).toBeUndefined();
    });
  });
});
