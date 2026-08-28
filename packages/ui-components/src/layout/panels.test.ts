import { describe, expect, it } from 'vitest';
import { PANELS, getPanel } from './panels';

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
