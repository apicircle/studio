import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Compass } from 'lucide-react';
import {
  NO_EXTRA_PANELS,
  ExtraPanelsProvider,
  useExtraPanels,
  resolveActivePanel,
  type ExtraPanelDef,
} from './extraPanels';

const discover: ExtraPanelDef = {
  id: 'test.discover',
  label: 'Discover',
  icon: Compass,
  hasSidebar: true,
  Panel: () => <div>DISCOVER CONTENT</div>,
  Sidebar: () => <div>DISCOVER SIDEBAR</div>,
  SidebarActions: () => <span>DISCOVER ACTIONS</span>,
};

const buildNoSidebar: ExtraPanelDef = {
  id: 'test.build',
  label: 'Build',
  icon: Compass,
  Panel: () => <div>BUILD CONTENT</div>,
};

describe('extraPanels seam', () => {
  it('NO_EXTRA_PANELS is a frozen empty array (stable default identity)', () => {
    expect(NO_EXTRA_PANELS).toEqual([]);
    expect(Object.isFrozen(NO_EXTRA_PANELS)).toBe(true);
  });

  it('useExtraPanels defaults to [] with no provider (Studio no-op)', () => {
    let seen: readonly ExtraPanelDef[] | undefined;
    function Probe() {
      seen = useExtraPanels();
      return null;
    }
    render(<Probe />);
    expect(seen).toEqual([]);
  });

  it('useExtraPanels returns the provided panels', () => {
    let seen: readonly ExtraPanelDef[] | undefined;
    function Probe() {
      seen = useExtraPanels();
      return null;
    }
    render(
      <ExtraPanelsProvider value={[discover]}>
        <Probe />
      </ExtraPanelsProvider>,
    );
    expect(seen).toEqual([discover]);
  });

  describe('resolveActivePanel', () => {
    it('resolves a core panel id to its PanelDef (extra = null)', () => {
      const r = resolveActivePanel('editor', [discover]);
      expect(r).toMatchObject({ id: 'editor', label: 'Editor', hasSidebar: true, extra: null });
    });

    it('resolves an extra panel id to its def, honouring hasSidebar', () => {
      const r = resolveActivePanel('test.discover', [discover]);
      expect(r).toMatchObject({ id: 'test.discover', label: 'Discover', hasSidebar: true });
      expect(r.extra).toBe(discover);
    });

    it('defaults hasSidebar to false when the extra omits it', () => {
      const r = resolveActivePanel('test.build', [buildNoSidebar]);
      expect(r.hasSidebar).toBe(false);
      expect(r.extra).toBe(buildNoSidebar);
    });

    it('falls back to the editor panel for an unknown id (never throws)', () => {
      const r = resolveActivePanel('lens.ghost', []);
      expect(r).toMatchObject({ id: 'editor', label: 'Editor', extra: null });
    });
  });
});
