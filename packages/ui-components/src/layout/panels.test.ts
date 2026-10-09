import { describe, expect, it } from 'vitest';
import {
  PANELS,
  TAB_PANELS,
  TOP_BAR_PANELS,
  VISIBLE_PANELS,
  getPanel,
  isTopBarPanel,
} from './panels';

describe('panels registry', () => {
  it('lists the agreed panel set in the agreed order', () => {
    // Workspace / Link Workspace / Editor / Env / Execution / History — the
    // P1 navigation bones. Mocks is a P27 addition; Help Center stays last as
    // the catch-all reference panel, and is opened from the top bar rather than
    // a tab. MCP was removed when the MCP surface left the open-core repo.
    expect(PANELS.map((p) => p.id)).toEqual([
      'workspace',
      'link-workspace',
      'editor',
      'env',
      'execution',
      'history',
      'mocks',
      'help',
    ]);
  });

  it('only content-bearing panels carry a sidebar; the two stub-sidebar panels opt out (UX-S-014)', () => {
    const noSidebar = PANELS.filter((p) => !p.hasSidebar).map((p) => p.id);
    expect(noSidebar).toEqual(['workspace', 'link-workspace']);
  });

  it('getPanel returns the matching def', () => {
    expect(getPanel('editor').label).toBe('Editor');
    expect(getPanel('link-workspace').label).toBe('Link Workspace');
  });

  it('getPanel throws for unknown ids', () => {
    // @ts-expect-error testing invalid input
    expect(() => getPanel('settings')).toThrow(/Unknown panel/);
  });
});

describe('VISIBLE_PANELS', () => {
  it('drops Link Workspace — the sharing cluster does not ship in v1', () => {
    expect(VISIBLE_PANELS.map((p) => p.id)).toEqual([
      'workspace',
      'editor',
      'env',
      'execution',
      'history',
      'mocks',
      'help',
    ]);
  });

  it('leaves PANELS intact so a persisted id still resolves', () => {
    // The registry is what `getPanel` / `resolveActivePanel` / the store's
    // `VALID_PANELS` read. Filtering it rather than the visible list would turn
    // a stale `activePanel: 'link-workspace'` into a crash instead of a redirect.
    expect(PANELS.map((p) => p.id)).toContain('link-workspace');
    expect(getPanel('link-workspace').label).toBe('Link Workspace');
  });

  it('has a stable identity across reads', () => {
    // KeyboardShortcuts indexes this inside a useEffect. A fresh array each
    // read would re-subscribe the global keydown listener on every render.
    expect(VISIBLE_PANELS).toBe(VISIBLE_PANELS);
    expect(Object.isFrozen(VISIBLE_PANELS)).toBe(true);
  });
});

describe('tabs and top-bar panels', () => {
  it('splits the shown panels in two, with nothing in both and nothing lost', () => {
    expect(TAB_PANELS.map((p) => p.id)).toEqual([
      'workspace',
      'editor',
      'env',
      'execution',
      'history',
      'mocks',
    ]);
    expect(TOP_BAR_PANELS.map((p) => p.id)).toEqual(['help']);
    expect([...TAB_PANELS, ...TOP_BAR_PANELS].map((p) => p.id).sort()).toEqual(
      VISIBLE_PANELS.map((p) => p.id).sort(),
    );
  });

  it('keeps the Help Center a panel like any other, body and sidebar', () => {
    // Only its entry moved. The store, `getPanel` and the sidebar still resolve it.
    expect(getPanel('help')).toMatchObject({ label: 'Help Center', hasSidebar: true });
    expect(VISIBLE_PANELS.map((p) => p.id)).toContain('help');
  });

  it('answers whether an id is opened from the top bar', () => {
    expect(isTopBarPanel('help')).toBe(true);
    expect(isTopBarPanel('editor')).toBe(false);
    // An edition's panel, and an id that names nothing.
    expect(isTopBarPanel('lens.review')).toBe(false);
    expect(isTopBarPanel('')).toBe(false);
  });

  it('has a stable identity across reads', () => {
    // The tab strip and the global key listener are built from the tab list.
    expect(TAB_PANELS).toBe(TAB_PANELS);
    expect(Object.isFrozen(TAB_PANELS)).toBe(true);
    expect(Object.isFrozen(TOP_BAR_PANELS)).toBe(true);
  });
});
