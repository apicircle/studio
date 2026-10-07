import { describe, expect, it, vi } from 'vitest';
import { PANELS } from '../layout/panels';
import { useWorkspaceStore } from './workspaceStore';

// Which panel a relaunch opens on.
//
// The store reads the stored panel once, when its module is first evaluated,
// so a relaunch is a fresh module graph over the same localStorage. Each case
// leaves localStorage the way a previous session would have, resets the module
// registry, and reads what the next session starts on.
//
// In its own file because `vi.resetModules()` strands the store instance the
// setup file resets between tests — nothing else in the store suite should
// inherit that.

const PANEL_STORAGE_KEY = 'apicircle-v2:active-panel';

async function relaunch(): Promise<string> {
  vi.resetModules();
  const fresh = await import('./workspaceStore');
  return fresh.useWorkspaceStore.getState().activePanel;
}

describe('active panel restore on relaunch', () => {
  // Every core panel, read from the registry rather than listed here: a panel
  // added to `PANELS` is covered the day it is added. 'link-workspace' is in
  // the table on purpose — the store restores it even with workspace sharing
  // off, and `App` is what moves the user off a panel this build doesn't show.
  it.each(PANELS.map((panel) => panel.id))(
    'reopens on %s when that was the last panel',
    async (panelId) => {
      // Through the real writer, so this is the round trip a user makes.
      useWorkspaceStore.getState().setActivePanel(panelId);
      expect(localStorage.getItem(PANEL_STORAGE_KEY)).toBe(panelId);

      expect(await relaunch()).toBe(panelId);
    },
  );

  it('opens on the editor when no panel was stored', async () => {
    expect(localStorage.getItem(PANEL_STORAGE_KEY)).toBeNull();
    expect(await relaunch()).toBe('editor');
  });

  it.each(['lens.discover', 'settings', ''])(
    'opens on the editor when the stored id %j is not a core panel',
    async (stored) => {
      // An edition's panel id is written by `setActivePanel` like any other,
      // but only a core id is restored here; the edition's section decides
      // where its own mode reopens.
      localStorage.setItem(PANEL_STORAGE_KEY, stored);
      expect(await relaunch()).toBe('editor');
    },
  );

  it('opens on the editor when localStorage cannot be read', async () => {
    localStorage.setItem(PANEL_STORAGE_KEY, 'mocks');
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('storage is blocked');
    });
    expect(await relaunch()).toBe('editor');
  });
});
