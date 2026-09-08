import { describe, expect, it } from 'vitest';
import { PANELS, VISIBLE_PANELS, getPanel } from './panels';

describe('panels registry', () => {
  it('lists the agreed panel set in the agreed order', () => {
    // Workspace / Link Workspace / Editor / Env / Execution / History — the
    // P1 navigation bones. Mocks is a P27 addition; Help Center stays last as
    // the catch-all reference panel. MCP was removed when the MCP surface left
    // the open-core repo, which shifted Help from index 8 to 7.
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
