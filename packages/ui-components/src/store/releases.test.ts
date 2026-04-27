import { act } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { useWorkspaceStore } from './workspaceStore';

describe('workspaceStore release actions', () => {
  beforeEach(async () => {
    await act(async () => {
      await useWorkspaceStore.getState().hydrate();
    });
  });

  it('publishRelease writes to releases.self and bumps currentVersion', async () => {
    await useWorkspaceStore.getState().publishRelease({
      version: '0.1.0',
      notes: 'first cut',
    });
    const releases = useWorkspaceStore.getState().synced!.releases.self!;
    expect(releases.versions).toHaveLength(1);
    expect(releases.versions[0].version).toBe('0.1.0');
    expect(releases.versions[0].workspaceSnapshot).toMatch(/^[0-9a-f]{64}$/);
    expect(releases.currentVersion).toBe('0.1.0');
  });

  it('publishRelease throws on invalid semver', async () => {
    await expect(
      useWorkspaceStore.getState().publishRelease({ version: 'v1', notes: '' }),
    ).rejects.toThrow(/Invalid semver/);
  });

  it('publishRelease rejects duplicates', async () => {
    await useWorkspaceStore.getState().publishRelease({ version: '1.0.0', notes: '' });
    await expect(
      useWorkspaceStore.getState().publishRelease({ version: '1.0.0', notes: '' }),
    ).rejects.toThrow(/already exists/);
  });

  it('deprecateRelease + yankRelease flip the flags without removing the entry', async () => {
    await useWorkspaceStore.getState().publishRelease({ version: '0.1.0', notes: '' });
    useWorkspaceStore.getState().deprecateRelease('0.1.0');
    expect(useWorkspaceStore.getState().synced!.releases.self!.versions[0].deprecated).toBe(true);
    useWorkspaceStore.getState().yankRelease('0.1.0');
    expect(useWorkspaceStore.getState().synced!.releases.self!.versions[0].yanked).toBe(true);
  });
});
