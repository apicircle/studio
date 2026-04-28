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

  it('Ctrl+1..9 switches the active panel by side effect', () => {
    pressKey({ key: '3', ctrl: true });
    expect(useWorkspaceStore.getState().activePanel).toBe('editor');
    pressKey({ key: '6', ctrl: true });
    expect(useWorkspaceStore.getState().activePanel).toBe('history');
    pressKey({ key: '7', ctrl: true });
    expect(useWorkspaceStore.getState().activePanel).toBe('mocks');
    pressKey({ key: '9', ctrl: true });
    expect(useWorkspaceStore.getState().activePanel).toBe('help');
  });

  it('Ctrl+K opens the Secret Vault', () => {
    pressKey({ key: 'k', ctrl: true });
    expect(useWorkspaceStore.getState().secretVaultOpen).toBe(true);
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
});
