import { describe, it, expect, beforeEach } from 'vitest';
import { window, commands } from '../../test/mocks/vscode';
import type { VsCodeBridge } from '../host/vscodeBridge';
import type { WorkspaceSurface } from '../host/vscodeBridge';
import { switchWorkspaceCommand } from './switchWorkspace';

function makeSurface(
  id: string,
  label: string,
  source: 'git-folder' | 'registry' = 'git-folder',
): WorkspaceSurface {
  return {
    workspace: {
      id,
      apicircleDir: `/workspaces/${id}/.apicircle/workspace-${id}`,
      workspaceJsonPath: `/workspaces/${id}/.apicircle/workspace-${id}/workspace.json`,
      workspaceFolder: undefined,
      label,
      source,
    },
    read: async () => ({ synced: {}, local: {} }),
    apply: async () => ({ next: { synced: {}, local: {} }, changedIds: [] }),
    write: async () => ({ synced: {}, local: {} }),
  } as unknown as WorkspaceSurface;
}

function makeBridge(surfaces: WorkspaceSurface[], activeIdx = 0) {
  let activeId = surfaces.length > 0 ? surfaces[activeIdx].workspace.id : null;
  return {
    listWorkspaces: () => surfaces,
    activeWorkspace: () =>
      activeId ? (surfaces.find((s) => s.workspace.id === activeId) ?? null) : null,
    setActive: (id: string) => {
      activeId = id;
    },
    _getActiveId: () => activeId,
  } as unknown as VsCodeBridge & { _getActiveId: () => string | null };
}

function extractCallback(): (() => Promise<void>) | undefined {
  const calls = (
    commands.registerCommand as unknown as { mock: { calls: Array<[string, () => Promise<void>]> } }
  ).mock.calls;
  const matching = calls.filter((c: [string, unknown]) => c[0] === 'apicircle.switchWorkspace');
  return matching.length > 0 ? matching[matching.length - 1][1] : undefined;
}

describe('switchWorkspaceCommand', () => {
  beforeEach(() => {
    window.showQuickPick.mockReset();
    window.showInformationMessage.mockReset();
    commands.executeCommand.mockReset();
    commands.registerCommand.mockClear();
  });

  it('registers the apicircle.switchWorkspace command', () => {
    const bridge = makeBridge([makeSurface('a', 'WS A')]);
    switchWorkspaceCommand(bridge);
    expect(commands.registerCommand).toHaveBeenCalledWith(
      'apicircle.switchWorkspace',
      expect.any(Function),
    );
  });

  it('shows info message when no workspaces exist', async () => {
    const bridge = makeBridge([]);
    switchWorkspaceCommand(bridge);
    const callback = extractCallback()!;

    await callback();

    expect(window.showInformationMessage).toHaveBeenCalledWith(
      expect.stringContaining('No workspaces discovered'),
    );
    expect(window.showQuickPick).not.toHaveBeenCalled();
  });

  it('shows info message when only one workspace is available', async () => {
    const bridge = makeBridge([makeSurface('a', 'Solo WS')]);
    switchWorkspaceCommand(bridge);
    const callback = extractCallback()!;

    await callback();

    expect(window.showInformationMessage).toHaveBeenCalledWith(
      expect.stringContaining('Only one workspace'),
    );
    expect(window.showQuickPick).not.toHaveBeenCalled();
  });

  it('shows quick pick with workspace labels when multiple exist', async () => {
    const bridge = makeBridge([
      makeSurface('a', 'Pet Store'),
      makeSurface('b', 'Payment API', 'registry'),
    ]);
    switchWorkspaceCommand(bridge);
    const callback = extractCallback()!;

    window.showQuickPick.mockResolvedValue(undefined);
    await callback();

    expect(window.showQuickPick).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({ label: 'Pet Store', description: 'git-folder' }),
        expect.objectContaining({ label: 'Payment API', description: 'registry' }),
      ]),
      expect.objectContaining({ placeHolder: 'Select a workspace to switch to' }),
    );
  });

  it('calls setActive when user picks a different workspace', async () => {
    const bridge = makeBridge([makeSurface('a', 'WS A'), makeSurface('b', 'WS B')]);
    switchWorkspaceCommand(bridge);
    const callback = extractCallback()!;

    window.showQuickPick.mockResolvedValue({ id: 'b', label: 'WS B' });
    await callback();

    expect(bridge._getActiveId()).toBe('b');
    expect(commands.executeCommand).toHaveBeenCalledWith(
      'setContext',
      'apicircle.hasActiveWorkspace',
      true,
    );
  });

  it('does nothing when user cancels quick pick', async () => {
    const bridge = makeBridge([makeSurface('a', 'WS A'), makeSurface('b', 'WS B')]);
    switchWorkspaceCommand(bridge);
    const callback = extractCallback()!;

    window.showQuickPick.mockResolvedValue(undefined);
    await callback();

    expect(bridge._getActiveId()).toBe('a');
  });

  it('does not call setActive when user picks the already-active workspace', async () => {
    const bridge = makeBridge([makeSurface('a', 'WS A'), makeSurface('b', 'WS B')]);
    let setActiveCalled = false;
    const origSetActive = bridge.setActive;
    (bridge as unknown as Record<string, unknown>).setActive = (id: string) => {
      setActiveCalled = true;
      origSetActive.call(bridge, id);
    };
    switchWorkspaceCommand(bridge);
    const callback = extractCallback()!;

    window.showQuickPick.mockResolvedValue({ id: 'a', label: 'WS A' });
    await callback();

    expect(setActiveCalled).toBe(false);
  });
});
