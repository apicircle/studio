import { act } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useWorkspaceStore } from './workspaceStore';

// The "no reads" half of switching workspace sharing off.
//
// Hiding the UI is not enough on its own: these actions reach third-party
// repositories, and two of them (`refreshWorkspace`'s linked bootstrap and
// `syncAttachments`' linked loop) are not user-initiated at all — the first
// runs on every pull AND every window focus. So each network-touching sharing
// action carries its own guard, and this suite is what proves it.
//
// Runs with the real accessor (off). Nothing here is spied to `true`.

const REFUSAL = /Workspace sharing is not enabled/;

async function hydrate(): Promise<void> {
  await act(async () => {
    await useWorkspaceStore.getState().hydrate();
  });
}

describe('network-touching sharing actions refuse when sharing is off', () => {
  beforeEach(async () => {
    await hydrate();
    // Stub fetch so a leaked call is a hard failure rather than a real
    // request: any action that gets past its guard would reject here with a
    // different message and fail the `toThrow(REFUSAL)` assertion.
    vi.stubGlobal(
      'fetch',
      vi.fn(() => {
        throw new Error('network call escaped the workspace-sharing guard');
      }),
    );
  });

  it.each([
    [
      'linkPrivateWorkspace',
      () =>
        useWorkspaceStore.getState().linkPrivateWorkspace({
          repoFullName: 'org/source',
          branch: 'main',
        }),
    ],
    [
      'linkPublicWorkspace',
      () =>
        useWorkspaceStore.getState().linkPublicWorkspace({
          repoFullName: 'org/source',
          branch: 'main',
        }),
    ],
    ['refreshLinkedWorkspace', () => useWorkspaceStore.getState().refreshLinkedWorkspace('lw-1')],
    [
      'previewLinkedUpdateForLink',
      () => useWorkspaceStore.getState().previewLinkedUpdateForLink('lw-1'),
    ],
    [
      'probeLinkedRepoVersions',
      () => useWorkspaceStore.getState().probeLinkedRepoVersions('org', 'source', 'main'),
    ],
    ['searchMarketplace', () => useWorkspaceStore.getState().searchMarketplace('payments')],
    ['addLinkSession', () => useWorkspaceStore.getState().addLinkSession('lw-1', 'ghp_x')],
    [
      'tagReleaseVersion',
      () => useWorkspaceStore.getState().tagReleaseVersion({ version: '1.0.0' }),
    ],
    ['listRepoTopics', () => useWorkspaceStore.getState().listRepoTopics()],
    ['setRepoTopics', () => useWorkspaceStore.getState().setRepoTopics(['payments'])],
  ])('%s refuses before reaching the network', async (_name, call) => {
    await expect(call()).rejects.toThrow(REFUSAL);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  // Two actions whose contract is "return nothing / null" rather than throw —
  // a caller of these treats a rejection as a real failure worth surfacing, so
  // they guard inline instead of via the shared assert.
  it('loadLatestUntaggedRelease resolves to null instead of throwing', async () => {
    await expect(useWorkspaceStore.getState().loadLatestUntaggedRelease()).resolves.toBeNull();
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('applyLinkedUpdateForLink resolves without doing anything', async () => {
    await expect(
      useWorkspaceStore.getState().applyLinkedUpdateForLink({}),
    ).resolves.toBeUndefined();
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });
});
