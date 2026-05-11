import { describe, expect, it } from 'vitest';
import type { WorkspaceSynced } from '@apicircle/shared';
import { deprecateRelease, publishRelease, yankRelease } from './publishRelease';

const empty: WorkspaceSynced = {
  schemaVersion: 1,
  workspaceId: 'ws-1',
  workspaceName: 'W',
  collections: { tree: { id: 'r', type: 'root', children: [] }, requests: {}, folders: {} },
  environments: { items: {}, activeName: null, priorityOrder: [] },
  linkedWorkspaces: {},
  linkedOverrides: { requests: {}, environmentVars: {} },
  releases: { self: null, perLink: {} },
  globalAssets: { schemas: {}, graphql: {} },
  mockServers: {},
  meta: { createdAt: 't', updatedAt: 't', appVersion: '0.1.0' },
};

describe('publishRelease', () => {
  it('creates the ledger and stamps the first version with a sha256 snapshot', async () => {
    const next = await publishRelease(empty, { version: '0.1.0', notes: 'first cut' });
    expect(next.releases.self).not.toBeNull();
    expect(next.releases.self!.versions).toHaveLength(1);
    expect(next.releases.self!.currentVersion).toBe('0.1.0');
    const v = next.releases.self!.versions[0];
    expect(v.version).toBe('0.1.0');
    expect(v.notes).toBe('first cut');
    expect(v.deprecated).toBe(false);
    expect(v.yanked).toBe(false);
    expect(v.workspaceSnapshot).toMatch(/^[0-9a-f]{64}$/);
  });

  it('rejects invalid semver', async () => {
    await expect(publishRelease(empty, { version: 'v1', notes: '' })).rejects.toThrow(
      /Invalid semver/,
    );
  });

  it('rejects duplicate versions', async () => {
    const v1 = await publishRelease(empty, { version: '1.0.0', notes: '' });
    await expect(publishRelease(v1, { version: '1.0.0', notes: '' })).rejects.toThrow(
      /already exists/,
    );
  });

  it('passes through optional sha + tagName when provided', async () => {
    const next = await publishRelease(empty, {
      version: '0.2.0',
      notes: '',
      sha: 'abc123',
      tagName: 'v0.2.0',
    });
    const v = next.releases.self!.versions[0];
    expect(v.sha).toBe('abc123');
    expect(v.tagName).toBe('v0.2.0');
  });

  it('appends + bumps currentVersion on subsequent publishes', async () => {
    const v1 = await publishRelease(empty, { version: '0.1.0', notes: '' });
    const v2 = await publishRelease(v1, { version: '0.2.0', notes: '' });
    expect(v2.releases.self!.versions.map((v) => v.version)).toEqual(['0.1.0', '0.2.0']);
    expect(v2.releases.self!.currentVersion).toBe('0.2.0');
  });

  it('produces stable snapshot SHAs for byte-identical pre-publish docs', async () => {
    const a = await publishRelease(empty, {
      version: '0.1.0',
      notes: '',
      publishedAt: 'fixed',
    });
    const b = await publishRelease(empty, {
      version: '0.1.0',
      notes: '',
      publishedAt: 'fixed',
    });
    expect(a.releases.self!.versions[0].workspaceSnapshot).toBe(
      b.releases.self!.versions[0].workspaceSnapshot,
    );
  });
});

describe('deprecateRelease + yankRelease', () => {
  it('flips the deprecated flag without removing the entry', async () => {
    const v1 = await publishRelease(empty, { version: '0.1.0', notes: '' });
    const next = deprecateRelease(v1, '0.1.0');
    expect(next.releases.self!.versions[0].deprecated).toBe(true);
    expect(next.releases.self!.versions[0].yanked).toBe(false);
  });

  it('flips the yanked flag without removing the entry', async () => {
    const v1 = await publishRelease(empty, { version: '0.1.0', notes: '' });
    const next = yankRelease(v1, '0.1.0');
    expect(next.releases.self!.versions[0].yanked).toBe(true);
  });

  it('throws when the version is unknown', async () => {
    const v1 = await publishRelease(empty, { version: '0.1.0', notes: '' });
    expect(() => yankRelease(v1, '9.9.9')).toThrow(/not found/);
  });

  it('throws when no releases ledger exists yet', () => {
    expect(() => deprecateRelease(empty, '0.1.0')).toThrow(/No releases/);
  });

  it('preserves an earlier deprecate flag when a different version is yanked later', async () => {
    // Repro: user deprecates v2.3.0, then yanks v1.0.0. The
    // deprecated flag on v2.3.0 must survive — a regression where
    // yankRelease cloned a stale ledger entry would silently flip
    // it back to false.
    let state = await publishRelease(empty, { version: '1.0.0', notes: 'first' });
    state = await publishRelease(state, { version: '2.3.0', notes: 'feature drop' });
    state = deprecateRelease(state, '2.3.0');
    state = yankRelease(state, '1.0.0');

    const versions = state.releases.self!.versions;
    const v100 = versions.find((v) => v.version === '1.0.0')!;
    const v230 = versions.find((v) => v.version === '2.3.0')!;
    expect(v100.yanked).toBe(true);
    expect(v100.deprecated).toBe(false);
    // Critical: v2.3.0's deprecated flag must persist across the yank.
    expect(v230.deprecated).toBe(true);
    expect(v230.yanked).toBe(false);
  });
});
