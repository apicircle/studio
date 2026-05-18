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

  it('deprecating one version then yanking another preserves the first deprecate flag (store)', async () => {
    // Repro: user deprecates v2.3.0, then yanks v1.0.0. The store-level
    // path goes through captureSnapshot (which mutates local) before
    // commitSynced (which mutates synced). We need to verify
    // captureSnapshot doesn't accidentally clobber the just-deprecated
    // release entry on the synced side.
    await useWorkspaceStore.getState().publishRelease({ version: '1.0.0', notes: 'first' });
    await useWorkspaceStore.getState().publishRelease({ version: '2.3.0', notes: 'feature' });

    useWorkspaceStore.getState().deprecateRelease('2.3.0');
    let versions = useWorkspaceStore.getState().synced!.releases.self!.versions;
    expect(versions.find((v) => v.version === '2.3.0')!.deprecated).toBe(true);

    useWorkspaceStore.getState().yankRelease('1.0.0');
    versions = useWorkspaceStore.getState().synced!.releases.self!.versions;
    const v100 = versions.find((v) => v.version === '1.0.0')!;
    const v230 = versions.find((v) => v.version === '2.3.0')!;
    expect(v100.yanked).toBe(true);
    // The critical assertion: v2.3.0's deprecated flag must survive the
    // subsequent yank-on-different-version.
    expect(v230.deprecated).toBe(true);
    expect(v230.yanked).toBe(false);
    expect(v100.deprecated).toBe(false);
  });
});
