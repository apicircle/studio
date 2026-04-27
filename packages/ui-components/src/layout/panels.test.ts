import { describe, expect, it } from 'vitest';
import { PANELS, getPanel } from './panels';

describe('panels registry', () => {
  it('lists exactly 7 panels in the agreed order', () => {
    expect(PANELS.map((p) => p.id)).toEqual([
      'workspace',
      'link-workspace',
      'editor',
      'env',
      'execution',
      'history',
      'help',
    ]);
  });

  it('only Help Center has hasSidebar=false', () => {
    const noSidebar = PANELS.filter((p) => !p.hasSidebar).map((p) => p.id);
    expect(noSidebar).toEqual(['help']);
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
