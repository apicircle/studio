import { act } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DesktopMockBridge } from '../desktop/bridge';
import { useWorkspaceStore } from '../store/workspaceStore';
import { clearStudioData } from './clearStudioData';

type BridgeWindow = { apicircleDesktop?: { mock: Partial<DesktopMockBridge> } };

function installMockBridge(stop: DesktopMockBridge['stop']): void {
  (window as unknown as BridgeWindow).apicircleDesktop = { mock: { stop } };
}

describe('clearStudioData', () => {
  const store = () => useWorkspaceStore.getState();

  beforeEach(async () => {
    await act(async () => {
      await useWorkspaceStore.getState().hydrate();
    });
  });

  afterEach(() => {
    delete (window as unknown as BridgeWindow).apicircleDesktop;
  });

  async function twoMockServers(): Promise<string[]> {
    const first = await store().createMockServer({
      name: 'orders',
      source: { kind: 'manual', endpoints: [] },
    });
    const second = await store().createMockServer({
      name: 'billing',
      source: { kind: 'manual', endpoints: [] },
    });
    return [first.id, second.id];
  }

  it('empties the document where there is no mock runtime to stop (the web build)', async () => {
    await twoMockServers();
    await clearStudioData();
    expect(store().synced!.mockServers).toEqual({});
    expect(store().local!.snapshots.entries[0].triggeredBy).toBe('pre-clear');
  });

  it('stops each of the workspace’s mock servers before their definitions go', async () => {
    const ids = await twoMockServers();
    const definedAtStop: number[] = [];
    const stop = vi.fn<DesktopMockBridge['stop']>(async () => {
      definedAtStop.push(Object.keys(store().synced!.mockServers).length);
      return { ok: true };
    });
    installMockBridge(stop);

    await clearStudioData();

    expect(stop.mock.calls.map(([id]) => id).sort()).toEqual([...ids].sort());
    // Both were still defined when they were stopped: the stop came first.
    expect(definedAtStop).toEqual([2, 2]);
    expect(store().synced!.mockServers).toEqual({});
  });

  it('clears all the same when a mock server will not stop', async () => {
    await twoMockServers();
    installMockBridge(vi.fn().mockRejectedValue(new Error('no such server')));
    await clearStudioData();
    expect(store().synced!.mockServers).toEqual({});
  });

  it('rejects, with the document as it was, when nothing could be cleared', async () => {
    await twoMockServers();
    const before = store().synced;
    act(() => store().setSnapshotMaxBytes(1));
    await expect(clearStudioData()).rejects.toThrow(/Nothing was cleared/);
    expect(store().synced).toBe(before);
  });

  it('asks for no stop when the workspace has not loaded, and says so', async () => {
    const stop = vi.fn<DesktopMockBridge['stop']>(async () => ({ ok: true }));
    installMockBridge(stop);
    act(() => useWorkspaceStore.setState({ synced: null, local: null }));
    await expect(clearStudioData()).rejects.toThrow('Workspace not ready');
    expect(stop).not.toHaveBeenCalled();
  });
});
