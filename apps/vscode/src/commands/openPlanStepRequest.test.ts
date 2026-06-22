import type { Mock } from 'vitest';
import { describe, it, expect, beforeEach } from 'vitest';
import { window, commands } from '../../test/mocks/vscode';
import { openPlanStepRequestCommand } from './openPlanStepRequest';

function req(id: string, name: string) {
  return {
    id,
    name,
    folderId: null,
    method: 'GET',
    url: 'https://x.com',
    headers: [],
    query: [],
    body: { type: 'none', content: '' },
    auth: { type: 'none' },
    contextVars: [],
    extractions: [],
    assertions: [],
    createdAt: '2026-01-01',
    updatedAt: '2026-01-01',
  };
}

function makeBridge(state: unknown) {
  return {
    activeWorkspace: () => ({
      workspace: { id: '/abs/.apicircle' },
      read: async () => state,
    }),
  } as never;
}

function localState(steps: Array<{ requestId: string; linkedWorkspaceId?: string }>) {
  return {
    synced: {
      executionPlans: { p1: { id: 'p1', name: 'Smoke', steps } },
      collections: { requests: { r1: req('r1', 'Sign up') }, folders: {} },
      linkedWorkspaces: {},
    },
    local: { linkedCollections: {} },
  };
}

describe('openPlanStepRequestCommand', () => {
  beforeEach(() => {
    (commands.executeCommand as Mock).mockReset();
    (window.showWarningMessage as Mock).mockReset();
  });

  it('warns when no node is provided', async () => {
    await openPlanStepRequestCommand({ bridge: makeBridge(localState([{ requestId: 'r1' }])) });
    expect(window.showWarningMessage).toHaveBeenCalledWith(expect.stringContaining('No plan step'));
  });

  it('opens the request editor for a local step', async () => {
    const bridge = makeBridge(localState([{ requestId: 'r1' }]));
    await openPlanStepRequestCommand({ bridge }, { planId: 'p1', stepIndex: 0 });
    expect(commands.executeCommand).toHaveBeenCalledTimes(1);
    const [cmd, uri] = (commands.executeCommand as Mock).mock.calls[0];
    expect(cmd).toBe('vscode.open');
    expect(String((uri as { path: string }).path)).toContain('/requests/');
  });

  it('opens the request named on the row directly, ignoring a stale stepIndex', async () => {
    // requestId is passed (the CodeLens path) → the editor opens exactly that
    // request even though stepIndex 99 is out of range for the saved plan.
    const bridge = makeBridge(localState([{ requestId: 'r1' }]));
    await openPlanStepRequestCommand({ bridge }, { planId: 'p1', stepIndex: 99, requestId: 'r1' });
    expect(commands.executeCommand).toHaveBeenCalledTimes(1);
    const [cmd, uri] = (commands.executeCommand as Mock).mock.calls[0];
    expect(cmd).toBe('vscode.open');
    expect(String((uri as { path: string }).path)).toContain('/requests/');
  });

  it('warns when the local request no longer exists', async () => {
    const bridge = makeBridge(localState([{ requestId: 'gone' }]));
    await openPlanStepRequestCommand({ bridge }, { planId: 'p1', stepIndex: 0 });
    expect(window.showWarningMessage).toHaveBeenCalledWith(
      expect.stringContaining('no longer exists'),
    );
    expect(commands.executeCommand).not.toHaveBeenCalled();
  });

  it('warns when the plan no longer exists', async () => {
    const bridge = makeBridge(localState([{ requestId: 'r1' }]));
    await openPlanStepRequestCommand({ bridge }, { planId: 'ghost', stepIndex: 0 });
    expect(window.showWarningMessage).toHaveBeenCalledWith(
      expect.stringContaining('Plan no longer'),
    );
  });

  it('opens the linked-request projection for a linked step', async () => {
    const state = {
      synced: {
        executionPlans: {
          p1: { id: 'p1', name: 'Smoke', steps: [{ requestId: 'lr1', linkedWorkspaceId: 'lw1' }] },
        },
        collections: { requests: {}, folders: {} },
        linkedWorkspaces: { lw1: { id: 'lw1', name: 'Shared API' } },
      },
      local: {
        linkedCollections: { lw1: { collections: { requests: { lr1: req('lr1', 'Ping') } } } },
      },
    };
    await openPlanStepRequestCommand({ bridge: makeBridge(state) }, { planId: 'p1', stepIndex: 0 });
    expect(commands.executeCommand).toHaveBeenCalledTimes(1);
    const [cmd, uri] = (commands.executeCommand as Mock).mock.calls[0];
    expect(cmd).toBe('vscode.open');
    expect(String((uri as { path: string }).path)).toContain('/linked/');
  });

  it('warns when a linked step is not cached', async () => {
    const state = {
      synced: {
        executionPlans: {
          p1: { id: 'p1', name: 'Smoke', steps: [{ requestId: 'lr1', linkedWorkspaceId: 'lw1' }] },
        },
        collections: { requests: {}, folders: {} },
        linkedWorkspaces: { lw1: { id: 'lw1', name: 'Shared API' } },
      },
      local: { linkedCollections: {} },
    };
    await openPlanStepRequestCommand({ bridge: makeBridge(state) }, { planId: 'p1', stepIndex: 0 });
    expect(window.showWarningMessage).toHaveBeenCalledWith(expect.stringContaining('not cached'));
  });
});
