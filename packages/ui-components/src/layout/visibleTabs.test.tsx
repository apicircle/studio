import { renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it } from 'vitest';
import { Compass, Server } from 'lucide-react';
import { ExtraPanelsProvider, type ExtraPanelDef } from './extraPanels';
import { SectionsProvider, type SectionDef } from './sections';
import { isShownPanel, useVisibleTabs, visibleTabs } from './visibleTabs';

const extraPanels: ExtraPanelDef[] = [
  { id: 'lens.discover', label: 'Index', icon: Compass, Panel: () => null },
  { id: 'lens.review', label: 'Review', icon: Server, Panel: () => null },
];

const sections: SectionDef[] = [
  { id: 'studio', label: 'Studio', icon: Compass, panelIds: ['workspace', 'editor'] },
  {
    id: 'lens',
    label: 'Lens',
    icon: Server,
    // Listed last here, yet first in the strip: the strip follows the shell's order.
    panelIds: ['lens.discover', 'lens.review', 'workspace'],
  },
];

const ids = (tabs: readonly { id: string }[]) => tabs.map((t) => t.id);

describe('visibleTabs', () => {
  it('is every core tab, then the edition panels, with no sections', () => {
    const tabs = visibleTabs(extraPanels, [], '');
    expect(ids(tabs)).toEqual([
      'workspace',
      'editor',
      'env',
      'execution',
      'mocks',
      'history',
      'lens.discover',
      'lens.review',
    ]);
    expect(tabs.every((t) => !t.shared)).toBe(true);
  });

  it('never includes a panel this build hides', () => {
    expect(ids(visibleTabs([], [], ''))).not.toContain('link-workspace');
  });

  it('never includes a panel opened from the top bar, even when a section lists it', () => {
    expect(ids(visibleTabs(extraPanels, [], ''))).not.toContain('help');
    const listingHelp: SectionDef[] = [
      { id: 'studio', label: 'Studio', icon: Compass, panelIds: ['editor', 'help'] },
      { id: 'lens', label: 'Lens', icon: Server, panelIds: ['lens.review', 'help'] },
    ];
    expect(ids(visibleTabs(extraPanels, listingHelp, 'studio'))).toEqual(['editor']);
    expect(ids(visibleTabs(extraPanels, listingHelp, 'lens'))).toEqual(['lens.review']);
  });

  it("narrows to the active section's panels, in the shell's order", () => {
    expect(ids(visibleTabs(extraPanels, sections, 'studio'))).toEqual(['workspace', 'editor']);
    expect(ids(visibleTabs(extraPanels, sections, 'lens'))).toEqual([
      'workspace',
      'lens.discover',
      'lens.review',
    ]);
  });

  it('falls back to the first section for an unknown mode', () => {
    expect(ids(visibleTabs(extraPanels, sections, 'ghost'))).toEqual(['workspace', 'editor']);
  });

  it('leaves out a listed id that has no panel', () => {
    // An edition lists a panel always and contributes it only sometimes.
    expect(ids(visibleTabs([extraPanels[0]], sections, 'lens'))).toEqual([
      'workspace',
      'lens.discover',
    ]);
  });

  it("puts what the modes share first, then the mode's own, each in the shell's order", () => {
    // History comes after the Editor in the shell, and both modes list it: it
    // leads the strip in both, where the divider and the mode groups follow it.
    const sharingHistory: SectionDef[] = [
      { id: 'studio', label: 'Studio', icon: Compass, panelIds: ['editor', 'history', 'env'] },
      { id: 'lens', label: 'Lens', icon: Server, panelIds: ['lens.review', 'history'] },
    ];
    expect(ids(visibleTabs(extraPanels, sharingHistory, 'studio'))).toEqual([
      'history',
      'editor',
      'env',
    ]);
    expect(ids(visibleTabs(extraPanels, sharingHistory, 'lens'))).toEqual([
      'history',
      'lens.review',
    ]);
  });

  it('marks a panel shared only when more than one section lists it', () => {
    const tabs = visibleTabs(extraPanels, sections, 'lens');
    expect(tabs.map((t) => [t.id, t.shared])).toEqual([
      ['workspace', true],
      ['lens.discover', false],
      ['lens.review', false],
    ]);
  });

  it('carries the label and icon each tab renders', () => {
    const [workspace, , review] = visibleTabs(extraPanels, sections, 'lens');
    expect(workspace.label).toBe('Workspace');
    expect(review).toMatchObject({ label: 'Review', icon: Server });
  });
});

describe('useVisibleTabs', () => {
  function wrapperFor(activeSectionId: string) {
    return function Wrapper({ children }: { children: ReactNode }) {
      return (
        <ExtraPanelsProvider value={extraPanels}>
          <SectionsProvider value={{ sections, activeSectionId, setActiveSectionId: () => {} }}>
            {children}
          </SectionsProvider>
        </ExtraPanelsProvider>
      );
    };
  }

  it('is every core tab with no providers (Studio)', () => {
    const { result } = renderHook(() => useVisibleTabs());
    expect(ids(result.current)).toEqual([
      'workspace',
      'editor',
      'env',
      'execution',
      'mocks',
      'history',
    ]);
  });

  it("reads the edition's panels and mode from context", () => {
    const { result } = renderHook(() => useVisibleTabs(), { wrapper: wrapperFor('lens') });
    expect(ids(result.current)).toEqual(['workspace', 'lens.discover', 'lens.review']);
  });

  it('keeps the same list across renders while nothing changed', () => {
    // A global key listener depends on this list; a new array per render would
    // re-subscribe it on every render.
    const { result, rerender } = renderHook(() => useVisibleTabs(), {
      wrapper: wrapperFor('lens'),
    });
    const first = result.current;
    rerender();
    expect(result.current).toBe(first);
  });
});

describe('isShownPanel', () => {
  it('is true for a visible core panel and for a registered edition panel', () => {
    expect(isShownPanel('workspace', [])).toBe(true);
    expect(isShownPanel('lens.review', extraPanels)).toBe(true);
  });

  it('is true for a panel opened from the top bar: it is shown, only not as a tab', () => {
    expect(isShownPanel('help', [])).toBe(true);
  });

  it('is false for a core panel this build hides', () => {
    expect(isShownPanel('link-workspace', extraPanels)).toBe(false);
  });

  it('is false for an edition panel that is not registered', () => {
    expect(isShownPanel('lens.review', [])).toBe(false);
    expect(isShownPanel('lens.gone', extraPanels)).toBe(false);
  });
});
