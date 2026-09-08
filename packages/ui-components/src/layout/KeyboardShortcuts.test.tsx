import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render } from '@testing-library/react';
import { useWorkspaceStore } from '../store/workspaceStore';
import { KeyboardShortcuts } from './KeyboardShortcuts';

function pressKey(opts: {
  key: string;
  ctrl?: boolean;
  meta?: boolean;
  shift?: boolean;
  target?: HTMLElement;
}): boolean {
  const init: KeyboardEventInit = {
    key: opts.key,
    ctrlKey: opts.ctrl ?? false,
    metaKey: opts.meta ?? false,
    shiftKey: opts.shift ?? false,
    bubbles: true,
    cancelable: true,
  };
  const target = opts.target ?? document.body;
  // fireEvent.keyDown returns false when preventDefault was called.
  return fireEvent.keyDown(target, init);
}

describe('KeyboardShortcuts', () => {
  beforeEach(async () => {
    await act(async () => {
      await useWorkspaceStore.getState().hydrate();
    });
    render(<KeyboardShortcuts />);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('Ctrl+1..9 selects the Nth VISIBLE tab, left to right', () => {
    // The numbering follows the tab strip, not the panel registry. Hiding Link
    // Workspace (registry index 1) shifted every later panel down one, and this
    // case is the guard that the shortcut and the strip never disagree about
    // where a panel sits.
    pressKey({ key: '1', ctrl: true });
    expect(useWorkspaceStore.getState().activePanel).toBe('workspace');
    pressKey({ key: '2', ctrl: true });
    expect(useWorkspaceStore.getState().activePanel).toBe('editor');
    pressKey({ key: '3', ctrl: true });
    expect(useWorkspaceStore.getState().activePanel).toBe('env');
    pressKey({ key: '4', ctrl: true });
    expect(useWorkspaceStore.getState().activePanel).toBe('execution');
    pressKey({ key: '5', ctrl: true });
    expect(useWorkspaceStore.getState().activePanel).toBe('history');
    pressKey({ key: '6', ctrl: true });
    expect(useWorkspaceStore.getState().activePanel).toBe('mocks');
    pressKey({ key: '7', ctrl: true });
    expect(useWorkspaceStore.getState().activePanel).toBe('help');
  });

  it('Ctrl+8 and Ctrl+9 are no-ops — there are only seven visible tabs', () => {
    useWorkspaceStore.getState().setActivePanel('history');
    pressKey({ key: '8', ctrl: true });
    expect(useWorkspaceStore.getState().activePanel).toBe('history');
    pressKey({ key: '9', ctrl: true });
    expect(useWorkspaceStore.getState().activePanel).toBe('history');
  });

  it('never selects a panel the tab strip does not show', () => {
    for (const key of ['1', '2', '3', '4', '5', '6', '7', '8', '9']) {
      pressKey({ key, ctrl: true });
      expect(useWorkspaceStore.getState().activePanel).not.toBe('link-workspace');
    }
  });

  it('Ctrl+K opens the Vault tab in the workspace inspector dock', () => {
    pressKey({ key: 'k', ctrl: true });
    expect(useWorkspaceStore.getState().rightDock.tab).toBe('vault');
  });

  it('Ctrl+N adds a request only when the Editor panel is active', () => {
    useWorkspaceStore.getState().setActivePanel('history');
    const before = Object.keys(useWorkspaceStore.getState().synced!.collections.requests).length;
    pressKey({ key: 'n', ctrl: true });
    expect(Object.keys(useWorkspaceStore.getState().synced!.collections.requests).length).toBe(
      before,
    );

    useWorkspaceStore.getState().setActivePanel('editor');
    pressKey({ key: 'n', ctrl: true });
    expect(Object.keys(useWorkspaceStore.getState().synced!.collections.requests).length).toBe(
      before + 1,
    );
  });

  it('does not steal letter keys when an input is focused', () => {
    const input = document.createElement('input');
    document.body.appendChild(input);
    useWorkspaceStore.getState().setActivePanel('workspace');
    pressKey({ key: '3', ctrl: true, target: input });
    expect(useWorkspaceStore.getState().activePanel).toBe('workspace');
    document.body.removeChild(input);
  });

  it('Ctrl+Enter still fires from inside an input (the global Send shortcut)', () => {
    // Asserting via preventDefault: fireEvent.keyDown returns false when
    // the handler called preventDefault, signalling Send was claimed.
    const input = document.createElement('input');
    document.body.appendChild(input);
    const propagated = pressKey({ key: 'Enter', ctrl: true, target: input });
    expect(propagated).toBe(false);
    document.body.removeChild(input);
  });

  it('plain key presses without the modifier are ignored', () => {
    useWorkspaceStore.getState().setActivePanel('workspace');
    pressKey({ key: '3' });
    expect(useWorkspaceStore.getState().activePanel).toBe('workspace');
  });

  it('Cmd+Enter (macOS modifier) also triggers Send', () => {
    const propagated = pressKey({ key: 'Enter', meta: true });
    expect(propagated).toBe(false);
  });

  describe('font-size shortcuts', () => {
    beforeEach(() => {
      // Establish a known baseline so we have headroom in both directions
      // and so prior-test leftovers don't shift the expected values.
      useWorkspaceStore.getState().setFontSizePercent(100);
    });

    it('Ctrl+Shift+= increases the UI text size by one step', () => {
      pressKey({ key: '=', ctrl: true, shift: true });
      expect(useWorkspaceStore.getState().local!.ui.fontSizePercent).toBe(110);
    });

    it('Ctrl+Shift+- decreases the UI text size by one step', () => {
      pressKey({ key: '-', ctrl: true, shift: true });
      expect(useWorkspaceStore.getState().local!.ui.fontSizePercent).toBe(90);
    });

    it('Ctrl+Shift+0 resets the UI text size to 100%', () => {
      useWorkspaceStore.getState().setFontSizePercent(130);
      pressKey({ key: '0', ctrl: true, shift: true });
      expect(useWorkspaceStore.getState().local!.ui.fontSizePercent).toBe(100);
    });

    it('font-size shortcuts fire even when focus is in an editing surface', () => {
      const input = document.createElement('input');
      document.body.appendChild(input);
      pressKey({ key: '=', ctrl: true, shift: true, target: input });
      expect(useWorkspaceStore.getState().local!.ui.fontSizePercent).toBe(110);
      document.body.removeChild(input);
    });

    it('accepts `+` as an alternate increase key (Shift+= on US layouts)', () => {
      pressKey({ key: '+', ctrl: true, shift: true });
      expect(useWorkspaceStore.getState().local!.ui.fontSizePercent).toBe(110);
    });
  });
});
